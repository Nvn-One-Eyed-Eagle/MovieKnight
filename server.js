const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── WebSocket helpers ────────────────────────────────────────────────────────

function wsHandshake(req, socket) {
  const key = req.headers['sec-websocket-key'];
  const accept = crypto
    .createHash('sha1')
    .update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11')
    .digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
}

function wsFrame(data) {
  const payload = Buffer.from(typeof data === 'string' ? data : JSON.stringify(data));
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function wsParse(buffer) {
  if (buffer.length < 2) return null;
  const opcode = buffer[0] & 0x0f;
  if (opcode === 0x8) return { type: 'close', consumed: 2 };
  if (opcode === 0x9) return { type: 'ping', consumed: 2 };
  const masked = (buffer[1] & 0x80) !== 0;
  let payloadLen = buffer[1] & 0x7f;
  let offset = 2;
  if (payloadLen === 126) {
    if (buffer.length < 4) return null;
    payloadLen = buffer.readUInt16BE(2); offset = 4;
  } else if (payloadLen === 127) {
    if (buffer.length < 10) return null;
    payloadLen = Number(buffer.readBigUInt64BE(2)); offset = 10;
  }
  const maskLen = masked ? 4 : 0;
  if (buffer.length < offset + maskLen + payloadLen) return null;
  let payload;
  if (masked) {
    const mask = buffer.slice(offset, offset + 4);
    offset += 4;
    payload = Buffer.alloc(payloadLen);
    for (let i = 0; i < payloadLen; i++) payload[i] = buffer[offset + i] ^ mask[i % 4];
  } else {
    payload = buffer.slice(offset, offset + payloadLen);
  }
  return { type: 'message', data: payload.toString(), consumed: offset + payloadLen };
}

// ─── Room state ───────────────────────────────────────────────────────────────

const rooms = {};

function makeId() { return crypto.randomBytes(6).toString('hex'); }

function getOrCreateRoom(roomId) {
  if (!rooms[roomId]) {
    rooms[roomId] = {
      clients: new Map(), // socket -> { name, isHost, clientId }
      state: { playing: false, currentTime: 0, lastUpdate: Date.now() },
      mode: null,        // 'local' | 'youtube' | 'webrtc'
      ytVideoId: null,
    };
  }
  return rooms[roomId];
}

function broadcast(room, msg, excludeSocket = null) {
  const frame = wsFrame(msg);
  for (const [sock] of room.clients) {
    if (sock !== excludeSocket && !sock.destroyed) sock.write(frame);
  }
}

function sendTo(socket, msg) {
  if (!socket.destroyed) socket.write(wsFrame(msg));
}

function roomInfo(room) {
  return Array.from(room.clients.values()).map(c => ({
    name: c.name, isHost: c.isHost, clientId: c.clientId
  }));
}

function findSocketByClientId(room, clientId) {
  for (const [sock, info] of room.clients) {
    if (info.clientId === clientId) return sock;
  }
  return null;
}

// ─── HTTP server ──────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // Allow ngrok to pass through without the browser warning interstitial
  res.setHeader('ngrok-skip-browser-warning', 'true');

  if (req.method === 'GET' && req.url === '/') {
    fs.readFile(path.join(__dirname, 'index.html'), (err, data) => {
      if (err) { res.writeHead(500); res.end('Error'); return; }
      res.writeHead(200, {
        'Content-Type': 'text/html',
        'ngrok-skip-browser-warning': 'true',
      });
      res.end(data);
    });
    return;
  }
  res.writeHead(404); res.end('Not found');
});

// ─── WebSocket upgrade ────────────────────────────────────────────────────────

server.on('upgrade', (req, socket) => {
  if (req.headers.upgrade?.toLowerCase() !== 'websocket') { socket.destroy(); return; }
  wsHandshake(req, socket);

  const url = new URL(req.url, 'http://localhost');
  const roomId    = url.searchParams.get('room') || 'default';
  const name      = url.searchParams.get('name') || 'Anonymous';
  const wantsHost = url.searchParams.get('host') === '1';

  const room = getOrCreateRoom(roomId);
  const existingHost = Array.from(room.clients.values()).find(c => c.isHost);
  const actuallyHost = wantsHost && !existingHost;
  const clientId = makeId();

  room.clients.set(socket, { name, isHost: actuallyHost, clientId });
  console.log(`[${roomId}] ${name} (${clientId}) joined. host=${actuallyHost} total=${room.clients.size}`);

  // Send full init state
  sendTo(socket, {
    type: 'init',
    state: room.state,
    isHost: actuallyHost,
    clientId,
    members: roomInfo(room),
    mode: room.mode,
    ytVideoId: room.ytVideoId,
  });

  broadcast(room, { type: 'members', members: roomInfo(room) });
  broadcast(room, { type: 'system', text: `${name} joined the room` }, socket);

  // New guest joining an active WebRTC room → ask host to send them an offer
  if (!actuallyHost && room.mode === 'webrtc') {
    for (const [sock, info] of room.clients) {
      if (info.isHost) {
        sendTo(sock, { type: 'webrtc:new-guest', guestId: clientId, guestName: name });
        break;
      }
    }
  }

  let buffer = Buffer.alloc(0);

  socket.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    while (buffer.length >= 2) {
      const frame = wsParse(buffer);
      if (!frame) break;
      buffer = buffer.slice(frame.consumed);
      if (frame.type === 'close') { socket.destroy(); break; }
      if (frame.type !== 'message') continue;

      let msg;
      try { msg = JSON.parse(frame.data); } catch { continue; }

      const client = room.clients.get(socket);
      if (!client) continue;

      // Chat
      if (msg.type === 'chat') {
        broadcast(room, { type: 'chat', name: client.name, text: msg.text });
      }

      // Emoji
      if (msg.type === 'emoji' && msg.emoji) {
        broadcast(room, { type: 'emoji', emoji: msg.emoji }, socket);
      }

      // Playback — host only
      if (msg.type === 'control' && client.isHost) {
        room.state = { playing: msg.playing, currentTime: msg.currentTime, lastUpdate: Date.now() };
        broadcast(room, { type: 'control', playing: msg.playing, currentTime: msg.currentTime }, socket);
      }

      if (msg.type === 'seek' && client.isHost) {
        room.state.currentTime = msg.currentTime;
        room.state.lastUpdate  = Date.now();
        broadcast(room, { type: 'seek', currentTime: msg.currentTime }, socket);
      }

      // Mode switching — host only
      if (msg.type === 'set-mode' && client.isHost) {
        room.mode      = msg.mode;
        room.ytVideoId = msg.ytVideoId || null;
        room.state     = { playing: false, currentTime: 0, lastUpdate: Date.now() };
        broadcast(room, { type: 'mode-set', mode: msg.mode, ytVideoId: room.ytVideoId });
      }

      // WebRTC signaling relay (targeted by clientId)
      if (['webrtc:offer','webrtc:answer','webrtc:ice'].includes(msg.type)) {
        const target = findSocketByClientId(room, msg.to);
        if (target) sendTo(target, { ...msg, from: client.clientId });
      }

      // Host announces stream ready → tell all guests
      if (msg.type === 'webrtc:ready' && client.isHost) {
        broadcast(room, { type: 'webrtc:ready' }, socket);
      }
    }
  });

  socket.on('close', () => {
    const client = room.clients.get(socket);
    if (!client) return;
    room.clients.delete(socket);
    console.log(`[${roomId}] ${client.name} left. total=${room.clients.size}`);
    broadcast(room, { type: 'members', members: roomInfo(room) });
    broadcast(room, { type: 'system', text: `${client.name} left the room` });
    if (room.clients.size === 0) delete rooms[roomId];
  });

  socket.on('error', () => socket.destroy());
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`\n🎬 Watch Party Server running!`);
  console.log(`   Open: http://localhost:${PORT}\n`);
});