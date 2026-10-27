(() => {
  const app = globalThis.CrossChat;
  const types = ['channel.chat.message', 'channel.chat.message_delete', 'channel.chat.clear', 'channel.chat.clear_user_messages'];
  app.createTwitchLive = ({ auth, service, local, publish, Socket = WebSocket,
    delay = setTimeout, cancel = clearTimeout }) => {
    const buffer = app.createTwitchBuffer();
    let status = { state: 'signed-out', message: 'Sign in through the extension popup to read Twitch chat.', sources: [] };
    let roomKey = null;
    let signature = null;
    let generation = 0;
    let current = null;
    let previous = null;
    let retry = null;
    let attempts = 0;
    let operations = Promise.resolve();
    let subscriptions = new Map();
    let users = [];
    let reader = null;
    const notify = () => { Promise.resolve(publish()).catch(() => {}); };
    const update = (state, message, sources = status.sources) => {
      const next = { state, message, sources };
      if (JSON.stringify(next) !== JSON.stringify(status)) { status = next; notify(); }
    };
    const dispose = record => {
      if (!record) return;
      cancel(record.deadline);
      record.socket.onmessage = record.socket.onerror = record.socket.onclose = null;
      record.socket.close();
    };
    const disconnect = () => {
      generation++;
      cancel(retry); retry = null;
      dispose(current); dispose(previous);
      current = previous = null;
      subscriptions.clear();
    };
    const fail = message => {
      disconnect();
      buffer.clear();
      attempts++;
      const wait = Math.min(60000, 2000 * 2 ** Math.min(attempts - 1, 5));
      update('reconnecting', `${message} Retrying in ${Math.ceil(wait / 1000)}s. Messages during the gap cannot be recovered.`);
      retry = delay(() => { retry = null; sync().catch(() => {}); }, wait);
    };
    const connect = (url = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=10', transfer = false) => {
      const expectedGeneration = generation;
      const socket = new Socket(url);
      const record = { socket, deadline: null, welcomed: false, timeout: 10000 };
      if (transfer) previous = current;
      current = record;
      const valid = () => generation === expectedGeneration && (current === record || previous === record);
      const arm = () => {
        cancel(record.deadline);
        record.deadline = delay(() => { if (valid()) fail('Twitch stopped responding.'); }, record.timeout + 2000);
      };
      arm();
      socket.onerror = () => { if (valid()) fail('Twitch connection failed.'); };
      socket.onclose = () => { if (valid()) fail('Twitch connection closed.'); };
      socket.onmessage = async event => {
        if (!valid()) return;
        let frame;
        try { frame = JSON.parse(event.data); } catch { return; }
        const kind = frame?.metadata?.message_type;
        if (!['session_welcome', 'session_keepalive', 'notification', 'session_reconnect', 'revocation'].includes(kind)) return;
        arm();
        try {
          if (kind === 'session_welcome') {
            if (record.welcomed) return;
            const session = frame.payload?.session;
            if (!session?.id || !Number.isFinite(session.keepalive_timeout_seconds)) throw new Error('Twitch returned an invalid welcome message.');
            record.welcomed = true;
            record.timeout = session.keepalive_timeout_seconds * 1000;
            arm();
            if (transfer) {
              dispose(previous); previous = null;
              attempts = 0;
              const liveCount = status.sources.filter(source => source.state === 'live').length;
              update(liveCount === status.sources.length ? 'live' : 'partial', "Reading Twitch chat. YouTube remains demo-only.");
              return;
            }
            const results = await Promise.all(users.map(async user => {
              try {
                const entries = await Promise.all(types.map(async type => {
                  const result = await auth.api('/eventsub/subscriptions', { method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ type, version: '1', condition: {
                      broadcaster_user_id: user.id, user_id: reader.userId
                    }, transport: { method: 'websocket', session_id: session.id } }) });
                  const sub = result?.data?.[0];
                  if (!sub?.id || sub.status !== 'enabled') throw new Error('Twitch did not enable a chat subscription.');
                  return [sub.id, { type, channel: user.login, userId: user.id }];
                }));
                if (valid()) entries.forEach(([id, details]) => subscriptions.set(id, details));
                return { key: `twitch:${user.login}`, label: user.login, state: 'live' };
              } catch (error) {
                return { key: `twitch:${user.login}`, label: user.login, state: 'error', message: error.message };
              }
            }));
            if (!valid()) return;
            const missing = status.sources.filter(source => source.state === 'error' && !users.some(user => `twitch:${user.login}` === source.key));
            const sources = [...results, ...missing];
            const count = results.filter(source => source.state === 'live').length;
            if (!count) {
              disconnect();
              update('error', 'No Twitch chats could be subscribed. Check source errors and use Reconnect.', sources);
              return;
            }
            attempts = 0;
            update(count === sources.length ? 'live' : 'partial', `Reading ${count}/${sources.length} Twitch chats. YouTube remains demo-only.`, sources);
          } else if (kind === 'notification') {
            const sub = frame.payload?.subscription;
            const allowed = subscriptions.get(sub?.id);
            const chatEvent = frame.payload?.event;
            if (!allowed || sub.type !== allowed.type || sub.version !== '1' ||
                sub.condition?.user_id !== reader.userId ||
                sub.condition?.broadcaster_user_id !== allowed.userId ||
                chatEvent?.broadcaster_user_id !== allowed.userId ||
                chatEvent?.broadcaster_user_login !== allowed.channel) return;
            if (sub.type === 'channel.chat.message') {
              const message = app.normalizeTwitchNotification(frame, new Set([allowed.channel]));
              if (message && buffer.append(message)) notify();
            } else {
              const time = Date.parse(frame.metadata.message_timestamp);
              if (!Number.isFinite(time)) return;
              if (sub.type === 'channel.chat.message_delete' && typeof chatEvent.message_id !== 'string') return;
              if (sub.type === 'channel.chat.clear_user_messages' && (typeof chatEvent.target_user_id !== 'string' || !/^\d+$/.test(chatEvent.target_user_id))) return;
              buffer.moderate({ type: sub.type, channel: allowed.channel,
                messageId: chatEvent.message_id, userId: sub.type === 'channel.chat.clear_user_messages' ? chatEvent.target_user_id : null }, time);
              notify();
            }
          } else if (kind === 'session_reconnect') {
            const target = new URL(frame.payload?.session?.reconnect_url);
            if (target.protocol !== 'wss:' || target.hostname !== 'eventsub.wss.twitch.tv' || target.port || target.username || target.password) throw new Error('Twitch supplied an invalid reconnect address.');
            if (previous || current !== record) return;
            update('reconnecting', 'Twitch is moving the connection.');
            connect(target.href, true);
          } else if (kind === 'revocation') {
            const revoked = subscriptions.get(frame.payload?.subscription?.id);
            if (!revoked) return;
            if (frame.payload.subscription.status === 'authorization_revoked') await auth.invalidate();
            // Pause all sources if moderation or message access is revoked. Do not
            // continue displaying a channel whose removals we can no longer receive.
            disconnect();
            buffer.clear();
            update('error', 'Twitch revoked a subscription. Sign in again or use Reconnect.', status.sources.map(source => ({ ...source, state: 'paused' })));
          }
        } catch (error) {
          if (valid()) fail(error.message || 'Twitch event handling failed.');
        }
      };
    };
    const synchronize = async restart => {
      const initialGeneration = generation;
      const pair = await service.getPair();
      const enabled = (await local.get({ enabled: true })).enabled !== false;
      let saved;
      try { saved = await auth.credentials(); }
      catch (error) { disconnect(); update('error', error.message); return; }
      if (initialGeneration !== generation) return;
      const desired = pair?.sources?.filter(source => source.platform === 'twitch') || [];
      const next = JSON.stringify([enabled, pair?.key, saved?.userId, saved?.clientId, desired.map(source => source.key)]);
      const changed = next !== signature;
      if (changed || restart) {
        disconnect(); buffer.clear(); roomKey = pair?.key || null; signature = next; attempts = 0; notify();
      }
      if (!enabled) { update('paused', 'CrossChat is disabled. Live reading is paused.', []); return; }
      if (!saved) { disconnect(); buffer.clear(); update('signed-out', 'Sign in through the extension popup to read Twitch chat.', []); return; }
      if (!desired.length) { disconnect(); update('idle', 'Save a room containing Twitch channels to start live reading.', []); return; }
      if (current || retry || status.state === 'error' && !restart && !changed) return;
      const connectionGeneration = generation;
      reader = saved;
      update('connecting', 'Looking up Twitch channels…', desired.map(source => ({ key: source.key, label: source.label, state: 'connecting' })));
      try {
        const query = new URLSearchParams();
        desired.forEach(source => query.append('login', source.key.slice(7)));
        const result = await auth.api(`/users?${query}`);
        if (connectionGeneration !== generation) return;
        users = (result?.data || []).filter(user => desired.some(source => source.key === `twitch:${user.login}`));
        const sources = desired.map(source => ({ key: source.key, label: source.label,
          state: users.some(user => `twitch:${user.login}` === source.key) ? 'connecting' : 'error',
          message: users.some(user => `twitch:${user.login}` === source.key) ? undefined : 'Channel not found.' }));
        if (!users.length) { update('error', 'None of these Twitch channels could be found. Check the room URLs.', sources); return; }
        update('connecting', 'Connecting to Twitch chat…', sources);
        connect();
      } catch (error) { if (connectionGeneration === generation) { disconnect(); update('error', error.message); } }
    };
    const sync = (restart = false) => {
      const result = operations.then(() => synchronize(restart));
      operations = result.catch(() => {});
      return result;
    };
    return {
      sync,
      getStatus: key => key && key !== roomKey ? { state: 'idle', message: 'Live Twitch reading applies to your saved room only.', sources: [] } : { ...status, sources: status.sources.map(source => ({ ...source })) },
      getMessages: key => key === roomKey ? buffer.getMessages() : [],
      stop() { disconnect(); buffer.clear(); signature = null; update('paused', 'Twitch reading stopped.', []); }
    };
  };
})();
