const http = require('http');
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');
const dns = require('dns');

// Load environment variables from .env
dotenv.config();

// Configure scoped DNS resolvers for Node.js process to ensure reliable MongoDB Atlas SRV resolution
// Windows local DNS resolvers often reject SRV queries (querySrv ECONNREFUSED)
if (process.env.DISABLE_CUSTOM_DNS !== 'true') {
  try {
    const customDns = process.env.DNS_SERVERS
      ? process.env.DNS_SERVERS.split(',').map(s => s.trim())
      : ['8.8.8.8', '8.8.4.4', '1.1.1.1'];
    dns.setServers(customDns);
  } catch (e) {
    // Fall back to host system DNS if custom resolvers are restricted
  }
}

const app = express();
const server = http.createServer(app);

const PORT = process.env.PORT || 5000;
const CLIENT_URL = process.env.CLIENT_URL || 'http://localhost:3000';
const RESPONDER_URL = process.env.RESPONDER_URL || 'http://localhost:5173';

// ============================================================================
// Middleware Configuration
// ============================================================================

// Enable CORS for Victim app (3000) and Responder/Admin app (5173)
const allowedOrigins = [
  CLIENT_URL,
  RESPONDER_URL,
  'http://localhost:3000',
  'http://localhost:3001',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:3001',
  'http://127.0.0.1:5173',
  'http://127.0.0.1:5174'
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, curl, Capacitor)
    if (!origin) return callback(null, true);
    // In development, allow all origins for convenience
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    // In production, enforce the whitelist
    if (allowedOrigins.indexOf(origin) !== -1) {
      return callback(null, true);
    }
    console.warn(`[CORS] Blocked origin: ${origin}`);
    return callback(new Error(`CORS policy: Origin ${origin} is not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Gateway-Key']
}));

// Body parser for JSON payloads
app.use(express.json());

// ============================================================================
// Socket.IO Real-Time Service Integration
// ============================================================================

const { initSocket } = require('./services/socketService');
const io = initSocket(server, allowedOrigins);

// ============================================================================
// MongoDB Atlas Connection
// ============================================================================

let MONGODB_URI = process.env.MONGODB_URI;

// Ensure database name 'resqnet' is specified if omitted before query parameters
if (MONGODB_URI && MONGODB_URI.includes('mongodb.net/?')) {
  MONGODB_URI = MONGODB_URI.replace('mongodb.net/?', 'mongodb.net/resqnet?');
}

if (!MONGODB_URI || MONGODB_URI.trim() === '') {
  console.warn('⚠️ MONGODB_URI is not set in server/.env.');
  console.warn('👉 Please set your MongoDB Atlas connection string in server/.env to connect to the database.');
} else {
  mongoose.connect(MONGODB_URI)
    .then(() => {
      console.log('✅ Connected to MongoDB Atlas successfully');
      console.log(`📦 Database: ${mongoose.connection.name}`);
    })
    .catch((err) => {
      console.error('❌ MongoDB Atlas connection failed:', err.message);
    });
}

// Mongoose connection lifecycle listeners
mongoose.connection.on('connected', () => {
  console.log('🟢 Mongoose connected to MongoDB Atlas');
});

mongoose.connection.on('error', (err) => {
  console.error('🔴 Mongoose runtime connection error:', err.message);
});

mongoose.connection.on('disconnected', () => {
  console.warn('🟡 Mongoose disconnected from MongoDB Atlas');
});

// ============================================================================
// API Route Mounting
// ============================================================================

const authRoutes = require('./routes/authRoutes');
const emergencyRoutes = require('./routes/emergencyRoutes');
const adminRoutes = require('./routes/adminRoutes');
const responderRoutes = require('./routes/responderRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const loraRoutes = require('./routes/loraRoutes');

app.use('/api/auth', authRoutes);
app.use('/api/emergencies', emergencyRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/responder', responderRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/lora', loraRoutes);

// Health check endpoint
app.get('/api/health', async (req, res) => {
  const dbState = mongoose.connection.readyState;
  // readyState: 0=disconnected, 1=connected, 2=connecting, 3=disconnecting
  const dbStateMap = { 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' };
  const dbStatus = dbStateMap[dbState] || 'unknown';
  const isHealthy = dbState === 1;

  let dbLatencyMs = null;
  if (isHealthy) {
    try {
      const start = Date.now();
      await mongoose.connection.db.admin().ping();
      dbLatencyMs = Date.now() - start;
    } catch (pingErr) {
      // ping failed but connection state was 1 — flag as degraded
    }
  }

  const statusCode = isHealthy ? 200 : 503;
  return res.status(statusCode).json({
    status: isHealthy ? 'ok' : 'degraded',
    service: 'ResQNet API',
    version: '2.0.0',
    database: {
      status: dbStatus,
      latency_ms: dbLatencyMs
    },
    timestamp: new Date().toISOString(),
    uptime_s: Math.floor(process.uptime())
  });
});

app.get('/', (req, res) => {
  res.status(200).json({
    message: 'ResQNet Unified API Server is active',
    healthCheck: '/api/health'
  });
});

// ============================================================================
// Error Handling Middleware
// ============================================================================

// 404 handler for undefined API routes
app.use((req, res, next) => {
  res.status(404).json({
    success: false,
    error: 'Route not found',
    path: req.originalUrl
  });
});

// Global internal server error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err.stack || err.message);
  res.status(err.status || 500).json({
    success: false,
    error: err.message || 'Internal Server Error'
  });
});

// ============================================================================
// Start Server
// ============================================================================

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Retrying in 1s or run:`);
    console.error(`   Get-NetTCPConnection -LocalPort ${PORT} | Select-Object -ExpandProperty OwningProcess -Unique | Stop-Process -Force`);
    process.exit(1);
  } else {
    console.error('Server error:', err);
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 ResQNet Unified Backend Server running on port ${PORT}`);
  console.log(`🌐 Health check available at: http://localhost:${PORT}/api/health`);
  console.log(`🔗 Allowed CORS origins: ${allowedOrigins.join(', ')}`);
});
