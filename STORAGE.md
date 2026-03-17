# Storage Design - BOOST P2P Social Map & Chat App

## Data Requirements

- **Local Storage**: Profile, peer connections, messages, blips, geochat messages, settings
- **No Backend Required**: All communication is P2P via PeerJS, no server-side storage needed

## Storage Strategy

### Offline-First (localStorage only)
- All data stored locally in the browser
- P2P sync handles real-time data exchange
- No backend API integration needed

### Data Structures

```json
// boost_profile
{
  "displayName": "Anonymous",
  "peerId": "boost-abc123",
  "avatar": "⚡",
  "createdAt": "2026-03-17T06:00:00Z"
}

// boost_peers
[
  { "peerId": "boost-xyz789", "displayName": "User2", "lastSeen": "2026-03-17T06:05:00Z" }
]

// boost_messages - keyed by peerId
{
  "boost-xyz789": [
    { "id": "msg1", "text": "Hey!", "sender": "boost-abc123", "timestamp": 1710648000000, "blipAttachment": null }
  ]
}

// boost_blips
[
  { "id": "blip1", "type": "cool_spot", "title": "Great cafe", "desc": "", "lat": -1.286, "lng": 36.817, "creator": "boost-abc123", "creatorName": "Me", "timestamp": 1710648000000, "expiry": "24h", "expiresAt": 1710734400000, "boosts": 0, "isRemote": false }
]

// boost_geochat
[
  { "id": "gc1", "text": "Anyone here?", "sender": "Anon", "zone": "Neon-7B", "timestamp": 1710648000000, "mood": "👋", "isShout": false, "lat": -1.286, "lng": 36.817 }
]

// boost_settings
{
  "peerServer": { "useDefault": true, "host": "", "port": 9000, "path": "/", "key": "", "secure": true },
  "iceServers": { "enabled": false, "servers": [] },
  "geochat": { "enabled": false, "zoneRadius": 1000, "anonymous": true, "messageExpiry": 24 },
  "map": { "defaultZoom": 14, "hiddenCategories": [], "darkTiles": true }
}
```

## Implementation Notes

- Generate unique Peer IDs on first launch with `boost-` prefix + random string
- Clean up expired blips and geochat messages on app load
- Messages persist across sessions in localStorage
- Settings applied on PeerJS connection initialization