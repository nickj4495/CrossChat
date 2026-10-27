const http = require('node:http');
const { randomBytes, createHmac, timingSafeEqual } = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');
const { createGrpcAdapter } = require('./youtube-grpc.cjs');
const { createHub } = require('./hub.cjs');
const { createOAuth } = require('./oauth.cjs');
function normalizeOrigin(value) {
  if (/^[a-p]{32}$/.test(value || '')) return `chrome-extension://${value}`;
  if (typeof value !== 'string' || !/^(chrome-extension|moz-extension|safari-web-extension):\/\/[a-zA-Z0-9_-]+$/.test(value)) throw new Error('Provide the exact extension origin shown in CrossChat Connections.');
  return value;
}
const hmac = (key, text) => createHmac('sha256', key).update(text).digest('hex');
function equal(a, b) { return typeof a === 'string' && /^[a-f0-9]{64}$/.test(a) && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex')); }
function createBridge({ extensionId, extensionOrigin, key = randomBytes(32).toString('hex'), adapter, fetcher = fetch,
  heartbeatMs = 20000, hubOptions = {}, oauthConfig = {} } = {}) {
  const origin = normalizeOrigin(extensionOrigin || extensionId);
  if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('The backend key must be 64 lowercase hexadecimal characters.');
  const oauth = createOAuth({ config: oauthConfig, fetcher });
  const hub = createHub({ adapter: adapter || createGrpcAdapter(), ...hubOptions });
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 65536, perMessageDeflate: false });
  const server = http.createServer(async (request, response) => {
    if (!validHost(request.headers.host) || request.headers.origin && request.headers.origin !== origin) {
      response.writeHead(403); response.end(); return;
    }
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    response.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    if (request.method === 'GET' && /^\/oauth\/(google|twitch)\/callback\?/.test(request.url)) {
      const accepted = await oauth.callback(new URL(request.url, `http://127.0.0.1:${server.address().port}`));
      response.writeHead(accepted ? 200 : 400, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end(accepted ? 'CrossChat sign-in processed. You can close this tab and reopen CrossChat.' : 'Invalid or expired CrossChat sign-in. Start again from the extension.'); return;
    }
    if (request.url === '/health' && request.method === 'GET') {
      response.setHeader('Content-Type', 'application/json'); response.end(JSON.stringify({ app: 'CrossChat', protocol: 1 }));
    } else { response.writeHead(404); response.end(); }
  });
  const validHost = host => host === `127.0.0.1:${server.address()?.port}`;
  server.on('upgrade', (request, socket, head) => {
    if (request.url !== '/youtube' || !validHost(request.headers.host) || request.headers.origin !== origin) {
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    websocket.handleUpgrade(request, socket, head, connection => websocket.emit('connection', connection));
  });
  websocket.on('connection', socket => {
    let challenge = null; let clientNonce = null; let authenticated = false; let joining = false;
    let generation = 0; let subscriptions = []; let abort = new AbortController(); let cancelAuth = null;
    let lastAck = Date.now(); let lastJoin = 0;
    const send = data => {
      if (socket.readyState !== WebSocket.OPEN) return;
      if (socket.bufferedAmount > 1024 * 1024) { socket.close(1013, 'Client is too slow'); return; }
      socket.send(JSON.stringify(data));
    };
    const dispose = () => { generation++; abort.abort(); abort = new AbortController(); subscriptions.forEach(stop => stop()); subscriptions = []; };
    const heartbeat = setInterval(() => {
      if (Date.now() - lastAck > heartbeatMs * 3) { socket.terminate(); return; }
      send({ type: 'heartbeat' });
    }, heartbeatMs); heartbeat.unref();
    const authDeadline = setTimeout(() => { if (!authenticated) socket.close(1008, 'Connection authentication timed out'); }, 15000); authDeadline.unref();
    socket.on('close', () => { clearInterval(heartbeat); clearTimeout(authDeadline); cancelAuth?.(); dispose(); });
    socket.on('error', () => {});
    socket.on('message', async (raw, binary) => {
      if (binary) { socket.close(1008, 'Text messages required'); return; }
      let request;
      try { request = JSON.parse(raw.toString()); } catch { socket.close(1008, 'Invalid request'); return; }
      if (request?.type === 'heartbeat-ack') { lastAck = Date.now(); return; }
      if (request?.type === 'hello') {
        if (challenge || typeof request.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(request.nonce)) { socket.close(1008, 'Invalid handshake'); return; }
        clientNonce = request.nonce; challenge = randomBytes(32).toString('hex');
        send({ type: 'hello', protocol: 1, challenge, proof: hmac(key, 'server:' + clientNonce) }); return;
      }
      if (!['join', 'oauth'].includes(request?.type) || !challenge || !equal(request.proof, hmac(key, `client:${challenge}:${clientNonce}`))) {
        socket.close(1008, 'Invalid connection proof'); return;
      }
      if (request.type === 'oauth') {
        if (authenticated) { socket.close(1008, 'One sign-in per connection'); return; }
        authenticated = true; clearTimeout(authDeadline);
        try {
          const result = oauth.begin(request.provider, send, server.address().port, request.clientId);
          cancelAuth = result.cancel; send({ type: 'auth-url', url: result.url });
        } catch (error) { send({ type: 'auth-error', message: error.message }); }
        return;
      }
      if (joining || Date.now() - lastJoin < 1000) { send({ type: 'error', message: 'Wait before restarting this connection.' }); return; }
      if (typeof request.accessToken !== 'string' || !/^[\x21-\x7e]{20,4096}$/.test(request.accessToken) ||
          !Array.isArray(request.videoIds) || request.videoIds.length < 1 || request.videoIds.length > 10 ||
          new Set(request.videoIds).size !== request.videoIds.length || request.videoIds.some(id => typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id))) {
        socket.close(1008, 'Invalid chat subscription'); return;
      }
      authenticated = true; clearTimeout(authDeadline); joining = true; lastJoin = Date.now(); lastAck = Date.now();
      dispose(); const expected = generation; const token = request.accessToken;
      try {
        const url = new URL('https://www.googleapis.com/youtube/v3/videos');
        url.search = new URLSearchParams({ part: 'snippet,liveStreamingDetails', id: request.videoIds.join(',') });
        const response = await fetcher(url.href, { headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.any([abort.signal, AbortSignal.timeout(15000)]), redirect: 'error' });
        if (expected !== generation || socket.readyState !== WebSocket.OPEN) return;
        if (response.status === 401) { send({ type: 'auth-required', message: 'Google authorization needs renewal.' }); return; }
        if (!response.ok) { send({ type: 'error', message: response.status === 403 ? 'YouTube lookup denied. Check project quota, API access, and permissions.' : 'YouTube video lookup failed.' }); return; }
        const data = await response.json();
        if (expected !== generation || socket.readyState !== WebSocket.OPEN) return;
        for (const videoId of request.videoIds) {
          const video = data.items?.find(item => item.id === videoId);
          const chatId = video?.liveStreamingDetails?.activeLiveChatId;
          if (typeof chatId !== 'string' || !chatId) { send({ type: 'source-status', videoId, state: 'error', message: 'No active live chat for this video.' }); continue; }
          send({ type: 'source', videoId, liveChatId: chatId, label: `${video.snippet?.channelTitle || 'YouTube'} · ${(video.snippet?.title || videoId).slice(0, 120)}` });
          const resume = request.cursors?.[videoId];
          const unsubscribe = hub.subscribe({ token, videoId, liveChatId: chatId, pageToken: typeof resume === 'string' && resume.length <= 8192 ? resume : null }, send);
          subscriptions.push(unsubscribe);
        }
      } catch {
        if (expected === generation) send({ type: 'error', message: 'Could not connect to YouTube. Check connectivity and retry.' });
      } finally { joining = false; }
    });
  });
  return { server, key,
    listen: (port = 47831) => new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => resolve(server.address())); }),
    async close() { oauth.close(); websocket.clients.forEach(socket => socket.terminate()); await new Promise(resolve => websocket.close(resolve)); hub.close(); await new Promise(resolve => server.close(resolve)); }
  };
}
if (require.main === module) {
  (async () => {
    let extensionId = process.env.CROSSCHAT_EXTENSION_ORIGIN || process.env.CROSSCHAT_EXTENSION_ID;
    if (!extensionId && process.stdin.isTTY) {
      const reader = require('node:readline/promises').createInterface({ input: process.stdin, output: process.stdout });
      extensionId = (await reader.question('CrossChat extension origin (from Connections; Chrome ID also accepted): ')).trim(); reader.close();
    }
    const bridge = createBridge({ extensionId, key: process.env.CROSSCHAT_BACKEND_KEY || undefined, oauthConfig: {
      google: { clientId: process.env.CROSSCHAT_GOOGLE_CLIENT_ID, clientSecret: process.env.CROSSCHAT_GOOGLE_CLIENT_SECRET },
      twitch: { clientId: process.env.CROSSCHAT_TWITCH_CLIENT_ID, clientSecret: process.env.CROSSCHAT_TWITCH_CLIENT_SECRET }
    } });
    await bridge.listen();
    console.log('CrossChat backend listening at 127.0.0.1:47831 (local only).');
    console.log('Connection key — paste into CrossChat Local backend settings:');
    console.log(bridge.key);
    const shutdown = () => bridge.close().finally(() => process.exit(0));
    process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
  })().catch(() => { console.error('Backend could not start. Check CROSSCHAT_EXTENSION_ID and that port 47831 is free.'); process.exitCode = 1; });
}
module.exports = { createBridge, hmac, normalizeOrigin };
