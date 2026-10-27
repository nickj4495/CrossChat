const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function storage() {
  const data = {};
  return { data,
    async get(key) {
      if (typeof key === 'object') return Object.fromEntries(Object.entries(key).map(([name, fallback]) => [name, data[name] ?? fallback]));
      return { [key]: structuredClone(data[key]) };
    },
    async set(values) { Object.assign(data, structuredClone(values)); },
    async remove(key) { delete data[key]; }
  };
}
function harness() {
  let clock = Date.now();
  const local = storage();
  const session = storage();
  const calls = [];
  const clientId = 'publicclient123456';
  let validation = { client_id: clientId, user_id: '123', login: 'reader', scopes: ['user:read:chat'], expires_in: 7200 };
  let validationStatus = 200;
  let apiStatus = 200;
  let callbackEdit = value => value;
  let authUrl;
  const identity = {
    getRedirectURL: () => 'https://extension-id.chromiumapp.org/twitch',
    async launchWebAuthFlow(options) {
      authUrl = new URL(options.url);
      return callbackEdit(`${identity.getRedirectURL()}#access_token=TEST_TOKEN&token_type=bearer&state=${authUrl.searchParams.get('state')}`);
    }
  };
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/validate')) return { ok: validationStatus === 200, status: validationStatus, async json() { return validation; } };
    return { ok: apiStatus === 200, status: apiStatus, async json() { return { data: [] }; } };
  };
  const environment = { URL, URLSearchParams, Uint8Array, AbortSignal };
  vm.createContext(environment);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/twitch-auth.js'), 'utf8'), environment);
  const makeAuth = () => environment.CrossChat.createTwitchAuth({ local, session, identity, fetcher,
    random: { getRandomValues: bytes => bytes.fill(9) }, now: () => clock });
  return { local, session, calls, clientId, makeAuth, get authUrl() { return authUrl; },
    setValidation: value => { validation = { ...validation, ...value }; },
    setValidationStatus: value => { validationStatus = value; },
    setApiStatus: value => { apiStatus = value; },
    editCallback: callback => { callbackEdit = callback; }, advance: ms => { clock += ms; } };
}
test('OAuth requests only read scope, validates callback, and exposes no token in public state/local storage', async () => {
  const h = harness(); const auth = h.makeAuth();
  assert.equal((await auth.signIn(h.clientId)).login, 'reader');
  assert.equal(h.authUrl.searchParams.get('scope'), 'user:read:chat');
  assert.equal(h.authUrl.searchParams.get('response_type'), 'token');
  assert.equal(h.authUrl.searchParams.get('redirect_uri'), auth.redirectUri());
  assert.equal(h.authUrl.searchParams.get('state').length, 64);
  assert.equal(JSON.stringify(h.local.data).includes('TEST_TOKEN'), false);
  assert.equal(JSON.stringify(await auth.state()).includes('TEST_TOKEN'), false);
  assert.equal(h.session.data['twitchAuth:v1'].token, 'TEST_TOKEN');
  await auth.api('/users?login=alpha');
  assert.equal(h.calls.at(-1).options.headers.Authorization, 'Bearer TEST_TOKEN');
  assert.equal(h.calls.at(-1).options.headers['Client-Id'], h.clientId);
  await assert.rejects(auth.api('/chat/messages'), /Unsupported/);
});
test('state/origin mismatch, missing scope, and wrong app reject sign-in without saving a token', async () => {
  for (const configure of [
    h => h.editCallback(url => url.replace(/state=.*/, 'state=wrong')),
    h => h.editCallback(url => url.replace('extension-id.chromiumapp.org', 'attacker.example')),
    h => h.setValidation({ scopes: ['user:write:chat'] }),
    h => h.setValidation({ client_id: 'anotherclient' })
  ]) {
    const h = harness(); configure(h);
    await assert.rejects(h.makeAuth().signIn(h.clientId));
    assert.equal(h.session.data['twitchAuth:v1'], undefined);
  }
});
test('startup/hourly validation, expiry, revoked tokens, and sign-out clear session credentials', async () => {
  const h = harness();
  let auth = h.makeAuth(); await auth.signIn(h.clientId);
  auth = h.makeAuth(); await auth.credentials();
  assert.equal(h.calls.filter(call => call.url.endsWith('/validate')).length, 2);
  h.advance(56 * 60000); await auth.credentials();
  assert.equal(h.calls.filter(call => call.url.endsWith('/validate')).length, 3);
  h.advance(3 * 60 * 60000); assert.equal(await auth.credentials(), null);
  assert.equal(h.session.data['twitchAuth:v1'], undefined);
  await auth.signIn(h.clientId);
  h.setApiStatus(401); await assert.rejects(auth.api('/users?login=alpha'), /revoked/);
  assert.equal(h.session.data['twitchAuth:v1'], undefined);
  h.setApiStatus(200); await auth.signIn(h.clientId);
  const result = await auth.signOut();
  assert.equal(result.revoked, true);
  assert.equal(h.session.data['twitchAuth:v1'], undefined);
  assert.equal(h.calls.at(-1).url, 'https://id.twitch.tv/oauth2/revoke');
  assert.equal(await auth.credentials(), null);
});
test('failed remote revocation still signs out locally', async () => {
  const h = harness(); const auth = h.makeAuth(); await auth.signIn(h.clientId);
  h.setApiStatus(500);
  assert.equal((await auth.signOut()).revoked, false);
  assert.equal(await auth.credentials(), null);
});
