import React from 'react';
import PriorityBadge from './PriorityBadge';
import StatusBadge from './StatusBadge';

/**
 * Standardized icon getter for emergency types
 */
export const getEmergencyIcon = (type) => {
  const norm = (type || '').toLowerCase();
  if (norm.includes('flood')) return '🌊';
  if (norm.includes('medic') || norm.includes('trauma') || norm.includes('ambulan')) return '🚑';
  if (norm.includes('forest fire') || norm.includes('wildfire')) return '🌲';
  if (norm.includes('fire') || norm.includes('hazmat')) return '🔥';
  if (norm.includes('cyclone') || norm.includes('hurricane') || norm.includes('storm')) return '🌀';
  if (norm.includes('earthquake')) return '🌎';
  if (norm.includes('tsunami')) return '🌊';
  if (norm.includes('landslide')) return '⛰️';
  if (norm.includes('heatwave')) return '🌡️';
  if (norm.includes('crime') || norm.includes('safety') || norm.includes('security')) return '🛡️';
  return '⚠️';
};

/**
 * Reusable EmergencyCard component
 * Supports:
 * - variant="compact" (for Dashboard Active Incidents)
 * - variant="detailed" (for Emergency Queue)
 */
export const EmergencyCard = ({
  emergency,
  variant = 'detailed',
  onView,
  onAssign,
  onTrack,
  onReassign
}) => {
  if (!emergency) return null;

  const isP1 = (emergency.priority || '').toUpperCase().includes('P1') || (emergency.priority || '').toUpperCase().includes('CRITICAL');
  const isP2 = (emergency.priority || '').toUpperCase().includes('P2') || (emergency.priority || '').toUpperCase().includes('HIGH');
  const isP3 = (emergency.priority || '').toUpperCase().includes('P3') || (emergency.priority || '').toUpperCase().includes('MEDIUM');
  const isP4 = (emergency.priority || '').toUpperCase().includes('P4') || (emergency.priority || '').toUpperCase().includes('LOW');

  let priorityClass = 'card-p3';
  if (isP1) priorityClass = 'card-critical card-p1';
  else if (isP2) priorityClass = 'card-p2';
  else if (isP4) priorityClass = 'card-p4';

  const isCompact = variant === 'compact';
  const hasResponders = Array.isArray(emergency.assignedResponders) && emergency.assignedResponders.length > 0;
  const isResolved = (emergency.status || '').toUpperCase() === 'RESOLVED';

  // Determine assigned team and responder names
  const teamName = hasResponders
    ? (emergency.assignedResponders[0]?.team || 'Assigned Tactical Unit')
    : 'Not Assigned';
  const responderNames = hasResponders
    ? emergency.assignedResponders.map(r => r.name).join(', ')
    : null;

  // Most prominent note / severity alert
  const alertText = emergency.severity || (emergency.notes && emergency.notes.length > 0 ? emergency.notes[0].message : null);

  const isLora = emergency.source === 'LORA' || (emergency.location_source || '').toUpperCase().includes('LORA') || !!emergency.lora_metadata;

  return (
    <div className={`tactical-emergency-card ${isCompact ? 'card-compact' : 'card-detailed'} ${priorityClass}`}>
      {/* 1. CARD HEADER */}
      <div className="card-top-header">
        <div className="card-type-group">
          <span className="card-type-icon">{getEmergencyIcon(emergency.type)}</span>
          <span className="card-type-name">{emergency.type}</span>
        </div>
        <PriorityBadge priority={emergency.priority} />
      </div>

      {/* 2. EMERGENCY ID & LORA TAG */}
      <div className="card-id-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
        <span className="card-id-code">{emergency.id}</span>
        {isLora && (
          <span className="lora-badge-pill" style={{
            background: 'rgba(6, 182, 212, 0.15)',
            color: '#38bdf8',
            border: '1px solid rgba(56, 189, 248, 0.4)',
            padding: '2px 8px',
            borderRadius: '12px',
            fontSize: '11px',
            fontWeight: '600',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '4px'
          }}>
            📡 ESP32 LoRa {emergency.lora_metadata?.rssi ? `(${emergency.lora_metadata.rssi} dBm)` : ''}
          </span>
        )}
      </div>

      {/* 3. INCIDENT DETAILS GRID */}
      <div className={`card-details-grid ${isCompact ? 'details-grid-compact' : 'details-grid-detailed'}`}>
        <div className="card-detail-cell location-cell">
          <span className="cell-label">📍 Location</span>
          <span className="cell-value cell-location-value" title={emergency.location}>
            {emergency.location}
          </span>
        </div>

        <div className="card-detail-cell affected-cell">
          <span className="cell-label">👥 Affected</span>
          <span className="cell-value">{emergency.peopleAffected || '1 person'}</span>
        </div>

        <div className="card-detail-cell reported-cell">
          <span className="cell-label">⏱ Reported</span>
          <span className="cell-value">{emergency.time || emergency.createdTime || 'Just now'}</span>
        </div>

        <div className="card-detail-cell status-cell">
          <span className="cell-label">Status</span>
          <div className="cell-value">
            <StatusBadge status={emergency.status} label={emergency.statusLabel} />
          </div>
        </div>

        {/* Detailed Variant Additional Grid Cells */}
        {!isCompact && (
          <>
            <div className="card-detail-cell team-cell">
              <span className="cell-label">Team</span>
              <span className={`cell-value ${hasResponders ? 'team-assigned' : 'team-unassigned'}`}>
                {teamName}
              </span>
            </div>

            {hasResponders && responderNames && (
              <div className="card-detail-cell responders-cell">
                <span className="cell-label">Responders</span>
                <span className="cell-value responders-names" title={responderNames}>
                  {responderNames}
                </span>
              </div>
            )}
          </>
        )}
      </div>

      {/* 4. OPERATIONAL ALERT BANNER / RESCUE MESSAGE */}
      {(emergency.message || alertText) && (
        <div className="card-alert-strip" style={isLora ? { borderLeft: '3px solid #38bdf8', background: 'rgba(6, 182, 212, 0.08)' } : {}}>
          <span className="alert-strip-icon">{isLora ? '📡' : '🚨'}</span>
          <span className="alert-strip-text">
            {isLora && <strong style={{ color: '#38bdf8', marginRight: '6px' }}>[LoRa Victim Message]</strong>}
            {emergency.message || alertText}
          </span>
        </div>
      )}

      {/* 5. ACTION AREA */}
      <div className="card-action-bar">
        {isCompact ? (
          /* Dashboard Compact Action */
          <button
            type="button"
            className="btn-card-action btn-card-primary"
            onClick={() => onView?.(emergency)}
          >
            [ VIEW EMERGENCY ]
          </button>
        ) : (
          /* Emergency Queue Detailed Actions */
          <div className="detailed-action-group">
            <button
              type="button"
              className="btn-card-action btn-card-primary"
              onClick={() => onView?.(emergency)}
            >
              [ VIEW DETAILS ]
            </button>

            {!isResolved && (
              <>
                {hasResponders ? (
                  <>
                    <button
                      type="button"
                      className="btn-card-action btn-card-track"
                      onClick={() => onTrack?.(emergency)}
                      title="Track assigned units on Tactical Map"
                    >
                      [ TRACK TEAM ]
                    </button>
                    <button
                      type="button"
                      className="btn-card-action btn-card-reassign"
                      onClick={() => onReassign?.(emergency)}
                      title="Reassign team or dispatch additional units"
                    >
                      [ REASSIGN ]
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-card-action btn-card-assign"
                    onClick={() => onAssign?.(emergency)}
                    title="Assign tactical response team"
                  >
                    [ ASSIGN TEAM ]
                  </button>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default EmergencyCard;
