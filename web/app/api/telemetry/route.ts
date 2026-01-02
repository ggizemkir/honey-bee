import {
  classifyDetection,
  getLatestTelemetry,
  setLatestTelemetry,
  type DetectionCode,
  type TelemetrySnapshot
} from './store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function normalizeNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeDetection(value: unknown): DetectionCode | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === 'bal' || normalized === 'esek' || normalized === 'belirsiz') {
    return normalized;
  }

  return null;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export async function GET(): Promise<Response> {
  const latest = getLatestTelemetry();
  if (!latest) {
    return new Response(null, { status: 204 });
  }
  return jsonResponse(latest);
}

export async function POST(request: Request): Promise<Response> {
  const expectedApiKey = process.env.TELEMETRY_API_KEY;
  if (expectedApiKey) {
    const provided = request.headers.get('x-api-key');
    if (!provided || provided !== expectedApiKey) {
      return new Response('Unauthorized', { status: 401 });
    }
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  if (!body || typeof body !== 'object') {
    return new Response('Invalid payload', { status: 400 });
  }

  const peakFrequencyHz = normalizeNumber((body as Record<string, unknown>).peakFrequencyHz);
  if (peakFrequencyHz == null) {
    return new Response('Missing peakFrequencyHz', { status: 400 });
  }

  const amplitudePercentRaw = normalizeNumber((body as Record<string, unknown>).amplitudePercent);
  const confidencePercentRaw = normalizeNumber((body as Record<string, unknown>).confidencePercent);
  const detectionRaw = normalizeDetection((body as Record<string, unknown>).detection);

  const deviceId = String((body as Record<string, unknown>).deviceId ?? 'local-device');

  const amplitudePercent = amplitudePercentRaw == null ? null : clamp(amplitudePercentRaw, 0, 100);
  const confidencePercent =
    confidencePercentRaw == null ? (amplitudePercent == null ? null : amplitudePercent) : clamp(confidencePercentRaw, 0, 100);

  const detection = detectionRaw ?? classifyDetection(peakFrequencyHz);

  const telemetry: TelemetrySnapshot = {
    ts: Date.now(),
    deviceId,
    peakFrequencyHz,
    amplitudePercent,
    confidencePercent,
    detection
  };

  setLatestTelemetry(telemetry);
  return jsonResponse({ ok: true, telemetry });
}

