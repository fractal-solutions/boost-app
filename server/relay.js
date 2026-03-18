const express = require('express');
const cors = require('cors');
const webpush = require('web-push');

const app = express();
app.use(cors());
app.use(express.json());

const subscriptions = new Map();

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

const port = process.env.PORT || 8787;
app.listen(port, () => {
  console.log(`Boost relay running on :${port}`);
});
