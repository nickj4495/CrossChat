(() => {
  const app = globalThis.CrossChat;
  app.createRoomService = storage => {
    let pending = Promise.resolve();
    const enqueue = work => {
      const result = pending.then(work);
      pending = result.catch(() => {});
      return result;
    };
    const getPair = async () => (await storage.get('roomPair:v1'))['roomPair:v1'] || null;
    const resolve = async href => {
      const context = app.getPageContext(href);
      if (!context) throw new Error('Open a supported Twitch channel or YouTube video.');
      const pair = await getPair();
      const paired = pair && [pair.twitchKey, pair.youtubeKey].includes(context.key);
      return { context, pair: paired ? pair : null, key: paired ? pair.key : context.key };
    };
    return {
      getPair: () => enqueue(getPair),
      setPair(twitchUrl, youtubeUrl) {
        return enqueue(async () => {
          const twitch = app.getPageContext(twitchUrl);
          const youtube = app.getPageContext(youtubeUrl);
          if (twitch?.platform !== 'twitch' || youtube?.platform !== 'youtube') {
            throw new Error('Enter a full Twitch channel URL and a YouTube watch or live URL.');
          }
          const pair = {
            key: `room:${twitch.key}:${youtube.key}`,
            twitchKey: twitch.key, youtubeKey: youtube.key,
            twitchUrl: `https://www.twitch.tv/${twitch.key.slice(7)}`,
            youtubeUrl: `https://www.youtube.com/watch?v=${youtube.key.slice(8)}`
          };
          // Create/validate the room before activating it. Prior page histories stay intact.
          await app.createPersistentChat({ key: pair.key }, storage);
          await storage.set({ 'roomPair:v1': pair });
          return pair;
        });
      },
      clearPair: () => enqueue(() => storage.set({ 'roomPair:v1': null })),
      snapshot(href) {
        return enqueue(async () => {
          const room = await resolve(href);
          const chat = await app.createPersistentChat({ key: room.key }, storage);
          return { key: room.key, pair: room.pair, messages: chat.getMessages() };
        });
      },
      send(href, expectedKey, text) {
        return enqueue(async () => {
          const room = await resolve(href);
          if (room.key !== expectedKey) throw new Error('Room changed. Check the room shown above and send again.');
          if (typeof text !== 'string') throw new Error('Enter a text message.');
          const chat = await app.createPersistentChat({ key: room.key }, storage);
          const message = await chat.send(text, room.context.platform);
          if (!message) throw new Error('Enter a message of 1–500 characters.');
          return { key: room.key, pair: room.pair, messages: chat.getMessages(), message };
        });
      }
    };
  };
})();
