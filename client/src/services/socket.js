import { io } from 'socket.io-client';
import { API_BASE_URL } from './api';

let socketInstance = null;

export const initSocket = (user) => {
  if (socketInstance) {
    socketInstance.disconnect();
  }

  socketInstance = io(API_BASE_URL, {
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: 10,
    reconnectionDelay: 1000
  });

  socketInstance.on('connect', () => {
    console.log('[SOCKET] Connected to ResQNet server:', socketInstance.id);
    if (user) {
      socketInstance.emit('join', {
        role: user.role,
        userId: user.id || user._id,
        responderId: user.responder_id
      });
    }
  });

  socketInstance.on('disconnect', (reason) => {
    console.log('[SOCKET] Disconnected:', reason);
  });

  return socketInstance;
};

export const getSocket = () => socketInstance;

export const disconnectSocket = () => {
  if (socketInstance) {
    socketInstance.disconnect();
    socketInstance = null;
  }
};
