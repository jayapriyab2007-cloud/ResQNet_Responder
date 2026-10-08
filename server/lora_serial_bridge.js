/**
 * ResQNet ESP32 LoRa USB Serial Bridge
 * Reads incoming LoRa JSON lines from ESP32 over USB Serial Port (e.g. COM3, COM4)
 * and forwards them to the ResQNet backend on http://localhost:5000/api/lora/message
 *
 * Usage:
 *   node lora_serial_bridge.js COM3
 *   node lora_serial_bridge.js COM4 115200
 */

const http = require('http');
const { spawn } = require('child_process');

const portName = process.argv[2] || 'COM3';
const baudRate = parseInt(process.argv[3] || '115200', 10);
const targetUrl = 'http://localhost:5000/api/lora/message';

console.log('==============================================');
console.log(`📡 ResQNet ESP32 LoRa Serial Bridge`);
console.log(`Target Port: ${portName} @ ${baudRate} baud`);
console.log(`Backend URL: ${targetUrl}`);
console.log('==============================================\n');

// PowerShell script to read serial port continuously and output lines
const psScript = `
$port = New-Object System.IO.Ports.SerialPort '${portName}', ${baudRate}, None, 8, one
try {
  $port.Open()
  Write-Host "[BRIDGE_READY] Listening on ${portName}..."
  while ($port.IsOpen) {
    $line = $port.ReadLine()
    if ($line) {
      Write-Output $line
    }
  }
} catch {
  Write-Error $_.Exception.Message
} finally {
  if ($port.IsOpen) { $port.Close() }
}
`;

const ps = spawn('powershell.exe', ['-NoProfile', '-Command', psScript]);

ps.stdout.on('data', (data) => {
  const text = data.toString();
  const lines = text.split(/\r?\n/).filter(Boolean);

  for (const line of lines) {
    if (line.includes('[BRIDGE_READY]')) {
      console.log(`🟢 ${line}`);
      continue;
    }

    console.log(`📥 [ESP32 RAW]: ${line}`);

    // Try to detect JSON or LoRa packet
    let payload = null;
    if (line.trim().startsWith('{') && line.trim().endsWith('}')) {
      try {
        payload = JSON.parse(line.trim());
      } catch (e) {}
    } else if (line.includes('[SERIAL OUT]')) {
      const jsonPart = line.substring(line.indexOf('{'));
      try {
        payload = JSON.parse(jsonPart);
      } catch (e) {}
    }

    if (!payload && line.length > 5) {
      // Treat as plain text rescue message
      payload = {
        sender_id: 'ESP32_USB_SERIAL',
        message: line.trim(),
        emergency_type: 'Flood',
        severity: 'Critical'
      };
    }

    if (payload) {
      forwardToBackend(payload);
    }
  }
});

ps.stderr.on('data', (data) => {
  console.error(`⚠️ Serial Port Warning/Error: ${data.toString()}`);
});

ps.on('close', (code) => {
  console.log(`Serial bridge process exited with code ${code}`);
});

function forwardToBackend(payload) {
  const data = JSON.stringify(payload);
  const options = {
    hostname: 'localhost',
    port: 5000,
    path: '/api/lora/message',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  const req = http.request(options, (res) => {
    let body = '';
    res.on('data', (chunk) => { body += chunk; });
    res.on('end', () => {
      console.log(`🚀 Forwarded to ResQNet Backend: HTTP ${res.statusCode}`);
    });
  });

  req.on('error', (e) => {
    console.error(`❌ Error forwarding to backend: ${e.message}`);
  });

  req.write(data);
  req.end();
}
