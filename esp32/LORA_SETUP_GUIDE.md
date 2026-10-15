# ResQNet ESP32 LoRa Integration, Flashing & Security Guide

## 1. Hardware Architecture Overview
- **Victim Node (Transmitter)**: ESP32 + LoRa SX1278 (operates off-grid without cellular/internet coverage).
- **Gateway Node (Receiver)**: ESP32 + LoRa SX1278 connected to local Wi-Fi / Hotspot or plugged into PC via USB Serial COM bridge.
- **ResQNet Command Center**: Unified Node.js backend (`http://<SERVER_IP>:5000/api/lora/message`) + React Tactical Client.

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

## 3. Radio Frequency & India Regulatory Requirements
- **Frequency Band**: **433.05 MHz – 434.79 MHz** (`LORA_BAND 433E6`).
- **Module Variant**: Use the SX1278 / Ai-Thinker RA-02 (433 MHz) module.
- **Regulatory Framework**: In India, the 433 MHz band is license-exempt for low-power Short Range Devices (SRD) under Wireless Planning & Coordination (WPC) Wing rules (Gazette Notification G.S.R. 564(E)), subject to <= 10 mW (10 dBm) EIRP and duty cycle restrictions.

---

## 4. Gateway Secret Key & Rotation Procedure

The communication between the physical ESP32 gateway and the backend `/api/lora/message` endpoint is authenticated using a pre-shared cryptographic key transmitted via the `X-Gateway-Key` HTTP header.

### Generating & Rotating the Gateway Key
1. **Generate a new 32-byte cryptographic token**:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```
2. **Update Server**:
   Set the generated token as `GATEWAY_API_KEY` in `server/.env`:
   ```bash
   GATEWAY_API_KEY=<new_generated_key>
   ```
3. **Update ESP32 Gateway**:
   Option A: Copy `esp32/credentials.example.h` to `esp32/credentials.h` (which is gitignored) and set:
   ```cpp
   #define GATEWAY_API_KEY "<new_generated_key>"
   ```
   Option B: Update `const char* GATEWAY_API_KEY = "<new_generated_key>";` directly in `esp32_lora_receiver_gateway.ino`.
4. **Re-flash the ESP32 Gateway** via Arduino IDE.
5. **Restart Backend Server**:
   ```powershell
   cd server
   npm start
   ```

> [!SECURITY]
> The physical gateway key must never be committed to git, printed in browser bundles, or placed in client `.env` files. Simulation in the browser uses authenticated Admin sessions (`requireSimulationAuth`).

---

## 5. Arduino IDE Setup & Flashing
1. Open **Arduino IDE**.
2. Go to **Sketch > Include Library > Manage Libraries...** and install:
   - **`LoRa`** by Sandeep Mistry
   - **`ArduinoJson`** by Benoit Blanchon (version 6.x or 7.x)
3. Select board: **ESP32 Dev Module**.
4. **Gateway Flashing**:
   - Open `esp32/esp32_lora_receiver_gateway.ino`.
   - Update Wi-Fi credentials (`WIFI_SSID`, `WIFI_PASSWORD`).
   - Set `SERVER_URL` to your backend machine's local IP (e.g. `http://192.168.1.50:5000/api/lora/message`). Check `https://resqnet-backend-uzne.onrender.com/api/lora/status` for available IP interfaces.
   - Flash the board and open Serial Monitor at **115200 baud**.
5. **Transmitter Flashing**:
   - Open `esp32/esp32_lora_victim_sender.ino`.
   - Connect a push-button between **GPIO 4** and **GND**.
   - Flash the board.

---

## 6. End-to-End Verification Pipeline
1. **Automated Integration Checks**:
   ```powershell
   cd server
   node test_api_suite.js
   ```
2. **Physical Radio Verification**:
   - Power on the Victim Transmitter and Gateway.
   - Trigger the physical SOS button on the Victim node.
   - Confirm the Gateway Serial Monitor logs: `📡 [LORA PACKET RECEIVED!]` followed by `[HTTP] Success! Server Acknowledged (201)`.
   - Confirm the incident instantly appears in the ResQNet Tactical Web Dashboard via Socket.IO.
