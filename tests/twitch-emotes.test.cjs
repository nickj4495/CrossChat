const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function harness(reducedMotion = false) {
  class Element {
    constructor(tagName) { this.tagName = tagName; this.children = []; this.handlers = {}; this._text = ''; }
    set textContent(value) { this.children = []; this._text = value; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(value) { throw new Error('Message rendering must not parse HTML'); }
    append(child) { this.children.push(child); child.parent = this; }
    addEventListener(type, listener) { this.handlers[type] = listener; }
    replaceWith(node) { const index = this.parent.children.indexOf(this); this.parent.children[index] = node; node.parent = this.parent; }
  }
  const document = { createElement: tagName => new Element(tagName) };
  const environment = { document, matchMedia: () => ({ matches: reducedMotion }) };
  vm.createContext(environment);
  for (const file of ['twitch-emotes.js', 'twitch-eventsub.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), environment);
  const body = document.createElement('p');
  const native = (text, fragments) => ({ platform: 'twitch', origin: 'twitch-eventsub', local: false, text, fragments });
  return { app: environment.CrossChat, body, native };
}
const emote = (text, id, format = ['static']) => ({ type: 'emote', text, emote: { id, format } });
test('mixed Unicode text, repeated global emotes, and channel emotes preserve exact order', () => {
  const h = harness();
  const parts = [{ type: 'text', text: '😀 Nice  ' }, emote('Kappa', '25'), { type: 'text', text: ' ' },
    emote('Kappa', '25'), { type: 'text', text: ' / ' }, emote('channelHype', 'emotesv2_example-channel-id')];
  const text = parts.map(part => part.text).join('');
  h.app.renderMessageBody(h.body, h.native(text, parts));
  assert.equal(h.body.children.map(node => node.tagName === 'img' ? node.alt : node.textContent).join(''), text);
  const images = h.body.children.filter(node => node.tagName === 'img');
  assert.equal(images.length, 3);
  assert.equal(images[0].src, 'https://static-cdn.jtvnw.net/emoticons/v2/25/static/dark/2.0');
  assert.equal(images[2].title, 'channelHype');
  assert.equal(images[0].referrerPolicy, 'no-referrer');
});
test('declared animated emotes animate unless reduced motion is requested', () => {
  for (const reducedMotion of [false, true]) {
    const h = harness(reducedMotion);
    h.app.renderMessageBody(h.body, h.native('Dance', [emote('Dance', 'emotesv2_dance', ['static', 'animated'])]));
    assert.ok(h.body.children[0].src.includes(reducedMotion ? '/static/' : '/animated/'));
  }
});
test('failed emote loads replace the image with the original readable name', () => {
  const h = harness();
  h.app.renderMessageBody(h.body, h.native('Hi Kappa!', [{ type: 'text', text: 'Hi ' }, emote('Kappa', '25'), { type: 'text', text: '!' }]));
  h.body.children[1].handlers.error();
  assert.equal(h.body.children[1].tagName, 'span');
  assert.equal(h.body.textContent, 'Hi Kappa!');
});
test('malformed or mismatched fragment lists fall back without losing text', () => {
  const h = harness();
  for (const parts of [undefined, [], [null], [{ text: 'wrong' }], Array(501).fill({ text: '' })]) {
    h.app.renderMessageBody(h.body, h.native('Original message', parts));
    assert.equal(h.body.textContent, 'Original message');
    assert.equal(h.body.children.filter(node => node.tagName === 'img').length, 0);
  }
});
test('untrusted IDs/markup stay literal and only native Twitch messages render emote images', () => {
  const h = harness();
  const text = '<img src=x onerror=alert(1)>';
  for (const id of ['../escape', 'https://attacker.example/x', 'x" onerror="alert(1)', 'javascript:alert(1)']) {
    h.app.renderMessageBody(h.body, h.native(text, [emote(text, id)]));
    assert.equal(h.body.textContent, text);
    assert.equal(h.body.children.filter(node => node.tagName === 'img').length, 0);
  }
  for (const changes of [{ local: true }, { platform: 'youtube' }, { origin: undefined }]) {
    h.app.renderMessageBody(h.body, { ...h.native('Kappa', [emote('Kappa', '25')]), ...changes });
    assert.equal(h.body.textContent, 'Kappa');
    assert.equal(h.body.children.length, 0);
  }
});
test('EventSub normalization carries sanitized emote data through to the renderer', () => {
  const h = harness();
  const frame = {
    metadata: { message_type: 'notification', message_timestamp: '2026-10-26T20:00:00Z' },
    payload: {
      subscription: { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: '1' } },
      event: { broadcaster_user_id: '1', broadcaster_user_login: 'alpha', chatter_user_id: '2', chatter_user_name: 'Viewer',
        message_id: 'id', message: { text: 'Hi Kappa', fragments: [{ type: 'text', text: 'Hi ' }, emote('Kappa', '25')] } }
    }
  };
  const message = h.app.normalizeTwitchNotification(frame, new Set(['alpha']));
  assert.equal(message.fragments[1].emote.id, '25');
  frame.payload.event.message.fragments[1].emote.id = 'changed';
  assert.equal(message.fragments[1].emote.id, '25');
  h.app.renderMessageBody(h.body, message);
  assert.equal(h.body.children[1].tagName, 'img');
});
