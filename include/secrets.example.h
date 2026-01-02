#pragma once

// Wi-Fi credentials
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Base URL of the local Next.js dev server (must be reachable from the ESP32)
// Example: http://192.168.1.50:3000
#define TELEMETRY_SERVER_BASE "http://192.168.1.50:3000"

// Firebase Realtime Database (optional)
// Example: https://your-project-id-default-rtdb.firebaseio.com
// If set, telemetry will be sent to Firebase instead of the local Next.js server.
// #define FIREBASE_DB_URL "https://your-project-id-default-rtdb.firebaseio.com"
// Optional database secret (legacy) or leave empty if rules allow public write for demo.
// #define FIREBASE_DB_SECRET "YOUR_DB_SECRET"

// Optional (only needed if you set TELEMETRY_API_KEY on the web server)
// #define TELEMETRY_API_KEY "change-me"

// Optional identifier shown in the web UI / logs
#define TELEMETRY_DEVICE_ID "esp32-1"
