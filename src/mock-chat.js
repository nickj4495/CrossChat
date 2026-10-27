(() => {
  const app = globalThis.CrossChat = globalThis.CrossChat || {};
  const reserved = new Set(['directory', 'downloads', 'jobs', 'p', 'search', 'settings', 'subscriptions', 'inventory', 'wallet', 'videos', 'friends', 'messages', 'login', 'signup', 'turbo']);
  app.getPageContext = (href) => {
    const url = new URL(href);
    const parts = url.pathname.split('/').filter(Boolean);
    if (url.hostname === 'www.twitch.tv' && parts.length === 1 && /^[a-zA-Z0-9_]+$/.test(parts[0]) && !reserved.has(parts[0].toLowerCase())) {
      return { platform: 'twitch', key: `twitch:${parts[0].toLowerCase()}` };
    }
    if (url.hostname === 'www.youtube.com') {
      const id = url.pathname === '/watch' ? url.searchParams.get('v') : parts[0] === 'live' && parts.length === 2 ? parts[1] : null;
      if (id && /^[a-zA-Z0-9_-]+$/.test(id)) return { platform: 'youtube', key: `youtube:${id}` };
    }
    return null;
  };
  // Provider boundary: future network adapters can implement these methods.
  app.createMockChat = () => {
    const now = Date.now();
    const messages = [
      ['twitch', 'PixelPilot', 'That last round was so close!'],
      ['youtube', 'MayaPlays', 'Watching from YouTube — hey everyone 👋'],
      ['twitch', 'CozyByte', 'The stream looks great tonight.'],
      ['youtube', 'OrbitAlex', 'Anyone else trying this build?'],
      ['twitch', 'LunaLoops', 'Yep! The timing takes some practice.'],
      ['youtube', 'SamOnAir', 'Love having both chats in one place.']
    ].map(([platform, author, text], index) => ({ platform, author, text, time: now - (6 - index) * 45000, local: false }));
    return {
      getMessages: () => messages.map(message => ({ ...message })),
      send(text, platform) {
        const clean = text.trim();
        if (!clean || clean.length > 500 || !['twitch', 'youtube'].includes(platform)) return null;
        const message = { platform, author: 'You', text: clean, time: Date.now(), local: true };
        messages.push(message);
        if (messages.length > 200) messages.shift();
        return { ...message };
      }
    };
  };
})();
