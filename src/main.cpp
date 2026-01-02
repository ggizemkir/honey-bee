#include <Arduino.h>
#include <arduinoFFT.h>
#include <HTTPClient.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <math.h>
#include "driver/i2s.h"

#if __has_include("secrets.h")
#include "secrets.h"
#else
#error "Missing include/secrets.h. Copy include/secrets.example.h to include/secrets.h and set WIFI_SSID/WIFI_PASSWORD/TELEMETRY_SERVER_BASE."
#endif

#ifndef TELEMETRY_API_KEY
#define TELEMETRY_API_KEY ""
#endif

#ifndef TELEMETRY_DEVICE_ID
#define TELEMETRY_DEVICE_ID "esp32-1"
#endif

#ifndef FIREBASE_DB_URL
#define FIREBASE_DB_URL ""
#endif

#ifndef FIREBASE_DB_SECRET
#define FIREBASE_DB_SECRET ""
#endif

const double samplingFrequency = 10000;
const uint16_t samples = 1024;
double vReal[samples];
double vImag[samples];

const i2s_port_t I2S_PORT = I2S_NUM_0;
const int I2S_SCK_PIN = 33;  // INMP441 SCK
const int I2S_WS_PIN = 25;   // INMP441 WS
const int I2S_SD_PIN = 32;   // INMP441 SD

ArduinoFFT<double> FFT = ArduinoFFT<double>(vReal, vImag, samples, samplingFrequency);

const double DETECT_MIN_FREQ = 100.0;
const double DETECT_MAX_FREQ = 1000.0;
const double HONEY_BEE_MIN_FREQ = 200.0;
const double HONEY_BEE_MAX_FREQ = 300.0;

const double SIGNAL_FULL_SCALE_24BIT = 8388608.0; // 2^23
const double AMPLITUDE_DB_FLOOR = -60.0; // dBFS -> 0% at -60 dBFS
const double MIN_CONFIDENCE_THRESHOLD = 3.0; // 0-100 confidence percent

const unsigned long TELEMETRY_POST_INTERVAL_MS = 1000;
unsigned long lastTelemetryPostMs = 0;

WiFiClientSecure firebaseClient;
bool firebaseClientReady = false;

enum DetectionCode {
    DETECTION_BELIRSIZ = 0,
    DETECTION_BAL = 1,
    DETECTION_ESEK = 2
};

double lastAmplitudePercent = 0.0;
unsigned long lastWifiAttemptMs = 0;
bool wifiWasConnected = false;

struct TelemetryResult {
    double peakFrequencyHz;
    double maxAmplitude;
    double amplitudePercent;
    double confidencePercent;
    DetectionCode detection;
};

const char* detection_code_to_string(DetectionCode code) {
    switch (code) {
        case DETECTION_BAL:
            return "bal";
        case DETECTION_ESEK:
            return "esek";
        case DETECTION_BELIRSIZ:
        default:
            return "belirsiz";
    }
}

double sanitize_number(double value) {
    if (isnan(value) || isinf(value)) {
        return 0.0;
    }
    return value;
}

bool is_https_url(const char* url) {
    return (url != nullptr) && (strncmp(url, "https://", 8) == 0);
}

String trim_trailing_slash(const String& value) {
    if (value.endsWith("/")) {
        return value.substring(0, value.length() - 1);
    }
    return value;
}

void connect_wifi() {
    WiFi.mode(WIFI_STA);
    WiFi.setSleep(false);

    Serial.print("Wi-Fi baglaniyor: ");
    Serial.println(WIFI_SSID);

    lastWifiAttemptMs = millis();
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void ensure_wifi_connected() {
    if (WiFi.status() == WL_CONNECTED) {
        if (!wifiWasConnected) {
            wifiWasConnected = true;
            Serial.print("Wi-Fi baglandi, IP: ");
            Serial.println(WiFi.localIP());
            if (FIREBASE_DB_URL[0] != '\0') {
                Serial.print("Firebase hedefi: ");
                Serial.print(FIREBASE_DB_URL);
                Serial.println("/telemetry/latest.json");
            } else {
                Serial.print("Telemetry hedefi: ");
                Serial.print(TELEMETRY_SERVER_BASE);
                Serial.println("/api/telemetry");
            }
        }
        return;
    }

    if (wifiWasConnected) {
        wifiWasConnected = false;
        Serial.println("Wi-Fi baglantisi koptu. Yeniden baglaniyor...");
    }

    const unsigned long nowMs = millis();
    if (lastWifiAttemptMs != 0 && nowMs - lastWifiAttemptMs < 5000) {
        return;
    }

    lastWifiAttemptMs = nowMs;
    Serial.print("Wi-Fi yeniden baglaniyor: ");
    Serial.println(WIFI_SSID);
    WiFi.disconnect(false);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
}

void setup_i2s() {
    i2s_config_t config = {
        .mode = (i2s_mode_t)(I2S_MODE_MASTER | I2S_MODE_RX),
        .sample_rate = (int)samplingFrequency,
        .bits_per_sample = I2S_BITS_PER_SAMPLE_32BIT,
        .channel_format = I2S_CHANNEL_FMT_RIGHT_LEFT,
        .communication_format = I2S_COMM_FORMAT_I2S,
        .intr_alloc_flags = ESP_INTR_FLAG_LEVEL1,
        .dma_buf_count = 4,
        .dma_buf_len = 256,
        .use_apll = false,
        .tx_desc_auto_clear = false,
        .fixed_mclk = 0
    };

    i2s_pin_config_t pins = {
        .bck_io_num = I2S_SCK_PIN,
        .ws_io_num = I2S_WS_PIN,
        .data_out_num = -1,
        .data_in_num = I2S_SD_PIN
    };

    i2s_driver_install(I2S_PORT, &config, 0, NULL);
    i2s_set_pin(I2S_PORT, &pins);
    i2s_zero_dma_buffer(I2S_PORT);
}

void read_i2s_samples() {
    static int32_t i2s_samples[samples * 2];
    size_t bytes_read = 0;

    esp_err_t err = i2s_read(I2S_PORT, i2s_samples, sizeof(i2s_samples), &bytes_read, portMAX_DELAY);
    int words_read = bytes_read / sizeof(int32_t);

    if (err != ESP_OK || words_read <= 0) {
        for (int i = 0; i < samples; i++) {
            vReal[i] = 0;
            vImag[i] = 0;
        }
        static unsigned long lastDiagMs = 0;
        if (millis() - lastDiagMs >= 3000) {
            Serial.print("I2S okuma hatasi/0 veri. err=");
            Serial.print((int)err);
            Serial.print(" bytes=");
            Serial.println((int)bytes_read);
            Serial.println("Kontrol: INMP441 VDD=3.3V, GND, SCK/WS/SD pinleri ve L/R pini (GND=Left, VDD=Right).");
            lastDiagMs = millis();
        }
        return;
    }

    double energy0 = 0;
    double energy1 = 0;

    for (int i = 0; i < samples; i++) {
        int idx = i * 2;
        int32_t raw0 = (idx < words_read) ? i2s_samples[idx] : 0;
        int32_t raw1 = (idx + 1 < words_read) ? i2s_samples[idx + 1] : 0;

        int32_t s0 = raw0 >> 8;
        int32_t s1 = raw1 >> 8;

        int32_t a0 = (s0 >= 0) ? s0 : -s0;
        int32_t a1 = (s1 >= 0) ? s1 : -s1;

        energy0 += (double)a0;
        energy1 += (double)a1;
    }

    if (energy0 == 0 && energy1 == 0) {
        static unsigned long lastDiagMs = 0;
        if (millis() - lastDiagMs >= 3000) {
            Serial.println("I2S verisi 0 geliyor (mikrofon/pin/LR baglantisini kontrol et).");
            Serial.println("INMP441: VDD=3.3V, GND, SCK->GPIO33, WS->GPIO25, SD->GPIO32, L/R: GND=Left veya 3.3V=Right.");
            lastDiagMs = millis();
        }
    }

    int channel = (energy1 > energy0) ? 1 : 0;

    double sum = 0;
    for (int i = 0; i < samples; i++) {
        int idx = i * 2 + channel;
        int32_t raw = (idx < words_read) ? i2s_samples[idx] : 0;
        int32_t sample = raw >> 8;
        vReal[i] = (double)sample;
        vImag[i] = 0;
        sum += vReal[i];
    }

    // DC offset removal + amplitude estimate (RMS -> dBFS -> 0-100%)
    const double mean = sum / (double)samples;
    double sumSq = 0;
    for (int i = 0; i < samples; i++) {
        vReal[i] -= mean;
        sumSq += vReal[i] * vReal[i];
    }

    const double rms = sqrt(sumSq / (double)samples);
    const double normalized = rms / SIGNAL_FULL_SCALE_24BIT;
    const double dbfs = normalized > 0 ? (20.0 * log10(normalized)) : -120.0;
    const double percent = ((dbfs - AMPLITUDE_DB_FLOOR) / (0.0 - AMPLITUDE_DB_FLOOR)) * 100.0;
    lastAmplitudePercent = percent < 0 ? 0 : (percent > 100 ? 100 : percent);
}

TelemetryResult analyze_fft_results() {
    TelemetryResult result;
    result.peakFrequencyHz = 0;
    result.maxAmplitude = 0;
    result.amplitudePercent = 0;
    result.confidencePercent = 0;
    result.detection = DETECTION_BELIRSIZ;

    result.amplitudePercent = lastAmplitudePercent;

    FFT.windowing(FFT_WIN_TYP_HAMMING, FFT_FORWARD);
    FFT.compute(FFT_FORWARD);
    FFT.complexToMagnitude();

    uint16_t startBin = (uint16_t)ceil((DETECT_MIN_FREQ * (double)samples) / samplingFrequency);
    uint16_t endBin = (uint16_t)floor((DETECT_MAX_FREQ * (double)samples) / samplingFrequency);
    if (startBin < 2) startBin = 2;
    if (endBin >= samples / 2) endBin = (samples / 2) - 1;

    double maxAmplitude = 0;
    double sumAmplitude = 0;
    uint16_t peakBin = startBin;
    for (uint16_t i = startBin; i <= endBin; i++) {
        const double amp = vReal[i];
        sumAmplitude += amp;
        if (amp > maxAmplitude) {
            maxAmplitude = amp;
            peakBin = i;
        }
    }

    const double avgAmplitude = sumAmplitude / (double)(endBin - startBin + 1);
    double peakFrequency = ((double)peakBin * samplingFrequency) / (double)samples;

    if (peakBin > startBin && peakBin < endBin) {
        const double y0 = vReal[peakBin - 1];
        const double y1 = vReal[peakBin];
        const double y2 = vReal[peakBin + 1];
        const double denom = (y0 - 2.0 * y1 + y2);
        if (denom != 0) {
            double delta = 0.5 * (y0 - y2) / denom;
            if (delta > 0.5) delta = 0.5;
            if (delta < -0.5) delta = -0.5;
            peakFrequency = ((double)peakBin + delta) * samplingFrequency / (double)samples;
        }
    }

    result.peakFrequencyHz = peakFrequency;
    result.maxAmplitude = maxAmplitude;

    const double dominance = avgAmplitude > 0 ? (maxAmplitude / avgAmplitude) : 0;
    double tonePercent = 0;
    if (dominance > 1) {
        const double log2Dominance = log(dominance) / log(2.0);
        tonePercent = (log2Dominance / 6.0) * 100.0; // 64x dominant => 100%
    }
    if (tonePercent < 0) tonePercent = 0;
    if (tonePercent > 100) tonePercent = 100;

    double confidencePercent = (result.amplitudePercent * tonePercent) / 100.0;
    if (confidencePercent < 0) confidencePercent = 0;
    if (confidencePercent > 100) confidencePercent = 100;
    result.confidencePercent = confidencePercent;

    Serial.print("Baskin frekans: ");
    Serial.print(peakFrequency, 2);
    Serial.print(" Hz, genlik: ");
    Serial.print(maxAmplitude, 2);
    Serial.print(", guven: ");
    Serial.print(result.confidencePercent, 1);
    Serial.print("%, ses: ");
    Serial.print(result.amplitudePercent, 1);
    Serial.println("%");

    if (result.confidencePercent < MIN_CONFIDENCE_THRESHOLD) {
        Serial.println("Sinyal zayif, tespit yok.");
        return result;
    }

    if (peakFrequency >= HONEY_BEE_MIN_FREQ && peakFrequency <= HONEY_BEE_MAX_FREQ) {
        Serial.println("Bal arisi tespit edildi.");
        result.detection = DETECTION_BAL;
    } else if (peakFrequency > HONEY_BEE_MAX_FREQ) {
        Serial.println("Essek arisi tespit edildi.");
        result.detection = DETECTION_ESEK;
    } else {
        Serial.println("Bal arisi alti frekans (belirsiz).");
    }

    return result;
}

void post_telemetry(const TelemetryResult& telemetry) {
    if (WiFi.status() != WL_CONNECTED) {
        return;
    }

    HTTPClient http;
    const bool useFirebase = FIREBASE_DB_URL[0] != '\0';
    String url;
    if (useFirebase) {
        if (!is_https_url(FIREBASE_DB_URL)) {
            Serial.println("Firebase URL HTTPS olmali (https://...).");
            return;
        }
        const String baseUrl = trim_trailing_slash(String(FIREBASE_DB_URL));
        url = baseUrl + "/telemetry/latest.json";
        if (FIREBASE_DB_SECRET[0] != '\0') {
            url += "?auth=";
            url += FIREBASE_DB_SECRET;
        }
        if (!firebaseClientReady) {
            firebaseClient.setInsecure();
            firebaseClientReady = true;
        }
        http.begin(firebaseClient, url);
    } else {
        url = String(TELEMETRY_SERVER_BASE) + "/api/telemetry";
        http.begin(url);
    }
    http.addHeader("Content-Type", "application/json");

    if (TELEMETRY_API_KEY[0] != '\0') {
        http.addHeader("x-api-key", TELEMETRY_API_KEY);
    }

    const double safePeak = sanitize_number(telemetry.peakFrequencyHz);
    const double safeAmplitude = sanitize_number(telemetry.amplitudePercent);
    const double safeConfidence = sanitize_number(telemetry.confidencePercent);

    String payload;
    payload.reserve(256);
    payload += "{\"deviceId\":\"";
    payload += TELEMETRY_DEVICE_ID;
    payload += "\",\"peakFrequencyHz\":";
    payload += String(safePeak, 2);
    payload += ",\"amplitudePercent\":";
    payload += String(safeAmplitude, 1);
    payload += ",\"confidencePercent\":";
    payload += String(safeConfidence, 1);
    payload += ",\"detection\":\"";
    payload += detection_code_to_string(telemetry.detection);
    payload += "\",\"ts\":";
    payload += String((unsigned long)millis());
    payload += "}";

    int status = useFirebase ? http.PUT(payload) : http.POST(payload);
    Serial.print(useFirebase ? "PUT firebase => " : "POST /api/telemetry => ");
    Serial.print(status);
    if (status < 0) {
        Serial.print(" (");
        Serial.print(http.errorToString(status));
        Serial.print(")");
    }
    Serial.println();
    if (status >= 400) {
        String body = http.getString();
        Serial.print("Firebase hata: ");
        Serial.println(body);
    }
    http.end();
}

void setup() {
    Serial.begin(115200);
    setup_i2s();

    connect_wifi();
    Serial.println("--- Arilik Ses Tespit Sistemi Baslatildi ---");
}

void loop() {
    ensure_wifi_connected();

    read_i2s_samples();
    TelemetryResult telemetry = analyze_fft_results();

    const unsigned long nowMs = millis();
    if (lastTelemetryPostMs == 0 || nowMs - lastTelemetryPostMs >= TELEMETRY_POST_INTERVAL_MS) {
        post_telemetry(telemetry);
        lastTelemetryPostMs = nowMs;
    }
    delay(500);
}
