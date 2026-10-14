// Copy this file to credentials.h to override Wi-Fi and Gateway secrets locally
// credentials.h is gitignored to prevent accidental credential commits.
#pragma once

#define WIFI_SSID     "YOUR_WIFI_NAME"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"
#define SERVER_URL    "http://192.168.1.100:5000/api/lora/message"

// Must match GATEWAY_API_KEY configured in server/.env
#define GATEWAY_API_KEY "REPLACE_WITH_KEY_FROM_SERVER_ENV"
