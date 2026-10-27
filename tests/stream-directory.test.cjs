const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
function harness(session) {
  const env = { URLSearchParams, CrossChat: {} }; vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/stream-directory.js'), 'utf8'), env);
  let clock = 100000; let signedIn = true; let fail = false; const calls = []; let published = 0;
  const sources = [{ key: 'twitch:alpha', platform: 'twitch', label: 'alpha', groups: [], color: '#ffffff' },
    { key: 'twitch:beta', platform: 'twitch', label: 'beta' }, { key: 'youtube:live', platform: 'youtube' },
    { key: 'youtube:offline', platform: 'youtube' }, { key: 'youtube:upcoming', platform: 'youtube' }, { key: 'youtube:missing', platform: 'youtube' }];
  const directory = env.CrossChat.createStreamDirectory({
    session, service: { async getPair() { return { key: 'room', sources }; } }, now: () => clock, publish() { published++; },
    getTwitch: () => ({ async state() { return { login: signedIn ? 'reader' : null }; }, async api(url) {
      calls.push(url); if (fail) throw new Error('Twitch unavailable');
      return url.startsWith('/users?') ? { data: [{ login: 'alpha', display_name: 'Alpha' }, { login: 'beta' }] } : { data: [{ user_login: 'alpha', type: 'live', title: 'Broadcast' }] };
    } }),
    getYouTube: () => ({ async state() { return { connected: signedIn }; }, async api() {
      calls.push('videos'); if (fail) throw new Error('YouTube quota exceeded');
      return { items: ['live', 'offline', 'upcoming'].map(id => ({ id, snippet: { title: id, channelTitle: 'Channel', liveBroadcastContent: id === 'offline' ? 'none' : id } })) };
    } })
  });
  const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
  return { directory, sources, calls, flush, get published() { return published; }, advance: ms => { clock += ms; }, signOut: () => { signedIn = false; }, fail: () => { fail = true; } };
}
test('broadcast status distinguishes live/offline/upcoming/unknown independently of chat connections', async () => {
  const h = harness(); let result = await h.directory.get(); assert.equal(result.refreshing, true);
  await h.flush(); result = await h.directory.get();
  const state = key => result.sources.find(source => source.key === key).liveState;
  assert.equal(state('twitch:alpha'), 'live'); assert.equal(state('twitch:beta'), 'offline');
  assert.equal(state('youtube:live'), 'live'); assert.equal(state('youtube:offline'), 'offline');
  assert.equal(state('youtube:upcoming'), 'upcoming'); assert.equal(state('youtube:missing'), 'unknown');
  assert.equal(h.published, 1);
});
test('many viewers share cached lookups; forced refresh is bounded and metadata updates do not invalidate live status', async () => {
  const h = harness(); await h.directory.get(); await h.flush();
  for (let i = 0; i < 30; i++) await h.directory.get();
  assert.equal(h.calls.length, 3);
  h.sources[0].groups = ['League']; h.sources[0].color = '#00ff88';
  const result = await h.directory.get(); assert.equal(result.sources[0].groups[0], 'League'); assert.equal(result.sources[0].color, '#00ff88');
  await h.directory.get(true); await h.flush(); assert.equal(h.calls.length, 3);
  h.advance(11000); await h.directory.get(true); await h.flush(); assert.equal(h.calls.length, 6);
  h.advance(61000); await h.directory.get(); await h.flush(); assert.equal(h.calls.length, 9);
});
test('sign-out and API errors show Unknown rather than incorrectly reporting Offline', async () => {
  const h = harness(); await h.directory.get(); await h.flush(); h.signOut();
  await h.directory.get(); await h.flush();
  assert.ok((await h.directory.get()).sources.every(source => source.liveState === 'unknown'));
  assert.equal(h.calls.length, 3);
  const broken = harness(); broken.fail(); await broken.directory.get(); await broken.flush();
  assert.ok((await broken.directory.get()).sources.every(source => source.liveState === 'unknown'));
});


test('metadata cache survives a service-worker restart without duplicate API calls', async () => {
  const data = {}; const session = { async get(key) { return { [key]: structuredClone(data[key]) }; }, async set(values) { Object.assign(data, structuredClone(values)); } };
  const first = harness(session); await first.directory.get(); await first.flush();
  const restored = harness(session); const directory = await restored.directory.get();
  assert.equal(restored.calls.length, 0);
  assert.equal(directory.sources.find(source => source.key === 'twitch:alpha').liveState, 'live');
  restored.advance(61000); await restored.directory.get(); await restored.flush();
  assert.equal(restored.calls.length, 3);
});
