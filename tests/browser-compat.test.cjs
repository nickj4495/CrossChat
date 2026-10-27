const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const { build } = require('../scripts/build-extension.cjs');
test('browser packages use shared assets with event-page dependencies and browser-specific manifests', () => {
  const directory = path.resolve(__dirname, '../.artifacts/build-check');
  for (const browser of ['chrome', 'firefox', 'safari']) {
    const destination = build(browser, directory); const manifest = JSON.parse(fs.readFileSync(path.join(destination, 'manifest.json')));
    assert.equal(manifest.manifest_version, 3); assert.equal(manifest.content_scripts[0].js[0], 'src/platform.js');
    const scripts = browser === 'chrome' ? [manifest.background.service_worker] : manifest.background.scripts;
    for (const file of [...manifest.content_scripts[0].js, ...scripts]) assert.equal(fs.existsSync(path.join(destination, file)), true);
    assert.equal(fs.existsSync(path.join(destination, 'backend')), false);
    if (browser === 'chrome') assert.ok(manifest.oauth2.client_id);
    else {
      assert.equal(manifest.oauth2, undefined); assert.equal(manifest.background.persistent, false);
      const background = fs.readFileSync(path.join(destination, 'src/background-page.js'), 'utf8'); assert.equal(background.includes('importScripts('), false);
      assert.ok(scripts.indexOf('src/platform.js') < scripts.indexOf('src/browser-auth.js'));
      if (browser === 'firefox') assert.equal(manifest.browser_specific_settings.gecko.id, 'crosschat@nickj4495.github.io');
      else assert.equal(manifest.permissions.includes('identity'), false);
    }
  }
});
test('platform prefers Promise namespace and session fallback never writes credentials to local storage', async () => {
  let writes = 0; const browser = { runtime: { getURL: () => 'safari-web-extension://uuid/' }, storage: { local: { set() { writes++; } } } };
  const env = { browser, chrome: { runtime: {} }, structuredClone }; vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/platform.js'), 'utf8'), env);
  assert.equal(env.chrome, browser); assert.equal(env.CrossChat.extensionOrigin, 'safari-web-extension://uuid');
  await env.CrossChat.session.set({ credential: 'private' }); const copy = await env.CrossChat.session.get('credential'); copy.credential = 'changed';
  assert.equal((await env.CrossChat.session.get('credential')).credential, 'private'); assert.equal(writes, 0);
  await env.CrossChat.session.remove('credential'); assert.equal((await env.CrossChat.session.get('credential')).credential, undefined);
});
test('native Chrome identity stays intact; portable Google tokens expire, are session-only, and clear on sign-out', async () => {
  const env = { CrossChat: {}, URL, URLSearchParams, Date, AbortController }; vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/browser-auth.js'), 'utf8'), env);
  const native = { getAuthToken() {} }; assert.equal(env.CrossChat.createBrowserIdentity({ api: { identity: native } }), native);
  let data = {}; let calls = 0;
  const session = { async get(key) { return { [key]: data[key] }; }, async set(values) { Object.assign(data, values); }, async remove(key) { delete data[key]; } };
  env.CrossChat.requestBackendOAuth = async () => { calls++; return { token: 'portable-token', expiresAt: Date.now() + 3600000, grantedScopes: ['https://www.googleapis.com/auth/youtube.readonly'] }; };
  const identity = env.CrossChat.createBrowserIdentity({ api: { identity: { getRedirectURL: () => 'https://firefox-callback/', launchWebAuthFlow: () => 'native-flow' } }, session });
  assert.equal(identity.getRedirectURL('twitch'), 'https://firefox-callback/'); assert.equal(await identity.launchWebAuthFlow({}), 'native-flow');
  await assert.rejects(identity.getAuthToken({ interactive: false }), /expired/); assert.equal(calls, 0);
  assert.equal((await identity.getAuthToken({ interactive: true })).token, 'portable-token'); assert.equal(calls, 1);
  assert.equal((await identity.getAuthToken({ interactive: false })).token, 'portable-token');
  data['portableGoogleToken:v1'].expiresAt = 0; await assert.rejects(identity.getAuthToken({ interactive: false }), /expired/);
  await identity.clearAllCachedAuthTokens(); assert.deepEqual(data, {});
});
test('Safari Twitch fallback preserves caller state and rejects unrelated authorization destinations', async () => {
  const env = { CrossChat: {}, URL, URLSearchParams, Date }; vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/browser-auth.js'), 'utf8'), env);
  let called = null; env.CrossChat.requestBackendOAuth = async request => { called = request; return { token: 'fixture-twitch-token' }; };
  const identity = env.CrossChat.createBrowserIdentity({ api: {}, session: {} });
  const url = new URL('https://id.twitch.tv/oauth2/authorize'); url.search = new URLSearchParams({ client_id: 'public-client-id', scope: 'user:read:chat', state: 'original-state', redirect_uri: identity.getRedirectURL('twitch') });
  const callback = new URL(await identity.launchWebAuthFlow({ url: url.href, interactive: true }));
  assert.equal(called.provider, 'twitch'); assert.equal(called.clientId, 'public-client-id');
  assert.equal(callback.origin + callback.pathname, identity.getRedirectURL('twitch'));
  assert.equal(new URLSearchParams(callback.hash.slice(1)).get('state'), 'original-state');
  url.hostname = 'evil.example'; await assert.rejects(identity.launchWebAuthFlow({ url: url.href, interactive: true }), /Unsupported/);
});
test('sign-out aborts a pending portable Google consent flow without retaining a token', async () => {
  const env = { CrossChat: {}, URL, URLSearchParams, Date, AbortController }; vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/browser-auth.js'), 'utf8'), env);
  let started; const ready = new Promise(resolve => { started = resolve; }); let values = {};
  env.CrossChat.requestBackendOAuth = ({ signal }) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(new Error('cancelled'))); started(); });
  const identity = env.CrossChat.createBrowserIdentity({ api: {}, session: { async get(key) { return { [key]: values[key] }; }, async set(data) { Object.assign(values, data); }, async remove(key) { delete values[key]; } } });
  const pending = identity.getAuthToken({ interactive: true }); await ready;
  const rejected = assert.rejects(pending, /cancelled/); await identity.clearAllCachedAuthTokens(); await rejected; assert.deepEqual(values, {});
});
