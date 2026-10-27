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
