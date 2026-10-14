/**
 * ResQNet Centralized API Service
 *
 * Connects the frontend to the deployed ResQNet Express backend.
 * MongoDB operations are handled by the backend; the frontend must
 * never connect directly to MongoDB.
 *
 * Local development can override the default using VITE_API_URL.
 */

const DEFAULT_API_URL =
  'https://resqnet-backend-uzne.onrender.com';

export const API_BASE_URL = (
  import.meta.env.VITE_API_URL || DEFAULT_API_URL
).replace(/\/+$/, '');

// ============================================================================
// Authentication Headers
// ============================================================================

function getAuthHeaders() {
  const token = localStorage.getItem('resqnet_token');

  const headers = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  return headers;
}

// ============================================================================
// Centralized HTTP Request Handler
// ============================================================================

export async function request(endpoint, options = {}) {
  const normalizedEndpoint = endpoint.startsWith('/')
    ? endpoint
    : `/${endpoint}`;

  const url = `${API_BASE_URL}${normalizedEndpoint}`;

  const headers = {
    ...getAuthHeaders(),
    ...(options.headers || {}),
  };

  let response;

  try {
    response = await fetch(url, {
      ...options,
      headers,
    });
  } catch (err) {
    // Network errors, DNS failures, CORS failures, and connection errors
    // can all cause fetch() to reject.
    const netError = new Error(
      'Unable to connect to ResQNet. Check your internet connection and try again.'
    );

    netError.isNetworkError = true;
    netError.cause = err;

    throw netError;
  }

  // Parse the response body safely. Some endpoints may return no JSON body.
  const contentType = response.headers.get('content-type') || '';

  let data = {};

  if (contentType.includes('application/json')) {
    data = await response.json().catch(() => ({}));
  } else {
    const text = await response.text().catch(() => '');
    data = text ? { message: text } : {};
  }

  // 401 Unauthorized: the token may be expired or invalid.
  if (response.status === 401) {
    localStorage.removeItem('resqnet_token');
    localStorage.removeItem('resqnet_user');
    localStorage.removeItem('resqnet_role');

    window.dispatchEvent(
      new CustomEvent('resqnet-auth-unauthorized')
    );

    const err = new Error(
      data.message ||
      'Your session has expired or is unauthorized. Please log in again.'
    );

    err.status = 401;
    err.data = data;

    throw err;
  }

  // 403 Forbidden: the user is authenticated but lacks permission.
  if (response.status === 403) {
    const err = new Error(
      data.message ||
      'You do not have permission to perform this action.'
    );

    err.status = 403;
    err.data = data;

    throw err;
  }

  // Handle all other unsuccessful HTTP responses.
  if (!response.ok) {
    let errorMsg = data.message || data.error;

    if (!errorMsg) {
      if (response.status === 404) {
        errorMsg = 'Requested resource not found.';
      } else if (response.status >= 500) {
        errorMsg =
          'ResQNet server error. Please try again later.';
      } else {
        errorMsg = `Request failed (HTTP ${response.status}).`;
      }
    }

    const err = new Error(errorMsg);

    err.status = response.status;
    err.data = data;

    throw err;
  }

  return data;
}

// ============================================================================
// Authentication Operations
// ============================================================================

export const login = (email, password) =>
  request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });

export const register = (userData) =>
  request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(userData),
  });

export const getMe = () => request('/api/auth/me');

// ============================================================================
// LoRa Gateway Operations
// ============================================================================

export const getLoraStatus = () =>
  request('/api/lora/status');

export const getLoraHistory = () =>
  request('/api/lora/history');

export const simulateLoraPacket = (payload = {}) =>
  request('/api/lora/simulate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const sendLoraMessage = (payload) =>
  request('/api/lora/message', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

// ============================================================================
// Admin Operations
// ============================================================================

export const getEmergencies = (params = '') =>
  request(`/api/admin/emergencies${params}`);

export const getEmergency = (id) =>
  request(`/api/emergencies/${encodeURIComponent(id)}`);

export const getResponders = () =>
  request('/api/admin/responders');

export const createResponder = (payload) =>
  request('/api/admin/responders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });

export const deleteResponder = (id) =>
  request(`/api/admin/responders/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });

export const clearDemoData = () =>
  request('/api/admin/clear-demo-data', {
    method: 'POST',
  });

export const getUsers = () =>
  request('/api/admin/users');

export const assignResponder = (id, payload) =>
  request(
    `/api/admin/emergencies/${encodeURIComponent(id)}/assign`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

export const reassignResponder = (id, payload) =>
  request(
    `/api/admin/emergencies/${encodeURIComponent(id)}/reassign`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

export const removeResponder = (id, responderId) =>
  request(
    `/api/admin/emergencies/${encodeURIComponent(id)}/responders/${encodeURIComponent(responderId)}`,
    {
      method: 'DELETE',
    }
  );

export const updatePriority = (id, payload) =>
  request(
    `/api/admin/emergencies/${encodeURIComponent(id)}/priority`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );

export const getAnalytics = () =>
  request('/api/admin/analytics');

export const getAuditLogs = () =>
  request('/api/admin/audit-logs');

export const getAdminHistory = () =>
  request('/api/admin/history');

// ============================================================================
// Responder Operations
// ============================================================================

export const getResponderEmergencies = () =>
  request('/api/responder/emergencies');

export const getResponderEmergency = (id) =>
  request(`/api/responder/emergencies/${encodeURIComponent(id)}`);

export const acceptAssignment = (id) =>
  request(
    `/api/responder/emergencies/${encodeURIComponent(id)}/accept`,
    {
      method: 'POST',
    }
  );

export const declineAssignment = (id, reason) =>
  request(
    `/api/responder/emergencies/${encodeURIComponent(id)}/decline`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }
  );

export const updateEmergencyStatus = (id, payload) =>
  request(
    `/api/responder/emergencies/${encodeURIComponent(id)}/status`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }
  );

export const updateResponderLocation = (coords) =>
  request('/api/responder/location', {
    method: 'PATCH',
    body: JSON.stringify(coords),
  });

export const updateResponderAvailability = (availability) =>
  request('/api/responder/availability', {
    method: 'PATCH',
    body: JSON.stringify({ availability }),
  });

export const addIncidentNote = (id, note) =>
  request(
    `/api/responder/emergencies/${encodeURIComponent(id)}/notes`,
    {
      method: 'POST',
      body: JSON.stringify({ note }),
    }
  );

export const requestEscalation = (id, payload) =>
  request(
    `/api/responder/emergencies/${encodeURIComponent(id)}/escalation-request`,
    {
      method: 'POST',
      body: JSON.stringify(payload),
    }
  );

export const getResponderHistory = () =>
  request('/api/responder/history');

// ============================================================================
// Notifications
// ============================================================================

export const getNotifications = () =>
  request('/api/notifications');

export const markNotificationRead = (id) =>
  request(`/api/notifications/${encodeURIComponent(id)}/read`, {
    method: 'PATCH',
  });

export const markAllNotificationsRead = () =>
  request('/api/notifications/read-all', {
    method: 'PATCH',
  });

// ============================================================================
// Unified History Getter
// ============================================================================

export const getHistory = (role) => {
  if (role === 'admin' || role === 'ADMIN') {
    return getAdminHistory();
  }

  return getResponderHistory();
};

// ============================================================================
// Emergency Chat
// ============================================================================

export const sendChatMessage = (id, payload) =>
  request(`/api/emergencies/${encodeURIComponent(id)}/chat`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });

// ============================================================================
// Namespace Export for Structured Access
// ============================================================================

export const api = {
  auth: {
    login,
    register,
    getMe,
  },

  lora: {
    getStatus: getLoraStatus,
    getHistory: getLoraHistory,
    simulate: simulateLoraPacket,
    sendMessage: sendLoraMessage,
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
    getHistory: getAdminHistory,
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
    getHistory: getResponderHistory,
  },

  notifications: {
    getNotifications,
    markAsRead: markNotificationRead,
    markAllAsRead: markAllNotificationsRead,
  },

  history: {
    getHistory,
  },

  chat: {
    sendMessage: sendChatMessage,
  },
};
