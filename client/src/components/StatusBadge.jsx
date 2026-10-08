import React from 'react';

/**
 * StatusBadge component
 * Displays professional subtle status indicators:
 * 🟠 Waiting for Assignment
 * 🔵 Responder Assigned
 * 🟢 Responder Accepted
 * 🚗 On the Way
 * 📍 Arrived
 * ⚡ Service Started
 * ✅ Resolved
 * ⚪ Cancelled
 */
export const StatusBadge = ({ status, label }) => {
  const normStatus = (status || '').toUpperCase();
  const text = label || status || 'Unknown';

  let statusClass = 'waiting';
  let icon = '🟠';

  if (normStatus === 'TEAM_NOTIFIED' || normStatus === 'SOS_CREATED' || normStatus.includes('WAITING')) {
    statusClass = 'waiting';
    icon = '🟠';
  } else if (normStatus === 'RESPONDER_ASSIGNED' || normStatus.includes('ASSIGNED')) {
    statusClass = 'assigned';
    icon = '🔵';
  } else if (normStatus === 'RESPONDER_ACCEPTED' || normStatus.includes('ACCEPTED')) {
    statusClass = 'accepted';
    icon = '🟢';
  } else if (normStatus === 'ON_THE_WAY' || normStatus.includes('WAY') || normStatus.includes('ROUTE')) {
    statusClass = 'enroute';
    icon = '🚗';
  } else if (normStatus === 'ARRIVED' || normStatus.includes('ARRIVED')) {
    statusClass = 'arrived';
    icon = '📍';
  } else if (normStatus === 'SERVICE_STARTED' || normStatus.includes('STARTED') || normStatus.includes('SERVICE')) {
    statusClass = 'in-progress';
    icon = '⚡';
  } else if (normStatus === 'RESOLVED' || normStatus.includes('RESOLVED')) {
    statusClass = 'resolved';
    icon = '✅';
  } else if (normStatus === 'CANCELLED' || normStatus.includes('CANCELLED')) {
    statusClass = 'cancelled';
    icon = '⚪';
  }

  return (
    <span className={`status-badge status-badge-${statusClass}`}>
      <span className="status-badge-icon">{icon}</span>
      <span className="status-badge-label">{text}</span>
    </span>
  );
};

export default StatusBadge;
