# HornetSavunma Web (Next.js)

Bu klasör, ESP32 (INMP441) tarafından gönderilen tespit telemetrisini yerelde alıp canlı olarak göstermeyi hedefler.

## Yerel canlı akış (ESP32 → Next.js → UI)

1) Web'i başlat (LAN erişimi açık)

```powershell
cd C:\Users\gizem\OneDrive\Masaüstü\HornetSavunma\web
npm install
npm run dev:lan
```

- Tarayıcı: `http://localhost:3000`
- ESP32 için PC IP gerekir (örnek: `192.168.1.50`).

2) ESP32 tarafını ayarla

- `C:/Users/gizem/OneDrive/Masaüstü/HornetSavunma/include/secrets.example.h` dosyasını kopyala:
  - `include/secrets.h` oluştur
- İçindeki değerleri doldur:
  - `WIFI_SSID`, `WIFI_PASSWORD`
  - `TELEMETRY_SERVER_BASE` → örn: `http://192.168.1.50:3000`
  - (opsiyonel) `TELEMETRY_API_KEY`
  - (opsiyonel) `TELEMETRY_DEVICE_ID`

3) ESP32'yi yükle

- PlatformIO ile projeyi derle/yükle.
- Serial Monitor (115200) üzerinden bağlantı ve POST durum kodlarını görebilirsin.

4) UI'da canlı veriyi izle

- Sayfada `Durum paneli` bölümünde `Canlı bağlantı` moduna geç.
- ESP32 `POST /api/telemetry` gönderdikçe panel anlık güncellenir.

## ESP32 olmadan hızlı test

Web çalışırken örnek telemetri gönder:

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri http://localhost:3000/api/telemetry `
  -ContentType application/json `
  -Body '{\"deviceId\":\"test\",\"peakFrequencyHz\":352,\"amplitudePercent\":58,\"confidencePercent\":76,\"detection\":\"esek\"}'
```

Son gelen değeri görmek için:

- `GET http://localhost:3000/api/telemetry`

## Sonraki adım: Firebase

- ESP32 telemetrisini Firebase'e yazma (Cloud Functions/RTDB REST) ve web tarafında Firebase SDK ile canlı dinleme.
- UI tarafında `Canlı bağlantı` paneli, Firebase'den gelen `latest` dokümanını/node'unu dinleyerek aynı alanları dolduracak.

