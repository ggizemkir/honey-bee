export type DetectionCode = 'bal' | 'esek' | 'belirsiz';

export type TelemetrySnapshot = {
  ts: number;
  deviceId: string;
  peakFrequencyHz: number;
  amplitudePercent: number | null;
  confidencePercent: number | null;
  detection: DetectionCode;
};

type Subscriber = (telemetry: TelemetrySnapshot) => void;

type TelemetryStore = {
  latest: TelemetrySnapshot | null;
  subscribers: Set<Subscriber>;
};

declare global {
  // eslint-disable-next-line no-var
  var __hornetTelemetryStore: TelemetryStore | undefined;
}

const store: TelemetryStore =
  globalThis.__hornetTelemetryStore ??
  (globalThis.__hornetTelemetryStore = {
    latest: null,
    subscribers: new Set()
  });

export function getLatestTelemetry(): TelemetrySnapshot | null {
  return store.latest;
}

export function setLatestTelemetry(next: TelemetrySnapshot): void {
  store.latest = next;
  store.subscribers.forEach((subscriber) => subscriber(next));
}

export function subscribeTelemetry(subscriber: Subscriber): () => void {
  store.subscribers.add(subscriber);
  return () => store.subscribers.delete(subscriber);
}

export function classifyDetection(peakFrequencyHz: number): DetectionCode {
  if (peakFrequencyHz >= 200 && peakFrequencyHz <= 300) {
    return 'bal';
  }
  if (peakFrequencyHz > 300 && peakFrequencyHz <= 1000) {
    return 'esek';
  }
  return 'belirsiz';
}

