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
  for (const file of [...manifest.content_scripts[0].js, manifest.action.default_popup, manifest.background.service_worker]) assert.ok(fs.existsSync(path.join(base, file)));
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
      createRoomChat(context) {
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


vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/rooms.js'), 'utf8'), sandbox);
const twitchUrl = 'https://www.twitch.tv/alpha';
const youtubeUrl = 'https://www.youtube.com/watch?v=video123';
test('paired platforms share history, concurrent sends survive, worker restart restores room', async () => {
  const storage = memoryStorage();
  const service = app.createRoomService(storage);
  const original = await service.snapshot(twitchUrl);
  await service.send(twitchUrl, original.key, 'old unpaired message');
  const pair = await service.setPair(twitchUrl, youtubeUrl);
  const [twitch, youtube] = await Promise.all([service.snapshot(twitchUrl), service.snapshot(youtubeUrl)]);
  assert.equal(twitch.key, youtube.key);
  assert.equal(twitch.messages.length, 6);
  await Promise.all([
    service.send(twitchUrl, pair.key, 'hello from Twitch'),
    service.send(youtubeUrl, pair.key, 'hello from YouTube')
  ]);
  const restoredService = app.createRoomService(storage);
  const history = await restoredService.snapshot(youtubeUrl);
  assert.equal(history.messages.length, 8);
  assert.equal(history.messages.at(-2).platform, 'twitch');
  assert.equal(history.messages.at(-1).platform, 'youtube');
  assert.equal((await restoredService.snapshot('https://www.twitch.tv/other')).messages.length, 6);
  await restoredService.clearPair();
  assert.equal((await restoredService.snapshot(twitchUrl)).messages.at(-1).text, 'old unpaired message');
  await assert.rejects(restoredService.send(twitchUrl, pair.key, 'stale room send'), /Room changed/);
  await restoredService.setPair(twitchUrl, youtubeUrl);
  assert.equal((await restoredService.snapshot(youtubeUrl)).messages.length, 8);
});
test('pair validation, failed writes, and queue recovery preserve saved data', async () => {
  const storage = memoryStorage();
  const service = app.createRoomService(storage);
  await assert.rejects(service.setPair(youtubeUrl, twitchUrl), /full Twitch/);
  await assert.rejects(service.setPair('https://evil.example/alpha', youtubeUrl));
  assert.equal(await service.getPair(), null);
  const pair = await service.setPair(twitchUrl, youtubeUrl);
  storage.fail = true;
  await assert.rejects(service.send(twitchUrl, pair.key, 'not saved'), /unavailable/);
  storage.fail = false;
  await service.send(youtubeUrl, pair.key, 'saved after retry');
  const history = await service.snapshot(twitchUrl);
  assert.equal(history.messages.length, 7);
  assert.equal(history.messages.at(-1).text, 'saved after retry');
  await assert.rejects(service.send(twitchUrl, pair.key, '   '), /1–500/);
});
test('two live clients receive storage updates, pairing and unpairing without reload', async () => {
  const storage = memoryStorage();
  const listeners = new Set();
  const originalSet = storage.set;
  storage.set = async function(values) {
    await originalSet.call(this, values);
    const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { newValue: value }]));
    listeners.forEach(listener => listener(changes, 'local'));
  };
  const service = app.createRoomService(storage);
  const makeClient = href => {
    const environment = {
      location: { href },
      chrome: {
        storage: { onChanged: {
          addListener(listener) { listeners.add(listener); },
          removeListener(listener) { listeners.delete(listener); }
        } },
        runtime: { async sendMessage(request) {
          try {
            const data = request.action === 'snapshot'
              ? await service.snapshot(request.href)
              : await service.send(request.href, request.key, request.text);
            return { ok: true, data };
          } catch (error) { return { ok: false, error: error.message }; }
        } }
      },
      CrossChat: {}
    };
    vm.createContext(environment);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/room-client.js'), 'utf8'), environment);
    return environment.CrossChat.createRoomChat({});
  };
  const [twitch, youtube] = await Promise.all([makeClient(twitchUrl), makeClient(youtubeUrl)]);
  const drain = async () => { for (let i = 0; i < 10; i++) { await service.getPair(); await Promise.resolve(); } };
  await service.setPair(twitchUrl, youtubeUrl);
  await drain();
  assert.equal(twitch.getRoom().key, youtube.getRoom().key);
  await Promise.all([twitch.send('Twitch tab'), youtube.send('YouTube tab')]);
  await drain();
  assert.equal(twitch.getMessages().length, 8);
  assert.equal(youtube.getMessages().length, 8);
  assert.equal(twitch.getMessages().at(-1).text, youtube.getMessages().at(-1).text);
  assert.equal(twitch.getMessages().at(-2).platform, 'twitch');
  assert.equal(twitch.getMessages().at(-1).platform, 'youtube');
  await service.clearPair();
  await drain();
  assert.notEqual(twitch.getRoom().key, youtube.getRoom().key);
  assert.equal(twitch.getMessages().length, 6);
  assert.equal(youtube.getMessages().length, 6);
  twitch.destroy(); youtube.destroy();
  assert.equal(listeners.size, 0);
});

test('service worker accepts popup pairing and top-frame requests, rejects other senders', async () => {
  const storage = memoryStorage();
  let handler;
  const environment = {
    URL, console: { warn() {} },
    chrome: {
      storage: { local: storage },
      runtime: {
        id: 'test-id',
        getURL: file => `chrome-extension://test-id/${file}`,
        onMessage: { addListener(listener) { handler = listener; } }
      }
    }
  };
  vm.createContext(environment);
  environment.importScripts = (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), environment);
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf8'), environment);
  const invoke = (request, sender) => new Promise(resolve => {
    assert.equal(handler({ scope: 'crosschat', ...request }, sender, resolve), true);
  });
  const popup = { id: 'test-id', url: 'chrome-extension://test-id/src/popup.html' };
  const page = { id: 'test-id', url: twitchUrl, tab: { id: 1 }, frameId: 0 };
  assert.equal((await invoke({ action: 'setPair', twitchUrl, youtubeUrl }, popup)).ok, true);
  const snapshot = await invoke({ action: 'snapshot', href: twitchUrl }, page);
  assert.equal(snapshot.ok, true);
  assert.equal((await invoke({ action: 'send', href: twitchUrl, key: snapshot.data.key, text: 'worker message' }, page)).data.message.platform, 'twitch');
  assert.equal((await invoke({ action: 'clearPair' }, page)).ok, false);
  assert.equal((await invoke({ action: 'snapshot', href: youtubeUrl }, page)).ok, false);
  assert.equal((await invoke({ action: 'snapshot', href: twitchUrl }, { ...page, frameId: 2 })).ok, false);
  assert.equal((await invoke({ action: 'getPair' }, { ...popup, id: 'other-id' })).ok, false);
});

test('panel renders shared updates, sends once, and releases its subscription', async () => {
  function element() {
    return {
      children: [], handlers: {}, style: {}, value: '', isConnected: true,
      append(...nodes) { this.children.push(...nodes); },
      replaceChildren(...nodes) { this.children = nodes; },
      addEventListener(type, listener) { this.handlers[type] = listener; },
      setAttribute() {}, remove() { this.isConnected = false; }, focus() {}
    };
  }
  const nodes = new Map();
  const root = { querySelector(selector) {
    if (!nodes.has(selector)) nodes.set(selector, element());
    return nodes.get(selector);
  } };
  const environment = {
    console,
    document: { createElement() {
      const node = element();
      node.attachShadow = () => root;
      return node;
    } },
    window: { addEventListener() {}, removeEventListener() {} },
    CrossChat: {}
  };
  vm.createContext(environment);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/panel.js'), 'utf8'), environment);
  let notify;
  let unsubscribed = false;
  const messages = app.createMockChat().getMessages();
  const provider = {
    getMessages: () => messages,
    getRoom: () => ({ pair: { twitchKey: 'twitch:alpha' } }),
    subscribe(listener) { notify = listener; return () => { unsubscribed = true; }; },
    async send(text) {
      const message = { author: 'You', text, time: Date.now(), platform: 'twitch', local: true };
      messages.push(message);
      notify(null);
      return message;
    }
  };
  const panel = environment.CrossChat.createPanel({ platform: 'twitch' }, provider);
  assert.equal(nodes.get('.messages').children.length, 6);
  assert.match(nodes.get('.notice').textContent, /Local shared room/);
  messages.push({ author: 'You', text: 'other tab', time: Date.now(), platform: 'youtube', local: true });
  notify(null);
  assert.equal(nodes.get('.messages').children.length, 7);
  nodes.get('input').value = 'my message';
  await nodes.get('form').handlers.submit({ preventDefault() {} });
  assert.equal(nodes.get('.messages').children.length, 8);
  assert.equal(nodes.get('input').value, '');
  panel.destroy();
  assert.equal(unsubscribed, true);
  assert.equal(panel.host.isConnected, false);
});

test('popup restores partial drafts on reopen, activates only on save, and clears drafts after success', async () => {
  const drafts = new Map();
  let pair = null;
  let failSave = false;
  async function openPopup() {
    const nodes = new Map();
    const environment = {
      localStorage: {
        getItem: key => drafts.get(key) ?? null,
        setItem: (key, value) => drafts.set(key, value),
        removeItem: key => drafts.delete(key)
      },
      document: { querySelector(selector) {
        if (!nodes.has(selector)) nodes.set(selector, {
          value: '', handlers: {},
          addEventListener(type, listener) { this.handlers[type] = listener; }
        });
        return nodes.get(selector);
      } },
      chrome: {
        storage: { local: { async get() { return { enabled: true }; } } },
        runtime: { async sendMessage(request) {
          if (request.action === 'getPair') return { ok: true, data: pair };
          if (failSave) return { ok: false, error: 'Save failed' };
          pair = request.action === 'clearPair' ? null : { twitchUrl: request.twitchUrl, youtubeUrl: request.youtubeUrl };
          return { ok: true, data: pair };
        } }
      }
    };
    vm.createContext(environment);
    await vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/popup.js'), 'utf8'), environment);
    return nodes;
  }
  let popup = await openPopup();
  popup.get('#twitch-url').value = twitchUrl;
  popup.get('#twitch-url').handlers.input();
  assert.equal(pair, null);
  popup = await openPopup();
  assert.equal(popup.get('#twitch-url').value, twitchUrl);
  assert.equal(popup.get('#youtube-url').value, '');
  popup.get('#youtube-url').value = youtubeUrl;
  popup.get('#youtube-url').handlers.input();
  popup = await openPopup();
  assert.equal(popup.get('#youtube-url').value, youtubeUrl);
  const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
  failSave = true;
  popup.get('#pair-form').handlers.submit({ preventDefault() {} });
  await flush();
  assert.equal(drafts.size, 1);
  assert.equal(pair, null);
  failSave = false;
  popup.get('#pair-form').handlers.submit({ preventDefault() {} });
  await flush();
  assert.equal(pair.twitchUrl, twitchUrl);
  assert.equal(pair.youtubeUrl, youtubeUrl);
  assert.equal(drafts.size, 0);
  popup = await openPopup();
  assert.equal(popup.get('#twitch-url').value, twitchUrl);
  popup.get('#twitch-url').value = '';
  popup.get('#twitch-url').handlers.input();
  popup = await openPopup();
  assert.equal(popup.get('#twitch-url').value, '');
  popup.get('#clear-pair').handlers.click();
  await flush();
  assert.equal(pair, null);
  assert.equal(drafts.size, 0);
  popup = await openPopup();
  assert.equal(popup.get('#youtube-url').value, '');
});
