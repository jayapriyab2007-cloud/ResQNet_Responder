require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');

// Configure custom DNS for test runner if needed
if (process.env.DISABLE_CUSTOM_DNS !== 'true') {
  try {
    const dns = require('dns');
    dns.setServers(['8.8.8.8', '1.1.1.1']);
  } catch (e) {}
}

const GATEWAY_KEY = process.env.GATEWAY_API_KEY;
if (!GATEWAY_KEY) {
  console.error('ERROR: GATEWAY_API_KEY not defined in server/.env');
  process.exit(1);
}

async function req(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const reqHeaders = {
      'Content-Type': 'application/json',
      ...headers
    };
    if (data) {
      reqHeaders['Content-Length'] = Buffer.byteLength(data);
    }
    const options = {
      hostname: 'localhost',
      port: 5000,
      path,
      method,
      headers: reqHeaders
    };
    const r = http.request(options, res => {
      let chunks = '';
      res.on('data', chunk => chunks += chunk);
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(chunks); } catch (e) { parsed = chunks; }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

// Tracked IDs for strict test isolation & cleanup
const cleanup = {
  userIds: [],
  emergencyIds: []
};

async function runTests() {
  console.log('=== RESQNET ISOLATED INTEGRATION TEST SUITE ===\n');
  let passed = 0;
  let failed = 0;

  function assert(condition, testName, details = '') {
    if (condition) {
      console.log('PASS: ' + testName);
      passed++;
    } else {
      console.error('FAIL: ' + testName + ' - ' + details);
      failed++;
    }
  }

  try {
    // 1. Health Check
    const health = await req('GET', '/api/health');
    assert(health.status === 200 && health.body.status === 'ok' && health.body.database && health.body.database.status === 'connected', '1. Health endpoint returns 200 and DB connected');

    // 2. Auth - Invalid Login returns 400 with error
    const badLogin = await req('POST', '/api/auth/login', { email: 'nonexistent@resqnet.org', password: 'wrong' });
    assert(badLogin.status === 400 && badLogin.body.error, '2. Invalid login rejected with 400 Bad Request');

    // 3. Auth - Seed or Login with Admin
    const regAdmin = await req('POST', '/api/auth/register', {
      name: 'Test Administrator',
      email: 'admin_test_' + Date.now() + '@resqnet.org',
      password: 'Password@123',
      role: 'ADMIN',
      phone: '9876543210'
    });
    assert(regAdmin.status === 201 && regAdmin.body.token, '3. Register test admin successful');
    const adminToken = regAdmin.body.token;
    if (regAdmin.body.user && regAdmin.body.user.id) cleanup.userIds.push(regAdmin.body.user.id);

    // 4. Auth - Protected endpoint without token returns 401
    const unauthResp = await req('GET', '/api/admin/emergencies');
    assert(unauthResp.status === 401, '4. Accessing protected admin endpoint without token returns 401');

    // 5. Auth - Protected endpoint with token
    const authEmergencies = await req('GET', '/api/admin/emergencies', null, { Authorization: 'Bearer ' + adminToken });
    assert(authEmergencies.status === 200 && Array.isArray(authEmergencies.body.emergencies), '5. Accessing admin emergencies with valid token returns 200');

    // 6. Create Incident via /api/emergencies (Web Victim SOS with Auth Token)
    const newIncident = await req('POST', '/api/emergencies', {
      user_id: 'VICTIM-TEST-001',
      emergency_type: 'Flood',
      severity: 'Critical',
      priority: 'P1',
      people_affected: 3,
      message: 'Water levels rising rapidly on ground floor, 3 people trapped.',
      latitude: 12.9230,
      longitude: 80.1230,
      location_source: 'GPS'
    }, { Authorization: 'Bearer ' + adminToken });
    assert(newIncident.status === 201 && newIncident.body.emergency && newIncident.body.emergency.emergency_id, '6. Web incident creation returns 201 with emergency_id');
    const createdEmergencyId = newIncident.body.emergency ? newIncident.body.emergency.emergency_id : null;
    if (createdEmergencyId) cleanup.emergencyIds.push(createdEmergencyId);

    // 7. Verify Incident Persisted in Database
    if (createdEmergencyId) {
      const fetchIncident = await req('GET', '/api/emergencies/' + createdEmergencyId, null, { Authorization: 'Bearer ' + adminToken });
      assert(fetchIncident.status === 200 && fetchIncident.body.emergency.emergency_id === createdEmergencyId, '7. Created incident successfully retrieved and persisted');
    }

    // 8. Test Invalid Incident (Missing Required Fields)
    const invalidIncident = await req('POST', '/api/emergencies', {
      emergency_type: 'Unknown'
    }, { Authorization: 'Bearer ' + adminToken });
    assert(invalidIncident.status === 400, '8. Validation rejects invalid emergency payload with 400 Bad Request');

    // 9. LoRa Gateway Status (Public Telemetry)
    const loraStatus = await req('GET', '/api/lora/status');
    assert(loraStatus.status === 200 && loraStatus.body.status === 'ONLINE', '9. LoRa gateway telemetry returns status 200 and ONLINE');

    // 10. LoRa Message Ingestion - Unauthorized (Missing Gateway Key)
    const unauthLora = await req('POST', '/api/lora/message', {
      sender_id: 'LORA-NODE-01',
      emergency_type: 'Fire',
      severity: 'High',
      message: 'Building fire on 3rd floor',
      latitude: 12.92,
      longitude: 80.12
    });
    assert(unauthLora.status === 401, '10. LoRa ingestion without gateway key rejected with 401');

    // 11. LoRa Message Ingestion - Authorized (With Dynamic Gateway Key from .env)
    const loraNodeId = 'LORA-PROBE-' + Math.floor(Math.random() * 1000);
    const authLora = await req('POST', '/api/lora/message', {
      sender_id: loraNodeId,
      emergency_type: 'Landslide',
      severity: 'Critical',
      people_affected: 2,
      message: 'Road blocked by mudslide, vehicle trapped',
      latitude: 12.8340,
      longitude: 79.7030,
      rssi: -82,
      snr: 8.5
    }, { 'x-gateway-key': GATEWAY_KEY });
    assert(authLora.status === 201 && authLora.body.success, '11. LoRa ingestion with valid gateway key returns 201 and saves to MongoDB');
    const loraEmergencyId = authLora.body.emergency ? authLora.body.emergency.emergency_id : null;
    if (loraEmergencyId) cleanup.emergencyIds.push(loraEmergencyId);

    // 12. LoRa Duplicate Packet Detection
    if (loraEmergencyId) {
      const dupLora = await req('POST', '/api/lora/message', {
        sender_id: loraNodeId,
        emergency_id: loraEmergencyId,
        emergency_type: 'Landslide',
        message: 'Road blocked duplicate retransmission'
      }, { 'x-gateway-key': GATEWAY_KEY });
      assert(dupLora.status === 200 && dupLora.body.duplicate === true, '12. Duplicate LoRa packet detected and suppressed (200 duplicate: true)');
    }

    // 13. LoRa Packet Without GPS Coordinates (Sentinel 0,0 with LORA_UNKNOWN)
    const noGpsLora = await req('POST', '/api/lora/message', {
      sender_id: 'LORA-NO-GPS',
      emergency_type: 'Flood',
      severity: 'Critical',
      message: 'Victim node without GPS lock',
      latitude: null,
      longitude: null
    }, { 'x-gateway-key': GATEWAY_KEY });
    assert(noGpsLora.status === 201 && noGpsLora.body.location_available === false && noGpsLora.body.emergency.location_source === 'LORA_UNKNOWN', '13. LoRa packet without GPS handled with location_available: false and LORA_UNKNOWN');
    if (noGpsLora.body.emergency && noGpsLora.body.emergency.emergency_id) {
      cleanup.emergencyIds.push(noGpsLora.body.emergency.emergency_id);
    }

    // 14. LoRa Simulation - Unauthorized (No Token and No Key)
    const unauthSim = await req('POST', '/api/lora/simulate', {});
    assert(unauthSim.status === 401, '14. Simulation without auth rejected with 401');

    // 15. LoRa Simulation - Responder Role Forbidden (Simulation is Admin-Only)
    const regResp = await req('POST', '/api/auth/register', {
      name: 'Rapid Rescuer Unit 9',
      email: 'responder_test_' + Date.now() + '@resqnet.org',
      password: 'Password@123',
      role: 'RESPONDER',
      phone: '9123456780',
      specialization: 'Swift Water & Flood Rescue',
      team: 'Rescue Squad Alpha'
    });
    assert(regResp.status === 201 && regResp.body.token, '15a. Register responder unit successful');
    const respToken = regResp.body.token;
    const responderId = regResp.body.user.responder_id;
    if (regResp.body.user && regResp.body.user.id) cleanup.userIds.push(regResp.body.user.id);

    const responderSim = await req('POST', '/api/lora/simulate', {
      message: 'Unauthorized responder simulation attempt'
    }, { Authorization: 'Bearer ' + respToken });
    assert(responderSim.status === 403, '15b. Simulation by non-admin role rejected with 403 Forbidden');

    // 16. LoRa Simulation - Authorized via Admin JWT (No Gateway Key leaked!)
    const authSim = await req('POST', '/api/lora/simulate', {
      message: 'Synthetic drill test incident via browser admin panel'
    }, { Authorization: 'Bearer ' + adminToken });
    assert(authSim.status === 201 && authSim.body.success === true, '16. Simulation with Admin JWT bearer token succeeds (201) without gateway key');
    if (authSim.body.emergency && authSim.body.emergency.emergency_id) {
      cleanup.emergencyIds.push(authSim.body.emergency.emergency_id);
    }

    // 17. Responder Updates Location
    const locUpdate = await req('PATCH', '/api/responder/location', {
      latitude: 12.9716,
      longitude: 80.2450
    }, { Authorization: 'Bearer ' + respToken });
    assert(locUpdate.status === 200 && locUpdate.body.success, '17. Responder updates live coordinates successfully (200)');

    // 18. Responder Updates Availability
    const availUpdate = await req('PATCH', '/api/responder/availability', {
      availability: 'AVAILABLE'
    }, { Authorization: 'Bearer ' + respToken });
    assert(availUpdate.status === 200 && availUpdate.body.availability === 'AVAILABLE', '18. Responder updates availability status to AVAILABLE');

    // 19. Admin Assigns Responder to Incident
    if (createdEmergencyId && responderId) {
      const assignOp = await req('POST', '/api/admin/emergencies/' + createdEmergencyId + '/assign', {
        responder_id: responderId,
        team: 'Rescue Squad Alpha'
      }, { Authorization: 'Bearer ' + adminToken });
      assert(assignOp.status === 200 && assignOp.body.emergency.status === 'RESPONDER_ASSIGNED', '19. Admin assigns responder to incident (status -> RESPONDER_ASSIGNED)');

      // 20. Responder Accepts Assignment
      const acceptOp = await req('POST', '/api/responder/emergencies/' + createdEmergencyId + '/accept', {}, { Authorization: 'Bearer ' + respToken });
      assert(acceptOp.status === 200 && acceptOp.body.emergency.status === 'RESPONDER_ACCEPTED', '20. Responder accepts mission (status -> RESPONDER_ACCEPTED)');

      // 21. Responder Advances Status to ON_THE_WAY, then RESOLVED
      const statusOp = await req('PATCH', '/api/responder/emergencies/' + createdEmergencyId + '/status', {
        status: 'ON_THE_WAY',
        note: 'En route with inflatable rescue boat'
      }, { Authorization: 'Bearer ' + respToken });
      assert(statusOp.status === 200 && statusOp.body.emergency.status === 'ON_THE_WAY', '21. Responder advances status to ON_THE_WAY');

      const resolveOp = await req('PATCH', '/api/responder/emergencies/' + createdEmergencyId + '/status', {
        status: 'RESOLVED',
        note: 'All 3 persons evacuated safely to community center shelter'
      }, { Authorization: 'Bearer ' + respToken });
      assert(resolveOp.status === 200 && resolveOp.body.emergency.status === 'RESOLVED', '22. Responder resolves incident (status -> RESOLVED)');
    }

    // 23. Verify Persisted Status in DB
    if (createdEmergencyId) {
      const finalDoc = await req('GET', '/api/emergencies/' + createdEmergencyId, null, { Authorization: 'Bearer ' + adminToken });
      assert(finalDoc.body.emergency.status === 'RESOLVED', '23. Persisted MongoDB status verified as RESOLVED');
    }
  } finally {
    // Strict Test Isolation Cleanup: Purge ONLY entities created during this run
    console.log('\n[CLEANUP] Performing test isolation teardown...');
    try {
      await mongoose.connect(process.env.MONGODB_URI);
      const User = require('./models/User');
      const Emergency = require('./models/Emergency');
      const Notification = require('./models/Notification');
      const AuditLog = require('./models/AuditLog');

      if (cleanup.userIds.length > 0) {
        const uDel = await User.deleteMany({ _id: { $in: cleanup.userIds } });
        console.log(`[CLEANUP] Removed ${uDel.deletedCount} test users.`);
      }

      if (cleanup.emergencyIds.length > 0) {
        const eDel = await Emergency.deleteMany({ emergency_id: { $in: cleanup.emergencyIds } });
        console.log(`[CLEANUP] Removed ${eDel.deletedCount} test emergencies.`);
        const nDel = await Notification.deleteMany({ emergency_id: { $in: cleanup.emergencyIds } });
        console.log(`[CLEANUP] Removed ${nDel.deletedCount} associated test notifications.`);
        const aDel = await AuditLog.deleteMany({ emergency_id: { $in: cleanup.emergencyIds } });
        console.log(`[CLEANUP] Removed ${aDel.deletedCount} associated test audit logs.`);
      }
      await mongoose.disconnect();
      console.log('[CLEANUP] Test isolation cleanup completed successfully.');
    } catch (cleanErr) {
      console.warn('[CLEANUP] Warning during cleanup:', cleanErr.message);
    }
  }

  console.log('\n========================================');
  console.log('TEST SUMMARY: ' + passed + ' PASSED, ' + failed + ' FAILED');
  console.log('========================================');
  process.exit(failed > 0 ? 1 : 0);
}

runTests().catch(err => {
  console.error('Fatal test runner error:', err);
  process.exit(1);
});
