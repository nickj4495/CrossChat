const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function harness() {
  const environment = { URL, URLSearchParams };
  vm.createContext(environment);
  for (const file of ['twitch-emotes.js', 'twitch-eventsub.js', 'twitch-buffer.js', 'twitch-live.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), environment);
  }
  const sockets = [];
  const requests = [];
  const timers = new Map();
  let timerId = 0;
  let enabled = true;
  let token = { userId: '99', clientId: 'test-client' };
  let room = { key: 'test-room', sources: [
    { key: 'twitch:alpha', platform: 'twitch', label: 'alpha' },
    { key: 'twitch:beta', platform: 'twitch', label: 'beta' },
    { key: 'youtube:video', platform: 'youtube', label: 'YouTube video' }
  ] };
  let failChannel = null;
  let pendingLookup = null;
  let publishes = 0;
  class Socket {
    constructor(url) { this.url = url; sockets.push(this); }
    close() { this.closed = true; }
    send() { throw new Error('EventSub must not receive application messages'); }
    async emit(frame) { if (this.onmessage) await this.onmessage({ data: JSON.stringify(frame) }); }
  }
  const auth = {
    async credentials() { return token; },
    async invalidate() { token = null; },
    async api(url, options) {
      if (url.startsWith('/users?')) return pendingLookup ? pendingLookup : { data: [{ id: '1', login: 'alpha' }, { id: '2', login: 'beta' }] };
      const body = JSON.parse(options.body);
      requests.push({ ...body, id: `sub-${requests.length}` });
      if (body.condition.broadcaster_user_id === failChannel) throw new Error('Twitch denied this channel.');
      return { data: [{ id: requests.at(-1).id, status: 'enabled' }] };
    }
  };
  const live = environment.CrossChat.createTwitchLive({ auth,
    service: { async getPair() { return room; } },
    local: { async get() { return { enabled }; } },
    publish() { publishes++; }, Socket,
    delay(callback, ms) { const id = ++timerId; timers.set(id, { callback, ms }); return id; },
    cancel(id) { timers.delete(id); }
  });
  const welcome = socket => socket.emit({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'session-id', keepalive_timeout_seconds: 10 } } });
  const notification = (channel, type, changes = {}, stamp = '2026-10-26T20:00:00Z') => {
    const userId = channel === 'alpha' ? '1' : '2';
    const sub = requests.find(request => request.condition.broadcaster_user_id === userId && request.type === type);
    return { metadata: { message_type: 'notification', message_timestamp: stamp }, payload: {
      subscription: { id: sub.id, type, version: '1', condition: sub.condition },
      event: { broadcaster_user_id: userId, broadcaster_user_login: channel,
        chatter_user_id: '123', chatter_user_name: 'Viewer', message_id: 'msg-1', message: { text: 'Real message' }, ...changes }
    } };
  };
  return { live, sockets, requests, timers, welcome, notification, auth,
    get publishes() { return publishes; }, setEnabled: value => { enabled = value; },
    setToken: value => { token = value; }, setRoom: value => { room = value; },
    failChannel: value => { failChannel = value; }, deferLookup: value => { pendingLookup = value; } };
}
test('one socket subscribes all Twitch sources including moderation and routes source-labeled native messages', async () => {
  const h = harness(); await h.live.sync();
  assert.equal(h.sockets.length, 1);
  assert.match(h.sockets[0].url, /^wss:\/\/eventsub\.wss\.twitch\.tv/);
  await h.welcome(h.sockets[0]);
  assert.equal(h.requests.length, 8);
  assert.ok(h.requests.every(request => request.condition.user_id === '99' && request.transport.session_id === 'session-id'));
  assert.equal(h.live.getStatus().state, 'live');
  const frame = h.notification('alpha', 'channel.chat.message');
  await h.sockets[0].emit(frame); await h.sockets[0].emit(frame);
  await h.sockets[0].emit(h.notification('beta', 'channel.chat.message'));
  const messages = h.live.getMessages('test-room');
  assert.equal(messages.length, 2);
  assert.equal(messages[0].sourceKey, 'twitch:alpha');
  assert.equal(messages[1].sourceKey, 'twitch:beta');
  assert.equal(messages[0].origin, 'twitch-eventsub');
  assert.equal(h.live.getMessages('unrelated-room').length, 0);
  frame.payload.subscription.id = 'unknown-sub';
  frame.payload.event.message_id = 'another-message';
  await h.sockets[0].emit(frame);
  assert.equal(h.live.getMessages('test-room').length, 2);
  const before = h.publishes; await h.live.sync(); await h.live.sync();
  assert.equal(h.publishes, before);
  assert.equal(h.sockets.length, 1);
});
test('moderator deletion, user clear, channel clear, and delayed deliveries do not restore removed text', async () => {
  const h = harness(); await h.live.sync(); await h.welcome(h.sockets[0]);
  const socket = h.sockets[0];
  await socket.emit(h.notification('alpha', 'channel.chat.message'));
  await socket.emit(h.notification('beta', 'channel.chat.message'));
  await socket.emit(h.notification('alpha', 'channel.chat.message_delete', { message_id: 'msg-1' }, '2026-10-26T20:00:01Z'));
  assert.equal(h.live.getMessages('test-room').length, 1);
  await socket.emit(h.notification('alpha', 'channel.chat.message'));
  assert.equal(h.live.getMessages('test-room').length, 1);
  await socket.emit(h.notification('alpha', 'channel.chat.message', { message_id: 'msg-2' }));
  await socket.emit(h.notification('alpha', 'channel.chat.clear_user_messages', { target_user_id: '123' }, '2026-10-26T20:00:02Z'));
  assert.equal(h.live.getMessages('test-room').length, 1);
  await socket.emit(h.notification('alpha', 'channel.chat.message', { message_id: 'delayed-old' }));
  assert.equal(h.live.getMessages('test-room').length, 1);
  await socket.emit(h.notification('alpha', 'channel.chat.message', { message_id: 'new-after-clear' }, '2026-10-26T20:00:03Z'));
  assert.equal(h.live.getMessages('test-room').length, 2);
  await socket.emit(h.notification('beta', 'channel.chat.clear', {}, '2026-10-26T20:00:04Z'));
  assert.equal(h.live.getMessages('test-room').length, 1);
});
test('server-directed reconnect retains subscriptions, closes old socket after welcome, and rejects other hosts', async () => {
  const h = harness(); await h.live.sync(); await h.welcome(h.sockets[0]);
  const old = h.sockets[0];
  await old.emit({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=test' } } });
  assert.equal(h.sockets.length, 2);
  assert.equal(old.closed, undefined);
  await h.welcome(h.sockets[1]);
  assert.equal(old.closed, true);
  assert.equal(h.requests.length, 8);
  await h.sockets[1].emit(h.notification('alpha', 'channel.chat.message'));
  assert.equal(h.live.getMessages('test-room').length, 1);
  await h.sockets[1].emit({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://attacker.example/ws' } } });
  assert.equal(h.sockets.length, 2);
  assert.equal(h.live.getStatus().state, 'reconnecting');
});
test('connection loss backs off and resubscribes, while disabled and signed-out states stop reading', async () => {
  const h = harness(); await h.live.sync(); await h.welcome(h.sockets[0]);
  h.sockets[0].onclose();
  const retry = [...h.timers.values()].find(timer => timer.ms === 2000);
  assert.ok(retry);
  retry.callback();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.equal(h.sockets.length, 2);
  await h.welcome(h.sockets[1]);
  assert.equal(h.requests.length, 16);
  h.setEnabled(false); await h.live.sync();
  assert.equal(h.sockets[1].closed, true);
  assert.equal(h.live.getStatus().state, 'paused');
  h.setEnabled(true); h.setToken(null); await h.live.sync();
  assert.equal(h.live.getStatus().state, 'signed-out');
});
test('partial failures are visible; revocation stops all sources until explicit recovery', async () => {
  const h = harness(); h.failChannel('2');
  await h.live.sync(); await h.welcome(h.sockets[0]);
  assert.equal(h.live.getStatus().state, 'partial');
  assert.equal(h.live.getStatus().sources.find(source => source.key === 'twitch:beta').state, 'error');
  const id = h.requests.find(request => request.condition.broadcaster_user_id === '1').id;
  await h.sockets[0].emit({ metadata: { message_type: 'revocation' }, payload: { subscription: { id, status: 'authorization_revoked' } } });
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.live.getStatus().state, 'error');
  await h.live.sync(); assert.equal(h.live.getStatus().state, 'signed-out');
});
test('stop during an in-flight channel lookup cannot reopen a socket', async () => {
  const h = harness(); let resolveLookup;
  h.deferLookup(new Promise(resolve => { resolveLookup = resolve; }));
  const starting = h.live.sync();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  h.live.stop();
  resolveLookup({ data: [{ id: '1', login: 'alpha' }] });
  await starting;
  assert.equal(h.sockets.length, 0);
});

test('native buffer keeps at most 200 messages and is cleared after connection loss or room change', async () => {
  const h = harness(); await h.live.sync(); await h.welcome(h.sockets[0]);
  for (let i = 0; i < 210; i++) await h.sockets[0].emit(h.notification('alpha', 'channel.chat.message', { message_id: `msg-${i}` }));
  assert.equal(h.live.getMessages('test-room').length, 200);
  assert.match(h.live.getMessages('test-room')[0].id, /msg-10$/);
  h.sockets[0].onclose();
  assert.equal(h.live.getMessages('test-room').length, 0);
  h.setRoom({ key: 'next-room', sources: [{ key: 'twitch:alpha', label: 'alpha', platform: 'twitch' }] });
  await h.live.sync();
  assert.equal(h.live.getMessages('test-room').length, 0);
  assert.equal(h.live.getMessages('next-room').length, 0);
});
test('keepalive resets the watchdog and a silent connection is closed and retried', async () => {
  const h = harness(); await h.live.sync(); await h.welcome(h.sockets[0]);
  const before = [...h.timers.keys()];
  await h.sockets[0].emit({ metadata: { message_type: 'session_keepalive' }, payload: {} });
  assert.ok(before.every(key => !h.timers.has(key)));
  const watchdog = [...h.timers.values()].find(timer => timer.ms === 12000);
  assert.ok(watchdog); watchdog.callback();
  assert.equal(h.sockets[0].closed, true);
  assert.equal(h.live.getStatus().state, 'reconnecting');
});

test('malformed/unknown frames are ignored without stopping a valid connection', async () => {
  const h = harness(); await h.live.sync(); await h.welcome(h.sockets[0]);
  await h.sockets[0].emit(null);
  await h.sockets[0].emit({ metadata: { message_type: 'unknown_event' } });
  await h.sockets[0].emit(h.notification('alpha', 'channel.chat.message'));
  await h.sockets[0].emit(h.notification('alpha', 'channel.chat.clear_user_messages', { target_user_id: '' }));
  assert.equal(h.live.getMessages('test-room').length, 1);
  assert.equal(h.live.getStatus().state, 'live');
});
