const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/twitch-eventsub.js'), 'utf8'), sandbox);
const normalize = sandbox.CrossChat.normalizeTwitchNotification;
const fixture = () => ({
  metadata: { message_type: 'notification', message_timestamp: '2026-10-26T18:22:00.123456789Z' },
  payload: {
    subscription: { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: '123' } },
    event: { broadcaster_user_id: '123', broadcaster_user_login: 'alpha',
      chatter_user_id: '456', chatter_user_name: 'ExampleViewer', chatter_user_login: 'exampleviewer',
      message_id: 'example-message-id', message: { text: 'Great play! Kappa', fragments: [] } }
  }
});
test('documented chat payload becomes a source-labeled native message with stable ID', () => {
  const message = normalize(fixture(), new Set(['alpha']));
  assert.equal(message.id, 'twitch:alpha:example-message-id');
  assert.equal(message.origin, 'twitch-eventsub');
  assert.equal(message.sourceKey, 'twitch:alpha');
  assert.equal(message.author, 'ExampleViewer');
  assert.equal(message.authorId, '456');
  assert.equal(message.text, 'Great play! Kappa');
  assert.equal(message.local, false);
  assert.equal(message.time, Date.parse('2026-10-26T18:22:00.123Z'));
  assert.equal(normalize(fixture(), new Set(['alpha'])).id, message.id);
});
test('unselected channels, wrong subscriptions, and malformed events are ignored', () => {
  assert.equal(normalize(fixture(), new Set(['beta'])), null);
  for (const modify of [
    frame => { frame.metadata.message_type = 'session_keepalive'; },
    frame => { frame.payload.subscription.type = 'channel.follow'; },
    frame => { frame.payload.subscription.version = '2'; },
    frame => { frame.payload.subscription.condition.broadcaster_user_id = '999'; },
    frame => { frame.metadata.message_timestamp = 'invalid'; },
    frame => { frame.payload.event.message.text = 'x'.repeat(501); },
    frame => { frame.payload.event.message_id = ''; },
    frame => { frame.payload.event.chatter_user_id = null; },
    frame => { frame.payload.event.broadcaster_user_login = 'bad\r\nchannel'; }
  ]) {
    const frame = fixture(); modify(frame);
    assert.equal(normalize(frame, new Set(['alpha'])), null);
  }
  assert.equal(normalize(null, new Set()), null);
});
test('message text remains literal and is never interpreted as markup', () => {
  const frame = fixture();
  frame.payload.event.message.text = '<img src=x onerror=alert(1)>';
  assert.equal(normalize(frame, new Set(['alpha'])).text, '<img src=x onerror=alert(1)>');
});
