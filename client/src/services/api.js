/**
 * ResQNet Centralized API Service
 * Connects frontend to unified backend on http://localhost:5000
 * Direct MongoDB Atlas operations via Express REST API
 */

export const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000';

function getAuthHeaders() {
  const token = localStorage.getItem('resqnet_token');
  const headers = {
    'Content-Type': 'application/json'
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

export async function request(endpoint, options = {}) {
  const url = `${API_BASE_URL}${endpoint}`;
  const headers = {
    ...getAuthHeaders(),
    ...(options.headers || {})
  };

  try {
    const response = await fetch(url, {
      ...options,
      headers
    });

    // 401 Unauthorized -> Token invalid or expired
    if (response.status === 401) {
      localStorage.removeItem('resqnet_token');
      localStorage.removeItem('resqnet_user');
      localStorage.removeItem('resqnet_role');
      window.dispatchEvent(new CustomEvent('resqnet-auth-unauthorized'));
      const data = await response.json().catch(() => ({}));
      const err = new Error(data.message || 'Session expired or unauthorized. Please log in again.');
      err.status = 401;
      throw err;
    }

    // 403 Forbidden -> Role permission violation
    if (response.status === 403) {
      const data = await response.json().catch(() => ({}));
      const err = new Error(data.message || 'You do not have permission to perform this action.');
      err.status = 403;
      throw err;
    }

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      let errorMsg = data.message || data.error;
      if (!errorMsg) {
        if (response.status === 404) errorMsg = 'Requested resource not found.';
        else if (response.status >= 500) errorMsg = 'Internal server error. Please try again.';
        else errorMsg = `Request failed (HTTP ${response.status})`;
      }
      const error = new Error(errorMsg);
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (err) {
    if (err.name === 'TypeError' && err.message.includes('fetch')) {
      const netError = new Error('ResQNet backend is unavailable. Please verify the server is running on http://localhost:5000.');
      netError.isNetworkError = true;
      throw netError;
    }
    throw err;
  }
}

// ============================================================================
// Granular API Functions
// ============================================================================

export const login = (email, password) =>
  request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password })
  });

export const register = (userData) =>
  request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(userData)
  });

export const getMe = () => request('/api/auth/me');

// LoRa Gateway Operations
export const getLoraStatus = () => request('/api/lora/status');
export const getLoraHistory = () => request('/api/lora/history');
export const simulateLoraPacket = (payload = {}) =>
  request('/api/lora/simulate', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
export const sendLoraMessage = (payload) =>
  request('/api/lora/message', {
    method: 'POST',
    body: JSON.stringify(payload)
  });

// Admin Operations
export const getEmergencies = (params = '') => request(`/api/admin/emergencies${params}`);
export const getEmergency = (id) => request(`/api/emergencies/${id}`);
export const getResponders = () => request('/api/admin/responders');
export const createResponder = (payload) =>
  request('/api/admin/responders', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
export const deleteResponder = (id) =>
  request(`/api/admin/responders/${id}`, {
    method: 'DELETE'
  });
export const clearDemoData = () =>
  request('/api/admin/clear-demo-data', {
    method: 'POST'
  });
export const getUsers = () => request('/api/admin/users');

export const assignResponder = (id, payload) =>
  request(`/api/admin/emergencies/${id}/assign`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const reassignResponder = (id, payload) =>
  request(`/api/admin/emergencies/${id}/reassign`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const removeResponder = (id, responderId) =>
  request(`/api/admin/emergencies/${id}/responders/${responderId}`, {
    method: 'DELETE'
  });

export const updatePriority = (id, payload) =>
  request(`/api/admin/emergencies/${id}/priority`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

export const getAnalytics = () => request('/api/admin/analytics');
export const getAuditLogs = () => request('/api/admin/audit-logs');

export const getAdminHistory = () => request('/api/admin/history');

// Responder Operations
export const getResponderEmergencies = () => request('/api/responder/emergencies');
export const getResponderEmergency = (id) => request(`/api/responder/emergencies/${id}`);

export const acceptAssignment = (id) =>
  request(`/api/responder/emergencies/${id}/accept`, {
    method: 'POST'
  });

export const declineAssignment = (id, reason) =>
  request(`/api/responder/emergencies/${id}/decline`, {
    method: 'POST',
    body: JSON.stringify({ reason })
  });

export const updateEmergencyStatus = (id, payload) =>
  request(`/api/responder/emergencies/${id}/status`, {
    method: 'PATCH',
    body: JSON.stringify(payload)
  });

export const updateResponderLocation = (coords) =>
  request('/api/responder/location', {
    method: 'PATCH',
    body: JSON.stringify(coords)
  });

export const updateResponderAvailability = (availability) =>
  request('/api/responder/availability', {
    method: 'PATCH',
    body: JSON.stringify({ availability })
  });

export const addIncidentNote = (id, note) =>
  request(`/api/responder/emergencies/${id}/notes`, {
    method: 'POST',
    body: JSON.stringify({ note })
  });

export const requestEscalation = (id, payload) =>
  request(`/api/responder/emergencies/${id}/escalation-request`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

export const getResponderHistory = () => request('/api/responder/history');

// Notifications
export const getNotifications = () => request('/api/notifications');
export const markNotificationRead = (id) =>
  request(`/api/notifications/${id}/read`, {
    method: 'PATCH'
  });
export const markAllNotificationsRead = () =>
  request('/api/notifications/read-all', {
    method: 'PATCH'
  });

// Unified History Getter
export const getHistory = (role) => {
  if (role === 'admin' || role === 'ADMIN') {
    return getAdminHistory();
  }
  return getResponderHistory();
};

// Emergency Chat
export const sendChatMessage = (id, payload) =>
  request(`/api/emergencies/${id}/chat`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });

// Namespace Export for Structured Access
export const api = {
  auth: { login, register, getMe },
  lora: {
    getStatus: getLoraStatus,
    getHistory: getLoraHistory,
    simulate: simulateLoraPacket,
    sendMessage: sendLoraMessage
  },
  admin: {
    getEmergencies,
    getEmergency,
    getResponders,
    createResponder,
    deleteResponder,
    clearDemoData,
    getUsers,
    assignResponder,
    reassignResponder,
    removeResponder,
    updatePriority,
    getAnalytics,
    getAuditLogs,
    getHistory: getAdminHistory
  },
  responder: {
    getEmergencies: getResponderEmergencies,
    getEmergency: getResponderEmergency,
    acceptEmergency: acceptAssignment,
    declineEmergency: declineAssignment,
    updateStatus: updateEmergencyStatus,
    updateLocation: updateResponderLocation,
    updateAvailability: updateResponderAvailability,
    addNote: addIncidentNote,
    requestEscalation,
    getHistory: getResponderHistory
  },
  notifications: {
    getNotifications,
    markAsRead: markNotificationRead,
    markAllAsRead: markAllNotificationsRead
  },
  history: {
    getHistory
  },
  chat: {
    sendMessage: sendChatMessage
  }
};
