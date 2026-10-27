(() => {
  const data = makeCrossChatFixture(); const listeners = new Set();
  const emit = keys => queueMicrotask(() => listeners.forEach(listener => listener(Object.fromEntries(keys.map(key => [key, { newValue: true }])), 'local')));
  window.chrome = { storage: {
    local: { async get() { return { enabled: true }; }, async set() { emit(['enabled']); } },
    onChanged: { addListener(listener) { listeners.add(listener); }, removeListener(listener) { listeners.delete(listener); } }
  }, runtime: { async sendMessage(request) {
    let result;
    if (request.action === 'getPair') result = data.pair;
    else if (request.action === 'getRoomView') result = { directory: { sources: data.sources, refreshing: false }, viewPrefs: data.viewPrefs };
    else if (request.action === 'setViewPrefs') { data.viewPrefs = { ...data.viewPrefs, ...request.patch }; result = data.viewPrefs; emit(['viewPrefs:v1']); }
    else if (request.action === 'setSourceSettings') { Object.assign(data.sources.find(source => source.key === request.key), request.settings); result = data.pair; emit(['sourceSettings:v1']); }
    else if (request.action === 'getTwitchState') result = { auth: { clientId: '', redirectUri: 'https://preview.chromiumapp.org/twitch', login: null }, live: { state: 'signed-out', message: 'Offline preview — no sign-in.', sources: [] } };
    else if (request.action === 'getYouTubeState') result = { auth: { configured: true, connected: false, extensionId: 'offline-preview' }, live: { state: 'paused', message: 'Offline preview — no requests.', sources: [] } };
    else return { ok: false, error: 'Network actions are disabled in the offline preview.' };
    return { ok: true, data: result };
  } } };
  window.popupFixture = { data, emit };
})();
