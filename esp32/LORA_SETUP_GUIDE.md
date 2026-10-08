# ResQNet ESP32 LoRa Integration Guide

## 1. Hardware Architecture Overview
- **Victim Node (Transmitter)**: ESP32 + LoRa SX1278 (operates off-grid without internet/cellular coverage).
- **Gateway Node (Receiver)**: ESP32 + LoRa SX1278 connected to local Wi-Fi / Hotspot or plugged into PC via USB.
- **ResQNet Command Center**: Unified Node.js backend (`http://172.16.10.217:5000/api/lora/message`) + React Tactical Client.

---

## 2. Pinout Wiring Table (ESP32 to SX1278 / SX1276)
| LoRa Module Pin | ESP32 Pin | Note |
|---|---|---|
| **VCC** | 3.3V | ⚠️ Never connect to 5V (3.3V only!) |
| **GND** | GND | Ground |
| **SCK** | GPIO 5 | SPI Clock |
| **MISO** | GPIO 19 | SPI MISO |
| **MOSI** | GPIO 27 | SPI MOSI |
| **NSS / CS** | GPIO 18 | Chip Select |
| **RST** | GPIO 14 | Reset |
| **DIO0** | GPIO 26 | Interrupt line (Packet Received) |

---

## 3. Arduino IDE Setup
1. Open **Arduino IDE**.
2. Go to **Sketch > Include Library > Manage Libraries...**
3. Install the following libraries:
   - **`LoRa`** by Sandeep Mistry
   - **`ArduinoJson`** by Benoit Blanchon (version 6.x or 7.x)
4. Select board: **ESP32 Dev Module** (or your specific Heltec/TTGO board).

---

## 4. Configuring & Flashing the Gateway
1. Open `esp32/esp32_lora_receiver_gateway.ino`.
2. Update your Wi-Fi credentials:
   ```cpp
   const char* WIFI_SSID     = "Your_WiFi_Name";
   const char* WIFI_PASSWORD = "Your_WiFi_Password";
   ```
3. Verify your PC Server URL (Local IP of machine running ResQNet backend):
   ```cpp
   const char* SERVER_URL = "http://172.16.10.217:5000/api/lora/message";
   ```
4. Click **Upload**.
5. Open Serial Monitor at **115200 baud**.
6. When victim rescue packets arrive, the gateway receives them and posts them straight to ResQNet!

---

## 5. Live Testing without Hardware
You can test the entire pipeline right in the browser or via curl:
```bash
curl -X POST http://localhost:5000/api/lora/simulate -H "Content-Type: application/json" -d "{}"
```
The application will immediately flash the incoming LoRa rescue message with signal metrics (RSSI, SNR) in the Emergency Queue and Tactical Map!
