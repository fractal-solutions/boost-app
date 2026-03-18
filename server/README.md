Boost Buzz Relay (Optional)

This relay is only needed if you want optional push notifications for Buzz when a peer is offline.

Requirements
- Node.js 18+

Setup
1. Install deps in this folder:
   npm install

2. Generate VAPID keys:
   npx web-push generate-vapid-keys

3. Run the relay:
   set VAPID_PUBLIC_KEY=YOUR_PUBLIC_KEY
   set VAPID_PRIVATE_KEY=YOUR_PRIVATE_KEY
   set VAPID_SUBJECT=mailto:admin@example.com
   set PORT=8787
   npm start

App Settings
- In Boost -> Settings -> Push Notifications:
  - Enable Push for Buzz
  - Relay Server URL: http://your-server:8787
  - VAPID Public Key: (YOUR_PUBLIC_KEY)
  - Click Register Device on each client

Notes
- This relay stores subscriptions in memory; restart clears them.
- If you need persistence, plug in a database.
