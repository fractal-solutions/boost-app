# Boost

Boost is a peer-to-peer social map and chat app that runs entirely in the browser using React (CDN) + PeerJS. It focuses on lightweight, real-time sharing of location blips, geochat, and direct peer messaging.

## Current Features

### Core
- P2P identity via PeerJS (no account server)
- Device-stable storage keys for peers, blips, messages, settings (data survives profile resets)
- Offline outbox for reliable delivery with ACKs
- Presence checks via ping/pong heartbeats

### Map + Blips
- Drop, edit, comment on, and boost blips
- Blip categories with custom types
- Blip expiry options
- Blip share to connected peers
- Remote blip delete propagation
- Peer location sharing (mutual opt-in)
- Route planning to peers, visible blips, or a map point
- Street routing via OSRM (shortest + alternative)
- Start/Stop live routing updates from current location

### Chat
- Direct peer chat with delivery confirmation
- Buzz/nudge to a peer
- Remove peer, Remove and delete history
- Block peer (no auto-reconnect, no buzz, no chat)

### Geochat
- Zone-based public chat
- Local filtering by zone or distance
- Mood chips

### PWA
- Web App Manifest + service worker
- Installable on supported browsers
- Offline cache for core assets

## Optional Push Buzz (Relay Server)

Push notifications for Buzz are optional and require a small relay server.

How it works:
- If a peer has registered for push (and the relay has their subscription), the relay can send a push when they are offline.
- If they are not subscribed, offline Buzz will not deliver.
- Push delivery depends on browser/OS support and user permission.

### Relay Setup

Location: `server/`

1. Install dependencies:
   - `npm install`

2. Generate VAPID keys:
   - `npx web-push generate-vapid-keys`

3. Configure environment variables:
   - `VAPID_PUBLIC_KEY` (required)
   - `VAPID_PRIVATE_KEY` (required)
   - `VAPID_SUBJECT` (optional, default `mailto:admin@example.com`)
   - `PORT` (optional, default `8787`)

4. Start the relay:
   - `npm start`

### What Are VAPID Keys?

VAPID keys are a public/private key pair used for Web Push authentication.

- The **public key** goes in the client app settings so the browser can verify who is sending push.
- The **private key** stays on the server and signs push requests.

How to get them:
- Run `npx web-push generate-vapid-keys` in `server/`.
- Copy the public key into Boost settings.
- Store the private key only in server environment variables.

### Relay API

- `POST /subscribe`
  - body: `{ peerId, subscription }`
- `POST /unsubscribe`
  - body: `{ peerId }`
- `POST /buzz`
  - body: `{ to, from, senderName }`
- `GET /health`
  - returns `{ ok: true }`

Notes:
- Subscriptions are stored in memory (restart clears them).
- For production, add a database and authentication.

### App Configuration

In Boost settings:
- Enable Push for Buzz
- Relay Server URL: `http://your-server:8787`
- VAPID Public Key: (your generated public key)
- Click `Register Device` on each client

## Tech Stack
- React 18 (CDN)
- PeerJS 1.5.4
- Leaflet 1.9.4
- QR Scanner (CDN)
- OSRM public routing API

## Key Files
- `app.js`: main application logic and UI
- `styles.css`: themes and UI styles
- `index.html`: CDN dependencies + app mount
- `manifest.webmanifest`: PWA metadata
- `sw.js`: service worker for caching and push handling
- `server/relay.js`: optional push relay

## Local Run
Open `index.html` in a browser. Peer connections require HTTPS or localhost for full WebRTC support.
