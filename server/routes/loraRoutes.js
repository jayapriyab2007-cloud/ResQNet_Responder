const express = require('express');
const router = express.Router();
const os = require('os');

const Emergency = require('../models/Emergency');
const AuditLog = require('../models/AuditLog');
const Notification = require('../models/Notification');
const socketService = require('../services/socketService');
const { getAssignedTeam, calculatePriority } = require('../utils/routing');
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../middleware/auth');

// ============================================================================
// Gateway Authentication Middleware
// Validates ESP32 devices using a pre-shared API key sent as X-Gateway-Key header
// ============================================================================
const GATEWAY_API_KEY = process.env.GATEWAY_API_KEY;

function requireGatewayAuth(req, res, next) {
  // Only enforce auth if a key is configured (dev mode: skip if key not set)
  if (!GATEWAY_API_KEY || GATEWAY_API_KEY.trim() === '') {
    console.warn('[LoRa] GATEWAY_API_KEY not configured — gateway auth is DISABLED. Set GATEWAY_API_KEY in .env for production.');
    return next();
  }
  const providedKey = req.headers['x-gateway-key'];
  if (!providedKey || providedKey !== GATEWAY_API_KEY) {
    console.warn(`[LoRa] Unauthorized gateway request from ${req.ip}`);
    return res.status(401).json({ success: false, message: 'Unauthorized: Invalid or missing gateway API key' });
  }
  next();
}

/**
 * Simulation Authentication Middleware
 * Allows authenticated browser sessions (requiring Admin in production) OR valid gateway key
 * Keeps physical gateway credentials off frontend client bundles
 */
function requireSimulationAuth(req, res, next) {
  // Option 1: Valid physical gateway key provided by test runner
  const providedKey = req.headers['x-gateway-key'];
  if (GATEWAY_API_KEY && providedKey && providedKey === GATEWAY_API_KEY) {
    return next();
  }

  // Option 2: Authenticated user session via JWT Bearer token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: LoRa simulation requires an authenticated user session or gateway key'
    });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;

    // Restrict synthetic incident simulation strictly to authenticated Administrators in all environments
    if (req.user.role !== 'ADMIN') {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: LoRa simulation requires Administrator privileges'
      });
    }

    return next();
  } catch (err) {
    return res.status(401).json({
      success: false,
      message: 'Unauthorized: Invalid or expired authentication token'
    });
  }
}

// Track gateway stats in-memory (resets on server restart)
const gatewayStats = {
  packetsReceived: 0,
  lastPacketAt: null,
  lastNodeId: null,
  activeNodes: new Set()
};

// In-memory deduplication window (emergency_id → received_at)
const recentLoraIds = new Map();
const DEDUP_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

function isDuplicate(emergencyId) {
  if (!emergencyId) return false;
  const seen = recentLoraIds.get(emergencyId);
  if (seen && Date.now() - seen < DEDUP_WINDOW_MS) return true;
  recentLoraIds.set(emergencyId, Date.now());
  // Cleanup old entries
  if (recentLoraIds.size > 500) {
    const cutoff = Date.now() - DEDUP_WINDOW_MS;
    for (const [k, v] of recentLoraIds) {
      if (v < cutoff) recentLoraIds.delete(k);
    }
  }
  return false;
}

/**
 * Helper to get local IPv4 addresses for ESP32 configuration guidance
 */
function getLocalIpAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const ifaceName of Object.keys(interfaces)) {
    for (const iface of interfaces[ifaceName]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push({ interface: ifaceName, ip: iface.address });
      }
    }
  }
  return addresses;
}

/**
 * Generate unique LoRa emergency ID
 */
function generateLoraId(nodeId) {
  const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const randomHex = Math.random().toString(36).substring(2, 7).toUpperCase();
  const nodeShort = (nodeId || 'NODE').toString().replace(/[^A-Z0-9]/gi, '').substring(0, 6).toUpperCase();
  return `RQ-LORA-${dateStr}-${nodeShort}-${randomHex}`;
}

/**
 * Parse a LoRa payload (JSON or delimiter-separated)
 */
function parseLoraPayload(rawBody) {
  if (typeof rawBody === 'object' && rawBody !== null) return rawBody;
  if (typeof rawBody === 'string') {
    try {
      return JSON.parse(rawBody);
    } catch (e) {
      // Delimiter-formatted: "NODE_01;Flood;Critical;12.8342;79.7036;2;Trapped;RSSI=-80"
      const parts = rawBody.split(/;|\||,/);
      return {
        sender_id: parts[0] || 'LORA-NODE',
        emergency_type: parts[1] || 'Flood',
        severity: parts[2] || 'Critical',
        latitude: parseFloat(parts[3]),
        longitude: parseFloat(parts[4]),
        people_affected: parseInt(parts[5], 10) || 1,
        message: parts[6] || 'SOS rescue broadcast received over LoRa radio',
        rssi: parts[7] ? parseFloat(parts[7].replace(/[^-\d.]/g, '')) : undefined
      };
    }
  }
  return {};
}

/**
 * Validate and extract coordinate data from LoRa payload.
 * IMPORTANT: Never substitute gateway coordinates for victim coordinates.
 * If GPS is not available on the victim node, location is explicitly marked unknown.
 */
function extractCoordinates(payload) {
  const lat = parseFloat(payload.latitude ?? payload.lat);
  const lon = parseFloat(payload.longitude ?? payload.lng ?? payload.lon);

  // Valid coordinate check: must be finite numbers, not NaN, not 0.0/0.0 (null island)
  const isValidLat = Number.isFinite(lat) && lat >= -90 && lat <= 90;
  const isValidLon = Number.isFinite(lon) && lon >= -180 && lon <= 180;
  const isNullIsland = lat === 0 && lon === 0;

  if (isValidLat && isValidLon && !isNullIsland) {
    return {
      latitude: lat,
      longitude: lon,
      location_source: 'LORA_GPS',
      location_available: true
    };
  }

  // No valid GPS from victim node — mark as unknown
  // DO NOT substitute gateway or hardcoded coordinates
  return {
    latitude: null,
    longitude: null,
    location_source: 'LORA_UNKNOWN',
    location_available: false
  };
}

/**
 * Core LoRa message processing function (called by /message and /simulate)
 */
async function processLoraPacket(payload, res) {
  const sender_id = (payload.sender_id || payload.node_id || payload.nodeId || 'LORA_NODE_' + Math.floor(100 + Math.random() * 900)).toString().trim();
  const message = (payload.message || payload.msg || payload.text || 'Emergency SOS received via ESP32 LoRa radio').toString().trim();
  const emergency_type = (payload.emergency_type || payload.type || 'Flood').toString().trim();
  const severity = (payload.severity || payload.sev || 'Critical').toString().trim();
  const people_affected = Math.max(1, parseInt(payload.people_affected || payload.people || 1, 10));

  // Extract and validate coordinates — never substitute fake GPS
  const { latitude, longitude, location_source, location_available } = extractCoordinates(payload);

  const rssi = typeof payload.rssi === 'number' ? payload.rssi : (payload.rssi ? parseFloat(payload.rssi) : -75);
  const snr = typeof payload.snr === 'number' ? payload.snr : (payload.snr ? parseFloat(payload.snr) : 9.0);
  const battery_level = payload.battery_level || payload.battery || null;
  const frequency = payload.frequency || '433.0 MHz';
  const incoming_emergency_id = payload.emergency_id || null;

  // Deduplication: check for same packet retransmission within 5 minutes
  if (incoming_emergency_id && isDuplicate(incoming_emergency_id)) {
    console.log(`[LoRa] Duplicate packet suppressed: ${incoming_emergency_id}`);
    const existing = await Emergency.findOne({ emergency_id: incoming_emergency_id });
    return res.status(200).json({
      success: true,
      duplicate: true,
      message: 'Duplicate LoRa packet suppressed',
      emergency_id: incoming_emergency_id,
      emergency: existing
    });
  }

  // Also check MongoDB for persisted duplicate
  if (incoming_emergency_id) {
    const persisted = await Emergency.findOne({ emergency_id: incoming_emergency_id });
    if (persisted) {
      recentLoraIds.set(incoming_emergency_id, Date.now());
      console.log(`[LoRa] Already persisted packet: ${incoming_emergency_id}`);
      return res.status(200).json({
        success: true,
        duplicate: true,
        message: 'LoRa packet already recorded',
        emergency_id: incoming_emergency_id,
        emergency: persisted
      });
    }
  }

  // Update gateway telemetry stats
  gatewayStats.packetsReceived += 1;
  gatewayStats.lastPacketAt = new Date();
  gatewayStats.lastNodeId = sender_id;
  gatewayStats.activeNodes.add(sender_id);

  const emergency_id = incoming_emergency_id || generateLoraId(sender_id);
  const priority = calculatePriority(severity);
  const assignedTeam = getAssignedTeam(emergency_type);

  // Build emergency record
  // If GPS unavailable, latitude/longitude remain null
  const emergencyData = {
    emergency_id,
    user_id: sender_id,
    emergency_type,
    severity,
    priority,
    people_affected,
    message,
    location_source,
    source: 'LORA',
    assigned_team: assignedTeam,
    status: 'SOS_CREATED',
    assigned_responders: [],
    lora_metadata: {
      rssi,
      snr,
      node_id: sender_id,
      battery_level: battery_level ? Number(battery_level) : null,
      frequency,
      gateway_id: payload.gateway_id || 'ESP32_COMMAND_GATEWAY',
      raw_packet: typeof payload === 'object' ? JSON.stringify(payload).substring(0, 500) : String(payload).substring(0, 500),
      received_at: new Date()
    }
  };

  // Only set coordinates if they are valid — avoids storing null=0 in some drivers
  if (location_available && latitude !== null && longitude !== null) {
    emergencyData.latitude = latitude;
    emergencyData.longitude = longitude;
  } else {
    // Use 0,0 as a sentinel but explicitly flag location_source = LORA_UNKNOWN
    // This is needed because the Emergency schema requires latitude/longitude
    // The Admin UI must check location_source to know this is not a real location
    emergencyData.latitude = 0;
    emergencyData.longitude = 0;
  }

  const newEmergency = new Emergency(emergencyData);
  await newEmergency.save();

  if (incoming_emergency_id) {
    recentLoraIds.set(incoming_emergency_id, Date.now());
  }

  // Broadcast in real-time to all connected Admin & Responder terminals
  socketService.broadcastNewEmergency(newEmergency);

  // Create system notification
  const locationNote = location_available
    ? `Coordinates: ${latitude.toFixed(4)}, ${longitude.toFixed(4)}`
    : 'GPS unavailable on victim node';

  const notif = await Notification.create({
    target_role: 'ADMIN',
    type: 'LORA_RESCUE_SIGNAL',
    title: `📡 LoRa Rescue Signal: ${emergency_id}`,
    message: `Node ${sender_id}: "${message}" | ${locationNote} | Signal: ${rssi} dBm (SNR ${snr} dB)`,
    emergency_id,
    priority
  }).catch(() => null);

  if (notif) {
    socketService.emitNotification(notif);
  }

  // Audit Log
  await AuditLog.create({
    user_id: sender_id,
    user_name: `LoRa Node ${sender_id}`,
    role: 'LORA_GATEWAY',
    action: 'LORA_PACKET_RECEIVED',
    emergency_id,
    metadata: { rssi, snr, frequency, emergency_type, location_source, location_available }
  }).catch(() => {});

  console.log(`📡 [LoRa Gateway] Emergency: ${emergency_id} | Node: ${sender_id} | Type: ${emergency_type} | Location: ${location_available ? `${latitude}, ${longitude}` : 'UNKNOWN'} | RSSI: ${rssi} dBm`);

  return res.status(201).json({
    success: true,
    message: 'LoRa rescue emergency message processed successfully',
    emergency_id,
    emergency: newEmergency,
    location_available,
    telemetry: {
      rssi,
      snr,
      gateway_packets_total: gatewayStats.packetsReceived
    }
  });
}

/**
 * POST /api/lora/message
 * Ingestion endpoint for ESP32 LoRa Gateway (requires gateway API key)
 */
router.post('/message', requireGatewayAuth, async (req, res) => {
  try {
    const payload = parseLoraPayload(req.body);
    return await processLoraPacket(payload, res);
  } catch (err) {
    console.error('LoRa ingestion error:', err);
    return res.status(500).json({
      success: false,
      message: 'Failed to process LoRa emergency message',
      error: err.message
    });
  }
});

/**
 * POST /api/lora/packet
 * Alias endpoint (same as /message)
 */
router.post('/packet', requireGatewayAuth, async (req, res) => {
  try {
    const payload = parseLoraPayload(req.body);
    return await processLoraPacket(payload, res);
  } catch (err) {
    console.error('LoRa packet error:', err);
    return res.status(500).json({ success: false, message: 'Failed to process LoRa packet' });
  }
});

/**
 * GET /api/lora/status
 * Gateway telemetry & IP configuration guide (public, no auth needed)
 */
router.get('/status', (req, res) => {
  const localIps = getLocalIpAddresses();
  const primaryIp = localIps.find(i => i.ip.startsWith('192.168.') || i.ip.startsWith('172.')) || localIps[0] || { ip: 'localhost' };

  return res.status(200).json({
    success: true,
    status: 'ONLINE',
    service: 'ResQNet ESP32 LoRa Receiver Gateway',
    packets_received: gatewayStats.packetsReceived,
    last_packet_at: gatewayStats.lastPacketAt,
    last_node_id: gatewayStats.lastNodeId,
    active_nodes_count: gatewayStats.activeNodes.size,
    server_ips: localIps,
    esp32_target_url: `http://${primaryIp.ip}:5000/api/lora/message`,
    gateway_auth_required: !!(GATEWAY_API_KEY && GATEWAY_API_KEY.trim()),
    frequency_bands: ['433 MHz (IN/EU)', '868 MHz (EU)', '915 MHz (US)'],
    protocol_version: '2.0',
    supported_protocols: ['HTTP POST (WiFi Gateway)', 'USB Serial COM Bridge'],
    note_india: 'India uses 433 MHz ISM band. Ensure your RA-02 module is the 433 MHz variant.'
  });
});

/**
 * GET /api/lora/history
 * List recent emergencies received via LoRa radio
 */
router.get('/history', async (req, res) => {
  try {
    const loraEmergencies = await Emergency.find({
      $or: [
        { source: 'LORA' },
        { location_source: { $regex: /^LORA/i } }
      ]
    }).sort({ created_at: -1 }).limit(50);

    return res.status(200).json({
      success: true,
      count: loraEmergencies.length,
      emergencies: loraEmergencies
    });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to retrieve LoRa emergencies' });
  }
});

/**
 * POST /api/lora/simulate
 * Test simulation endpoint — creates a synthetic LoRa emergency for testing.
 * Protected by requireSimulationAuth (authenticated ResQNet user session or gateway key)
 */
router.post('/simulate', requireSimulationAuth, async (req, res) => {
  try {
    const sampleNodes = ['LORA-NODE-ALPHA', 'LORA-NODE-BRAVO', 'LORA-NODE-CHARLIE', 'LORA-NODE-DELTA'];
    const sampleMessages = [
      'Flood waters rising rapidly on ground floor. 3 people trapped, elderly person needs evacuation!',
      'Severe building collapse tremor felt. Need rescue team with stretcher and first aid.',
      'Fire spreading to residential quarters. Workers assembled at emergency muster point.',
      'Flash flood warning. Water current too strong to cross. 4 family members stranded on roof.'
    ];
    const sampleTypes = ['Flood', 'Structural Collapse', 'Fire', 'Flood'];

    const idx = Math.floor(Math.random() * sampleNodes.length);
    const simPayload = {
      sender_id: req.body.sender_id || sampleNodes[idx],
      message: req.body.message || sampleMessages[idx],
      emergency_type: req.body.emergency_type || sampleTypes[idx],
      severity: req.body.severity || 'Critical',
      people_affected: req.body.people_affected || Math.floor(1 + Math.random() * 5),
      // Provide real-looking test coordinates near Vellore, Tamil Nadu
      latitude: req.body.latitude !== undefined ? req.body.latitude : (12.8340 + (Math.random() - 0.5) * 0.05),
      longitude: req.body.longitude !== undefined ? req.body.longitude : (79.7030 + (Math.random() - 0.5) * 0.05),
      rssi: req.body.rssi || Math.floor(-95 + Math.random() * 30),
      snr: req.body.snr || parseFloat((6 + Math.random() * 5).toFixed(1)),
      battery_level: req.body.battery_level || Math.floor(70 + Math.random() * 30),
      location_source: 'LORA_GPS'
    };

    return await processLoraPacket(simPayload, res);
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Simulation failed', error: err.message });
  }
});

module.exports = router;
