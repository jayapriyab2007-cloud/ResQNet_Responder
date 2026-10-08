/**
 * ResQNet Offline Storage & Synchronization Service
 * Uses IndexedDB for reliable offline queueing and auto-sync when network reconnects.
 */

const DB_NAME = 'ResQNet_Offline_DB';
const DB_VERSION = 1;
const QUEUE_STORE = 'offline_queue';
const CACHE_STORE = 'offline_cache';

let dbInstance = null;

export const initOfflineDB = () => {
  return new Promise((resolve, reject) => {
    if (dbInstance) return resolve(dbInstance);
    if (!window.indexedDB) {
      console.warn('[OFFLINE] IndexedDB not supported by browser. Falling back to memory/localStorage.');
      return resolve(null);
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        db.createObjectStore(QUEUE_STORE, { keyPath: 'queue_id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE, { keyPath: 'cache_key' });
      }
    };

    request.onsuccess = (event) => {
      dbInstance = event.target.result;
      resolve(dbInstance);
    };

    request.onerror = (event) => {
      console.error('[OFFLINE] IndexedDB open error:', event.target.error);
      resolve(null);
    };
  });
};

export const queueOfflineAction = async (actionType, payload) => {
  const db = await initOfflineDB();
  const queueItem = {
    actionType,
    payload,
    timestamp: new Date().toISOString(),
    retry_count: 0
  };

  if (!db) {
    // Fallback to localStorage
    try {
      const localQueue = JSON.parse(localStorage.getItem('resqnet_offline_queue') || '[]');
      localQueue.push(queueItem);
      localStorage.setItem('resqnet_offline_queue', JSON.stringify(localQueue));
    } catch (e) {}
    return queueItem;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([QUEUE_STORE], 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      store.add(queueItem);
      tx.oncomplete = () => resolve(queueItem);
      tx.onerror = () => resolve(queueItem);
    } catch (err) {
      resolve(queueItem);
    }
  });
};

export const getQueuedActions = async () => {
  const db = await initOfflineDB();
  if (!db) {
    return JSON.parse(localStorage.getItem('resqnet_offline_queue') || '[]');
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([QUEUE_STORE], 'readonly');
      const store = tx.objectStore(QUEUE_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => resolve([]);
    } catch (e) {
      resolve([]);
    }
  });
};

export const clearQueueItem = async (queueId) => {
  const db = await initOfflineDB();
  if (!db) {
    let local = JSON.parse(localStorage.getItem('resqnet_offline_queue') || '[]');
    local = local.filter((item, idx) => idx !== queueId && item.queue_id !== queueId);
    localStorage.setItem('resqnet_offline_queue', JSON.stringify(local));
    return;
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction([QUEUE_STORE], 'readwrite');
      const store = tx.objectStore(QUEUE_STORE);
      store.delete(queueId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch (e) {
      resolve();
    }
  });
};

/**
 * Clean hardware interface placeholder for future Bluetooth / ESP32 + LoRa node connection.
 * Does NOT generate fake hardware ACKs.
 */
export const BluetoothLoRaBridge = {
  isConnected: false,
  status: 'HARDWARE_NOT_CONFIGURED', // Real state, no fake claims

  connectDevice: async () => {
    if (!navigator.bluetooth) {
      return {
        success: false,
        message: 'Web Bluetooth API not supported in this browser. USB / Serial or Gateway proxy required.'
      };
    }
    // Reserved for Web Bluetooth pairing with ESP32 LoRa transceiver
    return {
      success: false,
      message: 'No paired ResQNet LoRa hardware bridge detected. Awaiting hardware binding.'
    };
  },

  transmitPacket: async (packet) => {
    // Transparently returns pending because physical LoRa transceiver is not physically connected
    return {
      status: 'PENDING',
      delivered: false,
      message: 'Physical LoRa radio bridge unattached. Retaining in offline buffer for gateway relay.'
    };
  }
};
