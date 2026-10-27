const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = { URL };
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/mock-chat.js'), 'utf8'), sandbox);
const app = sandbox.CrossChat;
test('supported routes and excluded pages', () => {
  for (const href of ['https://www.twitch.tv/cozy_streamer', 'https://www.youtube.com/watch?v=abc-123', 'https://www.youtube.com/live/abc_123']) assert.ok(app.getPageContext(href));
  for (const href of ['https://www.twitch.tv/', 'https://www.twitch.tv/directory', 'https://www.twitch.tv/someone/videos', 'https://www.youtube.com/', 'https://www.youtube.com/watch', 'https://www.youtube.com/shorts/abc', 'https://example.com/watch?v=abc']) assert.equal(app.getPageContext(href), null);
  assert.equal(app.getPageContext('https://www.youtube.com/watch?v=abc&t=20').key, 'youtube:abc');
});
test('mock messages cover both platforms; sending is local and validated', () => {
  const chat = app.createMockChat();
  assert.equal(new Set(chat.getMessages().map(m => m.platform)).size, 2);
  assert.equal(chat.send('   ', 'twitch'), null);
  assert.equal(chat.send('x'.repeat(501), 'twitch'), null);
  assert.equal(chat.send('hello', 'other'), null);
  const sent = chat.send('  <img src=x onerror=alert(1)>  ', 'youtube');
  assert.equal(sent.text, '<img src=x onerror=alert(1)>');
  assert.equal(sent.local, true);
  assert.equal(sent.platform, 'youtube');
  const snapshot = chat.getMessages();
  snapshot[0].text = 'changed';
  assert.notEqual(chat.getMessages()[0].text, 'changed');
  assert.equal(app.createMockChat().getMessages().length, 6);
  for (let i = 0; i < 220; i++) chat.send('hello', 'twitch');
  assert.equal(chat.getMessages().length, 200);
});
test('manifest references existing local files and requests only storage', () => {
  const base = path.join(__dirname, '..');
  const manifest = JSON.parse(fs.readFileSync(path.join(base, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage']);
  for (const file of [...manifest.content_scripts[0].js, manifest.action.default_popup]) assert.ok(fs.existsSync(path.join(base, file)));
});

vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/history.js'), 'utf8'), sandbox);
function memoryStorage() {
  const data = {};
  return {
    data,
    fail: false,
    async get(key) { return structuredClone({ [key]: data[key] }); },
    async set(values) {
      if (this.fail) throw new Error('Storage unavailable');
      Object.assign(data, structuredClone(values));
    }
  };
}
test('history survives provider recreation without duplicate seeds and isolates channels', async () => {
  const storage = memoryStorage();
  const context = { key: 'twitch:alpha' };
  const first = await app.createPersistentChat(context, storage);
  await first.send('persistent hello', 'twitch');
  const restored = await app.createPersistentChat(context, storage);
  assert.equal(restored.getMessages().length, 7);
  assert.equal(restored.getMessages().at(-1).text, 'persistent hello');
  assert.equal(restored.getMessages()[0].time, first.getMessages()[0].time);
  for (const key of ['twitch:beta', 'youtube:alpha']) {
    assert.equal((await app.createPersistentChat({ key }, storage)).getMessages().length, 6);
  }
});
test('failed saves retain history; retry works and queued sends are retained', async () => {
  const storage = memoryStorage();
  const context = { key: 'youtube:retry' };
  const chat = await app.createPersistentChat(context, storage);
  storage.fail = true;
  await assert.rejects(chat.send('failed', 'youtube'));
  assert.equal(chat.getMessages().length, 6);
  assert.equal(storage.data['history:v1:youtube:retry'].messages.length, 6);
  storage.fail = false;
  await Promise.all([chat.send('one', 'youtube'), chat.send('two', 'youtube')]);
  const restored = await app.createPersistentChat(context, storage);
  assert.equal(restored.getMessages().length, 8);
  assert.equal(restored.getMessages().at(-2).text, 'one');
  assert.equal(restored.getMessages().at(-1).text, 'two');
});
test('saved histories remain bounded and malformed history is not overwritten', async () => {
  const storage = memoryStorage();
  const chat = await app.createPersistentChat({ key: 'twitch:bounded' }, storage);
  for (let i = 0; i < 205; i++) await chat.send(`message ${i}`, 'twitch');
  assert.equal((await app.createPersistentChat({ key: 'twitch:bounded' }, storage)).getMessages().length, 200);
  const key = 'history:v1:twitch:broken';
  storage.data[key] = { version: 1, messages: [{ text: 'invalid' }] };
  await assert.rejects(app.createPersistentChat({ key: 'twitch:broken' }, storage), /invalid/);
  assert.equal(storage.data[key].messages[0].text, 'invalid');
  const originalGet = storage.get;
  storage.get = async () => { throw new Error('Read failed'); };
  await assert.rejects(app.createPersistentChat({ key: 'twitch:bounded' }, storage), /Read failed/);
  storage.get = originalGet;
  assert.equal(storage.data['history:v1:twitch:bounded'].messages.length, 200);
});

test('slow history loads cannot mount a previous channel after navigation', async () => {
  const requests = [];
  const mounted = new Set();
  let tick;
  let settingsChanged;
  const location = { href: 'https://www.twitch.tv/alpha' };
  const environment = {
    location,
    console,
    chrome: {
      runtime: { id: 'test-extension' },
      storage: {
        local: { async get() { return { enabled: true }; } },
        onChanged: { addListener(listener) { settingsChanged = listener; } }
      }
    },
    document: {
      fullscreenElement: null,
      body: { append(host) { host.isConnected = true; mounted.add(host); } },
      addEventListener() {}, removeEventListener() {}
    },
    setInterval(callback) { tick = callback; return 1; }, clearInterval() {},
    CrossChat: {
      getPageContext: app.getPageContext,
      createPersistentChat(context) {
        return new Promise(resolve => requests.push({ key: context.key, resolve }));
      },
      createPanel(context, provider) {
        const host = { key: context.key, provider, isConnected: false, style: { setProperty() {} } };
        return { host, destroy() { mounted.delete(host); host.isConnected = false; } };
      }
    }
  };
  vm.createContext(environment);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/content.js'), 'utf8'), environment);
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  await flush();
  assert.equal(requests[0].key, 'twitch:alpha');
  location.href = 'https://www.twitch.tv/beta';
  tick();
  const beta = { name: 'beta history' };
  requests[1].resolve(beta);
  await flush();
  requests[0].resolve({ name: 'stale alpha history' });
  await flush();
  assert.equal(mounted.size, 1);
  assert.equal([...mounted][0].key, 'twitch:beta');
  assert.equal([...mounted][0].provider, beta);
  settingsChanged({ enabled: { newValue: false } }, 'local');
  assert.equal(mounted.size, 0);
  settingsChanged({ enabled: { newValue: true } }, 'local');
  assert.equal([...mounted][0].provider, beta);
  location.href = 'https://www.twitch.tv/';
  tick();
  assert.equal(mounted.size, 0);
});
