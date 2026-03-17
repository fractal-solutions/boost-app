const { useState, useEffect, useRef, useCallback, useMemo } = React;
const e = React.createElement;

// ========================== UTILS ==========================

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

function loadStorage(key, def) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : def; } catch { return def; }
}
function saveStorage(key, val) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
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
  if (!cat) return '•';
  if (cat.icon) return cat.icon;
  const label = (cat.label || '').trim();
  return label ? label[0].toUpperCase() : '•';
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
    } catch (err) {
      console.warn('Camera access denied:', err);
      setScanning(false);
    }
  }

  function stopCamera() {
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
          'QR scanning requires a QR library — use manual entry below'
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

function BlipDetailModal({ blip, onClose, onUpdate, onDelete, profile, sendToAllPeers, sendToPeer, peers, categories }) {
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
    showToast('🔥 Boosted!', 'var(--amber)');
  }

  return e('div', {
    style: { position: 'fixed', inset: 0, zIndex: 9999, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }
  },
    e('div', { onClick: onClose, style: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', zIndex: 1 } }),
    e('div', {
      className: 'animate-slide-up',
      style: {
        position: 'relative', zIndex: 2, background: 'var(--bg-card)', borderTopLeftRadius: 20, borderTopRightRadius: 20,
        padding: '20px 16px', width: '100%', maxWidth: 500, maxHeight: '85vh', overflow: 'auto',
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
        e('div', { style: { display: 'flex', gap: 6 } },
          isMine && !editing && e('button', {
            onClick: () => setEditing(true),
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }
          }, '✏️ Edit'),
          isMine && e('button', {
            onClick: () => { onDelete(blip.id); onClose(); showToast('Blip removed', 'var(--magenta)'); },
            className: 'boost-btn',
            style: { background: 'var(--bg-card2)', border: '1px solid var(--magenta)', borderRadius: 8, padding: '6px 10px', color: 'var(--magenta)', fontSize: 12, cursor: 'pointer' }
          }, '🗑️'),
          e('button', {
            onClick: onClose,
            style: { background: 'none', border: 'none', color: 'var(--text-secondary)', fontSize: 20, cursor: 'pointer' }
          }, '✕'),
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
        }, '🔥 ' + (blip.boosts || 0) + ' Boost' + ((blip.boosts || 0) !== 1 ? 's' : '')),
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
          }, '↑'),
        ),
      ),
    ),
  );
}


// ========================== MAIN APP ==========================

function App() {
  const [activeTab, setActiveTab] = useState('map');
  const [profile, setProfile] = useState(() => loadStorage('boost_profile', { displayName: 'Anonymous', peerId: generatePeerId(), avatar: '⚡', createdAt: Date.now() }));
  const [settings, setSettings] = useState(() => {
    const stored = loadStorage('boost_settings', DEFAULT_SETTINGS);
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      peerServer: { ...DEFAULT_SETTINGS.peerServer, ...(stored.peerServer || {}) },
      iceServers: { ...DEFAULT_SETTINGS.iceServers, ...(stored.iceServers || {}) },
      geochat: { ...DEFAULT_SETTINGS.geochat, ...(stored.geochat || {}) },
      map: { ...DEFAULT_SETTINGS.map, ...(stored.map || {}) },
      ui: { ...DEFAULT_SETTINGS.ui, ...(stored.ui || {}) },
      customBlipTypes: stored.customBlipTypes || [],
    };
  });
  const [peers, setPeers] = useState(() => loadStorage('boost_peers', []));
  const [messages, setMessages] = useState(() => loadStorage('boost_messages', {}));
  const [blips, setBlips] = useState(() => {
    const stored = loadStorage('boost_blips', []);
    return stored.filter(b => !b.expiresAt || b.expiresAt > Date.now());
  });
  const [geochatMessages, setGeochatMessages] = useState(() => {
    const stored = loadStorage('boost_geochat', []);
    return stored.filter(m => Date.now() - m.timestamp < 86400000);
  });
  const [position, setPosition] = useState(null);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const [activeChatPeer, setActiveChatPeer] = useState(null);
  const [unreadCounts, setUnreadCounts] = useState({});

  const peerRef = useRef(null);
  const connectionsRef = useRef({});
  const mapRef = useRef(null);
  const markersRef = useRef({});

  // Save to localStorage on changes
  useEffect(() => { saveStorage('boost_profile', profile); }, [profile]);
  useEffect(() => { saveStorage('boost_settings', settings); }, [settings]);
  useEffect(() => {
    const theme = (settings.ui && settings.ui.theme) || 'obsidian';
    const root = document.body;
    root.classList.remove('theme-obsidian', 'theme-slate', 'theme-ivory');
    root.classList.add('theme-' + theme);
  }, [settings.ui && settings.ui.theme]);

  const allCategories = useMemo(() => getAllCategories(settings.customBlipTypes), [settings.customBlipTypes]);
  useEffect(() => { saveStorage('boost_peers', peers); }, [peers]);
  useEffect(() => { saveStorage('boost_messages', messages); }, [messages]);
  useEffect(() => { saveStorage('boost_blips', blips); }, [blips]);
  useEffect(() => { saveStorage('boost_geochat', geochatMessages); }, [geochatMessages]);

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
        if (!connectionsRef.current[p.peerId]) {
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

  function handleConnection(conn) {
    const peerId = conn.peer;
    connectionsRef.current[peerId] = conn;

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
    });

    conn.on('data', (data) => {
      handlePeerData(peerId, data);
    });

    conn.on('close', () => {
      delete connectionsRef.current[peerId];
      setPeers(prev => prev.map(p => p.peerId === peerId ? { ...p, connected: false } : p));
    });

    conn.on('error', () => {
      delete connectionsRef.current[peerId];
    });
  }

  function connectToPeer(peerId) {
    if (!peerRef.current || peerRef.current.destroyed) return;
    if (connectionsRef.current[peerId]) return;
    if (peerId === profile.peerId) { showToast("Can't connect to yourself!", 'var(--magenta)'); return; }
    try {
      const conn = peerRef.current.connect(peerId, { reliable: true });
      handleConnection(conn);
    } catch (err) {
      showToast('Connection failed', 'var(--magenta)');
    }
  }

  function handlePeerData(fromPeer, data) {
    if (!data || !data.type) return;

    switch (data.type) {
      case 'intro':
        setPeers(prev => prev.map(p => p.peerId === fromPeer ? { ...p, displayName: data.displayName || fromPeer, avatar: data.avatar } : p));
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
      case 'ping':
        if (connectionsRef.current[fromPeer]) {
          connectionsRef.current[fromPeer].send({ type: 'pong' });
        }
        break;
    }
  }

  function sendToAllPeers(data) {
    Object.values(connectionsRef.current).forEach(conn => {
      try { conn.send(data); } catch {}
    });
  }

  function sendToPeer(peerId, data) {
    if (connectionsRef.current[peerId]) {
      try { connectionsRef.current[peerId].send(data); } catch {}
    }
  }

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
    e(Header, { profile, connectionStatus, connectedPeersCount }),
    // Main content area
    e('div', { style: { flex: 1, overflow: 'hidden', position: 'relative' } },
      activeTab === 'chat' && e(ChatView, { profile, peers, messages, setMessages, activeChatPeer, setActiveChatPeer, connectToPeer, sendToPeer, unreadCounts, setUnreadCounts, blips, categories: allCategories }),
      activeTab === 'map' && e(MapView, { position, blips, setBlips, profile, sendToAllPeers, sendToPeer, settings, peers, categories: allCategories }),
      activeTab === 'geochat' && e(GeochatView, { position, geochatMessages, setGeochatMessages, profile, sendToAllPeers, settings }),
      activeTab === 'settings' && e(SettingsView, { profile, setProfile, settings, setSettings, initPeer, blips, setBlips, setMessages, setGeochatMessages, setPeers, categories: allCategories }),
    ),
    // Bottom nav
    e(BottomNav, { activeTab, setActiveTab, unreadCounts })
  );
}

// ========================== HEADER ==========================

function Header({ profile, connectionStatus, connectedPeersCount }) {
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
        style: {
          fontSize: 20,
          color: 'var(--accent)',
          textShadow: '0 0 10px color-mix(in srgb, var(--accent) 70%, transparent), 0 0 24px color-mix(in srgb, var(--accent) 40%, transparent)',
          animation: 'bolt-pulse 2.2s ease-in-out infinite',
          transformOrigin: 'center',
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

function ChatView({ profile, peers, messages, setMessages, activeChatPeer, setActiveChatPeer, connectToPeer, sendToPeer, unreadCounts, setUnreadCounts, blips, categories }) {
  const [connectInput, setConnectInput] = useState('');
  const [showConnect, setShowConnect] = useState(false);
  const [showQR, setShowQR] = useState(false);
  const [showScanner, setShowScanner] = useState(false);
  const [chatInput, setChatInput] = useState('');
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
    const msg = { id: generateId('msg'), text, sender: profile.peerId, timestamp: Date.now() };
    setMessages(prev => ({ ...prev, [activeChatPeer]: [...(prev[activeChatPeer] || []), msg] }));
    sendToPeer(activeChatPeer, { type: 'chat', message: text, timestamp: msg.timestamp });
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
          e('div', { style: { fontSize: 48, marginBottom: 12 } }, '📡'),
          e('div', { style: { fontSize: 15, fontWeight: 500 } }, 'No peers yet'),
          e('div', { style: { fontSize: 12, marginTop: 6 } }, 'Connect to a peer to start chatting'),
        ),
        peers.map(peer => {
          const convMsgs = messages[peer.peerId] || [];
          const lastMsg = convMsgs[convMsgs.length - 1];
          const unread = unreadCounts[peer.peerId] || 0;
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
            e('div', { style: { width: 44, height: 44, borderRadius: '50%', background: 'var(--bg-card2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, flexShrink: 0, border: '2px solid ' + (peer.connected ? 'var(--neon-green)' : 'var(--border)') } }, peer.avatar || '👤'),
            e('div', { style: { flex: 1, minWidth: 0 } },
              e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
                e('span', { style: { fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' } }, peer.displayName || peer.peerId),
                lastMsg && e('span', { style: { fontSize: 10, color: 'var(--text-secondary)' } }, timeAgo(lastMsg.timestamp)),
              ),
              e('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 3 } },
                e('span', { style: { fontSize: 12, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 } }, lastMsg ? lastMsg.text : (peer.connected ? 'Connected' : 'Offline')),
                unread > 0 && e('span', { style: { background: 'var(--magenta)', color: '#fff', fontSize: 10, fontWeight: 700, borderRadius: 10, padding: '2px 7px', minWidth: 18, textAlign: 'center' } }, unread),
              ),
            ),
          );
        })
      )
    );
  }

  // Chat window
  const peerInfo = peers.find(p => p.peerId === activeChatPeer) || { peerId: activeChatPeer, displayName: activeChatPeer };
  const convMsgs = messages[activeChatPeer] || [];

  return e('div', { style: { height: '100%', display: 'flex', flexDirection: 'column' } },
    // Chat header
    e('div', { style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(26,26,46,0.8)', flexShrink: 0 } },
      e('button', {
        onClick: () => setActiveChatPeer(null),
        style: { background: 'none', border: 'none', color: 'var(--accent)', fontSize: 20, cursor: 'pointer', padding: 4 }
      }, '←'),
      e('div', { style: { width: 36, height: 36, borderRadius: '50%', background: 'var(--bg-card2)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, border: '2px solid ' + (peerInfo.connected ? 'var(--neon-green)' : 'var(--border)') } }, peerInfo.avatar || '👤'),
      e('div', null,
        e('div', { style: { fontWeight: 600, fontSize: 14 } }, peerInfo.displayName),
        e('div', { style: { fontSize: 10, color: peerInfo.connected ? 'var(--neon-green)' : 'var(--text-secondary)' } }, peerInfo.connected ? 'Online' : 'Offline'),
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
    e('div', { style: { padding: '10px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, background: 'rgba(10,10,20,0.8)', flexShrink: 0 } },
      e('input', {
        value: chatInput, onChange: (ev) => setChatInput(ev.target.value),
        onKeyDown: (ev) => ev.key === 'Enter' && handleSend(),
        placeholder: 'Type a message...',
        style: { flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: '10px 16px', color: 'var(--text-primary)', fontSize: 14 }
      }),
      e('button', {
        onClick: handleSend,
        className: 'boost-btn',
        style: { background: 'var(--accent)', color: 'var(--bg-deep)', border: 'none', borderRadius: '50%', width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontSize: 18, fontWeight: 700 }
      }, '⚡'),
    )
  );
}

// ========================== MAP VIEW ==========================

function MapView({ position, blips, setBlips, profile, sendToAllPeers, sendToPeer, settings, peers, categories }) {
  const mapContainerRef = useRef(null);
  const leafletMapRef = useRef(null);
  const userMarkerRef = useRef(null);
  const blipLayerRef = useRef(null);
  const tileLayerRef = useRef(null);
  const [showAddBlip, setShowAddBlip] = useState(false);
  const [selectedBlip, setSelectedBlip] = useState(null);
  const [draggingBlipId, setDraggingBlipId] = useState(null);
  const [newBlip, setNewBlip] = useState({ type: 'cool_spot', title: '', desc: '', expiry: 86400000, shareWithPeers: true, dropAtLocation: true });
  const allCategories = categories && categories.length ? categories : BLIP_CATEGORIES;

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
    const lightThemes = ['ivory', 'sand'];
    const tileUrl = lightThemes.includes(theme)
      ? 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
    tileLayerRef.current = L.tileLayer(tileUrl, {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
      subdomains: 'abcd', maxZoom: 20,
    }).addTo(map);

    blipLayerRef.current = L.layerGroup().addTo(map);
    leafletMapRef.current = map;

    return () => { map.remove(); leafletMapRef.current = null; };
  }, []);

  useEffect(() => {
    if (!leafletMapRef.current) return;
    const theme = (settings.ui && settings.ui.theme) || 'obsidian';
    const lightThemes = ['ivory', 'sand'];
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
      leafletMapRef.current.setView([position.lat, position.lng], settings.map.defaultZoom || 14);
    } else {
      userMarkerRef.current.setLatLng([position.lat, position.lng]);
    }
  }, [position]);

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

  function handleDeleteBlip(id) {
    setBlips(prev => prev.filter(b => b.id !== id));
  }

  // Find selected blip data (fresh from state)
  const selectedBlipData = selectedBlip ? blips.find(b => b.id === selectedBlip) : null;

  return e('div', { style: { height: '100%', position: 'relative' } },
    e('div', { ref: mapContainerRef, style: { width: '100%', height: '100%' } }),

    // Blip detail modal
    selectedBlipData && e(BlipDetailModal, {
      blip: selectedBlipData,
      onClose: () => setSelectedBlip(null),
      onUpdate: handleUpdateBlip,
      onDelete: handleDeleteBlip,
      profile,
      sendToAllPeers,
      sendToPeer,
      peers,
      categories: allCategories,
    }),

    // Recenter button
    position && e('button', {
      onClick: () => leafletMapRef.current && leafletMapRef.current.setView([position.lat, position.lng], leafletMapRef.current.getZoom()),
      className: 'boost-btn',
      style: {
        position: 'absolute', top: 12, right: 12, zIndex: 1000, width: 40, height: 40,
        borderRadius: '50%', background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--accent)',
        fontSize: 18, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer',
      }
    }, '◎'),

    // Blip count badge
    e('div', {
      style: {
        position: 'absolute', top: 12, left: 12, zIndex: 1000,
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px',
        fontSize: 11, color: 'var(--text-secondary)',
      }
    }, '📍 ' + blips.length + ' blip' + (blips.length !== 1 ? 's' : '')),

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
            '📡 Share with peers'
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

  const moods = ['😌 Calm', '😊 Happy', '😂 Funny', '🔥 Hype', '⚠️ Alert', '👀 Curious', '🎯 Focused', '💬 Social'];

  const zoneRadius = settings.geochat.zoneRadius || 1000;
  const zoneName = position ? getZoneName(position.lat, position.lng, zoneRadius) : 'Unknown Zone';
  const zoneKey = position ? getZoneKey(position.lat, position.lng, zoneRadius) : '';

  // FIXED: More permissive filtering — show messages from same zone OR within radius
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

function SettingsView({ profile, setProfile, settings, setSettings, initPeer, blips, setBlips, setMessages, setGeochatMessages, setPeers, categories }) {
  const [section, setSection] = useState(null);
  const [showQR, setShowQR] = useState(false);
  const [newBlipType, setNewBlipType] = useState({ label: '', icon: '', color: 'var(--accent)' });
  const customBlipTypes = settings.customBlipTypes || [];

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
        ['⚡', '🔥', '💀', '👾', '🎮', '🌙', '🚀', '💎', '🎯', '🐉', '🦊', '🤖'].map(av => e('button', {
          key: av, onClick: () => setProfile(p => ({ ...p, avatar: av })),
          style: { fontSize: 22, padding: '4px 8px', background: profile.avatar === av ? 'var(--bg-card2)' : 'transparent', border: profile.avatar === av ? '1px solid var(--accent)' : '1px solid transparent', borderRadius: 8, cursor: 'pointer' }
        }, av))
      ),
      // QR & Share section
      e('div', { style: { borderTop: '1px solid var(--border)', paddingTop: 12 } },
        e('div', { style: { ...labelStyle, marginBottom: 8 } }, 'SHARE YOUR ID'),
        !showQR
          ? e('div', { style: { display: 'flex', gap: 6, flexWrap: 'wrap' } },
              e('button', { onClick: () => setShowQR(true), className: 'boost-btn', style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: '#A855F7', fontSize: 12, cursor: 'pointer' } }, '📱 Show QR'),
              e('button', { onClick: () => handleShareVia('copy'), className: 'boost-btn', style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' } }, '📋 Copy ID'),
              navigator.share && e('button', { onClick: () => handleShareVia('native'), className: 'boost-btn', style: { background: 'var(--bg-card2)', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 14px', color: 'var(--neon-green)', fontSize: 12, cursor: 'pointer' } }, '📤 Share'),
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
      e('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8 } },
        ['obsidian', 'slate', 'ivory', 'carbon', 'aurora', 'sand'].map(theme => e('button', {
          key: theme,
          onClick: () => updateSettings('ui.theme', theme),
          className: 'boost-btn',
          style: {
            padding: '10px', borderRadius: 10,
            background: (settings.ui && settings.ui.theme) === theme ? 'var(--bg-card2)' : 'var(--bg-deep)',
            border: '1px solid ' + ((settings.ui && settings.ui.theme) === theme ? 'var(--accent)' : 'var(--border)'),
            color: (settings.ui && settings.ui.theme) === theme ? 'var(--accent)' : 'var(--text-secondary)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer', textTransform: 'capitalize'
          }
        }, theme))
      ),
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
        e('input', {
          value: newBlipType.color,
          onChange: (ev) => setNewBlipType(prev => ({ ...prev, color: ev.target.value })),
          placeholder: 'var(--accent)',
          style: { ...inputStyle, marginBottom: 0 }
        }),
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
      e('div', { style: { ...labelStyle, fontSize: 14, marginBottom: 12 } }, '🌐 PeerJS Server'),
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
      }, '🔄 Reconnect'),
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
            const data = JSON.stringify(blips, null, 2);
            const blob = new Blob([data], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'boost-blips.json'; a.click();
            URL.revokeObjectURL(url);
            showToast('Blips exported!', 'var(--neon-green)');
          },
          className: 'boost-btn', style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--border)', color: 'var(--accent)', fontSize: 12, cursor: 'pointer', fontWeight: 500 }
        }, '📤 Export Blips'),
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
        }, '📥 Import Blips'),
        e('button', {
          onClick: () => {
            if (confirm('Clear ALL data? This cannot be undone.')) {
              localStorage.clear();
              window.location.reload();
            }
          },
          className: 'boost-btn', style: { padding: '10px 14px', borderRadius: 8, background: 'var(--bg-card2)', border: '1px solid var(--magenta)', color: 'var(--magenta)', fontSize: 12, cursor: 'pointer', fontWeight: 500 }
        }, '🗑️ Clear All Data'),
      ),
    ),

    // About
    e('div', { style: { ...sectionStyle, textAlign: 'center' } },
      e('div', { style: { fontSize: 24, fontWeight: 700, color: 'var(--accent)', letterSpacing: 4, marginBottom: 4 } }, '⚡ BOOST'),
      e('div', { style: { fontSize: 12, color: 'var(--text-secondary)', marginBottom: 8 } }, 'v1.1.0 — P2P Social Map & Chat'),
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









