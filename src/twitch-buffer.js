(() => {
  const app = globalThis.CrossChat;
  // Native chat is intentionally session-only. Local demo history remains durable.
  app.createTwitchBuffer = () => {
    let messages = [];
    const seen = new Set();
    const removed = new Set();
    const blockedBefore = new Map();
    const remember = (set, key) => { set.add(key); if (set.size > 5000) set.delete(set.values().next().value); };
    return {
      getMessages: () => messages.map(message => ({ ...message })),
      append(message) {
        const cutoff = Math.max(blockedBefore.get(message.sourceKey) || 0,
          blockedBefore.get(`${message.sourceKey}:${message.authorId}`) || 0);
        if (seen.has(message.id) || removed.has(message.id) || message.time <= cutoff) return false;
        remember(seen, message.id);
        messages.push({ ...message });
        messages = messages.slice(-200);
        return true;
      },
      moderate(event, time) {
        if (event.type === 'channel.chat.message_delete') {
          remember(removed, `twitch:${event.channel}:${event.messageId}`);
          messages = messages.filter(message => message.id !== `twitch:${event.channel}:${event.messageId}`);
        } else {
          const key = event.userId ? `twitch:${event.channel}:${event.userId}` : `twitch:${event.channel}`;
          blockedBefore.set(key, Math.max(time, blockedBefore.get(key) || 0));
          if (blockedBefore.size > 5000) blockedBefore.delete(blockedBefore.keys().next().value);
          messages = messages.filter(message => !(message.sourceKey === `twitch:${event.channel}` &&
            (!event.userId || message.authorId === event.userId) && message.time <= time));
        }
      },
      clear() { messages = []; seen.clear(); removed.clear(); blockedBefore.clear(); }
    };
  };
})();
