

# BOOST — Peer-to-Peer Social Map & Chat App

Create a feature-rich, mobile-first peer-to-peer social app called **BOOST** that combines real-time chat, an interactive shared map with community blips, and a geochat feature — all powered by PeerJS for decentralized communication. The aesthetic should feel **urban, fast, electric** — like a neon-lit street map meets a hacker's messenger. Think dark mode by default, with vibrant accent colors (electric cyan `#00F0FF`, hot magenta `#FF2D78`, neon green `#39FF14`, warning amber `#FFB800`).

## App Type

**React Web App** — This requires complex state management (peer connections, geolocation streams, chat state, map interactions, settings panels), multiple views/tabs, and real-time data flow. React is ideal.

## Core Architecture

### PeerJS Integration
- Use PeerJS for all peer-to-peer communication (chat messages, blip sharing, geochat broadcasts)
- On first launch, generate a unique Peer ID (display it prominently so users can share it)
- Allow users to connect to peers by entering their Peer ID
- Maintain a live connections list with online/offline status indicators
- All data flows P2P — no central server stores messages or blips

### Settings Panel — PeerJS Server Configuration
- A dedicated settings/config section accessible from a gear icon
- Fields for: **Custom PeerJS Server Host**, **Port**, **Path**, and **API Key**
- Toggle between "Public PeerJS Cloud" (default) and "Custom Server"
- **TURN/STUN Server Configuration Section**:
  - Toggle to enable/disable TURN servers
  - Input fields for TURN server URL, username, and credential
  - Ability to add multiple ICE servers in a list format
  - Preset buttons for common free STUN servers (Google, Twilio)
- A "Test Connection" button that verifies the PeerJS server is reachable
- All settings saved to localStorage and applied on next connection

### Geolocation
- Request geolocation permission on launch
- Continuously track user position using `navigator.geolocation.watchPosition`
- Use position for map centering, geochat zone calculation, and blip placement

---

## UI Layout & Navigation

### Bottom Navigation Bar (Mobile-First)
A fixed bottom tab bar with 4 main sections, each with an icon and label:
1. **💬 Chat** — Direct P2P messaging
2. **🗺️ Map** — Interactive blip map
3. **📡 Geochat** — Location-based public feed
4. **⚙️ Settings** — PeerJS config, profile, preferences

The active tab should have a glowing underline effect in electric cyan. Tabs should have smooth transitions between views.

### Top Header Bar
- App name **"BOOST"** in a bold, custom-feeling font (use a chunky sans-serif), left-aligned
- A small lightning bolt ⚡ icon next to it, animated with a subtle pulse
- Right side: connection status indicator (green dot = connected, red = disconnected, amber = connecting), your Peer ID as a tappable/copyable chip, and a notification bell icon
- The header background should be slightly translucent dark (`rgba(10, 10, 20, 0.9)`) with a subtle blur backdrop

---

## View 1: 💬 Chat

### Peer Connection Panel
- At the top of the Chat view, a collapsible "Connect" panel
- Input field to enter a Peer ID with a "Connect" button (electric cyan)
- A "Share My ID" button that copies your Peer ID to clipboard with a toast notification
- QR code display of your Peer ID (generated client-side) so others can scan

### Conversations List
- Below the connection panel, show a list of active peer conversations
- Each conversation card shows: peer's display name (or Peer ID), last message preview, timestamp, unread count badge (magenta)
- Cards have a dark card background (`#1A1A2E`) with subtle border glow on hover
- Swipe-to-delete gesture or a long-press context menu

### Chat Window (when conversation is selected)
- Full-screen chat view with a back arrow to return to conversation list
- Message bubbles: sent messages on right (electric cyan background), received on left (dark gray `#2A2A3E`)
- Support for text messages, and shared blips (rendered as mini-map cards inline)
- Typing indicator animation (three bouncing dots)
- Message input bar at bottom: text input field, send button (⚡ icon), and an "attach blip" button (📍) that lets you pick a blip from your map to share
- Timestamps on messages, grouped by day
- Messages stored in localStorage per conversation

---

## View 2: 🗺️ Map

### Interactive Map Display
- Full-screen map using **Leaflet.js** with OpenStreetMap tiles
- Dark-themed map tiles (use CartoDB Dark Matter or similar dark tile layer)
- User's current position shown as a pulsing cyan dot with a subtle radar ring animation
- Smooth map panning and zooming with pinch/scroll support

### Blip System
Blips are map markers that users create and share. Each blip has:
- **Type** (with icon and color)
- **Title** (short text)
- **Description** (optional longer text)
- **Timestamp** (auto-generated)
- **Creator** (Peer ID / display name)
- **Expiry** (optional — blips can auto-expire after X hours)
- **GPS coordinates**

### Blip Categories (Creative & Useful)
Each category has a distinct icon and color:
| Category | Icon | Color | Description |
|---|---|---|---|
| ⚠️ Muggins | 🚨 | Red `#FF2D78` | Robbery/theft sighting |
| 👮 Cop Sighting | 🚔 | Blue `#4A90FF` | Police presence |
| 🌟 Cool Spot | ⭐ | Gold `#FFB800` | Hidden gems, cool hangouts |
| 🎉 Party/Event | 🎊 | Magenta `#FF2D78` | Live events happening now |
| 🍔 Food Spot | 🍕 | Orange `#FF6B35` | Great food nearby |
| ⚡ Free WiFi | 📶 | Cyan `#00F0FF` | Free WiFi locations |
| 🚧 Hazard | ⚠️ | Amber `#FFB800` | Road hazard, danger zone |
| 🅿️ Free Parking | 🅿️ | Green `#39FF14` | Available parking spots |
| 📸 Photo Spot | 📷 | Purple `#A855F7` | Scenic/Instagram-worthy |
| 🔥 Vibe Check | 🔥 | Neon green `#39FF14` | General "this area is lit" marker |
| 💀 Sketchy Area | 💀 | Dark red `#8B0000` | Area to be cautious in |
| 🆘 Need Help | 🆘 | Bright red `#FF0000` | Someone needs assistance |

### Add Blip Flow
- A floating action button (FAB) in the bottom-right corner of the map, large and glowing (neon green)
- Tapping opens a bottom sheet / modal with:
  - Category selector (scrollable row of icon buttons)
  - Title input field
  - Description textarea (optional)
  - "Drop at my location" toggle (default on) or tap-to-place on map
  - Expiry selector: "1 hour", "4 hours", "12 hours", "24 hours", "Never"
  - "Share with peers" toggle — when on, the blip is broadcast to all connected peers
  - **"BOOST IT"** button to confirm (big, satisfying, with a subtle haptic-style animation)

### Blip Display on Map
- Blips appear as small circular icons on the map with the category emoji
- Tapping a blip opens a popup card showing: category icon, title, description, creator name, time ago, and expiry countdown
- Blips near expiry should have a fading/pulsing animation
- Expired blips auto-remove from the map
- Cluster nearby blips when zoomed out (show count badge)

### Blip Sharing
- When "Share with peers" is enabled, blips are sent via PeerJS data channels to all connected peers
- Received blips from peers appear on the map with a slightly different border style (dashed outline) to distinguish them from your own
- Option to "boost" (upvote) a peer's blip, increasing its visibility/importance

---

## View 3: 📡 Geochat

### Concept
Geochat divides the world into invisible geographic zones (hexagonal grid or simple lat/lng grid cells). When you're in a zone, you see all public geochat messages posted in that zone. As you physically move into a new zone, the feed changes.

### Zone Display
- At the top, show current zone info: "Zone: Downtown East" or generated zone name based on coordinates (use a fun procedural name generator based on lat/lng hash, e.g., "Neon District 7B", "Shadow Block 42", "Pulse Sector 9")
- A small mini-map strip showing your position and the zone boundary highlighted
- Zone radius configurable in settings: 500m, 1km, 2km, 5km (default 1km)

### Geochat Feed
- A vertical scrolling feed of messages, newest at bottom (like a chat)
- Each message shows: anonymous display name (or custom name), message text, timestamp, distance from you ("200m away", "1.2km away")
- Messages have a translucent dark card style with left-colored border based on how close the poster is (green = very close, yellow = medium, red = far within zone)
- Users can post text messages with an optional mood emoji
- A "Shout" option that makes the message appear larger/bolder (limited to 1 per 5 minutes to prevent spam)
- Auto-scroll to newest messages with a "jump to latest" button if scrolled up

### Geochat Input
- Fixed bottom input bar similar to chat
- Text input, mood emoji picker (compact row), "Post" button, and "📢 Shout" button
- Toggle for anonymous mode vs. showing your display name
- Messages are broadcast to all connected peers who are in the same geographic zone
- Messages stored locally and expire after 24 hours

### Geochat Privacy
- Geochat is opt-in (toggle in settings, default off)
- When enabled, your approximate zone is shared (not exact coordinates)
- Clear indicator when geochat is active: a pulsing 📡 icon in the header

---

## View 4: ⚙️ Settings

### Profile Section
- Display name input (stored locally)
- Avatar: choose from a set of emoji avatars or colored initials
- Your Peer ID displayed prominently with a copy button
- QR code of your Peer ID

### PeerJS Server Configuration
- Toggle: "Use Default PeerJS Cloud" / "Custom Server"
- When custom: Host, Port, Path, Secure (HTTPS toggle), API Key fields
- All in a clean form layout with dark input fields and cyan focus borders

### ICE/TURN Server Configuration
- Section header: "Advanced: ICE Servers"
- Toggle to enable custom ICE configuration
- List of ICE servers with add/remove functionality
- Each entry: URL input, Username input (optional), Credential input (optional)
- "Add STUN Server" and "Add TURN Server" quick-add buttons
- Presets dropdown: "Google STUN", "Twilio STUN", etc.
- "Test ICE Connectivity" button

### Geochat Settings
- Enable/disable geochat toggle
- Zone radius slider (500m to 5km)
- Anonymous mode toggle
- Message expiry setting

### Map Settings
- Default map zoom level
- Show/hide blip categories (toggle each category)
- Blip notification radius setting
- Dark/light map tiles toggle

### Data Management
- "Export My Blips" (JSON download)
- "Import Blips" (JSON upload)
- "Clear All Data" with confirmation dialog
- Storage usage indicator

### About
- App version, credits
- Link to remix on Berrry

---

## Styling & Design System

### Color Palette
- **Background**: Deep dark navy `#0A0A14`
- **Card/Surface**: `#1A1A2E`, `#16213E`
- **Primary accent**: Electric cyan `#00F0FF`
- **Secondary accent**: Hot magenta `#FF2D78`
- **Success/Active**: Neon green `#39FF14`
- **Warning**: Amber `#FFB800`
- **Text primary**: `#E8E8E8`
- **Text secondary**: `#8888AA`
- **Borders**: `#2A2A4A`

### Typography
- Use system fonts with fallback: `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- App title "BOOST" in bold uppercase with letter-spacing
- Body text: 14-16px, clean and readable
- Use font-weight variations for hierarchy

### Effects & Animations
- Subtle glow effects on interactive elements (box-shadow with accent colors)
- Smooth transitions on all state changes (200-300ms ease)
- Pulsing animations for live indicators (connection status, geochat active)
- Slide-up animations for bottom sheets and modals
- Haptic-style micro-animations on button presses (slight scale bounce)

### Responsive Design
- Mobile-first (375px base), scales up to tablet and desktop
- On desktop (>768px): side-by-side layout with chat list + chat window, or map + blip panel
- Touch-friendly tap targets (minimum 44px)
- Safe area padding for notched phones

---

## Data Flow & Storage

### localStorage Schema
- `boost_profile`: { displayName, peerId, avatar, createdAt }
- `boost_peers`: [{ peerId, displayName, lastSeen }]
- `boost_messages`: { [peerId]: [{ id, text, sender, timestamp, blipAttachment? }] }
- `boost_blips`: [{ id, type, title, desc, lat, lng, creator, timestamp, expiry, boosts }]
- `boost_geochat`: [{ id, text, sender, zone, timestamp, mood, isShout }]
- `boost_settings`: { peerServer, iceServers, geochatEnabled, zoneRadius, ... }

### P2P Message Protocol
Messages sent between peers should be JSON objects with a `type` field:
- `{ type: 'chat', message, timestamp, sender }`
- `{ type: 'blip', blip: {...} }`
- `{ type: 'geochat', message, zone, timestamp }`
- `{ type: 'blip_boost', blipId }`
- `{ type: 'ping' }` / `{ type: 'pong' }` for keepalive

---

## Footer
Include a subtle footer link: `<a href="/remix">Remix on Berrry</a>` styled to match the dark theme with cyan text.