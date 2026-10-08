import React from 'react';

/**
 * EmergencyFilters component
 * Provides top metric cards (Active, Critical, Unassigned)
 * and comprehensive tactical filters: search, type, priority, status, assignment, sort.
 */
export const EmergencyFilters = ({
  searchQuery,
  onSearchChange,
  typeFilter,
  onTypeChange,
  priorityFilter,
  onPriorityChange,
  statusFilter,
  onStatusChange,
  assignmentFilter,
  onAssignmentChange,
  sortBy,
  onSortChange,
  stats = { active: 0, critical: 0, unassigned: 0 }
}) => {
  return (
    <div className="emergency-queue-header-area">
      {/* 1. Header Titles */}
      <div className="queue-title-row">
        <div>
          <h2 className="queue-heading">🚨 Emergency Queue</h2>
          <p className="queue-subheading">Monitor, prioritize and coordinate active incidents</p>
        </div>
      </div>

      {/* 2. Operational Summary Cards */}
      <div className="queue-summary-strip">
        <div className="queue-summary-card">
          <span className="summary-label">ACTIVE</span>
          <span className="summary-val">{stats.active}</span>
        </div>
        <div className="queue-summary-card summary-card-critical">
          <span className="summary-label">CRITICAL</span>
          <span className="summary-val">{stats.critical}</span>
        </div>
        <div className="queue-summary-card summary-card-unassigned">
          <span className="summary-label">UNASSIGNED</span>
          <span className="summary-val">{stats.unassigned}</span>
        </div>
      </div>

      {/* 3. Search and Multi-Filter Toolbar */}
      <div className="queue-filter-toolbar">
        {/* Search input */}
        <div className="queue-search-box">
          <span className="search-icon">🔍</span>
          <input
            type="text"
            className="queue-search-input"
            placeholder="Search emergency ID, location or type..."
            value={searchQuery}
            onChange={(e) => onSearchChange(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="search-clear-btn"
              onClick={() => onSearchChange('')}
            >
              ✕
            </button>
          )}
        </div>

        {/* Filter Dropdowns Grid */}
        <div className="queue-filter-selects">
          {/* Emergency Type */}
          <div className="filter-select-wrapper">
            <select
              className="queue-select"
              value={typeFilter}
              onChange={(e) => onTypeChange(e.target.value)}
              aria-label="Filter by emergency type"
            >
              <option value="ALL">All Types ▼</option>
              <option value="Flood">🌊 Flood</option>
              <option value="Medical Emergency">🚑 Medical</option>
              <option value="Fire">🔥 Fire</option>
              <option value="Cyclone">🌀 Cyclone</option>
              <option value="Earthquake">⚡ Earthquake</option>
              <option value="Landslide">⛰️ Landslide</option>
              <option value="Safety / Crime">🛡️ Safety</option>
            </select>
          </div>

          {/* Priority */}
          <div className="filter-select-wrapper">
            <select
              className="queue-select"
              value={priorityFilter}
              onChange={(e) => onPriorityChange(e.target.value)}
              aria-label="Filter by priority"
            >
              <option value="ALL">All Priorities ▼</option>
              <option value="P1">P1 • Critical</option>
              <option value="P2">P2 • High</option>
              <option value="P3">P3 • Medium</option>
              <option value="P4">P4 • Low</option>
            </select>
          </div>

          {/* Status */}
          <div className="filter-select-wrapper">
            <select
              className="queue-select"
              value={statusFilter}
              onChange={(e) => onStatusChange(e.target.value)}
              aria-label="Filter by status"
            >
              <option value="ALL">All Statuses ▼</option>
              <option value="WAITING">Waiting Assignment</option>
              <option value="ASSIGNED">Responder Assigned</option>
              <option value="ACCEPTED">Responder Accepted</option>
              <option value="EN_ROUTE">On The Way</option>
              <option value="ARRIVED">Arrived</option>
              <option value="SERVICE_STARTED">Service Started</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>

          {/* Assignment */}
          <div className="filter-select-wrapper">
            <select
              className="queue-select"
              value={assignmentFilter}
              onChange={(e) => onAssignmentChange(e.target.value)}
              aria-label="Filter by assignment"
            >
              <option value="ALL">Assignment: All ▼</option>
              <option value="UNASSIGNED">Unassigned Only</option>
              <option value="ASSIGNED">Assigned Only</option>
            </select>
          </div>

          {/* Sort Selector */}
          <div className="filter-select-wrapper">
            <select
              className="queue-select"
              value={sortBy}
              onChange={(e) => onSortChange(e.target.value)}
              aria-label="Sort emergencies"
            >
              <option value="PRIORITY">Priority First ▼</option>
              <option value="NEWEST">Newest First ▼</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

export default EmergencyFilters;
