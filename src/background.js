importScripts('mock-chat.js', 'view-model.js', 'history.js', 'rooms.js', 'twitch-emotes.js', 'twitch-eventsub.js', 'twitch-auth.js', 'twitch-buffer.js', 'twitch-live.js', 'youtube-auth.js', 'youtube-messages.js', 'youtube-live.js', 'stream-directory.js');
const service = CrossChat.createRoomService(chrome.storage.local);
const viewSettings = CrossChat.createViewSettings(chrome.storage.local);
let streamDirectory = null;
let twitchAuth = null;
let twitchLive = null;
let youtubeAuth = null;
let youtubeLive = null;
let publishTimer = null;
let revision = 0;
const publish = () => {
  if (publishTimer) return;
  publishTimer = setTimeout(() => {
    publishTimer = null;
    chrome.storage.local.set({ 'twitchLive:revision': `${Date.now()}:${++revision}` }).catch(() => {});
  }, 250);
};
const initializeTwitch = () => {
  if (!twitchAuth) {
    twitchAuth = CrossChat.createTwitchAuth({ local: chrome.storage.local,
      session: chrome.storage.session, identity: chrome.identity });
    twitchLive = CrossChat.createTwitchLive({ auth: twitchAuth, service,
      local: chrome.storage.local, publish });
  }
};
const initializeYouTube = () => {
  if (!youtubeAuth) {
    youtubeAuth = CrossChat.createYouTubeAuth({ identity: chrome.identity, session: chrome.storage.session,
      manifest: () => ({ ...(chrome.runtime.getManifest?.() || {}), extensionId: chrome.runtime.id }) });
    youtubeLive = CrossChat.createYouTubeLive({ auth: youtubeAuth, service, local: chrome.storage.local,
      session: chrome.storage.session, publish });
  }
};
const getDirectory = () => {
  initializeTwitch(); initializeYouTube();
  if (!streamDirectory) streamDirectory = CrossChat.createStreamDirectory({ service,
    getTwitch: () => twitchAuth, getYouTube: () => youtubeAuth, session: chrome.storage.session, publish });
  return streamDirectory;
};
const roomView = async force => {
  const [directory, viewPrefs] = await Promise.all([getDirectory().get(force), viewSettings.get()]);
  return { directory, viewPrefs };
};
const withLive = (snapshot, extras = {}) => {
  const native = [...(twitchLive?.getMessages(snapshot.key) || []), ...(youtubeLive?.getMessages(snapshot.key) || [])];
  return { ...snapshot, ...extras, messages: [...snapshot.messages, ...native].sort((a, b) => a.time - b.time).slice(-200),
    liveStatus: twitchLive?.getStatus(snapshot.key), youtubeStatus: youtubeLive?.getStatus(snapshot.key) };
};
const synchronize = (restart = false) => {
  initializeTwitch();
  initializeYouTube();
  return Promise.all([twitchLive.sync(restart), youtubeLive.sync()]);
};
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (request?.scope !== 'crosschat') return;
  const execute = async () => {
    if (sender.id !== chrome.runtime.id) throw new Error('Invalid extension sender.');
    const popup = sender.url === chrome.runtime.getURL('src/popup.html');
    if (popup) {
      if (request.action === 'getPair') return service.getPair();
      if (request.action === 'getRoomView') return roomView(Boolean(request.force));
      if (request.action === 'setSourceSettings') return service.setSourceSettings(request.key, request.settings);
      if (request.action === 'setViewPrefs') return viewSettings.update(request.patch);
      if (['setPair', 'setSources', 'clearPair'].includes(request.action)) {
        const result = request.action === 'setPair' ? await service.setPair(request.twitchUrl, request.youtubeUrl)
          : request.action === 'setSources' ? await service.setSources(request.urls) : await service.clearPair();
        synchronize().catch(() => {});
        return result;
      }
      if (request.action === 'getTwitchState') {
        initializeTwitch(); await twitchLive.sync();
        return { auth: await twitchAuth.state(), live: twitchLive.getStatus() };
      }
      if (request.action === 'twitchSignIn') {
        initializeTwitch();
        const result = await twitchAuth.signIn(request.clientId);
        await twitchLive.sync(true);
        return result;
      }
      if (request.action === 'twitchSignOut') {
        initializeTwitch(); twitchLive.stop();
        const result = await twitchAuth.signOut();
        await twitchLive.sync();
        return result;
      }
      if (request.action === 'getYouTubeState') {
        initializeYouTube(); await youtubeLive.sync();
        return { auth: await youtubeAuth.state(), live: youtubeLive.getStatus() };
      }
      if (request.action === 'youtubeSignIn') {
        initializeYouTube(); return youtubeAuth.signIn();
      }
      if (request.action === 'youtubeSignOut') {
        initializeYouTube(); await youtubeLive.pause('Signed out of YouTube.');
        return youtubeAuth.signOut();
      }
      if (request.action === 'youtubeStart') { initializeYouTube(); return youtubeLive.start(); }
      if (request.action === 'youtubeStop') { initializeYouTube(); await youtubeLive.pause(); return { stopped: true }; }
      if (request.action === 'twitchReconnect') { initializeTwitch(); await twitchLive.sync(true); return twitchLive.getStatus(); }
    }
    if (!sender.tab || sender.frameId !== 0 ||
        new URL(sender.url).origin !== new URL(request.href).origin) {
      throw new Error('This request must come from a supported stream page.');
    }
    if (request.action === 'setViewPrefs') return viewSettings.update(request.patch);
    if (request.action === 'setSourceSettings') return service.setSourceSettings(request.key, request.settings);
    if (request.action === 'snapshot') {
      const snapshot = await service.snapshot(request.href);
      // Start/recover the connection without making panel loading wait for APIs.
      synchronize().catch(() => {});
      return withLive(snapshot, await roomView(false));
    }
    if (request.action === 'send') {
      const snapshot = await service.send(request.href, request.key, request.text);
      return withLive(snapshot, await roomView(false));
    }
    throw new Error('Unknown CrossChat action.');
  };
  execute().then(data => respond({ ok: true, data }), error => {
    // Do not log payloads, redirects, tokens, or provider response bodies.
    respond({ ok: false, error: error.message || 'CrossChat could not complete this request.' });
  });
  return true;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes['roomPair:v1'] || changes.enabled)) {
    twitchLive?.stop();
    youtubeLive?.stop();
    synchronize().catch(() => {});
  }
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'crosschat-twitch-health') synchronize().catch(() => {});
});
// Minute checks detect token expiry; auth validates at worker startup and at least hourly.
chrome.alarms.create('crosschat-twitch-health', { periodInMinutes: 1 });
