importScripts('mock-chat.js', 'history.js', 'rooms.js', 'twitch-eventsub.js', 'twitch-auth.js', 'twitch-buffer.js', 'twitch-live.js');
const service = CrossChat.createRoomService(chrome.storage.local);
let twitchAuth = null;
let twitchLive = null;
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
const synchronize = (restart = false) => {
  initializeTwitch();
  return twitchLive.sync(restart);
};
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (request?.scope !== 'crosschat') return;
  const execute = async () => {
    if (sender.id !== chrome.runtime.id) throw new Error('Invalid extension sender.');
    const popup = sender.url === chrome.runtime.getURL('src/popup.html');
    if (popup) {
      if (request.action === 'getPair') return service.getPair();
      if (['setPair', 'setSources', 'clearPair'].includes(request.action)) {
        const result = request.action === 'setPair' ? await service.setPair(request.twitchUrl, request.youtubeUrl)
          : request.action === 'setSources' ? await service.setSources(request.urls) : await service.clearPair();
        synchronize().catch(() => {});
        return result;
      }
      if (request.action === 'getTwitchState') {
        await synchronize();
        return { auth: await twitchAuth.state(), live: twitchLive.getStatus() };
      }
      if (request.action === 'twitchSignIn') {
        initializeTwitch();
        const result = await twitchAuth.signIn(request.clientId);
        await synchronize(true);
        return result;
      }
      if (request.action === 'twitchSignOut') {
        initializeTwitch(); twitchLive.stop();
        const result = await twitchAuth.signOut();
        await synchronize();
        return result;
      }
      if (request.action === 'twitchReconnect') { await synchronize(true); return twitchLive.getStatus(); }
    }
    if (!sender.tab || sender.frameId !== 0 ||
        new URL(sender.url).origin !== new URL(request.href).origin) {
      throw new Error('This request must come from a supported stream page.');
    }
    if (request.action === 'snapshot') {
      const snapshot = await service.snapshot(request.href);
      // Start/recover the connection without making panel loading wait for APIs.
      synchronize().catch(() => {});
      const live = twitchLive.getMessages(snapshot.key);
      return { ...snapshot, messages: [...snapshot.messages, ...live].sort((a, b) => a.time - b.time).slice(-200),
        liveStatus: twitchLive.getStatus(snapshot.key) };
    }
    if (request.action === 'send') {
      const snapshot = await service.send(request.href, request.key, request.text);
      const live = twitchLive?.getMessages(snapshot.key) || [];
      return { ...snapshot, messages: [...snapshot.messages, ...live].sort((a, b) => a.time - b.time).slice(-200),
        liveStatus: twitchLive?.getStatus(snapshot.key) };
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
    synchronize().catch(() => {});
  }
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'crosschat-twitch-health') synchronize().catch(() => {});
});
// Minute checks detect token expiry; auth validates at worker startup and at least hourly.
chrome.alarms.create('crosschat-twitch-health', { periodInMinutes: 1 });
