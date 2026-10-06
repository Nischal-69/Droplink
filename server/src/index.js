import crypto from 'crypto';
import cors from 'cors';
import express from 'express';
import fs from 'fs';
import { createServer as createHttpServer } from 'http';
import { createServer as createHttpsServer } from 'https';
import { Server } from 'socket.io';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
/**
 * Pairing codes are short-lived: rooms nobody joined expire automatically
 * after this long. Rooms with a joined peer are never expired by the
 * sweeper, so an active transfer is never torn down server-side.
 */
const CODE_TTL_MS = 5 * 60 * 1000;
/** How often the room-expiry and idle-connection sweeps run. */
const SWEEP_INTERVAL_MS = 30 * 1000;
/**
 * Sockets that never joined/created a room and go quiet for this long are
 * disconnected to close inactive connections.
 */
const IDLE_SOCKET_TTL_MS = 10 * 60 * 1000;
/**
 * Upper bound for a single signaling payload. SDP offers/answers are a few
 * KB and ICE candidates are tiny — anything larger is not signaling.
 */
const MAX_SIGNAL_PAYLOAD_BYTES = 32 * 1024;
/** Engine.IO cap: handshake/signaling frames never legitimately exceed this. */
const MAX_HTTP_BUFFER_BYTES = 64 * 1024;
/** Per-socket pairing rate limits (sliding window) against code brute force. */
const CREATE_ROOM_LIMIT = 5;
const JOIN_ROOM_LIMIT = 10;
const RATE_WINDOW_MS = 60 * 1000;

const app = express();
app.disable('x-powered-by');
// Open CORS is required for LAN use (phone IP vs laptop hostname are
// different origins). No cookies, sessions, or credentials are used, and
// the server accepts no file uploads — signaling metadata only.
app.use(cors());
// Health endpoint only: bound the body so the server never buffers uploads.
app.use(express.json({ limit: '10kb' }));
if (process.env.TRUST_PROXY) app.set('trust proxy', 1);

// Production TLS: serve HTTPS (and therefore WSS for Socket.IO) when a
// certificate is provided. Behind a TLS-terminating reverse proxy, plain
// HTTP with TRUST_PROXY set is the equivalent deployment.
const tlsCertPath = process.env.TLS_CERT_PATH;
const tlsKeyPath = process.env.TLS_KEY_PATH;
const useTls = Boolean(tlsCertPath && tlsKeyPath);
if (useTls) {
  // Registered before routes so every response carries HSTS.
  app.use((_req, res, next) => {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  });
}

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'droplink-server' });
});

let httpServer;
if (useTls) {
  httpServer = createHttpsServer(
    {
      cert: fs.readFileSync(tlsCertPath),
      key: fs.readFileSync(tlsKeyPath),
    },
    app,
  );
} else {
  httpServer = createHttpServer(app);
  if (process.env.NODE_ENV === 'production') {
    console.warn(
      'WARNING: running without TLS. Set TLS_CERT_PATH/TLS_KEY_PATH (or terminate TLS upstream) so signaling uses HTTPS/WSS in production.',
    );
  }
}

const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
  maxHttpBufferSize: MAX_HTTP_BUFFER_BYTES,
});

/**
 * Signaling-only pairing store.
 * Key: normalized 6-digit code ("482731"). Value: room record.
 * - Codes are short-lived: rooms nobody joined expire after CODE_TTL_MS.
 * - File bytes are NEVER sent through Socket.IO — only room/code/status events
 *   plus validated WebRTC SDP/ICE signaling payloads. Nothing is persisted.
 */
const rooms = new Map();
const socketToCode = new Map();
const SIGNAL_TYPES = new Set(['offer', 'answer', 'ice', 'restart-request']);

function normalizeCode(input) {
  return String(input ?? '').replace(/\D/g, '').slice(0, 6);
}

function formatCode(code) {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function generateCode() {
  let code;
  do {
    // CSPRNG: short codes must be unpredictable within their short lifetime.
    code = String(crypto.randomInt(100000, 1000000));
  } while (rooms.has(code));
  return code;
}

function generateRoomId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Friendly device labels only (e.g. "Chrome on Windows") — display-only,
 * never IP addresses. Sanitized and length-capped before relaying.
 */
function sanitizeDeviceLabel(input) {
  // eslint-disable-next-line no-control-regex
  const cleaned = String(input ?? '').replace(/[^ -~]/g, '').trim().slice(0, 64);
  return cleaned || null;
}

/** Optional { device } pairing field: absent, or a short string. */
function isValidDeviceField(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= 200);
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function jsonByteLength(value) {
  try {
    const text = JSON.stringify(value);
    return typeof text === 'string' ? Buffer.byteLength(text, 'utf8') : Number.POSITIVE_INFINITY;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/**
 * Bounded, shape-checked signaling payloads. SDP/ICE only — file bytes are
 * never valid here and oversized or misshapen payloads are dropped.
 */
function isValidSignalPayload(type, payload) {
  if (!isPlainObject(payload)) return false;
  if (jsonByteLength(payload) > MAX_SIGNAL_PAYLOAD_BYTES) return false;
  switch (type) {
    case 'offer':
    case 'answer':
      return (
        typeof payload.type === 'string' &&
        payload.type.length <= 32 &&
        typeof payload.sdp === 'string' &&
        payload.sdp.length > 0 &&
        payload.sdp.length <= MAX_SIGNAL_PAYLOAD_BYTES
      );
    case 'ice': {
      const { candidate, sdpMid, sdpMLineIndex } = payload;
      if (candidate !== undefined && candidate !== null) {
        if (typeof candidate !== 'string' || candidate.length > 8192) return false;
      }
      if (sdpMid !== undefined && sdpMid !== null) {
        if (typeof sdpMid !== 'string' || sdpMid.length > 64) return false;
      }
      if (sdpMLineIndex !== undefined && sdpMLineIndex !== null) {
        if (typeof sdpMLineIndex !== 'number') return false;
      }
      return true;
    }
    case 'restart-request':
      return true;
    default:
      return false;
  }
}

/** Sliding-window per-socket rate limits for the pairing endpoints. */
const rateBuckets = new Map();
function allowAction(socketId, kind) {
  const now = Date.now();
  let bucket = rateBuckets.get(socketId);
  if (!bucket) {
    bucket = { create: [], join: [] };
    rateBuckets.set(socketId, bucket);
  }
  const limit = kind === 'create' ? CREATE_ROOM_LIMIT : JOIN_ROOM_LIMIT;
  const stamps = bucket[kind].filter((t) => now - t < RATE_WINDOW_MS);
  bucket[kind] = stamps;
  if (stamps.length >= limit) return false;
  stamps.push(now);
  return true;
}

/** Last-seen timestamps for closing connections that go quiet unpaired. */
const socketActivity = new Map();
function touch(socket) {
  socketActivity.set(socket.id, Date.now());
}

function leaveRoom(socket, notifyPeer = false) {
  const code = socketToCode.get(socket.id);
  if (!code) return;
  socketToCode.delete(socket.id);
  const room = rooms.get(code);
  if (!room) return;
  socket.leave(room.roomId);

  if (room.hostId === socket.id) {
    // Host left: room is gone. Guest (if any) is notified and unlinked.
    if (room.guestId) socketToCode.delete(room.guestId);
    rooms.delete(code);
    if (notifyPeer && room.guestId) {
      socket
        .to(room.roomId)
        .emit('peer-disconnected', { roomId: room.roomId, peerId: socket.id });
    }
  } else if (room.guestId === socket.id) {
    room.guestId = null;
    room.guestDevice = null;
    if (notifyPeer) {
      socket
        .to(room.roomId)
        .emit('peer-disconnected', { roomId: room.roomId, peerId: socket.id });
    }
  }
}

// Expire unused rooms automatically so nothing is stored permanently.
// Rooms with a joined peer are never expired here: an active transfer must
// not be torn down server-side. Stale guest-less rooms vanish on their own.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (!room.guestId && now - room.createdAt > CODE_TTL_MS) {
      io.to(room.roomId).emit('room-expired', { roomId: room.roomId });
      socketToCode.delete(room.hostId);
      rooms.delete(code);
      console.log(`room expired: ${room.roomId}`);
    }
  }
  // Close connections that never paired and went quiet: drop the socket so
  // inactive connections do not accumulate. Sockets holding a room are
  // exempt — pairing/transfer state lives with the room sweeps above.
  for (const [socketId, lastSeen] of socketActivity) {
    if (now - lastSeen > IDLE_SOCKET_TTL_MS && !socketToCode.has(socketId)) {
      const sock = io.sockets.sockets.get(socketId);
      socketActivity.delete(socketId);
      rateBuckets.delete(socketId);
      if (sock) {
        console.log(`closing idle connection: ${socketId}`);
        sock.disconnect(true);
      }
    }
  }
}, SWEEP_INTERVAL_MS);

io.on('connection', (socket) => {
  console.log(`client connected: ${socket.id}`);
  touch(socket);

  // Sender creates a temporary room and receives a 6-digit code.
  // Optional payload: { device } — a friendly display label, never an IP.
  socket.on('create-room', (payload, callback) => {
    if (typeof payload === 'function') {
      callback = payload;
      payload = null;
    }
    if (typeof callback !== 'function') return;
    touch(socket);
    if (!isPlainObject(payload) && payload !== null) {
      callback({ ok: false, error: 'Invalid request.' });
      return;
    }
    if (!isValidDeviceField(payload?.device)) {
      callback({ ok: false, error: 'Invalid request.' });
      return;
    }
    if (!allowAction(socket.id, 'create')) {
      callback({ ok: false, error: 'Too many attempts. Wait a moment and try again.' });
      return;
    }
    leaveRoom(socket);
    const code = generateCode();
    const roomId = generateRoomId();
    rooms.set(code, {
      roomId,
      code,
      hostId: socket.id,
      hostDevice: sanitizeDeviceLabel(payload?.device),
      guestId: null,
      guestDevice: null,
      createdAt: Date.now(),
    });
    socketToCode.set(socket.id, code);
    socket.join(roomId);
    console.log(`room created: ${roomId} (code ${formatCode(code)})`);
    callback({ ok: true, roomId, code: formatCode(code) });
  });

  // Receiver joins with the sender's code.
  socket.on('join-room', (payload, callback) => {
    const respond = typeof callback === 'function' ? callback : null;
    touch(socket);
    const raw = typeof payload === 'string' ? payload : payload?.code;
    if (
      (typeof raw !== 'string' && typeof raw !== 'number') ||
      String(raw).length > 32 ||
      !isValidDeviceField(payload?.device)
    ) {
      respond?.({ ok: false, error: 'Enter the 6-digit code from the sending device.' });
      return;
    }
    if (!allowAction(socket.id, 'join')) {
      respond?.({ ok: false, error: 'Too many attempts. Wait a moment and try again.' });
      return;
    }
    const code = normalizeCode(raw);
    const room = rooms.get(code);
    if (!room) {
      respond?.({ ok: false, error: 'Code not found. Check the code and try again.' });
      return;
    }
    if (Date.now() - room.createdAt > CODE_TTL_MS) {
      rooms.delete(code);
      respond?.({ ok: false, error: 'This code has expired. Ask the sender for a new one.' });
      return;
    }
    if (room.guestId && room.guestId !== socket.id) {
      respond?.({ ok: false, error: 'This room is already full.' });
      return;
    }
    if (room.hostId === socket.id) {
      respond?.({ ok: false, error: 'You are already hosting this room on another tab.' });
      return;
    }
    leaveRoom(socket);
    room.guestId = socket.id;
    room.guestDevice = sanitizeDeviceLabel(payload?.device);
    socketToCode.set(socket.id, code);
    socket.join(room.roomId);
    console.log(`peer joined room: ${room.roomId}`);
    respond?.({ ok: true, roomId: room.roomId, code: formatCode(code), hostDevice: room.hostDevice });
    socket
      .to(room.roomId)
      .emit('peer-joined', { roomId: room.roomId, peerId: socket.id, device: room.guestDevice });
  });

  socket.on('leave-room', () => {
    touch(socket);
    leaveRoom(socket, true);
  });

  // Relay WebRTC SDP/ICE signaling between the two paired peers.
  // Payloads are validated session descriptions and ICE candidates only:
  // bounded in size and shape, never file data. Transfer files are never
  // accepted, stored, or relayed by this server — they travel peer-to-peer
  // over the WebRTC DataChannel.
  socket.on('signal', (message) => {
    touch(socket);
    if (!isPlainObject(message)) return;
    const type = message.type;
    const roomId = message.roomId;
    const payload = message.payload;
    if (!SIGNAL_TYPES.has(type)) return;
    if (typeof roomId !== 'string' || roomId.length === 0 || roomId.length > 200) return;
    if (!isValidSignalPayload(type, payload)) return;
    const code = socketToCode.get(socket.id);
    const room = code ? rooms.get(code) : null;
    if (!room || room.roomId !== roomId) return;
    if (socket.id !== room.hostId && socket.id !== room.guestId) return;
    socket.to(roomId).emit('signal', { type, payload, from: socket.id });
  });

  socket.on('disconnect', () => {
    console.log(`client disconnected: ${socket.id}`);
    // Notify the remaining peer, then drop the room if it was hosted here.
    const code = socketToCode.get(socket.id);
    const room = code ? rooms.get(code) : null;
    if (room) {
      socket.to(room.roomId).emit('peer-disconnected', { roomId: room.roomId, peerId: socket.id });
    }
    socketActivity.delete(socket.id);
    rateBuckets.delete(socket.id);
    leaveRoom(socket);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`DropLink server listening on http${useTls ? 's' : ''}://localhost:${PORT}`);
});
