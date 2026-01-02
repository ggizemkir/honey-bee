import { getLatestTelemetry, subscribeTelemetry, type TelemetrySnapshot } from '../store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SseEventName = 'hello' | 'telemetry';

function formatSseEvent(event: SseEventName, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(request: Request): Promise<Response> {
  const encoder = new TextEncoder();
  const { signal } = request;

  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (event: SseEventName, data: unknown) => {
        controller.enqueue(encoder.encode(formatSseEvent(event, data)));
      };

      send('hello', { ok: true, ts: Date.now() });

      const latest = getLatestTelemetry();
      if (latest) {
        send('telemetry', latest);
      }

      unsubscribe = subscribeTelemetry((telemetry: TelemetrySnapshot) => {
        send('telemetry', telemetry);
      });

      heartbeat = setInterval(() => {
        controller.enqueue(encoder.encode(`: ping ${Date.now()}\n\n`));
      }, 15000);

      signal.addEventListener('abort', () => {
        if (heartbeat) {
          clearInterval(heartbeat);
          heartbeat = null;
        }
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        controller.close();
      });
    },
    cancel() {
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    }
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive'
    }
  });
}

