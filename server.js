// server.js — простой WebSocket-сервер для WebRTC signaling
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Хранилище комнат
const rooms = {};

io.on('connection', (socket) => {
  console.log(`✅ Подключился клиент: ${socket.id}`);

  socket.on('join', (data) => {
    const { room, id, nick } = data;
    if (!rooms[room]) rooms[room] = {};
    rooms[room][id] = { socket, nick };
    console.log(`👤 Участник ${nick} (${id}) присоединился к комнате ${room}`);

    // Уведомляем других участников
    Object.keys(rooms[room]).forEach(peerId => {
      if (peerId !== id) {
        rooms[room][peerId].socket.emit('user-joined', { id, nick });
      }
    });

    // Отправляем список участников новому
    const members = Object.keys(rooms[room]).map(pid => ({
      id: pid,
      nick: rooms[room][pid].nick
    }));
    socket.emit('members', members);
  });

  socket.on('offer', (data) => {
    const { to, sdp, room, nick } = data;
    if (rooms[room] && rooms[room][to]) {
      rooms[room][to].socket.emit('offer', { from: socket.id, sdp, nick });
    }
  });

  socket.on('answer', (data) => {
    const { to, sdp, room, nick } = data;
    if (rooms[room] && rooms[room][to]) {
      rooms[room][to].socket.emit('answer', { from: socket.id, sdp, nick });
    }
  });

  socket.on('ice-candidate', (data) => {
    const { to, candidate, room } = data;
    if (rooms[room] && rooms[room][to]) {
      rooms[room][to].socket.emit('ice-candidate', { from: socket.id, candidate });
    }
  });

  socket.on('mute-state', (data) => {
    const { to, muted, room } = data;
    if (rooms[room] && rooms[room][to]) {
      rooms[room][to].socket.emit('mute-state', { from: socket.id, muted });
    }
  });

  socket.on('disconnect', () => {
    console.log(`❌ Клиент ${socket.id} отключился`);
    for (const roomName in rooms) {
      const member = rooms[roomName][socket.id];
      if (member) {
        delete rooms[roomName][socket.id];
        // Уведомляем остальных
        Object.keys(rooms[roomName]).forEach(peerId => {
          rooms[roomName][peerId].socket.emit('user-left', { id: socket.id, nick: member.nick });
        });
        // Очищаем комнату, если пустая
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
  console.log(`🚀 Signal Server запущен на порту ${PORT}`);
});