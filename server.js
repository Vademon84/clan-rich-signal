// server.js
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

// 1. Express + HTTP сервер
const app = express();
const server = http.createServer(app);

// 2. WebSocket сервер на том же HTTP-сервере
const wss = new WebSocketServer({ noServer: true });

// 3. Хранилище комнат (можно расширить)
const rooms = {};

// === Обработчик HTTP-запросов ===
app.get('/', (req, res) => {
  res.status(200).send(`
    <!DOCTYPE html>
    <html>
    <head><title>Clan RICH Signal</title></head>
    <body style="background:#0a0a0f;color:#e0e0ff;font-family:monospace;padding:2rem">
      <h1>✅ Clan RICH — Signal Server</h1>
      <p>Сервер работает. Порт: <b>${process.env.PORT || 8080}</b></p>
      <p>WebSocket: <code>wss://${req.headers.host}/ws</code></p>
      <p>Статус: <span style="color:#43b581">ONLINE</span></p>
      <hr>
      <small>Render • Node.js • ws</small>
    </body>
    </html>
  `);
});

// "Заглушка" для health-check'а
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// === Upgrade-хендлер для WebSocket ===
server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy(); // отклоняем не-WebSocket upgrade
  }
});

// === Логика WebSocket ===
wss.on('connection', (ws, request) => {
  const clientId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  let currentRoom = null;
  let nickname = 'Anonymous';

  console.log(`🔌 Новое соединение: ${clientId} | IP: ${request.socket.remoteAddress}`);

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      console.log(`📥 ${clientId} →`, msg);

      switch (msg.type) {
        case 'join':
          nickname = msg.nickname || 'Anonymous';
          currentRoom = msg.room || 'main';
          
          // Добавляем в комнату
          if (!rooms[currentRoom]) rooms[currentRoom] = [];
          rooms[currentRoom].push({ id: clientId, ws, nickname });
          
          // Сообщаем другим в комнате
          broadcast(currentRoom, {
            type: 'user-joined',
            user: { id: clientId, nickname }
          }, ws);

          // Ответ клиенту
          ws.send(JSON.stringify({
            type: 'joined',
            room: currentRoom,
            users: rooms[currentRoom].map(u => ({ id: u.id, nickname: u.nickname }))
          }));
          break;

        case 'offer':
        case 'answer':
        case 'ice-candidate':
          // Пересылаем peer-to-peer сообщения
          if (msg.targetId) {
            const target = findClientInRoom(currentRoom, msg.targetId);
            if (target) {
              msg.fromId = clientId;
              msg.fromNickname = nickname;
              target.send(JSON.stringify(msg));
            }
          }
          break;

        case 'leave':
          leaveRoom();
          break;

        default:
          console.warn('Неизвестный тип:', msg.type);
      }
    } catch (e) {
      console.error('❌ Ошибка обработки сообщения:', e);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    }
  });

  ws.on('close', () => {
    console.log(`📴 Соединение закрыто: ${clientId}`);
    leaveRoom();
  });

  ws.on('error', (err) => {
    console.error(`💥 WebSocket ошибка (${clientId}):`, err.message);
    leaveRoom();
  });

  // Вспомогательные функции
  function leaveRoom() {
    if (!currentRoom || !rooms[currentRoom]) return;
    
    rooms[currentRoom] = rooms[currentRoom].filter(u => u.id !== clientId);
    if (rooms[currentRoom].length === 0) {
      delete rooms[currentRoom];
    }

    broadcast(currentRoom, {
      type: 'user-left',
      userId: clientId
    });

    currentRoom = null;
  }

  function broadcast(room, message, excludeWs = null) {
    if (!rooms[room]) return;
    const payload = JSON.stringify(message);
    rooms[room].forEach(({ ws: clientWs }) => {
      if (clientWs !== excludeWs && clientWs.readyState === 1) {
        clientWs.send(payload);
      }
    });
  }

  function findClientInRoom(room, id) {
    if (!rooms[room]) return null;
    const user = rooms[room].find(u => u.id === id);
    return user ? user.ws : null;
  }
});

// === Запуск сервера ===
const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 HTTP + WebSocket сервер запущен на порту ${PORT}`);
  console.log(`🌍 Доступен по: http://localhost:${PORT}`);
  console.log(`💬 WebSocket: ws://localhost:${PORT}/ws`);
});
