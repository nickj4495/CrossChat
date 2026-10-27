(() => {
  const app = globalThis.CrossChat;
  app.createStreamDirectory = ({ service, getTwitch, getYouTube, publish, session, now = Date.now }) => {
    let signature = null; let generation = 0; let lastAttempt = -Infinity;
    let pending = null; let cache = new Map();
    const cacheKey = 'streamDirectory:v1';
    let restoring = null;
    const restore = () => {
      if (!restoring) restoring = (async () => {
        if (!session) return;
        try {
          const saved = (await session.get(cacheKey))[cacheKey];
          if (saved && typeof saved.signature === 'string' && Number.isFinite(saved.lastAttempt) && Array.isArray(saved.entries)) {
            signature = saved.signature; lastAttempt = saved.lastAttempt; cache = new Map(saved.entries);
          }
        } catch { /* An unavailable cache must not stop the UI. */ }
      })();
      return restoring;
    };
    const persist = async () => {
      try { await session?.set({ [cacheKey]: { signature, lastAttempt, entries: [...cache] } }); } catch { /* Best-effort metadata cache only. */ }
    };
    const unknown = reason => ({ liveState: 'unknown', statusReason: reason, checkedAt: null });
    const refreshPlatform = async (sources, platform, auth, authorized) => {
      const result = new Map();
      const list = sources.filter(source => source.platform === platform);
      if (!list.length) return result;
      if (!authorized) {
        list.forEach(source => result.set(source.key, unknown(`Sign in to ${platform === 'twitch' ? 'Twitch' : 'Google'} to check stream status.`)));
        return result;
      }
      try {
        if (platform === 'twitch') {
          const usersQuery = new URLSearchParams(); list.forEach(source => usersQuery.append('login', source.key.slice(7)));
          const users = (await auth.api(`/users?${usersQuery}`)).data;
          if (!Array.isArray(users)) throw new Error('Twitch returned no channel information.');
          const streamsQuery = new URLSearchParams(); list.forEach(source => streamsQuery.append('user_login', source.key.slice(7)));
          const streams = (await auth.api(`/streams?${streamsQuery}`)).data;
          if (!Array.isArray(streams)) throw new Error('Twitch returned no stream information.');
          list.forEach(source => {
            const login = source.key.slice(7);
            const user = users.find(item => item.login === login);
            const live = streams.find(item => item.user_login === login && item.type === 'live');
            result.set(source.key, !user ? unknown('Channel could not be found.') : {
              liveState: live ? 'live' : 'offline', displayName: user.display_name || login,
              streamTitle: live?.title || '', statusReason: live ? 'Broadcast is live.' : 'No live broadcast found.', checkedAt: now()
            });
          });
        } else {
          const data = await auth.api('videos', { part: 'snippet,liveStreamingDetails', id: list.map(source => source.key.slice(8)).join(',') });
          if (!Array.isArray(data.items)) throw new Error('YouTube returned no video information.');
          list.forEach(source => {
            const video = data.items.find(item => item.id === source.key.slice(8));
            const flag = video?.snippet?.liveBroadcastContent;
            if (!['live', 'upcoming', 'none'].includes(flag)) { result.set(source.key, unknown('Video is unavailable or its live status cannot be verified.')); return; }
            result.set(source.key, { liveState: flag === 'none' ? 'offline' : flag,
              displayName: video.snippet.channelTitle || source.label, streamTitle: video.snippet.title || '',
              statusReason: flag === 'live' ? 'Broadcast is live.' : flag === 'upcoming' ? 'Broadcast is scheduled.' : 'Video is not currently live.', checkedAt: now() });
          });
        }
      } catch (error) { list.forEach(source => result.set(source.key, unknown(error.message || 'Status lookup failed.'))); }
      return result;
    };
    return {
      async get(force = false) {
        await restore();
        const pair = await service.getPair();
        const twitch = getTwitch(); const youtube = getYouTube();
        const [twitchState, googleState] = await Promise.all([twitch.state?.() || {}, youtube.state?.() || {}]);
        const next = JSON.stringify([pair?.key, twitchState.login || null, Boolean(googleState.connected)]);
        if (signature !== next) { signature = next; generation++; cache = new Map(); pending = null; lastAttempt = -Infinity; }
        const sources = pair?.sources || [];
        if (sources.length && !pending && now() - lastAttempt >= (force ? 10000 : 60000)) {
          const expected = generation; lastAttempt = now();
          pending = persist().then(() => Promise.all([
            refreshPlatform(sources, 'twitch', twitch, Boolean(twitchState.login)),
            refreshPlatform(sources, 'youtube', youtube, Boolean(googleState.connected))
          ])).then(async results => {
            if (generation !== expected) return;
            cache = new Map(results.flatMap(result => [...result]));
            await persist();
            pending = null;
            Promise.resolve(publish()).catch(() => {});
          }).catch(() => { if (generation === expected) pending = null; });
        }
        return { roomKey: pair?.key || null, refreshing: Boolean(pending),
          sources: sources.map(source => {
            const item = cache.get(source.key);
            const status = item && (!item.checkedAt || now() - item.checkedAt < 120000)
              ? item : unknown(pending ? 'Checking broadcast status…' : 'Status has not been checked recently.');
            return { ...source, ...status };
          }) };
      }
    };
  };
})();
