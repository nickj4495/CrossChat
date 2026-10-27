(() => {
  const app = globalThis.CrossChat;
  function validMessage(message) {
    return message && ['twitch', 'youtube'].includes(message.platform) &&
      typeof message.author === 'string' && message.author.length <= 80 &&
      typeof message.text === 'string' && message.text.length <= 500 &&
      Number.isFinite(message.time) && Math.abs(message.time) <= 8640000000000000 &&
      typeof message.local === 'boolean' &&
      (message.sourceKey === undefined || typeof message.sourceKey === 'string' && message.sourceKey.length <= 300) &&
      (message.sourceLabel === undefined || typeof message.sourceLabel === 'string' && message.sourceLabel.length <= 300);
  }
  app.createPersistentChat = async (context, storage = chrome.storage.local) => {
    const key = `history:v1:${context.key}`;
    const stored = (await storage.get(key))[key];
    if (stored !== undefined && (!stored || stored.version !== 1 ||
        !Array.isArray(stored.messages) || !stored.messages.every(validMessage))) {
      throw new Error('Saved CrossChat history is invalid. Existing data was left untouched.');
    }
    let chat = app.createMockChat(stored?.messages ?? context.initialMessages);
    // Save seed data only on first visit. Existing history is never reseeded.
    if (stored === undefined) await storage.set({ [key]: { version: 1, messages: chat.getMessages() } });
    let pending = Promise.resolve();
    return {
      getMessages: () => chat.getMessages(),
      send(text, platform, source = null) {
        const operation = pending.then(async () => {
          const candidate = app.createMockChat(chat.getMessages());
          const message = candidate.send(text, platform, source);
          if (!message) return null;
          // Commit in memory only after storage confirms the write.
          await storage.set({ [key]: { version: 1, messages: candidate.getMessages() } });
          chat = candidate;
          return message;
        });
        pending = operation.catch(() => {});
        return operation;
      }
    };
  };
})();
