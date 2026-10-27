(() => {
  const app = globalThis.CrossChat;
  const sourceFromKey = key => {
    const platform = key.startsWith('twitch:') ? 'twitch' : 'youtube';
    const id = key.slice(platform.length + 1);
    return {
      key, platform,
      label: platform === 'twitch' ? id : `YouTube video ${id}`,
      url: platform === 'twitch' ? `https://www.twitch.tv/${id}` : `https://www.youtube.com/watch?v=${id}`
    };
  };
  const normalizePair = pair => pair ? {
    ...pair,
    sources: pair.sources || [sourceFromKey(pair.twitchKey), sourceFromKey(pair.youtubeKey)]
  } : null;
  app.createRoomService = storage => {
    let pending = Promise.resolve();
    const enqueue = work => {
      const result = pending.then(work);
      pending = result.catch(() => {});
      return result;
    };
    const getPair = async () => {
      const pair = normalizePair((await storage.get('roomPair:v1'))['roomPair:v1'] || null);
      if (!pair) return null;
      const saved = (await storage.get('sourceSettings:v1'))['sourceSettings:v1'] || {};
      return { ...pair, sources: pair.sources.map((source, index) => {
        const settings = saved[source.key] || {};
        let groups = [];
        try { groups = app.normalizeGroups(settings.groups || []); } catch { /* Invalid metadata does not block chat. */ }
        return { ...source, groups, color: /^#[0-9a-f]{6}$/i.test(settings.color) ? settings.color.toLowerCase() : app.sourcePalette[index % app.sourcePalette.length] };
      }) };
    };
    const resolve = async href => {
      const context = app.getPageContext(href);
      if (!context) throw new Error('Open a supported Twitch channel or YouTube video.');
      const pair = await getPair();
      const paired = pair && pair.sources.some(source => source.key === context.key);
      return { context, pair: paired ? pair : null, key: paired ? pair.key : context.key };
    };
    const seeds = sources => {
      const samples = app.createMockChat().getMessages();
      return Array.from({ length: Math.max(6, sources.length * 2) }, (_, index) => {
        const source = sources[index % sources.length];
        return { ...samples[index % samples.length],
          text: index % 2 ? 'Hello from this source! 👋 (sample message)' : 'Ready for the next play! (sample message)',
          time: Date.now() - (Math.max(6, sources.length * 2) - index) * 45000,
          platform: source.platform, sourceKey: source.key, sourceLabel: source.label };
      });
    };
    const openChat = room => app.createPersistentChat({ key: room.key,
      initialMessages: room.pair ? seeds(room.pair.sources) : undefined }, storage);
    const decorate = (messages, room) => messages.map(message => {
      const sources = room.pair?.sources || [sourceFromKey(room.context.key)];
      const matches = sources.filter(source => source.platform === message.platform);
      // Legacy paired histories had at most one source per platform. Never guess
      // a channel when an old message could belong to several different sources.
      const source = message.sourceKey ? sources.find(item => item.key === message.sourceKey)
        : matches.length === 1 ? matches[0] : null;
      return { ...message,
        sourceKey: source?.key || message.sourceKey || `demo:${message.platform}`,
        sourceLabel: source?.label || message.sourceLabel || `Demo ${message.platform} sample` };
    });
    const activate = async urls => {
      if (!Array.isArray(urls) || urls.length < 2 || urls.length > 10) throw new Error('Enter 2–10 stream URLs, one per line.');
      const sources = urls.map((url, index) => {
        let context;
        try { context = app.getPageContext(url); } catch { /* Report the line below. */ }
        if (!context || context.key.length > 200) throw new Error(`Line ${index + 1}: enter a full Twitch channel or YouTube watch/live URL.`);
        return sourceFromKey(context.key);
      });
      if (new Set(sources.map(source => source.key)).size !== sources.length) throw new Error('Each source must be unique. Remove duplicate channels or videos.');
      sources.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
      const twitch = sources.find(source => source.platform === 'twitch');
      const youtube = sources.find(source => source.platform === 'youtube');
      // Keep the old key for a Twitch+YouTube pair to preserve its saved history.
      const key = sources.length === 2 && twitch && youtube
        ? `room:${twitch.key}:${youtube.key}`
        : `room:v2:${sources.map(source => source.key).join('|')}`;
      const pair = { key, sources };
      if (sources.length === 2 && twitch && youtube) Object.assign(pair, {
        twitchKey: twitch.key, youtubeKey: youtube.key, twitchUrl: twitch.url, youtubeUrl: youtube.url
      });
      await openChat({ key, pair });
      await storage.set({ 'roomPair:v1': pair });
      return getPair();
    };
    return {
      getPair: () => enqueue(getPair),
      setSources: urls => enqueue(() => activate(urls)),
      setSourceSettings(key, settings) {
        return enqueue(async () => {
          const pair = await getPair();
          const source = pair?.sources.find(item => item.key === key);
          if (!source) throw new Error('Save this stream in the room before editing its groups or color.');
          const groups = settings?.groups === undefined ? source.groups : app.normalizeGroups(settings.groups);
          const color = settings?.color ?? source.color;
          if (typeof color !== 'string' || !/^#[0-9a-f]{6}$/i.test(color)) throw new Error('Choose a valid stream color.');
          const sources = pair.sources.map(item => item.key === key ? { ...item, groups } : item);
          if (app.roomGroups(sources).length > 20) throw new Error('Use up to 20 groups in a room.');
          const saved = (await storage.get('sourceSettings:v1'))['sourceSettings:v1'] || {};
          await storage.set({ 'sourceSettings:v1': { ...saved, [key]: { groups, color: color.toLowerCase() } } });
          return getPair();
        });
      },
      // Backward-compatible entry point for existing two-platform callers.
      setPair(twitchUrl, youtubeUrl) {
        return enqueue(async () => {
          if (app.getPageContext(twitchUrl)?.platform !== 'twitch' || app.getPageContext(youtubeUrl)?.platform !== 'youtube') {
            throw new Error('Enter a full Twitch channel URL and a YouTube watch or live URL.');
          }
          return activate([twitchUrl, youtubeUrl]);
        });
      },
      clearPair: () => enqueue(() => storage.set({ 'roomPair:v1': null })),
      snapshot(href) {
        return enqueue(async () => {
          const room = await resolve(href);
          const chat = await openChat(room);
          return { key: room.key, pair: room.pair, messages: decorate(chat.getMessages(), room) };
        });
      },
      send(href, expectedKey, text) {
        return enqueue(async () => {
          const room = await resolve(href);
          if (room.key !== expectedKey) throw new Error('Room changed. Check the room shown above and send again.');
          if (typeof text !== 'string') throw new Error('Enter a text message.');
          const chat = await openChat(room);
          const source = sourceFromKey(room.context.key);
          const message = await chat.send(text, room.context.platform, source);
          if (!message) throw new Error('Enter a message of 1–500 characters.');
          return { key: room.key, pair: room.pair, messages: decorate(chat.getMessages(), room), message };
        });
      }
    };
  };
})();
