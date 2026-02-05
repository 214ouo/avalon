// server.js - 游戏服务器
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);
const PORT = process.env.PORT || 3000;

// 存储游戏房间数据
const gameRooms = new Map();

// 角色定义
const ROLES = [
  { name: "忠臣", team: "blue", description: "忠诚的圆桌骑士" },
  { name: "忠臣", team: "blue", description: "忠诚的圆桌骑士" },
  { name: "忠臣", team: "blue", description: "忠诚的圆桌骑士" },
  { name: "幻妖", team: "purple", description: "邪恶阵营的迷惑者" },
  { name: "摩根勒菲", team: "red", description: "邪恶的女巫" }
];

// 生成随机房间代码
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 4; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// 创建新游戏房间
function createGameRoom() {
  const roomCode = generateRoomCode();
  
  // 打乱角色分配
  const shuffledRoles = [...ROLES].sort(() => Math.random() - 0.5);
  const players = shuffledRoles.map((role, index) => ({
    seat: index + 1,
    role: role.name,
    team: role.team,
    description: role.description,
    viewed: false
  }));
  
  // 记录幻妖和摩根勒菲的位置
  let phantomSeat = -1;
  let morganSeat = -1;
  players.forEach((player, index) => {
    if (player.role === "幻妖") phantomSeat = player.seat;
    if (player.role === "摩根勒菲") morganSeat = player.seat;
  });
  
  const roomData = {
    code: roomCode,
    players: players,
    phantomSeat: phantomSeat,
    morganSeat: morganSeat,
    createdAt: Date.now(),
    viewers: new Set() // 已查看的玩家座位号
  };
  
  gameRooms.set(roomCode, roomData);
  console.log(`房间已创建: ${roomCode}, 幻妖座位: ${phantomSeat}, 摩根勒菲座位: ${morganSeat}`);
  
  return roomCode;
}

// 获取玩家信息
function getPlayerInfo(roomCode, seatNumber) {
  const room = gameRooms.get(roomCode);
  if (!room) return null;
  
  const player = room.players.find(p => p.seat === seatNumber);
  if (!player) return null;
  
  // 构建返回数据
  const data = {
    seat: player.seat,
    role: player.role,
    team: player.team,
    description: player.description
  };
  
  // 如果是摩根勒菲，添加幻妖信息
  if (player.role === "摩根勒菲" && room.phantomSeat !== -1) {
    data.specialInfo = {
      type: "morgan_knows_phantom",
      phantomSeat: room.phantomSeat
    };
  }
  
  // 如果是幻妖，添加特殊说明
  if (player.role === "幻妖") {
    data.specialInfo = {
      type: "phantom_info",
      message: "摩根勒菲认识你，但你不知道她是谁"
    };
  }
  
  // 标记为已查看
  room.viewers.add(seatNumber);
  
  return data;
}

// 获取房间状态
function getRoomStatus(roomCode) {
  const room = gameRooms.get(roomCode);
  if (!room) return null;
  
  return {
    code: room.code,
    totalPlayers: 5,
    viewedPlayers: room.viewers.size,
    allViewed: room.viewers.size === 5
  };
}

// 清理过期房间（1小时后）
function cleanupOldRooms() {
  const now = Date.now();
  const oneHour = 60 * 60 * 1000;
  
  for (const [code, room] of gameRooms.entries()) {
    if (now - room.createdAt > oneHour) {
      gameRooms.delete(code);
      console.log(`清理过期房间: ${code}`);
    }
  }
}

// 每30分钟清理一次
setInterval(cleanupOldRooms, 30 * 60 * 1000);

// 中间件
app.use(express.static('public'));
app.use(express.json());

// API路由
app.post('/api/create-room', (req, res) => {
  const roomCode = createGameRoom();
  res.json({ success: true, roomCode });
});

app.post('/api/join-room', (req, res) => {
  const { roomCode } = req.body;
  const room = gameRooms.get(roomCode);
  
  if (!room) {
    return res.json({ success: false, message: "房间不存在" });
  }
  
  res.json({ 
    success: true, 
    roomCode,
    totalPlayers: 5
  });
});

app.post('/api/get-role', (req, res) => {
  const { roomCode, seatNumber } = req.body;
  
  const room = gameRooms.get(roomCode);
  if (!room) {
    return res.json({ success: false, message: "房间不存在" });
  }
  
  if (seatNumber < 1 || seatNumber > 5) {
    return res.json({ success: false, message: "座位号无效" });
  }
  
  const playerInfo = getPlayerInfo(roomCode, seatNumber);
  if (!playerInfo) {
    return res.json({ success: false, message: "获取角色失败" });
  }
  
  const roomStatus = getRoomStatus(roomCode);
  
  res.json({
    success: true,
    player: playerInfo,
    roomStatus: roomStatus
  });
});

app.get('/api/room-status/:roomCode', (req, res) => {
  const { roomCode } = req.params;
  const roomStatus = getRoomStatus(roomCode);
  
  if (!roomStatus) {
    return res.json({ success: false, message: "房间不存在" });
  }
  
  res.json({ success: true, ...roomStatus });
});

// 提供前端页面
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Socket.io 实时通信
io.on('connection', (socket) => {
  console.log('新客户端连接');
  
  socket.on('join-room', (roomCode) => {
    socket.join(roomCode);
    console.log(`客户端加入房间: ${roomCode}`);
    
    const roomStatus = getRoomStatus(roomCode);
    if (roomStatus) {
      io.to(roomCode).emit('room-update', roomStatus);
    }
  });
  
  socket.on('player-viewed', ({ roomCode, seatNumber }) => {
    const roomStatus = getRoomStatus(roomCode);
    if (roomStatus) {
      io.to(roomCode).emit('room-update', roomStatus);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('客户端断开连接');
  });
});

// 启动服务器
server.listen(PORT, () => {
  console.log(`服务器运行在 http://localhost:${PORT}`);
  console.log(`游戏房间API已就绪`);
});