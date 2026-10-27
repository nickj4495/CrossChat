const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
test('Twitch popup displays setup/status, sends only public configuration, and handles sign-out/reconnect', async () => {
  const nodes = new Map(); const calls = []; const drafts = new Map();
  let listener;
  const state = { auth: { clientId: 'publicclient123456', redirectUri: 'https://extension-id.chromiumapp.org/twitch', signingIn: false, login: null },
    live: { message: 'Not connected.', sources: [] } };
  const environment = {
    localStorage: { getItem: key => drafts.get(key) ?? null, setItem: (key, value) => drafts.set(key, value) },
    document: { querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { value: '', handlers: {}, select() {},
        addEventListener(type, handler) { this.handlers[type] = handler; } });
      return nodes.get(selector);
    } },
    setInterval() {},
    chrome: {
      storage: { onChanged: { addListener(callback) { listener = callback; } } },
      runtime: { async sendMessage(request) {
        calls.push(request);
        if (request.action === 'getTwitchState') return { ok: true, data: state };
        if (request.action === 'twitchSignIn') { state.auth.login = 'reader'; return { ok: true, data: { login: 'reader' } }; }
        if (request.action === 'twitchSignOut') { state.auth.login = null; return { ok: true, data: { revoked: false } }; }
        return { ok: true, data: {} };
      } }
    }
  };
  vm.createContext(environment);
  await vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/twitch-ui.js'), 'utf8'), environment);
  assert.equal(nodes.get('#twitch-callback').value, state.auth.redirectUri);
  assert.equal(nodes.get('#twitch-client-id').value, state.auth.clientId);
  assert.equal(nodes.get('#twitch-sign-out').disabled, true);
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  nodes.get('#twitch-sign-in').handlers.click(); await flush();
  assert.equal(calls.find(call => call.action === 'twitchSignIn').clientId, state.auth.clientId);
  assert.equal(nodes.get('#twitch-sign-out').disabled, false);
  assert.match(nodes.get('#twitch-state').textContent, /reader.*read-only/);
  nodes.get('#twitch-reconnect').handlers.click(); await flush();
  assert.ok(calls.some(call => call.action === 'twitchReconnect'));
  nodes.get('#twitch-sign-out').handlers.click(); await flush();
  assert.match(nodes.get('#twitch-feedback').textContent, /Signed out locally/);
  assert.equal(nodes.get('#twitch-sign-out').disabled, true);
  state.auth.signingIn = true;
  listener({ 'twitchLive:revision': {} }, 'local'); await flush();
  assert.equal(nodes.get('#twitch-sign-in').disabled, true);
  assert.match(nodes.get('#twitch-state').textContent, /Finish sign-in/);
});
