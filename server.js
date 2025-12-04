// server.js - Clan RICH Signal Server v2.0
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');

const app = express();
const server = http.createServer(app);

const wss = new WebSocketServer({ noServer: true });

// Хранилище комнат: room → [ { id, ws, nickname, roomType } ]
const rooms = {};
const roomConfig = {
    'main': { name: 'Общение', icon: '💬', description: 'Основная комната для общения' },
    'games': { name: 'Игры', icon: '🎮', description: 'Комната для игровых сессий' }
};

// Счетчик пользователей для статистики
const stats = {
    totalConnections: 0,
    activeUsers: 0
};

// HTTP роуты
app.get('/', (req, res) => {
    const roomStats = Object.entries(rooms).map(([roomId, users]) => ({
        room: roomId,
        name: roomConfig[roomId]?.name || roomId,
        users: users.length
    }));

    res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Clan RICH Signal Server</title>
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { background: #0a0a0f; color: #e0e0ff; font-family: 'Segoe UI', system-ui, sans-serif; padding: 2rem; max-width: 1200px; margin: 0 auto; }
                h1 { color: #667eea; margin-bottom: 1rem; }
                .status { background: rgba(102, 126, 234, 0.1); padding: 1rem; border-radius: 8px; margin: 1rem 0; border-left: 4px solid #667eea; }
                .online { color: #43b581; font-weight: bold; }
                .rooms { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 1rem; margin: 2rem 0; }
                .room-card { background: rgba(255,255,255,0.05); border-radius: 8px; padding: 1rem; border: 1px solid rgba(255,255,255,0.1); }
                .room-icon { font-size: 1.5rem; margin-bottom: 0.5rem; }
                .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 2rem 0; }
                .stat-card { background: rgba(102, 126, 234, 0.15); padding: 1.5rem; border-radius: 8px; text-align: center; }
                .stat-number { font-size: 2rem; font-weight: bold; color: #667eea; }
                code { background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; font-family: 'Consolas', monospace; }
                hr { border: none; border-top: 1px solid rgba(255,255,255,0.1); margin: 2rem 0; }
                @media (max-width: 600px) {
                    body { padding: 1rem; }
                    .rooms { grid-template-columns: 1fr; }
                }
            </style>
        </head>
        <body>
            <h1>🚀 Clan RICH — Signal Server v2.0</h1>
            <div class="status">
                <p>Статус: <span class="online">✓ ONLINE</span></p>
                <p>Порт: <b>${process.env.PORT || 8080}</b></p>
                <p>WebSocket: <code>wss://${req.headers.host}/ws</code></p>
            </div>
            
            <div class="stats">
                <div class="stat-card">
                    <div class="stat-number">${stats.totalConnections}</div>
                    <div>Всего подключений</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${stats.activeUsers}</div>
                    <div>Активных пользователей</div>
                </div>
                <div class="stat-card">
                    <div class="stat-number">${Object.keys(rooms).length}</div>
                    <div>Активных комнат</div>
                </div>
            </div>
            
            <h2>🏠 Доступные комнаты</h2>
            <div class="rooms">
                ${Object.entries(roomConfig).map(([id, config]) => `
                    <div class="room-card">
                        <div class="room-icon">${config.icon}</div>
                        <h3>${config.name}</h3>
                        <p>${config.description}</p>
                        <p>Пользователей: <b>${rooms[id] ? rooms[id].length : 0}</b></p>
                    </div>
                `).join('')}
            </div>
            
            <hr>
            <div style="opacity: 0.7; font-size: 0.9rem;">
                <p>Render • Node.js • ws • v2.0 с комнатами</p>
                <p>Версия: ${new Date().toLocaleString()}</p>
            </div>
        </body>
        </html>
    `);
});

app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'ok', 
        uptime: process.uptime(),
        rooms: Object.keys(rooms).length,
        totalUsers: stats.activeUsers,
        roomConfig: roomConfig
    });
});

// Получение информации о комнатах
app.get('/rooms', (req, res) => {
    const roomInfo = Object.entries(roomConfig).map(([id, config]) => ({
        id,
        name: config.name,
        icon: config.icon,
        description: config.description,
        userCount: rooms[id] ? rooms[id].length : 0
    }));
    
    res.status(200).json(roomInfo);
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
    
    stats.totalConnections++;
    stats.activeUsers++;

    console.log(`🔌 Новое соединение: ${clientId} | IP: ${request.socket.remoteAddress}`);

    // Отправляем клиенту конфигурацию комнат при подключении
    ws.send(JSON.stringify({
        type: 'server-info',
        roomConfig: roomConfig,
        serverTime: new Date().toISOString()
    }));

    ws.on('message', (data) => {
        try {
            const msg = JSON.parse(data);
            console.log(`📥 ${clientId} (${nickname}) →`, msg.type, msg.room || currentRoom || '');

            switch (msg.type) {
                case 'join':
                    const roomToJoin = msg.room || 'main';
                    
                    // Выходим из предыдущей комнаты если нужно
                    if (currentRoom && currentRoom !== roomToJoin) {
                        leaveRoom();
                    }
                    
                    nickname = msg.nickname || 'Anonymous';
                    currentRoom = roomToJoin;

                    // Создаем комнату если её нет
                    if (!rooms[currentRoom]) rooms[currentRoom] = [];
                    
                    // Проверяем, не в комнате ли уже пользователь
                    const existingUserIndex = rooms[currentRoom].findIndex(u => u.id === clientId);
                    if (existingUserIndex === -1) {
                        rooms[currentRoom].push({ id: clientId, ws, nickname, roomType: currentRoom });
                    }

                    // Сообщаем другим пользователям в этой комнате
                    broadcast(currentRoom, {
                        type: 'user-joined',
                        user: { 
                            id: clientId, 
                            nickname,
                            room: currentRoom,
                            roomName: roomConfig[currentRoom]?.name || currentRoom,
                            roomIcon: roomConfig[currentRoom]?.icon || '💬'
                        }
                    }, ws);

                    // Ответ клиенту с информацией о пользователях в комнате
                    const roomUsers = rooms[currentRoom]
                        .filter(u => u.id !== clientId)
                        .map(u => ({ id: u.id, nickname: u.nickname }));
                    
                    ws.send(JSON.stringify({
                        type: 'joined',
                        room: currentRoom,
                        roomName: roomConfig[currentRoom]?.name || currentRoom,
                        roomIcon: roomConfig[currentRoom]?.icon || '💬',
                        users: roomUsers,
                        roomCount: rooms[currentRoom].length
                    }));
                    break;

                case 'switch-room':
                    if (!msg.targetRoom) {
                        ws.send(JSON.stringify({ type: 'error', message: 'Не указана целевая комната' }));
                        break;
                    }
                    
                    // Проверяем существование комнаты
                    if (!roomConfig[msg.targetRoom]) {
                        ws.send(JSON.stringify({ 
                            type: 'error', 
                            message: `Комната "${msg.targetRoom}" не существует` 
                        }));
                        break;
                    }
                    
                    // Выходим из текущей комнаты
                    if (currentRoom) {
                        leaveRoom();
                    }
                    
                    // Присоединяемся к новой комнате
                    nickname = msg.nickname || nickname;
                    currentRoom = msg.targetRoom;
                    
                    if (!rooms[currentRoom]) rooms[currentRoom] = [];
                    rooms[currentRoom].push({ id: clientId, ws, nickname, roomType: currentRoom });
                    
                    // Сообщаем другим в новой комнате
                    broadcast(currentRoom, {
                        type: 'user-joined',
                        user: { 
                            id: clientId, 
                            nickname,
                            room: currentRoom,
                            roomName: roomConfig[currentRoom]?.name || currentRoom,
                            roomIcon: roomConfig[currentRoom]?.icon || '💬'
                        }
                    }, ws);
                    
                    // Отправляем подтверждение клиенту
                    const newRoomUsers = rooms[currentRoom]
                        .filter(u => u.id !== clientId)
                        .map(u => ({ id: u.id, nickname: u.nickname }));
                    
                    ws.send(JSON.stringify({
                        type: 'room-switched',
                        oldRoom: msg.oldRoom,
                        newRoom: currentRoom,
                        roomName: roomConfig[currentRoom]?.name || currentRoom,
                        roomIcon: roomConfig[currentRoom]?.icon || '💬',
                        users: newRoomUsers,
                        roomCount: rooms[currentRoom].length
                    }));
                    
                    console.log(`🔄 ${clientId} перешел из ${msg.oldRoom} в ${currentRoom}`);
                    break;

                case 'offer':
                case 'answer':
                case 'ice-candidate':
                    if (msg.targetId) {
                        const target = findClientById(msg.targetId);
                        if (target) {
                            target.send(JSON.stringify({
                                ...msg,
                                fromId: clientId,
                                fromNickname: nickname
                            }));
                        } else {
                            console.warn(`❌ Целевой клиент не найден: ${msg.targetId}`);
                        }
                    }
                    break;

                case 'text-message':
                    if (msg.message && msg.message.trim() && currentRoom) {
                        const timestamp = new Date().toISOString();
                        broadcast(currentRoom, {
                            type: 'text-message',
                            userId: clientId,
                            nickname: nickname,
                            message: msg.message,
                            timestamp: timestamp,
                            room: currentRoom
                        });
                    }
                    break;

                case 'leave':
                    leaveRoom();
                    break;
                    
                case 'ping':
                    ws.send(JSON.stringify({ type: 'pong', timestamp: Date.now() }));
                    break;

                default:
                    console.warn('Неизвестный тип:', msg.type);
            }
        } catch (e) {
            console.error('❌ Ошибка парсинга:', e);
            ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON' }));
        }
    });

    ws.on('close', () => {
        console.log(`📴 Соединение закрыто: ${clientId} (${nickname})`);
        leaveRoom();
        stats.activeUsers = Math.max(0, stats.activeUsers - 1);
    });

    ws.on('error', (err) => {
        console.error(`💥 Ошибка (${clientId}):`, err.message);
        leaveRoom();
        stats.activeUsers = Math.max(0, stats.activeUsers - 1);
    });

    // Вспомогательные функции
    function leaveRoom() {
        if (!currentRoom || !rooms[currentRoom]) return;

        const user = rooms[currentRoom].find(u => u.id === clientId);
        const nick = user ? user.nickname : nickname;

        // Удаляем из комнаты
        rooms[currentRoom] = rooms[currentRoom].filter(u => u.id !== clientId);
        if (rooms[currentRoom].length === 0) {
            delete rooms[currentRoom];
        }

        // Сообщаем остальным в комнате
        broadcast(currentRoom, {
            type: 'user-left',
            userId: clientId,
            nickname: nick,
            room: currentRoom
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

    function findClientById(id) {
        for (const roomId in rooms) {
            const user = rooms[roomId].find(u => u.id === id);
            if (user) return user.ws;
        }
        return null;
    }
});

// Очистка неактивных комнат каждые 5 минут
setInterval(() => {
    const now = Date.now();
    let cleaned = 0;
    
    for (const roomId in rooms) {
        rooms[roomId] = rooms[roomId].filter(user => {
            // Если соединение закрыто, удаляем пользователя
            if (user.ws.readyState !== 1) {
                cleaned++;
                return false;
            }
            return true;
        });
        
        if (rooms[roomId].length === 0) {
            delete rooms[roomId];
        }
    }
    
    if (cleaned > 0) {
        console.log(`🧹 Очищено ${cleaned} неактивных пользователей`);
    }
}, 5 * 60 * 1000);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🚀 HTTP + WebSocket сервер запущен на порту ${PORT}`);
    console.log(`🏠 Доступные комнаты: ${Object.keys(roomConfig).map(id => `${roomConfig[id].icon} ${roomConfig[id].name}`).join(', ')}`);
});
