'use client';

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { getDatabase, off, onValue, ref } from 'firebase/database';
import { getFirebaseApp } from '../lib/firebase';

type LiveStatus = 'idle' | 'connecting' | 'connected' | 'error';

type DetectionCode = 'bal' | 'esek' | 'belirsiz';

type TelemetrySnapshot = {
  ts: number;
  deviceId: string;
  peakFrequencyHz: number;
  amplitudePercent: number | null;
  confidencePercent: number | null;
  detection: DetectionCode;
};

const DETECT_MIN_HZ = 100;
const DETECT_MAX_HZ = 1000;
const HONEY_BEE_MIN_HZ = 200;
const HONEY_BEE_MAX_HZ = 300;

const hasFirebaseConfig = Boolean(process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL);

const meterStyle = (value: string): CSSProperties => ({ '--fill': value } as CSSProperties);

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

const normalizeNumber = (value: unknown): number | null => {
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
};

const classifyDetection = (peakFrequencyHz: number): DetectionCode => {
  if (peakFrequencyHz >= HONEY_BEE_MIN_HZ && peakFrequencyHz < HONEY_BEE_MAX_HZ) {
    return 'bal';
  }
  if (peakFrequencyHz > 100 && peakFrequencyHz <= 180) {
    return 'esek';
  }
  return 'belirsiz';
};

const normalizeTelemetry = (raw: unknown): TelemetrySnapshot | null => {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const peakFrequencyHz = normalizeNumber(record.peakFrequencyHz);
  if (peakFrequencyHz == null) {
    return null;
  }
  const amplitudePercent = normalizeNumber(record.amplitudePercent);
  const confidencePercent = normalizeNumber(record.confidencePercent);
  const detectionRaw = typeof record.detection === 'string' ? record.detection : '';
  const detection =
    detectionRaw === 'bal' || detectionRaw === 'esek' || detectionRaw === 'belirsiz'
      ? (detectionRaw as DetectionCode)
      : classifyDetection(peakFrequencyHz);
  const tsValue = normalizeNumber(record.ts);
  return {
    ts: tsValue != null ? tsValue : Date.now(),
    deviceId: typeof record.deviceId === 'string' ? record.deviceId : 'device',
    peakFrequencyHz,
    amplitudePercent: amplitudePercent == null ? null : clamp(amplitudePercent, 0, 100),
    confidencePercent: confidencePercent == null ? null : clamp(confidencePercent, 0, 100),
    detection
  };
};

const detectionLabel = (code: DetectionCode): string => {
  if (code === 'bal') {
    return 'Bal Arısı (Apis mellifera)';
  }
  if (code === 'esek') {
    return 'Eşek Arısı (Hornet - Vespa)';
  }
  return 'Belirsiz';
};

export default function Home() {
  const [liveStatus, setLiveStatus] = useState<LiveStatus>('idle');
  const [liveTelemetry, setLiveTelemetry] = useState<TelemetrySnapshot | null>(null);

  useEffect(() => {
    setLiveStatus('connecting');

    if (hasFirebaseConfig) {
      const app = getFirebaseApp();
      if (!app) {
        setLiveStatus('error');
        return;
      }
      const db = getDatabase(app);
      const telemetryRef = ref(db, 'telemetry/latest');
      const unsubscribe = onValue(
        telemetryRef,
        (snapshot) => {
          const normalized = normalizeTelemetry(snapshot.val());
          if (normalized) {
            setLiveTelemetry(normalized);
          }
          setLiveStatus('connected');
        },
        () => {
          setLiveStatus('error');
        }
      );
      return () => {
        unsubscribe();
        off(telemetryRef);
      };
    }

    const source = new EventSource('/api/telemetry/stream');

    source.onopen = () => {
      setLiveStatus('connected');
    };

    const handleTelemetry = (event: MessageEvent<string>) => {
      try {
        const parsed = JSON.parse(event.data) as TelemetrySnapshot;
        if (!parsed || typeof parsed !== 'object') {
          return;
        }
        setLiveTelemetry(parsed);
        setLiveStatus('connected');
      } catch {
        // ignore malformed events
      }
    };

    source.addEventListener('telemetry', handleTelemetry as unknown as EventListener);

    source.onerror = () => {
      setLiveStatus('error');
    };

    return () => {
      source.close();
    };
  }, []);

  const telemetry = liveTelemetry;

  const panelHint =
    liveStatus === 'connected'
      ? liveTelemetry
        ? `Canlı bağlantı aktif. Son güncelleme: ${new Date(liveTelemetry.ts).toLocaleTimeString('tr-TR')}`
        : 'Canlı bağlantı aktif. Veri bekleniyor.'
      : liveStatus === 'connecting'
        ? 'Canlı bağlantı kuruluyor...'
        : liveStatus === 'error'
          ? 'Bağlantı hatası. Yeniden bağlanılıyor...'
          : 'Canlı bağlantı bekleniyor.';

  const listenState =
    liveStatus === 'connected'
      ? liveTelemetry
        ? 'Canlı bağlantı'
        : 'Veri bekleniyor'
      : liveStatus === 'connecting'
        ? 'Bağlanıyor'
        : liveStatus === 'error'
          ? 'Bağlantı hatası'
          : 'Beklemede';

  const listenClass = liveStatus === 'connected' ? 'status-pill' : 'status-pill is-idle';

  const amplitudePercent = telemetry?.amplitudePercent;
  const amplitudeFill = amplitudePercent != null ? `${clamp(amplitudePercent, 0, 100)}%` : '0%';
  const amplitudeLabel = amplitudePercent != null ? `${Math.round(amplitudePercent)}%` : '--%';

  const peakFrequencyHz = telemetry?.peakFrequencyHz;
  const peakValue = peakFrequencyHz != null ? `${peakFrequencyHz} Hz` : '-- Hz';

  const bandPosition =
    peakFrequencyHz != null
      ? clamp((peakFrequencyHz - DETECT_MIN_HZ) / (DETECT_MAX_HZ - DETECT_MIN_HZ), 0, 1)
      : null;
  const bandPositionPercent = bandPosition != null ? `${Math.round(bandPosition * 100)}%` : '--%';
  const bandPositionFill = bandPosition != null ? `${Math.round(bandPosition * 100)}%` : '0%';

  const detectionCode = peakFrequencyHz != null ? classifyDetection(peakFrequencyHz) : null;
  const detectionValue = peakFrequencyHz != null ? detectionLabel(detectionCode ?? 'belirsiz') : '...';
  const detectionClass =
    detectionCode === 'bal' ? 'detection-bal' : detectionCode === 'esek' ? 'detection-esek' : 'detection-belirsiz';

  const confidencePercent = telemetry?.confidencePercent;
  const confidenceFill = confidencePercent != null ? `${clamp(confidencePercent, 0, 100)}%` : '0%';
  const confidenceLabel = confidencePercent != null ? `${Math.round(confidencePercent)}%` : '--%';

  return (
    <>
      <div className="bg-veil" aria-hidden="true" />
      <div className="bg-glow" aria-hidden="true" />

      <main>
        <section id="panel" className="section">
          <h2 className="section-title" style={{ textAlign: 'center' }}>
            Canlı tespit paneli
          </h2>
          <div className="panel">
            <div className="panel-header">
              <div>
                <h3>Alan izleme</h3>
                <p className="panel-note" id="panel-hint">
                  {panelHint}
                </p>
              </div>
              <div className="panel-switch" aria-hidden="true">
                <span className="pill">Canlı bağlantı</span>
              </div>
            </div>
            <div className="panel-grid">
              <div className="panel-card">
                <h4>Dinleme durumu</h4>
                <div className={listenClass} id="listen-state">
                  {listenState}
                </div>
                <div className="meter" style={meterStyle(amplitudeFill)}>
                  <div className="meter-bar">
                    <div className="meter-fill" />
                  </div>
                  <div className="meter-label">
                    <span>Ortalama genlik</span>
                    <span>{amplitudeLabel}</span>
                  </div>
                </div>
              </div>
              <div className="panel-card">
                <h4>Baskın frekans</h4>
                <strong>{peakValue}</strong>
                <div className="meter" style={meterStyle(bandPositionFill)}>
                  <div className="meter-bar">
                    <div className="meter-fill" />
                  </div>
                  <div className="meter-label">
                    <span>Aralık içi konum</span>
                    <span>{bandPositionPercent}</span>
                  </div>
                </div>
              </div>
              <div className={`panel-card detection-card ${detectionClass}`}>
                <h4>Tespit sonucu</h4>
                <strong>{detectionValue}</strong>
                <div className="meter" style={meterStyle(confidenceFill)}>
                  <div className="meter-bar">
                    <div className="meter-fill" />
                  </div>
                  <div className="meter-label">
                    <span>Sınıflandırma güveni</span>
                    <span>{confidenceLabel}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer>HornetSavunma - Canlı tespit paneli</footer>
    </>
  );
}
