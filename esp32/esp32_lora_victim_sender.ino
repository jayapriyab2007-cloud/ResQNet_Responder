/*
  =============================================================================
  ResQNet - ESP32 LoRa Victim Sender / Beacon Node
  =============================================================================
  Description:
    This sketch runs on a victim / field node equipped with an ESP32 and LoRa radio.
    It transmits emergency rescue messages over LoRa radio to the gateway.
    Can be triggered by a physical SOS push button (Pin 4) or automatically sends
    test emergency beacons.
  =============================================================================
*/

#include <SPI.h>
#include <LoRa.h>
#include <ArduinoJson.h>

#define LORA_SCK   5
#define LORA_MISO  19
#define LORA_MOSI  27
#define LORA_SS    18
#define LORA_RST   14
#define LORA_DIO0  26

#define LORA_BAND  433E6       // Must match receiver frequency (433E6, 868E6, or 915E6)
#define BUTTON_PIN 4           // Connect pushbutton between GPIO 4 and GND
#define LED_PIN    2

// Unique Node Identifier
const char* NODE_ID = "VICTIM_NODE_ALPHA_01";

unsigned long lastBroadcastTime = 0;
const unsigned long BROADCAST_INTERVAL = 15000; // Auto-beacon every 15s if no button

void sendEmergencyBroadcast(String customMessage = "") {
  digitalWrite(LED_PIN, HIGH);
  Serial.println("[LoRa] Transmitting Victim Emergency Packet...");

  StaticJsonDocument<256> doc;
  doc["sender_id"] = NODE_ID;
  doc["emergency_type"] = "Flood";
  doc["severity"] = "Critical";
  doc["people_affected"] = 3;
  doc["message"] = customMessage.length() > 0 ? customMessage : "Water levels rising rapidly on ground floor. 3 people trapped, need boat rescue!";
  doc["latitude"] = 12.8342;
  doc["longitude"] = 79.7036;
  doc["battery_level"] = 89;

  String packetStr;
  serializeJson(doc, packetStr);

  LoRa.beginPacket();
  LoRa.print(packetStr);
  LoRa.endPacket();

  Serial.println("[LoRa] Sent Packet: " + packetStr);
  digitalWrite(LED_PIN, LOW);
}

void setup() {
  Serial.begin(115200);
  while (!Serial);

  pinMode(BUTTON_PIN, INPUT_PULLUP);
  pinMode(LED_PIN, OUTPUT);

  Serial.println("\n--- ResQNet LoRa Victim Sender Node ---");

  SPI.begin(LORA_SCK, LORA_MISO, LORA_MOSI, LORA_SS);
  LoRa.setPins(LORA_SS, LORA_RST, LORA_DIO0);

  if (!LoRa.begin(LORA_BAND)) {
    Serial.println("[LoRa] Radio init failed! Check wiring.");
    while (1);
  }

  LoRa.setSpreadingFactor(10);
  LoRa.setSignalBandwidth(125E3);
  LoRa.setCodingRate4(5);
  LoRa.setSyncWord(0x12);
  LoRa.enableCrc();

  Serial.println("[LoRa] Transmitter ready. Press GPIO 4 button to send SOS broadcast!");
}

void loop() {
  // Check if physical SOS push button pressed (Active LOW with pullup)
  if (digitalRead(BUTTON_PIN) == LOW) {
    Serial.println("[SOS] Physical Emergency Button Pressed!");
    sendEmergencyBroadcast("URGENT: Emergency Button Activated! Need immediate rescue assistance.");
    delay(2000); // Debounce
  }

  // Periodic emergency beacon broadcast
  if (millis() - lastBroadcastTime > BROADCAST_INTERVAL) {
    lastBroadcastTime = millis();
    sendEmergencyBroadcast();
  }

  delay(50);
}
