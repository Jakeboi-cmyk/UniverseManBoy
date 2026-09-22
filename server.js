const http = require('http');
const fs = require('fs');
const path = require('path');
const { WebSocketServer } = require('ws');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const MAX_PLAYERS = 4;
const ROOM_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const rooms = new Map();

function cleanName(value) {
  const name = String(value || 'Charlie').replace(/[<>]/g, '').trim().slice(0, 16);
  return name || 'Charlie';
}
function cleanColor(value) {
  const v = String(value || '#f1c84b');
  return /^#[0-9a-fA-F]{6}$/.test(v) ? v : '#f1c84b';
}
function makeCode() {
  for (;;) {
    let code = '';
    for (let i = 0; i < 5; i++) code += ROOM_CHARS[Math.floor(Math.random() * ROOM_CHARS.length)];
    if (!rooms.has(code)) return code;
  }
}
function send(ws, msg) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}
function broadcast(room, msg, except = null) {
  for (const p of room.players.values()) {
    if (p.ws !== except) send(p.ws, msg);
  }
}
function lobby(room) {
  return [...room.players.values()].map(p => ({ id: p.id, name: p.name, color: p.color }));
}
function closePlayer(room, playerId) {
  const player = room.players.get(playerId);
  if (!player) return;
  room.players.delete(playerId);
  if (playerId === 0) {
    broadcast(room, { t: 'hostLeft' });
    for (const p of room.players.values()) {
      try { p.ws.close(); } catch (_) {}
    }
    rooms.delete(room.code);
    return;
  }
  broadcast(room, { t: 'playerLeft', id: playerId });
  if (room.players.size <= 1 && room.started) {
    // Keep the room alive so the host can continue solo or friends can rejoin.
  }
}
function getFreeSlot(room) {
  for (let i = 1; i < MAX_PLAYERS; i++) if (!room.players.has(i)) return i;
  return -1;
}
function sendLobby(room) {
  broadcast(room, { t: 'lobby', count: room.players.size, players: lobby(room) });
}

const server = http.createServer((req, res) => {
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, `http://${req.headers.host}`).pathname); }
  catch (_) { pathname = '/'; }
  if (pathname !== '/' && pathname !== '/game.html') {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }
  const file = path.join(__dirname, 'game.html');
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('game.html is missing');
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(data);
  });
});

const wss = new WebSocketServer({ server });

wss.on('connection', ws => {
  let room = null;
  let playerId = null;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch (_) { return; }
    if (!msg || typeof msg.t !== 'string') return;

    if (msg.t === 'createRoom') {
      if (room) return;
      const code = makeCode();
      room = { code, started: false, players: new Map() };
      const player = { id: 0, ws, name: cleanName(msg.profile?.name), color: cleanColor(msg.profile?.color) };
      room.players.set(0, player);
      playerId = 0;
      rooms.set(code, room);
      send(ws, { t: 'created', room: code, id: 0, max: MAX_PLAYERS });
      return;
    }

    if (msg.t === 'joinRoom') {
      if (room || playerId !== null) return;
      const code = String(msg.room || '').trim().toUpperCase();
      const target = rooms.get(code);
      if (!target) { send(ws, { t: 'error', code: 'ROOM_NOT_FOUND', message: 'Room not found.' }); return; }
      if (target.started) { send(ws, { t: 'error', code: 'ROOM_STARTED', message: 'That game has already started.' }); return; }
      if (target.players.size >= MAX_PLAYERS) { send(ws, { t: 'error', code: 'ROOM_FULL', message: 'Room is full.' }); return; }
      const id = getFreeSlot(target);
      if (id < 0) { send(ws, { t: 'error', code: 'ROOM_FULL', message: 'Room is full.' }); return; }
      room = target;
      playerId = id;
      const player = { id, ws, name: cleanName(msg.profile?.name), color: cleanColor(msg.profile?.color) };
      room.players.set(id, player);
      send(ws, { t: 'welcome', id, room: room.code, max: MAX_PLAYERS });
      send(ws, { t: 'lobby', count: room.players.size, players: lobby(room) });
      send(room.players.get(0).ws, { t: 'playerJoined', player: { id, name: player.name, color: player.color } });
      sendLobby(room);
      return;
    }

    if (!room || playerId === null) {
      send(ws, { t: 'error', code: 'NO_ROOM', message: 'Create or join a room first.' });
      return;
    }

    const me = room.players.get(playerId);
    if (!me) return;

    if (msg.t === 'profile') {
      me.name = cleanName(msg.name);
      me.color = cleanColor(msg.color);
      if (playerId === 0) {
        broadcast(room, { t: 'hostProfile', name: me.name, color: me.color }, ws);
      } else {
        const host = room.players.get(0);
        send(host?.ws, { t: 'profile', id: playerId, name: me.name, color: me.color });
        sendLobby(room);
      }
      return;
    }

    if (msg.t === 'startGame') {
      if (playerId !== 0) return;
      room.started = true;
      broadcast(room, { t: 'start', world: msg.world || 'main' });
      return;
    }

    if (msg.t === 'input') {
      if (playerId === 0) return;
      const host = room.players.get(0);
      if (host) send(host.ws, { ...msg, id: playerId, t: 'input' });
      return;
    }

    if (msg.t === 'state' || msg.t === 'lobby') {
      if (playerId !== 0) return;
      broadcast(room, msg, ws);
      return;
    }
  });

  ws.on('close', () => {
    if (room && playerId !== null) closePlayer(room, playerId);
  });
  ws.on('error', () => {});
});

server.listen(PORT, HOST, () => {
  console.log(`Milo Monster server running at http://localhost:${PORT}`);
});
