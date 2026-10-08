<<<<<<< HEAD
# ResQNet Responder App

Emergency Response & Rescue Coordination Command Center.

## Overview

ResQNet Responder is an incident management and tactical coordination platform engineered for emergency responders and field command staff. This repository contains the foundational client and server setup (Step 1).

## Architecture (Step 1)

```
R_Responder/
│
├── client/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── main.jsx
│   │   └── style.css
│   │
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
│
├── server/
│   ├── server.js
│   └── package.json
│
├── .gitignore
└── README.md
```

- **Frontend (`client/`)**: React + Vite application styled with ResQNet tactical dark theme.
- **Backend (`server/`)**: Node.js + Express API providing service health diagnostics.

## Prerequisites

- [Node.js](https://nodejs.org/) (v18.0.0 or higher recommended)
- `npm` (bundled with Node.js)

## Quick Start

### 1. Backend Server

```bash
cd server
npm install
npm run dev
```

The API server will launch at `http://localhost:5000`.

- Health Check Endpoint: `GET http://localhost:5000/api/health`

### 2. Frontend Client

```bash
cd client
npm install
npm run dev
```

The Vite dev server will launch at `http://localhost:5173`.

## Production Build

To build the client application for production:

```bash
cd client
npm run build
```

## Upcoming Phases

- Database Layer: MongoDB Atlas
- Real-Time Coordination: Socket.IO
- Mapping & Geolocation: Leaflet & OpenStreetMap
- Mobile Packaging: Capacitor for Android
=======
# ResQNet_Responder
>>>>>>> 7ae2e6e89a7b1d8bb46a21cd78a6d1ca9c3e9067
