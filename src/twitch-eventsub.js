(() => {
  const app = globalThis.CrossChat = globalThis.CrossChat || {};
  // Pure adapter for documented EventSub WebSocket notifications. No connection,
  // authentication, storage, or DOM work happens here. The transport must verify
  // subscriptions before passing frames to this adapter.
  app.normalizeTwitchNotification = (frame, allowedChannels) => {
    if (!frame || frame.metadata?.message_type !== 'notification') return null;
    const subscription = frame.payload?.subscription;
    const event = frame.payload?.event;
    if (subscription?.type !== 'channel.chat.message' || subscription.version !== '1' || !event) return null;
    const channel = event.broadcaster_user_login;
    if (typeof channel !== 'string' || !/^[a-z0-9_]{1,25}$/.test(channel) || !allowedChannels.has(channel)) return null;
    if (typeof event.broadcaster_user_id !== 'string' ||
        subscription.condition?.broadcaster_user_id !== event.broadcaster_user_id) return null;
    const text = event.message?.text;
    const author = event.chatter_user_name || event.chatter_user_login;
    if (typeof text !== 'string' || !text || text.length > 500 ||
        typeof author !== 'string' || !author || author.length > 80 ||
        typeof event.message_id !== 'string' || !event.message_id || event.message_id.length > 200 ||
        typeof event.chatter_user_id !== 'string' || !/^\d+$/.test(event.chatter_user_id)) return null;
    const time = Date.parse(frame.metadata.message_timestamp);
    if (!Number.isFinite(time)) return null;
    return {
      id: `twitch:${channel}:${event.message_id}`,
      platform: 'twitch', origin: 'twitch-eventsub',
      sourceKey: `twitch:${channel}`, sourceLabel: channel,
      author, authorId: event.chatter_user_id, text, time, local: false
    };
  };
})();
