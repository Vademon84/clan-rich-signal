// server.js - Clan RICH Signal Server
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

// Хранилище комнат: room → [ { id, ws, nickname } ]
const rooms = {};

// HTTP роуты
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

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', uptime: process.uptime() });
});

// WebSocket upgrade
server.on('upgrade', (request, socket, head) => {
  if (request.url === '/ws') {
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request);
    });
  } else {
    socket.destroy();
  }
});

// WebSocket логика
wss.on('connection', (ws, request) => {
  const clientId = Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  let currentRoom = null;
  let nickname = 'Anonymous';

  console.log(`🔌 Новое соединение: ${clientId} | IP: ${request.socket.remoteAddress}`);

  // Функция подсчета пользователей в комнате
  function getRoomUserCount(room) {
    return rooms[room] ? rooms[room].length : 0;
  }

  function leaveRoom() {
    if (!currentRoom || !rooms[currentRoom]) return;

    const user = rooms[currentRoom].find(u => u.id === clientId);
    const nick = user ? user.nickname : nickname;

    // Удаляем из комнаты
    rooms[currentRoom] = rooms[currentRoom].filter(u => u.id !== clientId);
    
    // Отправляем обновленный счетчик пользователей
    if (rooms[currentRoom].length > 0) {
      broadcast(currentRoom, {
        type: 'user-count',
        count: rooms[currentRoom].length
      });
      
      // Сообщаем остальным о выходе
      broadcast(currentRoom, {
        type: 'user-left',
        userId: clientId,
        nickname: nick
      }, ws);
    } else {
      delete rooms[currentRoom];
    }

    console.log(`👋 ${nick} покинул комнату "${currentRoom}"`);
    currentRoom = null;
  }

  function broadcast(room, message, excludeWs = null) {
    if (!rooms[room]) return;
    const payload = JSON.stringify(message);
    rooms[room].forEach(({ ws: clientWs, id }) => {
      if (excludeWs === null || (clientWs !== excludeWs && id !== clientId)) {
        if (clientWs.readyState === 1) {
          clientWs.send(payload);
        }
      }
    });
  }

  // Включая себя
  function broadcastIncludingSelf(room, message) {
    if (!rooms[room]) return;
    const payload = JSON.stringify(message);
    rooms[room].forEach(({ ws: clientWs }) => {
      if (clientWs.readyState === 1) {
        clientWs.send(payload);
      }
    });
  }

  function findClientInRoom(room, id) {
    return rooms[room]?.find(u => u.id === id)?.ws || null;
  }

  function isUserInRoom(room, id) {
    return rooms[room]?.some(u => u.id === id) || false;
  }

  ws.on('message', (data) => {
    try {
      const msg = JSON.parse(data);
      console.log(`📥 ${clientId} (${nickname}) →`, msg.type);

      switch (msg.type) {
        case 'join':
          // Если уже в комнате, выходим из предыдущей
          if (currentRoom) {
            leaveRoom();
          }

          nickname = msg.nickname || 'Anonymous';
          const newRoom = msg.room || 'main';

          if (!rooms[newRoom]) rooms[newRoom] = [];

          // Проверяем, нет ли уже пользователя в комнате
          const existingIndex = rooms[newRoom].findIndex(u => u.id === clientId);
          if (existingIndex >= 0) {
            rooms[newRoom].splice(existingIndex, 1);
          }

          rooms[newRoom].push({ id: clientId, ws, nickname });
          currentRoom = newRoom;

          // Отправляем счетчик всем в комнате
          const userCount = rooms[currentRoom].length;
          broadcastIncludingSelf(currentRoom, {
            type: 'user-count',
            count: userCount
          });

          // Сообщаем другим о присоединении
          broadcast(currentRoom, {
            type: 'user-joined',
            user: { id: clientId, nickname }
          }, ws);

          // Ответ клиенту со списком всех пользователей
          ws.send(JSON.stringify({
            type: 'joined',
            room: currentRoom,
            users: rooms[currentRoom].map(u => ({ id: u.id, nickname: u.nickname })),
            userCount: userCount
          }));

          console.log(`✅ ${nickname} вошёл в комнату "${currentRoom}" (всего: ${userCount})`);
          break;

        case 'offer':
        case 'answer':
        case 'ice-candidate':
          if (msg.targetId && currentRoom && isUserInRoom(currentRoom, clientId)) {
            const target = findClientInRoom(currentRoom, msg.targetId);
            if (target) {
              target.send(JSON.stringify({
                ...msg,
                fromId: clientId,
                fromNickname: nickname
              }));
            }
          }
          break;

        case 'text-message':
          if (currentRoom && isUserInRoom(currentRoom, clientId) && msg.message && msg.message.trim()) {
            const timestamp = new Date().toISOString();
            broadcastIncludingSelf(currentRoom, {
              type: 'text-message',
              userId: clientId,
              nickname: nickname,
              message: msg.message,
              timestamp: timestamp
            });
          }
          break;

        case 'leave':
          leaveRoom();
          break;

        case 'ping':
          // Keep-alive пинг
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          console.warn('Неизвестный тип:', msg.type);
      }
    } catch (e) {
      console.error('❌ Ошибка парсинга:', e);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
    }
  });

  // Keep-alive: отправляем пинг каждые 30 секунд
  const pingInterval = setInterval(() => {
    if (ws.readyState === 1) {
      ws.ping();
    }
  }, 30000);

  ws.on('pong', () => {
    // Клиент ответил на пинг, соединение живо
  });

  ws.on('close', () => {
    console.log(`📴 Соединение закрыто: ${clientId} (${nickname})`);
    clearInterval(pingInterval);
    leaveRoom();
  });

  ws.on('error', (err) => {
    console.error(`💥 Ошибка (${clientId}):`, err.message);
    clearInterval(pingInterval);
    leaveRoom();
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`🚀 HTTP + WebSocket сервер запущен на порту ${PORT}`);
});
