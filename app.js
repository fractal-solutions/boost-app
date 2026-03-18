const { useState, useEffect, useRef, useCallback, useMemo } = React;
const e = React.createElement;

// ========================== UTILS ==========================

const OUTBOX_RETRY_MS = 5000;
const PING_INTERVAL_MS = 7000;
const PONG_TIMEOUT_MS = 18000;

function generateId(prefix = '') {
  return prefix + Math.random().toString(36).substr(2, 9) + Date.now().toString(36);
}

function generatePeerId() {
  return 'boost-' + Math.random().toString(36).substr(2, 6);
}

function timeAgo(ts) {
  const diff = Date.now() - ts;
  if (diff < 60000) return 'now';
  if (diff < 3600000) return Math.floor(diff / 60000) + 'm ago';
  if (diff < 86400000) return Math.floor(diff / 3600000) + 'h ago';
  return Math.floor(diff / 86400000) + 'd ago';
}

function distanceStr(d) {
  if (d < 1000) return Math.round(d) + 'm away';
  return (d / 1000).toFixed(1) + 'km away';
}

function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getZoneName(lat, lng, radius) {
  const gridLat = Math.floor(lat * (111000 / radius));
  const gridLng = Math.floor(lng * (111000 / radius));
  const hash = Math.abs(gridLat * 31 + gridLng * 17);
  const prefixes = ['Neon', 'Shadow', 'Pulse', 'Echo', 'Drift', 'Surge', 'Flux', 'Volt', 'Hex', 'Arc', 'Nova', 'Cipher'];
  const suffixes = ['District', 'Block', 'Sector', 'Zone', 'Grid', 'Hub', 'Node', 'Ring'];
  return prefixes[hash % prefixes.length] + ' ' + suffixes[(hash >> 4) % suffixes.length] + ' ' + ((hash % 99) + 1);
}

function getZoneKey(lat, lng, radius) {
  const gridLat = Math.floor(lat * (111000 / radius));
  const gridLng = Math.floor(lng * (111000 / radius));
  return gridLat + ',' + gridLng;
}

function slugify(value) {
  return (value || '')
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}


function colorFromId(id) {
  let hash = 0;
  const str = String(id || '');
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const hue = Math.abs(hash) % 360;
  return 'hsl(' + hue + ', 70%, 55%)';
}
function loadStorage(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function saveStorage(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}
function loadStorageMaybe(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : undefined; } catch { return undefined; }
}

function getDeviceId() {
  const existing = loadStorageMaybe('boost_device_id');
  if (existing) return existing;
  const id = generateId('dev_');
  saveStorage('boost_device_id', id);
  return id;
}

function storageKey(base, deviceId) {
  return 'boost_' + deviceId + '_' + base;
}

function loadStorageWithMigration(deviceId, base, def) {
  const nextKey = storageKey(base, deviceId);
  const legacyKey = 'boost_' + base;
  const current = loadStorageMaybe(nextKey);
  if (current !== undefined) return current;
  const legacy = loadStorageMaybe(legacyKey);
  if (legacy !== undefined) {
    saveStorage(nextKey, legacy);
    return legacy;
  }
  return def;
}

const IDB_NAME = 'boost_db';
const IDB_STORE = 'handles';
const FALLBACK_BACKUP_KEY = 'boost_backup_fallback';

function idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) {
        req.result.createObjectStore(IDB_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readonly');
    const store = tx.objectStore(IDB_STORE);
    const req = store.get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, val) {
  const db = await idbOpen();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    const store = tx.objectStore(IDB_STORE);
    const req = store.put(val, key);
    req.onsuccess = () => resolve(true);
    req.onerror = () => reject(req.error);
  });
}

function sanitizeFilename(name) {
  return (name || 'user').toString().trim().replace(/[^a-z0-9-_]+/gi, '_');
}

async function getBackupDirHandle() {
  try {
    return await idbGet('backupDir');
  } catch {
    return null;
  }
}

async function writeBackupToFolder(payload, name, interactive = false) {
  if (!window.showDirectoryPicker) return false;
  const root = await getBackupDirHandle();
  if (!root) return false;
  try {
    const perm = await root.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') {
      if (!interactive) return false;
      const req = await root.requestPermission({ mode: 'readwrite' });
      if (req !== 'granted') return false;
    }
    const subdir = await root.getDirectoryHandle('boost', { create: true });
    const safeName = sanitizeFilename(name);
    const fileHandle = await subdir.getFileHandle(`boost-backup(${safeName}).json`, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(JSON.stringify(payload, null, 2));
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

function writeBackupFallback(payload) {
  try {
    localStorage.setItem(FALLBACK_BACKUP_KEY, JSON.stringify(payload));
    return true;
  } catch {
    return false;
  }
}

function readBackupFallback() {
  try {
    const raw = localStorage.getItem(FALLBACK_BACKUP_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function msUntilNext3am() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(3, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

// Simple QR Code generator (alphanumeric)
function generateQRCodeSVG(text, size = 200) {
  // Use a simple QR-like visual encoding via a canvas-based approach
  // We'll generate a data matrix pattern
  const modules = 25;
  const cellSize = size / modules;
  // Create a deterministic pattern from the text
  let bits = [];
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    for (let b = 7; b >= 0; b--) {
      bits.push((charCode >> b) & 1);
    }
  }
  // Pad bits
  while (bits.length < modules * modules) {
    bits.push(0);
  }

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${modules} ${modules}">`;
  svg += `<rect width="${modules}" height="${modules}" fill="#ffffff"/>`;

  // Add finder patterns (3 corners)
  function addFinderPattern(x, y) {
    // Outer
    for (let i = 0; i < 7; i++) {
      svg += `<rect x="${x + i}" y="${y}" width="1" height="1" fill="#000"/>`;
      svg += `<rect x="${x + i}" y="${y + 6}" width="1" height="1" fill="#000"/>`;
      svg += `<rect x="${x}" y="${y + i}" width="1" height="1" fill="#000"/>`;
      svg += `<rect x="${x + 6}" y="${y + i}" width="1" height="1" fill="#000"/>`;
    }
    // Inner
    for (let i = 2; i < 5; i++) {
      for (let j = 2; j < 5; j++) {
        svg += `<rect x="${x + i}" y="${y + j}" width="1" height="1" fill="#000"/>`;
      }
    }
  }

  addFinderPattern(0, 0);
  addFinderPattern(modules - 7, 0);
  addFinderPattern(0, modules - 7);

  // Data modules
  let bitIdx = 0;
  for (let y = 0; y < modules; y++) {
    for (let x = 0; x < modules; x++) {
      // Skip finder pattern areas
      if ((x < 8 && y < 8) || (x >= modules - 8 && y < 8) || (x < 8 && y >= modules - 8)) continue;
      if (bitIdx < bits.length && bits[bitIdx]) {
        svg += `<rect x="${x}" y="${y}" width="1" height="1" fill="#000"/>`;
      }
      bitIdx++;
    }
  }

  svg += '</svg>';
  return svg;
}

const BLIP_CATEGORIES = [
  { id: 'muggins', icon: '🚨', label: 'Muggins', color: '#ff6aa2' },
  { id: 'cop', icon: '🚔', label: 'Cop Sighting', color: '#4A90FF' },
  { id: 'cool_spot', icon: '⭐', label: 'Cool Spot', color: '#ffbe55' },
  { id: 'party', icon: '🎊', label: 'Party/Event', color: '#ff6aa2' },
  { id: 'food', icon: '🍕', label: 'Food Spot', color: '#FF6B35' },
  { id: 'wifi', icon: '📶', label: 'Free WiFi', color: '#4bd4ff' },
  { id: 'hazard', icon: '⚠️', label: 'Hazard', color: '#ffbe55' },
  { id: 'parking', icon: '🅿️', label: 'Free Parking', color: '#46e38a' },
  { id: 'photo', icon: '📷', label: 'Photo Spot', color: '#A855F7' },
  { id: 'vibe', icon: '🔥', label: 'Vibe Check', color: '#46e38a' },
  { id: 'sketchy', icon: '💀', label: 'Sketchy Area', color: '#8B0000' },
  { id: 'help', icon: '🆘', label: 'Need Help', color: '#FF0000' },
];

function getAllCategories(custom = []) {
  return [...BLIP_CATEGORIES, ...(custom || [])];
}

function getCat(id, categories = BLIP_CATEGORIES) {
  const list = categories && categories.length ? categories : BLIP_CATEGORIES;
  return list.find(c => c.id === id) || list[0];
}

function getCategoryIcon(cat) {
  if (!cat) return '❓';
  if (cat.icon) return cat.icon;
  const label = (cat.label || '').trim();
  return label ? label[0].toUpperCase() : '❓';
}

function withAlpha(color, hex) {
  if (!color) return color;
  if (color.startsWith('var(')) {
    const pct = Math.round((parseInt(hex, 16) / 255) * 100);
    return `color-mix(in srgb, ${color} ${pct}%, transparent)`;
  }
  if (color.startsWith('#')) return color + hex;
  return color;
}

const EXPIRY_OPTIONS = [
  { label: '1 hour', value: 3600000 },
  { label: '4 hours', value: 14400000 },
  { label: '12 hours', value: 43200000 },
  { label: '24 hours', value: 86400000 },
  { label: 'Never', value: 0 },
];

const DEFAULT_SETTINGS = {
  peerServer: { useDefault: true, host: '', port: 9000, path: '/', key: '', secure: true },
  iceServers: { enabled: false, servers: [] },
  geochat: { enabled: false, zoneRadius: 1000, anonymous: true, messageExpiry: 24 },
  map: { defaultZoom: 14, hiddenCategories: [], darkTiles: true },
  ui: { theme: 'obsidian' },
  push: { enabled: false, serverUrl: '', vapidPublicKey: '' },
  backup: { enabled: false, name: '' },
  customBlipTypes: [],
};

// ========================== TOAST ==========================
let toastTimeout = null;
function showToast(msg, color = 'var(--accent)') {
  const existing = document.querySelector('.toast-notification');
  if (existing) existing.remove();
  const t = document.createElement('div');
  t.className = 'toast-notification';
  t.style.background = color;
  t.style.color = color === 'var(--amber)' || color === 'var(--neon-green)' ? 'var(--bg-deep)' : '#fff';
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => t.remove(), 3000);
}

// ========================== QR CODE COMPONENT ==========================

function QRCodeDisplay({ text, size = 180 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current || !text) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const modules = 21;
    const cellSize = Math.floor(size / (modules + 8)); // padding
    const totalSize = cellSize * (modules + 8);
    canvas.width = totalSize;
    canvas.height = totalSize;

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, totalSize, totalSize);

    const offset = cellSize * 4;

    // Encode text to bit array
    let bits = [];
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      for (let b = 7; b >= 0; b--) {
        bits.push((c >> b) & 1);
      }
    }
    // Add length prefix (2 bytes)
    const lenBits = [];
    const len = text.length;
    for (let b = 15; b >= 0; b--) {
      lenBits.push((len >> b) & 1);
    }
    bits = [...lenBits, ...bits];

    // Pad to fill grid
    while (bits.length < modules * modules) {
      bits.push(bits.length % 3 === 0 ? 1 : 0);
    }

    // Create grid
    const grid = Array.from({ length: modules }, () => Array(modules).fill(false));

    // Finder patterns
    function setFinderPattern(ox, oy) {
      for (let y = 0; y < 7; y++) {
        for (let x = 0; x < 7; x++) {
          if (y === 0 || y === 6 || x === 0 || x === 6 || (x >= 2 && x <= 4 && y >= 2 && y <= 4)) {
            grid[oy + y][ox + x] = true;
          }
        }
      }
    }
    setFinderPattern(0, 0);
    setFinderPattern(modules - 7, 0);
    setFinderPattern(0, modules - 7);

    // Timing patterns
    for (let i = 8; i < modules - 8; i++) {
      grid[6][i] = i % 2 === 0;
      grid[i][6] = i % 2 === 0;
    }

    // Data
    let bitIdx = 0;
    for (let y = 0; y < modules; y++) {
      for (let x = 0; x < modules; x++) {
        if ((x < 8 && y < 8) || (x >= modules - 8 && y < 8) || (x < 8 && y >= modules - 8)) continue;
        if (x === 6 || y === 6) continue;
        if (bitIdx < bits.length) {
          grid[y][x] = bits[bitIdx] === 1;
          bitIdx++;
        }
      }
    }

    // Draw
    ctx.fillStyle = '#000000';
    for (let y = 0; y < modules; y++) {
      for (let x = 0; x < modules; x++) {
        if (grid[y][x]) {
          ctx.fillRect(offset + x * cellSize, offset + y * cellSize, cellSize, cellSize);
        }
      }
    }

    // Border styling
    ctx.strokeStyle = 'var(--accent)';
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, totalSize - 2, totalSize - 2);
  }, [text, size]);

  return e('canvas', { ref: canvasRef, style: { borderRadius: 8, imageRendering: 'pixelated' } });
}

// ========================== QR SCANNER COMPONENT ==========================

function QRScannerModal({ onScan, onClose }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const scannerRef = useRef(null);
  const [scanning, setScanning] = useState(true);
  const [manualInput, setManualInput] = useState('');

  useEffect(() => {
    startCamera();
    return () => stopCamera();
  }, []);

  async function startCamera() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 640 }, height: { ideal: 480 } }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
      }
      // Init QR scanner if available
      if (window.QrScanner && videoRef.current) {
        const scanner = new window.QrScanner(
          videoRef.current,
          (result) => {
            const id = (result && result.data) ? result.data : (typeof result === 'string' ? result : '');
            if (id) {
              stopCamera();
              onScan(id);
            }
          },
          { returnDetailedScanResult: true, maxScansPerSecond: 4 }
        );
        scannerRef.current = scanner;
        scanner.start().catch(() => {});
      } else {
        setScanning(false);
      }
    } catch (err) {
      console.warn('Camera access denied:', err);
      setScanning(false);
    }
  }

  function stopCamera() {
    if (scannerRef.current) {
      try { scannerRef.current.stop(); } catch {}
      try { scannerRef.current.destroy(); } catch {}
      scannerRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
  }

  function handleManualSubmit() {
    const id = manualInput.trim();
    if (id) {
      stopCamera();
      onScan(id);
    }
  }

  return e('div', {
    style: {
      position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.95)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 20,
    }
  },
    e('div', { style: { width: '100%', maxWidth: 400 } },
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
        e('span', { style: { fontSize: 18, fontWeight: 700, color: 'var(--accent)' } }, '📷 Scan Peer QR'),
        e('button', {
          onClick: () => { stopCamera(); onClose(); },
          style: { background: 'none', border: 'none', color: 'var(--magenta)', fontSize: 24, cursor: 'pointer' }
        }, '✕'),
      ),

      scanning && e('div', {
        style: {
          width: '100%', aspectRatio: '4/3', background: 'var(--bg-card)', borderRadius: 12,
          overflow: 'hidden', position: 'relative', marginBottom: 16, border: '2px solid var(--accent)',
        }
      },
        e('video', {
          ref: videoRef, autoPlay: true, playsInline: true, muted: true,
          style: { width: '100%', height: '100%', objectFit: 'cover' }
        }),
        // Scanning overlay
        e('div', {
          style: {
            position: 'absolute', inset: '20%', border: '2px solid var(--accent)', borderRadius: 12,
            boxShadow: '0 0 0 9999px rgba(0,0,0,0.5), 0 0 20px rgba(0,240,255,0.3)',
          }
        }),
        e('div', { style: { position: 'absolute', bottom: 10, left: 0, right: 0, textAlign: 'center', fontSize: 12, color: 'var(--text-secondary)' } },
          'QR scanning requires a QR library - use manual entry below'
        ),
      ),

      e('div', { style: { marginTop: 8 } },
        e('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, textAlign: 'center' } }, 'Or enter Peer ID manually:'),
        e('div', { style: { display: 'flex', gap: 8 } },
          e('input', {
            value: manualInput,
            onChange: (ev) => setManualInput(ev.target.value),
            onKeyDown: (ev) => ev.key === 'Enter' && handleManualSubmit(),
            placeholder: 'boost-xxxxxx',
            style: {
              flex: 1, background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8,
              padding: '12px', color: 'var(--text-primary)', fontSize: 14, fontFamily: "'JetBrains Mono', monospace",
            }
          }),
          e('button', {
            onClick: handleManualSubmit,
            className: 'boost-btn',
            style: { background: 'var(--accent)', color: 'var(--bg-deep)', border: 'none', borderRadius: 8, padding: '12px 20px', fontWeight: 700, fontSize: 14, cursor: 'pointer' }
          }, 'Connect'),
        ),
      ),
    ),
  );
}

// ========================== BLIP DETAIL/EDIT MODAL ==========================

function BlipDetailModal({ blip, onClose, onUpdate, onDelete, onRoute, profile, sendToAllPeers, sendToPeer, peers, categories }) {
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(blip.title);
  const [editDesc, setEditDesc] = useState(blip.desc || '');
  const [editType, setEditType] = useState(blip.type);
  const [commentText, setCommentText] = useState('');
  const [comments, setComments] = useState(blip.comments || []);
  const isMine = blip.creator === profile.peerId;
  const cat = getCat(blip.type, categories);

  function handleSave() {
    const updated = {
      ...blip,
      title: editTitle.trim() || blip.title,
      desc: editDesc.trim(),
      type: editType,
      comments,
    };
    onUpdate(updated);
    sendToAllPeers({ type: 'blip_update', blip: updated });
    setEditing(false);
    showToast('Blip updated!', 'var(--neon-green)');
  }

  function handleComment() {
    const text = commentText.trim();
    if (!text) return;
    const comment = {
      id: generateId('cmt'),
      text,
      sender: profile.displayName,
      senderId: profile.peerId,
      timestamp: Date.now(),
    };
    const newComments = [...comments, comment];
    setComments(newComments);
    setCommentText('');
    const updated = { ...blip, comments: newComments };
    onUpdate(updated);
    sendToAllPeers({ type: 'blip_comment', blipId: blip.id, comment });
  }

  function handleBoost() {
    const updated = { ...blip, boosts: (blip.boosts || 0) + 1 };
    onUpdate(updated);
    sendToAllPeers({ type: 'blip_boost', blipId: blip.id });
    showToast('⚡ Boosted!', 'var(--amber)');
  }

  return e('div', {
    style: { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }
  },
    e('div', { onClick: onClose, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1 } }),
    e('div', {
      className: 'animate-slide-up',
      style: {
        position: 'relative', zIndex: 2, background: 'var(--bg-card)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: '20px 16px', width: '100%', maxWidth: 500, maxHeight: '70vh', overflow: 'auto',
        border: '1px solid var(--border)', borderBottom: 'none',
      }
    },
      // Handle
      e('div', { style: { width: 40, height: 4, background: 'var(--border)', borderRadius: 2, margin: '0 auto 16px' } }),

      // Header
      e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 } },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
          e('div', {
            style: {
              width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 24, background: withAlpha(cat.color, '20'), border: '2px solid ' + cat.color,
            }
          }, getCategoryIcon(getCat(editing ? editType : blip.type, categories))),
          e('div', null,
            !editing
              ? e('div', { style: { fontWeight: 700, fontSize: 18, color: 'var(--text-primary)' } }, blip.title)
              : e('input', {
                  value: editTitle, onChange: (ev) => setEditTitle(ev.target.value),
                  style: { background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--text-primary)', fontSize: 16, fontWeight: 700, width: 180 }
                }),
            e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 } },
              (blip.creatorName || 'Unknown') + ' · ' + timeAgo(blip.timestamp)
            ),
          ),
        ),
        e('div', { style: { display: 'flex', gap: 6, alignItems: 'center' } },
          isMine && !editing && e('button', {
            onClick: () => setEditing(true),
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }
          }, '✏️ Edit'),
          e('button', {
            onClick: () => { if (onRoute) { onRoute(blip); onClose(); } },
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }
          }, 'Route'),
          e('div', { style: { flex: 1 } }),
          isMine && e('button', {
            onClick: () => { onDelete(blip); onClose(); showToast('Blip removed', 'var(--magenta)'); },
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--magenta)', borderRadius: 8, padding: '6px 10px', color: 'var(--magenta)', fontSize: 12, cursor: 'pointer' }
          }, '🗑️'),
        ),
      ),

      // Edit category
      editing && e('div', { style: { marginBottom: 14 } },
        e('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 } }, 'CATEGORY'),
        e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 4 } },
          (categories || BLIP_CATEGORIES).map(c => e('button', {
            key: c.id,
            onClick: () => setEditType(c.id),
            className: 'boost-btn',
            style: {
              padding: '4px 8px', borderRadius: 6, fontSize: 11, cursor: 'pointer',
              background: editType === c.id ? withAlpha(c.color, '30') : 'var(--bg-deep)',
              border: '1px solid ' + (editType === c.id ? c.color : 'var(--border)'),
              color: editType === c.id ? c.color : 'var(--text-secondary)',
            }
          }, getCategoryIcon(c) + ' ' + c.label))
        ),
      ),

      // Description
      !editing
        ? (blip.desc && e('div', { style: { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 12, padding: '10px 12px', background: 'var(--bg-deep)', borderRadius: 8, border: '1px solid var(--border)' } }, blip.desc))
        : e('textarea', {
            value: editDesc, onChange: (ev) => setEditDesc(ev.target.value),
            placeholder: 'Add description or notes...',
            rows: 3,
            style: { width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text-primary)', fontSize: 13, resize: 'none', marginBottom: 12 }
          }),

      // Save button when editing
      editing && e('button', {
        onClick: handleSave,
        className: 'boost-btn',
        style: { width: '100%', padding: '10px', borderRadius: 8, background: 'var(--neon-green)', border: 'none', color: 'var(--bg-deep)', fontWeight: 700, fontSize: 14, cursor: 'pointer', marginBottom: 14 }
      }, '💾 Save Changes'),

      // Info row
      !editing && e('div', { style: { display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' } },
        e('div', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--text-secondary)' } },
          '📍', blip.lat.toFixed(4) + ', ' + blip.lng.toFixed(4)
        ),
        blip.expiresAt && e('div', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: blip.expiresAt > Date.now() ? 'var(--amber)' : 'var(--magenta)' } },
          '⏰', blip.expiresAt > Date.now() ? 'Expires in ' + timeAgo(Date.now() - (blip.expiresAt - Date.now())) : 'Expired'
        ),
        e('button', {
          onClick: handleBoost,
          className: 'boost-btn',
          style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--amber)', background: 'var(--amber)15', border: '1px solid var(--amber)40', borderRadius: 6, padding: '4px 10px', cursor: 'pointer' }
        }, '⚡ ' + (blip.boosts || 0) + ' Boost' + ((blip.boosts || 0) !== 1 ? 's' : '')),
      ),

      // Comments section
      e('div', { style: { borderTop: '1px solid var(--border)', paddingTop: 14 } },
        e('div', { style: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 10 } },
          '💬 Comments (' + comments.length + ')'
        ),

        // Comments list
        comments.length === 0 && e('div', { style: { fontSize: 12, color: 'var(--text-secondary)', padding: '10px 0', textAlign: 'center' } }, 'No comments yet. Start the conversation!'),
        comments.map(c => e('div', {
          key: c.id,
          style: {
            background: c.senderId === profile.peerId ? 'var(--accent)12' : 'var(--bg-deep)',
            borderRadius: 10, padding: '8px 12px', marginBottom: 6,
            borderLeft: '3px solid ' + (c.senderId === profile.peerId ? 'var(--accent)' : 'var(--border)'),
          }
        },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 3 } },
            e('span', { style: { fontSize: 11, color: 'var(--accent)', fontWeight: 600 } }, c.sender),
            e('span', { style: { fontSize: 10, color: 'var(--text-secondary)' } }, timeAgo(c.timestamp)),
          ),
          e('div', { style: { fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 } }, c.text),
        )),

        // Comment input
        e('div', { style: { display: 'flex', gap: 8, marginTop: 8 } },
          e('input', {
            value: commentText,
            onChange: (ev) => setCommentText(ev.target.value),
            onKeyDown: (ev) => ev.key === 'Enter' && handleComment(),
            placeholder: 'Add a comment...',
            style: { flex: 1, background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 20, padding: '8px 14px', color: 'var(--text-primary)', fontSize: 13 }
          }),
          e('button', {
            onClick: handleComment,
            className: 'boost-btn',
            style: { background: 'var(--accent)', color: 'var(--bg-deep)', border: 'none', borderRadius: '50%', width: 36, height: 36, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 14, fontWeight: 700, flexShrink: 0 }
          }, '➤'),
        ),
      ),
    ),
  );
}


// ========================== MAIN APP ==========================

function App() {
  const [activeTab, setActiveTab] = useState('map');
  const deviceId = useMemo(() => getDeviceId(), []);
  const settingsKey = storageKey('settings', deviceId);
  const peersKey = storageKey('peers', deviceId);
  const messagesKey = storageKey('messages', deviceId);
  const blipsKey = storageKey('blips', deviceId);
  const geochatKey = storageKey('geochat', deviceId);
  const outboxKey = storageKey('outbox', deviceId);
  const [profile, setProfile] = useState(() => loadStorage('boost_profile', { displayName: 'Anonymous', peerId: generatePeerId(), avatar: '🙂', createdAt: Date.now() }));
  const [settings, setSettings] = useState(() => {
    const stored = loadStorageWithMigration(deviceId, 'settings', DEFAULT_SETTINGS);
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      peerServer: { ...DEFAULT_SETTINGS.peerServer, ...(stored.peerServer || {}) },
      iceServers: { ...DEFAULT_SETTINGS.iceServers, ...(stored.iceServers || {}) },
      geochat: { ...DEFAULT_SETTINGS.geochat, ...(stored.geochat || {}) },
      map: { ...DEFAULT_SETTINGS.map, ...(stored.map || {}) },
      ui: { ...DEFAULT_SETTINGS.ui, ...(stored.ui || {}) },
      push: { ...DEFAULT_SETTINGS.push, ...(stored.push || {}) },
      backup: { ...DEFAULT_SETTINGS.backup, ...(stored.backup || {}) },
      customBlipTypes: stored.customBlipTypes || [],
    };
  });
  const [peers, setPeers] = useState(() => loadStorageWithMigration(deviceId, 'peers', []));
  const [messages, setMessages] = useState(() => loadStorageWithMigration(deviceId, 'messages', {}));
  const [blips, setBlips] = useState(() => {
    const stored = loadStorageWithMigration(deviceId, 'blips', []);
    return stored.filter(b => !b.expiresAt || b.expiresAt > Date.now());
  });
  const [geochatMessages, setGeochatMessages] = useState(() => {
    const stored = loadStorage('boost_geochat', []);
    return stored.filter(m => Date.now() - m.timestamp < 86400000);
  });
  const [lastBackupAt, setLastBackupAt] = useState(() => loadStorage('boost_last_backup_at', 0));
  const [position, setPosition] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [activeChatPeer, setActiveChatPeer] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});
  const [outbox, setOutbox] = useState(() => loadStorageWithMigration(deviceId, 'outbox', []));
  const [networkOnline, setNetworkOnline] = useState(typeof navigator !== 'undefined' ? navigator.onLine : true);

  const peerRef = useRef(null);
  const connectionsRef = useRef({});
  const peerHealthRef = useRef({});
  const peersRef = useRef([]);
  const lastLocSentRef = useRef(0);
  const mapRef = useRef(null);
  const markersRef = useRef({});

  // Save to localStorage on changes
  useEffect(() => { saveStorage('boost_profile', profile); }, [profile]);
  useEffect(() => { saveStorage(settingsKey, settings); }, [settings]);
  useEffect(() => { saveStorage('boost_last_backup_at', lastBackupAt); }, [lastBackupAt]);
  useEffect(() => {
    const theme = (settings.ui && settings.ui.theme) || 'obsidian';
    const root = document.body;
    root.classList.remove(
      'theme-onyx', 'theme-paper',
      'theme-dusk', 'theme-neon', 'theme-pastel', 'theme-sunset', 'theme-ocean', 'theme-rose',
      'theme-matcha', 'theme-lavender', 'theme-desert', 'theme-mono', 'theme-ivory'
    );
    root.classList.add('theme-' + theme);
  }, [settings.ui && settings.ui.theme]);

  const allCategories = useMemo(() => getAllCategories(settings.customBlipTypes), [settings.customBlipTypes]);
  useEffect(() => { saveStorage(peersKey, peers); }, [peers]);
  useEffect(() => { peersRef.current = peers; }, [peers]);
  useEffect(() => { saveStorage(messagesKey, messages); }, [messages]);
  useEffect(() => { saveStorage(blipsKey, blips); }, [blips]);
  useEffect(() => { saveStorage(geochatKey, geochatMessages); }, [geochatMessages]);
  useEffect(() => { saveStorage(outboxKey, outbox); }, [outbox]);

  useEffect(() => {
    function handleOnline() {
      setNetworkOnline(true);
      if (peerRef.current && peerRef.current.disconnected) {
        try { peerRef.current.reconnect(); } catch {}
      }
      if (peerRef.current && peerRef.current.open) {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('connecting');
      }
      flushOutbox();
    }
    function handleOffline() {
      setNetworkOnline(false);
      setConnectionStatus('disconnected');
    }
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  // Geolocation
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => setPosition({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) => console.warn('Geo error:', err),
      { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 }
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // PeerJS initialization
  useEffect(() => {
    initPeer();
    return () => { if (peerRef.current) peerRef.current.destroy(); };
  }, []);

  function getPeerConfig() {
    const cfg = {};
    if (!settings.peerServer.useDefault) {
      cfg.host = settings.peerServer.host;
      cfg.port = settings.peerServer.port;
      cfg.path = settings.peerServer.path;
      if (settings.peerServer.key) cfg.key = settings.peerServer.key;
      cfg.secure = settings.peerServer.secure;
    }
    if (settings.iceServers.enabled && settings.iceServers.servers.length > 0) {
      cfg.config = { iceServers: settings.iceServers.servers.map(s => {
        const ice = { urls: s.url };
        if (s.username) ice.username = s.username;
        if (s.credential) ice.credential = s.credential;
        return ice;
      })};
    }
    return cfg;
  }

  function initPeer() {
    if (peerRef.current) peerRef.current.destroy();
    setConnectionStatus('connecting');
    const cfg = getPeerConfig();
    const peer = new Peer(profile.peerId, cfg);
    peerRef.current = peer;

    peer.on('open', (id) => {
      setConnectionStatus('connected');
      setProfile(p => ({ ...p, peerId: id }));
      // Reconnect to known peers
      peers.forEach(p => {
        if (!connectionsRef.current[p.peerId] && !p.blocked) {
          connectToPeer(p.peerId);
        }
      });
    });

    peer.on('connection', (conn) => {
      handleConnection(conn);
    });

    peer.on('disconnected', () => {
      setConnectionStatus('disconnected');
      setTimeout(() => { if (peerRef.current && !peerRef.current.destroyed) peerRef.current.reconnect(); }, 3000);
    });

    peer.on('error', (err) => {
      console.error('Peer error:', err);
      if (err.type === 'unavailable-id') {
        const newId = generatePeerId();
        setProfile(p => ({ ...p, peerId: newId }));
        setTimeout(initPeer, 1000);
      }
    });
  }

  function updatePeer(peerId, patch) {
    setPeers(prev => {
      const existing = prev.find(p => p.peerId === peerId);
      if (existing) {
        return prev.map(p => p.peerId === peerId ? { ...p, ...patch } : p);
      }
      return [...prev, { peerId, displayName: peerId, lastSeen: Date.now(), connected: false, ...patch }];
    });
  }

  function isPeerBlocked(peerId) {
    const peer = peersRef.current.find(p => p.peerId === peerId);
    return !!(peer && peer.blocked);
  }

  function blockPeer(peerId, shouldBlock) {
    if (!peerId) return;
    if (shouldBlock) {
      try { sendToPeer(peerId, { type: 'loc_stop' }); } catch {}
      if (connectionsRef.current[peerId]) {
        try { connectionsRef.current[peerId].close(); } catch {}
        delete connectionsRef.current[peerId];
      }
      updatePeer(peerId, { blocked: true, connected: false, shareOut: false, shareIn: false, shareActive: false });
      setOutbox(prev => prev.filter(item => item.peerId !== peerId));
    } else {
      updatePeer(peerId, { blocked: false });
    }
  }

  function handleConnection(conn) {
    const peerId = conn.peer;
    if (isPeerBlocked(peerId)) {
      try { conn.close(); } catch {}
      return;
    }
    connectionsRef.current[peerId] = conn;
    peerHealthRef.current[peerId] = { lastPong: Date.now() };

    conn.on('open', () => {
      setPeers(prev => {
        if (prev.find(p => p.peerId === peerId)) {
          return prev.map(p => p.peerId === peerId ? { ...p, lastSeen: Date.now(), connected: true } : p);
        }
        return [...prev, { peerId, displayName: peerId, lastSeen: Date.now(), connected: true }];
      });
      // Send introduction
      conn.send({ type: 'intro', displayName: profile.displayName, avatar: profile.avatar });
      // Sync existing blips to new peer
      const myBlips = blips.filter(b => !b.isRemote);
      myBlips.forEach(b => {
        conn.send({ type: 'blip', blip: b });
      });
      flushOutbox(peerId);
    });

    conn.on('data', (data) => {
      handlePeerData(peerId, data);
    });

    conn.on('close', () => {
      delete connectionsRef.current[peerId];
      delete peerHealthRef.current[peerId];
      setPeers(prev => prev.map(p => p.peerId === peerId ? { ...p, connected: false } : p));
    });

    conn.on('error', () => {
      delete connectionsRef.current[peerId];
      delete peerHealthRef.current[peerId];
    });
  }

  function connectToPeer(peerId) {
    if (!peerRef.current || peerRef.current.destroyed) return;
    if (connectionsRef.current[peerId]) return;
    if (peerId === profile.peerId) { showToast("Can't connect to yourself!", 'var(--magenta)'); return; }
    if (isPeerBlocked(peerId)) { showToast('Peer is blocked', 'var(--magenta)'); return; }
    try {
      const conn = peerRef.current.connect(peerId, { reliable: true });
      handleConnection(conn);
    } catch (err) {
      showToast('Connection failed', 'var(--magenta)');
    }
  }

  function handlePeerData(fromPeer, data) {
    if (!data || !data.type) return;
    const blocked = isPeerBlocked(fromPeer);
    if (blocked && data.type !== 'ack') return;
    if (!blocked) touchPeer(fromPeer);
    if (data.deliveryId && data.type !== 'ack') {
      try { connectionsRef.current[fromPeer] && connectionsRef.current[fromPeer].send({ type: 'ack', deliveryId: data.deliveryId }); } catch {}
    }

    switch (data.type) {
      case 'intro':
        setPeers(prev => prev.map(p => p.peerId === fromPeer ? { ...p, displayName: data.displayName || fromPeer, avatar: data.avatar } : p));
        break;
      case 'loc_share_req':
        updatePeer(fromPeer, { shareIn: true, lastSeen: Date.now() });
        {
          const peer = peersRef.current.find(p => p.peerId === fromPeer);
          if (peer && peer.shareOut) {
            sendToPeer(fromPeer, { type: 'loc_share_ack' });
            updatePeer(fromPeer, { shareActive: true, shareIn: true });
          }
        }
        break;
      case 'loc_share_ack':
        {
          const peer = peersRef.current.find(p => p.peerId === fromPeer);
          if (peer && peer.shareOut) {
            updatePeer(fromPeer, { shareActive: true, shareIn: true });
          } else {
            updatePeer(fromPeer, { shareIn: true });
          }
        }
        break;
      case 'loc_stop':
        updatePeer(fromPeer, { shareActive: false, shareIn: false });
        break;
      case 'loc_update':
        if (typeof data.lat === 'number' && typeof data.lng === 'number') {
          updatePeer(fromPeer, {
            lastLoc: { lat: data.lat, lng: data.lng, accuracy: data.accuracy || null },
            lastLocAt: data.ts || Date.now(),
            shareIn: true,
          });
        }
        break;
      case 'chat':
        setMessages(prev => {
          const convMsgs = prev[fromPeer] || [];
          return { ...prev, [fromPeer]: [...convMsgs, { id: generateId('msg'), text: data.message, sender: fromPeer, timestamp: data.timestamp || Date.now(), blipAttachment: data.blipAttachment || null }] };
        });
        if (activeChatPeer !== fromPeer) {
          setUnreadCounts(prev => ({ ...prev, [fromPeer]: (prev[fromPeer] || 0) + 1 }));
        }
        break;
      case 'blip':
        if (data.blip) {
          setBlips(prev => {
            if (prev.find(b => b.id === data.blip.id)) return prev;
            return [...prev, { ...data.blip, isRemote: true }];
          });
          showToast('New blip from ' + (data.blip.creatorName || 'peer'), 'var(--neon-green)');
        }
        break;
      case 'blip_update':
        if (data.blip) {
          setBlips(prev => prev.map(b => b.id === data.blip.id ? { ...data.blip, isRemote: b.isRemote } : b));
        }
        break;
      case 'blip_comment':
        if (data.blipId && data.comment) {
          setBlips(prev => prev.map(b => {
            if (b.id === data.blipId) {
              const comments = b.comments || [];
              if (comments.find(c => c.id === data.comment.id)) return b;
              return { ...b, comments: [...comments, data.comment] };
            }
            return b;
          }));
          showToast('💬 New comment on blip', 'var(--accent)');
        }
        break;
      case 'geochat':
        // FIX: Accept both data.message and data.text for backwards compat
        const gcText = data.message || data.text;
        if (gcText) {
          setGeochatMessages(prev => {
            // Deduplicate by id
            if (data.id && prev.find(m => m.id === data.id)) return prev;
            return [...prev, {
              id: data.id || generateId('gc'),
              text: gcText,
              sender: data.sender || 'Anon',
              zone: data.zone,
              timestamp: data.timestamp || Date.now(),
              mood: data.mood,
              isShout: data.isShout,
              lat: data.lat,
              lng: data.lng,
            }];
          });
        }
        break;
      case 'blip_boost':
        if (data.blipId) {
          setBlips(prev => prev.map(b => b.id === data.blipId ? { ...b, boosts: (b.boosts || 0) + 1 } : b));
        }
        break;
      case 'blip_delete':
        if (data.blipId) {
          setBlips(prev => prev.filter(b => b.id !== data.blipId));
        }
        break;
      case 'buzz':
        showToast((data.senderName || fromPeer) + ' buzzed you', 'var(--amber)');
        break;
      case 'ping':
        if (connectionsRef.current[fromPeer]) {
          connectionsRef.current[fromPeer].send({ type: 'pong' });
        }
        break;
      case 'pong':
        peerHealthRef.current[fromPeer] = { lastPong: Date.now() };
        setPeers(prev => prev.map(p => p.peerId === fromPeer ? { ...p, connected: true, lastSeen: Date.now() } : p));
        break;
      case 'ack':
        if (data.deliveryId) {
          setOutbox(prev => prev.filter(item => !(item.id === data.deliveryId && item.peerId === fromPeer)));
          setMessages(prev => {
            const conv = prev[fromPeer] || [];
            let changed = false;
            const nextConv = conv.map(m => {
              if (m.deliveryId === data.deliveryId) {
                changed = true;
                return { ...m, delivered: true };
              }
              return m;
            });
            return changed ? { ...prev, [fromPeer]: nextConv } : prev;
          });
        }
        break;
    }
  }

  function touchPeer(peerId) {
    updatePeer(peerId, { lastSeen: Date.now(), connected: true });
  }

  const flushOutbox = useCallback((targetPeerId) => {
    if (!navigator.onLine) return;
    setOutbox(prev => {
      const now = Date.now();
      let changed = false;
      const next = prev.map(item => {
        if (targetPeerId && item.peerId !== targetPeerId) return item;
        if (now - (item.lastAttempt || 0) < OUTBOX_RETRY_MS) return item;
        const conn = connectionsRef.current[item.peerId];
        if (!conn || !conn.open) return item;
        try { conn.send(item.payload); } catch { return item; }
        changed = true;
        return { ...item, attempts: (item.attempts || 0) + 1, lastAttempt: now };
      });
      return changed ? next : prev;
    });
  }, []);

  function queueOutbox(peerId, payload) {
    const id = payload.deliveryId || generateId('out');
    const entry = {
      id,
      peerId,
      payload: { ...payload, deliveryId: id },
      createdAt: Date.now(),
      attempts: 0,
      lastAttempt: 0,
    };
    setOutbox(prev => prev.some(item => item.id === id) ? prev : [...prev, entry]);
    return id;
  }

  function sendToAllPeers(data) {
    Object.values(connectionsRef.current).forEach(conn => {
      try { conn.send(data); } catch {}
    });
  }

  function sendToPeer(peerId, data) {
    if (isPeerBlocked(peerId)) return;
    const conn = connectionsRef.current[peerId];
    if (conn && conn.open) {
      try { conn.send(data); } catch {}
    }
  }

  function sendReliableToPeer(peerId, data) {
    if (isPeerBlocked(peerId)) return null;
    const deliveryId = queueOutbox(peerId, data);
    const conn = connectionsRef.current[peerId];
    if (!conn || !conn.open) {
      connectToPeer(peerId);
      return deliveryId;
    }
    if (navigator.onLine) {
      try { conn.send({ ...data, deliveryId }); } catch {}
    }
    return deliveryId;
  }

  function sendReliableToAllPeers(data) {
    peersRef.current.forEach(p => {
      if (p.peerId && p.peerId !== profile.peerId) {
        sendReliableToPeer(p.peerId, data);
      }
    });
  }

  function buildBackupPayload() {
    return {
      version: 1,
      profile: { displayName: profile.displayName, avatar: profile.avatar, createdAt: profile.createdAt },
      settings,
      peers,
      messages,
      blips,
      geochatMessages,
    };
  }

  async function runDailyBackup(force = false, interactive = false) {
    const backupEnabled = !!(settings.backup && settings.backup.enabled);
    if (!backupEnabled && !force) return;
    const todayKey = new Date().toISOString().slice(0, 10);
    const lastKey = lastBackupAt ? new Date(lastBackupAt).toISOString().slice(0, 10) : null;
    if (!force && lastKey === todayKey) return;
    const name = settings.backup.name || profile.displayName || profile.peerId || 'user';
    const payload = buildBackupPayload();
    const folderOk = await writeBackupToFolder(payload, name, interactive);
    const fallbackOk = writeBackupFallback(payload);
    if (folderOk || fallbackOk) {
      setLastBackupAt(Date.now());
      if (interactive) {
        showToast(folderOk ? 'Backup saved' : 'Backup saved (in-app)', 'var(--neon-green)');
      }
      return;
    }
    if (interactive) showToast('Backup failed', 'var(--magenta)');
  }

  async function buzzPeer(peerId) {
    if (!peerId) return;
    if (isPeerBlocked(peerId)) { showToast('Peer is blocked', 'var(--magenta)'); return; }
    sendReliableToPeer(peerId, { type: 'buzz', timestamp: Date.now(), senderName: profile.displayName });
    if (settings.push && settings.push.enabled && settings.push.serverUrl) {
      const serverUrl = settings.push.serverUrl.replace(/\/$/, '');
      try {
        await fetch(serverUrl + '/buzz', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ to: peerId, from: profile.peerId, senderName: profile.displayName }),
        });
      } catch {}
    }
    showToast('Buzz sent', 'var(--amber)');
  }

  function removePeer(peerId, deleteHistory) {
    if (!peerId) return;
    try { sendToPeer(peerId, { type: 'loc_stop' }); } catch {}
    if (connectionsRef.current[peerId]) {
      try { connectionsRef.current[peerId].close(); } catch {}
      delete connectionsRef.current[peerId];
    }
    setPeers(prev => prev.filter(p => p.peerId !== peerId));
    setUnreadCounts(prev => {
      const next = { ...prev };
      delete next[peerId];
      return next;
    });
    setOutbox(prev => prev.filter(item => item.peerId !== peerId));
    if (deleteHistory) {
      setMessages(prev => {
        const next = { ...prev };
        delete next[peerId];
        return next;
      });
      setBlips(prev => prev.filter(b => b.creator !== peerId));
    }
  }

  function toggleLocationShare(peerId, enabled) {
    if (!peerId) return;
    if (isPeerBlocked(peerId)) { showToast('Peer is blocked', 'var(--magenta)'); return; }
    if (!enabled) {
      updatePeer(peerId, { shareOut: false, shareActive: false });
      sendToPeer(peerId, { type: 'loc_stop' });
      return;
    }
    updatePeer(peerId, { shareOut: true });
    sendToPeer(peerId, { type: 'loc_share_req' });
    const peer = peersRef.current.find(p => p.peerId === peerId);
    if (peer && peer.shareIn) {
      sendToPeer(peerId, { type: 'loc_share_ack' });
      updatePeer(peerId, { shareActive: true, shareIn: true });
    }
  }

  useEffect(() => {
    if (!position) return;
    const interval = setInterval(() => {
      if (!navigator.onLine) return;
      const sharePeers = peersRef.current.filter(p => p.shareActive);
      if (!sharePeers.length) return;
      const now = Date.now();
      if (now - lastLocSentRef.current < 1200) return;
      sharePeers.forEach(p => {
        sendToPeer(p.peerId, {
          type: 'loc_update',
          lat: position.lat,
          lng: position.lng,
          ts: now,
          accuracy: position.accuracy,
        });
      });
      lastLocSentRef.current = now;
    }, 1000);
    return () => clearInterval(interval);
  }, [position]);

  useEffect(() => {
    const interval = setInterval(() => {
      Object.entries(connectionsRef.current).forEach(([peerId, conn]) => {
        if (conn && conn.open) {
          try { conn.send({ type: 'ping', ts: Date.now() }); } catch {}
        }
      });
      setPeers(prev => prev.map(p => {
        const lastPong = (peerHealthRef.current[p.peerId] && peerHealthRef.current[p.peerId].lastPong) || p.lastSeen || 0;
        if (Date.now() - lastPong > PONG_TIMEOUT_MS) {
          return { ...p, connected: false };
        }
        return p;
      }));
      flushOutbox();
    }, PING_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [flushOutbox]);

  useEffect(() => {
    if (!settings.backup || !settings.backup.enabled) return;
    let timeoutId = null;
    let intervalId = null;
    const schedule = () => {
      timeoutId = setTimeout(() => {
        runDailyBackup(false, false);
        intervalId = setInterval(() => { runDailyBackup(false, false); }, 24 * 60 * 60 * 1000);
      }, msUntilNext3am());
    };
    schedule();
    return () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (intervalId) clearInterval(intervalId);
    };
  }, [settings.backup && settings.backup.enabled, settings.backup && settings.backup.name, profile.displayName, profile.peerId, blips, peers, messages, geochatMessages, settings, lastBackupAt]);

  // Blip expiry check
  useEffect(() => {
    const interval = setInterval(() => {
      setBlips(prev => prev.filter(b => !b.expiresAt || b.expiresAt > Date.now()));
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const connectedPeersCount = peers.filter(p => p.connected).length;

  // Layout
  return e('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', background: 'var(--bg-deep)' } },
    // Header
    e(Header, { profile, connectionStatus, connectedPeersCount, onReconnect: initPeer }),
    // Main content area
    e('div', { style: { flex: 1, overflow: 'hidden', position: 'relative' } },
      activeTab === 'chat' && e(ChatView, { profile, peers, messages, setMessages, activeChatPeer, setActiveChatPeer, connectToPeer, sendToPeer, sendReliableToPeer, toggleLocationShare, removePeer, blockPeer, buzzPeer, unreadCounts, setUnreadCounts, blips, categories: allCategories }),
      activeTab === 'map' && e(MapView, { position, blips, setBlips, profile, sendToAllPeers, sendToPeer, sendReliableToAllPeers, settings, peers, categories: allCategories }),
      activeTab === 'geochat' && e(GeochatView, { position, geochatMessages, setGeochatMessages, profile, sendToAllPeers, settings }),
      activeTab === 'settings' && e(SettingsView, { profile, setProfile, settings, setSettings, initPeer, blips, setBlips, messages, setMessages, geochatMessages, setGeochatMessages, peers, setPeers, categories: allCategories, runDailyBackup }),
    ),
    // Bottom nav
    e(BottomNav, { activeTab, setActiveTab, unreadCounts })
  );
}

// ========================== HEADER ==========================

function Header({ profile, connectionStatus, connectedPeersCount, onReconnect }) {
  const statusColor = connectionStatus === 'connected' ? 'var(--neon-green)' : connectionStatus === 'connecting' ? 'var(--amber)' : 'var(--magenta)';

  return e('div', {
    style: {
      height: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '0 16px', background: 'var(--glass-strong)', backdropFilter: 'blur(10px)',
      borderBottom: '1px solid var(--border)', zIndex: 100, flexShrink: 0,
    }
  },
    e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
      e('div', {
        onClick: () => { if (onReconnect) { onReconnect(); showToast('Reconnecting...', 'var(--amber)'); } },
        style: {
          fontSize: 20,
          color: 'var(--accent)',
          textShadow: '0 0 10px color-mix(in srgb, var(--accent) 70%, transparent), 0 0 24px color-mix(in srgb, var(--accent) 40%, transparent)',
          animation: 'bolt-pulse 2.2s ease-in-out infinite',
          transformOrigin: 'center',
          cursor: 'pointer',
        }
      }, '⚡'),
      e('div', { style: { display: 'flex', flexDirection: 'column', lineHeight: 1 } },
        e('span', { style: { fontFamily: "'Chakra Petch', sans-serif", fontWeight: 700, fontSize: 18, letterSpacing: 2.5, color: 'var(--text-primary)' } }, 'BOOST'),
        e('span', { style: { fontSize: 10, color: 'var(--text-secondary)', letterSpacing: 1 } }, 'Fractal'),
      ),
    ),
    e('div', { style: { display: 'flex', alignItems: 'center', gap: 10 } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: 'var(--text-secondary)' } },
        e('span', { style: { fontSize: 11 } }, connectedPeersCount + ' peer' + (connectedPeersCount !== 1 ? 's' : '')),
      ),
      e('div', {
        onClick: () => { navigator.clipboard.writeText(profile.peerId); showToast('Peer ID copied!'); },
        style: {
          background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 6, padding: '3px 8px',
          fontSize: 11, fontFamily: "'JetBrains Mono', monospace", cursor: 'pointer', color: 'var(--accent)', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }
      }, profile.peerId),
      e('div', { style: { width: 10, height: 10, borderRadius: '50%', background: statusColor, boxShadow: '0 0 8px ' + statusColor } }),
    )
  );
}

// ========================== BOTTOM NAV ==========================

function BottomNav({ activeTab, setActiveTab, unreadCounts }) {
  const tabs = [
    { id: 'chat', label: 'Chat' },
    { id: 'map', label: 'Map' },
    { id: 'geochat', label: 'Geochat' },
    { id: 'settings', label: 'Settings' },
  ];

  const totalUnread = Object.values(unreadCounts).reduce((a, b) => a + b, 0);

  return e('div', {
    style: {
      height: 'var(--bottom-nav-height, 72px)', display: 'flex', alignItems: 'center', justifyContent: 'space-around',
      background: 'var(--glass-strong)', backdropFilter: 'blur(10px)',
      borderTop: '1px solid var(--border)', flexShrink: 0, paddingBottom: 'env(safe-area-inset-bottom, 0)',
    }
  },
    tabs.map(tab => e('div', {
      key: tab.id,
      onClick: () => setActiveTab(tab.id),
      style: {
        flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2,
        cursor: 'pointer', position: 'relative', padding: '6px 0', transition: 'all 0.2s ease',
        opacity: activeTab === tab.id ? 1 : 0.5,
      }
    },
      tab.id === 'chat' && totalUnread > 0 && e('span', {
        style: {
          position: 'absolute', top: 6, right: 16, background: 'var(--magenta)', color: '#fff',
          fontSize: 9, fontWeight: 700, borderRadius: 10, padding: '1px 5px', minWidth: 16, textAlign: 'center',
        }
      }, totalUnread > 9 ? '9+' : totalUnread),
      e('span', { style: { fontSize: 11, fontWeight: 600, color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-secondary)', letterSpacing: 0.4 } }, tab.label),
      activeTab === tab.id && e('div', { className: 'tab-indicator' }),
    ))
  );
}

// ========================== CHAT VIEW ==========================

function ChatView({ profile, peers, messages, setMessages, activeChatPeer, setActiveChatPeer, connectToPeer, sendToPeer, sendReliableToPeer, toggleLocationShare, removePeer, blockPeer, buzzPeer, unreadCounts, setUnreadCounts, blips, categories }) {
  const [connectInput, setConnectInput] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [showPeerMenu, setShowPeerMenu] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (activeChatPeer && messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeChatPeer]);

  useEffect(() => {
    if (activeChatPeer) {
      setUnreadCounts(prev => ({ ...prev, [activeChatPeer]: 0 }));
    }
    setShowPeerMenu(false);
    setConfirmState(null);
  }, [activeChatPeer]);

  function handleConnect() {
    const id = connectInput.trim();
    if (!id) return;
    connectToPeer(id);
    setConnectInput('');
    setShowConnect(false);
    showToast('Connecting to ' + id + '...');
  }

  function handleSend() {
    const text = chatInput.trim();
    if (!text || !activeChatPeer) return;
    const deliveryId = generateId('out');
    const msg = { id: generateId('msg'), text, sender: profile.peerId, timestamp: Date.now(), deliveryId, delivered: false };
    setMessages(prev => ({ ...prev, [activeChatPeer]: [...(prev[activeChatPeer] || []), msg] }));
    sendReliableToPeer(activeChatPeer, { type: 'chat', message: text, timestamp: msg.timestamp, deliveryId });
    setChatInput('');
  }


  function handleShareVia(method) {
    const peerId = profile.peerId;
    const shareText = 'Connect with me on BOOST! My Peer ID: ' + peerId;
    const shareUrl = window.location.origin + '?connect=' + peerId;

    if (method === 'native' && navigator.share) {
      navigator.share({ title: 'BOOST Peer ID', text: shareText, url: shareUrl }).catch(() => {});
    } else if (method === 'copy') {
      navigator.clipboard.writeText(peerId);
      showToast('Peer ID copied!');
    } else if (method === 'whatsapp') {
      window.open('https://wa.me/?text=' + encodeURIComponent(shareText + '\n' + shareUrl), '_blank');
    } else if (method === 'telegram') {
      window.open('https://t.me/share/url?url=' + encodeURIComponent(shareUrl) + '&text=' + encodeURIComponent(shareText), '_blank');
    }
  }

  // Check for connect param on load
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const connectId = params.get('connect');
    if (connectId && connectId !== profile.peerId) {
      connectToPeer(connectId);
      showToast('Connecting to ' + connectId + '...');
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, []);

  // Conversation list
  if (!activeChatPeer) {
    return e('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' } },
      // Scanner modal
      showScanner && e(QRScannerModal, {
        onScan: (id) => { connectToPeer(id); setShowScanner(false); showToast('Connecting to ' + id + '...'); },
        onClose: () => setShowScanner(false),
      }),

      // QR Modal
      showQR && e('div', {
        style: { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.8)' }
      },
        e('div', {
          className: 'animate-bounce-in',
          style: { background: 'var(--bg-card)', borderRadius: 16, padding: '24px', width: '90%', maxWidth: 340, border: '1px solid var(--border)', textAlign: 'center' }
        },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 } },
            e('span', { style: { fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' } }, 'Your QR Code'),
            e('button', { onClick: () => setShowQR(false), style: { background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' } }, '✕'),
          ),
          e('div', { style: { background: '#fff', borderRadius: 12, padding: 16, display: 'inline-block', marginBottom: 16 } },
            e(QRCodeDisplay, { text: profile.peerId, size: 200 }),
          ),
          e('div', { style: { fontSize: 13, color: 'var(--accent)', fontFamily: "'JetBrains Mono', monospace", marginBottom: 16, wordBreak: 'break-all' } }, profile.peerId),
          e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 16 } }, 'Have your peer scan this code to connect'),
          // Share methods
          e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 8 } },
            e('button', {
              onClick: () => handleShareVia('copy'),
              className: 'boost-btn',
              style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', width: '100%' }
            }, 'Copy ID'),
            navigator.share && e('button', {
              onClick: () => handleShareVia('native'),
              className: 'boost-btn',
              style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--neon-green)', fontSize: 12, cursor: 'pointer', width: '100%' }
            }, 'Share'),
            e('button', {
              onClick: () => handleShareVia('whatsapp'),
              className: 'boost-btn',
              style: { background: '#25D366', border: 'none', borderRadius: 8, padding: '8px 14px', color: '#fff', fontSize: 12, cursor: 'pointer', width: '100%' }
            }, 'WhatsApp'),
            e('button', {
              onClick: () => handleShareVia('telegram'),
              className: 'boost-btn',
              style: { background: '#0088cc', border: 'none', borderRadius: 8, padding: '8px 14px', color: '#fff', fontSize: 12, cursor: 'pointer', width: '100%' }
            }, 'Telegram'),
          ),
        ),
      ),

      // Connect panel toggle
      e('div', { style: { padding: '10px 16px', borderBottom: '1px solid var(--border)' } },
        e('div', { style: { display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'nowrap' } },
          e('button', {
            onClick: () => setShowConnect(!showConnect),
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--accent)', fontWeight: 600, fontSize: 11, cursor: 'pointer' }
          }, showConnect ? 'Close' : 'Connect'),
          e('button', {
            onClick: () => setShowQR(true),
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: '#A855F7', fontWeight: 600, fontSize: 11, cursor: 'pointer' }
          }, 'QR'),
          e('button', {
            onClick: () => setShowScanner(true),
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--amber)', fontWeight: 600, fontSize: 11, cursor: 'pointer' }
          }, 'Scan'),
          e('button', {
            onClick: () => handleShareVia(navigator.share ? 'native' : 'copy'),
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--neon-green)', fontWeight: 600, fontSize: 11, cursor: 'pointer' }
          }, 'Share'),
        ),
        showConnect && e('div', { className: 'animate-slide-up', style: { marginTop: 10, display: 'flex', gap: 8 } },
          e('input', {
            value: connectInput, onChange: (ev) => setConnectInput(ev.target.value),
            onKeyDown: (ev) => ev.key === 'Enter' && handleConnect(),
            placeholder: 'Enter Peer ID...',
            style: { flex: 1, background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text-primary)', fontSize: 13, fontFamily: "'JetBrains Mono', monospace" }
          }),
          e('button', {
            onClick: handleConnect,
            className: 'boost-btn',
            style: { background: 'var(--accent)', color: 'var(--bg-deep)', border: 'none', borderRadius: 8, padding: '10px 16px', fontWeight: 700, fontSize: 13, cursor: 'pointer' }
          }, 'Connect'),
        ),
      ),
      // Conversations
      e('div', { style: { flex: 1, overflow: 'auto', padding: '8px 16px' } },
        peers.length === 0 && e('div', { style: { textAlign: 'center', padding: 40, color: 'var(--text-secondary)' } },
          e('div', { style: { fontSize: 48, marginBottom: 12 } }, '🤝'),
          e('div', { style: { fontSize: 15, fontWeight: 500 } }, 'No peers yet'),
          e('div', { style: { fontSize: 12, marginTop: 6 } }, 'Connect to a peer to start chatting'),
        ),
        peers.map(peer => {
          const convMsgs = messages[peer.peerId] || [];
          const lastMsg = convMsgs[convMsgs.length - 1];
          const unread = unreadCounts[peer.peerId] || 0;
          const shareActive = !!peer.shareActive;
          const shareOut = !!peer.shareOut;
          const blocked = !!peer.blocked;
          const shareLabel = blocked ? 'Blocked' : shareActive ? 'Sharing' : shareOut ? 'Pending' : 'Share';
          const shareTone = blocked ? 'var(--magenta)' : shareActive ? 'var(--neon-green)' : shareOut ? 'var(--amber)' : 'var(--text-secondary)';
          return e('div', {
            key: peer.peerId,
            onClick: () => setActiveChatPeer(peer.peerId),
            style: {
              background: 'var(--bg-card)', borderRadius: 12, padding: '14px 16px', marginBottom: 8,
              cursor: 'pointer', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12,
              transition: 'all 0.15s ease',
            },
            onMouseEnter: (ev) => { ev.currentTarget.style.borderColor = 'var(--accent)'; ev.currentTarget.style.boxShadow = '0 0 12px rgba(0,240,255,0.1)'; },
            onMouseLeave: (ev) => { ev.currentTarget.style.borderColor = 'var(--border)'; ev.currentTarget.style.boxShadow = 'none'; },
          },
            e('div', { style: { width: 44, height: 44, borderRadius: '50%', background: 'var(--bg-card2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0, border: '2px solid ' + (peer.connected ? 'var(--neon-green)' : 'var(--border)') } }, peer.avatar || '🙂'),
            e('div', { style: { flex: 1, minWidth: 0 } },
              e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                e('span', { style: { fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' } }, peer.displayName || peer.peerId),
                lastMsg && e('span', { style: { fontSize: 10, color: 'var(--text-secondary)' } }, timeAgo(lastMsg.timestamp)),
              ),
              e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3, gap: 8 } },
                e('span', { style: { fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 } }, lastMsg ? lastMsg.text : (peer.connected ? 'Connected' : 'Offline')) ,
                e('div', { style: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 } },
                  e('button', {
                    onClick: (ev) => { ev.stopPropagation(); if (!blocked) toggleLocationShare(peer.peerId, !shareOut); },
                    className: 'boost-btn',
                    style: { background: 'transparent', border: '1px solid ' + shareTone, color: shareTone, borderRadius: 999, padding: '2px 8px', fontSize: 10, fontWeight: 600, cursor: blocked ? 'not-allowed' : 'pointer', opacity: blocked ? 0.6 : 1 }
                  }, shareLabel),
                  unread > 0 && e('span', { style: { background: 'var(--magenta)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '2px 7px', minWidth: 18, textAlign: 'center' } }, unread),
                ),
              ),
            ),
          );
        })
      )
    );
  }

  // Chat window
  const peerInfo = peers.find(p => p.peerId === activeChatPeer) || { peerId: activeChatPeer, displayName: activeChatPeer };
  const peerBlocked = !!peerInfo.blocked;
  const convMsgs = messages[activeChatPeer] || [];

  return e('div', { style: { height: '100%', display: 'flex', flexDirection: 'column' } },
    confirmState && e('div', {
      style: { position: 'fixed', inset: 0, zIndex: 1300, display: 'flex', alignItems: 'center', justifyContent: 'center' }
    },
      e('div', { onClick: () => setConfirmState(null), style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)' } }),
      e('div', {
        className: 'animate-bounce-in',
        style: { position: 'relative', zIndex: 2, background: 'var(--bg-card)', borderRadius: 14, padding: 18, width: '90%', maxWidth: 360, border: '1px solid var(--border)' }
      },
        e('div', { style: { fontWeight: 700, fontSize: 16, marginBottom: 6, color: 'var(--text-primary)' } }, confirmState.title),
        e('div', { style: { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14, lineHeight: 1.5 } }, confirmState.message),
        e('div', { style: { display: 'flex', justifyContent: 'flex-end', gap: 8 } },
          e('button', {
            onClick: () => setConfirmState(null),
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 12px', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' }
          }, 'Cancel'),
          e('button', {
            onClick: () => { const action = confirmState.onConfirm; setConfirmState(null); if (action) action(); },
            className: 'boost-btn',
            style: { background: confirmState.danger ? 'var(--magenta)' : 'var(--accent)', border: '1px solid ' + (confirmState.danger ? 'var(--magenta)' : 'var(--accent)'), borderRadius: 8, padding: '8px 12px', color: 'var(--bg-deep)', fontSize: 12, cursor: 'pointer', fontWeight: 700 }
          }, confirmState.confirmLabel || 'Confirm'),
        ),
      )
    ),
    showPeerMenu && e('div', {
      onClick: () => setShowPeerMenu(false),
      style: { position: 'fixed', inset: 0, zIndex: 1200 }
    }),
    // Chat header
    e('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--glass-strong)', flexShrink: 0, position: 'relative', zIndex: 1201 } },
      e('button', {
        onClick: () => setActiveChatPeer(null),
        style: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: 20, cursor: 'pointer', padding: 4 }
      }, '←'),
      e('div', { style: { width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-card2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, border: '2px solid ' + (peerInfo.connected ? 'var(--neon-green)' : 'var(--border)') } }, peerInfo.avatar || '🙂'),
      e('div', null,
        e('div', { style: { fontWeight: 600, fontSize: 14 } }, peerInfo.displayName),
        e('div', { style: { fontSize: 10, color: peerBlocked ? 'var(--magenta)' : peerInfo.connected ? 'var(--neon-green)' : 'var(--text-secondary)' } }, peerBlocked ? 'Blocked' : (peerInfo.connected ? 'Online' : 'Offline')),
      ),
      e('div', { style: { marginLeft: 'auto', position: 'relative' } },
        e('button', {
          onClick: () => setShowPeerMenu(v => !v),
          className: 'boost-btn',
          style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }
        }, 'More'),
        showPeerMenu && e('div', {
          style: {
            position: 'absolute', right: 0, top: 'calc(100% + 6px)', minWidth: 180,
            background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
            padding: 6, boxShadow: '0 12px 30px rgba(0,0,0,0.25)', display: 'flex', flexDirection: 'column', gap: 4,
          }
        },
          e('button', {
            onClick: () => { setShowPeerMenu(false); buzzPeer(activeChatPeer); },
            className: 'boost-btn',
            disabled: peerBlocked,
            style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--amber)', fontSize: 11, cursor: peerBlocked ? 'not-allowed' : 'pointer', fontWeight: 600, opacity: peerBlocked ? 0.5 : 1, textAlign: 'left' }
          }, 'Buzz'),
          e('div', { style: { height: 1, background: 'var(--border)', margin: '4px 0' } }),
          e('button', {
            onClick: () => {
              setShowPeerMenu(false);
              setConfirmState({
                title: 'Remove Peer',
                message: 'Remove this peer from your list?',
                confirmLabel: 'Remove',
                danger: false,
                onConfirm: () => { removePeer(activeChatPeer, false); setActiveChatPeer(null); },
              });
            },
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', textAlign: 'left' }
          }, 'Remove'),
          e('button', {
            onClick: () => {
              setShowPeerMenu(false);
              setConfirmState({
                title: 'Remove & Delete History',
                message: 'Remove this peer and delete all chat history and shared blips from them?',
                confirmLabel: 'Remove & Delete',
                danger: true,
                onConfirm: () => { removePeer(activeChatPeer, true); setActiveChatPeer(null); },
              });
            },
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--magenta)', borderRadius: 8, padding: '8px 10px', color: 'var(--magenta)', fontSize: 11, cursor: 'pointer', fontWeight: 600, textAlign: 'left' }
          }, 'Remove & Delete'),
          e('button', {
            onClick: () => {
              setShowPeerMenu(false);
              if (peerBlocked) {
                blockPeer(activeChatPeer, false);
                return;
              }
              setConfirmState({
                title: 'Block Peer',
                message: 'Block this peer? They will not reconnect automatically and cannot buzz or chat with you.',
                confirmLabel: 'Block',
                danger: true,
                onConfirm: () => blockPeer(activeChatPeer, true),
              });
            },
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', color: 'var(--magenta)', fontSize: 11, cursor: 'pointer', textAlign: 'left' }
          }, peerBlocked ? 'Unblock Peer' : 'Block Peer'),
        ),
      ),
    ),

    // Messages
    e('div', { style: { flex: 1, overflow: 'auto', padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 6 } },
      convMsgs.length === 0 && e('div', { style: { textAlign: 'center', padding: 40, color: 'var(--text-secondary)', fontSize: 13 } }, 'No messages yet. Say hi! 👋'),
      convMsgs.map((msg, i) => {
        const isMine = msg.sender === profile.peerId;
        return e('div', { key: msg.id || i, style: { display: 'flex', justifyContent: isMine ? 'flex-end' : 'flex-start' } },
          e('div', { className: 'message-bubble ' + (isMine ? 'message-sent' : 'message-received') },
            msg.text,
            msg.blipAttachment && e('div', { style: { marginTop: 6, padding: 6, background: 'rgba(0,0,0,0.2)', borderRadius: 8, fontSize: 12 } },
              '📍 ' + getCategoryIcon(getCat(msg.blipAttachment.type, categories)) + ' ' + msg.blipAttachment.title
            ),
            e('div', { style: { fontSize: 9, opacity: 0.6, marginTop: 4, textAlign: 'right' } }, timeAgo(msg.timestamp)),
          )
        );
      }),
      e('div', { ref: messagesEndRef }),
    ),
    // Input
    e('div', { style: { padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, background: 'var(--glass)', flexShrink: 0 } },
      e('input', {
        value: chatInput, onChange: (ev) => setChatInput(ev.target.value),
        onKeyDown: (ev) => ev.key === 'Enter' && handleSend(),
        placeholder: peerBlocked ? 'Peer is blocked' : 'Type a message...',
        disabled: peerBlocked,
        style: { flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: '10px 16px', color: 'var(--text-primary)', fontSize: 14, opacity: peerBlocked ? 0.6 : 1 }
      }),
      e('button', {
        onClick: handleSend,
        className: 'boost-btn',
        disabled: peerBlocked,
        style: { background: 'var(--accent)', color: 'var(--bg-deep)', border: 'none', borderRadius: '50%', width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: peerBlocked ? 'not-allowed' : 'pointer', fontSize: 18, fontWeight: 700, opacity: peerBlocked ? 0.6 : 1 }
      }, '⚡'),
    )
  );
}

// ========================== MAP VIEW ==========================

function MapView({ position, blips, setBlips, profile, sendToAllPeers, sendToPeer, sendReliableToAllPeers, settings, peers, categories }) {
  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const blipLayerRef = useRef(null);
  const peerLayerRef = useRef(null);
  const peerMarkersRef = useRef({});
  const routeLayerRef = useRef(null);
  const routeAbortRef = useRef(null);
  const lastRouteKeyRef = useRef(null);
  const tileLayerRef = useRef(null);
  const [showAddBlip, setShowAddBlip] = useState(false);
  const [selectedBlip, setSelectedBlip] = useState(null);
  const [draggingBlipId, setDraggingBlipId] = useState(null);
  const [newBlip, setNewBlip] = useState({ type: 'cool_spot', title: '', desc: '', expiry: 86400000, shareWithPeers: true, dropAtLocation: true });
  const [showWaypoint, setShowWaypoint] = useState(false);
  const [routeTarget, setRouteTarget] = useState(null);
  const [routeData, setRouteData] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeActive, setRouteActive] = useState(false);
  const [awaitingMapPick, setAwaitingMapPick] = useState(false);
  const allCategories = categories && categories.length ? categories : BLIP_CATEGORIES;

  function buildAltRoute(start, end) {
    const lat1 = start.lat;
    const lng1 = start.lng;
    const lat2 = end.lat;
    const lng2 = end.lng;
    const avgLat = (lat1 + lat2) / 2;
    const dx = (lng2 - lng1) * Math.cos(avgLat * Math.PI / 180);
    const dy = (lat2 - lat1);
    const dist = Math.sqrt(dx * dx + dy * dy) || 0.0001;
    const offset = dist * 0.25;
    const perpX = -dy / dist;
    const perpY = dx / dist;
    const midLat = (lat1 + lat2) / 2 + perpY * offset;
    const midLng = (lng1 + lng2) / 2 + perpX * offset;
    return [
      [lat1, lng1],
      [midLat, midLng],
      [lat2, lng2],
    ];
  }

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || leafletMapRef.current) return;

    const defaultCenter = position ? [position.lat, position.lng] : [-1.2864, 36.8172]; // Nairobi default
    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: settings.map.defaultZoom || 14,
      zoomControl: false,
      attributionControl: false,
    });

    L.control.zoom({ position: 'bottomleft' }).addTo(map);

    const theme = (settings.ui && settings.ui.theme) || 'obsidian';
    const lightThemes = ['paper', 'pastel', 'desert', 'ivory'];
    const tileUrl = lightThemes.includes(theme)
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    tileLayerRef.current = L.tileLayer(tileUrl, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 20,
    }).addTo(map);

    blipLayerRef.current = L.layerGroup().addTo(map);
    peerLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    leafletMapRef.current = map;

    return () => { map.remove(); leafletMapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!leafletMapRef.current) return;
    const theme = (settings.ui && settings.ui.theme) || 'obsidian';
    const lightThemes = ['paper', 'pastel', 'desert', 'ivory'];
    const tileUrl = lightThemes.includes(theme)
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    if (tileLayerRef.current) {
      tileLayerRef.current.remove();
    }
    tileLayerRef.current = L.tileLayer(tileUrl, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 20,
    }).addTo(leafletMapRef.current);
  }, [settings.ui && settings.ui.theme]);

  // Update user position
  useEffect(() => {
    if (!leafletMapRef.current || !position) return;

    if (!userMarkerRef.current) {
      const icon = L.divIcon({
        className: 'user-marker',
        html: '<div class="user-marker-ping"></div><div class="user-marker-dot"></div>',
        iconSize: [20, 20], iconAnchor: [10, 10],
      });
      userMarkerRef.current = L.marker([position.lat, position.lng], { icon, zIndexOffset: 1000 }).addTo(leafletMapRef.current);
      userMarkerRef.current.on('click', () => setShowWaypoint(true));
      leafletMapRef.current.setView([position.lat, position.lng], settings.map.defaultZoom || 14);
    } else {
      userMarkerRef.current.setLatLng([position.lat, position.lng]);
    }
  }, [position]);

  useEffect(() => {
    if (!leafletMapRef.current || !awaitingMapPick) return;
    const map = leafletMapRef.current;
    function handlePick(ev) {
      setAwaitingMapPick(false);
      setRouteTarget({ lat: ev.latlng.lat, lng: ev.latlng.lng, label: 'Custom location' });
      showToast('Waypoint set', 'var(--neon-green)');
    }
    map.on('click', handlePick);
    return () => map.off('click', handlePick);
  }, [awaitingMapPick]);

  useEffect(() => {
    if (!routeTarget || !position) {
      setRouteData(null);
      setRouteLoading(false);
      lastRouteKeyRef.current = null;
      return;
    }

    const targetKey = routeTarget.lat.toFixed(5) + ',' + routeTarget.lng.toFixed(5);
    const posKey = position.lat.toFixed(5) + ',' + position.lng.toFixed(5);
    const routeKey = routeActive ? targetKey + '|' + posKey : targetKey;
    if (routeData && lastRouteKeyRef.current === routeKey) {
      return;
    }
    lastRouteKeyRef.current = routeKey;

    if (routeAbortRef.current) {
      try { routeAbortRef.current.abort(); } catch {}
    }
    const controller = new AbortController();
    routeAbortRef.current = controller;
    const start = position.lng + ',' + position.lat;
    const end = routeTarget.lng + ',' + routeTarget.lat;
    const url = 'https://router.project-osrm.org/route/v1/driving/' + start + ';' + end + '?overview=full&geometries=geojson&alternatives=true&steps=false';
    setRouteLoading(true);
    fetch(url, { signal: controller.signal })
      .then(res => res.json())
      .then(data => {
        if (data && data.routes && data.routes.length) {
          setRouteData(data);
        } else {
          setRouteData(null);
        }
      })
      .catch(err => {
        if (err && err.name === 'AbortError') return;
        setRouteData(null);
        showToast('Routing unavailable', 'var(--amber)');
      })
      .finally(() => setRouteLoading(false));
  }, [routeTarget, position, routeActive, routeData]);

  // Update blips on map
  useEffect(() => {
    if (!blipLayerRef.current) return;
    blipLayerRef.current.clearLayers();

    const hidden = settings.map.hiddenCategories || [];
    blips.filter(b => !hidden.includes(b.type)).forEach(blip => {
      const cat = getCat(blip.type, allCategories);
      const isExpiring = blip.expiresAt && (blip.expiresAt - Date.now()) < 3600000;
      const isMine = blip.creator === profile.peerId;
      const iconGlyph = getCategoryIcon(cat);
      const icon = L.divIcon({
        className: '',
        html: '<div class="blip-marker ' + (blip.isRemote ? 'blip-marker-remote' : '') + (isExpiring ? ' blip-marker-expiring' : '') + '" style="border-color: ' + cat.color + '; cursor: ' + (isMine ? 'grab' : 'pointer') + '">' + iconGlyph + '</div>',
        iconSize: [36, 36], iconAnchor: [18, 18],
      });

      const marker = L.marker([blip.lat, blip.lng], { icon, draggable: isMine }).addTo(blipLayerRef.current);

      // Drag support for own blips
      if (isMine) {
        marker.on('dragend', function(ev) {
          const newPos = ev.target.getLatLng();
          setBlips(prev => prev.map(b => {
            if (b.id === blip.id) {
              const updated = { ...b, lat: newPos.lat, lng: newPos.lng };
              sendToAllPeers({ type: 'blip_update', blip: updated });
              return updated;
            }
            return b;
          }));
          showToast('📍 Blip moved!', 'var(--neon-green)');
        });
      }

      // Click to open detail
      marker.on('click', function() {
        setSelectedBlip(blip.id);
      });
    });
  }, [blips, settings.map.hiddenCategories]);

  useEffect(() => {
    if (!peerLayerRef.current) return;
    const layer = peerLayerRef.current;
    const markers = peerMarkersRef.current;

    function animateMarker(marker, from, to, duration = 900) {
      const start = performance.now();
      function step(now) {
        const t = Math.min(1, (now - start) / duration);
        const lat = from.lat + (to.lat - from.lat) * t;
        const lng = from.lng + (to.lng - from.lng) * t;
        marker.setLatLng([lat, lng]);
        if (t < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    const activeIds = new Set();
    peers.filter(p => p.shareActive && p.lastLoc).forEach(p => {
      activeIds.add(p.peerId);
      const color = colorFromId(p.peerId);
      const target = L.latLng(p.lastLoc.lat, p.lastLoc.lng);
      let marker = markers[p.peerId];
      if (!marker) {
        marker = L.circleMarker(target, {
          radius: 8,
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: 0.6,
        });
        marker.bindTooltip(p.displayName || p.peerId, { direction: 'top', offset: [0, -8], opacity: 0.9 });
        marker.addTo(layer);
        markers[p.peerId] = marker;
      } else {
        const from = marker.getLatLng();
        animateMarker(marker, from, target);
      }
      marker.setStyle({ color, fillColor: color });
      marker.setTooltipContent(p.displayName || p.peerId);
    });

    Object.keys(markers).forEach(pid => {
      if (!activeIds.has(pid)) {
        layer.removeLayer(markers[pid]);
        delete markers[pid];
      }
    });
  }, [peers]);

  useEffect(() => {
    if (!routeLayerRef.current) return;
    routeLayerRef.current.clearLayers();
    if (!routeTarget || !position) return;
    const end = [routeTarget.lat, routeTarget.lng];

    if (routeData && routeData.routes && routeData.routes.length) {
      const r0 = routeData.routes[0];
      const coords0 = (r0.geometry && r0.geometry.coordinates || []).map(c => [c[1], c[0]]);
      if (coords0.length) {
        routeLayerRef.current.addLayer(L.polyline(coords0, { color: 'var(--accent)', weight: 4, opacity: 0.9 }));
      }
      const r1 = routeData.routes[1];
      if (r1 && r1.geometry && r1.geometry.coordinates && r1.geometry.coordinates.length) {
        const coords1 = r1.geometry.coordinates.map(c => [c[1], c[0]]);
        routeLayerRef.current.addLayer(L.polyline(coords1, { color: 'var(--magenta)', weight: 3, opacity: 0.7, dashArray: '6 8' }));
      }
    } else {
      const start = [position.lat, position.lng];
      const directLine = L.polyline([start, end], { color: 'var(--accent)', weight: 4, opacity: 0.9 });
      const altLine = L.polyline(buildAltRoute(position, routeTarget), { color: 'var(--magenta)', weight: 3, opacity: 0.7, dashArray: '6 8' });
      routeLayerRef.current.addLayer(directLine);
      routeLayerRef.current.addLayer(altLine);
    }

    const targetMarker = L.circleMarker(end, { radius: 6, color: 'var(--amber)', weight: 2, fillColor: 'var(--amber)', fillOpacity: 0.8 });
    routeLayerRef.current.addLayer(targetMarker);
  }, [routeTarget, position, routeData]);


  function handleAddBlip() {
    if (!newBlip.title.trim()) { showToast('Give your blip a title!', 'var(--amber)'); return; }
    if (!position && newBlip.dropAtLocation) { showToast('Location not available!', 'var(--magenta)'); return; }

    const blip = {
      id: generateId('blip'),
      type: newBlip.type,
      title: newBlip.title.trim(),
      desc: newBlip.desc.trim(),
      lat: position ? position.lat : 0,
      lng: position ? position.lng : 0,
      creator: profile.peerId,
      creatorName: profile.displayName,
      timestamp: Date.now(),
      expiresAt: newBlip.expiry > 0 ? Date.now() + newBlip.expiry : null,
      boosts: 0,
      isRemote: false,
      comments: [],
    };

    setBlips(prev => [...prev, blip]);

    if (newBlip.shareWithPeers) {
      sendToAllPeers({ type: 'blip', blip });
    }

    setShowAddBlip(false);
    setNewBlip({ type: 'cool_spot', title: '', desc: '', expiry: 86400000, shareWithPeers: true, dropAtLocation: true });
    showToast('Blip dropped! ' + getCategoryIcon(getCat(blip.type, allCategories)), 'var(--neon-green)');
  }

  function handleUpdateBlip(updated) {
    setBlips(prev => prev.map(b => b.id === updated.id ? updated : b));
  }

  function handleDeleteBlip(blip) {
    if (!blip) return;
    setBlips(prev => prev.filter(b => b.id !== blip.id));
    if (blip.creator === profile.peerId) {
      sendReliableToAllPeers({ type: 'blip_delete', blipId: blip.id, creator: profile.peerId });
    }
  }

  // Find selected blip data (fresh from state)
  const selectedBlipData = selectedBlip ? blips.find(b => b.id === selectedBlip) : null;
  const hiddenCategories = settings.map.hiddenCategories || [];
  const visibleBlips = blips.filter(b => !hiddenCategories.includes(b.type));
  const sharePeers = peers.filter(p => p.shareActive && p.lastLoc);

  const routeDistances = useMemo(() => {
    if (!routeTarget || !position) return null;
    if (routeData && routeData.routes && routeData.routes.length) {
      const direct = routeData.routes[0].distance || 0;
      const alt = routeData.routes[1] ? routeData.routes[1].distance || 0 : null;
      return { direct, alt };
    }
    const direct = haversine(position.lat, position.lng, routeTarget.lat, routeTarget.lng);
    const altPath = buildAltRoute(position, routeTarget);
    const alt = haversine(altPath[0][0], altPath[0][1], altPath[1][0], altPath[1][1]) + haversine(altPath[1][0], altPath[1][1], altPath[2][0], altPath[2][1]);
    return { direct, alt };
  }, [routeTarget, position, routeData]);

  return e('div', { style: { height: '100%', position: 'relative' } },
    e('div', { ref: mapContainerRef, style: { width: '100%', height: '100%' } }),

    // Blip detail modal
    selectedBlipData && e(BlipDetailModal, {
      blip: selectedBlipData,
      onClose: () => setSelectedBlip(null),
      onUpdate: handleUpdateBlip,
      onDelete: handleDeleteBlip,
      onRoute: (blip) => {
        setRouteTarget({ lat: blip.lat, lng: blip.lng, label: blip.title });
        setRouteActive(false);
      },
      profile,
      sendToAllPeers,
      sendToPeer,
      peers,
      categories: allCategories,
    }),

    showWaypoint && e('div', {
      style: { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }
    },
      e('div', { onClick: () => setShowWaypoint(false), style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)' } }),
      e('div', {
        className: 'animate-slide-up',
        style: {
          position: 'relative', zIndex: 2, background: 'var(--bg-card)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: '16px', width: '100%', maxWidth: 520, border: '1px solid var(--border)', borderBottom: 'none',
        }
      },
        e('div', { style: { width: 40, height: 4, background: 'var(--border)', borderRadius: 2, margin: '0 auto 12px' } }),
        e('div', { style: { fontWeight: 700, fontSize: 16, color: 'var(--text-primary)', marginBottom: 6 } }, 'Set Waypoint'),
        e('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12 } }, 'Choose a target for routing.'),
        e('div', { style: { marginBottom: 12 } },
          e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 } }, 'Peers'),
          sharePeers.length === 0
            ? e('div', { style: { fontSize: 12, color: 'var(--text-secondary)', padding: '8px 0' } }, 'No shared peers yet.')
            : sharePeers.map(p => e('button', {
                key: p.peerId,
                onClick: () => { setRouteTarget({ lat: p.lastLoc.lat, lng: p.lastLoc.lng, label: p.displayName || p.peerId }); setShowWaypoint(false); },
                className: 'boost-btn',
                style: { width: '100%', textAlign: 'left', background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', marginBottom: 6, color: 'var(--text-primary)', cursor: 'pointer' }
              }, (p.displayName || p.peerId))),
        ),
        e('div', { style: { marginBottom: 12 } },
          e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 } }, 'Blips'),
          visibleBlips.length === 0
            ? e('div', { style: { fontSize: 12, color: 'var(--text-secondary)', padding: '8px 0' } }, 'No visible blips.')
            : visibleBlips.slice(0, 8).map(b => e('button', {
                key: b.id,
                onClick: () => { setRouteTarget({ lat: b.lat, lng: b.lng, label: b.title }); setShowWaypoint(false); },
                className: 'boost-btn',
                style: { width: '100%', textAlign: 'left', background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 10, padding: '8px 10px', marginBottom: 6, color: 'var(--text-primary)', cursor: 'pointer' }
              }, b.title)),
        ),
        e('div', null,
          e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 } }, 'Custom'),
          e('button', {
            onClick: () => { setShowWaypoint(false); setAwaitingMapPick(true); showToast('Tap map to set waypoint', 'var(--amber)'); },
            className: 'boost-btn',
            style: { width: '100%', textAlign: 'left', background: 'var(--bg-deep)', border: '1px dashed var(--border)', borderRadius: 10, padding: '8px 10px', color: 'var(--text-secondary)', cursor: 'pointer' }
          }, 'Pick on map')
        ),
      )
    ),

    // Recenter button
    position && e('button', {
      onClick: () => leafletMapRef.current && leafletMapRef.current.setView([position.lat, position.lng], leafletMapRef.current.getZoom()),
      className: 'boost-btn',
      style: {
        position: 'absolute', top: 12, right: 12, zIndex: 1000, width: 40, height: 40,
        borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--accent)',
        fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }
    }, '⌖'),

    // Blip count badge
    e('div', {
      style: {
        position: 'absolute', top: 12, left: 12, zIndex: 1000,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px',
        fontSize: 11, color: 'var(--text-secondary)',
      }
    }, '📍 ' + blips.length + ' blip' + (blips.length !== 1 ? 's' : '')),

    routeTarget && routeDistances && e('div', {
      style: {
        position: 'absolute', bottom: 96, left: 12, right: 12, zIndex: 1000,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 12px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
      }
    },
      e('div', null,
        e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 2 } }, 'Route to ' + (routeTarget.label || 'Waypoint')),
        routeLoading && e('div', { style: { fontSize: 10, color: 'var(--text-secondary)', marginBottom: 4 } }, 'Calculating route...'),
        e('div', { style: { fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 } }, 'Shortest: ' + distanceStr(routeDistances.direct)),
        e('div', { style: { fontSize: 11, color: 'var(--text-secondary)' } }, 'Alternative: ' + (routeDistances.alt !== null ? distanceStr(routeDistances.alt) : '--')),
      ),
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        e('button', {
          onClick: () => setRouteActive(!routeActive),
          className: 'boost-btn',
          style: { background: routeActive ? 'var(--neon-green)' : 'var(--bg-card2)', border: '1px solid ' + (routeActive ? 'var(--neon-green)' : 'var(--border)'), borderRadius: 8, padding: '6px 10px', color: routeActive ? 'var(--bg-deep)' : 'var(--text-secondary)', fontSize: 11, cursor: 'pointer', fontWeight: 600 }
        }, routeActive ? 'Stop' : 'Start'),
        e('button', {
          onClick: () => { setRouteTarget(null); setRouteActive(false); },
          className: 'boost-btn',
          style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer' }
        }, 'Clear'),
      ),
    ),

    // FAB - positioned above bottom nav
    !showAddBlip && e('button', {
      onClick: () => setShowAddBlip(true),
      className: 'boost-btn glow-green',
      style: {
        position: 'absolute', bottom: 24, right: 16, zIndex: 1000,
        width: 60, height: 60, borderRadius: '50%', background: 'var(--neon-green)', border: 'none',
        color: 'var(--bg-deep)', fontSize: 28, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: '0 4px 20px rgba(57,255,20,0.4)',
      }
    }, '+'),

    // Add Blip Modal
    showAddBlip && e('div', {
      style: { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1001, maxHeight: 'calc(85vh - var(--bottom-nav-height, 72px))' }
    },
      e('div', { onClick: () => setShowAddBlip(false), style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000 } }),
      e('div', {
        className: 'animate-slide-up',
        style: {
          position: 'relative', zIndex: 1001, background: 'var(--bg-card)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
          padding: '16px', paddingBottom: 'calc(var(--bottom-nav-height, 56px) + 12px)', border: '1px solid var(--border)', borderBottom: 'none',
        }
      },
        // Handle bar
        e('div', { style: { width: 40, height: 4, background: 'var(--border)', borderRadius: 2, margin: '0 auto 16px' } }),
        e('div', { style: { fontWeight: 700, fontSize: 18, marginBottom: 10, color: 'var(--text-primary)' } }, '📍 Drop a Blip'),

        // Category selector - scrollable
        e('div', { style: { marginBottom: 14 } },
          e('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8, fontWeight: 500 } }, 'CATEGORY'),
          e('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, maxHeight: 120, overflow: 'auto' } },
            allCategories.map(cat => e('button', {
              key: cat.id,
              onClick: () => setNewBlip(prev => ({ ...prev, type: cat.id })),
              className: 'boost-btn',
              style: {
                padding: '6px 10px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                background: newBlip.type === cat.id ? withAlpha(cat.color, '30') : 'var(--bg-deep)',
                border: '1px solid ' + (newBlip.type === cat.id ? cat.color : 'var(--border)'),
                color: newBlip.type === cat.id ? cat.color : 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', gap: 4,
              }
            }, getCategoryIcon(cat) + ' ' + cat.label))
          ),
        ),

        // Title
        e('div', { style: { marginBottom: 12 } },
          e('input', {
            value: newBlip.title, onChange: (ev) => setNewBlip(prev => ({ ...prev, title: ev.target.value })),
            placeholder: 'Blip title...',
            maxLength: 60,
            style: { width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px', color: 'var(--text-primary)', fontSize: 14 }
          }),
        ),

        // Description
        e('div', { style: { marginBottom: 12 } },
          e('textarea', {
            value: newBlip.desc, onChange: (ev) => setNewBlip(prev => ({ ...prev, desc: ev.target.value })),
            placeholder: 'Description (optional)...',
            rows: 2,
            style: { width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 10, padding: '12px', color: 'var(--text-primary)', fontSize: 13, resize: 'none' }
          }),
        ),

        // Expiry
        e('div', { style: { marginBottom: 12 } },
          e('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500 } }, 'EXPIRY'),
          e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
            EXPIRY_OPTIONS.map(opt => e('button', {
              key: opt.value,
              onClick: () => setNewBlip(prev => ({ ...prev, expiry: opt.value })),
              className: 'boost-btn',
              style: {
                padding: '6px 12px', borderRadius: 8, fontSize: 12, cursor: 'pointer',
                background: newBlip.expiry === opt.value ? 'var(--accent)20' : 'var(--bg-deep)',
                border: '1px solid ' + (newBlip.expiry === opt.value ? 'var(--accent)' : 'var(--border)'),
                color: newBlip.expiry === opt.value ? 'var(--accent)' : 'var(--text-secondary)',
              }
            }, opt.label))
          ),
        ),

        // Toggles
        e('div', { style: { display: 'flex', gap: 16, marginBottom: 16 } },
          e('label', { style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--text-secondary)', cursor: 'pointer' } },
            e('input', { type: 'checkbox', checked: newBlip.shareWithPeers, onChange: (ev) => setNewBlip(prev => ({ ...prev, shareWithPeers: ev.target.checked })) }),
            '🔗 Share with peers'
          ),
        ),

        // BOOST IT button
        e('button', {
          onClick: handleAddBlip,
          className: 'boost-btn glow-cyan',
          style: {
            width: '100%', padding: '14px', borderRadius: 12, background: 'linear-gradient(135deg, var(--accent), #00C8D9)',
            border: 'none', color: 'var(--bg-deep)', fontWeight: 700, fontSize: 16, cursor: 'pointer', letterSpacing: 2,
          }
        }, '⚡ BOOST IT'),
      )
    ),
  );
}


// ========================== GEOCHAT VIEW ==========================

function GeochatView({ position, geochatMessages, setGeochatMessages, profile, sendToAllPeers, settings }) {
  const [input, setInput] = useState('');
  const [mood, setMood] = useState('');
  const feedEndRef = useRef(null);

  const moods = ['🧘 Calm', '😊 Happy', '😂 Funny', '🔥 Hype', '🚨 Alert', '🤔 Curious', '🎯 Focused', '🫶 Social'];

  const zoneRadius = settings.geochat.zoneRadius || 1000;
  const zoneName = position ? getZoneName(position.lat, position.lng, zoneRadius) : 'Unknown Zone';
  const zoneKey = position ? getZoneKey(position.lat, position.lng, zoneRadius) : '';

  // FIXED: More permissive filtering - show messages from same zone OR within radius
  const filteredMessages = geochatMessages.filter(m => {
    // Always show own messages
    if (m.sender === (settings.geochat.anonymous ? 'Anon' : profile.displayName) || m.senderId === profile.peerId) return true;
    // Show if in same zone
    if (m.zone === zoneKey) return true;
    // Show if within radius by distance
    if (position && m.lat && m.lng) {
      return haversine(position.lat, position.lng, m.lat, m.lng) <= zoneRadius * 2; // 2x radius for tolerance
    }
    return false;
  });

  useEffect(() => {
    if (feedEndRef.current) feedEndRef.current.scrollIntoView({ behavior: 'smooth' });
  }, [filteredMessages.length]);

  function handlePost(isShout = false) {
    const text = input.trim();
    if (!text) return;
    if (!position) { showToast('Location required for Geochat', 'var(--amber)'); return; }

    const msg = {
      id: generateId('gc'),
      text,
      message: text, // Include both for compat
      sender: settings.geochat.anonymous ? 'Anon' : profile.displayName,
      senderId: profile.peerId,
      zone: zoneKey,
      timestamp: Date.now(),
      mood: mood || null,
      isShout,
      lat: position.lat,
      lng: position.lng,
    };

    setGeochatMessages(prev => [...prev, msg]);
    // FIX: Send with both 'text' and 'message' fields for backwards compat
    sendToAllPeers({ type: 'geochat', ...msg });
    setInput('');
    setMood('');
    if (isShout) showToast('Broadcast sent', 'var(--amber)');
  }

  if (!settings.geochat.enabled) {
    return e('div', { style: { height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 30, textAlign: 'center' } },
      e('div', { style: { fontSize: 32, marginBottom: 16, color: 'var(--text-secondary)', letterSpacing: 2 } }, 'GEOCHAT'),
      e('div', { style: { fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 } }, 'Geochat is Off'),
      e('div', { style: { fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20, maxWidth: 280 } }, 'Enable Geochat in Settings to see public messages from people near you.'),
      e('div', { style: { fontSize: 11, color: 'var(--text-secondary)' } }, 'Go to Settings → Geochat'),
    );
  }

  return e('div', { style: { height: '100%', display: 'flex', flexDirection: 'column' } },
    // Zone header
    e('div', { style: { padding: '10px 16px', borderBottom: '1px solid var(--border)', background: 'var(--glass)', flexShrink: 0 } },
      e('div', { style: { display: 'flex', alignItems: 'center', gap: 8 } },
        e('div', { style: { fontSize: 10, letterSpacing: 1.5, textTransform: 'uppercase', color: 'var(--text-secondary)', padding: '2px 6px', borderRadius: 6, border: '1px solid var(--border)' } }, 'Zone'),
        e('span', { style: { fontWeight: 700, fontSize: 15, color: 'var(--text-primary)' } }, zoneName),
      ),
      e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 } }, 'Radius: ' + (zoneRadius >= 1000 ? (zoneRadius / 1000) + 'km' : zoneRadius + 'm') + ' · ' + filteredMessages.length + ' messages'),
    ),

    // Feed
    e('div', { style: { flex: 1, overflow: 'auto', padding: '8px 16px' } },
      filteredMessages.length === 0 && e('div', { style: { textAlign: 'center', padding: 40, color: 'var(--text-secondary)' } },
        e('div', { style: { fontSize: 12, letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 8 } }, 'No Activity'),
        e('div', { style: { fontSize: 13 } }, 'No messages in this zone yet. Be the first!'),
      ),
      filteredMessages.map(msg => {
        const dist = position && msg.lat ? haversine(position.lat, position.lng, msg.lat, msg.lng) : null;
        const distColor = dist !== null ? (dist < 200 ? 'var(--neon-green)' : dist < 500 ? 'var(--amber)' : 'var(--magenta)') : 'var(--border)';
        const isOwn = msg.senderId === profile.peerId;

        return e('div', {
          key: msg.id,
          style: {
            background: isOwn ? 'var(--accent)08' : 'var(--bg-card)', borderRadius: 10, padding: msg.isShout ? '14px' : '10px 12px', marginBottom: 6,
            borderLeft: '3px solid ' + (isOwn ? 'var(--accent)' : distColor),
            fontSize: msg.isShout ? 16 : 14, fontWeight: msg.isShout ? 700 : 400,
          }
        },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 } },
            e('span', { style: { fontSize: 11, color: isOwn ? 'var(--accent)' : 'var(--text-secondary)', fontWeight: 600 } }, msg.sender + (isOwn ? ' (you)' : '')),
            e('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
              dist !== null && !isOwn && e('span', { style: { fontSize: 10, color: distColor } }, distanceStr(dist)),
              e('span', { style: { fontSize: 10, color: 'var(--text-secondary)' } }, timeAgo(msg.timestamp)),
            ),
          ),
          e('div', { style: { color: 'var(--text-primary)', lineHeight: 1.5 } },
            msg.mood && e('span', { style: { marginRight: 6, fontSize: 10, padding: '2px 6px', borderRadius: 999, border: '1px solid var(--border)', color: 'var(--text-secondary)' } }, msg.mood),
            msg.text,
          ),
        );
      }),
      e('div', { ref: feedEndRef }),
    ),

    // Input
    e('div', { style: { padding: '8px 16px', borderTop: '1px solid var(--border)', background: 'var(--glass-strong)', flexShrink: 0 } },
      // Mood selector
      e('div', { style: { display: 'flex', gap: 4, marginBottom: 6, overflowX: 'auto', paddingBottom: 2 } },
        moods.map(m => e('button', {
          key: m,
          onClick: () => setMood(mood === m ? '' : m),
          style: {
            fontSize: 11, background: mood === m ? 'var(--bg-card2)' : 'transparent', border: mood === m ? '1px solid var(--border)' : '1px solid transparent',
            borderRadius: 999, padding: '4px 8px', cursor: 'pointer', flexShrink: 0, opacity: mood === m ? 1 : 0.6,
          }
        }, m))
      ),
      e('div', { style: { display: 'flex', gap: 8 } },
        e('input', {
          value: input, onChange: (ev) => setInput(ev.target.value),
          onKeyDown: (ev) => ev.key === 'Enter' && handlePost(false),
          placeholder: 'Write a message...',
          style: { flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '10px 14px', color: 'var(--text-primary)', fontSize: 14 }
        }),
        e('button', {
          onClick: () => handlePost(false),
          className: 'boost-btn',
          style: { background: 'var(--accent)', color: 'var(--bg-deep)', border: 'none', borderRadius: 10, padding: '10px 12px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }
        }, 'Post'),
        e('button', {
          onClick: () => handlePost(true),
          className: 'boost-btn',
          style: { background: 'transparent', color: 'var(--amber)', border: '1px solid var(--amber)', borderRadius: 10, padding: '10px 10px', fontWeight: 700, fontSize: 12, cursor: 'pointer' }
        }, 'Broadcast'),
      ),
    ),
  );
}

// ========================== SETTINGS VIEW ==========================

function SettingsView({ profile, setProfile, settings, setSettings, initPeer, blips, setBlips, messages, setMessages, geochatMessages, setGeochatMessages, peers, setPeers, categories, runDailyBackup }) {
  const [section, setSection] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [newBlipType, setNewBlipType] = useState({ label: '', icon: '', color: 'var(--accent)' });
  const customBlipTypes = settings.customBlipTypes || [];
  const colorOptions = [
    { label: 'None (Use Theme Accent)', value: '' },
    { label: 'Neon Green', value: '#39FF14' },
    { label: 'Ocean Blue', value: '#4A90FF' },
    { label: 'Cyan', value: '#00F0FF' },
    { label: 'Amber', value: '#FFB800' },
    { label: 'Magenta', value: '#FF2D78' },
    { label: 'Purple', value: '#A855F7' },
    { label: 'Orange', value: '#FF6B35' },
    { label: 'Ruby Red', value: '#FF0000' },
    { label: 'Slate', value: '#94A3B8' },
  ];
  const themeOptions = [
    { id: 'onyx', label: 'Onyx', swatches: ['#05070c', '#101622', '#78c5ff'] },
    { id: 'paper', label: 'Paper', swatches: ['#f7f8fb', '#ffffff', '#2a5bd7'] },
    { id: 'dusk', label: 'Dusk', swatches: ['#1b1428', '#2a2140', '#b58cff'] },
    { id: 'neon', label: 'Neon', swatches: ['#070a12', '#182236', '#00f0ff'] },
    { id: 'pastel', label: 'Pastel', swatches: ['#f7f3f6', '#ffffff', '#7b9cff'] },
    { id: 'sunset', label: 'Sunset', swatches: ['#1b1216', '#2d2224', '#ff8a3d'] },
    { id: 'ocean', label: 'Ocean', swatches: ['#0c1b22', '#1a2f39', '#2dd4bf'] },
    { id: 'rose', label: 'Rose', swatches: ['#1b1218', '#2b2029', '#ff7a9e'] },
    { id: 'matcha', label: 'Matcha', swatches: ['#17221b', '#223028', '#7bd389'] },
    { id: 'lavender', label: 'Lavender', swatches: ['#1b162a', '#2b2341', '#c2a0ff'] },
    { id: 'desert', label: 'Desert', swatches: ['#f6efe5', '#fff7ee', '#c16a2f'] },
    { id: 'ivory', label: 'Ivory', swatches: ['#f7f6f2', '#ffffff', '#1e4bd6'] },
    { id: 'mono', label: 'Mono', swatches: ['#0d0f12', '#1f242c', '#cfd5dd'] },
  ];

  function updateSettings(path, value) {
    setSettings(prev => {
      const next = { ...prev };
      const keys = path.split('.');
      let obj = next;
      for (let i = 0; i < keys.length - 1; i++) {
        obj[keys[i]] = { ...obj[keys[i]] };
        obj = obj[keys[i]];
      }
      obj[keys[keys.length - 1]] = value;
      return next;
    });
  }

  function handleShareVia(method) {
    const peerId = profile.peerId;
    const shareText = 'Connect with me on BOOST! My Peer ID: ' + peerId;
    const shareUrl = window.location.origin + '?connect=' + peerId;
    if (method === 'native' && navigator.share) {
      navigator.share({ title: 'BOOST Peer ID', text: shareText, url: shareUrl }).catch(() => {});
    } else if (method === 'copy') {
      navigator.clipboard.writeText(peerId);
      showToast('Peer ID copied!');
    }
  }

  function importBackupData(imported) {
    if (!imported || typeof imported !== 'object') throw new Error('Invalid');
    if (imported.profile) {
      setProfile(p => ({
        ...p,
        displayName: imported.profile.displayName || p.displayName,
        avatar: imported.profile.avatar || p.avatar,
        createdAt: imported.profile.createdAt || p.createdAt,
      }));
    }
    if (imported.settings) {
      setSettings(prev => ({
        ...prev,
        ...imported.settings,
        peerServer: { ...DEFAULT_SETTINGS.peerServer, ...(imported.settings.peerServer || {}) },
        iceServers: { ...DEFAULT_SETTINGS.iceServers, ...(imported.settings.iceServers || {}) },
        geochat: { ...DEFAULT_SETTINGS.geochat, ...(imported.settings.geochat || {}) },
        map: { ...DEFAULT_SETTINGS.map, ...(imported.settings.map || {}) },
        ui: { ...DEFAULT_SETTINGS.ui, ...(imported.settings.ui || {}) },
        push: { ...DEFAULT_SETTINGS.push, ...(imported.settings.push || {}) },
        backup: { ...DEFAULT_SETTINGS.backup, ...(imported.settings.backup || {}) },
        customBlipTypes: imported.settings.customBlipTypes || prev.customBlipTypes || [],
      }));
    }
    if (Array.isArray(imported.peers)) {
      setPeers(prev => {
        const map = new Map(prev.map(p => [p.peerId, p]));
        imported.peers.forEach(p => {
          if (!p || !p.peerId) return;
          map.set(p.peerId, { ...(map.get(p.peerId) || {}), ...p });
        });
        return Array.from(map.values());
      });
    }
    if (Array.isArray(imported.blips)) {
      setBlips(prev => {
        const map = new Map(prev.map(b => [b.id, b]));
        imported.blips.forEach(b => {
          if (!b || !b.id) return;
          map.set(b.id, map.get(b.id) || b);
        });
        return Array.from(map.values());
      });
    }
    if (imported.messages && typeof imported.messages === 'object') {
      setMessages(prev => {
        const next = { ...prev };
        Object.keys(imported.messages).forEach(pid => {
          const prevMsgs = next[pid] || [];
          const incoming = imported.messages[pid] || [];
          const seen = new Set(prevMsgs.map(m => m.id));
          const merged = [...prevMsgs];
          incoming.forEach(m => {
            if (!m || !m.id) return;
            if (!seen.has(m.id)) {
              seen.add(m.id);
              merged.push(m);
            }
          });
          next[pid] = merged;
        });
        return next;
      });
    }
    if (Array.isArray(imported.geochatMessages)) {
      setGeochatMessages(prev => {
        const map = new Map(prev.map(m => [m.id, m]));
        imported.geochatMessages.forEach(m => {
          if (!m || !m.id) return;
          map.set(m.id, map.get(m.id) || m);
        });
        return Array.from(map.values());
      });
    }
  }

  async function chooseBackupFolder() {
    if (!window.showDirectoryPicker) {
      showToast('Folder access not supported', 'var(--magenta)');
      return;
    }
    try {
      const handle = await window.showDirectoryPicker();
      await idbSet('backupDir', handle);
      showToast('Backup folder set', 'var(--neon-green)');
    } catch {}
  }

  async function restoreFromFolder() {
    if (!window.showDirectoryPicker) {
      const fallback = readBackupFallback();
      if (!fallback) return showToast('No in-app backup found', 'var(--magenta)');
      try {
        importBackupData(fallback);
        showToast('Backup restored', 'var(--neon-green)');
      } catch {
        showToast('Invalid in-app backup', 'var(--magenta)');
      }
      return;
    }
    const root = await getBackupDirHandle();
    if (!root) {
      showToast('Backup folder not set', 'var(--amber)');
      return;
    }
    try {
      const subdir = await root.getDirectoryHandle('boost', { create: false });
      const name = settings.backup && settings.backup.name ? settings.backup.name : (profile.displayName || profile.peerId || 'user');
      const safeName = sanitizeFilename(name);
      const fileHandle = await subdir.getFileHandle(`boost-backup(${safeName}).json`);
      const file = await fileHandle.getFile();
      const text = await file.text();
      const imported = JSON.parse(text);
      importBackupData(imported);
      showToast('Backup restored', 'var(--neon-green)');
    } catch {
      showToast('Backup not found in folder', 'var(--magenta)');
    }
  }

  async function registerPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      showToast('Push not supported on this device', 'var(--magenta)');
      return;
    }
    if (!settings.push.serverUrl || !settings.push.vapidPublicKey) {
      showToast('Add server URL + VAPID key first', 'var(--amber)');
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      showToast('Notification permission denied', 'var(--magenta)');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(settings.push.vapidPublicKey),
      });
      const serverUrl = settings.push.serverUrl.replace(/\/$/, '');
      await fetch(serverUrl + '/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ peerId: profile.peerId, subscription: sub }),
      });
      showToast('Push enabled', 'var(--neon-green)');
    } catch {
      showToast('Push registration failed', 'var(--magenta)');
    }
  }

  async function unregisterPush() {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      showToast('Push not supported on this device', 'var(--magenta)');
      return;
    }
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) await sub.unsubscribe();
      if (settings.push.serverUrl) {
        const serverUrl = settings.push.serverUrl.replace(/\/$/, '');
        await fetch(serverUrl + '/unsubscribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ peerId: profile.peerId }),
        });
      }
      showToast('Push disabled', 'var(--amber)');
    } catch {
      showToast('Push unregister failed', 'var(--magenta)');
    }
  }

  const sectionStyle = { background: 'var(--bg-card)', borderRadius: 12, padding: '16px', marginBottom: 12, border: '1px solid var(--border)' };
  const labelStyle = { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 6, fontWeight: 500, textTransform: 'uppercase', letterSpacing: 1 };
  const inputStyle = { width: '100%', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', color: 'var(--text-primary)', fontSize: 13, marginBottom: 10 };
  const toggleRowStyle = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 0', borderBottom: '1px solid var(--border)20' };

  return e('div', { style: { height: '100%', overflow: 'auto', padding: '16px' } },
    // Profile
    e('div', { style: sectionStyle },
      e('div', { style: { ...labelStyle, fontSize: 14, marginBottom: 12 } }, '👤 Profile'),
      e('div', { style: { display: 'flex', gap: 12, alignItems: 'center', marginBottom: 12 } },
        e('div', { style: { width: 50, height: 50, borderRadius: '50%', background: 'var(--bg-card2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, border: '2px solid var(--accent)' } }, profile.avatar),
        e('div', { style: { flex: 1 } },
          e('input', { value: profile.displayName, onChange: (ev) => setProfile(p => ({ ...p, displayName: ev.target.value })), placeholder: 'Display name', style: { ...inputStyle, marginBottom: 4 } }),
          e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', fontFamily: "'JetBrains Mono', monospace" } }, 'ID: ' + profile.peerId),
        ),
      ),
      e('div', { style: { display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 12 } },
        ['⚡', '🔥', '💀', '👾', '🎮', '🌙', '🚀', '💎', '🎯', '🐉', '🦊', '🤖', '😎', '😊', '🧠', '🦉', '🐯', '🐼', '🦈', '🦁', '🦄'].map(av => e('button', {
          key: av, onClick: () => setProfile(p => ({ ...p, avatar: av })),
          style: { fontSize: 22, padding: '4px 8px', background: profile.avatar === av ? 'var(--bg-card2)' : 'transparent', border: profile.avatar === av ? '1px solid var(--accent)' : '1px solid transparent', borderRadius: 8, cursor: 'pointer' }
        }, av))
      ),
      // QR & Share section
      e('div', { style: { borderTop: '1px solid var(--border)', paddingTop: 12 } },
        e('div', { style: { ...labelStyle, marginBottom: 8 } }, 'SHARE YOUR ID'),
        !showQR
          ? e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              e('button', { onClick: () => setShowQR(true), className: 'boost-btn', style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: '#A855F7', fontSize: 12, cursor: 'pointer' } }, '📷 Show QR'),
              e('button', { onClick: () => handleShareVia('copy'), className: 'boost-btn', style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' } }, '📋 Copy ID'),
              navigator.share && e('button', { onClick: () => handleShareVia('native'), className: 'boost-btn', style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--neon-green)', fontSize: 12, cursor: 'pointer' } }, '🔗 Share'),
            )
          : e('div', { style: { textAlign: 'center' } },
              e('div', { style: { background: '#fff', borderRadius: 12, padding: 12, display: 'inline-block', marginBottom: 8 } },
                e(QRCodeDisplay, { text: profile.peerId, size: 160 }),
              ),
              e('div', { style: { fontSize: 12, color: 'var(--accent)', fontFamily: "'JetBrains Mono', monospace", marginBottom: 8 } }, profile.peerId),
              e('button', { onClick: () => setShowQR(false), className: 'boost-btn', style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 14px', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer' } }, 'Hide QR'),
            ),
      ),
    ),

    // Appearance
    e('div', { style: sectionStyle },
      e('div', { style: { ...labelStyle, fontSize: 14, marginBottom: 12 } }, 'Appearance'),
      e('div', { style: { display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6 } },
        themeOptions.map(t => e('button', {
          key: t.id,
          onClick: () => updateSettings('ui.theme', t.id),
          className: 'boost-btn',
          style: {
            minWidth: 92, padding: '8px 10px', borderRadius: 999,
            background: (settings.ui && settings.ui.theme) === t.id ? 'var(--bg-card2)' : 'var(--bg-deep)',
            border: '1px solid ' + ((settings.ui && settings.ui.theme) === t.id ? 'var(--accent)' : 'var(--border)'),
            color: (settings.ui && settings.ui.theme) === t.id ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: 11, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize', whiteSpace: 'nowrap',
            display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'space-between', overflow: 'hidden'
          }
        },
          e('span', null, t.label),
          e('span', { style: { display: 'flex', gap: 4, flexShrink: 0 } },
            t.swatches.map((c, i) => e('span', {
              key: i,
              style: { width: 10, height: 10, borderRadius: '50%', background: c, border: '1px solid rgba(0,0,0,0.15)' }
            }))
          )
        ))
      ),
      e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 } }, 'Swipe to see more themes'),
    ),

    // Custom Blip Types
    e('div', { style: sectionStyle },
      e('div', { style: { ...labelStyle, fontSize: 14, marginBottom: 12 } }, 'Blip Types'),
      e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 10 } }, 'Add your own categories for blips.'),
      customBlipTypes.length === 0 && e('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 10 } }, 'No custom types yet.'),
      customBlipTypes.map((t, idx) => e('div', {
        key: t.id || idx,
        style: { display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', background: 'var(--bg-deep)', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8 }
      },
        e('div', {
          style: { width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid ' + (t.color || 'var(--border)'), color: t.color || 'var(--text-secondary)' }
        }, getCategoryIcon(t)),
        e('div', { style: { flex: 1 } },
          e('div', { style: { fontSize: 13, color: 'var(--text-primary)', fontWeight: 600 } }, t.label || t.id),
          e('div', { style: { fontSize: 11, color: 'var(--text-secondary)' } }, t.id)
        ),
        e('button', {
          onClick: () => updateSettings('customBlipTypes', customBlipTypes.filter((_, i) => i !== idx)),
          className: 'boost-btn',
          style: { background: 'none', border: 'none', color: 'var(--magenta)', fontSize: 16, cursor: 'pointer' }
        }, '✕'),
      )),
      e('div', { style: { display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 8, marginBottom: 8 } },
        e('input', {
          value: newBlipType.label,
          onChange: (ev) => setNewBlipType(prev => ({ ...prev, label: ev.target.value })),
          placeholder: 'Type name (e.g. Roadwork)',
          style: { ...inputStyle, marginBottom: 0 }
        }),
        e('input', {
          value: newBlipType.icon,
          onChange: (ev) => setNewBlipType(prev => ({ ...prev, icon: ev.target.value })),
          placeholder: 'Icon (optional)',
          style: { ...inputStyle, marginBottom: 0, textAlign: 'center' }
        }),
      ),
      e('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 } },
        e('select', {
          value: newBlipType.color || '',
          onChange: (ev) => setNewBlipType(prev => ({ ...prev, color: ev.target.value })),
          style: { ...inputStyle, marginBottom: 0 }
        },
          colorOptions.map(opt => e('option', { key: opt.label, value: opt.value }, opt.label))
        ),
        e('button', {
          onClick: () => {
            const label = newBlipType.label.trim();
            if (!label) return showToast('Type name required', 'var(--amber)');
            const id = slugify(label);
            const exists = customBlipTypes.some(t => t.id === id) || BLIP_CATEGORIES.some(t => t.id === id);
            if (exists) return showToast('Type already exists', 'var(--amber)');
            const next = [...customBlipTypes, { id, label, icon: newBlipType.icon.trim(), color: newBlipType.color.trim() || 'var(--accent)', isCustom: true }];
            updateSettings('customBlipTypes', next);
            setNewBlipType({ label: '', icon: '', color: 'var(--accent)' });
            showToast('Custom type added', 'var(--neon-green)');
          },
          className: 'boost-btn',
          style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px', color: 'var(--accent)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }
        }, 'Add Type'),
      ),
    ),

    // PeerJS Server
    e('div', { style: sectionStyle },
      e('div', { style: { ...labelStyle, fontSize: 14, marginBottom: 12 } }, '🛰️ PeerJS Server'),
      e('div', { style: toggleRowStyle },
        e('span', { style: { fontSize: 13, color: 'var(--text-primary)' } }, 'Use Default Cloud'),
        e('input', {
          type: 'checkbox', checked: settings.peerServer.useDefault,
          onChange: (ev) => updateSettings('peerServer.useDefault', ev.target.checked),
        }),
      ),
      !settings.peerServer.useDefault && e('div', { style: { marginTop: 10 } },
        e('div', { style: labelStyle }, 'HOST'),
        e('input', { value: settings.peerServer.host, onChange: (ev) => updateSettings('peerServer.host', ev.target.value), placeholder: 'peerjs-server.example.com', style: inputStyle }),
        e('div', { style: { display: 'flex', gap: 8 } },
          e('div', { style: { flex: 1 } },
            e('div', { style: labelStyle }, 'PORT'),
            e('input', { value: settings.peerServer.port, onChange: (ev) => updateSettings('peerServer.port', parseInt(ev.target.value) || 0), type: 'number', style: inputStyle }),
          ),
          e('div', { style: { flex: 1 } },
            e('div', { style: labelStyle }, 'PATH'),
            e('input', { value: settings.peerServer.path, onChange: (ev) => updateSettings('peerServer.path', ev.target.value), style: inputStyle }),
          ),
        ),
        e('div', { style: labelStyle }, 'API KEY (OPTIONAL)'),
        e('input', { value: settings.peerServer.key, onChange: (ev) => updateSettings('peerServer.key', ev.target.value), placeholder: 'API key...', style: inputStyle }),
        e('div', { style: toggleRowStyle },
          e('span', { style: { fontSize: 13, color: 'var(--text-primary)' } }, 'Secure (HTTPS)'),
          e('input', { type: 'checkbox', checked: settings.peerServer.secure, onChange: (ev) => updateSettings('peerServer.secure', ev.target.checked) }),
        ),
      ),
      e('button', {
        onClick: () => { initPeer(); showToast('Reconnecting...', 'var(--amber)'); },
        className: 'boost-btn',
        style: { width: '100%', padding: '10px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--accent)', fontWeight: 600, fontSize: 13, cursor: 'pointer', marginTop: 8 }
      }, '⚡ Reconnect'),
    ),

    // Push Notifications
    e('div', { style: sectionStyle },
      e('div', { style: { ...labelStyle, fontSize: 14, marginBottom: 12 } }, 'Push Notifications'),
      e('div', { style: toggleRowStyle },
        e('span', { style: { fontSize: 13, color: 'var(--text-primary)' } }, 'Enable Push for Buzz'),
        e('input', {
          type: 'checkbox', checked: !!(settings.push && settings.push.enabled),
          onChange: (ev) => updateSettings('push.enabled', ev.target.checked),
        }),
      ),
      e('div', { style: labelStyle }, 'RELAY SERVER URL'),
      e('input', {
        value: (settings.push && settings.push.serverUrl) || '',
        onChange: (ev) => updateSettings('push.serverUrl', ev.target.value),
        placeholder: 'https://your-relay.example.com',
        style: inputStyle,
      }),
      e('div', { style: labelStyle }, 'VAPID PUBLIC KEY'),
      e('input', {
        value: (settings.push && settings.push.vapidPublicKey) || '',
        onChange: (ev) => updateSettings('push.vapidPublicKey', ev.target.value),
        placeholder: 'BOPd...your key...',
        style: inputStyle,
      }),
      e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        e('button', {
          onClick: registerPush,
          className: 'boost-btn',
          style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--neon-green)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
        }, 'Register Device'),
        e('button', {
          onClick: unregisterPush,
          className: 'boost-btn',
          style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--amber)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
        }, 'Unregister'),
      ),
      e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 } }, 'Optional relay for buzz when peers are offline.'),
    ),

    // ICE Servers
    e('div', { style: sectionStyle },
      e('div', { style: { ...labelStyle, fontSize: 14, marginBottom: 12 } }, '🧊 ICE / TURN Servers'),
      e('div', { style: toggleRowStyle },
        e('span', { style: { fontSize: 13, color: 'var(--text-primary)' } }, 'Custom ICE Config'),
        e('input', {
          type: 'checkbox', checked: settings.iceServers.enabled,
          onChange: (ev) => updateSettings('iceServers.enabled', ev.target.checked),
        }),
      ),
      settings.iceServers.enabled && e('div', { style: { marginTop: 10 } },
        (settings.iceServers.servers || []).map((server, i) => e('div', {
          key: i, style: { background: 'var(--bg-deep)', padding: 10, borderRadius: 8, marginBottom: 6, border: '1px solid var(--border)' }
        },
          e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 } },
            e('span', { style: { fontSize: 11, color: 'var(--accent)' } }, 'Server ' + (i + 1)),
            e('button', {
              onClick: () => updateSettings('iceServers.servers', settings.iceServers.servers.filter((_, j) => j !== i)),
              style: { background: 'none', border: 'none', color: 'var(--magenta)', cursor: 'pointer', fontSize: 16 }
            }, '✕'),
          ),
          e('input', {
            value: server.url, placeholder: 'stun:stun.l.google.com:19302',
            onChange: (ev) => { const s = [...settings.iceServers.servers]; s[i] = { ...s[i], url: ev.target.value }; updateSettings('iceServers.servers', s); },
            style: { ...inputStyle, marginBottom: 4 }
          }),
          e('div', { style: { display: 'flex', gap: 4 } },
            e('input', {
              value: server.username || '', placeholder: 'Username',
              onChange: (ev) => { const s = [...settings.iceServers.servers]; s[i] = { ...s[i], username: ev.target.value }; updateSettings('iceServers.servers', s); },
              style: { ...inputStyle, flex: 1, marginBottom: 0 }
            }),
            e('input', {
              value: server.credential || '', placeholder: 'Credential',
              onChange: (ev) => { const s = [...settings.iceServers.servers]; s[i] = { ...s[i], credential: ev.target.value }; updateSettings('iceServers.servers', s); },
              style: { ...inputStyle, flex: 1, marginBottom: 0 }
            }),
          ),
        )),
        e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
          e('button', {
            onClick: () => updateSettings('iceServers.servers', [...(settings.iceServers.servers || []), { url: '', username: '', credential: '' }]),
            className: 'boost-btn', style: { padding: '8px 12px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }
          }, '+ Add Server'),
          e('button', {
            onClick: () => updateSettings('iceServers.servers', [...(settings.iceServers.servers || []), { url: 'stun:stun.l.google.com:19302', username: '', credential: '' }]),
            className: 'boost-btn', style: { padding: '8px 12px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--neon-green)', fontSize: 12, cursor: 'pointer' }
          }, '+ Google STUN'),
        ),
      ),
    ),

    // Geochat Settings
    e('div', { style: sectionStyle },
      e('div', { style: { ...labelStyle, fontSize: 14, marginBottom: 12 } }, '📡 Geochat'),
      e('div', { style: toggleRowStyle },
        e('span', { style: { fontSize: 13, color: 'var(--text-primary)' } }, 'Enable Geochat'),
        e('input', { type: 'checkbox', checked: settings.geochat.enabled, onChange: (ev) => updateSettings('geochat.enabled', ev.target.checked) }),
      ),
      e('div', { style: toggleRowStyle },
        e('span', { style: { fontSize: 13, color: 'var(--text-primary)' } }, 'Anonymous Mode'),
        e('input', { type: 'checkbox', checked: settings.geochat.anonymous, onChange: (ev) => updateSettings('geochat.anonymous', ev.target.checked) }),
      ),
      e('div', { style: { marginTop: 8 } },
        e('div', { style: labelStyle }, 'ZONE RADIUS: ' + (settings.geochat.zoneRadius >= 1000 ? (settings.geochat.zoneRadius / 1000) + 'km' : settings.geochat.zoneRadius + 'm')),
        e('input', {
          type: 'range', min: 500, max: 5000, step: 500, value: settings.geochat.zoneRadius,
          onChange: (ev) => updateSettings('geochat.zoneRadius', parseInt(ev.target.value)),
          style: { width: '100%', accentColor: 'var(--accent)' }
        }),
      ),
    ),

    // Map Settings
    e('div', { style: sectionStyle },
      e('div', { style: { ...labelStyle, fontSize: 14, marginBottom: 12 } }, '🗺️ Map'),
      e('div', { style: { marginTop: 4 } },
        e('div', { style: labelStyle }, 'DEFAULT ZOOM: ' + (settings.map.defaultZoom || 14)),
        e('input', {
          type: 'range', min: 8, max: 18, step: 1, value: settings.map.defaultZoom || 14,
          onChange: (ev) => updateSettings('map.defaultZoom', parseInt(ev.target.value)),
          style: { width: '100%', accentColor: 'var(--accent)' }
        }),
      ),
    ),

    // Data Management
    e('div', { style: sectionStyle },
      e('div', { style: { ...labelStyle, fontSize: 14, marginBottom: 12 } }, '💾 Data Management'),
      e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        e('button', {
          onClick: () => {
            const data = JSON.stringify({
              version: 1,
              profile: { displayName: profile.displayName, avatar: profile.avatar, createdAt: profile.createdAt },
              settings,
              peers,
              messages,
              blips,
              geochatMessages,
            }, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            if (navigator.msSaveOrOpenBlob) {
              navigator.msSaveOrOpenBlob(blob, 'boost-backup.json');
              showToast('Backup exported', 'var(--neon-green)');
              return;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'boost-backup.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
            showToast('Backup exported', 'var(--neon-green)');
          },
          className: 'boost-btn', style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--neon-green)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
        }, 'Export All'),
        e('button', {
          onClick: () => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.json';
            input.onchange = (ev) => {
              const file = ev.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (e) => {
                try {
                  const imported = JSON.parse(e.target.result);
                  if (!confirm('Import backup and merge data?')) return;
                  importBackupData(imported);
                  showToast('Backup imported', 'var(--neon-green)');
                } catch { showToast('Invalid backup file', 'var(--magenta)'); }
              };
              reader.readAsText(file);
            };
            input.click();
          },
          className: 'boost-btn', style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--amber)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
        }, 'Import All'),
        e('button', {
          onClick: () => {
            const data = JSON.stringify(blips, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'boost-blips.json'; a.click();
            URL.revokeObjectURL(url);
            showToast('Blips exported!', 'var(--neon-green)');
          },
          className: 'boost-btn', style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontWeight: 500 }
        }, '⬇️ Export Blips'),
        e('button', {
          onClick: () => {
            const input = document.createElement('input');
            input.type = 'file'; input.accept = '.json';
            input.onchange = (ev) => {
              const file = ev.target.files[0];
              if (!file) return;
              const reader = new FileReader();
              reader.onload = (e) => {
                try {
                  const imported = JSON.parse(e.target.result);
                  if (Array.isArray(imported)) {
                    setBlips(prev => [...prev, ...imported]);
                    showToast('Imported ' + imported.length + ' blips!', 'var(--neon-green)');
                  }
                } catch { showToast('Invalid JSON file', 'var(--magenta)'); }
              };
              reader.readAsText(file);
            };
            input.click();
          },
          className: 'boost-btn', style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--amber)', fontSize: 12, cursor: 'pointer', fontWeight: 500 }
        }, '⬆️ Import Blips'),
        e('button', {
          onClick: () => {
            if (confirm('Clear ALL data? This cannot be undone.')) {
              localStorage.clear();
              window.location.reload();
            }
          },
          className: 'boost-btn', style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--magenta)', color: 'var(--magenta)', fontSize: 12, cursor: 'pointer', fontWeight: 500 }
        }, '🧹 Clear All Data'),
      ),
    ),

    // Backups
    e('div', { style: sectionStyle },
      e('div', { style: { ...labelStyle, fontSize: 14, marginBottom: 12 } }, 'Backups'),
      e('div', { style: toggleRowStyle },
        e('span', { style: { fontSize: 13, color: 'var(--text-primary)' } }, 'Daily Backup'),
        e('input', {
          type: 'checkbox',
          checked: !!(settings.backup && settings.backup.enabled),
          onChange: (ev) => updateSettings('backup.enabled', ev.target.checked),
        }),
      ),
      e('div', { style: labelStyle }, 'BACKUP NAME'),
      e('input', {
        value: (settings.backup && settings.backup.name) || '',
        onChange: (ev) => updateSettings('backup.name', ev.target.value),
        placeholder: profile.displayName || profile.peerId || 'user',
        style: inputStyle,
      }),
      e('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap' } },
        e('button', {
          onClick: chooseBackupFolder,
          className: 'boost-btn',
          style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
        }, 'Choose Folder'),
        e('button', {
          onClick: () => runDailyBackup(true, true),
          className: 'boost-btn',
          style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--neon-green)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
        }, 'Backup Now'),
        e('button', {
          onClick: restoreFromFolder,
          className: 'boost-btn',
          style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--amber)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
        }, window.showDirectoryPicker ? 'Restore From Folder' : 'Restore In-App Backup'),
        e('button', {
          onClick: () => {
            const fallback = readBackupFallback();
            if (!fallback) return showToast('No in-app backup found', 'var(--magenta)');
            const data = JSON.stringify(fallback, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'boost-backup.json';
            document.body.appendChild(a);
            a.click();
            setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
            showToast('Backup exported', 'var(--neon-green)');
          },
          className: 'boost-btn',
          style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontWeight: 600 }
        }, 'Export In-App Backup'),
      ),
      !window.showDirectoryPicker && e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 } }, 'This browser cannot save to folders. Backups are stored in-app and will be removed if you clear site data.'),
      window.showDirectoryPicker && e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginTop: 6 } }, 'Saves to: selected folder / boost / boost-backup(name).json'),
    ),

    // About
    e('div', { style: { ...sectionStyle, textAlign: 'center' } },
      e('div', { style: { fontSize: 24, fontWeight: 700, color: 'var(--accent)', letterSpacing: 4, marginBottom: 4 } }, '⚡ BOOST'),
      e('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 } }, 'v1.1.0 - P2P Social Map & Chat'),
      e('div', { style: { fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 } }, 'Built with PeerJS, Leaflet, React'),
      e('a', { href: 'https://fractal.co.ke', style: { fontSize: 12, color: 'var(--accent)', textDecoration: 'none' } }, 'Powered by Fractal'),
    ),

    // Spacer
    e('div', { style: { height: 30 } }),
  );
}


// ========================== RENDER ==========================

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(e(App));
































































































