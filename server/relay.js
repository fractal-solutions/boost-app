const express = require('express');
const cors = require('cors');
const webpush = require('web-push');

const app = express();
app.use(cors());
app.use(express.json());

const subscriptions = new Map();
const geofeedPosts = [];
const rateLimits = new Map();

function rateLimit(key, limit, windowMs) {
  const now = Date.now();
  const entry = rateLimits.get(key) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  rateLimits.set(key, entry);
  return entry.count <= limit;
}

function pruneGeofeed() {
  const now = Date.now();
  for (let i = geofeedPosts.length - 1; i >= 0; i--) {
    const p = geofeedPosts[i];
    if (!p) { geofeedPosts.splice(i, 1); continue; }
    if (p.expiresAt && p.expiresAt <= now) geofeedPosts.splice(i, 1);
  }
  if (geofeedPosts.length > 1000) {
    geofeedPosts.splice(1000);
  }
}

const VAPID_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@example.com';

if (VAPID_PUBLIC_KEY && VAPID_PRIVATE_KEY) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY);
}

app.get('/health', (_, res) => res.json({ ok: true }));

app.post('/subscribe', (req, res) => {
  const { peerId, subscription } = req.body || {};
  if (!peerId || !subscription) {
    return res.status(400).json({ error: 'peerId and subscription required' });
  }
  subscriptions.set(peerId, subscription);
  return res.json({ ok: true });
});

app.post('/unsubscribe', (req, res) => {
  const { peerId } = req.body || {};
  if (!peerId) return res.status(400).json({ error: 'peerId required' });
  subscriptions.delete(peerId);
  return res.json({ ok: true });
});

app.post('/buzz', async (req, res) => {
  const { to, from, senderName } = req.body || {};
  if (!to) return res.status(400).json({ error: 'to required' });
  const subscription = subscriptions.get(to);
  if (!subscription) return res.status(404).json({ error: 'not_subscribed' });

  const payload = JSON.stringify({
    title: 'Boost Buzz',
    body: `${senderName || from || 'A peer'} buzzed you`,
    data: { url: './', from },
  });

  try {
    await webpush.sendNotification(subscription, payload);
    return res.json({ ok: true });
  } catch (err) {
    return res.status(500).json({ error: 'send_failed', detail: err.message });
  }
});

app.post('/geofeed/post', (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  if (!rateLimit('post:' + ip, 60, 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  const { post } = req.body || {};
  if (!post || !post.id || !post.zoneKey) {
    return res.status(400).json({ error: 'post with id and zoneKey required' });
  }
  geofeedPosts.unshift({ ...post, feed: 'geofeed' });
  pruneGeofeed();
  return res.json({ ok: true });
});

app.get('/geofeed/pull', (req, res) => {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  if (!rateLimit('pull:' + ip, 120, 60 * 1000)) {
    return res.status(429).json({ error: 'rate_limited' });
  }
  const { zoneKey } = req.query || {};
  if (!zoneKey) return res.status(400).json({ error: 'zoneKey required' });
  pruneGeofeed();
  const limit = Math.min(parseInt(req.query.limit || '50', 10) || 50, 200);
  const before = parseInt(req.query.before || '0', 10);
  let posts = geofeedPosts.filter(p => p.zoneKey === zoneKey);
  if (before) {
    posts = posts.filter(p => (p.timestamp || 0) < before);
  }
  posts = posts.slice(0, limit);
  const nextBefore = posts.length ? (posts[posts.length - 1].timestamp || 0) : null;
  return res.json({ ok: true, posts, nextBefore });
});

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`Boost relay running on :${port}`);
});
