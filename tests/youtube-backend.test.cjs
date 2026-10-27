const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const { webcrypto, createHmac } = require('node:crypto');
const proof = (key, text) => createHmac('sha256', key).update(text).digest('hex');
const connectionKey = 'b'.repeat(64);
function storage(initial = {}) {
  const data = { ...initial };
  return { data, async get(key) { return typeof key === 'object' ? { ...key, ...structuredClone(data) } : { [key]: structuredClone(data[key]) }; }, async set(values) { Object.assign(data, structuredClone(values)); } };
}
function harness() {
  const session = storage({ 'youtubeBackendKey:v1': connectionKey }); const local = storage({ enabled: true });
  const sockets = []; const timers = new Map(); const tokens = []; let serial = 0; let clock = 0; let connected = true;
  let room = { key: 'room', sources: [{ key: 'youtube:videoA', label: 'A', platform: 'youtube' }, { key: 'youtube:videoB', label: 'B', platform: 'youtube' }] };
  const env = { CrossChat: {}, TextEncoder, Uint8Array, crypto: webcrypto }; vm.createContext(env);
  for (const file of ['youtube-messages.js', 'youtube-backend.js', 'youtube-router.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), env);
  const dependencies = { auth: { async state() { return { connected }; }, async streamToken(refresh) { tokens.push(refresh); return 'fixture-token-never-persist'; } },
    session, local, service: { async getPair() { return room; } }, publish() {}, cryptography: webcrypto,
    now: () => clock, delay(fn, ms) { const id = ++serial; timers.set(id, { fn, ms }); return id; }, cancel(id) { timers.delete(id); },
    socketFactory(url) { const socket = { url, readyState: 0, sent: [], closed: false, send(value) { this.sent.push(JSON.parse(value)); }, close() { this.closed = true; this.readyState = 3; this.onclose?.(); },
      open() { this.readyState = 1; this.onopen(); }, receive(data) { this.onmessage({ data: JSON.stringify(data) }); } }; sockets.push(socket); return socket; }
  };
  const live = env.CrossChat.createYouTubeBackend(dependencies);
  const flush = () => new Promise(resolve => setTimeout(resolve, 15));
  const handshake = async (socket = sockets.at(-1), wrong = false) => {
    socket.open(); const nonce = socket.sent.at(-1).nonce;
    socket.receive({ type: 'hello', protocol: 1, challenge: 'c'.repeat(64), proof: proof(wrong ? 'wrong' : connectionKey, 'server:' + nonce) }); await flush();
  };
  const fire = async ms => { const found = [...timers].find(([, timer]) => timer.ms === ms); assert.ok(found, `No timer at ${ms}ms`); timers.delete(found[0]); clock += ms; found[1].fn(); await flush(); };
  const item = (id, type = 'textMessageEvent', extra = {}) => ({ id, snippet: { liveChatId: 'chat-A', publishedAt: '2026-10-27T09:00:00Z', type, textMessageDetails: { messageText: 'native text' }, ...extra }, authorDetails: { displayName: 'Viewer', channelId: 'user-A' } });
  return { env, dependencies, live, session, local, sockets, tokens, timers, flush, handshake, fire, item,
    setRoom(value) { room = value; }, setConnected(value) { connected = value; } };
}
test('streaming verifies backend before requesting Google token, isolates sources, handles moderation and stops cleanly', async () => {
  const h = harness(); await h.live.sync(); assert.equal(h.sockets.length, 0);
  await h.live.start(); const socket = h.sockets[0]; assert.equal(socket.url, 'ws://127.0.0.1:47831/youtube');
  assert.equal(h.tokens.length, 0); await h.handshake();
  const join = socket.sent.find(data => data.type === 'join'); assert.ok(join);
  assert.equal(join.proof, proof(connectionKey, `client:${'c'.repeat(64)}:${socket.sent[0].nonce}`));
  assert.equal(join.accessToken, 'fixture-token-never-persist'); assert.deepEqual(join.videoIds, ['videoA', 'videoB']);
  socket.receive({ type: 'source', videoId: 'videoA', liveChatId: 'chat-A', label: 'Live source A' });
  const page = { type: 'page', videoId: 'videoA', liveChatId: 'chat-A', page: { nextPageToken: 'cursor-1', items: [h.item('one'), h.item('two')] } };
  socket.receive(page); socket.receive(page); socket.receive({ type: 'source-status', videoId: 'videoA', state: 'streaming' }); await h.flush();
  assert.equal(h.live.getMessages('room').length, 2); assert.equal(h.live.getMessages('other').length, 0); assert.equal(h.live.getStatus().state, 'streaming');
  assert.equal(h.live.getMessages('room')[0].sourceLabel, 'Live source A');
  socket.receive({ ...page, liveChatId: 'wrong', page: { items: [h.item('wrong')] } });
  socket.receive({ ...page, page: { items: [h.item('one', 'tombstone')] } }); await h.flush();
  assert.equal(h.live.getMessages('room').length, 1);
  await h.fire(500); assert.equal(h.session.data['youtubeBackendRun:v1'].cursors.videoA, 'cursor-1');
  assert.equal(JSON.stringify(h.session.data).includes('fixture-token'), false);
  assert.equal(JSON.stringify(h.live.getStatus()).includes(connectionKey), false);
  await h.live.pause(); assert.equal(socket.closed, true); assert.equal(h.timers.size, 0); assert.equal(h.live.getMessages('room').length, 0);
  socket.receive(page); await h.flush(); assert.equal(h.live.getMessages('room').length, 0);
});
test('wrong backend proof never obtains/sends a Google token and never triggers polling', async () => {
  const h = harness(); await h.live.start(); await h.handshake(h.sockets[0], true);
  assert.equal(h.tokens.length, 0); assert.equal(h.sockets[0].sent.some(data => data.type === 'join'), false);
  assert.equal(h.live.getStatus().state, 'error'); assert.equal(h.timers.size, 0); await h.live.sync(); assert.equal(h.sockets.length, 1);
});
test('disconnect resumes checkpoint with bounded retries and token renewal is bounded', async () => {
  const h = harness(); await h.live.start(); await h.handshake();
  let socket = h.sockets[0]; socket.receive({ type: 'source', videoId: 'videoA', liveChatId: 'chat-A' });
  socket.receive({ type: 'page', videoId: 'videoA', liveChatId: 'chat-A', page: { nextPageToken: 'resume-me', items: [h.item('one')] } }); await h.flush();
  socket.close(); assert.equal(h.live.getMessages('room').length, 0); assert.equal(h.live.getStatus().state, 'reconnecting');
  await h.fire(2000); await h.handshake(); socket = h.sockets[1];
  assert.equal(socket.sent.at(-1).cursors.videoA, 'resume-me');
  socket.receive({ type: 'auth-required' }); await h.flush(); await h.fire(4000); await h.handshake();
  assert.equal(h.tokens.at(-1), true);
  socket = h.sockets.at(-1); socket.receive({ type: 'auth-required' }); await h.flush();
  assert.equal(h.live.getStatus().state, 'error'); assert.equal(h.session.data['youtubeBackendRun:v1'].active, false);
  assert.equal(h.timers.size, 0);
});
test('worker recovery resumes only active room; disable and source change require explicit restart', async () => {
  const h = harness(); await h.live.start(); await h.handshake(); h.live.stop();
  const recovered = h.env.CrossChat.createYouTubeBackend(h.dependencies); await recovered.sync(); assert.equal(h.sockets.length, 2);
  h.setRoom({ key: 'different', sources: [] }); await recovered.sync(); assert.equal(h.sockets.at(-1).closed, true);
  assert.equal(h.session.data['youtubeBackendRun:v1'].active, false); await recovered.sync(); assert.equal(h.sockets.length, 2);
  h.setRoom({ key: 'room', sources: [{ platform: 'youtube', key: 'youtube:videoA', label: 'A' }] });
  await recovered.start(); await h.local.set({ enabled: false }); await recovered.sync(); assert.equal(recovered.getStatus().state, 'paused'); assert.equal(h.timers.size, 0);
});
test('router requires explicit transport change, stops old reader and exposes no connection key', async () => {
  const h = harness(); const calls = [];
  const polling = { stop() { calls.push('stop'); }, async pause() { calls.push('pause'); }, async sync() { calls.push('sync'); }, async start() { calls.push('start'); }, getStatus() { return {}; }, getMessages() { return []; } };
  let instances = 0;
  const router = h.env.CrossChat.createYouTubeRouter({ polling, session: h.session, publish() {}, createBackend() { instances++; return h.live; } });
  await router.sync(); assert.equal(instances, 0); assert.deepEqual(calls, ['sync']);
  await assert.rejects(router.configure({ mode: 'local', key: 'bad' }), /64-character/);
  await router.configure({ mode: 'local', key: connectionKey }); assert.equal(instances, 1); assert.equal(h.sockets.length, 0);
  const settings = await router.settings(); assert.equal(settings.mode, 'local'); assert.equal(settings.keyConfigured, true); assert.equal(JSON.stringify(settings).includes(connectionKey), false);
  await router.start(); assert.equal(h.sockets.length, 1);
  await router.configure({ mode: 'polling' }); assert.equal(h.sockets[0].closed, true); assert.equal(h.session.data['youtubeBackendRun:v1'].active, false);
  assert.equal(calls.includes('start'), false); assert.equal((await router.settings()).mode, 'polling');
});
test('ended/offline sources release the backend connection without restarting on sync', async () => {
  const h = harness(); await h.live.start(); await h.handshake(); const socket = h.sockets[0];
  socket.receive({ type: 'source-status', videoId: 'videoA', state: 'ended', message: 'Stream ended.' });
  socket.receive({ type: 'source-status', videoId: 'videoB', state: 'error', message: 'No active chat.' }); await h.flush();
  assert.equal(h.live.getStatus().state, 'ended'); assert.equal(h.live.getStatus().sources.length, 2);
  assert.equal(socket.closed, true); assert.equal(h.session.data['youtubeBackendRun:v1'].active, false);
  assert.equal(h.timers.size, 0); await h.live.sync(); assert.equal(h.sockets.length, 1);
});
