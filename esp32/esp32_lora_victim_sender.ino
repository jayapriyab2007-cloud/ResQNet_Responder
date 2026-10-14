/*
  =============================================================================
  ResQNet - ESP32 LoRa Victim Sender / Beacon Node
  =============================================================================
  Description:
    This sketch runs on a victim / field node equipped with an ESP32 and LoRa radio.
    It transmits emergency rescue messages over LoRa radio to the gateway.
    Can be triggered by a physical SOS push button (Pin 4) or automatically sends
    test emergency beacons.
    Includes bounded burst retransmissions and unique emergency_id for backend deduplication.
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

#define LORA_BAND  433E6       // Must match receiver frequency (433E6 India ISM band)
#define BUTTON_PIN 4           // Connect pushbutton between GPIO 4 and GND
#define LED_PIN    2

// Unique Node Identifier
const char* NODE_ID = "VICTIM_NODE_ALPHA_01";

unsigned long lastBroadcastTime = 0;
const unsigned long BROADCAST_INTERVAL = 30000; // Auto-beacon every 30s in test mode
uint32_t incidentCounter = 0;
String currentEmergencyId = "";

String generateEmergencyId() {
  incidentCounter++;
  return String("RQ-LORA-") + String(NODE_ID) + String("-") + String(millis(), HEX);
}

void sendEmergencyBroadcast(String customMessage = "", bool newIncident = false) {
  digitalWrite(LED_PIN, HIGH);
  Serial.println("[LoRa] Transmitting Victim Emergency Packet...");

  if (newIncident || currentEmergencyId.length() == 0) {
    currentEmergencyId = generateEmergencyId();
  }

  StaticJsonDocument<384> doc;
  doc["sender_id"] = NODE_ID;
  doc["emergency_id"] = currentEmergencyId;
  doc["emergency_type"] = "Flood";
  doc["severity"] = "Critical";
  doc["people_affected"] = 3;
  doc["message"] = customMessage.length() > 0 ? customMessage : "Water levels rising rapidly on ground floor. 3 people trapped, need evacuation!";
  // Set real coordinates or 0,0 if GPS unavailable
  doc["latitude"] = 12.8342;
  doc["longitude"] = 79.7036;
  doc["location_source"] = "LORA_GPS";
  doc["battery_level"] = 89;
  doc["hop_count"] = 0;
  doc["max_hops"] = 3;

  String packetStr;
  serializeJson(doc, packetStr);

  // Bounded transmission burst (send 2 times with 200ms spacing to improve reception probability)
  for (int b = 0; b < 2; b++) {
    LoRa.beginPacket();
    LoRa.print(packetStr);
    LoRa.endPacket();
    if (b < 1) delay(200);
  }

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
    sendEmergencyBroadcast("URGENT: Emergency SOS Button Pressed! Need immediate rescue assistance.", true);
    delay(2000); // Debounce
  }

  // Periodic emergency beacon broadcast in background
  if (millis() - lastBroadcastTime > BROADCAST_INTERVAL) {
    lastBroadcastTime = millis();
    sendEmergencyBroadcast();
  }

  delay(50);
}
