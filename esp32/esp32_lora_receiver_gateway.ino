/*
  =============================================================================
  ResQNet - ESP32 LoRa Receiver Gateway to Web Application
  =============================================================================
  Description:
    This sketch runs on an ESP32 connected to a LoRa transceiver (SX1276/SX1278/SX1262).
    It listens for emergency rescue broadcasts sent by victims over LoRa radio.
    When a packet is received, it connects to local Wi-Fi and posts the victim's
    rescue message and telemetry directly to the ResQNet Command Center backend:
      POST http://<SERVER_IP>:5000/api/lora/message
    It also outputs clean JSON to the Serial monitor (115200 baud) for direct USB COM bridge!

  Required Arduino IDE Libraries:
    1. "LoRa" by Sandeep Mistry (install via Arduino Library Manager)
    2. "WiFi" & "HTTPClient" (Built-in with ESP32 board package)
    3. "ArduinoJson" by Benoit Blanchon (Version 6 or 7)
  =============================================================================
*/

#include <SPI.h>
#include <LoRa.h>
#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// -----------------------------------------------------------------------------
// 1. Wi-Fi Configuration
// -----------------------------------------------------------------------------
const char* WIFI_SSID     = "YOUR_WIFI_NAME";        // Change to your Wi-Fi SSID
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";    // Change to your Wi-Fi Password

// -----------------------------------------------------------------------------
// 2. ResQNet Server Configuration
// -----------------------------------------------------------------------------
// Replace with the IP address of your PC running the ResQNet backend (e.g. 172.16.10.217 or 192.168.1.X)
const char* SERVER_URL = "http://172.16.10.217:5000/api/lora/message";

// -----------------------------------------------------------------------------
// 3. LoRa Radio Pinout Configuration
// -----------------------------------------------------------------------------
// Standard ESP32 + SX1278/SX1276 wiring:
// (For Heltec WiFi LoRa 32 V2: SS=18, RST=14, DIO0=26)
// (For TTGO T-Beam: SS=18, RST=23, DIO0=26)
// (For Standard ESP32 DevKit + SX1278 breakout):
#define LORA_SCK   5
#define LORA_MISO  19
#define LORA_MOSI  27
#define LORA_SS    18
#define LORA_RST   14
#define LORA_DIO0  26

// Frequency: 433E6 (Asia/Europe 433 MHz), 868E6 (Europe 868 MHz), 915E6 (US 915 MHz)
#define LORA_BAND  433E6

// Indicator LED pin (blinks when emergency packet is received)
#define LED_PIN    2

// Gateway Identifier
const char* GATEWAY_ID = "ESP32_COMMAND_GATEWAY_01";

// -----------------------------------------------------------------------------
// Helper: Connect to Wi-Fi
// -----------------------------------------------------------------------------
void connectWiFi() {
  Serial.print("[WiFi] Connecting to: ");
  Serial.println(WIFI_SSID);

  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 20) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected successfully!");
    Serial.print("[WiFi] ESP32 Gateway IP: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] Warning: Wi-Fi connection timed out. Packets will still be printed to Serial.");
  }
}

// -----------------------------------------------------------------------------
// Setup
// -----------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  while (!Serial);

  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, LOW);

  Serial.println("\n==============================================");
  Serial.println("  ResQNet ESP32 LoRa Emergency Receiver Gateway");
  Serial.println("==============================================");

  // Connect to Wi-Fi
  connectWiFi();

  // Setup SPI and LoRa module
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  Serial.print("[LoRa] Initializing radio on frequency ");
  Serial.print(LORA_BAND / 1E6);
  Serial.println(" MHz...");

  if (!LoRa.begin(LORA_BAND)) {
    Serial.println("[LoRa] ERROR: LoRa transceiver init failed! Check wiring & pinout.");
    while (1) {
      digitalWrite(LED_PIN, HIGH);
      delay(200);
      digitalWrite(LED_PIN, LOW);
      delay(200);
    }
  }

  // Set LoRa parameters (Spreading Factor, Bandwidth, Sync Word)
  LoRa.setSpreadingFactor(10);           // SF7 to SF12 (SF10 gives long range)
  LoRa.setSignalBandwidth(125E3);        // 125 kHz
  LoRa.setCodingRate4(5);                // 4/5
  LoRa.setSyncWord(0x12);                // Private disaster network sync word
  LoRa.enableCrc();

  Serial.println("[LoRa] Receiver ready! Listening for victim rescue messages...\n");
}

// -----------------------------------------------------------------------------
// Forward Packet to ResQNet Web Server
// -----------------------------------------------------------------------------
void forwardToServer(String jsonPayload) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] Reconnecting Wi-Fi before transmission...");
    WiFi.reconnect();
    int timeout = 0;
    while (WiFi.status() != WL_CONNECTED && timeout < 10) {
      delay(300);
      timeout++;
    }
  }

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(SERVER_URL);
    http.addHeader("Content-Type", "application/json");

    Serial.println("[HTTP] Dispatching packet to ResQNet backend...");
    int httpResponseCode = http.POST(jsonPayload);

    if (httpResponseCode > 0) {
      String response = http.getString();
      Serial.printf("[HTTP] Success! Server Response Code: %d\n", httpResponseCode);
      Serial.println("[HTTP] Server Response: " + response);
    } else {
      Serial.printf("[HTTP] Error sending POST: %s\n", http.errorToString(httpResponseCode).c_str());
    }
    http.end();
  } else {
    Serial.println("[HTTP] Error: Wi-Fi disconnected. Unable to send HTTP request.");
  }
}

// -----------------------------------------------------------------------------
// Main Loop
// -----------------------------------------------------------------------------
void loop() {
  int packetSize = LoRa.parsePacket();

  if (packetSize) {
    // Visual flash
    digitalWrite(LED_PIN, HIGH);

    String incomingMessage = "";
    while (LoRa.available()) {
      incomingMessage += (char)LoRa.read();
    }

    int packetRssi = LoRa.packetRssi();
    float packetSnr = LoRa.packetSnr();

    Serial.println("\n----------------------------------------------");
    Serial.println("📡 [LORA PACKET RECEIVED!]");
    Serial.print("Raw Payload: ");
    Serial.println(incomingMessage);
    Serial.printf("Signal Strength: RSSI = %d dBm | SNR = %.2f dB\n", packetRssi, packetSnr);

    // Prepare JSON payload for ResQNet backend
    StaticJsonDocument<512> doc;

    // Check if incoming payload is already valid JSON
    DeserializationError error = deserializeJson(doc, incomingMessage);
    if (error) {
      // If plain text string, parse format: "SENDER;TYPE;SEV;LAT;LON;PEOPLE;MESSAGE"
      // Or default fallback
      doc["sender_id"] = "LORA_VICTIM_NODE_01";
      doc["emergency_type"] = "Flood";
      doc["severity"] = "Critical";
      doc["message"] = incomingMessage;
      doc["latitude"] = 12.8342;
      doc["longitude"] = 79.7036;
      doc["people_affected"] = 2;
    }

    // Attach gateway telemetry
    doc["rssi"] = packetRssi;
    doc["snr"] = packetSnr;
    doc["gateway_id"] = GATEWAY_ID;

    String jsonOutput;
    serializeJson(doc, jsonOutput);

    // 1. Output to Serial (for USB monitoring & serial bridge)
    Serial.println("[SERIAL OUT] " + jsonOutput);

    // 2. Post to ResQNet backend over Wi-Fi
    forwardToServer(jsonOutput);

    Serial.println("----------------------------------------------\n");

    digitalWrite(LED_PIN, LOW);
  }

  // Small delay to yield CPU
  delay(10);
}
