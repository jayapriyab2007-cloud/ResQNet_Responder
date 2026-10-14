/**
 * Normalizer helpers for ResQNet client
 * Maps backend MongoDB Atlas records into uniform frontend format
 */

export function parseCoordinate(val, min, max) {
  if (val === null || val === undefined || val === '') return null;
  const num = typeof val === 'number' ? val : Number(val);
  if (isNaN(num) || !isFinite(num)) return null;
  if (num < min || num > max) return null;
  return num;
}

export function safeFormatTime(date, fallback = 'Recently') {
  if (!date) return fallback;
  const d = new Date(date);
  if (isNaN(d.getTime())) return fallback;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function formatTimeAgo(date) {
  if (!date) return 'Recently';
  const now = new Date();
  const d = new Date(date);
  if (isNaN(d.getTime())) return 'Recently';
  const diffMs = now - d;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec} seconds ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} min ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} hours ago`;
  return `${Math.floor(diffHr / 24)} days ago`;
}

export function normalizeEmergency(item) {
  if (!item) return null;
  const id = item.emergency_id || item.id || (item._id ? item._id.toString() : '');
  const type = item.emergency_type || item.type || 'Emergency';
  const rawPriority = item.priority || 'P1';
  let priority = rawPriority;
  if (!rawPriority.startsWith('P')) {
    if (rawPriority === 'Critical') priority = 'P1';
    else if (rawPriority === 'High') priority = 'P2';
    else if (rawPriority === 'Medium') priority = 'P3';
    else if (rawPriority === 'Low') priority = 'P4';
    else priority = 'P1';
  }

  let priorityWeight = 4;
  if (priority.includes('P1')) priorityWeight = 1;
  else if (priority.includes('P2')) priorityWeight = 2;
  else if (priority.includes('P3')) priorityWeight = 3;

  // Strict coordinate parsing & validation
  // LoRa incidents without GPS are stored as 0,0 with location_source=LORA_UNKNOWN
  const rawLat = item.latitude !== undefined ? item.latitude : item.lat;
  const rawLng = item.longitude !== undefined ? item.longitude : item.lng;
  const parsedLat = parseCoordinate(rawLat, -90, 90);
  const parsedLng = parseCoordinate(rawLng, -180, 180);

  const locationSource = (item.location_source || '').toUpperCase();
  const isLoraUnknown = locationSource === 'LORA_UNKNOWN';
  const isNullIsland = parsedLat === 0 && parsedLng === 0;
  const locationAvailable = !isLoraUnknown && !isNullIsland && parsedLat !== null && parsedLng !== null;

  const lat = locationAvailable ? parsedLat : null;
  const lng = locationAvailable ? parsedLng : null;
  const peopleAffected = item.people_affected !== undefined ? `${item.people_affected} people` : (item.peopleAffected || '1 person');

  const assignedResponders = (item.assigned_responders || item.assignedResponders || []).map(r => ({
    id: r.responder_id || r.id,
    responder_id: r.responder_id || r.id,
    name: r.name || 'Tactical Unit',
    role: r.role || 'Field Responder',
    team: r.team || item.assigned_team || 'Disaster Response Team',
    status: r.status || 'Assigned',
    location: r.location || 'Field Zone',
    connection: r.connection || 'Online'
  }));

  const notes = (item.notes || []).map(n => ({
    id: n._id ? n._id.toString() : (n.id || Math.random().toString()),
    author: n.author_name || n.author || 'Command Staff',
    role: n.author_role || n.role || 'Responder',
    timestamp: safeFormatTime(n.created_at, n.timestamp || 'Just now'),
    message: n.note || n.message || ''
  }));

  const chatMessages = (item.chat_messages || item.chatMessages || []).map(m => ({
    id: m._id ? m._id.toString() : (m.id || Math.random().toString()),
    sender: m.sender_role || m.sender || 'Victim',
    authorName: m.sender_role === 'VICTIM' ? 'Victim' : (m.sender_role === 'ADMIN' ? 'Command Center' : 'Responder'),
    message: m.message || '',
    timestamp: safeFormatTime(m.created_at, m.timestamp || 'Just now'),
    mode: 'INTERNET'
  }));

  return {
    ...item,
    id,
    emergency_id: id,
    type,
    emergency_type: type,
    priority,
    priorityWeight,
    severity: item.severity || 'Immediate Emergency',
    message: item.message || item.severity || 'Victim rescue emergency',
    source: item.source || ((item.location_source || '').toUpperCase().includes('LORA') ? 'LORA' : 'WEB'),
    lora_metadata: item.lora_metadata || null,
    location: locationAvailable
      ? (item.location || `Sector [${lat.toFixed(4)}, ${lng.toFixed(4)}]`)
      : 'Location unavailable (LoRa signal without GPS)',
    lat,
    lng,
    latitude: lat,
    longitude: lng,
    location_available: locationAvailable,
    location_source: item.location_source || 'GPS',
    peopleAffected,
    people_affected: item.people_affected || 1,
    time: item.created_at ? formatTimeAgo(item.created_at) : (item.time || 'Recent'),
    createdTime: safeFormatTime(item.created_at, item.createdTime || '10:00 AM'),
    status: item.status || 'SOS_CREATED',
    statusLabel: (item.status || 'SOS_CREATED').replace(/_/g, ' '),
    assigned_team: item.assigned_team || 'Disaster Response Team',
    assignedResponders,
    assigned_responders: assignedResponders,
    notes,
    chatMessages,
    escalationRequest: item.escalation_request || item.escalationRequest || null,
    responseTracking: item.responseTracking || {
      created: safeFormatTime(item.created_at, '10:00 AM'),
      notified: safeFormatTime(item.created_at, '10:01 AM'),
      assigned: null,
      accepted: null,
      onTheWay: null,
      arrived: null,
      serviceStarted: null,
      resolved: null,
      totalDuration: 'Active'
    }
  };
}

export function normalizeResponder(item) {
  if (!item) return null;
  const id = item.responder_id || item.id || (item._id ? item._id.toString() : '');
  const loc = item.current_location || {};
  const rawAvail = (item.availability || 'AVAILABLE').toUpperCase();
  const formattedAvail = rawAvail === 'AVAILABLE' ? 'Available' : (rawAvail === 'BUSY' ? 'Busy' : 'Offline');

  const rawLat = loc.latitude !== undefined ? loc.latitude : item.lat;
  const rawLng = loc.longitude !== undefined ? loc.longitude : item.lng;
  const parsedLat = parseCoordinate(rawLat, -90, 90);
  const parsedLng = parseCoordinate(rawLng, -180, 180);
  const isNullIsland = parsedLat === 0 && parsedLng === 0;
  const locationAvailable = !isNullIsland && parsedLat !== null && parsedLng !== null;

  const lat = locationAvailable ? parsedLat : null;
  const lng = locationAvailable ? parsedLng : null;

  const locationUpdatedAt = loc.updated_at ? new Date(loc.updated_at) : null;
  const validTimestamp = locationUpdatedAt && !isNaN(locationUpdatedAt.getTime());
  const locationAgeMs = validTimestamp ? Date.now() - locationUpdatedAt.getTime() : null;
  // Flag as stale if location is older than 10 minutes
  const isLocationStale = locationAgeMs !== null && locationAgeMs > 10 * 60 * 1000;

  return {
    id,
    responder_id: id,
    name: item.name || 'Responder Unit',
    role: item.specialization || item.role || 'Field Responder',
    team: item.team || 'Disaster Response',
    phone: item.phone || '',
    email: item.email || '',
    availability: formattedAvail,
    rawAvailability: rawAvail,
    status: formattedAvail,
    currentEmergencyId: item.current_emergency_id || null,
    lat: locationAvailable ? lat : null,
    lng: locationAvailable ? lng : null,
    location_available: locationAvailable,
    location_stale: isLocationStale,
    location_updated_at: validTimestamp ? locationUpdatedAt.toISOString() : null,
    location: locationAvailable
      ? `Lat ${lat.toFixed(4)}, Lng ${lng.toFixed(4)}${isLocationStale ? ' (stale)' : ''}`
      : 'Location unavailable',
    connection: item.connection_status || 'Online'
  };
}

export function normalizeHistoryItem(item) {
  if (!item) return null;
  const id = item.emergency_id || item.id || (item._id ? item._id.toString() : '');
  const type = item.emergency_type || item.type || 'Emergency';
  const rawPriority = item.priority || 'P1';
  let priority = rawPriority;
  if (!rawPriority.startsWith('P')) {
    if (rawPriority === 'Critical') priority = 'P1';
    else if (rawPriority === 'High') priority = 'P2';
    else if (rawPriority === 'Medium') priority = 'P3';
    else if (rawPriority === 'Low') priority = 'P4';
    else priority = 'P1';
  }

  const rawLat = item.latitude !== undefined ? item.latitude : item.lat;
  const rawLng = item.longitude !== undefined ? item.longitude : item.lng;
  const parsedLat = parseCoordinate(rawLat, -90, 90);
  const parsedLng = parseCoordinate(rawLng, -180, 180);
  const locationSource = (item.location_source || '').toUpperCase();
  const isLoraUnknown = locationSource === 'LORA_UNKNOWN';
  const isNullIsland = parsedLat === 0 && parsedLng === 0;
  const locationAvailable = !isLoraUnknown && !isNullIsland && parsedLat !== null && parsedLng !== null;
  const lat = locationAvailable ? parsedLat : null;
  const lng = locationAvailable ? parsedLng : null;

  const peopleAffected = item.people_affected !== undefined ? `${item.people_affected} people` : (item.peopleAffected || '1 person');

  const assignedResponders = (item.assigned_responders || item.assignedResponders || []).map(r => ({
    id: r.responder_id || r.id,
    name: r.name || 'Tactical Unit',
    role: r.role || 'Field Responder',
    team: r.team || item.assigned_team || 'Disaster Response',
    status: r.status || 'Resolved'
  }));

  const createdDate = item.created_at ? new Date(item.created_at) : null;
  const resolvedDate = item.resolved_at ? new Date(item.resolved_at) : (item.updated_at ? new Date(item.updated_at) : null);
  const validCreated = createdDate && !isNaN(createdDate.getTime());
  const validResolved = resolvedDate && !isNaN(resolvedDate.getTime());

  let responseDuration = 'Resolved';
  if (validCreated && validResolved) {
    const diffMins = Math.max(1, Math.round((resolvedDate - createdDate) / 60000));
    responseDuration = `${diffMins} mins`;
  }

  return {
    id,
    emergency_id: id,
    type,
    priority,
    location: locationAvailable
      ? (item.location || `Sector [${lat.toFixed(4)}, ${lng.toFixed(4)}]`)
      : (item.location || 'Location unavailable (No GPS fix)'),
    location_available: locationAvailable,
    lat,
    lng,
    peopleAffected,
    assignedRespondersCount: assignedResponders.length,
    assignedResponders,
    createdTime: validCreated ? createdDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Earlier',
    resolvedTime: validResolved ? resolvedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Cleared',
    responseDuration,
    finalStatus: item.status || 'RESOLVED',
    notesCount: (item.notes || []).length,
    auditSummary: item.resolution_note || 'Incident cleared and resolved by rescue command.'
  };
}
