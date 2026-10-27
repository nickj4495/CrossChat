(() => {
  const app = globalThis.CrossChat;
  app.normalizeYouTubeMessage = (item, source, liveChatId) => {
    const snippet = item?.snippet;
    if (!snippet || snippet.liveChatId !== liveChatId || typeof item.id !== 'string' || !item.id || item.id.length > 500) return null;
    const time = Date.parse(snippet.publishedAt);
    if (!Number.isFinite(time)) return null;
    const base = { id: `youtube:${source.key.slice(8)}:${item.id}`, sourceKey: source.key, time };
    if (snippet.type === 'tombstone') return { ...base, kind: 'delete', targetId: base.id };
    if (snippet.type === 'chatEndedEvent') return { ...base, kind: 'end' };
    if (snippet.type === 'messageDeletedEvent') {
      const id = snippet.messageDeletedDetails?.deletedMessageId;
      return typeof id === 'string' && id ? { ...base, kind: 'delete', targetId: `youtube:${source.key.slice(8)}:${id}` } : null;
    }
    if (snippet.type === 'userBannedEvent') {
      const id = snippet.userBannedDetails?.bannedUserDetails?.channelId;
      return typeof id === 'string' && id ? { ...base, kind: 'ban', authorId: id } : null;
    }
    if (snippet.type !== 'textMessageEvent') return null;
    const text = snippet.textMessageDetails?.messageText;
    const author = item.authorDetails?.displayName;
    const authorId = item.authorDetails?.channelId || snippet.authorChannelId;
    if (typeof text !== 'string' || !text || text.length > 2000 ||
        typeof author !== 'string' || !author || author.length > 200 || typeof authorId !== 'string' || !authorId) return null;
    return { ...base, kind: 'message', platform: 'youtube', origin: 'youtube-api',
      sourceLabel: source.label, author, authorId, text, local: false };
  };
  app.createYouTubeBuffer = () => {
    let messages = [];
    const seen = new Set(); const deleted = new Set(); const bans = new Map();
    const remember = (set, id) => { set.add(id); if (set.size > 5000) set.delete(set.values().next().value); };
    return {
      apply(event) {
        if (!event || !['message', 'delete', 'ban'].includes(event.kind)) return;
        // Tombstones reuse the deleted message ID, so moderation precedes dedup.
        if (event.kind === 'delete') {
          remember(deleted, event.targetId);
          messages = messages.filter(message => message.id !== event.targetId);
          remember(seen, event.id);
          return;
        }
        if (seen.has(event.id)) return;
        remember(seen, event.id);
        if (event.kind === 'ban') {
          const key = `${event.sourceKey}:${event.authorId}`;
          bans.set(key, Math.max(bans.get(key) || 0, event.time));
          if (bans.size > 5000) bans.delete(bans.keys().next().value);
          messages = messages.filter(message => !(message.sourceKey === event.sourceKey && message.authorId === event.authorId && message.time <= event.time));
        } else if (!deleted.has(event.id) && event.time > (bans.get(`${event.sourceKey}:${event.authorId}`) || 0)) {
          messages.push(event); messages = messages.slice(-200);
        }
      },
      getMessages: () => messages.map(message => ({ ...message })),
      clearSource(key) { messages = messages.filter(message => message.sourceKey !== key); },
      clear() { messages = []; seen.clear(); deleted.clear(); bans.clear(); }
    };
  };
})();
