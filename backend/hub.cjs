const { createHash } = require('node:crypto');
const { toPage } = require('./youtube-grpc.cjs');
const safeError = code => ({ 3: 'YouTube rejected a stream argument or resume token.', 7: 'YouTube denied access to this chat.',
  8: 'YouTube quota or rate limit reached. Check your Google project before restarting.',
  16: 'Google authorization needs renewal.' })[code] || 'YouTube streaming connection was interrupted.';
function createHub({ adapter, delay = setTimeout, cancel = clearTimeout }) {
  const feeds = new Map();
  function subscribe({ token, videoId, liveChatId, pageToken }, listener) {
    // Local milestone: sharing is scoped to identical authorization, not across
    // unrelated users. Do not expand this without server-side room access rules.
    const key = createHash('sha256').update(token).digest('hex') + ':' + liveChatId;
    let feed = feeds.get(key);
    if (!feed) {
      feed = { token, videoId, liveChatId, cursor: pageToken || null, listeners: new Set(), call: null,
        timer: null, stopped: false, retries: 0, resetCursor: false, terminal: false };
      feeds.set(key, feed);
    }
    feed.listeners.add(listener);
    const emit = event => { for (const callback of feed.listeners) callback(event); };
    const start = () => {
      feed.timer = null;
      if (feed.stopped || feed.terminal) return;
      emit({ type: 'source-status', videoId, state: 'connecting', message: 'Connecting to YouTube streaming…' });
      let call;
      try { call = adapter.open({ token: feed.token, liveChatId, pageToken: feed.cursor }); }
      catch {
        feed.terminal = true;
        emit({ type: 'source-status', videoId, state: 'error', message: 'Could not open YouTube streaming. Start again to retry.' }); return;
      }
      feed.call = call;
      let completed = false;
      const reconnect = (code, ended = false) => {
        if (completed || feed.stopped || feed.call !== call) return;
        completed = true; feed.call = null;
        if (ended && !feed.cursor) { feed.terminal = true; emit({ type: 'source-status', videoId, state: 'ended', message: 'YouTube stream closed with no continuation token.' }); return; }
        if ([7, 8, 16].includes(code) || code === 3 && (!feed.cursor || feed.resetCursor)) {
          feed.terminal = true;
          emit({ type: code === 16 ? 'auth-required' : 'source-status', videoId, state: 'error', message: safeError(code) }); return;
        }
        if (code === 3) { feed.cursor = null; feed.resetCursor = true; }
        if (++feed.retries > 6) { feed.terminal = true; emit({ type: 'source-status', videoId, state: 'error', message: 'YouTube reconnect limit reached. Start reading again to retry.' }); return; }
        const wait = Math.min(60000, 2000 * 2 ** (feed.retries - 1));
        emit({ type: 'source-status', videoId, state: 'reconnecting', message: `YouTube stream interrupted. Resuming in ${wait / 1000}s.` });
        feed.timer = delay(start, wait);
      };
      call.on('data', response => {
        if (feed.stopped || feed.call !== call) return;
        const page = toPage(response); feed.retries = 0;
        if (page.nextPageToken) feed.cursor = page.nextPageToken;
        emit({ type: 'page', videoId, liveChatId, page });
        const ended = page.offlineAt || page.items.some(item => item.snippet?.type === 'chatEndedEvent');
        if (ended) {
          completed = true; feed.terminal = true; feed.call = null; call.cancel();
          emit({ type: 'source-status', videoId, state: 'ended', message: 'YouTube broadcast ended.' });
        } else emit({ type: 'source-status', videoId, state: 'streaming', message: 'Receiving YouTube streaming updates.' });
      });
      call.on('error', error => reconnect(error.code));
      call.on('end', () => reconnect(0, true));
    };
    if (!feed.call && !feed.timer && !feed.terminal) start();
    else if (feed.terminal) listener({ type: 'source-status', videoId, state: 'error', message: 'This upstream subscription has stopped. Start again to retry.' });
    return () => {
      feed.listeners.delete(listener);
      if (!feed.listeners.size) {
        feed.stopped = true; cancel(feed.timer); feed.call?.cancel(); feed.token = null; feeds.delete(key);
      }
    };
  }
  return { subscribe, close() {
    for (const feed of feeds.values()) { feed.stopped = true; cancel(feed.timer); feed.call?.cancel(); feed.token = null; }
    feeds.clear(); adapter.close?.();
  }, get size() { return feeds.size; } };
}
module.exports = { createHub };
