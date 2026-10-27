const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
function storage() {
  const data = {};
  return { data, async get(key) { return typeof key === 'object'
    ? Object.fromEntries(Object.entries(key).map(([name, fallback]) => [name, data[name] ?? fallback])) : { [key]: structuredClone(data[key]) }; },
    async set(values) { Object.assign(data, structuredClone(values)); } };
}
function harness() {
  let clock = Date.parse('2026-10-26T20:00:00Z'); const session = storage(); const calls = []; const timers = new Map();
  let serial = 0; let connected = true; let enabled = true; let failVideo = null; let deferred = null;
  let room = { key: 'room', sources: [{ key: 'youtube:videoA', label: 'A', platform: 'youtube' },
    { key: 'youtube:videoB', label: 'B', platform: 'youtube' }, { key: 'twitch:alpha', label: 'alpha', platform: 'twitch' }] };
  const environment = { AbortController, CrossChat: {} }; vm.createContext(environment);
  for (const file of ['youtube-messages.js', 'youtube-live.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), environment);
  const item = (id, chatId, type = 'textMessageEvent', extras = {}) => ({ id, authorDetails: { displayName: 'Viewer', channelId: 'author' }, snippet: {
    type, liveChatId: chatId, publishedAt: new Date(clock).toISOString(), textMessageDetails: { messageText: `hello ${chatId}` }, ...extras } });
  let customResponse = null;
  const dependencies = {
    auth: { async state() { return { connected }; }, async api(resource, params, signal) {
      calls.push({ resource, params, signal });
      if (resource === 'videos') return { items: room.sources.filter(source => source.platform === 'youtube').map(source => ({ id: source.key.slice(8),
        snippet: { channelTitle: 'Channel', title: source.label }, liveStreamingDetails: source.label === 'offline' ? {} : { activeLiveChatId: `chat-${source.key.slice(8)}` } })) };
      if (failVideo === params.liveChatId) throw new Error('Quota or access error');
      if (deferred) return deferred;
      return customResponse || { items: [item('message-id', params.liveChatId)], pollingIntervalMillis: 20000, nextPageToken: 'page-1' };
    } },
    service: { async getPair() { return room; } }, local: { async get() { return { enabled }; } }, session,
    publish() {}, now: () => clock,
    delay(callback, ms) { const id = ++serial; timers.set(id, { at: clock + ms, callback, ms }); return id; },
    cancel(id) { timers.delete(id); }
  };
  const makeLive = () => environment.CrossChat.createYouTubeLive(dependencies);
  const live = makeLive();
  const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };
  const fireNext = async () => {
    const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at)[0] || [];
    if (!timer) return false;
    timers.delete(id); clock = Math.max(clock, timer.at); timer.callback(); await flush(); return true;
  };
  return { live, makeLive, session, calls, timers, item, flush, fireNext,
    setConnected: value => { connected = value; }, setEnabled: value => { enabled = value; },
    setRoom: value => { room = value; }, advance: ms => { clock += ms; },
    fail: value => { failVideo = value; }, defer: value => { deferred = value; }, response: value => { customResponse = value; } };
}
test('YouTube does not spend quota until Start; reads multiple sources using per-chat cursors and server intervals', async () => {
  const h = harness(); await h.live.sync(); assert.equal(h.calls.length, 0);
  await h.live.start(); assert.equal(h.calls[0].resource, 'videos');
  await h.fireNext(); await h.fireNext();
  assert.equal(h.live.getMessages('room').length, 2);
  assert.equal(h.live.getMessages('other-room').length, 0);
  assert.equal(h.live.getStatus().state, 'polling');
  assert.ok([...h.timers.values()].every(timer => timer.ms === 20000));
  await h.fireNext();
  const chatCalls = h.calls.filter(call => call.resource === 'liveChat/messages');
  assert.equal(chatCalls[2].params.pageToken, 'page-1');
  assert.equal(h.live.getMessages('room').length, 2);
});
test('Stop aborts requests and late responses cannot restore messages or timers', async () => {
  const h = harness(); let resolve;
  h.defer(new Promise(done => { resolve = done; }));
  await h.live.start(); await h.fireNext();
  const signal = h.calls.at(-1).signal;
  await h.live.pause(); assert.equal(signal.aborted, true);
  resolve({ items: [h.item('late', 'chat-videoA')], nextPageToken: 'next', pollingIntervalMillis: 20000 });
  await h.flush();
  assert.equal(h.live.getMessages('room').length, 0); assert.equal(h.timers.size, 0);
  assert.equal(h.session.data['youtubeRun:v1'].active, false);
});
test('session duration and persisted request budget stop polling without an extra API call', async () => {
  const h = harness(); await h.live.start(); h.live.stop();
  h.session.data['youtubeRun:v1'].requests = 299;
  const restored = h.makeLive(); await restored.sync();
  await h.fireNext(); await h.fireNext();
  assert.equal(h.calls.filter(call => call.resource === 'liveChat/messages').length, 1);
  assert.match(restored.getStatus().message, /limit reached/);
  const timed = harness(); await timed.live.start(); timed.advance(31 * 60000); await timed.fireNext();
  assert.equal(timed.calls.filter(call => call.resource === 'liveChat/messages').length, 0);
  assert.equal(timed.session.data['youtubeRun:v1'].active, false);
});
test('worker recovery resumes saved cursors no earlier than the saved server deadline', async () => {
  const h = harness(); await h.live.start(); await h.fireNext(); await h.fireNext();
  const notBefore = h.session.data['youtubeRun:v1'].cursors['youtube:videoA'].notBefore;
  h.live.stop(); const restored = h.makeLive(); await restored.sync();
  assert.ok([...h.timers.values()].every(timer => timer.at >= notBefore));
  await h.fireNext();
  assert.equal(h.calls.at(-1).params.pageToken, 'page-1');
});
test('per-source API errors preserve other sources; offline video and chat-ended events stop their polls', async () => {
  const h = harness(); await h.live.start(); await h.fireNext(); await h.fireNext();
  h.fail('chat-videoA'); await h.fireNext();
  assert.equal(h.live.getStatus().sources.find(source => source.key === 'youtube:videoA').state, 'error');
  assert.equal(h.live.getMessages('room').length, 1);
  const ended = harness(); await ended.live.start();
  ended.response({ items: [ended.item('end', 'chat-videoA', 'chatEndedEvent')], offlineAt: '2026-10-26T20:00:01Z' });
  await ended.fireNext();
  assert.equal(ended.live.getStatus().sources.find(source => source.key === 'youtube:videoA').state, 'ended');
});
test('disable, room changes, and lost Google connection pause reading instead of following new sources automatically', async () => {
  for (const modify of [h => h.setEnabled(false), h => h.setConnected(false), h => h.setRoom({ key: 'other-room', sources: [] })]) {
    const h = harness(); await h.live.start(); modify(h); await h.live.sync();
    assert.equal(h.live.getStatus().state, 'paused');
    assert.equal(h.timers.size, 0); assert.equal(h.session.data['youtubeRun:v1'].active, false);
  }
});


test('chat-ended events need no continuation token and malformed live responses stop polling', async () => {
  const ended = harness(); await ended.live.start();
  ended.response({ items: [ended.item('end', 'chat-videoA', 'chatEndedEvent')] });
  await ended.fireNext();
  assert.equal(ended.live.getStatus().sources[0].state, 'ended');
  const malformed = harness(); await malformed.live.start(); malformed.response({ items: [] });
  await malformed.fireNext();
  assert.equal(malformed.live.getStatus().sources[0].state, 'error');
  assert.equal(malformed.calls.filter(call => call.resource === 'liveChat/messages').length, 1);
});
