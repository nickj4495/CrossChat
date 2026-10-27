const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
test('worker merges Twitch, YouTube, and local messages while restricting Google controls to the popup', async () => {
  const data = {}; let handler; let reading = false;
  const roomKey = 'room:twitch:alpha:youtube:video';
  const timestamp = Date.now() + 1000;
  const native = (platform, origin, offset) => ({ id: `${platform}-native`, platform, origin,
    author: 'Viewer', text: `${platform} native message`, sourceKey: platform === 'twitch' ? 'twitch:alpha' : 'youtube:video',
    time: timestamp + offset, local: false });
  const environment = {
    URL, URLSearchParams, structuredClone, setTimeout: () => 1,
    chrome: {
      storage: { local: {
        async get(key) { return typeof key === 'object' ? key : { [key]: data[key] }; },
        async set(values) { Object.assign(data, structuredClone(values)); }
      }, onChanged: { addListener() {} } },
      identity: {}, alarms: { onAlarm: { addListener() {} }, create() {} },
      runtime: { id: 'extension-id', getURL: file => `chrome-extension://extension-id/${file}`,
        onMessage: { addListener(callback) { handler = callback; } } }
    }
  };
  vm.createContext(environment);
  environment.importScripts = (...files) => {
    for (const file of files) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), environment);
    environment.CrossChat.createTwitchAuth = () => ({});
    environment.CrossChat.createTwitchLive = () => ({ async sync() {}, stop() {},
      getStatus: () => ({ state: 'live', message: 'Twitch live', sources: [] }),
      getMessages: key => key === roomKey ? [native('twitch', 'twitch-eventsub', 0)] : [] });
    environment.CrossChat.createYouTubeAuth = () => ({ async state() { return { connected: true }; } });
    environment.CrossChat.createYouTubeLive = () => ({ async sync() {}, stop() {},
      async start() { reading = true; return { started: true }; }, async pause() { reading = false; },
      getStatus: () => ({ state: reading ? 'polling' : 'paused', message: 'YouTube status', sources: [] }),
      getMessages: key => reading && key === roomKey ? [native('youtube', 'youtube-api', 1)] : [] });
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/background.js'), 'utf8'), environment);
  const popup = { id: 'extension-id', url: 'chrome-extension://extension-id/src/popup.html' };
  const page = { id: 'extension-id', url: 'https://www.twitch.tv/alpha', tab: { id: 1 }, frameId: 0 };
  const invoke = (request, sender = page) => new Promise(resolve => {
    handler({ scope: 'crosschat', href: page.url, ...request }, sender, resolve);
  });
  await invoke({ action: 'setSources', urls: [page.url, 'https://www.youtube.com/watch?v=video'] }, popup);
  assert.equal((await invoke({ action: 'youtubeStart' })).ok, false);
  assert.equal((await invoke({ action: 'getYouTubeState' })).ok, false);
  assert.equal((await invoke({ action: 'youtubeConfigure', mode: 'local', key: 'b'.repeat(64) })).ok, false);
  assert.equal(reading, false);
  await invoke({ action: 'youtubeStart' }, popup);
  let response = await invoke({ action: 'snapshot' });
  assert.equal(response.ok, true);
  assert.equal(response.data.messages.at(-2).origin, 'twitch-eventsub');
  assert.equal(response.data.messages.at(-1).origin, 'youtube-api');
  assert.equal(response.data.youtubeStatus.state, 'polling');
  response = await invoke({ action: 'send', key: roomKey, text: 'local demo' });
  assert.ok(response.data.messages.some(message => message.local && message.text === 'local demo'));
  assert.ok(response.data.messages.some(message => message.origin === 'youtube-api'));
  await invoke({ action: 'youtubeStop' }, popup);
  response = await invoke({ action: 'snapshot' });
  assert.ok(response.data.messages.some(message => message.origin === 'twitch-eventsub'));
  assert.equal(response.data.messages.some(message => message.origin === 'youtube-api'), false);
});
