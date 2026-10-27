const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
test('Google popup requires configuration and an explicit Start after sign-in, then permits Stop and Disconnect', async () => {
  const nodes = new Map(); const calls = []; let changed;
  const state = { auth: { configured: false, extensionId: 'extension-id', connected: false, signingIn: false },
    live: { state: 'paused', message: 'Reading is off.', sources: [] } };
  const environment = {
    document: { querySelector(selector) {
      if (!nodes.has(selector)) nodes.set(selector, { value: '', handlers: {}, select() {}, addEventListener(type, callback) { this.handlers[type] = callback; } });
      return nodes.get(selector);
    } },
    setInterval() {},
    chrome: { storage: { onChanged: { addListener(callback) { changed = callback; } } }, runtime: { async sendMessage(request) {
      calls.push(request.action);
      if (request.action === 'getYouTubeState') return { ok: true, data: state };
      if (request.action === 'youtubeSignIn') state.auth.connected = true;
      if (request.action === 'youtubeStart') state.live.state = 'polling';
      if (request.action === 'youtubeStop') state.live.state = 'paused';
      if (request.action === 'youtubeSignOut') state.auth.connected = false;
      return { ok: true, data: {} };
    } } }
  };
  vm.createContext(environment);
  await vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/youtube-ui.js'), 'utf8'), environment);
  assert.equal(nodes.get('#youtube-connect').disabled, true);
  assert.equal(nodes.get('#google-extension-id').value, 'extension-id');
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  state.auth.configured = true; changed({ 'twitchLive:revision': {} }, 'local'); await flush();
  nodes.get('#youtube-connect').handlers.click(); await flush();
  assert.equal(nodes.get('#youtube-start').disabled, false);
  assert.equal(calls.includes('youtubeStart'), false);
  nodes.get('#youtube-start').handlers.click(); await flush();
  assert.equal(nodes.get('#youtube-stop').disabled, false);
  nodes.get('#youtube-stop').handlers.click(); await flush();
  assert.equal(nodes.get('#youtube-stop').disabled, true);
  nodes.get('#youtube-disconnect').handlers.click(); await flush();
  assert.equal(nodes.get('#youtube-start').disabled, true);
});
