import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';

const PORT = process.env.PORT ? Number(process.env.PORT) : 3001;

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

io.on('connection', (socket) => {
  console.log(`client connected: ${socket.id}`);

  // NOTE: File transfer signaling (rooms / WebRTC) will be added later.
  // For now we only track connect/disconnect.

  socket.on('disconnect', () => {
    console.log(`client disconnected: ${socket.id}`);
  });
});

httpServer.listen(PORT, '0.0.0.0', () => {
  console.log(`DropLink server listening on http://localhost:${PORT}`);
});
