const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once, EventEmitter } = require('node:events');
const { WebSocket } = require('ws');
const { createBridge, hmac } = require('../server.cjs');
const { createGrpcAdapter, Service, grpc } = require('../youtube-grpc.cjs');
const { createHub } = require('../hub.cjs');
const extensionId = 'a'.repeat(32); const key = 'b'.repeat(64); const token = 'test-only-access-token-not-real';
const waitFor = async predicate => {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.fail('Timed out waiting for fixture event');
};
const fakeLookup = async () => ({ ok: true, status: 200, async json() { return { items: [{ id: 'videoA', snippet: { channelTitle: 'Fixture', title: 'Live' }, liveStreamingDetails: { activeLiveChatId: 'chat-A' } }] }; } });
async function connect(port, origin = `chrome-extension://${extensionId}`) {
  const socket = new WebSocket(`ws://127.0.0.1:${port}/youtube`, { origin });
  const messages = [];
  socket.on('message', raw => { const data = JSON.parse(raw); messages.push(data); if (data.type === 'heartbeat') socket.send(JSON.stringify({ type: 'heartbeat-ack' })); });
  await once(socket, 'open'); return { socket, messages };
}
async function join(socket, messages, proofKey = key, cursors = {}) {
  const nonce = 'c'.repeat(64); socket.send(JSON.stringify({ type: 'hello', nonce }));
  await waitFor(() => messages.some(message => message.type === 'hello'));
  const hello = messages.find(message => message.type === 'hello');
  assert.equal(hello.proof, hmac(key, 'server:' + nonce));
  socket.send(JSON.stringify({ type: 'join', proof: hmac(proofKey, `client:${hello.challenge}:${nonce}`), accessToken: token, videoIds: ['videoA'], cursors }));
}
test('real local gRPC protobuf stream reaches WebSocket; cursor, auth metadata, moderation, and cancellation survive transport', async t => {
  const upstream = new grpc.Server(); let call; let cancelled = false;
  upstream.addService(Service.service, { streamList(incoming) {
    call = incoming; incoming.on('cancelled', () => { cancelled = true; });
    incoming.write({ nextPageToken: 'cursor-next', items: [{ id: 'm1', snippet: { type: 'TEXT_MESSAGE_EVENT', liveChatId: 'chat-A', publishedAt: '2026-10-27T08:00:00Z', textMessageDetails: { messageText: 'Hello from gRPC' } }, authorDetails: { displayName: 'Viewer', channelId: 'author-A' } }] });
  } });
  const port = await new Promise((resolve, reject) => upstream.bindAsync('127.0.0.1:0', grpc.ServerCredentials.createInsecure(), (error, value) => error ? reject(error) : resolve(value)));
  const bridge = createBridge({ extensionId, key, adapter: createGrpcAdapter({ address: `127.0.0.1:${port}`, credentials: grpc.credentials.createInsecure() }), fetcher: fakeLookup });
  t.after(async () => { await bridge.close(); upstream.forceShutdown(); });
  const address = await bridge.listen(0); const { socket, messages } = await connect(address.port);
  await join(socket, messages, key, { videoA: 'cursor-prior' });
  await waitFor(() => messages.some(message => message.type === 'page'));
  assert.equal(call.metadata.get('authorization')[0], `Bearer ${token}`);
  assert.equal(call.request.pageToken, 'cursor-prior');
  assert.deepEqual(call.request.part, ['id', 'snippet', 'authorDetails']);
  const page = messages.find(message => message.type === 'page').page;
  assert.equal(page.nextPageToken, 'cursor-next');
  assert.equal(page.items[0].snippet.type, 'textMessageEvent');
  assert.equal(page.items[0].authorDetails.displayName, 'Viewer');
  call.write({ items: [{ id: 'm1', snippet: { type: 'TOMBSTONE', liveChatId: 'chat-A', publishedAt: '2026-10-27T08:01:00Z' } },
    { id: 'ban', snippet: { type: 'USER_BANNED_EVENT', liveChatId: 'chat-A', publishedAt: '2026-10-27T08:01:00Z', userBannedDetails: { bannedUserDetails: { channelId: 'author-A' } } } }] });
  await waitFor(() => messages.filter(message => message.type === 'page').length === 2);
  assert.equal(messages.filter(message => message.type === 'page')[1].page.items[1].snippet.type, 'userBannedEvent');
  assert.equal(JSON.stringify(messages).includes(token), false);
  socket.close(); await once(socket, 'close'); await waitFor(() => cancelled);
});
test('bridge rejects web-page origins and wrong proof before Google lookup; heartbeat handles idle clients', async t => {
  let lookups = 0;
  const bridge = createBridge({ extensionId, key, adapter: { close() {} }, heartbeatMs: 30, fetcher: async () => { lookups++; return fakeLookup(); } });
  t.after(() => bridge.close()); const address = await bridge.listen(0);
  const forbidden = new WebSocket(`ws://127.0.0.1:${address.port}/youtube`, { origin: 'https://www.youtube.com' });
  const [error] = await once(forbidden, 'error'); assert.match(error.message, /403/);
  const { socket, messages } = await connect(address.port);
  const closed = once(socket, 'close'); await join(socket, messages, 'd'.repeat(64));
  assert.equal((await closed)[0], 1008); assert.equal(lookups, 0);
  const idle = new WebSocket(`ws://127.0.0.1:${address.port}/youtube`, { origin: `chrome-extension://${extensionId}` });
  await once(idle, 'open'); await once(idle, 'close'); assert.equal(lookups, 0);
  const health = await fetch(`http://127.0.0.1:${address.port}/health`); assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), { app: 'CrossChat', protocol: 1 });
  const denied = await fetch(`http://127.0.0.1:${address.port}/health`, { headers: { Origin: 'https://evil.example' } }); assert.equal(denied.status, 403);
});
test('hub shares identical authorization only, resumes cursors, and stops retries on quota/auth errors', () => {
  const calls = []; const timers = new Map(); let serial = 0;
  const adapter = { open(params) { const call = new EventEmitter(); call.cancel = () => { call.cancelled = true; }; calls.push({ params, call }); return call; } };
  const hub = createHub({ adapter, delay(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; }, cancel(id) { timers.delete(id); } });
  const events = []; const subscribe = (credential, listener = event => events.push(event)) => hub.subscribe({ token: credential, videoId: 'videoA', liveChatId: 'chat-A' }, listener);
  const a = subscribe(token); const b = subscribe(token, () => {}); const c = subscribe('another-token');
  assert.equal(calls.length, 2); assert.equal(hub.size, 2);
  calls[0].call.emit('data', { nextPageToken: 'resume', items: [] });
  calls[0].call.emit('error', { code: 14, details: 'do not disclose provider payload' });
  assert.equal([...timers.values()][0].ms, 2000);
  const timer = [...timers.values()][0]; timers.clear(); timer.fn();
  assert.equal(calls[2].params.pageToken, 'resume');
  calls[2].call.emit('error', { code: 8 }); assert.equal(timers.size, 0);
  assert.match(events.at(-1).message, /quota/);
  a(); assert.equal(hub.size, 2); b(); assert.equal(hub.size, 1);
  calls[1].call.emit('error', { code: 16 }); assert.equal(events.at(-1).type, 'auth-required');
  c(); assert.equal(hub.size, 0); assert.equal(JSON.stringify(events).includes('provider payload'), false); hub.close();
});
test('hub resets an invalid continuation once and cancels pending retry when last subscriber leaves', () => {
  let pending; let cancelled = false; const requests = []; const events = [];
  const hub = createHub({ adapter: { open(params) { const call = new EventEmitter(); call.cancel = () => {}; requests.push({ params, call }); return call; } },
    delay(fn) { pending = fn; return 1; }, cancel() { cancelled = true; } });
  const stop = hub.subscribe({ token, videoId: 'videoA', liveChatId: 'chat-A', pageToken: 'invalid' }, event => events.push(event));
  requests[0].call.emit('error', { code: 3 }); pending();
  assert.equal(requests[1].params.pageToken, null);
  requests[1].call.emit('error', { code: 3 }); assert.equal(events.at(-1).state, 'error');
  stop(); assert.equal(cancelled, true); assert.equal(hub.size, 0); hub.close();
});
