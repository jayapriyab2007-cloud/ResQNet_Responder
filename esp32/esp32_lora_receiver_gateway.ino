+/*
  =============================================================================
  ResQNet - ESP32 LoRa Receiver Gateway to Web Application
  =============================================================================
  Description:
    This sketch runs on an ESP32 connected to a LoRa transceiver (SX1276/SX1278/SX1262).
    It listens for emergency rescue broadcasts sent by victims over LoRa radio.
    When a packet is received, it connects to local Wi-Fi and posts the victim's
    rescue message and telemetry directly to the ResQNet Command Center backend:
      POST http://<SERVER_IP>:5000/api/lora/message
    Secured with the pre-shared X-Gateway-Key header matching the backend server.
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
#include <WiFiClientSecure.h>
#include <ArduinoJson.h>

// -----------------------------------------------------------------------------
// 1. Wi-Fi Configuration
// -----------------------------------------------------------------------------
const char* WIFI_SSID     = "YOUR_WIFI_NAME";        // Change to your Wi-Fi SSID
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";    // Change to your Wi-Fi Password

// -----------------------------------------------------------------------------
// 2. ResQNet Server Configuration & Authentication
// -----------------------------------------------------------------------------
// Replace with the IP address of your PC running the ResQNet backend (e.g. 192.168.1.X or 172.16.X.X)
const char* SERVER_URL = "https://resqnet-backend-uzne.onrender.com/api/lora/message";
// Pre-shared Gateway API key matching GATEWAY_API_KEY in server/.env
const char* GATEWAY_API_KEY = "63d2305c367ffc3113ff312f143500b164ce54656705c922a29cd4726ae54120";

// Gateway Identifier
const char* GATEWAY_ID = "ESP32_COMMAND_GATEWAY_01";

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

// Frequency: 433E6 (Asia/India 433 MHz ISM band), 868E6 (EU), 915E6 (US)
#define LORA_BAND  433E6

// Indicator LED pin (blinks when emergency packet is received)
#define LED_PIN    2

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
    Serial.println("\n[WiFi] Warning: Wi-Fi connection timed out. Packets will still be output via USB Serial.");
  }
}

// -----------------------------------------------------------------------------
// Forward Packet to ResQNet Web Server (Bounded Retries & Ack Verification)
// -----------------------------------------------------------------------------
void forwardToServer(String jsonPayload) {
  const int MAX_RETRIES = 3;
  bool acknowledged = false;

  for (int attempt = 1;
       attempt <= MAX_RETRIES && !acknowledged;
       attempt++) {

    // 1. Ensure Wi-Fi is connected
    if (WiFi.status() != WL_CONNECTED) {
      Serial.printf(
        "[WiFi] Reconnecting (attempt %d/%d)...\n",
        attempt,
        MAX_RETRIES
      );

      WiFi.reconnect();

      int timeout = 0;

      while (WiFi.status() != WL_CONNECTED && timeout < 25) {
        delay(200);
        timeout++;
      }
    }

    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[WiFi] Connection unavailable.");
    } else {
      // 2. Establish a certificate-validated HTTPS connection
      WiFiClientSecure secureClient;
      secureClient.setCACert(rootCACertificate);

      HTTPClient http;
      http.setTimeout(10000);

      if (!http.begin(secureClient, SERVER_URL)) {
        Serial.println("[HTTPS] Failed to initialize connection.");
      } else {
        // 3. Set request headers
        http.addHeader("Content-Type", "application/json");
        http.addHeader("X-Gateway-Key", GATEWAY_API_KEY);

        Serial.printf(
          "[HTTPS] Sending emergency packet (attempt %d/%d)...\n",
          attempt,
          MAX_RETRIES
        );

        // 4. Send the emergency payload
        int httpResponseCode = http.POST(jsonPayload);

        // 5. Process the backend acknowledgement
        if (httpResponseCode == 200 ||
            httpResponseCode == 201) {

          String response = http.getString();

          Serial.printf(
            "[HTTPS] Backend responded with HTTP %d.\n",
            httpResponseCode
          );

          Serial.print("[HTTPS] Response: ");
          Serial.println(response);

          acknowledged = true;

        } else if (httpResponseCode > 0) {
          Serial.printf(
            "[HTTPS] HTTP error %d: %s\n",
            httpResponseCode,
            http.getString().c_str()
          );

        } else {
          Serial.printf(
            "[HTTPS] Transport error: %s\n",
            http.errorToString(httpResponseCode).c_str()
          );
        }

        http.end();
      }
    }

    // 6. Bounded exponential-style backoff
    if (!acknowledged && attempt < MAX_RETRIES) {
      unsigned long waitMs = 1000UL * attempt;

      Serial.printf(
        "[HTTPS] Retrying in %lu ms...\n",
        waitMs
      );

      delay(waitMs);
    }
  }

  // 7. Report final delivery status
  if (acknowledged) {
    Serial.println(
      "[HTTPS] Emergency packet acknowledged by ResQNet backend."
    );
  } else {
    Serial.println(
      "[HTTPS] Delivery failed after all retries."
    );
    Serial.println(
      "[HTTPS] Preserve the packet for retry or manual recovery."
    );
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

  // Connect to local Wi-Fi network
  connectWiFi();

  // Setup SPI and LoRa module
  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  Serial.print("[LoRa] Initializing radio on frequency ");
  Serial.print(LORA_BAND / 1E6);
  Serial.println(" MHz (India 433 MHz ISM)...");

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
  LoRa.setSpreadingFactor(10);           // SF10 gives long range in dense environments
  LoRa.setSignalBandwidth(125E3);        // 125 kHz
  LoRa.setCodingRate4(5);                // 4/5 forward error correction
  LoRa.setSyncWord(0x12);                // Private disaster network sync word
  LoRa.enableCrc();

  Serial.println("[LoRa] Receiver ready! Listening for victim rescue messages...\n");
}

// -----------------------------------------------------------------------------
// Main Loop
// -----------------------------------------------------------------------------
void loop() {
  int packetSize = LoRa.parsePacket();

  if (packetSize) {
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
      // Parse delimiter-separated format: "SENDER;TYPE;SEV;LAT;LON;PEOPLE;MESSAGE;ID;HOPS"
      int partIndex = 0;
      String parts[9];
      int startIdx = 0;
      for (int i = 0; i < incomingMessage.length(); i++) {
        char c = incomingMessage.charAt(i);
        if (c == ';' || c == '|' || c == ',') {
          if (partIndex < 9) {
            parts[partIndex++] = incomingMessage.substring(startIdx, i);
            startIdx = i + 1;
          }
        }
      }
      if (startIdx < incomingMessage.length() && partIndex < 9) {
        parts[partIndex++] = incomingMessage.substring(startIdx);
      }

      doc["sender_id"] = parts[0].length() > 0 ? parts[0] : "LORA_VICTIM_NODE_01";
      doc["emergency_type"] = parts[1].length() > 0 ? parts[1] : "Flood";
      doc["severity"] = parts[2].length() > 0 ? parts[2] : "Critical";

      float lat = parts[3].length() > 0 ? parts[3].toFloat() : 0.0;
      float lng = parts[4].length() > 0 ? parts[4].toFloat() : 0.0;
      if (lat != 0.0 && lng != 0.0) {
        doc["latitude"] = lat;
        doc["longitude"] = lng;
        doc["location_source"] = "LORA_GPS";
      } else {
        doc["latitude"] = 0;
        doc["longitude"] = 0;
        doc["location_source"] = "LORA_UNKNOWN";
      }

      doc["people_affected"] = parts[5].length() > 0 ? parts[5].toInt() : 1;
      doc["message"] = parts[6].length() > 0 ? parts[6] : incomingMessage;
      if (parts[7].length() > 0) {
        doc["emergency_id"] = parts[7];
      }
      doc["hop_count"] = parts[8].length() > 0 ? parts[8].toInt() : 0;
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

  delay(10);
}
