const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const scope = 'https://www.googleapis.com/auth/youtube.readonly';
function memory() {
  const data = {};
  return { data, async get(key) { return typeof key === 'object'
    ? Object.fromEntries(Object.entries(key).map(([name, fallback]) => [name, data[name] ?? fallback])) : { [key]: structuredClone(data[key]) }; },
    async set(values) { Object.assign(data, structuredClone(values)); }, async remove(key) { delete data[key]; } };
}
function authHarness() {
  const session = memory(); const calls = []; const identityCalls = [];
  let clientId = 'example-client.apps.googleusercontent.com'; let status = 200; let reason = '';
  let scopes = [scope]; let cancelled = false;
  const identity = {
    async getAuthToken(options) { identityCalls.push(options); if (cancelled) throw new Error('Provider internals'); return { token: 'TEST_GOOGLE_TOKEN', grantedScopes: scopes }; },
    async removeCachedAuthToken() { identityCalls.push('remove'); },
    async clearAllCachedAuthTokens() { identityCalls.push('clear'); }
  };
  const environment = { URL, URLSearchParams, AbortSignal };
  vm.createContext(environment);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/youtube-auth.js'), 'utf8'), environment);
  const auth = environment.CrossChat.createYouTubeAuth({ identity, session,
    manifest: () => ({ oauth2: { client_id: clientId }, extensionId: 'extension-id' }),
    fetcher: async (url, options) => { calls.push({ url, options }); return { ok: status === 200, status,
      async json() { return status === 200 ? { items: [] } : { error: { errors: [{ reason }] } }; } }; }
  });
  return { auth, session, calls, identityCalls, setClient: id => { clientId = id; }, setScopes: value => { scopes = value; },
    setStatus: (code, value) => { status = code; reason = value; }, cancel: () => { cancelled = true; } };
}
test('Google sign-in requests only read permission, keeps token out of storage/state, and never auto-opens consent', async () => {
  const h = authHarness();
  await assert.rejects(h.auth.api('videos', { id: 'video' }), /Sign in/);
  assert.equal(h.identityCalls.length, 0);
  await h.auth.signIn();
  assert.equal(h.identityCalls[0].interactive, true);
  assert.equal(h.identityCalls[0].scopes[0], scope);
  await h.auth.api('videos', { part: 'liveStreamingDetails', id: 'video' });
  assert.equal(h.identityCalls[1].interactive, false);
  assert.equal(h.calls[0].options.headers.Authorization, 'Bearer TEST_GOOGLE_TOKEN');
  assert.equal(h.calls[0].url.includes('TEST_GOOGLE_TOKEN'), false);
  assert.equal(JSON.stringify(h.session.data).includes('TEST_GOOGLE_TOKEN'), false);
  assert.equal(JSON.stringify(await h.auth.state()).includes('TEST_GOOGLE_TOKEN'), false);
  await assert.rejects(h.auth.api('liveChat/messages/insert', {}), /Unsupported/);
  await h.auth.signOut(); assert.equal((await h.auth.state()).connected, false);
  assert.ok(h.identityCalls.includes('clear'));
});
test('unconfigured client, denied scopes, and cancelled sign-in do not enable API access', async () => {
  const missing = authHarness(); missing.setClient('YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com');
  await assert.rejects(missing.auth.signIn(), /Configure/);
  assert.equal(missing.identityCalls.length, 0);
  const denied = authHarness(); denied.setScopes([]);
  await assert.rejects(denied.auth.signIn(), /permission/);
  assert.equal((await denied.auth.state()).connected, false);
  const cancelled = authHarness(); cancelled.cancel();
  await assert.rejects(cancelled.auth.signIn(), /cancelled/);
  assert.equal((await cancelled.auth.state()).connected, false);
});
test('Google 401 clears connection; quota and disabled-chat errors are safe and readable', async () => {
  const h = authHarness(); await h.auth.signIn();
  h.setStatus(401); await assert.rejects(h.auth.api('videos', {}), /revoked/);
  assert.equal((await h.auth.state()).connected, false);
  await h.auth.signIn(); h.setStatus(403, 'quotaExceeded');
  await assert.rejects(h.auth.api('liveChat/messages', {}), /quota/);
  h.setStatus(403, 'liveChatDisabled');
  await assert.rejects(h.auth.api('liveChat/messages', {}), /disabled/);
});
test('background streaming token access requires explicit sign-in and renews without storing the token', async () => {
  const h = authHarness();
  await assert.rejects(h.auth.streamToken(), /Sign in/); assert.equal(h.identityCalls.length, 0);
  await h.auth.signIn(); assert.equal(await h.auth.streamToken(true), 'TEST_GOOGLE_TOKEN');
  assert.ok(h.identityCalls.includes('remove'));
  assert.equal(h.identityCalls.filter(call => typeof call === 'object' && call.interactive === false).length, 2);
  assert.equal(JSON.stringify(h.session.data).includes('TEST_GOOGLE_TOKEN'), false);
  await h.auth.signOut(); await assert.rejects(h.auth.streamToken(), /Sign in/);
});
function messageHarness() {
  const environment = { CrossChat: {} }; vm.createContext(environment);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/youtube-messages.js'), 'utf8'), environment);
  return environment.CrossChat;
}
const source = { key: 'youtube:video', label: 'Channel · Stream' };
const item = (id = 'msg', details = {}) => ({ id, authorDetails: { displayName: 'Viewer', channelId: 'author' },
  snippet: { type: 'textMessageEvent', liveChatId: 'chat-id', publishedAt: '2026-10-26T20:00:00Z', textMessageDetails: { messageText: '<img src=x> hello 😀' }, ...details } });
test('YouTube messages preserve text/source/identity and reject wrong chat or malformed data', () => {
  const app = messageHarness();
  const message = app.normalizeYouTubeMessage(item(), source, 'chat-id');
  assert.equal(message.sourceKey, 'youtube:video'); assert.equal(message.origin, 'youtube-api');
  assert.equal(message.author, 'Viewer'); assert.equal(message.text, '<img src=x> hello 😀');
  assert.equal(app.normalizeYouTubeMessage(item(), source, 'other-chat'), null);
  assert.equal(app.normalizeYouTubeMessage(item('bad', { publishedAt: 'bad' }), source, 'chat-id'), null);
  assert.equal(app.normalizeYouTubeMessage(item('poll', { type: 'pollEvent' }), source, 'chat-id'), null);
});
test('YouTube buffer deduplicates, removes deleted/banned messages, bounds history, and isolates sources', () => {
  const app = messageHarness(); const buffer = app.createYouTubeBuffer();
  const add = (entry, src = source) => buffer.apply(app.normalizeYouTubeMessage(entry, src, 'chat-id'));
  add(item()); add(item());
  assert.equal(buffer.getMessages().length, 1);
  add(item('delete', { type: 'messageDeletedEvent', messageDeletedDetails: { deletedMessageId: 'msg' } }));
  assert.equal(buffer.getMessages().length, 0);
  add(item()); assert.equal(buffer.getMessages().length, 0);
  add(item('before-ban'));
  add(item('ban', { type: 'userBannedEvent', publishedAt: '2026-10-26T20:00:01Z', userBannedDetails: { bannedUserDetails: { channelId: 'author' } } }));
  add(item('late-old-message')); assert.equal(buffer.getMessages().length, 0);
  add(item('new', { publishedAt: '2026-10-26T20:00:02Z' }));
  add(item('other-video'), { key: 'youtube:other', label: 'Other' });
  buffer.clearSource(source.key); assert.equal(buffer.getMessages().length, 1);
  buffer.clear();
  for (let i = 0; i < 210; i++) add(item(`m-${i}`));
  assert.equal(buffer.getMessages().length, 200);
});

test('YouTube tombstones delete already-seen messages instead of being ignored as duplicates', () => {
  const app = messageHarness(); const buffer = app.createYouTubeBuffer();
  buffer.apply(app.normalizeYouTubeMessage(item('original'), source, 'chat-id'));
  buffer.apply(app.normalizeYouTubeMessage(item('original', { type: 'tombstone' }), source, 'chat-id'));
  assert.equal(buffer.getMessages().length, 0);
});
