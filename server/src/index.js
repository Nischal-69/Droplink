import crypto from 'crypto';
import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;
/** Rooms live in memory only and expire quickly — never persisted. */
const ROOM_TTL_MS = 10 * 60 * 1000;

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', service: 'droplink-server' });
});

const httpServer = createServer(app);

const io = new Server(httpServer, {
  cors: {
    origin: true,
    methods: ['GET', 'POST'],
  },
});

/**
 * Signaling-only pairing store.
 * Key: normalized 6-digit code ("482731"). Value: room record.
 * File bytes are NEVER sent through Socket.IO — only room/code/status events
 * plus WebRTC SDP/ICE signaling payloads.
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
    code = String(Math.floor(100000 + Math.random() * 900000));
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
  const cleaned = String(input ?? '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 64);
  return cleaned || null;
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

// Expire stale rooms so nothing is stored permanently.
setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (now - room.createdAt > ROOM_TTL_MS) {
      io.to(room.roomId).emit('room-expired', { roomId: room.roomId });
      if (room.guestId) socketToCode.delete(room.guestId);
      socketToCode.delete(room.hostId);
      rooms.delete(code);
      console.log(`room expired: ${room.roomId}`);
    }
  }
}, 60 * 1000);

io.on('connection', (socket) => {
  console.log(`client connected: ${socket.id}`);

  // Sender creates a temporary room and receives a 6-digit code.
  // Optional payload: { device } — a friendly display label, never an IP.
  socket.on('create-room', (payload, callback) => {
    if (typeof payload === 'function') {
      callback = payload;
      payload = null;
    }
    if (typeof callback !== 'function') return;
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
    const raw = typeof payload === 'string' ? payload : payload?.code;
    const code = normalizeCode(raw);
    const room = rooms.get(code);
    if (!room) {
      respond?.({ ok: false, error: 'Code not found. Check the code and try again.' });
      return;
    }
    if (Date.now() - room.createdAt > ROOM_TTL_MS) {
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
    leaveRoom(socket, true);
  });

  // Relay WebRTC SDP/ICE signaling between the two paired peers.
  // Payloads are session descriptions and ICE candidates only — never file data.
  socket.on('signal', (message) => {
    const type = message?.type;
    const roomId = message?.roomId;
    const payload = message?.payload;
    if (!SIGNAL_TYPES.has(type) || typeof roomId !== 'string' || payload === undefined) return;
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
    leaveRoom(socket);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`DropLink server listening on http://localhost:${PORT}`);
});
