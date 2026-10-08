import React from 'react';

/**
 * PriorityBadge component
 * Displays standardized priority pill:
 * P1 • CRITICAL (red accent / subtle glow)
 * P2 • HIGH (orange accent)
 * P3 • MEDIUM (yellow accent)
 * P4 • LOW (green accent)
 */
export const PriorityBadge = ({ priority }) => {
  if (!priority) return null;

  const priUpper = priority.toUpperCase();
  let code = 'P3';
  let label = 'MEDIUM';
  let levelClass = 'p3';

  if (priUpper.includes('P1') || priUpper.includes('CRITICAL')) {
    code = 'P1';
    label = 'CRITICAL';
    levelClass = 'p1';
  } else if (priUpper.includes('P2') || priUpper.includes('HIGH')) {
    code = 'P2';
    label = 'HIGH';
    levelClass = 'p2';
  } else if (priUpper.includes('P3') || priUpper.includes('MEDIUM')) {
    code = 'P3';
    label = 'MEDIUM';
    levelClass = 'p3';
  } else if (priUpper.includes('P4') || priUpper.includes('LOW')) {
    code = 'P4';
    label = 'LOW';
    levelClass = 'p4';
  }

  return (
    <span className={`priority-badge priority-badge-${levelClass}`}>
      <span className="priority-badge-dot"></span>
      <span className="priority-badge-text">{code} • {label}</span>
    </span>
  );
};

export default PriorityBadge;
