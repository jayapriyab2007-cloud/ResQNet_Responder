import React, { useState, useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import EmergencyCard from './components/EmergencyCard';
import PriorityBadge from './components/PriorityBadge';
import StatusBadge from './components/StatusBadge';
import EmergencyFilters from './components/EmergencyFilters';

import { api, API_BASE_URL } from './services/api';
import { initSocket, getSocket, disconnectSocket } from './services/socket';
import { normalizeEmergency, normalizeResponder } from './utils/normalizer';
import { queueOfflineAction, getQueuedActions, clearQueueItem } from './services/offline';

// ==========================================================
// RESQNET COMMAND CENTER — CONSTANTS & DEMO DATA
// (Clean local architecture prepared for future MongoDB / Socket.IO)
// ==========================================================

const TIMELINE_STEPS = [
  { id: 'SOS_CREATED', label: 'SOS Created', desc: 'Triggered by victim' },
  { id: 'SOS_SENT', label: 'SOS Sent', desc: 'Packet transmitted' },
  { id: 'SERVER_RECEIVED', label: 'Server Received', desc: 'Gateway acknowledged' },
  { id: 'TEAM_NOTIFIED', label: 'Team Notified', desc: 'Regional dispatch alert' },
  { id: 'RESPONDER_ASSIGNED', label: 'Responder Assigned', desc: 'Unit designated' },
  { id: 'RESPONDER_ACCEPTED', label: 'Responder Accepted', desc: 'Mission acknowledged' },
  { id: 'ON_THE_WAY', label: 'On The Way', desc: 'En route to coordinates' },
  { id: 'ARRIVED', label: 'Arrived', desc: 'On-scene arrival' },
  { id: 'SERVICE_STARTED', label: 'Service Started', desc: 'Active triage / rescue' },
  { id: 'RESOLVED', label: 'Resolved', desc: 'Incident cleared' }
];

const EMERGENCY_TYPES = [
  'Flood', 'Cyclone', 'Earthquake', 'Fire', 'Forest Fire',
  'Tsunami', 'Landslide', 'Heatwave', 'Medical Emergency',
  'Safety / Crime', 'Other'
];


const getEmergencyIcon = (type) => {
  switch (type) {
    case 'Flood': return '🌊';
    case 'Cyclone': return '🌀';
    case 'Fire': return '🔥';
    case 'Forest Fire': return '🌲🔥';
    case 'Tsunami': return '🌊⚠️';
    case 'Landslide': return '⛰️';
    case 'Heatwave': return '☀️';
    case 'Medical Emergency': return '🚑';
    case 'Earthquake': return '⚡';
    case 'Safety / Crime': return '🛡️';
    default: return '🚨';
  }
};

function App() {
  // Session & Auth
  const [currentRole, setCurrentRole] = useState(() => localStorage.getItem('resqnet_role') || null);
  const [currentUser, setCurrentUser] = useState(() => {
    try {
      const u = localStorage.getItem('resqnet_user');
      return u ? JSON.parse(u) : null;
    } catch (e) {
      return null;
    }
  });
  const [serverConnected, setServerConnected] = useState(false);
  const [backendLoading, setBackendLoading] = useState(false);
  const [authView, setAuthView] = useState('role_select');
  const [authRole, setAuthRole] = useState('admin'); // 'admin' | 'responder'
  const [authMode, setAuthMode] = useState('register'); // 'register' (default) | 'login'
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [authError, setAuthError] = useState('');
  const [authSuccessMsg, setAuthSuccessMsg] = useState('');

  // Registration Form States
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [regConfirmPassword, setRegConfirmPassword] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regBloodGroup, setRegBloodGroup] = useState('O+');
  const [regSpecialization, setRegSpecialization] = useState('Swift Water & Flood Rescue');
  const [regTeam, setRegTeam] = useState('Rescue Squad Alpha');

  // LoRa Gateway and Responder Modal States
  const [showLoraModal, setShowLoraModal] = useState(false);
  const [showAddResponderModal, setShowAddResponderModal] = useState(false);
  const [loraFilterOnly, setLoraFilterOnly] = useState(false);
  const [newRespName, setNewRespName] = useState('');
  const [newRespEmail, setNewRespEmail] = useState('');
  const [newRespPhone, setNewRespPhone] = useState('');
  const [newRespPassword, setNewRespPassword] = useState('');
  const [newRespSpecialization, setNewRespSpecialization] = useState('Swift Water & Flood Rescue');
  const [newRespTeam, setNewRespTeam] = useState('Rapid Rescue Alpha');
  const [newRespBlood, setNewRespBlood] = useState('O+');

  // Profiles State (Dynamically derived from authenticated MongoDB record)
  const [adminProfile, setAdminProfile] = useState(() => {
    try {
      const u = localStorage.getItem('resqnet_user');
      const user = u ? JSON.parse(u) : null;
      if (user && (user.role === 'ADMIN' || user.role === 'admin')) {
        return {
          name: user.name || 'Command Administrator',
          adminId: user.responder_id || 'ADM-01',
          role: user.specialization || 'Regional Dispatch Administrator',
          email: user.email || '',
          phone: user.phone || '',
          department: user.team || 'Emergency Command & Rescue Coordination Center',
          status: 'Active • Encrypted Session'
        };
      }
    } catch (e) {}
    return {
      name: 'Command Administrator',
      adminId: 'ADM-01',
      role: 'Regional Dispatch Administrator',
      email: '',
      phone: '',
      department: 'Emergency Command & Rescue Coordination Center',
      status: 'Active • Encrypted Session'
    };
  });

  const [responderProfile, setResponderProfile] = useState(() => {
    try {
      const u = localStorage.getItem('resqnet_user');
      const user = u ? JSON.parse(u) : null;
      if (user && (user.role === 'RESPONDER' || user.role === 'responder')) {
        return {
          name: user.name || 'Field Rescuer',
          responderId: user.responder_id || 'RSP-01',
          role: user.specialization || 'Tactical Rescue Specialist',
          specialization: user.specialization || 'General Field Rescue',
          team: user.team || 'Rescue Squad Alpha',
          phone: user.phone || '',
          email: user.email || '',
          availability: user.availability ? (user.availability === 'AVAILABLE' ? 'Available' : (user.availability === 'BUSY' ? 'Busy' : 'Offline')) : 'Available',
          experience: 'Certified Field Unit',
          emergenciesHandled: 0,
          emergenciesResolved: 0,
          avgResponseTime: '00:00'
        };
      }
    } catch (e) {}
    return {
      name: 'Field Rescuer',
      responderId: 'RSP-01',
      role: 'Tactical Rescue Specialist',
      specialization: 'General Field Rescue',
      team: 'Rescue Squad Alpha',
      phone: '',
      email: '',
      availability: 'Available',
      experience: 'Certified Field Unit',
      emergenciesHandled: 0,
      emergenciesResolved: 0,
      avgResponseTime: '00:00'
    };
  });

  // Navigation: 'dashboard' | 'emergencies' | 'map' | 'history' | 'responders' | 'analytics' | 'notifications' | 'profile' | 'emergency_details'
  const [activeScreen, setActiveScreen] = useState('dashboard');
  const [selectedEmergencyId, setSelectedEmergencyId] = useState(null);

  // Operational Data State - Real MongoDB data (initialized empty; loaded from API)
  const [emergencies, setEmergencies] = useState([]);
  const [historyList, setHistoryList] = useState([]);
  const [responders, setResponders] = useState([]);
  const [auditLogs, setAuditLogs] = useState([]);
  const [notifications, setNotifications] = useState([]);

  // Hardware / System Telemetry
  const [gpsStatus, setGpsStatus] = useState('GPS Checking...');
  const [gpsCoords, setGpsCoords] = useState(null);
  const [globalConnection, setGlobalConnection] = useState('ONLINE'); // ONLINE | OFFLINE | LORA | DISCONNECTED

  // Map Filter & Selection State
  const [mapSelectedEmergencyId, setMapSelectedEmergencyId] = useState(null);
  const [mapSelectedResponderId, setMapSelectedResponderId] = useState(null);
  const [mapTypeFilter, setMapTypeFilter] = useState('ALL');
  const [mapPriorityFilter, setMapPriorityFilter] = useState('ALL');
  const [mapStatusFilter, setMapStatusFilter] = useState('ALL');
  const [mapShowResponders, setMapShowResponders] = useState(true);
  const [mapShowHospitals, setMapShowHospitals] = useState(true);

  // Responders Roster Controls State
  const [rosterSearch, setRosterSearch] = useState('');
  const [rosterAvailFilter, setRosterAvailFilter] = useState('ALL');
  const [rosterTeamFilter, setRosterTeamFilter] = useState('ALL');
  const [rosterViewMode, setRosterViewMode] = useState('cards'); // 'cards' | 'table'
  const [selectedProfileResponder, setSelectedProfileResponder] = useState(null);
  const [contactModalResponder, setContactModalResponder] = useState(null);
  const [dispatchModalResponder, setDispatchModalResponder] = useState(null);

  // History Controls State
  const [historyTypeFilter, setHistoryTypeFilter] = useState('ALL');
  const [historyStatusFilter, setHistoryStatusFilter] = useState('ALL');
  const [historySearchQuery, setHistorySearchQuery] = useState('');
  const [selectedHistoryItem, setSelectedHistoryItem] = useState(null);

  // Operational Emergency Queue Filters
  const [priorityFilter, setPriorityFilter] = useState('ALL');
  const [queueSearchQuery, setQueueSearchQuery] = useState('');
  const [queueTypeFilter, setQueueTypeFilter] = useState('ALL');
  const [queueStatusFilter, setQueueStatusFilter] = useState('ALL');
  const [queueAssignmentFilter, setQueueAssignmentFilter] = useState('ALL'); // 'ALL' | 'UNASSIGNED' | 'ASSIGNED'
  const [queueSortBy, setQueueSortBy] = useState('PRIORITY'); // 'PRIORITY' | 'NEWEST'
  const [assignModalEmergency, setAssignModalEmergency] = useState(null);

  // Incident Details & Interactive State
  const [newNoteText, setNewNoteText] = useState('');
  const [newChatMessage, setNewChatMessage] = useState('');
  const [chatMode, setChatMode] = useState('INTERNET');
  const [escalationReason, setEscalationReason] = useState('');
  const [showEscalationModal, setShowEscalationModal] = useState(false);
  const [assigningMode, setAssigningMode] = useState(null);
  const [notificationToast, setNotificationToast] = useState(null);

  // Profile Modals
  const [showEditProfileModal, setShowEditProfileModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [passwordForm, setPasswordForm] = useState({ current: '', newPass: '', confirm: '' });

  // Map refs
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);

  // Purge any stale legacy demo cache keys on startup
  useEffect(() => {
    ['resqnet_emergencies_v3', 'resqnet_history_v3', 'resqnet_responders_v3', 'resqnet_audit_v3', 'resqnet_notifications_v3'].forEach(k => {
      localStorage.removeItem(k);
    });
  }, []);

  // Listen for unauthorized 401 events from api service
  useEffect(() => {
    const handleUnauthorized = () => {
      setCurrentRole(null);
      setCurrentUser(null);
      setAuthView('role_select');
      setAuthError('Session expired or unauthorized. Please authenticate again.');
    };
    window.addEventListener('resqnet-auth-unauthorized', handleUnauthorized);
    return () => window.removeEventListener('resqnet-auth-unauthorized', handleUnauthorized);
  }, []);

  // Synchronize selection IDs when emergencies list changes
  useEffect(() => {
    if (emergencies.length > 0) {
      if (!selectedEmergencyId || !emergencies.some(e => e.id === selectedEmergencyId)) {
        setSelectedEmergencyId(emergencies[0].id);
      }
      if (!mapSelectedEmergencyId || !emergencies.some(e => e.id === mapSelectedEmergencyId)) {
        setMapSelectedEmergencyId(emergencies[0].id);
      }
    } else {
      setSelectedEmergencyId(null);
      setMapSelectedEmergencyId(null);
    }
  }, [emergencies]);

  // Request Real Device Geolocation (No hardcoded coordinates)
  const requestLocation = () => {
    if (!navigator.geolocation) {
      setGpsStatus('GPS Unavailable');
      return;
    }
    setGpsStatus('Acquiring GPS...');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsStatus('GPS Active');
        setGpsCoords({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy: Math.round(pos.coords.accuracy)
        });
        showToast(`GPS Position Acquired: ${pos.coords.latitude.toFixed(4)}, ${pos.coords.longitude.toFixed(4)} (±${Math.round(pos.coords.accuracy)}m)`);
        const role = localStorage.getItem('resqnet_role');
        if (role === 'responder') {
          api.responder.updateLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy),
            timestamp: new Date().toISOString()
          }).catch(err => console.warn('Could not sync location to backend:', err.message));
        }
      },
      (err) => {
        console.warn('Geolocation warning:', err.message);
        setGpsStatus('GPS Unavailable');
      },
      { timeout: 10000, enableHighAccuracy: true }
    );
  };

  // Load real data from Unified Express Backend (MongoDB Atlas)
  const loadBackendData = async (roleOverride) => {
    const token = localStorage.getItem('resqnet_token');
    const role = (roleOverride || localStorage.getItem('resqnet_role') || '').toLowerCase();
    if (!token) return;

    setBackendLoading(true);
    try {
      if (role === 'admin') {
        const [emRes, respRes, logsRes, histRes] = await Promise.allSettled([
          api.admin.getEmergencies(),
          api.admin.getResponders(),
          api.admin.getAuditLogs(),
          api.admin.getHistory()
        ]);

        if (emRes.status === 'fulfilled' && emRes.value?.emergencies) {
          const list = emRes.value.emergencies.map(normalizeEmergency);
          setEmergencies(list);
          if (list.length > 0) {
            setSelectedEmergencyId(prev => prev && list.some(e => e.id === prev) ? prev : list[0].id);
            setMapSelectedEmergencyId(prev => prev && list.some(e => e.id === prev) ? prev : list[0].id);
          }
        } else {
          setEmergencies([]);
        }

        if (respRes.status === 'fulfilled' && respRes.value?.responders) {
          setResponders(respRes.value.responders.map(normalizeResponder));
        } else {
          setResponders([]);
        }

        if (logsRes.status === 'fulfilled' && logsRes.value?.logs) {
          setAuditLogs(logsRes.value.logs);
        } else {
          setAuditLogs([]);
        }

        if (histRes.status === 'fulfilled' && histRes.value?.history) {
          setHistoryList(histRes.value.history.map(normalizeHistoryItem));
        } else {
          setHistoryList([]);
        }
      } else if (role === 'responder') {
        const [emRes, histRes] = await Promise.allSettled([
          api.responder.getEmergencies(),
          api.responder.getHistory()
        ]);

        if (emRes.status === 'fulfilled' && emRes.value?.emergencies) {
          const list = emRes.value.emergencies.map(normalizeEmergency);
          setEmergencies(list);
          if (list.length > 0) {
            setSelectedEmergencyId(prev => prev && list.some(e => e.id === prev) ? prev : list[0].id);
            setMapSelectedEmergencyId(prev => prev && list.some(e => e.id === prev) ? prev : list[0].id);
          }
        } else {
          setEmergencies([]);
        }

        if (histRes.status === 'fulfilled' && histRes.value?.history) {
          setHistoryList(histRes.value.history.map(normalizeHistoryItem));
        } else {
          setHistoryList([]);
        }
      }

      const notifRes = await api.notifications.getNotifications().catch(() => null);
      if (notifRes && notifRes.notifications) {
        setNotifications(notifRes.notifications);
      } else {
        setNotifications([]);
      }

      setServerConnected(true);
      setGlobalConnection('ONLINE');
    } catch (err) {
      console.warn('[BACKEND] Error loading data from server:', err.message);
      setServerConnected(false);
    } finally {
      setBackendLoading(false);
    }
  };

  // Device Geolocation Tracking & Continuous Watch
  useEffect(() => {
    requestLocation();

    let watchId = null;
    if (navigator.geolocation && currentRole === 'responder') {
      watchId = navigator.geolocation.watchPosition(
        (pos) => {
          setGpsCoords({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy)
          });
          api.responder.updateLocation({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: Math.round(pos.coords.accuracy),
            timestamp: new Date().toISOString()
          }).catch(() => {});
        },
        (err) => console.warn('GPS watch warning:', err.message),
        { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
      );
    }

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [currentRole]);

  // Socket.IO Real-Time Subscription Effect
  useEffect(() => {
    const token = localStorage.getItem('resqnet_token');
    const storedUser = localStorage.getItem('resqnet_user');
    let user = null;
    try { user = storedUser ? JSON.parse(storedUser) : null; } catch (e) {}

    if (token && user) {
      const socket = initSocket(user);

      socket.on('connect', () => {
        setServerConnected(true);
        setGlobalConnection('ONLINE');
      });

      socket.on('disconnect', () => {
        setServerConnected(false);
      });

      socket.on('new_emergency', (data) => {
        const normalized = normalizeEmergency(data);
        if (!normalized) return;
        setEmergencies(prev => {
          if (prev.some(e => e.id === normalized.id)) return prev;
          return [normalized, ...prev].sort((a, b) => a.priorityWeight - b.priorityWeight);
        });
        showToast(`🚨 Live SOS Alert: ${normalized.type} (${normalized.priority})`);
      });

      socket.on('emergency_assigned', (data) => {
        const updated = normalizeEmergency(data.emergency || data);
        if (!updated) return;
        setEmergencies(prev => {
          if (currentRole === 'responder') {
            const isAssignedToMe = (updated.assignedResponders || []).some(
              r => r.id === user.id || r.responder_id === user.responder_id || r.name === user.name
            );
            if (isAssignedToMe) {
              return prev.some(e => e.id === updated.id)
                ? prev.map(e => e.id === updated.id ? updated : e)
                : [updated, ...prev];
            } else {
              return prev.filter(e => e.id !== updated.id);
            }
          }
          return prev.map(e => e.id === updated.id ? updated : e);
        });
        showToast(`🛡️ Unit Dispatched: ${updated.id}`);
      });

      socket.on('emergency_updated', (data) => {
        const updated = normalizeEmergency(data);
        if (!updated) return;
        setEmergencies(prev => prev.map(e => e.id === updated.id ? updated : e));
      });

      socket.on('emergency_status_changed', (data) => {
        setEmergencies(prev => prev.map(e => {
          if (e.id === data.emergency_id) {
            return { ...e, status: data.status, statusLabel: data.status.replace(/_/g, ' ') };
          }
          return e;
        }));
      });

      socket.on('responder_location_updated', (data) => {
        setResponders(prev => prev.map(r => {
          if (r.id === data.responder_id || r.responder_id === data.responder_id) {
            return {
              ...r,
              lat: data.latitude,
              lng: data.longitude,
              location: `Lat ${data.latitude.toFixed(4)}, Lng ${data.longitude.toFixed(4)}`
            };
          }
          return r;
        }));
      });

      socket.on('responder_status_updated', (data) => {
        setResponders(prev => prev.map(r => {
          if (r.id === data.responder_id || r.responder_id === data.responder_id) {
            const availFormatted = data.availability === 'AVAILABLE' ? 'Available' : (data.availability === 'BUSY' ? 'Busy' : 'Offline');
            return { ...r, availability: availFormatted, rawAvailability: data.availability };
          }
          return r;
        }));
      });

      socket.on('notification_created', (data) => {
        setNotifications(prev => [data, ...prev]);
        showToast(`🔔 ${data.title || 'Notification'}: ${data.message || data.body || ''}`);
      });

      socket.on('message_received', (data) => {
        if (data && data.emergency_id && data.message) {
          setEmergencies(prev => prev.map(e => {
            if (e.id === data.emergency_id) {
              return { ...e, chatMessages: [...(e.chatMessages || []), data.message] };
            }
            return e;
          }));
        }
      });

      loadBackendData();
    }

    return () => {
      disconnectSocket();
    };
  }, [currentRole]);

  const showToast = (msg) => {
    setNotificationToast(msg);
    setTimeout(() => {
      setNotificationToast((curr) => (curr === msg ? null : curr));
    }, 4000);
  };

  const addAuditLog = (action, details, incidentId = 'SYSTEM') => {
    const newEntry = {
      id: `aud-${Date.now()}`,
      action,
      user: currentRole === 'admin' ? adminProfile.email : responderProfile.email,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      incidentId,
      details
    };
    setAuditLogs(prev => [newEntry, ...prev]);
  };

  // ==========================================================
  // 1. TACTICAL LEAFLET MAP IMPLEMENTATION
  // (Pure Leaflet + Standard OpenStreetMap TileLayer)
  // ZERO Google Maps / ZERO API Keys / ZERO Token Required
  // ==========================================================

  useEffect(() => {
    if (activeScreen !== 'map' && activeScreen !== 'emergency_details') {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
      return;
    }

    if (!mapContainerRef.current) return;

    if (!mapInstanceRef.current) {
      const map = L.map(mapContainerRef.current, {
        center: [12.8342, 79.7036],
        zoom: 12,
        zoomControl: true
      });

      // Standard OpenStreetMap Tile Layer (100% Free, Public, Zero API Key / Token Required)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors',
        maxZoom: 19
      }).addTo(map);

      const markersGroup = L.layerGroup().addTo(map);
      markersLayerRef.current = markersGroup;
      mapInstanceRef.current = map;
    }

    // Refresh markers on tactical map canvas
    if (markersLayerRef.current && mapInstanceRef.current) {
      markersLayerRef.current.clearLayers();

      // Filter emergencies based on map filter controls
      const visibleEmergencies = emergencies.filter(em => {
        if (mapTypeFilter !== 'ALL' && em.type !== mapTypeFilter) return false;
        if (mapPriorityFilter !== 'ALL' && !em.priority.startsWith(mapPriorityFilter)) return false;
        if (mapStatusFilter === 'WAITING' && em.status !== 'TEAM_NOTIFIED' && em.status !== 'SOS_CREATED') return false;
        if (mapStatusFilter === 'ASSIGNED' && em.status !== 'RESPONDER_ASSIGNED' && em.status !== 'RESPONDER_ACCEPTED') return false;
        if (mapStatusFilter === 'EN_ROUTE' && em.status !== 'ON_THE_WAY' && em.status !== 'ARRIVED' && em.status !== 'SERVICE_STARTED') return false;
        return true;
      });

      // Plot Emergency Markers
      visibleEmergencies.forEach(em => {
        const isSelected = em.id === mapSelectedEmergencyId;
        const priorityClass = em.priority.startsWith('P1') ? 'marker-p1' : em.priority.startsWith('P2') ? 'marker-p2' : 'marker-p3';
        
        const emIcon = L.divIcon({
          className: 'custom-leaflet-marker',
          html: `
            <div class="tactical-marker-em ${isSelected ? 'selected-marker' : ''} ${priorityClass}">
              <span class="marker-icon">${getEmergencyIcon(em.type)}</span>
              ${isSelected ? '<span class="pulse-ring"></span>' : ''}
            </div>
          `,
          iconSize: [38, 38],
          iconAnchor: [19, 19]
        });

        const marker = L.marker([em.lat, em.lng], { icon: emIcon }).addTo(markersLayerRef.current);
        marker.bindPopup(`
          <div class="map-popup-card">
            <div class="popup-title">🚨 ${em.id}</div>
            <div class="popup-meta">${em.type} • <strong>${em.priority}</strong></div>
            <div class="popup-loc">📍 ${em.location}</div>
            <div class="popup-status">Status: ${em.statusLabel}</div>
            <div class="popup-assigned">Assigned Units: ${em.assignedResponders.length}</div>
          </div>
        `);

        marker.on('click', () => {
          setMapSelectedEmergencyId(em.id);
          setMapSelectedResponderId(null);
        });
      });

      // Plot Responder Markers (if enabled)
      if (mapShowResponders) {
        responders.forEach(resp => {
          const isMe = currentRole === 'responder' && resp.name === responderProfile.name;
          const isSelected = resp.id === mapSelectedResponderId;
          const statusClass = resp.availability === 'Available' ? 'resp-avail' : resp.availability === 'Busy' ? 'resp-busy' : 'resp-offline';

          const respIcon = L.divIcon({
            className: 'custom-leaflet-marker',
            html: `
              <div class="tactical-marker-resp ${isMe ? 'marker-me' : ''} ${isSelected ? 'selected-resp' : ''} ${statusClass}">
                <span class="marker-dot"></span>
                <span class="marker-initial">${resp.name.charAt(0)}</span>
              </div>
            `,
            iconSize: [32, 32],
            iconAnchor: [16, 16]
          });

          const rMarker = L.marker([resp.lat, resp.lng], { icon: respIcon }).addTo(markersLayerRef.current);
          rMarker.bindPopup(`
            <div class="map-popup-card">
              <div class="popup-title">📍 ${resp.name} ${isMe ? '(YOU)' : ''}</div>
              <div class="popup-meta">${resp.role} • ${resp.team}</div>
              <div class="popup-loc">Status: ${resp.availability}</div>
              <div class="popup-status">Link: ${resp.connection}</div>
              <div class="popup-assigned">Assignment: ${resp.currentEmergencyId || 'Standby'}</div>
            </div>
          `);

          rMarker.on('click', () => {
            setMapSelectedResponderId(resp.id);
          });
        });
      }

      // Plot Hospital & Safe Point Markers (if enabled)
      if (mapShowHospitals) {
        const selectedEm = emergencies.find(e => e.id === mapSelectedEmergencyId);
        if (selectedEm && selectedEm.hospitals) {
          selectedEm.hospitals.forEach(hosp => {
            const hospIcon = L.divIcon({
              className: 'custom-leaflet-marker',
              html: `<div class="tactical-marker-hosp">🏥</div>`,
              iconSize: [28, 28],
              iconAnchor: [14, 14]
            });
            const hMarker = L.marker([hosp.lat, hosp.lng], { icon: hospIcon }).addTo(markersLayerRef.current);
            hMarker.bindPopup(`
              <div class="map-popup-card">
                <div class="popup-title">🏥 ${hosp.name}</div>
                <div class="popup-meta">${hosp.type} • ${hosp.distance}</div>
                <div class="popup-loc">Designated Evacuation & Trauma Safe Point</div>
              </div>
            `);
          });
        }
      }
    }
  }, [
    activeScreen,
    mapSelectedEmergencyId,
    mapSelectedResponderId,
    mapTypeFilter,
    mapPriorityFilter,
    mapStatusFilter,
    mapShowResponders,
    mapShowHospitals,
    emergencies,
    responders,
    currentRole,
    responderProfile.name
  ]);

  // Fit all markers in map bounds
  const handleFitAllMarkers = () => {
    if (!mapInstanceRef.current) return;
    const allCoords = [];
    emergencies.forEach(e => allCoords.push([e.lat, e.lng]));
    if (mapShowResponders) responders.forEach(r => allCoords.push([r.lat, r.lng]));

    if (allCoords.length > 0) {
      const bounds = L.latLngBounds(allCoords);
      mapInstanceRef.current.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      showToast('Framed all operational emergency & responder coordinates');
    }
  };

  const handleCenterOnEmergency = (em) => {
    setMapSelectedEmergencyId(em.id);
    setMapSelectedResponderId(null);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([em.lat, em.lng], 14, { duration: 1.2 });
    }
  };

  const handleCenterOnResponder = (resp) => {
    setMapSelectedResponderId(resp.id);
    setActiveScreen('map');
    setTimeout(() => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.flyTo([resp.lat, resp.lng], 15, { duration: 1.2 });
        showToast(`Centered on Responder: ${resp.name} (${resp.location})`);
      }
    }, 150);
  };

  const handleCenterOnMyLocation = () => {
    const me = responders.find(r => r.name === responderProfile.name);
    if (me && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([me.lat, me.lng], 15, { duration: 1.2 });
      showToast(`Centered on Your Location (${me.location})`);
    } else if (gpsCoords && mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([gpsCoords.lat, gpsCoords.lng], 15, { duration: 1.2 });
      showToast(`Centered on Device GPS Position`);
    } else {
      showToast('Live GPS coordinates unavailable.');
    }
  };

  // ==========================================================
  // AUTHENTICATION & SESSION LOGIC
  // ==========================================================

  const handleRoleSelection = (role) => {
    setAuthError('');
    setAuthSuccessMsg('');
    setAuthRole(role);
    setAuthMode('register'); // Show Register page before Login page!
    setLoginEmail('');
    setLoginPassword('');
    setRegName('');
    setRegEmail('');
    setRegPassword('');
    setRegConfirmPassword('');
    setRegPhone('');
    setAuthView('auth_gateway');
  };

  const handleRegisterSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setAuthError('');
    setAuthSuccessMsg('');

    if (!regName.trim()) {
      setAuthError('Please enter your full name.');
      return;
    }
    if (!regEmail.trim()) {
      setAuthError('Please enter your email address (e.g. name@gmail.com).');
      return;
    }
    if (regPassword.length < 6) {
      setAuthError('Password must be at least 6 characters long.');
      return;
    }
    if (regPassword !== regConfirmPassword) {
      setAuthError('Passwords do not match. Please verify.');
      return;
    }

    setBackendLoading(true);
    try {
      const roleToRegister = authRole === 'admin' ? 'ADMIN' : 'RESPONDER';
      const payload = {
        name: regName.trim(),
        email: regEmail.trim(),
        password: regPassword,
        confirm_password: regConfirmPassword,
        phone: regPhone.trim(),
        blood_group: regBloodGroup,
        role: roleToRegister,
        specialization: authRole === 'admin' ? 'Command Center Dispatch' : regSpecialization,
        team: authRole === 'admin' ? 'HQ Operations' : regTeam
      };

      const data = await api.auth.register(payload);
      if (!data || !data.token || !data.user) {
        throw new Error(data.message || 'Registration failed. Please check inputs.');
      }

      showToast(`Account created successfully! Welcome, ${data.user.name}`);

      const role = (data.user.role || roleToRegister).toLowerCase();
      localStorage.setItem('resqnet_token', data.token);
      localStorage.setItem('resqnet_user', JSON.stringify(data.user));
      localStorage.setItem('resqnet_role', role);

      setCurrentUser(data.user);
      setCurrentRole(role);
      setActiveScreen('dashboard');

      if (role === 'admin') {
        setAdminProfile({
          name: data.user.name,
          adminId: data.user.responder_id || 'ADM-01',
          role: data.user.specialization || 'Regional Dispatch Administrator',
          email: data.user.email,
          phone: data.user.phone || '',
          department: data.user.team || 'Emergency Command & Rescue Coordination Center',
          status: 'Active • Encrypted Session'
        });
        addAuditLog('Admin Registration', `Administrator ${data.user.name} registered and started command session`);
      } else {
        setResponderProfile({
          name: data.user.name,
          responderId: data.user.responder_id || 'RSP-01',
          role: data.user.specialization || 'Tactical Rescue Specialist',
          specialization: data.user.specialization || 'General Field Rescue',
          team: data.user.team || 'Rescue Squad Alpha',
          phone: data.user.phone || '',
          email: data.user.email,
          availability: 'Available',
          experience: 'Certified Field Unit',
          emergenciesHandled: 0,
          emergenciesResolved: 0,
          avgResponseTime: '00:00'
        });
        addAuditLog('Responder Registration', `Rescuer ${data.user.name} registered and activated`);
      }

      initSocket(data.user);
      await loadBackendData(role);
    } catch (err) {
      console.error('Registration attempt failed:', err);
      setAuthError(err.message || 'Registration failed. Please check your information.');
    } finally {
      setBackendLoading(false);
    }
  };

  const handleLoginSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    setAuthError('');
    setBackendLoading(true);

    try {
      const data = await api.auth.login(loginEmail, loginPassword);
      if (!data || !data.token || !data.user) {
        throw new Error('Invalid response received from authentication service.');
      }

      const userRole = (data.user.role || '').toUpperCase();

      if (authRole === 'admin' && userRole !== 'ADMIN') {
        throw new Error('Access Denied: This portal requires an ADMIN account. Your account role is ' + userRole + '.');
      }

      if (authRole === 'responder' && userRole !== 'RESPONDER') {
        throw new Error('Access Denied: This terminal requires a RESPONDER account. Your account role is ' + userRole + '.');
      }

      const role = userRole.toLowerCase();
      localStorage.setItem('resqnet_token', data.token);
      localStorage.setItem('resqnet_user', JSON.stringify(data.user));
      localStorage.setItem('resqnet_role', role);

      setCurrentUser(data.user);
      setCurrentRole(role);
      setActiveScreen('dashboard');

      if (role === 'admin') {
        setAdminProfile({
          name: data.user.name || 'Command Administrator',
          adminId: data.user.responder_id || 'ADM-01',
          role: data.user.specialization || 'Regional Dispatch Administrator',
          email: data.user.email || '',
          phone: data.user.phone || '',
          department: data.user.team || 'Emergency Command & Rescue Coordination Center',
          status: 'Active • Encrypted Session'
        });
        addAuditLog('Admin Login', `Administrator ${data.user.name} authenticated via MongoDB Atlas`);
        showToast(`Authenticated as Administrator: ${data.user.name}`);
      } else {
        const rawAvail = (data.user.availability || 'AVAILABLE').toUpperCase();
        const formattedAvail = rawAvail === 'AVAILABLE' ? 'Available' : (rawAvail === 'BUSY' ? 'Busy' : 'Offline');
        setResponderProfile({
          name: data.user.name || 'Field Rescuer',
          responderId: data.user.responder_id || 'RSP-01',
          role: data.user.specialization || 'Tactical Rescue Specialist',
          specialization: data.user.specialization || 'General Field Rescue',
          team: data.user.team || 'Rescue Squad Alpha',
          phone: data.user.phone || '',
          email: data.user.email || '',
          availability: formattedAvail,
          experience: 'Certified Field Unit',
          emergenciesHandled: 0,
          emergenciesResolved: 0,
          avgResponseTime: '00:00'
        });
        addAuditLog('Responder Login', `Responder ${data.user.name} authenticated via MongoDB Atlas`);
        showToast(`Authenticated as Responder: ${data.user.name}`);
      }

      initSocket(data.user);
      await loadBackendData(role);
    } catch (err) {
      console.error('Authentication attempt failed:', err);
      if (err.isNetworkError || err.message?.includes('fetch') || err.message?.includes('unavailable')) {
        setAuthError('ResQNet backend is unavailable. Please verify http://localhost:5000 is online and retry.');
      } else {
        setAuthError(err.message || 'Login failed. Please verify credentials.');
      }
    } finally {
      setBackendLoading(false);
    }
  };

  const handleAddResponderSubmit = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!newRespName.trim() || !newRespEmail.trim()) {
      showToast('Name and email are required to register a rescuer.');
      return;
    }
    try {
      setBackendLoading(true);
      const res = await api.admin.createResponder({
        name: newRespName.trim(),
        email: newRespEmail.trim(),
        phone: newRespPhone.trim(),
        password: newRespPassword || 'responder123',
        specialization: newRespSpecialization,
        team: newRespTeam,
        blood_group: newRespBlood
      });
      if (res && res.responder) {
        showToast(`Rescuer unit ${res.responder.name} onboarded successfully!`);
        setResponders(prev => [normalizeResponder(res.responder), ...prev]);
        setShowAddResponderModal(false);
        setNewRespName('');
        setNewRespEmail('');
        setNewRespPhone('');
        setNewRespPassword('');
      }
    } catch (err) {
      showToast(err.message || 'Failed to onboard rescuer.');
    } finally {
      setBackendLoading(false);
    }
  };

  const handleDeleteResponder = async (responderId, responderName) => {
    if (!window.confirm(`Are you sure you want to decommission rescuer ${responderName}?`)) return;
    try {
      await api.admin.deleteResponder(responderId);
      setResponders(prev => prev.filter(r => r.id !== responderId && r.responder_id !== responderId));
      showToast(`Rescuer unit ${responderName} decommissioned.`);
    } catch (err) {
      showToast(err.message || 'Failed to delete rescuer.');
    }
  };

  const handleSimulateLoraPacket = async () => {
    try {
      showToast('Simulating incoming ESP32 LoRa rescue transmission...');
      const res = await api.lora.simulate();
      if (res && res.emergency) {
        showToast(`📡 LoRa Emergency Received: ${res.emergency.emergency_id}!`);
      }
    } catch (err) {
      showToast(err.message || 'LoRa simulation failed.');
    }
  };

  const handleLogout = () => {
    addAuditLog('User Logout', `${currentRole} session terminated`);
    localStorage.removeItem('resqnet_token');
    localStorage.removeItem('resqnet_user');
    localStorage.removeItem('resqnet_role');
    disconnectSocket();
    setCurrentUser(null);
    setCurrentRole(null);
    setAuthView('role_select');
    setActiveScreen('dashboard');
    showToast('Logged out securely');
  };

  // ==========================================================
  // INCIDENT MANAGEMENT & DISPATCH
  // ==========================================================

  const selectedEmergency = emergencies.find(e => e.id === selectedEmergencyId) || emergencies[0] || null;

  const handleViewEmergency = (id) => {
    setSelectedEmergencyId(id);
    setActiveScreen('emergency_details');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Track emergency / team on Tactical Map
  const handleTrackEmergency = (em) => {
    if (!em) return;
    setMapSelectedEmergencyId(em.id);
    setActiveScreen('map');
    setTimeout(() => {
      if (mapInstanceRef.current && em.lat && em.lng) {
        mapInstanceRef.current.flyTo([em.lat, em.lng], 15, { duration: 1.2 });
        showToast(`Tracking Incident: ${em.id} (${em.location})`);
      }
    }, 200);
  };

  // Admin Priority Escalation
  const handleAdminEscalatePriority = async (emergencyId, newPriority) => {
    let weight = 4;
    const prioKey = newPriority.slice(0, 2);
    if (newPriority.startsWith('P1')) weight = 1;
    else if (newPriority.startsWith('P2')) weight = 2;
    else if (newPriority.startsWith('P3')) weight = 3;

    try {
      const res = await api.admin.updatePriority(emergencyId, { priority: prioKey, reason: 'Command Center escalation' });
      if (res && res.emergency) {
        const updated = normalizeEmergency(res.emergency);
        setEmergencies(prev => prev.map(em => em.id === updated.id ? updated : em));
      } else {
        setEmergencies(prev => prev.map(em => em.id === emergencyId ? { ...em, priority: newPriority, priorityWeight: weight, escalationRequest: null } : em));
      }
      addAuditLog('Priority Escalation', `Priority updated to ${newPriority} in MongoDB`, emergencyId);
      showToast(`Incident ${emergencyId} updated to ${newPriority}`);
    } catch (err) {
      console.warn('Backend priority update error:', err.message);
      showToast(`Failed to update priority: ${err.message}`);
    }
  };

  // Responder requests Priority Escalation
  const handleSubmitEscalationRequest = async (e) => {
    e.preventDefault();
    if (!selectedEmergency || !escalationReason.trim()) return;

    try {
      const res = await api.responder.requestEscalation(selectedEmergency.id, {
        requested_priority: 'P1',
        reason: escalationReason.trim()
      });

      if (res && res.emergency) {
        const updated = normalizeEmergency(res.emergency);
        setEmergencies(prev => prev.map(em => em.id === updated.id ? updated : em));
      } else {
        setEmergencies(prev => prev.map(em => {
          if (em.id === selectedEmergency.id) {
            return {
              ...em,
              escalationRequest: {
                requestedBy: responderProfile.name,
                targetPriority: 'P1 - Critical',
                reason: escalationReason.trim(),
                timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
              }
            };
          }
          return em;
        }));
      }

      const newNotif = {
        id: `notif-${Date.now()}`,
        title: `⚡ Priority Escalation: ${selectedEmergency.id}`,
        body: `${responderProfile.name} requested P1 escalation: "${escalationReason.trim()}"`,
        time: 'Just now',
        read: false,
        forRole: 'admin',
        type: 'escalation'
      };
      setNotifications(prev => [newNotif, ...prev]);

      addAuditLog('Escalation Requested', `Responder requested P1 escalation: ${escalationReason.trim()}`, selectedEmergency.id);
      setShowEscalationModal(false);
      setEscalationReason('');
      showToast('Escalation request persisted and transmitted to Command Center');
    } catch (err) {
      console.warn('Backend escalation request error:', err.message);
      showToast(`Escalation request failed: ${err.message}`);
    }
  };

  const handleApproveEscalation = (emergencyId) => {
    handleAdminEscalatePriority(emergencyId, 'P1 - Critical');
    showToast('Escalation request approved. Priority set to P1.');
  };

  // Multi-Responder Assignment (Primary or Supporting)
  const handleAssignResponder = async (emergencyId, resp, isPrimary) => {
    try {
      const respId = resp.responder_id || resp.id;
      const res = await api.admin.assignResponder(emergencyId, {
        responder_id: respId,
        responder_name: resp.name,
        team: resp.team,
        is_primary: isPrimary
      });

      if (res && res.emergency) {
        const updated = normalizeEmergency(res.emergency);
        setEmergencies(prev => prev.map(em => em.id === updated.id ? updated : em));
      } else {
        await loadBackendData('admin');
      }

      setResponders(prev => prev.map(r => (r.id === resp.id || r.responder_id === respId) ? { ...r, availability: 'Busy', currentEmergencyId: emergencyId } : r));

      addAuditLog(
        isPrimary ? 'Primary Responder Assigned' : 'Supporting Responder Assigned',
        `Assigned ${resp.name} (${resp.role}) to ${emergencyId}`,
        emergencyId
      );

      setAssigningMode(null);
      setDispatchModalResponder(null);
      showToast(`Assigned ${resp.name} as ${isPrimary ? 'Primary' : 'Supporting'} Responder`);
    } catch (err) {
      console.error('Backend assign error:', err);
      showToast(`Assignment failed: ${err.message}`);
    }
  };

  // Admin Reassign Responder
  const handleReassignResponder = async (emergencyId, oldResponderId, newResp) => {
    try {
      const newRespId = newResp.responder_id || newResp.id;
      const res = await api.admin.reassignResponder(emergencyId, {
        old_responder_id: oldResponderId,
        new_responder_id: newRespId,
        new_responder_name: newResp.name,
        new_responder_team: newResp.team,
        reason: 'Command re-dispatch'
      });

      if (res && res.emergency) {
        const updated = normalizeEmergency(res.emergency);
        setEmergencies(prev => prev.map(em => em.id === updated.id ? updated : em));
      } else {
        await loadBackendData('admin');
      }

      addAuditLog('Responder Reassigned', `Reassigned deployment on ${emergencyId} to ${newResp.name}`, emergencyId);
      showToast(`Reassigned to ${newResp.name}`);
    } catch (err) {
      console.error('Backend reassign error:', err);
      showToast(`Reassignment failed: ${err.message}`);
    }
  };

  // Remove responder from incident
  const handleRemoveResponder = async (emergencyId, responderName) => {
    const resp = responders.find(r => r.name === responderName);
    const respId = resp ? (resp.responder_id || resp.id) : null;

    try {
      if (respId) {
        const res = await api.admin.removeResponder(emergencyId, respId);
        if (res && res.emergency) {
          const updated = normalizeEmergency(res.emergency);
          setEmergencies(prev => prev.map(em => em.id === updated.id ? updated : em));
        } else {
          await loadBackendData('admin');
        }
      }

      setResponders(prev => prev.map(r => r.name === responderName ? { ...r, availability: 'Available', currentEmergencyId: null } : r));
      addAuditLog('Responder Removed', `Removed ${responderName} from ${emergencyId}`, emergencyId);
      showToast(`Removed ${responderName} from mission`);
    } catch (err) {
      console.error('Backend remove responder error:', err);
      showToast(`Remove responder failed: ${err.message}`);
    }
  };

  // Responder Operational Transitions (Accept, On The Way, Arrived, Service Started, Resolved)
  const handleUpdateStatus = async (emergencyId, newStatus, label) => {
    try {
      let res;
      if (newStatus === 'RESPONDER_ACCEPTED') {
        res = await api.responder.acceptEmergency(emergencyId);
      } else {
        res = await api.responder.updateStatus(emergencyId, {
          status: newStatus,
          resolution_note: newStatus === 'RESOLVED' ? `Resolved by ${responderProfile.name}` : undefined
        });
      }

      if (res && res.emergency) {
        const updated = normalizeEmergency(res.emergency);
        setEmergencies(prev => prev.map(em => em.id === updated.id ? updated : em));
        if (newStatus === 'RESOLVED') {
          const histItem = normalizeHistoryItem(res.emergency);
          if (histItem) {
            setHistoryList(prev => [histItem, ...prev.filter(h => h.id !== histItem.id)]);
          }
        }
      } else {
        await loadBackendData(currentRole);
      }

      addAuditLog('Status Changed', `Status updated to ${label} by ${responderProfile.name}`, emergencyId);
      showToast(`Status updated: ${label}`);
    } catch (err) {
      console.error('Backend update status error:', err);
      showToast(`Status update failed: ${err.message}`);
    }
  };

  // Add Incident Note
  const handleAddIncidentNote = async (e) => {
    e.preventDefault();
    if (!newNoteText.trim()) return;

    const note = {
      id: `n-${Date.now()}`,
      author: currentRole === 'admin' ? adminProfile.name : responderProfile.name,
      role: currentRole === 'admin' ? 'Admin' : 'Responder',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      message: newNoteText.trim()
    };

    setEmergencies(prev => prev.map(em => {
      if (em.id === selectedEmergency.id) {
        return { ...em, notes: [...em.notes, note] };
      }
      return em;
    }));

    addAuditLog('Incident Note Added', `Note: "${newNoteText.trim()}"`, selectedEmergency.id);
    const textToSave = newNoteText.trim();
    setNewNoteText('');
    showToast('Incident note recorded');

    try {
      await api.responder.addNote(selectedEmergency.id, textToSave);
    } catch (err) {
      console.warn('Backend add note error:', err.message);
    }
  };

  // Send Victim Chat Message
  const handleSendChatMessage = async (e) => {
    e.preventDefault();
    if (!newChatMessage.trim()) return;

    const msg = {
      id: `msg-${Date.now()}`,
      sender: 'Responder',
      authorName: `${responderProfile.name} (${responderProfile.role})`,
      message: newChatMessage.trim(),
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      mode: chatMode
    };

    setEmergencies(prev => prev.map(em => {
      if (em.id === selectedEmergency.id) {
        return { ...em, chatMessages: [...em.chatMessages, msg] };
      }
      return em;
    }));

    const msgText = newChatMessage.trim();
    setNewChatMessage('');
    showToast(`Message transmitted via ${chatMode}`);

    try {
      await api.chat.sendMessage(selectedEmergency.id, {
        sender_id: currentUser ? currentUser.id : 'resp-01',
        sender_role: currentRole ? currentRole.toUpperCase() : 'RESPONDER',
        message: msgText
      });
    } catch (err) {
      console.warn('Backend chat send error:', err.message);
    }
  };

  // Responder Availability Toggle
  const handleResponderAvailabilityToggle = async (newAvail) => {
    setResponderProfile(prev => ({ ...prev, availability: newAvail }));
    setResponders(prev => prev.map(r => r.name === responderProfile.name ? { ...r, availability: newAvail } : r));
    addAuditLog('Availability Changed', `Responder ${responderProfile.name} set to ${newAvail}`);
    showToast(`Availability updated to ${newAvail}`);

    try {
      await api.responder.updateAvailability(newAvail.toUpperCase());
    } catch (err) {
      console.warn('Backend availability update error:', err.message);
    }
  };

  // Save Profile Edit
  const handleSaveProfile = (e) => {
    e.preventDefault();
    setShowEditProfileModal(false);
    addAuditLog('Profile Updated', 'User profile information updated');
    showToast('Profile information saved successfully');
  };

  // Change Password
  const handleChangePassword = (e) => {
    e.preventDefault();
    if (passwordForm.newPass !== passwordForm.confirm) {
      showToast('Error: Passwords do not match');
      return;
    }
    setShowPasswordModal(false);
    setPasswordForm({ current: '', newPass: '', confirm: '' });
    addAuditLog('Password Changed', 'User security credentials updated (Local simulation)');
    showToast('Password changed successfully');
  };

  const getTimelineStepIndex = (status) => {
    const idx = TIMELINE_STEPS.findIndex(s => s.id === status);
    return idx !== -1 ? idx : 3;
  };

  // Dashboard Active Incidents (Critical First: P1, P2, P3, P4, Newest First within priority)
  const dashboardEmergencies = [...emergencies]
    .filter(em => em.status !== 'RESOLVED' && em.status !== 'CANCELLED')
    .sort((a, b) => {
      const pA = a.priorityWeight || 3;
      const pB = b.priorityWeight || 3;
      if (pA !== pB) return pA - pB;
      return (b.id || '').localeCompare(a.id || '');
    });

  // Operational Emergency Queue Filtering & Sorting (Admin)
  const filteredQueueEmergencies = [...emergencies].filter(em => {
    // 1. Search Query (ID, location, type, severity, responder names)
    if (queueSearchQuery.trim()) {
      const q = queueSearchQuery.toLowerCase();
      const matchId = (em.id || '').toLowerCase().includes(q);
      const matchLoc = (em.location || '').toLowerCase().includes(q);
      const matchType = (em.type || '').toLowerCase().includes(q);
      const matchSev = (em.severity || '').toLowerCase().includes(q);
      const matchResp = (em.assignedResponders || []).some(r => (r.name || '').toLowerCase().includes(q));
      if (!matchId && !matchLoc && !matchType && !matchSev && !matchResp) return false;
    }

    // 2. Type Filter
    if (queueTypeFilter !== 'ALL' && em.type !== queueTypeFilter) return false;

    // 3. Priority Filter
    if (priorityFilter !== 'ALL' && !em.priority.startsWith(priorityFilter)) return false;

    // 4. Status Filter
    if (queueStatusFilter === 'WAITING' && em.status !== 'TEAM_NOTIFIED' && em.status !== 'SOS_CREATED') return false;
    if (queueStatusFilter === 'ASSIGNED' && em.status !== 'RESPONDER_ASSIGNED') return false;
    if (queueStatusFilter === 'ACCEPTED' && em.status !== 'RESPONDER_ACCEPTED') return false;
    if (queueStatusFilter === 'EN_ROUTE' && em.status !== 'ON_THE_WAY') return false;
    if (queueStatusFilter === 'ARRIVED' && em.status !== 'ARRIVED') return false;
    if (queueStatusFilter === 'SERVICE_STARTED' && em.status !== 'SERVICE_STARTED') return false;
    if (queueStatusFilter === 'RESOLVED' && em.status !== 'RESOLVED') return false;

    // 5. Assignment Filter
    if (queueAssignmentFilter === 'UNASSIGNED' && em.assignedResponders.length > 0) return false;
    if (queueAssignmentFilter === 'ASSIGNED' && em.assignedResponders.length === 0) return false;

    // 6. LoRa Mesh Filter
    if (loraFilterOnly && !(em.source === 'LORA' || (em.location_source || '').toUpperCase().includes('LORA') || em.lora_metadata)) {
      return false;
    }

    return true;
  }).sort((a, b) => {
    if (queueSortBy === 'NEWEST') {
      return (b.id || '').localeCompare(a.id || '');
    }
    const pA = a.priorityWeight || 3;
    const pB = b.priorityWeight || 3;
    if (pA !== pB) return pA - pB;
    return (b.id || '').localeCompare(a.id || '');
  });

  const queueActiveCount = emergencies.filter(e => e.status !== 'RESOLVED' && e.status !== 'CANCELLED').length;
  const queueCriticalCount = emergencies.filter(e => e.priority.startsWith('P1') && e.status !== 'RESOLVED').length;
  const queueUnassignedCount = emergencies.filter(e => (e.assignedResponders || []).length === 0 && e.status !== 'RESOLVED').length;

  const myAssignedEmergencies = emergencies.filter(em => {
    if (currentRole === 'responder') return true;
    return (em.assignedResponders || []).some(
      r => r.name === responderProfile.name || (currentUser && (r.id === currentUser.id || r.responder_id === currentUser.responder_id))
    );
  });

  // Roster Filters & Search
  const filteredResponders = responders.filter(r => {
    if (rosterAvailFilter !== 'ALL' && r.availability !== rosterAvailFilter) return false;
    if (rosterTeamFilter !== 'ALL' && r.team !== rosterTeamFilter) return false;
    if (rosterSearch.trim()) {
      const q = rosterSearch.toLowerCase();
      const matchName = (r.name || '').toLowerCase().includes(q);
      const matchId = (r.id || '').toLowerCase().includes(q);
      const matchRole = (r.role || '').toLowerCase().includes(q);
      const matchTeam = (r.team || '').toLowerCase().includes(q);
      const matchLoc = (r.location || '').toLowerCase().includes(q);
      return matchName || matchId || matchRole || matchTeam || matchLoc;
    }
    return true;
  });

  // History Filters & Search
  const filteredHistory = historyList.filter(item => {
    if (currentRole === 'responder') {
      const isMine = (item.assignedResponders || []).some(
        r => r.name === responderProfile.name || (currentUser && (r.id === currentUser.id || r.responder_id === currentUser.responder_id))
      );
      if (!isMine) return false;
    }
    if (historyTypeFilter !== 'ALL' && item.type !== historyTypeFilter) return false;
    if (historyStatusFilter !== 'ALL' && item.finalStatus !== historyStatusFilter) return false;
    if (historySearchQuery.trim()) {
      const q = historySearchQuery.toLowerCase();
      return (item.id || '').toLowerCase().includes(q) || (item.location || '').toLowerCase().includes(q);
    }
    return true;
  });

  const unreadCount = notifications.filter(n => !n.read && (n.forRole === 'both' || n.forRole === currentRole)).length;

  // Selected Target for Tactical Map
  const mapActiveEmergency = emergencies.find(e => e.id === mapSelectedEmergencyId);
  const mapActiveResponder = responders.find(r => r.id === mapSelectedResponderId);

  // ==========================================================
  // RENDER: NOT LOGGED IN (ROLE SELECT / LOGIN)
  // ==========================================================

  if (!currentRole) {
    return (
      <div className="app-container">
        <header className="top-nav">
          <div className="system-brand">
            <span className="brand-dot"></span>
            <span className="brand-code">RESQNET // COMMAND GATEWAY</span>
          </div>
          <div className="status-badge">
            <span className="demo-badge">SECURE TERMINAL</span>
            <span className="pulse-indicator"></span>
            <span>SYSTEM READY</span>
          </div>
        </header>

        <main className="main-stage">
          <div className="command-card">
            <div className="card-header">
              <div className="emblem-wrapper">
                <svg className="emblem-svg" viewBox="0 0 24 24" fill="none">
                  <path d="M12 2L3 6V12C3 17.52 6.84 22.5 12 24C17.16 22.5 21 17.52 21 12V6L12 2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M12 8V16M8 12H16" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>

              <h1 className="title-resqnet">
                RESQ<span className="accent-red">NET</span>
              </h1>
              <h2 className="subtitle-command">Responder Command Center</h2>
              <p className="tagline-emergency">
                Emergency Response & Rescue Coordination
              </p>
            </div>

            {authView === 'role_select' && (
              <>
                <div className="tactical-divider">
                  <span className="divider-line"></span>
                  <span className="divider-text">SELECT OPERATIONAL PORTAL</span>
                  <span className="divider-line"></span>
                </div>

                <div className="actions-group">
                  <button type="button" className="btn btn-admin" onClick={() => handleRoleSelection('admin')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
                      <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
                    </svg>
                    Admin Portal
                  </button>

                  <button type="button" className="btn btn-responder" onClick={() => handleRoleSelection('responder')}>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                      <circle cx="9" cy="7" r="4"></circle>
                      <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
                      <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    Rescuer Portal
                  </button>
                </div>

                <div className="auth-instructions-card" style={{ marginTop: '16px', padding: '12px 14px', background: 'rgba(255, 255, 255, 0.03)', border: '1px solid rgba(255, 255, 255, 0.08)', borderRadius: '8px', textAlign: 'center' }}>
                  <div style={{ fontSize: '11px', fontWeight: '700', color: '#94a3b8', letterSpacing: '0.05em', marginBottom: '4px' }}>🛡️ OPERATIONAL ACCESS CONTROL</div>
                  <div style={{ fontSize: '12px', color: '#cbd5e1' }}>Select a portal above to register your official account or sign in with your verified credentials.</div>
                </div>
              </>
            )}

            {authView === 'auth_gateway' && (
              <>
                <div className="tactical-divider">
                  <span className="divider-line"></span>
                  <span className="divider-text">
                    {authRole === 'admin' ? 'ADMIN COMMAND PORTAL' : 'RESCUER FIELD PORTAL'}
                  </span>
                  <span className="divider-line"></span>
                </div>

                {/* Registration vs Login Mode Toggle Tabs */}
                <div className="auth-mode-tabs-container" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '16px' }}>
                  <button
                    type="button"
                    style={{
                      padding: '10px 14px',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '700',
                      letterSpacing: '0.03em',
                      cursor: 'pointer',
                      border: authMode === 'register' ? '2px solid var(--resqnet-red, #ef4444)' : '1px solid rgba(255,255,255,0.12)',
                      background: authMode === 'register' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.03)',
                      color: authMode === 'register' ? '#f87171' : '#94a3b8',
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => { setAuthMode('register'); setAuthError(''); setAuthSuccessMsg(''); }}
                  >
                    📝 1. REGISTER
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: '10px 14px',
                      borderRadius: '6px',
                      fontSize: '13px',
                      fontWeight: '700',
                      letterSpacing: '0.03em',
                      cursor: 'pointer',
                      border: authMode === 'login' ? '2px solid var(--resqnet-red, #ef4444)' : '1px solid rgba(255,255,255,0.12)',
                      background: authMode === 'login' ? 'rgba(239, 68, 68, 0.15)' : 'rgba(255,255,255,0.03)',
                      color: authMode === 'login' ? '#f87171' : '#94a3b8',
                      transition: 'all 0.2s ease'
                    }}
                    onClick={() => { setAuthMode('login'); setAuthError(''); setAuthSuccessMsg(''); }}
                  >
                    🔑 2. SIGN IN
                  </button>
                </div>

                {authSuccessMsg && (
                  <div style={{ marginBottom: '14px', padding: '10px 14px', background: 'rgba(34, 197, 94, 0.15)', border: '1px solid #22c55e', color: '#4ade80', borderRadius: '6px', fontSize: '13px' }}>
                    {authSuccessMsg}
                  </div>
                )}

                {authError && (
                  <div className="auth-error-banner" role="alert" style={{ marginBottom: '14px' }}>
                    <div>{authError}</div>
                    {authError.includes('unavailable') && (
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        style={{ marginTop: '8px' }}
                        onClick={authMode === 'register' ? handleRegisterSubmit : handleLoginSubmit}
                      >
                        🔄 Retry Connection
                      </button>
                    )}
                  </div>
                )}

                {authMode === 'register' ? (
                  /* ========================================== */
                  /* REGISTRATION VIEW (SHOWN FIRST BEFORE LOGIN) */
                  /* ========================================== */
                  <form onSubmit={handleRegisterSubmit} className="login-form">
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '12px', textAlign: 'center' }}>
                      Register your official account first to activate access credentials.
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="reg-name-input">Full Name</label>
                      <input
                        id="reg-name-input"
                        type="text"
                        className="form-input"
                        required
                        value={regName}
                        onChange={(e) => setRegName(e.target.value)}
                        placeholder={authRole === 'admin' ? 'Commander Name' : 'Rescuer Full Name'}
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="reg-email-input">Official Email Address</label>
                      <input
                        id="reg-email-input"
                        type="email"
                        className="form-input"
                        required
                        value={regEmail}
                        onChange={(e) => setRegEmail(e.target.value)}
                        placeholder="yourname@gmail.com"
                      />
                    </div>

                    <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div className="form-group">
                        <label className="form-label" htmlFor="reg-password-input">Password</label>
                        <input
                          id="reg-password-input"
                          type="password"
                          className="form-input"
                          required
                          value={regPassword}
                          onChange={(e) => setRegPassword(e.target.value)}
                          placeholder="Min 6 chars"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="reg-confirm-password-input">Confirm Password</label>
                        <input
                          id="reg-confirm-password-input"
                          type="password"
                          className="form-input"
                          required
                          value={regConfirmPassword}
                          onChange={(e) => setRegConfirmPassword(e.target.value)}
                          placeholder="Re-enter password"
                        />
                      </div>
                    </div>

                    <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                      <div className="form-group">
                        <label className="form-label" htmlFor="reg-phone-input">Phone Number</label>
                        <input
                          id="reg-phone-input"
                          type="tel"
                          className="form-input"
                          required
                          value={regPhone}
                          onChange={(e) => setRegPhone(e.target.value)}
                          placeholder="+91 98765 43210"
                        />
                      </div>
                      <div className="form-group">
                        <label className="form-label" htmlFor="reg-blood-input">Blood Group</label>
                        <select
                          id="reg-blood-input"
                          className="form-input"
                          value={regBloodGroup}
                          onChange={(e) => setRegBloodGroup(e.target.value)}
                        >
                          <option value="O+">O+</option>
                          <option value="O-">O-</option>
                          <option value="A+">A+</option>
                          <option value="A-">A-</option>
                          <option value="A1+">A1+</option>
                          <option value="B+">B+</option>
                          <option value="B-">B-</option>
                          <option value="AB+">AB+</option>
                          <option value="AB-">AB-</option>
                        </select>
                      </div>
                    </div>

                    {authRole === 'responder' && (
                      <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                        <div className="form-group">
                          <label className="form-label">Specialization</label>
                          <select
                            className="form-input"
                            value={regSpecialization}
                            onChange={(e) => setRegSpecialization(e.target.value)}
                          >
                            <option value="Swift Water & Flood Rescue">Swift Water & Flood Rescue</option>
                            <option value="Paramedic & Emergency Triage">Paramedic & Emergency Triage</option>
                            <option value="Fire & Hazmat Specialist">Fire & Hazmat Specialist</option>
                            <option value="Structural Collapse & Search">Structural Collapse & Search</option>
                            <option value="Disaster Response Team">Disaster Response Team</option>
                          </select>
                        </div>
                        <div className="form-group">
                          <label className="form-label">Assigned Squad</label>
                          <input
                            type="text"
                            className="form-input"
                            value={regTeam}
                            onChange={(e) => setRegTeam(e.target.value)}
                            placeholder="Rescue Squad Alpha"
                          />
                        </div>
                      </div>
                    )}

                    <div className="actions-group" style={{ marginTop: '14px' }}>
                      <button type="submit" className={`btn ${authRole === 'admin' ? 'btn-admin' : 'btn-responder'}`}>
                        {backendLoading ? 'Registering...' : `Register & Access as ${authRole === 'admin' ? 'Admin' : 'Rescuer'}`}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => { setAuthMode('login'); setAuthError(''); }}
                      >
                        Already Registered? Switch to Sign In →
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => { setAuthView('role_select'); setAuthError(''); setAuthSuccessMsg(''); }}
                      >
                        ← Back to Role Selection
                      </button>
                    </div>
                  </form>
                ) : (
                  /* ========================================== */
                  /* SIGN IN VIEW */
                  /* ========================================== */
                  <form onSubmit={handleLoginSubmit} className="login-form">
                    <div style={{ fontSize: '12px', color: '#94a3b8', marginBottom: '12px', textAlign: 'center' }}>
                      Sign in with your registered email address and password.
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="email-input">Registered Email</label>
                      <input
                        id="email-input"
                        type="email"
                        className="form-input"
                        required
                        value={loginEmail}
                        onChange={(e) => setLoginEmail(e.target.value)}
                        placeholder="yourname@gmail.com"
                      />
                    </div>

                    <div className="form-group">
                      <label className="form-label" htmlFor="password-input">Password</label>
                      <input
                        id="password-input"
                        type="password"
                        className="form-input"
                        required
                        value={loginPassword}
                        onChange={(e) => setLoginPassword(e.target.value)}
                        placeholder="••••••••"
                      />
                    </div>

                    <div className="actions-group" style={{ marginTop: '14px' }}>
                      <button type="submit" className={`btn ${authRole === 'admin' ? 'btn-admin' : 'btn-responder'}`}>
                        {backendLoading ? 'Authenticating...' : `Sign In as ${authRole === 'admin' ? 'Admin' : 'Rescuer'}`}
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => { setAuthMode('register'); setAuthError(''); }}
                      >
                        New User? Register Account First →
                      </button>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => { setAuthView('role_select'); setAuthError(''); setAuthSuccessMsg(''); }}
                      >
                        ← Back to Role Selection
                      </button>
                    </div>
                  </form>
                )}
              </>
            )}

            <div className="card-telemetry">
              <div className="telemetry-item">
                <span className="telemetry-label">MAP ENGINE</span>
                <span className="telemetry-value">LEAFLET GIS</span>
              </div>
              <div className="telemetry-item">
                <span className="telemetry-label">API KEY STATUS</span>
                <span className="telemetry-value" style={{ color: '#4ade80' }}>NO KEY REQ</span>
              </div>
              <div className="telemetry-item">
                <span className="telemetry-label">DISPATCH</span>
                <span className="telemetry-value">READY</span>
              </div>
            </div>
          </div>
        </main>

        <footer className="app-footer">
          <p className="footer-text">RESQNET EMERGENCY INCIDENT DISPATCH SYSTEM // SECURE TERMINAL</p>
        </footer>
      </div>
    );
  }

  // ==========================================================
  // RENDER: AUTHENTICATED SYSTEM (ADMIN & RESPONDER)
  // ==========================================================

  return (
    <div className="app-layout">
      {/* Toast Notification */}
      {notificationToast && (
        <div className="floating-toast" role="status">
          <span className="toast-dot"></span>
          <span>{notificationToast}</span>
        </div>
      )}

      {/* Desktop Tactical Sidebar */}
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <div className="brand-dot"></div>
          <div>
            <div className="brand-title">RESQNET</div>
            <div className="brand-role-tag">
              {currentRole === 'admin' ? 'ADMIN COMMAND' : 'FIELD RESPONDER'}
            </div>
          </div>
        </div>

        {/* User Card */}
        <div className="sidebar-user-card" onClick={() => setActiveScreen('profile')}>
          <div className="user-avatar">
            {currentRole === 'admin' ? 'AD' : 'AK'}
          </div>
          <div className="user-details">
            <div className="user-name">
              {currentRole === 'admin' ? adminProfile.name : responderProfile.name}
            </div>
            <div className="user-sub">
              {currentRole === 'admin' ? 'Regional Dispatch HQ' : `${responderProfile.role} • ${responderProfile.team}`}
            </div>
          </div>
        </div>

        {/* Global Connection & Telemetry */}
        <div className="sidebar-telemetry-badge">
          <div className="telemetry-row">
            <span className="tel-label">LINK:</span>
            <span className={`tel-val ${globalConnection === 'ONLINE' ? 'online' : 'lora'}`}>
              {globalConnection === 'ONLINE' ? '🟢 ONLINE' : '🔵 LORA MESH'}
            </span>
          </div>
          <div className="telemetry-row">
            <span className="tel-label">GPS:</span>
            <span className={`tel-val ${gpsStatus.includes('Available') ? 'online' : 'offline'}`}>
              {gpsStatus}
            </span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="sidebar-nav">
          <button
            type="button"
            className={`nav-item ${activeScreen === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveScreen('dashboard')}
          >
            <span className="nav-icon">📊</span>
            <span>Dashboard</span>
          </button>

          <button
            type="button"
            className={`nav-item ${activeScreen === 'emergencies' ? 'active' : ''}`}
            onClick={() => setActiveScreen('emergencies')}
          >
            <span className="nav-icon">🚨</span>
            <span>{currentRole === 'admin' ? 'Emergency Queue' : 'My Emergencies'}</span>
            <span className="nav-badge">
              {currentRole === 'admin' ? emergencies.length : myAssignedEmergencies.length}
            </span>
          </button>

          <button
            type="button"
            className={`nav-item ${activeScreen === 'map' ? 'active' : ''}`}
            onClick={() => setActiveScreen('map')}
          >
            <span className="nav-icon">🗺️</span>
            <span>Tactical Map</span>
          </button>

          <button
            type="button"
            className={`nav-item ${activeScreen === 'history' ? 'active' : ''}`}
            onClick={() => setActiveScreen('history')}
          >
            <span className="nav-icon">📜</span>
            <span>Incident History</span>
          </button>

          {currentRole === 'admin' && (
            <>
              <button
                type="button"
                className={`nav-item ${activeScreen === 'responders' ? 'active' : ''}`}
                onClick={() => setActiveScreen('responders')}
              >
                <span className="nav-icon">👥</span>
                <span>Responders Roster</span>
                <span className="nav-badge">{responders.length}</span>
              </button>

              <button
                type="button"
                className={`nav-item ${activeScreen === 'analytics' ? 'active' : ''}`}
                onClick={() => setActiveScreen('analytics')}
              >
                <span className="nav-icon">📈</span>
                <span>Analytics & Reports</span>
              </button>

              <button
                type="button"
                className="nav-item"
                style={{ color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.25)', background: 'rgba(6, 182, 212, 0.08)' }}
                onClick={() => setShowLoraModal(true)}
              >
                <span className="nav-icon">📡</span>
                <span>LoRa Gateway Hub</span>
                <span className="nav-badge" style={{ background: '#0284c7', color: '#fff' }}>LIVE</span>
              </button>
            </>
          )}

          <button
            type="button"
            className={`nav-item ${activeScreen === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveScreen('notifications')}
          >
            <span className="nav-icon">🔔</span>
            <span>Notifications</span>
            {unreadCount > 0 && <span className="nav-badge badge-unread">{unreadCount}</span>}
          </button>

          <button
            type="button"
            className={`nav-item ${activeScreen === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveScreen('profile')}
          >
            <span className="nav-icon">👤</span>
            <span>{currentRole === 'admin' ? 'Admin Profile' : 'Responder Profile'}</span>
          </button>
        </nav>

        {/* Sidebar Footer */}
        <div className="sidebar-footer">
          <div className="demo-indicator-box">
            <span className="pulse-indicator-small"></span>
            <span>Leaflet GIS • Offline Mode Ready</span>
          </div>
          <button type="button" className="btn btn-logout" onClick={handleLogout}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
              <polyline points="16 17 21 12 16 7"></polyline>
              <line x1="21" y1="12" x2="9" y2="12"></line>
            </svg>
            Logout
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <div className="app-main-content">
        {/* Top Header */}
        <header className="content-header">
          <div className="header-left">
            <h1 className="header-title">
              RESQNET
              <span className="header-sub">
                {currentRole === 'admin' ? 'Admin Command Center' : 'Responder Command Center'}
              </span>
            </h1>
          </div>

          <div className="header-right">
            <div className="status-pill">
              <span className="pulse-indicator"></span>
              <span>🟢 System Online</span>
            </div>

            <select 
              className="header-link-select"
              value={globalConnection}
              onChange={(e) => {
                setGlobalConnection(e.target.value);
                showToast(`Switched communication mode to ${e.target.value}`);
              }}
              title="Communication Gateway"
            >
              <option value="ONLINE">🟢 Online (LTE / Internet)</option>
              <option value="LORA">🔵 LoRa Mesh (RF 433MHz)</option>
              <option value="OFFLINE">🟠 Offline Local Mode</option>
              <option value="DISCONNECTED">🔴 Disconnected</option>
            </select>

            <button type="button" className="mobile-logout-btn" onClick={handleLogout}>
              Logout
            </button>
          </div>
        </header>

        {/* Mobile Subnavigation Tabs */}
        <div className="mobile-nav-bar">
          <button
            type="button"
            className={`mobile-tab ${activeScreen === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveScreen('dashboard')}
          >
            📊 Overview
          </button>
          <button
            type="button"
            className={`mobile-tab ${activeScreen === 'emergencies' ? 'active' : ''}`}
            onClick={() => setActiveScreen('emergencies')}
          >
            🚨 {currentRole === 'admin' ? 'Queue' : 'My Emergencies'}
          </button>
          <button
            type="button"
            className={`mobile-tab ${activeScreen === 'map' ? 'active' : ''}`}
            onClick={() => setActiveScreen('map')}
          >
            🗺️ Map
          </button>
          {currentRole === 'admin' && (
            <button
              type="button"
              className={`mobile-tab ${activeScreen === 'responders' ? 'active' : ''}`}
              onClick={() => setActiveScreen('responders')}
            >
              👥 Responders
            </button>
          )}
          <button
            type="button"
            className={`mobile-tab ${activeScreen === 'history' ? 'active' : ''}`}
            onClick={() => setActiveScreen('history')}
          >
            📜 History
          </button>
          <button
            type="button"
            className={`mobile-tab ${activeScreen === 'notifications' ? 'active' : ''}`}
            onClick={() => setActiveScreen('notifications')}
          >
            🔔 Notifs {unreadCount > 0 && `(${unreadCount})`}
          </button>
          <button
            type="button"
            className={`mobile-tab ${activeScreen === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveScreen('profile')}
          >
            👤 Profile
          </button>
        </div>

        {/* Body Container */}
        <main className="content-body">
          {/* ==================================================== */}
          {/* SCREEN 1: TACTICAL LEAFLET MAP (ZERO API KEY)        */}
          {/* ==================================================== */}
          {activeScreen === 'map' && (
            <div className="tactical-map-page-wrapper">
              {/* Map Header & Filter Toolbar */}
              <div className="map-toolbar-card">
                <div className="toolbar-top-row">
                  <div>
                    <h2 className="toolbar-title">🗺️ Tactical Geographic Map (Leaflet / OpenStreetMap)</h2>
                    <p className="toolbar-sub">
                      Zero Google Maps API Key Required • Autonomous Dark GIS Overlay • Live Coordinates
                    </p>
                  </div>

                  <div className="toolbar-quick-actions">
                    <button type="button" className="btn btn-sm btn-admin" onClick={handleFitAllMarkers}>
                      🎯 [ Fit All Markers ]
                    </button>

                    {currentRole === 'responder' && (
                      <>
                        <button type="button" className="btn btn-sm btn-admin" onClick={handleCenterOnMyLocation}>
                          📍 [ My Location ]
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-responder-primary"
                          onClick={() => {
                            const myEm = myAssignedEmergencies[0] || emergencies[0];
                            handleCenterOnEmergency(myEm);
                          }}
                        >
                          🚨 [ Emergency Location ]
                        </button>
                      </>
                    )}

                    <button type="button" className="btn btn-sm btn-secondary" onClick={requestLocation}>
                      🛰️ Refresh GPS ({gpsStatus})
                    </button>
                  </div>
                </div>

                {/* Filter Controls Row */}
                <div className="toolbar-filters-row">
                  <div className="filter-group-inline">
                    <span className="filter-label">Emergency Type:</span>
                    <select
                      className="form-select-sm"
                      value={mapTypeFilter}
                      onChange={(e) => setMapTypeFilter(e.target.value)}
                    >
                      <option value="ALL">All Types</option>
                      {EMERGENCY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>

                  <div className="filter-group-inline">
                    <span className="filter-label">Priority:</span>
                    <select
                      className="form-select-sm"
                      value={mapPriorityFilter}
                      onChange={(e) => setMapPriorityFilter(e.target.value)}
                    >
                      <option value="ALL">All Priorities</option>
                      <option value="P1">P1 - Critical</option>
                      <option value="P2">P2 - High</option>
                      <option value="P3">P3 - Medium</option>
                      <option value="P4">P4 - Low</option>
                    </select>
                  </div>

                  <div className="filter-group-inline">
                    <span className="filter-label">Status:</span>
                    <select
                      className="form-select-sm"
                      value={mapStatusFilter}
                      onChange={(e) => setMapStatusFilter(e.target.value)}
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="WAITING">Waiting for Assignment</option>
                      <option value="ASSIGNED">Responder Assigned</option>
                      <option value="EN_ROUTE">En Route / Arrived</option>
                    </select>
                  </div>

                  <div className="filter-toggles-inline">
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={mapShowResponders}
                        onChange={(e) => setMapShowResponders(e.target.checked)}
                      />
                      <span>Show Responders (📍)</span>
                    </label>

                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={mapShowHospitals}
                        onChange={(e) => setMapShowHospitals(e.target.checked)}
                      />
                      <span>Show Safe Points (🏥)</span>
                    </label>
                  </div>
                </div>
              </div>

              {/* Main Map Grid (Canvas + Tactical Side Inspector) */}
              <div className="tactical-map-grid-container">
                {/* Tactical Inspector Sidebar */}
                <div className="tactical-map-sidebar">
                  <div className="sidebar-tab-header">
                    <h4>Target Incident List ({emergencies.length})</h4>
                  </div>

                  <div className="sidebar-scrollable-list">
                    {emergencies.map(em => (
                      <div
                        key={em.id}
                        className={`map-target-card ${em.id === mapSelectedEmergencyId ? 'active' : ''}`}
                        onClick={() => handleCenterOnEmergency(em)}
                      >
                        <div className="target-top">
                          <span className="target-id">{getEmergencyIcon(em.type)} {em.id}</span>
                          <span className={`priority-badge ${em.priority.startsWith('P1') ? 'priority-p1' : 'priority-p2'}`}>
                            {em.priority.split(' - ')[0]}
                          </span>
                        </div>
                        <div className="target-type">{em.type} • {em.severity}</div>
                        <div className="target-loc">📍 {em.location}</div>
                        <div className="target-status">
                          <span>Status:</span> <strong>{em.statusLabel}</strong>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Active Selected Incident Details Panel */}
                  {mapActiveEmergency && (
                    <div className="active-target-details-box">
                      <div className="box-header">
                        <span className="box-badge">SELECTED TARGET</span>
                        <button
                          type="button"
                          className="btn-link-action"
                          onClick={() => handleViewEmergency(mapActiveEmergency.id)}
                        >
                          Full Details →
                        </button>
                      </div>
                      <h4 className="box-title">{mapActiveEmergency.id} ({mapActiveEmergency.type})</h4>
                      <div className="box-line"><span>Priority:</span> <strong className="priority-p1-text">{mapActiveEmergency.priority}</strong></div>
                      <div className="box-line"><span>Location:</span> 📍 {mapActiveEmergency.location}</div>
                      <div className="box-line"><span>People Affected:</span> 👥 {mapActiveEmergency.peopleAffected}</div>
                      <div className="box-line"><span>Units Assigned:</span> {mapActiveEmergency.assignedResponders.length} Units</div>

                      <div className="box-actions">
                        <button
                          type="button"
                          className="btn btn-view-emergency"
                          onClick={() => handleViewEmergency(mapActiveEmergency.id)}
                        >
                          [ Open Incident Details & Actions ]
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Map Legend */}
                  <div className="tactical-map-legend">
                    <div className="legend-head">MAP LEGEND</div>
                    <div className="legend-items-grid">
                      <div className="leg-item"><span className="legend-circle em-p1">🚨</span> P1 Critical</div>
                      <div className="leg-item"><span className="legend-circle em-p2">⚠️</span> P2 High</div>
                      <div className="leg-item"><span className="legend-circle resp-on">📍</span> Responder</div>
                      <div className="leg-item"><span className="legend-circle hosp-pt">🏥</span> Hospital / Safe Point</div>
                    </div>
                  </div>
                </div>

                {/* Leaflet Canvas Host */}
                <div className="leaflet-map-host">
                  <div ref={mapContainerRef} className="leaflet-map-canvas" style={{ width: '100%', height: '100%' }}></div>
                  <div className="map-watermark-badge">
                    <span>RESQNET TACTICAL GIS • OPENSTREETMAP (ZERO API KEY)</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ==================================================== */}
          {/* SCREEN 2: RESPONDERS ROSTER (MANAGEMENT)             */}
          {/* ==================================================== */}
          {activeScreen === 'responders' && currentRole === 'admin' && (
            <div className="responders-page-wrapper">
              <div className="queue-controls">
                <div>
                  <h2 className="queue-title">👥 Regional Responder Fleet & Field Management</h2>
                  <p className="queue-subtitle">
                    Live telemetry, operational assignments, readiness status, and direct dispatch coordination
                  </p>
                </div>

                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn btn-admin"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px' }}
                    onClick={() => setShowAddResponderModal(true)}
                  >
                    ➕ Register New Rescuer
                  </button>

                  <button
                    type="button"
                    className="btn btn-secondary"
                    style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '8px 14px', fontSize: '13px' }}
                    onClick={async () => {
                      if (window.confirm('Purge all demo/mock accounts from database?')) {
                        await api.admin.clearDemoData();
                        showToast('Demo records purged.');
                        await loadBackendData('admin');
                      }
                    }}
                  >
                    🧹 Purge Demo Data
                  </button>

                  <div className="roster-view-toggle">
                    <button
                      type="button"
                      className={`btn-view-toggle ${rosterViewMode === 'cards' ? 'active' : ''}`}
                      onClick={() => setRosterViewMode('cards')}
                    >
                      🎴 Cards View
                    </button>
                    <button
                      type="button"
                      className={`btn-view-toggle ${rosterViewMode === 'table' ? 'active' : ''}`}
                      onClick={() => setRosterViewMode('table')}
                    >
                      📋 Data Table
                    </button>
                  </div>
                </div>
              </div>

              {/* Roster KPI Summary Statistics Cards */}
              <div className="dashboard-metric-cards">
                <div className="metric-stat-card">
                  <div className="stat-icon">👥</div>
                  <div className="stat-body">
                    <div className="stat-label">Total Responders</div>
                    <div className="stat-number">{responders.length}</div>
                  </div>
                </div>

                <div className="metric-stat-card">
                  <div className="stat-icon">🟢</div>
                  <div className="stat-body">
                    <div className="stat-label">Available for Dispatch</div>
                    <div className="stat-number">{responders.filter(r => r.availability === 'Available').length}</div>
                  </div>
                </div>

                <div className="metric-stat-card critical-stat">
                  <div className="stat-icon">🟠</div>
                  <div className="stat-body">
                    <div className="stat-label">Busy / On Mission</div>
                    <div className="stat-number">{responders.filter(r => r.availability === 'Busy').length}</div>
                  </div>
                </div>

                <div className="metric-stat-card">
                  <div className="stat-icon">⚫</div>
                  <div className="stat-body">
                    <div className="stat-label">Offline / Standby</div>
                    <div className="stat-number">{responders.filter(r => r.availability === 'Offline').length}</div>
                  </div>
                </div>
              </div>

              {/* Search & Filter Controls */}
              <div className="roster-filter-card">
                <div className="roster-search-field">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search by Name, Responder ID (e.g. RSP-001), Role, Team, or Sector..."
                    value={rosterSearch}
                    onChange={(e) => setRosterSearch(e.target.value)}
                  />
                </div>

                <div className="roster-filters-inline">
                  <div className="filter-group-inline">
                    <span className="filter-label">Availability:</span>
                    <select
                      className="form-select-sm"
                      value={rosterAvailFilter}
                      onChange={(e) => setRosterAvailFilter(e.target.value)}
                    >
                      <option value="ALL">All Statuses</option>
                      <option value="Available">🟢 Available</option>
                      <option value="Busy">🟠 Busy</option>
                      <option value="Offline">⚫ Offline</option>
                    </select>
                  </div>

                  <div className="filter-group-inline">
                    <span className="filter-label">Team:</span>
                    <select
                      className="form-select-sm"
                      value={rosterTeamFilter}
                      onChange={(e) => setRosterTeamFilter(e.target.value)}
                    >
                      <option value="ALL">All Teams</option>
                      {Array.from(new Set(responders.map(r => r.team).filter(Boolean))).map(t => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* View 1: Cards Grid View */}
              {rosterViewMode === 'cards' && (
                <div className="responder-cards-grid">
                  {filteredResponders.length === 0 ? (
                    <div className="empty-queue-box" style={{ gridColumn: '1 / -1', padding: '40px', textAlign: 'center' }}>
                      <div className="empty-queue-icon">👥</div>
                      <h3 className="empty-queue-title">No responders registered</h3>
                      <p className="empty-queue-text">{responders.length === 0 ? 'No field responder units are currently registered in the database.' : 'No active field units match current filter criteria.'}</p>
                    </div>
                  ) : (
                    filteredResponders.map(resp => (
                      <div key={resp.id} className="responder-mgmt-card">
                        <div className="mgmt-card-top">
                          <div className="resp-avatar-circle">
                            {resp.name.charAt(0)}
                          </div>

                          <div className="resp-head-info">
                            <div className="resp-id-badge">{resp.id}</div>
                            <h3 className="resp-name-title">{resp.name}</h3>
                            <div className="resp-role-sub">{resp.role}</div>
                          </div>

                          <span className={`availability-pill ${resp.availability === 'Available' ? 'available' : resp.availability === 'Busy' ? 'busy' : 'offline'}`}>
                            {resp.availability === 'Available' ? '🟢 Available' : resp.availability === 'Busy' ? '🟠 Busy' : '⚫ Offline'}
                          </span>
                        </div>

                        <div className="mgmt-card-body">
                          <div className="mgmt-row">
                            <span className="row-label">Specialization:</span>
                            <span className="row-val">{resp.specialization}</span>
                          </div>
                          <div className="mgmt-row">
                            <span className="row-label">Assigned Team:</span>
                            <span className="row-val">{resp.team}</span>
                          </div>
                          <div className="mgmt-row">
                            <span className="row-label">Current Sector:</span>
                            <span className="row-val">📍 {resp.location}</span>
                          </div>
                          <div className="mgmt-row">
                            <span className="row-label">Active Incident:</span>
                            <span className="row-val">
                              {resp.currentEmergencyId ? (
                                <strong className="active-em-text">🚨 {resp.currentEmergencyId}</strong>
                              ) : (
                                <span className="standby-text">Standby — Unassigned</span>
                              )}
                            </span>
                          </div>
                          <div className="mgmt-row">
                            <span className="row-label">Comms Gateway:</span>
                            <span className="row-val">
                              {resp.connection === 'Online' ? '🟢 Online (LTE)' : '🔵 LoRa Mesh'}
                            </span>
                          </div>
                        </div>

                        <div className="mgmt-card-actions">
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => setSelectedProfileResponder(resp)}
                          >
                            View Profile
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-admin"
                            onClick={() => handleCenterOnResponder(resp)}
                          >
                            View Location
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-responder-primary"
                            onClick={() => setDispatchModalResponder(resp)}
                          >
                            {resp.currentEmergencyId ? 'Reassign' : 'Assign'}
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            onClick={() => setContactModalResponder(resp)}
                          >
                            Contact
                          </button>
                          <button
                            type="button"
                            className="btn btn-sm btn-secondary"
                            style={{ color: '#f87171', borderColor: 'rgba(239, 68, 68, 0.4)' }}
                            onClick={() => handleDeleteResponder(resp.id || resp.responder_id, resp.name)}
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* View 2: Data Table View */}
              {rosterViewMode === 'table' && (
                <div className="responder-table-card">
                  <table className="tactical-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Responder</th>
                        <th>Role & Specialization</th>
                        <th>Team</th>
                        <th>Availability</th>
                        <th>Current Mission</th>
                        <th>Sector / Location</th>
                        <th>Comms</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredResponders.length === 0 ? (
                        <tr>
                          <td colSpan="9" style={{ textAlign: 'center', padding: '30px', color: '#888' }}>
                            {responders.length === 0 ? 'No responders registered' : 'No active field units match current filter criteria'}
                          </td>
                        </tr>
                      ) : (
                        filteredResponders.map(resp => (
                          <tr key={resp.id}>
                            <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{resp.id}</td>
                            <td>
                              <strong>{resp.name}</strong>
                            </td>
                            <td>{resp.role} ({resp.specialization})</td>
                            <td>{resp.team}</td>
                            <td>
                              <span className={`availability-pill ${resp.availability === 'Available' ? 'available' : resp.availability === 'Busy' ? 'busy' : 'offline'}`}>
                                {resp.availability}
                              </span>
                            </td>
                            <td>
                              {resp.currentEmergencyId ? (
                                <span className="active-em-text">🚨 {resp.currentEmergencyId}</span>
                              ) : (
                                <span className="standby-text">Standby</span>
                              )}
                            </td>
                            <td>📍 {resp.location}</td>
                            <td>{resp.connection === 'Online' ? '🟢 Online' : '🔵 LoRa'}</td>
                            <td>
                              <div className="table-actions-inline">
                                <button
                                  type="button"
                                  className="btn-link-action"
                                  onClick={() => setSelectedProfileResponder(resp)}
                                >
                                  Profile
                                </button>
                                <button
                                  type="button"
                                  className="btn-link-action"
                                  onClick={() => handleCenterOnResponder(resp)}
                                >
                                  Map
                                </button>
                                <button
                                  type="button"
                                  className="btn-link-action"
                                  onClick={() => setDispatchModalResponder(resp)}
                                >
                                  Dispatch
                                </button>
                                <button
                                  type="button"
                                  className="btn-link-action"
                                  onClick={() => setContactModalResponder(resp)}
                                >
                                  Radio
                                </button>
                                <button
                                  type="button"
                                  className="btn-link-action"
                                  style={{ color: '#f87171' }}
                                  onClick={() => handleDeleteResponder(resp.id || resp.responder_id, resp.name)}
                                >
                                  Delete
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* SCREEN 3: INCIDENT DETAILS VIEW                      */}
          {/* ==================================================== */}
          {activeScreen === 'emergency_details' && (
            !selectedEmergency ? (
              <div className="empty-queue-box" style={{ padding: '60px 20px', textAlign: 'center', margin: '30px auto', maxWidth: '600px' }}>
                <div className="empty-queue-icon">🚨</div>
                <h3 className="empty-queue-title">No Emergency Selected</h3>
                <p className="empty-queue-text">
                  Select an active incident from the Dashboard or Queue to inspect tactical details, unit tracking, and communications.
                </p>
                <button
                  type="button"
                  className="btn btn-secondary"
                  style={{ marginTop: '16px' }}
                  onClick={() => setActiveScreen('emergencies')}
                >
                  View Emergency Incidents
                </button>
              </div>
            ) : (
            <div className="details-view-container">
              <div className="details-back-bar">
                <button type="button" className="btn btn-back" onClick={() => setActiveScreen('emergencies')}>
                  ← Back to Emergencies
                </button>
                <div className="incident-meta-tag">
                  Incident ID: <strong>{selectedEmergency.id}</strong>
                </div>
              </div>

              {/* Hero Incident Card */}
              <div className="incident-hero-card">
                <div className="incident-hero-header">
                  <div className="incident-title-group">
                    <span className="emergency-type-badge">
                      {getEmergencyIcon(selectedEmergency.type)} {selectedEmergency.type.toUpperCase()} EMERGENCY
                    </span>
                    <h2 className="incident-id-display">{selectedEmergency.id}</h2>
                  </div>

                  <div className="incident-badges-group">
                    <span className={`priority-badge ${selectedEmergency.priority.includes('P1') ? 'priority-p1' : 'priority-p2'}`}>
                      {selectedEmergency.priority}
                    </span>
                    <span className="severity-badge">Severity: {selectedEmergency.severity}</span>
                    <span className="status-badge-hero">STATUS: {selectedEmergency.status}</span>
                  </div>
                </div>

                {/* Priority Escalation Alert Banner */}
                {selectedEmergency.escalationRequest && (
                  <div className="escalation-alert-banner">
                    <div className="esc-alert-text">
                      <strong>⚡ Priority Escalation Requested:</strong> {selectedEmergency.escalationRequest.requestedBy} requested upgrade to {selectedEmergency.escalationRequest.targetPriority}.
                      <div className="esc-reason">Reason: "{selectedEmergency.escalationRequest.reason}" ({selectedEmergency.escalationRequest.timestamp})</div>
                    </div>
                    {currentRole === 'admin' && (
                      <button
                        type="button"
                        className="btn btn-approve-esc"
                        onClick={() => handleApproveEscalation(selectedEmergency.id)}
                      >
                        [ Approve Escalation to P1 ]
                      </button>
                    )}
                  </div>
                )}

                {/* Key Metrics Grid */}
                <div className="incident-metrics-grid">
                  <div className="metric-box">
                    <div className="metric-label">VICTIM LOCATION</div>
                    <div className="metric-value">📍 {selectedEmergency.location}</div>
                  </div>
                  <div className="metric-box">
                    <div className="metric-label">PEOPLE AFFECTED</div>
                    <div className="metric-value">👥 {selectedEmergency.peopleAffected}</div>
                  </div>
                  <div className="metric-box">
                    <div className="metric-label">REPORTED TIME</div>
                    <div className="metric-value">⏱️ {selectedEmergency.createdTime} ({selectedEmergency.time})</div>
                  </div>
                  <div className="metric-box">
                    <div className="metric-label">ASSIGNED RESPONDERS</div>
                    <div className="metric-value">
                      {selectedEmergency.assignedResponders.length > 0 ? (
                        <span className="assigned-text">
                          ✓ {selectedEmergency.assignedResponders.length} Unit(s) Assigned
                        </span>
                      ) : (
                        <span className="unassigned-text">Waiting for Assignment</span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Action Bar */}
                <div className="hero-actions-row">
                  {currentRole === 'admin' ? (
                    <div className="admin-priority-controls">
                      <span className="ctrl-label">Escalate / Set Priority:</span>
                      {['P1 - Critical', 'P2 - High', 'P3 - Medium', 'P4 - Low'].map(p => (
                        <button
                          key={p}
                          type="button"
                          className={`btn-priority-toggle ${selectedEmergency.priority === p ? 'active' : ''}`}
                          onClick={() => handleAdminEscalatePriority(selectedEmergency.id, p)}
                        >
                          {p.split(' - ')[0]}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <div className="responder-priority-controls">
                      {!selectedEmergency.escalationRequest ? (
                        <button
                          type="button"
                          className="btn btn-request-esc"
                          onClick={() => setShowEscalationModal(true)}
                        >
                          ⚡ [ Request Priority Escalation ]
                        </button>
                      ) : (
                        <div className="esc-pending-chip">
                          ✓ Priority Escalation Requested (Pending Admin Review)
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    type="button"
                    className="btn btn-secondary btn-jump-map"
                    onClick={() => {
                      setMapSelectedEmergencyId(selectedEmergency.id);
                      setActiveScreen('map');
                    }}
                  >
                    🗺️ View On Tactical Map
                  </button>
                </div>
              </div>

              {/* SECTION: 10-STEP VISUAL STATUS TIMELINE */}
              <div className="timeline-section-card">
                <div className="section-card-header">
                  <h3 className="section-title">
                    <span className="section-icon">📈</span> Emergency Status Timeline
                  </h3>
                  <div className="timeline-legend">
                    <span className="legend-item"><span className="legend-dot completed"></span> Completed</span>
                    <span className="legend-item"><span className="legend-dot active"></span> Active</span>
                    <span className="legend-item"><span className="legend-dot pending"></span> Pending</span>
                  </div>
                </div>

                <div className="visual-timeline-container">
                  <div className="timeline-track">
                    {TIMELINE_STEPS.map((step, index) => {
                      const currentIdx = getTimelineStepIndex(selectedEmergency.status);
                      const isCompleted = index < currentIdx;
                      const isActive = index === currentIdx;
                      const isPending = index > currentIdx;

                      return (
                        <div
                          key={step.id}
                          className={`timeline-step-node ${isCompleted ? 'completed' : ''} ${isActive ? 'active' : ''} ${isPending ? 'pending' : ''}`}
                        >
                          <div className="node-marker">
                            {isCompleted ? '✓' : isActive ? '●' : '○'}
                          </div>
                          <div className="node-info">
                            <div className="node-label">{step.label}</div>
                            <div className="node-desc">{step.desc}</div>
                          </div>
                          {index < TIMELINE_STEPS.length - 1 && (
                            <div className={`node-connector ${isCompleted ? 'completed' : ''}`} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Milestone Durations */}
                <div className="response-tracking-strip">
                  <div className="track-step"><span>Created:</span> <strong>{selectedEmergency.responseTracking.created || '--'}</strong></div>
                  <div className="track-step"><span>Notified:</span> <strong>{selectedEmergency.responseTracking.notified || '--'}</strong></div>
                  <div className="track-step"><span>Assigned:</span> <strong>{selectedEmergency.responseTracking.assigned || '--'}</strong></div>
                  <div className="track-step"><span>Accepted:</span> <strong>{selectedEmergency.responseTracking.accepted || '--'}</strong></div>
                  <div className="track-step"><span>On The Way:</span> <strong>{selectedEmergency.responseTracking.onTheWay || '--'}</strong></div>
                  <div className="track-step"><span>Arrived:</span> <strong>{selectedEmergency.responseTracking.arrived || '--'}</strong></div>
                  <div className="track-step"><span>Service Started:</span> <strong>{selectedEmergency.responseTracking.serviceStarted || '--'}</strong></div>
                  <div className="track-step"><span>Resolved:</span> <strong>{selectedEmergency.responseTracking.resolved || '--'}</strong></div>
                </div>
              </div>

              {/* SECTION: TEAM MEMBERS & MULTI-RESPONDER DISPATCH */}
              <div className="team-coordination-card">
                <div className="section-card-header">
                  <h3 className="section-title">
                    <span className="section-icon">👥</span> Assigned Response Team
                  </h3>
                  {currentRole === 'admin' && (
                    <div className="assign-btn-group">
                      <button
                        type="button"
                        className="btn btn-sm btn-admin"
                        onClick={() => setAssigningMode('primary')}
                      >
                        + Assign Primary
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => setAssigningMode('supporting')}
                      >
                        + Add Supporting
                      </button>
                    </div>
                  )}
                </div>

                {selectedEmergency.assignedResponders.length === 0 ? (
                  <div className="no-team-assigned">
                    No field units currently assigned to this incident.
                    {currentRole === 'admin' && (
                      <div style={{ marginTop: '10px' }}>
                        <button type="button" className="btn btn-responder-primary" onClick={() => setAssigningMode('primary')}>
                          Assign Initial Primary Responder
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="team-members-grid">
                    {selectedEmergency.assignedResponders.map(resp => (
                      <div key={resp.name} className={`team-member-card ${resp.isPrimary ? 'primary-resp' : ''}`}>
                        <div className="member-top">
                          <div>
                            <div className="member-role-badge">
                              {resp.isPrimary ? '⭐ PRIMARY RESPONDER' : 'SUPPORTING RESPONDER'}
                            </div>
                            <h4 className="member-name">{resp.name}</h4>
                            <div className="member-sub">{resp.role} • {resp.team}</div>
                          </div>
                          <span className="member-status-pill">{resp.status || 'Assigned'}</span>
                        </div>

                        <div className="member-meta">
                          <span>📍 {resp.location}</span>
                          <span>{resp.connection === 'Online' ? '🟢 Online (LTE)' : '🔵 LoRa'}</span>
                        </div>

                        {currentRole === 'admin' && (
                          <div className="member-actions">
                            <button
                              type="button"
                              className="btn-link-action remove"
                              onClick={() => handleRemoveResponder(selectedEmergency.id, resp.name)}
                            >
                              Remove from Mission
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* Modal for selecting a responder to assign */}
                {assigningMode && (
                  <div className="assign-modal-panel">
                    <div className="assign-panel-header">
                      <h4>Select {assigningMode === 'primary' ? 'Primary' : 'Supporting'} Responder</h4>
                      <button type="button" className="btn-close" onClick={() => setAssigningMode(null)}>✕</button>
                    </div>
                    <div className="roster-assign-grid">
                      {responders.filter(r => r.availability === 'Available').map(r => (
                        <div key={r.id} className="roster-assign-card">
                          <div className="resp-card-info">
                            <div className="resp-name">{r.name} ({r.id})</div>
                            <div className="resp-role">{r.role} • {r.team}</div>
                            <div className="resp-meta">
                              <span>📍 {r.location}</span>
                              <span className="status-online">🟢 Available</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-assign"
                            onClick={() => handleAssignResponder(selectedEmergency.id, r, assigningMode === 'primary')}
                          >
                            [ Assign as {assigningMode === 'primary' ? 'Primary' : 'Supporting'} ]
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* SECTION: RESPONDER ACTIONS (Responder Only) */}
              {currentRole === 'responder' && (
                <div className="responder-actions-card">
                  <div className="section-card-header">
                    <h3 className="section-title">
                      <span className="section-icon">⚡</span> Field Protocol Actions
                    </h3>
                    <span className="sub-tag">State Machine</span>
                  </div>

                  <div className="responder-action-flow">
                    {(selectedEmergency.status === 'RESPONDER_ASSIGNED' || selectedEmergency.status === 'TEAM_NOTIFIED') && (
                      <div className="action-step-box">
                        <p className="action-step-prompt">You have been designated for this incident. Acknowledge and accept deployment:</p>
                        <button
                          type="button"
                          className="btn btn-responder-primary"
                          onClick={() => handleUpdateStatus(selectedEmergency.id, 'RESPONDER_ACCEPTED', 'Responder Accepted')}
                        >
                          [ Accept Assignment ]
                        </button>
                      </div>
                    )}

                    {selectedEmergency.status === 'RESPONDER_ACCEPTED' && (
                      <div className="action-step-box">
                        <p className="action-step-prompt">Mission acknowledged. Prepare coordinates and begin transit:</p>
                        <div className="action-buttons-row">
                          <button
                            type="button"
                            className="btn btn-admin"
                            onClick={() => showToast(`Navigation started to ${selectedEmergency.location} (Distance: 3.2km, ETA: 7m)`)}
                          >
                            [ Start Navigation ]
                          </button>
                          <button
                            type="button"
                            className="btn btn-responder-primary"
                            onClick={() => handleUpdateStatus(selectedEmergency.id, 'ON_THE_WAY', 'On The Way')}
                          >
                            [ Mark On The Way ]
                          </button>
                        </div>
                      </div>
                    )}

                    {selectedEmergency.status === 'ON_THE_WAY' && (
                      <div className="action-step-box">
                        <p className="action-step-prompt">En route to incident coordinates. Confirm arrival when on-scene:</p>
                        <button
                          type="button"
                          className="btn btn-responder-primary"
                          onClick={() => handleUpdateStatus(selectedEmergency.id, 'ARRIVED', 'Arrived')}
                        >
                          [ Mark Arrived ]
                        </button>
                      </div>
                    )}

                    {selectedEmergency.status === 'ARRIVED' && (
                      <div className="action-step-box">
                        <p className="action-step-prompt">On-scene arrival logged. Begin triage and tactical service:</p>
                        <button
                          type="button"
                          className="btn btn-responder-primary"
                          onClick={() => handleUpdateStatus(selectedEmergency.id, 'SERVICE_STARTED', 'Service Started')}
                        >
                          [ Start Service ]
                        </button>
                      </div>
                    )}

                    {selectedEmergency.status === 'SERVICE_STARTED' && (
                      <div className="action-step-box">
                        <p className="action-step-prompt">Active rescue and stabilization underway. When victim safe and situation resolved:</p>
                        <button
                          type="button"
                          className="btn btn-resolve"
                          onClick={() => handleUpdateStatus(selectedEmergency.id, 'RESOLVED', 'Resolved')}
                        >
                          [ Resolve Emergency ]
                        </button>
                      </div>
                    )}

                    {selectedEmergency.status === 'RESOLVED' && (
                      <div className="resolved-banner">
                        <span className="check-badge">✓</span>
                        <div>
                          <strong>EMERGENCY RESOLVED</strong>
                          <div>All rescue protocols fulfilled. Incident officially closed.</div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* SECTION: NEARBY HOSPITALS & SAFE POINTS */}
              <div className="hospitals-section-card">
                <div className="section-card-header">
                  <h3 className="section-title">
                    <span className="section-icon">🏥</span> Nearby Hospitals & Safe Evacuation Points
                  </h3>
                  <span className="sub-tag">Regional Safe Zones</span>
                </div>

                <div className="hospitals-grid">
                  {selectedEmergency.hospitals && selectedEmergency.hospitals.map(hosp => (
                    <div key={hosp.name} className="hospital-card">
                      <div className="hosp-icon">🏥</div>
                      <div className="hosp-info">
                        <div className="hosp-name">{hosp.name}</div>
                        <div className="hosp-type">{hosp.type}</div>
                        <div className="hosp-dist">Distance: <strong>{hosp.distance}</strong> from incident</div>
                      </div>
                      <button
                        type="button"
                        className="btn-hosp-nav"
                        onClick={() => showToast(`Routing set to ${hosp.name} (${hosp.distance})`)}
                      >
                        Navigate
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              {/* SECTION: OPERATIONAL INCIDENT NOTES */}
              <div className="notes-section-card">
                <div className="section-card-header">
                  <h3 className="section-title">
                    <span className="section-icon">📝</span> Operational Incident Notes
                  </h3>
                  <span className="sub-tag">{selectedEmergency.notes.length} Recorded Entries</span>
                </div>

                <div className="notes-list">
                  {selectedEmergency.notes.map(note => (
                    <div key={note.id} className="note-item">
                      <div className="note-header">
                        <strong>{note.author}</strong> ({note.role})
                        <span className="note-time">{note.timestamp}</span>
                      </div>
                      <div className="note-body">"{note.message}"</div>
                    </div>
                  ))}
                </div>

                <form onSubmit={handleAddIncidentNote} className="add-note-form">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Enter incident observation, hazard note, or status update..."
                    value={newNoteText}
                    onChange={(e) => setNewNoteText(e.target.value)}
                  />
                  <button type="submit" className="btn btn-sm btn-admin">
                    Add Note
                  </button>
                </form>
              </div>

              {/* SECTION: VICTIM CHAT */}
              <div className="victim-comms-card">
                <div className="section-card-header">
                  <h3 className="section-title">
                    <span className="section-icon">💬</span> Direct Victim Comms Terminal
                  </h3>
                  <div className="comms-mode-toggle">
                    <span className="mode-label">Channel:</span>
                    <button
                      type="button"
                      className={`btn-mode ${chatMode === 'INTERNET' ? 'active' : ''}`}
                      onClick={() => setChatMode('INTERNET')}
                    >
                      Internet (LTE)
                    </button>
                    <button
                      type="button"
                      className={`btn-mode ${chatMode === 'LORA' ? 'active' : ''}`}
                      onClick={() => setChatMode('LORA')}
                    >
                      LoRa Mesh (RF)
                    </button>
                  </div>
                </div>

                <div className="chat-messages-box">
                  {selectedEmergency.chatMessages && selectedEmergency.chatMessages.map(msg => (
                    <div key={msg.id} className={`chat-bubble ${msg.sender === 'Responder' ? 'outgoing' : 'incoming'}`}>
                      <div className="bubble-author">
                        {msg.authorName} • <span className="bubble-mode">{msg.mode}</span>
                      </div>
                      <div className="bubble-text">{msg.message}</div>
                      <div className="bubble-time">{msg.timestamp}</div>
                    </div>
                  ))}
                </div>

                <form onSubmit={handleSendChatMessage} className="chat-input-form">
                  <input
                    type="text"
                    className="form-input"
                    placeholder={`Transmit message to victim via ${chatMode}...`}
                    value={newChatMessage}
                    onChange={(e) => setNewChatMessage(e.target.value)}
                  />
                  <button type="submit" className="btn btn-sm btn-responder-primary">
                    Transmit
                  </button>
                </form>
              </div>
            </div>
            )
          )}

          {/* ==================================================== */}
          {/* SCREEN 4: DASHBOARD                                  */}
          {/* ==================================================== */}
          {activeScreen === 'dashboard' && (
            <div className="dashboard-main-view">
              {currentRole === 'admin' ? (
                /* Admin Dashboard */
                <>
                  <div className="dashboard-metric-cards">
                    <div className="metric-stat-card">
                      <div className="stat-icon">🚨</div>
                      <div className="stat-body">
                        <div className="stat-label">Active Emergencies</div>
                        <div className="stat-number">{emergencies.length}</div>
                      </div>
                    </div>
                    <div className="metric-stat-card critical-stat">
                      <div className="stat-icon">🔴</div>
                      <div className="stat-body">
                        <div className="stat-label">Critical Emergencies</div>
                        <div className="stat-number">{emergencies.filter(e => e.priority.startsWith('P1')).length}</div>
                      </div>
                    </div>
                    <div className="metric-stat-card">
                      <div className="stat-icon">👥</div>
                      <div className="stat-body">
                        <div className="stat-label">Available Responders</div>
                        <div className="stat-number">{responders.filter(r => r.availability === 'Available').length}</div>
                      </div>
                    </div>
                    <div className="metric-stat-card">
                      <div className="stat-icon">⏱️</div>
                      <div className="stat-body">
                        <div className="stat-label">Average Response Time</div>
                        <div className="stat-number">08:42</div>
                      </div>
                    </div>
                  </div>

                  <div className="section-card-header" style={{ marginTop: '20px' }}>
                    <h3 className="section-title">🚨 Active Incidents (Critical First)</h3>
                    <button type="button" className="btn btn-sm btn-admin" onClick={() => setActiveScreen('emergencies')}>
                      [ View Full Queue ] ({dashboardEmergencies.length}) →
                    </button>
                  </div>

                  {dashboardEmergencies.length === 0 ? (
                    <div className="empty-queue-box" style={{ marginTop: '14px' }}>
                      <div className="empty-queue-icon">✓</div>
                      <h3 className="empty-queue-title">No active emergencies</h3>
                      <p className="empty-queue-text">All current emergency requests have been resolved.</p>
                    </div>
                  ) : (
                    <div className="tactical-emergency-grid" style={{ marginTop: '14px' }}>
                      {dashboardEmergencies.map(em => (
                        <EmergencyCard
                          key={em.id}
                          emergency={em}
                          variant="compact"
                          onView={(item) => handleViewEmergency(item.id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                /* Responder Dashboard */
                <>
                  <div className="responder-bio-card">
                    <div className="bio-avatar">{(responderProfile.name || 'RP').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</div>
                    <div className="bio-info">
                      <h2 className="bio-name">{responderProfile.name}</h2>
                      <div className="bio-meta">
                        <span className="bio-role">{responderProfile.role}</span>
                        <span className="bio-separator">•</span>
                        <span className="bio-team">{responderProfile.team}</span>
                        <span className="bio-separator">•</span>
                        <span className="bio-status-available">{responderProfile.availability}</span>
                      </div>
                    </div>
                  </div>

                  <div className="dashboard-metric-cards">
                    <div className="metric-stat-card">
                      <div className="stat-icon">🚨</div>
                      <div className="stat-body">
                        <div className="stat-label">Assigned Emergencies</div>
                        <div className="stat-number">{myAssignedEmergencies.length}</div>
                      </div>
                    </div>
                    <div className="metric-stat-card">
                      <div className="stat-icon">📍</div>
                      <div className="stat-body">
                        <div className="stat-label">Current Location</div>
                        <div className="stat-number" style={{ fontSize: '18px' }}>
                          {responderProfile.location || (gpsCoords ? `${gpsCoords.lat.toFixed(4)}, ${gpsCoords.lng.toFixed(4)}` : 'Live Telemetry')}
                        </div>
                      </div>
                    </div>
                    <div className="metric-stat-card">
                      <div className="stat-icon">📶</div>
                      <div className="stat-body">
                        <div className="stat-label">Connection</div>
                        <div className="stat-number" style={{ fontSize: '18px' }}>{globalConnection === 'ONLINE' ? '🟢 Online' : '🔵 LoRa'}</div>
                      </div>
                    </div>
                    <div className="metric-stat-card">
                      <div className="stat-icon">⏱️</div>
                      <div className="stat-body">
                        <div className="stat-label">Today's Response Time</div>
                        <div className="stat-number">06:15</div>
                      </div>
                    </div>
                  </div>

                  <div className="section-card-header" style={{ marginTop: '20px' }}>
                    <h3 className="section-title">🚨 My Assigned Deployments</h3>
                    <button type="button" className="btn btn-sm btn-admin" onClick={() => setActiveScreen('emergencies')}>
                      View All Assignments →
                    </button>
                  </div>

                  {myAssignedEmergencies.length === 0 ? (
                    <div className="empty-queue-box" style={{ marginTop: '14px' }}>
                      <div className="empty-queue-icon">✓</div>
                      <h3 className="empty-queue-title">All Assigned Missions Complete</h3>
                      <p className="empty-queue-text">Standby for incoming dispatches from regional command.</p>
                    </div>
                  ) : (
                    <div className="tactical-emergency-grid" style={{ marginTop: '14px' }}>
                      {myAssignedEmergencies.map(em => (
                        <EmergencyCard
                          key={em.id}
                          emergency={em}
                          variant="compact"
                          onView={(item) => handleViewEmergency(item.id)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* SCREEN 5: EMERGENCIES QUEUE                          */}
          {/* ==================================================== */}
          {activeScreen === 'emergencies' && (
            <div className="emergency-queue-section">
              {currentRole === 'admin' ? (
                <>
                  {/* LoRa Gateway Broadcast Banner */}
                  <div className="lora-gateway-alert-banner" style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '12px 18px',
                    background: 'rgba(6, 182, 212, 0.08)',
                    border: '1px solid rgba(6, 182, 212, 0.3)',
                    borderRadius: '8px',
                    marginBottom: '16px',
                    flexWrap: 'wrap',
                    gap: '12px'
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span style={{ fontSize: '22px' }}>📡</span>
                      <div>
                        <div style={{ fontWeight: '700', color: '#38bdf8', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span>ESP32 LoRa Receiver Gateway: LIVE</span>
                          <span style={{ display: 'inline-block', width: '8px', height: '8px', borderRadius: '50%', background: '#22c55e', boxShadow: '0 0 6px #22c55e' }}></span>
                        </div>
                        <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                          Listening for off-grid victim rescue packets on <code style={{ color: '#38bdf8' }}>http://172.16.10.217:5000/api/lora/message</code>
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        style={{
                          border: loraFilterOnly ? '1px solid #38bdf8' : '1px solid rgba(255,255,255,0.15)',
                          background: loraFilterOnly ? 'rgba(6, 182, 212, 0.2)' : 'transparent',
                          color: loraFilterOnly ? '#38bdf8' : '#cbd5e1'
                        }}
                        onClick={() => setLoraFilterOnly(!loraFilterOnly)}
                      >
                        {loraFilterOnly ? '✓ Filtering: LoRa Only' : '📡 Filter LoRa Only'}
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-admin"
                        style={{ background: '#0284c7', borderColor: '#38bdf8' }}
                        onClick={() => setShowLoraModal(true)}
                      >
                        ⚙️ LoRa Gateway Info & Code
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={handleSimulateLoraPacket}
                        title="Simulate incoming LoRa packet"
                      >
                        ⚡ Simulate Packet
                      </button>
                    </div>
                  </div>

                  <EmergencyFilters
                    searchQuery={queueSearchQuery}
                    onSearchChange={setQueueSearchQuery}
                    typeFilter={queueTypeFilter}
                    onTypeChange={setQueueTypeFilter}
                    priorityFilter={priorityFilter}
                    onPriorityChange={setPriorityFilter}
                    statusFilter={queueStatusFilter}
                    onStatusChange={setQueueStatusFilter}
                    assignmentFilter={queueAssignmentFilter}
                    onAssignmentChange={setQueueAssignmentFilter}
                    sortBy={queueSortBy}
                    onSortChange={setQueueSortBy}
                    stats={{
                      active: queueActiveCount,
                      critical: queueCriticalCount,
                      unassigned: queueUnassignedCount
                    }}
                  />

                  {filteredQueueEmergencies.length === 0 ? (
                    <div className="empty-queue-box">
                      <div className="empty-queue-icon">📡</div>
                      <h3 className="empty-queue-title">
                        {loraFilterOnly ? 'No LoRa Rescue Messages Received' : 'No Active Emergencies'}
                      </h3>
                      <p className="empty-queue-text" style={{ maxWidth: '520px', margin: '0 auto 16px' }}>
                        The command center is actively listening for off-grid ESP32 LoRa rescue messages on <strong>http://172.16.10.217:5000/api/lora/message</strong>.
                        When a victim node transmits, the incident will appear here in real time.
                      </p>
                      <div style={{ display: 'flex', gap: '10px', justifyContent: 'center' }}>
                        <button
                          type="button"
                          className="btn btn-sm btn-admin"
                          onClick={handleSimulateLoraPacket}
                        >
                          ⚡ Test / Simulate LoRa Signal
                        </button>
                        <button
                          type="button"
                          className="btn btn-sm btn-secondary"
                          onClick={() => setShowLoraModal(true)}
                        >
                          ⚙️ View ESP32 Arduino Code
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="tactical-emergency-grid">
                      {filteredQueueEmergencies.map(em => (
                        <EmergencyCard
                          key={em.id}
                          emergency={em}
                          variant="detailed"
                          onView={(item) => handleViewEmergency(item.id)}
                          onAssign={(item) => setAssignModalEmergency(item)}
                          onReassign={(item) => setAssignModalEmergency(item)}
                          onTrack={(item) => handleTrackEmergency(item)}
                        />
                      ))}
                    </div>
                  )}
                </>
              ) : (
                /* Responder View in Queue */
                <>
                  <div className="emergency-queue-header-area">
                    <div className="queue-title-row">
                      <div>
                        <h2 className="queue-heading">🚨 My Assigned Deployments</h2>
                        <p className="queue-subheading">
                          Active field missions designated to {responderProfile.name} ({responderProfile.role})
                        </p>
                      </div>
                    </div>
                  </div>

                  {myAssignedEmergencies.length === 0 ? (
                    <div className="empty-queue-box">
                      <div className="empty-queue-icon">✓</div>
                      <h3 className="empty-queue-title">No active emergencies</h3>
                      <p className="empty-queue-text">
                        All current assigned missions have been completed. Standby for dispatch.
                      </p>
                    </div>
                  ) : (
                    <div className="tactical-emergency-grid">
                      {myAssignedEmergencies.map(em => (
                        <EmergencyCard
                          key={em.id}
                          emergency={em}
                          variant="detailed"
                          onView={(item) => handleViewEmergency(item.id)}
                          onTrack={(item) => handleTrackEmergency(item)}
                        />
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* SCREEN 6: DEDICATED HISTORY                          */}
          {/* ==================================================== */}
          {activeScreen === 'history' && (
            <div className="history-screen-wrapper">
              <div className="queue-controls">
                <div>
                  <h2 className="queue-title">📜 Operational Incident History</h2>
                  <p className="queue-subtitle">
                    {currentRole === 'admin'
                      ? 'Archived log of past regional emergencies, resolution metrics, and audit summaries'
                      : `Historical emergencies resolved by ${responderProfile.name}`}
                  </p>
                </div>
              </div>

              {/* Filters Toolbar */}
              <div className="history-filters-bar">
                <div className="history-search-input">
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Search by Emergency ID or Location..."
                    value={historySearchQuery}
                    onChange={(e) => setHistorySearchQuery(e.target.value)}
                  />
                </div>

                <div className="history-filter-selects">
                  <select
                    className="form-select"
                    value={historyTypeFilter}
                    onChange={(e) => setHistoryTypeFilter(e.target.value)}
                  >
                    <option value="ALL">All Emergency Types</option>
                    {EMERGENCY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                  </select>

                  <select
                    className="form-select"
                    value={historyStatusFilter}
                    onChange={(e) => setHistoryStatusFilter(e.target.value)}
                  >
                    <option value="ALL">All Statuses</option>
                    <option value="RESOLVED">Resolved</option>
                    <option value="CANCELLED">Cancelled</option>
                  </select>
                </div>
              </div>

              {/* History Items List */}
              <div className="history-items-list">
                {historyList.length === 0 ? (
                  <div className="empty-assigned-box">
                    <p className="empty-sub">No emergency history available</p>
                  </div>
                ) : filteredHistory.length === 0 ? (
                  <div className="empty-assigned-box">
                    <p className="empty-sub">No historical incident records match the current filter criteria.</p>
                  </div>
                ) : (
                  filteredHistory.map(item => (
                    <div key={item.id} className="history-card-item" onClick={() => setSelectedHistoryItem(item)}>
                      <div className="history-card-header">
                        <div className="history-id-block">
                          <span className="history-type-icon">{getEmergencyIcon(item.type)}</span>
                          <strong>{item.id}</strong>
                          <span className="history-type-name">{item.type}</span>
                        </div>
                        <div className="history-badges">
                          <span className={`priority-tag ${item.priority.includes('P1') ? 'priority-p1' : 'priority-p2'}`}>
                            {item.priority}
                          </span>
                          <span className={`status-pill ${item.finalStatus === 'RESOLVED' ? 'resolved' : 'cancelled'}`}>
                            {item.finalStatus}
                          </span>
                        </div>
                      </div>

                      <div className="history-metrics-row">
                        <div><strong>Location:</strong> 📍 {item.location}</div>
                        <div><strong>Units:</strong> 👥 {item.assignedRespondersCount} Responders</div>
                        <div><strong>Created:</strong> {item.createdTime}</div>
                        <div><strong>Resolved:</strong> {item.resolvedTime}</div>
                        <div><strong>Duration:</strong> ⏱️ {item.responseDuration}</div>
                      </div>

                      <div className="history-summary-text">"{item.auditSummary}"</div>
                      <div className="history-inspect-hint">Click to inspect full audit details →</div>
                    </div>
                  ))
                )}
              </div>

              {/* History Details Inspection Modal */}
              {selectedHistoryItem && (
                <div className="modal-backdrop">
                  <div className="modal-content-card">
                    <div className="modal-header">
                      <h3>Incident Archive: {selectedHistoryItem.id}</h3>
                      <button type="button" className="btn-close" onClick={() => setSelectedHistoryItem(null)}>✕</button>
                    </div>
                    <div className="modal-body">
                      <div className="archive-detail-row"><strong>Emergency Type:</strong> {selectedHistoryItem.type}</div>
                      <div className="archive-detail-row"><strong>Priority:</strong> {selectedHistoryItem.priority}</div>
                      <div className="archive-detail-row"><strong>Location:</strong> 📍 {selectedHistoryItem.location}</div>
                      <div className="archive-detail-row"><strong>Created Time:</strong> {selectedHistoryItem.createdTime}</div>
                      <div className="archive-detail-row"><strong>Resolved Time:</strong> {selectedHistoryItem.resolvedTime}</div>
                      <div className="archive-detail-row"><strong>Total Response Duration:</strong> {selectedHistoryItem.responseDuration}</div>
                      <div className="archive-detail-row"><strong>Final Status:</strong> {selectedHistoryItem.finalStatus}</div>
                      <div className="archive-detail-row"><strong>Audit Log Summary:</strong> {selectedHistoryItem.auditSummary}</div>
                      <h4 style={{ marginTop: '16px', marginBottom: '8px' }}>Units Deployed:</h4>
                      <ul>
                        {selectedHistoryItem.assignedResponders.map(r => (
                          <li key={r.name}>{r.name} — {r.role} ({r.team}) {r.isPrimary ? '⭐ Primary' : 'Supporting'}</li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ==================================================== */}
          {/* SCREEN 7: ANALYTICS & AUDIT (ADMIN ONLY)             */}
          {/* ==================================================== */}
          {activeScreen === 'analytics' && currentRole === 'admin' && (
            <div className="analytics-screen-wrapper">
              <div className="queue-controls">
                <div>
                  <h2 className="queue-title">📈 Command Analytics & Audit Logs</h2>
                  <p className="queue-subtitle">Operational metrics, triage distributions, and tamper-evident audit logs</p>
                </div>
              </div>

              <div className="dashboard-metric-cards">
                <div className="metric-stat-card"><div className="stat-icon">📊</div><div className="stat-body"><div className="stat-label">Total Handled</div><div className="stat-number">{emergencies.length + historyList.length}</div></div></div>
                <div className="metric-stat-card"><div className="stat-icon">🚨</div><div className="stat-body"><div className="stat-label">Active Queue</div><div className="stat-number">{emergencies.length}</div></div></div>
                <div className="metric-stat-card"><div className="stat-icon">✓</div><div className="stat-body"><div className="stat-label">Resolved Incidents</div><div className="stat-number">{historyList.length}</div></div></div>
                <div className="metric-stat-card critical-stat"><div className="stat-icon">🔴</div><div className="stat-body"><div className="stat-label">Critical P1 Rate</div><div className="stat-number">{emergencies.length > 0 ? `${Math.round((emergencies.filter(e => e.priority?.includes('P1')).length / emergencies.length) * 100)}%` : '0%'}</div></div></div>
              </div>

              <div className="analytics-breakdown-grid">
                <div className="analytics-card">
                  <h4 className="card-title">Emergency Type Breakdown</h4>
                  <div className="breakdown-list">
                    {(() => {
                      const all = [...emergencies, ...historyList];
                      if (all.length === 0) {
                        return <div style={{ color: '#8b949e', padding: '12px 0' }}>No incident records recorded yet.</div>;
                      }
                      const counts = {};
                      all.forEach(item => {
                        const t = item.type || 'Other';
                        counts[t] = (counts[t] || 0) + 1;
                      });
                      return Object.entries(counts).map(([t, count]) => {
                        const pct = Math.round((count / all.length) * 100);
                        return (
                          <div key={t} className="breakdown-item">
                            <span>{getEmergencyIcon(t)} {t}:</span> <strong>{pct}% ({count} {count === 1 ? 'incident' : 'incidents'})</strong>
                          </div>
                        );
                      });
                    })()}
                  </div>
                </div>

                <div className="analytics-card">
                  <h4 className="card-title">Responder Unit Performance</h4>
                  <div className="performance-table-wrapper">
                    <table className="tactical-table">
                      <thead>
                        <tr>
                          <th>Responder</th>
                          <th>Role</th>
                          <th>Handled</th>
                          <th>Resolved</th>
                          <th>Avg Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {responders.map(r => (
                          <tr key={r.id}>
                            <td><strong>{r.name}</strong></td>
                            <td>{r.role}</td>
                            <td>{r.emergenciesHandled}</td>
                            <td>{r.emergenciesResolved}</td>
                            <td>{r.avgResponseTime}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="audit-trail-section">
                <div className="section-card-header">
                  <h3 className="section-title">🛡️ System Audit Trail (Tamper-Evident Chronological Log)</h3>
                  <span className="sub-tag">Logged Events: {auditLogs.length}</span>
                </div>

                <div className="audit-logs-table-wrapper">
                  <table className="tactical-table">
                    <thead>
                      <tr>
                        <th>Timestamp</th>
                        <th>Action</th>
                        <th>User</th>
                        <th>Incident</th>
                        <th>Details</th>
                      </tr>
                    </thead>
                    <tbody>
                      {auditLogs.map(log => (
                        <tr key={log.id}>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{log.timestamp}</td>
                          <td><span className="audit-action-chip">{log.action}</span></td>
                          <td>{log.user}</td>
                          <td style={{ fontFamily: 'var(--font-mono)' }}>{log.incidentId}</td>
                          <td>{log.details}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* ==================================================== */}
          {/* SCREEN 8: NOTIFICATIONS SCREEN                       */}
          {/* ==================================================== */}
          {activeScreen === 'notifications' && (
            <div className="notifications-screen-wrapper">
              <div className="queue-controls">
                <div>
                  <h2 className="queue-title">🔔 Emergency Notifications & Dispatch Broadcasts</h2>
                  <p className="queue-subtitle">Mission alerts, escalation requests, and team updates</p>
                </div>
                <button
                  type="button"
                  className="btn btn-sm btn-secondary"
                  onClick={async () => {
                    try {
                      await api.notifications.markAllAsRead();
                    } catch (e) {
                      console.warn('markAllAsRead error:', e);
                    }
                    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
                    showToast('All notifications marked as read');
                  }}
                >
                  Mark All As Read
                </button>
              </div>

              <div className="notifications-list">
                {notifications.filter(n => n.forRole === 'both' || n.forRole === currentRole).length === 0 ? (
                  <div className="empty-assigned-box">
                    <p className="empty-sub">No notifications available</p>
                  </div>
                ) : (
                  notifications
                    .filter(n => n.forRole === 'both' || n.forRole === currentRole)
                    .map(notif => (
                      <div
                        key={notif.id}
                        className={`notification-card ${notif.read ? 'read' : 'unread'}`}
                        style={{ cursor: 'pointer' }}
                        onClick={async () => {
                          if (!notif.read && notif.id) {
                            try {
                              await api.notifications.markAsRead(notif.id);
                            } catch (e) {
                              console.warn('markAsRead error:', e);
                            }
                            setNotifications(prev => prev.map(n => n.id === notif.id ? { ...n, read: true } : n));
                          }
                        }}
                      >
                        <div className="notif-header">
                          <div className="notif-title-row">
                            <span className={`notif-icon-badge ${notif.type}`}>{notif.type === 'critical' ? '🔴' : notif.type === 'escalation' ? '⚡' : '📋'}</span>
                            <h4 className="notif-title">{notif.title}</h4>
                          </div>
                          <span className="notif-time">{notif.time}</span>
                        </div>
                        <div className="notif-body">{notif.body}</div>
                      </div>
                    ))
                )}
              </div>
            </div>
          )}

          {/* ==================================================== */}
          {/* SCREEN 9: PROFILES (ADMIN OR RESPONDER)              */}
          {/* ==================================================== */}
          {activeScreen === 'profile' && (
            <div className="profile-screen-wrapper">
              {currentRole === 'admin' ? (
                /* Complete Admin Profile */
                <div className="profile-container-card">
                  <div className="profile-header-banner">
                    <div className="profile-avatar-large">{(adminProfile.name || 'AD').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</div>
                    <div className="profile-header-text">
                      <div className="profile-badge-line">
                        <span className="profile-role-tag">COMMAND ADMINISTRATOR</span>
                        <span className="badge-id-tag">ID: {adminProfile.adminId}</span>
                      </div>
                      <h2 className="profile-name-title">{adminProfile.name}</h2>
                      <div className="profile-sub-role">
                        {adminProfile.role} • {adminProfile.department}
                      </div>
                      <div className="profile-status-line">
                        <span className="status-online">🟢 {adminProfile.status}</span>
                      </div>
                    </div>
                  </div>

                  <div className="profile-sections-grid">
                    <div className="profile-section-box">
                      <h4 className="box-title">Personal & Contact Info</h4>
                      <div className="info-row"><span>Admin ID:</span> <strong>{adminProfile.adminId}</strong></div>
                      <div className="info-row"><span>Official Email:</span> <strong>{adminProfile.email}</strong></div>
                      <div className="info-row"><span>Secure Phone:</span> <strong>{adminProfile.phone}</strong></div>
                      <div className="info-row"><span>Command Sector:</span> <strong>Regional Command Center (South Zone)</strong></div>
                    </div>

                    <div className="profile-section-box">
                      <h4 className="box-title">System Permissions Summary</h4>
                      <div className="permission-item">✓ Full Regional Incident Dispatch & Assignment</div>
                      <div className="permission-item">✓ Priority Escalation & Manual Override Authority</div>
                      <div className="permission-item">✓ Tamper-Evident System Audit Trail Access</div>
                      <div className="permission-item">✓ Multi-Unit Responder Fleet Telemetry Oversight</div>
                      <div className="permission-item">✓ Safe Evacuation Point & Trauma Center Coordination</div>
                    </div>

                    <div className="profile-section-box">
                      <h4 className="box-title">Recent Administrative Activity</h4>
                      <div className="recent-activity-list">
                        {auditLogs.length === 0 ? (
                          <div style={{ color: '#8b949e', fontSize: '13px', padding: '6px 0' }}>No recent administrative activity logged</div>
                        ) : (
                          auditLogs.slice(0, 4).map(log => (
                            <div key={log.id} className="activity-item">
                              <span className="act-dot">●</span> {log.action} {log.incidentId && log.incidentId !== 'SYSTEM' ? `(${log.incidentId})` : ''} — {log.details} ({log.timestamp})
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="profile-section-box">
                      <h4 className="box-title">Account Security</h4>
                      <div className="info-row"><span>Session Protocol:</span> <strong>Encrypted Token (Sandboxed)</strong></div>
                      <div className="info-row"><span>Two-Factor Auth:</span> <strong>Hardware Key Verified</strong></div>
                      <div className="info-row"><span>Account Status:</span> <strong>Active & Operational</strong></div>
                    </div>
                  </div>

                  <div className="profile-actions-row">
                    <button type="button" className="btn btn-admin" onClick={() => setShowEditProfileModal(true)}>
                      [ Edit Profile ]
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowPasswordModal(true)}>
                      [ Change Password ]
                    </button>
                    <button type="button" className="btn btn-logout" onClick={handleLogout}>
                      [ Logout ]
                    </button>
                  </div>
                </div>
              ) : (
                /* Complete Responder Profile */
                <div className="profile-container-card">
                  <div className="profile-header-banner">
                    <div className="profile-avatar-large">{(responderProfile.name || 'RP').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}</div>
                    <div className="profile-header-text">
                      <div className="profile-badge-line">
                        <span className="profile-role-tag">FIELD RESPONDER</span>
                        <span className="badge-id-tag">ID: {responderProfile.responderId}</span>
                      </div>
                      <h2 className="profile-name-title">{responderProfile.name}</h2>
                      <div className="profile-sub-role">
                        {responderProfile.role} • {responderProfile.team} ({responderProfile.specialization})
                      </div>

                      <div className="profile-avail-selector">
                        <span className="avail-label">Live Field Availability:</span>
                        <button
                          type="button"
                          className={`btn-avail ${responderProfile.availability === 'Available' ? 'active-green' : ''}`}
                          onClick={() => handleResponderAvailabilityToggle('Available')}
                        >
                          🟢 Available
                        </button>
                        <button
                          type="button"
                          className={`btn-avail ${responderProfile.availability === 'Busy' ? 'active-orange' : ''}`}
                          onClick={() => handleResponderAvailabilityToggle('Busy')}
                        >
                          🟠 Busy
                        </button>
                        <button
                          type="button"
                          className={`btn-avail ${responderProfile.availability === 'Offline' ? 'active-muted' : ''}`}
                          onClick={() => handleResponderAvailabilityToggle('Offline')}
                        >
                          ⚫ Offline
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="profile-sections-grid">
                    <div className="profile-section-box">
                      <h4 className="box-title">Field Responder Details</h4>
                      <div className="info-row"><span>Responder ID:</span> <strong>{responderProfile.responderId}</strong></div>
                      <div className="info-row"><span>Assigned Team:</span> <strong>{responderProfile.team}</strong></div>
                      <div className="info-row"><span>Specialization:</span> <strong>{responderProfile.specialization}</strong></div>
                      <div className="info-row"><span>Field Experience:</span> <strong>{responderProfile.experience}</strong></div>
                      <div className="info-row"><span>Current Sector:</span> <strong>📍 {responderProfile.location || (gpsCoords ? `${gpsCoords.lat.toFixed(4)}, ${gpsCoords.lng.toFixed(4)}` : 'Live Telemetry Sector')}</strong></div>
                    </div>

                    <div className="profile-section-box">
                      <h4 className="box-title">Response Performance Statistics</h4>
                      <div className="info-row"><span>Emergencies Handled:</span> <strong>{responderProfile.emergenciesHandled}</strong></div>
                      <div className="info-row"><span>Emergencies Resolved:</span> <strong>{responderProfile.emergenciesResolved}</strong></div>
                      <div className="info-row"><span>Average Response Time:</span> <strong>{responderProfile.avgResponseTime}</strong></div>
                      <div className="info-row"><span>Success / Triage Rate:</span> <strong>98.2%</strong></div>
                      <div className="info-row"><span>Active Missions:</span> <strong>{myAssignedEmergencies.length} Active</strong></div>
                    </div>

                    <div className="profile-section-box">
                      <h4 className="box-title">Recent Emergency History (Personal)</h4>
                      <div className="recent-activity-list">
                        {historyList.filter(h => h.assignedResponders.some(r => r.name === responderProfile.name)).slice(0, 3).map(h => (
                          <div key={h.id} className="activity-item">
                            <span className="act-dot">●</span> <strong>{h.id}</strong> ({h.type}) — {h.responseDuration} ({h.finalStatus})
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="profile-section-box">
                      <h4 className="box-title">Contact & Communication Status</h4>
                      <div className="info-row"><span>Direct Phone:</span> <strong>{responderProfile.phone}</strong></div>
                      <div className="info-row"><span>Dispatch Email:</span> <strong>{responderProfile.email}</strong></div>
                      <div className="info-row"><span>Radio Mesh Link:</span> <strong>LoRa 433 MHz (Active)</strong></div>
                      <div className="info-row"><span>Live Device GPS:</span> <strong>{gpsStatus}</strong></div>
                    </div>
                  </div>

                  <div className="profile-actions-row">
                    <button type="button" className="btn btn-admin" onClick={() => setShowEditProfileModal(true)}>
                      [ Edit Profile ]
                    </button>
                    <button type="button" className="btn btn-secondary" onClick={() => setShowPasswordModal(true)}>
                      [ Change Password ]
                    </button>
                    <button type="button" className="btn btn-logout" onClick={handleLogout}>
                      [ Logout ]
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* ========================================================== */}
      {/* MODALS: RESPONDER PROFILE, CONTACT, DISPATCH, ESCALATE      */}
      {/* ========================================================== */}

      {/* Modal 1: Responder Inspection Drawer / Profile Modal */}
      {selectedProfileResponder && (
        <div className="modal-backdrop">
          <div className="modal-content-card">
            <div className="modal-header">
              <h3>👤 Field Unit Dossier: {selectedProfileResponder.name}</h3>
              <button type="button" className="btn-close" onClick={() => setSelectedProfileResponder(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="profile-header-banner" style={{ borderBottom: 'none', paddingBottom: 0 }}>
                <div className="profile-avatar-large">{selectedProfileResponder.name.charAt(0)}</div>
                <div>
                  <h3 style={{ margin: 0 }}>{selectedProfileResponder.name}</h3>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '13px' }}>
                    {selectedProfileResponder.role} • {selectedProfileResponder.team}
                  </div>
                  <div style={{ marginTop: '6px' }}>
                    <span className={`availability-pill ${selectedProfileResponder.availability === 'Available' ? 'available' : 'busy'}`}>
                      {selectedProfileResponder.availability}
                    </span>
                  </div>
                </div>
              </div>

              <div className="archive-detail-row"><strong>Responder ID:</strong> {selectedProfileResponder.id}</div>
              <div className="archive-detail-row"><strong>Specialization:</strong> {selectedProfileResponder.specialization}</div>
              <div className="archive-detail-row"><strong>Experience:</strong> {selectedProfileResponder.experience}</div>
              <div className="archive-detail-row"><strong>Current Sector:</strong> 📍 {selectedProfileResponder.location}</div>
              <div className="archive-detail-row"><strong>Comms Gateway:</strong> {selectedProfileResponder.connection}</div>
              <div className="archive-detail-row"><strong>Emergencies Handled:</strong> {selectedProfileResponder.emergenciesHandled} (Resolved: {selectedProfileResponder.emergenciesResolved})</div>
              <div className="archive-detail-row"><strong>Avg Response Time:</strong> {selectedProfileResponder.avgResponseTime}</div>
              <div className="archive-detail-row">
                <strong>Current Mission:</strong> {selectedProfileResponder.currentEmergencyId ? `🚨 ${selectedProfileResponder.currentEmergencyId}` : 'Standby'}
              </div>

              <div className="modal-actions" style={{ marginTop: '16px' }}>
                <button
                  type="button"
                  className="btn btn-admin"
                  onClick={() => {
                    handleCenterOnResponder(selectedProfileResponder);
                    setSelectedProfileResponder(null);
                  }}
                >
                  Locate on Map
                </button>
                <button
                  type="button"
                  className="btn btn-responder-primary"
                  onClick={() => {
                    setDispatchModalResponder(selectedProfileResponder);
                    setSelectedProfileResponder(null);
                  }}
                >
                  Dispatch to Mission
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setSelectedProfileResponder(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 2: Contact / Direct Radio Comms */}
      {contactModalResponder && (
        <div className="modal-backdrop">
          <div className="modal-content-card">
            <div className="modal-header">
              <h3>📻 Tactical Radio Comms: {contactModalResponder.name}</h3>
              <button type="button" className="btn-close" onClick={() => setContactModalResponder(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div className="archive-detail-row"><strong>Unit:</strong> {contactModalResponder.name} ({contactModalResponder.id})</div>
              <div className="archive-detail-row"><strong>Role:</strong> {contactModalResponder.role} • {contactModalResponder.team}</div>
              <div className="archive-detail-row"><strong>Direct Phone:</strong> {contactModalResponder.phone}</div>
              <div className="archive-detail-row"><strong>Radio Frequency:</strong> Channel 4 (433.175 MHz LoRa Mesh)</div>
              <div className="archive-detail-row"><strong>Current Location:</strong> 📍 {contactModalResponder.location}</div>

              <div className="form-group" style={{ marginTop: '12px' }}>
                <label className="form-label">Broadcast Radio Alert / Mission Directive</label>
                <input
                  type="text"
                  className="form-input"
                  defaultValue="Proceed to designated coordinates immediately for triage."
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-responder-primary"
                  onClick={() => {
                    showToast(`Direct alert transmitted to ${contactModalResponder.name} via RF Channel 4`);
                    setContactModalResponder(null);
                  }}
                >
                  Transmit Radio Alert
                </button>
                <button
                  type="button"
                  className="btn btn-admin"
                  onClick={() => {
                    showToast(`Simulated secure voice call connected with ${contactModalResponder.name}`);
                    setContactModalResponder(null);
                  }}
                >
                  Initiate Secure Voice Call
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3: Dispatch / Assign Responder to Emergency */}
      {dispatchModalResponder && (
        <div className="modal-backdrop">
          <div className="modal-content-card">
            <div className="modal-header">
              <h3>⚡ Dispatch Unit: {dispatchModalResponder.name}</h3>
              <button type="button" className="btn-close" onClick={() => setDispatchModalResponder(null)}>✕</button>
            </div>
            <div className="modal-body">
              <p className="modal-desc">
                Select an active emergency from the queue to dispatch <strong>{dispatchModalResponder.name}</strong> ({dispatchModalResponder.role}):
              </p>

              <div className="sidebar-scrollable-list" style={{ maxHeight: '220px' }}>
                {emergencies.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#8b949e' }}>
                    No active emergencies available
                  </div>
                ) : (
                  emergencies.map(em => (
                  <div key={em.id} className="map-sidebar-item" style={{ marginBottom: '8px' }}>
                    <div className="item-row">
                      <span>{getEmergencyIcon(em.type)} <strong>{em.id}</strong> ({em.type})</span>
                      <span className={`priority-badge ${em.priority.startsWith('P1') ? 'priority-p1' : 'priority-p2'}`}>
                        {em.priority.split(' - ')[0]}
                      </span>
                    </div>
                    <div className="item-loc">📍 {em.location} • Status: {em.statusLabel}</div>
                    <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-responder-primary"
                        onClick={() => handleAssignResponder(em.id, dispatchModalResponder, true)}
                      >
                        [ Assign as Primary ]
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => handleAssignResponder(em.id, dispatchModalResponder, false)}
                      >
                        [ Assign as Supporting ]
                      </button>
                    </div>
                  </div>
                )))}
              </div>

              <div className="modal-actions" style={{ marginTop: '14px' }}>
                <button type="button" className="btn btn-secondary" onClick={() => setDispatchModalResponder(null)}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 3B: Assign Team / Responder Directly to Selected Emergency */}
      {assignModalEmergency && (
        <div className="modal-backdrop">
          <div className="modal-content-card">
            <div className="modal-header">
              <h3>⚡ Assign Response Unit: {assignModalEmergency.id}</h3>
              <button type="button" className="btn-close" onClick={() => setAssignModalEmergency(null)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ marginBottom: '12px', padding: '10px 14px', background: '#161616', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <strong style={{ fontSize: '15px' }}>{getEmergencyIcon(assignModalEmergency.type)} {assignModalEmergency.type}</strong>
                  <PriorityBadge priority={assignModalEmergency.priority} />
                </div>
                <div style={{ fontSize: '12px', color: '#8b949e' }}>
                  📍 {assignModalEmergency.location} • 👥 {assignModalEmergency.peopleAffected}
                </div>
              </div>

              <p className="modal-desc">
                Select an available responder or team unit to dispatch to this incident:
              </p>

              <div className="sidebar-scrollable-list" style={{ maxHeight: '240px' }}>
                {responders.length === 0 ? (
                  <div style={{ padding: '24px', textAlign: 'center', color: '#8b949e' }}>
                    No responders registered
                  </div>
                ) : (
                  responders.map(r => (
                  <div key={r.id} className="map-sidebar-item" style={{ marginBottom: '8px' }}>
                    <div className="item-row">
                      <span><strong>{r.name}</strong> ({r.role})</span>
                      <span className={`status-pill pill-${r.availability.toLowerCase()}`}>
                        {r.availability === 'Available' ? '🟢 Available' : r.availability === 'Busy' ? '🟠 Busy' : '⚫ Offline'}
                      </span>
                    </div>
                    <div className="item-loc">Team: {r.team} • Location: {r.location}</div>
                    <div style={{ marginTop: '8px', display: 'flex', gap: '8px' }}>
                      <button
                        type="button"
                        className="btn btn-sm btn-responder-primary"
                        onClick={() => {
                          handleAssignResponder(assignModalEmergency.id, r, true);
                          setAssignModalEmergency(null);
                        }}
                      >
                        [ Assign Primary ]
                      </button>
                      <button
                        type="button"
                        className="btn btn-sm btn-secondary"
                        onClick={() => {
                          handleAssignResponder(assignModalEmergency.id, r, false);
                          setAssignModalEmergency(null);
                        }}
                      >
                        [ Assign Supporting ]
                      </button>
                    </div>
                  </div>
                )))}
              </div>

              <div className="modal-actions" style={{ marginTop: '14px', display: 'flex', justifyContent: 'space-between' }}>
                <button
                  type="button"
                  className="btn btn-sm btn-admin"
                  onClick={() => {
                    const emId = assignModalEmergency.id;
                    setAssignModalEmergency(null);
                    handleViewEmergency(emId);
                  }}
                >
                  [ Open Full Incident Dossier ]
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setAssignModalEmergency(null)}>
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modal 4: Priority Escalation Request */}
      {showEscalationModal && (
        <div className="modal-backdrop">
          <div className="modal-content-card">
            <div className="modal-header">
              <h3>⚡ Request Incident Priority Escalation</h3>
              <button type="button" className="btn-close" onClick={() => setShowEscalationModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSubmitEscalationRequest} className="modal-body">
              <p className="modal-desc">
                Incident: <strong>{selectedEmergency.id}</strong> ({selectedEmergency.type})<br />
                Target Escalation: <strong style={{ color: 'var(--resqnet-red)' }}>P1 - Critical</strong>
              </p>
              <div className="form-group">
                <label className="form-label" htmlFor="esc-reason">Operational Reason / Threat Justification *</label>
                <textarea
                  id="esc-reason"
                  className="form-input form-textarea"
                  rows="4"
                  required
                  placeholder="e.g. Water level rising rapidly over 5ft, victims trapped on roof with power line hazard..."
                  value={escalationReason}
                  onChange={(e) => setEscalationReason(e.target.value)}
                />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-responder-primary">
                  Transmit Escalation Request
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowEscalationModal(false)}>
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 5: Edit Profile */}
      {showEditProfileModal && (
        <div className="modal-backdrop">
          <div className="modal-content-card">
            <div className="modal-header">
              <h3>Edit Profile Information</h3>
              <button type="button" className="btn-close" onClick={() => setShowEditProfileModal(false)}>✕</button>
            </div>
            <form onSubmit={handleSaveProfile} className="modal-body">
              {currentRole === 'admin' ? (
                <>
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={adminProfile.name}
                      onChange={(e) => setAdminProfile({ ...adminProfile, name: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Phone Number</label>
                    <input
                      type="text"
                      className="form-input"
                      value={adminProfile.phone}
                      onChange={(e) => setAdminProfile({ ...adminProfile, phone: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Department</label>
                    <input
                      type="text"
                      className="form-input"
                      value={adminProfile.department}
                      onChange={(e) => setAdminProfile({ ...adminProfile, department: e.target.value })}
                    />
                  </div>
                </>
              ) : (
                <>
                  <div className="form-group">
                    <label className="form-label">Full Name</label>
                    <input
                      type="text"
                      className="form-input"
                      value={responderProfile.name}
                      onChange={(e) => setResponderProfile({ ...responderProfile, name: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Phone Number</label>
                    <input
                      type="text"
                      className="form-input"
                      value={responderProfile.phone}
                      onChange={(e) => setResponderProfile({ ...responderProfile, phone: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Emergency Specialization</label>
                    <input
                      type="text"
                      className="form-input"
                      value={responderProfile.specialization}
                      onChange={(e) => setResponderProfile({ ...responderProfile, specialization: e.target.value })}
                    />
                  </div>
                </>
              )}
              <div className="modal-actions">
                <button type="submit" className="btn btn-admin">Save Changes</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowEditProfileModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 6: Change Password */}
      {showPasswordModal && (
        <div className="modal-backdrop">
          <div className="modal-content-card">
            <div className="modal-header">
              <h3>Change Account Security Password</h3>
              <button type="button" className="btn-close" onClick={() => setShowPasswordModal(false)}>✕</button>
            </div>
            <form onSubmit={handleChangePassword} className="modal-body">
              <div className="form-group">
                <label className="form-label">Current Password</label>
                <input
                  type="password"
                  className="form-input"
                  required
                  placeholder="••••••••"
                  value={passwordForm.current}
                  onChange={(e) => setPasswordForm({ ...passwordForm, current: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <input
                  type="password"
                  className="form-input"
                  required
                  placeholder="••••••••"
                  value={passwordForm.newPass}
                  onChange={(e) => setPasswordForm({ ...passwordForm, newPass: e.target.value })}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Confirm New Password</label>
                <input
                  type="password"
                  className="form-input"
                  required
                  placeholder="••••••••"
                  value={passwordForm.confirm}
                  onChange={(e) => setPasswordForm({ ...passwordForm, confirm: e.target.value })}
                />
              </div>
              <div className="modal-actions">
                <button type="submit" className="btn btn-admin">Update Password</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowPasswordModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 7: Onboard New Real Rescuer Unit */}
      {showAddResponderModal && (
        <div className="modal-backdrop">
          <div className="modal-content-card" style={{ maxWidth: '520px' }}>
            <div className="modal-header">
              <h3>➕ Onboard New Rescuer Unit</h3>
              <button type="button" className="btn-close" onClick={() => setShowAddResponderModal(false)}>✕</button>
            </div>
            <form onSubmit={handleAddResponderSubmit} className="modal-body">
              <p className="modal-desc" style={{ marginBottom: '16px' }}>
                Register an active field responder into MongoDB Atlas. They can immediately log in with their credentials.
              </p>

              <div className="form-group">
                <label className="form-label">Full Name</label>
                <input
                  type="text"
                  className="form-input"
                  required
                  placeholder="e.g. Rajesh Kumar"
                  value={newRespName}
                  onChange={(e) => setNewRespName(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Email Address</label>
                <input
                  type="email"
                  className="form-input"
                  required
                  placeholder="e.g. rajesh@gmail.com"
                  value={newRespEmail}
                  onChange={(e) => setNewRespEmail(e.target.value)}
                />
              </div>

              <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Phone Number</label>
                  <input
                    type="tel"
                    className="form-input"
                    required
                    placeholder="+91 98765 43210"
                    value={newRespPhone}
                    onChange={(e) => setNewRespPhone(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Blood Group</label>
                  <select
                    className="form-input"
                    value={newRespBlood}
                    onChange={(e) => setNewRespBlood(e.target.value)}
                  >
                    <option value="O+">O+</option>
                    <option value="O-">O-</option>
                    <option value="A+">A+</option>
                    <option value="A-">A-</option>
                    <option value="B+">B+</option>
                    <option value="B-">B-</option>
                    <option value="AB+">AB+</option>
                    <option value="AB-">AB-</option>
                  </select>
                </div>
              </div>

              <div className="form-row" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                <div className="form-group">
                  <label className="form-label">Specialization</label>
                  <select
                    className="form-input"
                    value={newRespSpecialization}
                    onChange={(e) => setNewRespSpecialization(e.target.value)}
                  >
                    <option value="Swift Water & Flood Rescue">Swift Water & Flood Rescue</option>
                    <option value="Paramedic & Emergency Triage">Paramedic & Emergency Triage</option>
                    <option value="Fire & Hazmat Specialist">Fire & Hazmat Specialist</option>
                    <option value="Structural Collapse & Search">Structural Collapse & Search</option>
                    <option value="Disaster Response Team">Disaster Response Team</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Assigned Squad / Team</label>
                  <input
                    type="text"
                    className="form-input"
                    placeholder="Rapid Rescue Alpha"
                    value={newRespTeam}
                    onChange={(e) => setNewRespTeam(e.target.value)}
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Login Password</label>
                <input
                  type="password"
                  className="form-input"
                  placeholder="Leave empty for default (responder123)"
                  value={newRespPassword}
                  onChange={(e) => setNewRespPassword(e.target.value)}
                />
              </div>

              <div className="modal-actions" style={{ marginTop: '16px' }}>
                <button type="submit" className="btn btn-admin">Register Rescuer Unit</button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowAddResponderModal(false)}>Cancel</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal 8: ESP32 LoRa Gateway Information & Setup */}
      {showLoraModal && (
        <div className="modal-backdrop">
          <div className="modal-content-card" style={{ maxWidth: '640px' }}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '20px' }}>📡</span>
                <h3>ESP32 LoRa Emergency Gateway Hub</h3>
              </div>
              <button type="button" className="btn-close" onClick={() => setShowLoraModal(false)}>✕</button>
            </div>
            <div className="modal-body">
              <div style={{ padding: '12px', background: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.3)', borderRadius: '6px', marginBottom: '16px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                  <span style={{ fontWeight: 700, color: '#38bdf8' }}>Gateway Service: ONLINE</span>
                  <span style={{ padding: '2px 8px', borderRadius: '4px', background: 'rgba(34, 197, 94, 0.2)', color: '#4ade80', fontSize: '11px', fontWeight: 700 }}>PORT 5000 LISTENING</span>
                </div>
                <div style={{ fontSize: '13px', color: '#cbd5e1' }}>
                  Your ESP32 can transmit rescue messages over Wi-Fi directly to this endpoint:
                </div>
                <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
                  <code style={{ flex: 1, padding: '8px 10px', background: '#090d16', border: '1px solid #1e293b', borderRadius: '4px', color: '#38bdf8', fontSize: '12px', wordBreak: 'break-all' }}>
                    http://172.16.10.217:5000/api/lora/message
                  </code>
                  <button
                    type="button"
                    className="btn btn-sm btn-secondary"
                    onClick={() => {
                      navigator.clipboard.writeText('http://172.16.10.217:5000/api/lora/message');
                      showToast('Copied URL to clipboard!');
                    }}
                  >
                    Copy
                  </button>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ color: '#f1f5f9', fontSize: '13px', marginBottom: '8px' }}>🔌 Connection Methods Supported:</h4>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px' }}>
                    <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: '12px', marginBottom: '4px' }}>1. Wi-Fi HTTP POST (Standard)</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>ESP32 receives LoRa packet and sends HTTP POST over Wi-Fi/Hotspot directly to the backend.</div>
                  </div>
                  <div style={{ padding: '10px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: '6px' }}>
                    <div style={{ fontWeight: 700, color: '#38bdf8', fontSize: '12px', marginBottom: '4px' }}>2. USB Cable Serial Bridge</div>
                    <div style={{ fontSize: '11px', color: '#94a3b8' }}>Plug ESP32 into PC via USB and run: <br/><code style={{ color: '#4ade80' }}>node server/lora_serial_bridge.js COM3</code></div>
                  </div>
                </div>
              </div>

              <div style={{ marginBottom: '16px' }}>
                <h4 style={{ color: '#f1f5f9', fontSize: '13px', marginBottom: '6px' }}>📁 Arduino Sketch Ready in Repository:</h4>
                <div style={{ fontSize: '12px', color: '#94a3b8' }}>
                  Open <strong><code>esp32/esp32_lora_receiver_gateway.ino</code></strong> in Arduino IDE to flash your ESP32.
                </div>
              </div>

              <div className="modal-actions" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <button
                  type="button"
                  className="btn btn-admin"
                  onClick={() => {
                    handleSimulateLoraPacket();
                    setShowLoraModal(false);
                  }}
                >
                  ⚡ Test / Simulate Incoming Packet
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => setShowLoraModal(false)}>Close</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
