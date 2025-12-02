// server.js — исправленная версия для Render.com
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*", // разрешаем любые домены (для Netlify — ок)
    methods: ["GET", "POST"]
  },
  transports: ['websocket'], // ← КРИТИЧЕСКИ ВАЖНО: только websocket, без polling
});

// Хранилище комнат
const rooms = {};

io.on('connection', (socket) => {
  console.log(`✅ Новое WebSocket-соединение: ${socket.id}`);

  socket.on('join', (data) => {
    const { room, id, nick } = data;
    if (!rooms[room]) rooms[room] = {};
    rooms[room][id] = { socket, nick };
    console.log(`👤 ${nick} (${id}) → комната ${room}`);

    // Уведомляем других
    Object.keys(rooms[room]).forEach(peerId => {
      if (peerId !== id) {
        rooms[room][peerId].socket.emit('user-joined', { id, nick });
      }
    });
  });

  socket.on('offer', (data) => {
    const { to, room } = data;
    if (rooms[room] && rooms[room][to]) {
      rooms[room][to].socket.emit('offer', data);
    }
  });

  socket.on('answer', (data) => {
    const { to, room } = data;
    if (rooms[room] && rooms[room][to]) {
      rooms[room][to].socket.emit('answer', data);
    }
  });

  socket.on('ice-candidate', (data) => {
    const { to, room } = data;
    if (rooms[room] && rooms[room][to]) {
      rooms[room][to].socket.emit('ice-candidate', data);
    }
  });

  socket.on('mute-state', (data) => {
    const { to, room } = data;
    if (rooms[room] && rooms[room][to]) {
      rooms[room][to].socket.emit('mute-state', data);
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Отключён: ${socket.id}`);
    for (const roomName in rooms) {
      if (rooms[roomName][socket.id]) {
        const nick = rooms[roomName][socket.id].nick;
        delete rooms[roomName][socket.id];

        // Уведомляем остальных
        Object.keys(rooms[roomName]).forEach(peerId => {
          rooms[roomName][peerId].socket.emit('user-left', { id: socket.id, nick });
        });

        if (Object.keys(rooms[roomName]).length === 0) {
          delete rooms[roomName];
        }
        break;
      }
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 HTTP + WebSocket сервер запущен на порту ${PORT}`);
});
