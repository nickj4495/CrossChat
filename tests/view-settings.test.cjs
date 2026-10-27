const { test } = require('node:test'); const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const vm = require('node:vm');
const env = { URL }; vm.createContext(env);
for (const file of ['mock-chat.js', 'view-model.js', 'history.js', 'rooms.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), env);
const app = env.CrossChat;
function storage() {
  const data = {}; return { data,
    async get(key) { return { [key]: structuredClone(data[key]) }; },
    async set(values) { Object.assign(data, structuredClone(values)); }
  };
}
test('groups and colors persist independently of room identity and history, including remove/re-add', async () => {
  const store = storage(); const service = app.createRoomService(store);
  const urls = ['https://www.twitch.tv/alpha', 'https://www.twitch.tv/beta'];
  const room = await service.setSources(urls); await service.send(urls[0], room.key, 'keep my history');
  const before = JSON.stringify(store.data[`history:v1:${room.key}`]);
  const changed = await service.setSourceSettings('twitch:alpha', { groups: [' League of Legends ', 'Proplay', 'proplay'], color: '#00FF88' });
  assert.equal(changed.key, room.key);
  assert.equal(changed.sources[0].groups.length, 2); assert.equal(changed.sources[0].color, '#00ff88');
  assert.equal(JSON.stringify(store.data[`history:v1:${room.key}`]), before);
  await service.setSourceSettings('twitch:alpha', { color: '#ff9900' });
  assert.equal((await service.getPair()).sources[0].groups.length, 2);
  await service.setSources(['https://www.twitch.tv/beta', 'https://www.twitch.tv/gamma']);
  await service.setSources(urls);
  const restored = await service.getPair();
  assert.equal(restored.sources[0].color, '#ff9900');
  assert.equal(restored.sources[0].groups[0], 'League of Legends');
  assert.equal((await service.snapshot(urls[0])).messages.at(-1).text, 'keep my history');
});
test('invalid stream settings are rejected and automatic colors differ within a room', async () => {
  const service = app.createRoomService(storage());
  const room = await service.setSources(['https://www.twitch.tv/alpha', 'https://www.twitch.tv/beta']);
  assert.notEqual(room.sources[0].color, room.sources[1].color);
  for (const settings of [{ color: 'red' }, { groups: ['x'.repeat(41)] }, { groups: ['__ungrouped__'] }, { groups: Array(9).fill('one') }]) {
    await assert.rejects(service.setSourceSettings('twitch:alpha', settings));
  }
  await assert.rejects(service.setSourceSettings('twitch:missing', { color: '#ffffff' }));
});
test('group filtering uses OR across groups, intersects per-source hiding, and All restores everything', () => {
  const sources = [{ key: 'twitch:a', groups: ['League of Legends', 'Proplay'] }, { key: 'twitch:b', groups: ['Valorant'] }, { key: 'youtube:c', groups: [] }];
  let view = app.normalizeView({ selectedGroups: ['league of legends'] });
  assert.equal(app.sourceVisible('twitch:a', sources, view), true);
  assert.equal(app.sourceVisible('twitch:b', sources, view), false);
  view = app.normalizeView({ selectedGroups: ['proplay', 'valorant'], hiddenSources: ['twitch:a'] });
  assert.equal(app.sourceVisible('twitch:a', sources, view), false);
  assert.equal(app.sourceVisible('twitch:b', sources, view), true);
  view = app.normalizeView({ selectedGroups: ['__ungrouped__'] });
  assert.equal(app.sourceVisible('youtube:c', sources, view), true);
  view = app.normalizeView();
  assert.ok(sources.every(source => app.sourceVisible(source.key, sources, view)));
});
test('view patches merge concurrently, persist sizes/filters, and bound unsafe dimensions', async () => {
  const store = storage(); const settings = app.createViewSettings(store);
  await Promise.all([settings.update({ width: 600 }), settings.update({ height: 800 }), settings.update({ selectedGroups: ['Proplay'] })]);
  const restored = await app.createViewSettings(store).get();
  assert.equal(restored.width, 600); assert.equal(restored.height, 800); assert.equal(restored.selectedGroups[0], 'proplay');
  assert.equal((await settings.update({ width: 99999 })).width, 720);
  assert.equal((await settings.update({ height: 1 })).height, 420);
  await assert.rejects(settings.update({ width: '600' }));
  await assert.rejects(settings.update({ unsupported: true }));
  assert.equal(app.normalizeView(null).width, 380);
});
