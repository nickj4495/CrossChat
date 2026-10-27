const { test } = require('node:test'); const assert = require('node:assert/strict');
const { createHash, webcrypto } = require('node:crypto'); const { WebSocket } = require('ws');
const { createOAuth } = require('../oauth.cjs'); const { createBridge, normalizeOrigin } = require('../server.cjs');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const scope = 'https://www.googleapis.com/auth/youtube.readonly';
const config = { google: { clientId: 'web-client', clientSecret: 'fixture-server-secret' }, twitch: { clientId: 'twitch-client', clientSecret: 'fixture-twitch-secret' } };
test('server OAuth uses one-time state, Google PKCE, exact callbacks and server-only secrets', async () => {
  const calls = []; const events = [];
  const oauth = createOAuth({ config, fetcher: async (url, options) => {
    calls.push({ url, body: new URLSearchParams(options.body) });
    return { ok: true, async json() { return { access_token: 'fixture-access-token', token_type: 'Bearer', expires_in: 3600, scope }; } };
  } });
  const request = oauth.begin('google', data => events.push(data), 47831); const authorize = new URL(request.url);
  assert.equal(authorize.searchParams.get('response_type'), 'code'); assert.equal(authorize.searchParams.get('scope'), scope);
  assert.equal(authorize.href.includes('fixture-server-secret'), false);
  const callback = new URL(authorize.searchParams.get('redirect_uri')); callback.search = new URLSearchParams({ state: authorize.searchParams.get('state'), code: 'one-time-code' });
  const wrong = new URL(callback); wrong.pathname = '/oauth/twitch/callback'; assert.equal(await oauth.callback(wrong), false);
  assert.equal(await oauth.callback(callback), true); assert.equal(await oauth.callback(callback), false); assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://oauth2.googleapis.com/token');
  assert.equal(calls[0].body.get('client_secret'), 'fixture-server-secret');
  assert.equal(createHash('sha256').update(calls[0].body.get('code_verifier')).digest('base64url'), authorize.searchParams.get('code_challenge'));
  assert.equal(events[0].token, 'fixture-access-token'); assert.equal(JSON.stringify(events).includes('secret'), false); oauth.close();
});
test('denied, cancelled, expired or under-scoped OAuth never returns a token or provider details', async () => {
  const events = []; let clock = 0;
  const oauth = createOAuth({ config, now: () => clock, fetcher: async () => ({ ok: true, async json() { return { access_token: 'bad-grant-token', token_type: 'Bearer', expires_in: 3600, scope: 'email' }; } }) });
  const callback = request => { const url = new URL(request.url); return new URL(url.searchParams.get('redirect_uri') + '?code=code&state=' + url.searchParams.get('state')); };
  await oauth.callback(callback(oauth.begin('google', event => events.push(event), 47831)));
  assert.equal(events[0].type, 'auth-error'); assert.equal(JSON.stringify(events).includes('bad-grant-token'), false);
  const cancelled = oauth.begin('google', event => events.push(event), 47831); cancelled.cancel(); assert.equal(await oauth.callback(callback(cancelled)), false);
  const expired = oauth.begin('google', event => events.push(event), 47831); clock = 6 * 60000; assert.equal(await oauth.callback(callback(expired)), false);
  assert.throws(() => oauth.begin('twitch', () => {}, 47831, 'wrong-app'), /must match/); oauth.close();
});
test('Firefox/Safari origins require exact allowlisting; website, null, wildcard and prefix origins are rejected', () => {
  for (const scheme of ['chrome-extension', 'moz-extension', 'safari-web-extension']) assert.equal(normalizeOrigin(`${scheme}://abc-123`), `${scheme}://abc-123`);
  for (const origin of ['https://example.com', 'null', 'moz-extension://*', 'moz-extension://abc/path', 'moz-extension://abc:20', 'moz-extension://abc?query', 'moz-extension://abc@evil']) assert.throws(() => normalizeOrigin(origin));
});
test('Firefox Google OAuth works over a real authenticated local WebSocket without Chrome identity', async t => {
  const origin = 'moz-extension://fixture-uuid'; const key = 'd'.repeat(64); let exchanges = 0; const opened = []; const removed = [];
  const bridge = createBridge({ extensionOrigin: origin, key, adapter: { close() {} }, oauthConfig: config,
    fetcher: async (url, options) => {
      assert.equal(url, 'https://oauth2.googleapis.com/token'); exchanges++;
      assert.equal(new URLSearchParams(options.body).get('client_secret'), config.google.clientSecret);
      return { ok: true, async json() { return { access_token: 'fixture-google-access-token', token_type: 'Bearer', expires_in: 3600, scope }; } };
    } });
  t.after(() => bridge.close()); const { port } = await bridge.listen(0);
  const env = { CrossChat: {}, URL, URLSearchParams, TextEncoder, Uint8Array, crypto: webcrypto, setTimeout, clearTimeout, Date, SyntaxError }; vm.createContext(env);
  for (const file of ['youtube-backend.js', 'browser-auth.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'), env);
  const result = await env.CrossChat.requestBackendOAuth({ provider: 'google', session: { async get() { return { 'youtubeBackendKey:v1': key }; } },
    socketFactory: () => new WebSocket(`ws://127.0.0.1:${port}/youtube`, { origin }), api: { tabs: {
      async create({ url }) {
        opened.push(url); const authorize = new URL(url);
        const callback = new URL(authorize.searchParams.get('redirect_uri')); callback.search = new URLSearchParams({ state: authorize.searchParams.get('state'), code: 'fixture-code' });
        setTimeout(() => fetch(callback).catch(() => {}), 10); return { id: 3 };
      }, async remove(id) { removed.push(id); }
    } } });
  assert.equal(result.token, 'fixture-google-access-token'); assert.equal(exchanges, 1); assert.equal(opened.length, 1); assert.deepEqual(removed, [3]);
  assert.equal(opened[0].includes('fixture-server-secret'), false);
});
test('portable sign-in rejects a mismatched backend key before opening any provider tab', async t => {
  const origin = 'safari-web-extension://fixture'; let tabs = 0; let exchanges = 0;
  const bridge = createBridge({ extensionOrigin: origin, key: 'a'.repeat(64), adapter: { close() {} }, oauthConfig: config, fetcher: async () => { exchanges++; throw new Error('not expected'); } });
  t.after(() => bridge.close()); const { port } = await bridge.listen(0);
  const env = { CrossChat: {}, URL, URLSearchParams, TextEncoder, Uint8Array, crypto: webcrypto, setTimeout, clearTimeout, Date, SyntaxError }; vm.createContext(env);
  for (const file of ['youtube-backend.js', 'browser-auth.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../../src', file), 'utf8'), env);
  await assert.rejects(env.CrossChat.requestBackendOAuth({ provider: 'google', session: { async get() { return { 'youtubeBackendKey:v1': 'b'.repeat(64) }; } },
    socketFactory: () => new WebSocket(`ws://127.0.0.1:${port}/youtube`, { origin }), api: { tabs: { async create() { tabs++; } } } }), /does not match/);
  assert.equal(tabs, 0); assert.equal(exchanges, 0);
});
test('Safari backend Twitch flow exchanges the code with its server-only secret and fixed read scope', async () => {
  const events = []; let body;
  const oauth = createOAuth({ config, fetcher: async (url, options) => {
    assert.equal(url, 'https://id.twitch.tv/oauth2/token'); body = new URLSearchParams(options.body);
    return { ok: true, async json() { return { access_token: 'fixture-twitch-token', expires_in: 3600, token_type: 'bearer', scope: ['user:read:chat'] }; } };
  } });
  const result = oauth.begin('twitch', event => events.push(event), 47831, config.twitch.clientId); const authorize = new URL(result.url);
  assert.equal(authorize.searchParams.get('scope'), 'user:read:chat'); assert.equal(authorize.searchParams.get('response_type'), 'code');
  const callback = new URL(authorize.searchParams.get('redirect_uri')); callback.search = new URLSearchParams({ state: authorize.searchParams.get('state'), code: 'fixture-code' });
  assert.equal(await oauth.callback(callback), true); assert.equal(body.get('client_secret'), config.twitch.clientSecret); assert.equal(body.has('code_verifier'), false);
  assert.equal(events[0].type, 'auth-token'); oauth.close();
});
