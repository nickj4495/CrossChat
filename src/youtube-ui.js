(async () => {
  const connect = document.querySelector('#youtube-connect');
  const disconnect = document.querySelector('#youtube-disconnect');
  const start = document.querySelector('#youtube-start');
  const stop = document.querySelector('#youtube-stop');
  const extensionId = document.querySelector('#google-extension-id');
  const stateText = document.querySelector('#youtube-state');
  const feedback = document.querySelector('#youtube-feedback');
  const transport = document.querySelector('#youtube-transport');
  const backendSettings = document.querySelector('#youtube-backend-settings');
  const backendKey = document.querySelector('#youtube-backend-key');
  const keyState = document.querySelector('#youtube-backend-key-state');
  const saveReader = document.querySelector('#youtube-reader-save');
  const readerHint = document.querySelector('#youtube-reader-hint');
  let dirty = false;
  const showReader = () => {
    backendSettings.hidden = transport.value !== 'local';
    readerHint.textContent = transport.value === 'local'
      ? 'Local streaming pushes updates without the 15-second polling wait. No 30-minute test cap. Google quota still applies; fallback to polling is manual.'
      : 'Direct polling checks about every 15 seconds or slower. Stops after 30 minutes or 300 chat requests. Both readers use Google project quota.';
  };
  let loading = false; let busy = false;
  const request = async (action, values = {}) => {
    const response = await chrome.runtime.sendMessage({ scope: 'crosschat', action, ...values });
    if (!response?.ok) throw new Error(response?.error || 'Could not reach CrossChat.');
    return response.data;
  };
  const refresh = async () => {
    if (loading) return; loading = true;
    try {
      const state = await request('getYouTubeState');
      if (!dirty) transport.value = state.transport?.mode || 'polling';
      showReader();
      keyState.textContent = state.transport?.keyConfigured ? 'Connection key saved for this Chrome session. Leave blank to keep it.' : 'No key saved. Paste the key, then save settings.';
      saveReader.disabled = busy; transport.disabled = busy; backendKey.disabled = busy;
      extensionId.value = state.auth.extensionId;
      connect.disabled = busy || state.auth.signingIn || !state.auth.configured;
      disconnect.disabled = busy || !state.auth.connected;
      start.disabled = busy || dirty || !state.auth.connected || state.transport?.mode === 'local' && !state.transport.keyConfigured;
      stop.disabled = busy || !['connecting', 'polling', 'streaming', 'reconnecting', 'ended', 'error'].includes(state.live.state);
      stateText.textContent = [!state.auth.configured ? 'Google setup required: configure oauth2.client_id in manifest.json.' :
        state.auth.signingIn ? 'Finish Google sign-in in its window.' : state.auth.connected ? 'Google connected · YouTube read-only' : 'Not signed in to Google for YouTube.',
        state.live.message, ...(state.live.sources || []).filter(source => source.state === 'error').map(source => `${source.label}: ${source.message}`)].join('\n');
    } catch (error) { stateText.textContent = error.message; }
    finally { loading = false; }
  };
  const perform = async action => {
    busy = true; connect.disabled = disconnect.disabled = start.disabled = stop.disabled = true;
    feedback.textContent = action === 'youtubeSignIn' ? 'Opening Google consent… Reopen this popup afterward if it closes.' : 'Working…';
    try {
      await request(action);
      feedback.textContent = action === 'youtubeSignIn' ? 'Connected. Click Start reading to use YouTube quota.' :
        action === 'youtubeSignOut' ? 'Disconnected locally. Google account permissions can be removed in Google Account settings.' :
        action === 'youtubeStart' ? 'YouTube reading started. Watch source status for results.' : 'YouTube reading stopped.';
    } catch (error) { feedback.textContent = error.message; }
    finally { busy = false; await refresh(); }
  };
  extensionId.addEventListener('click', () => extensionId.select());
  connect.addEventListener('click', () => perform('youtubeSignIn'));
  disconnect.addEventListener('click', () => perform('youtubeSignOut'));
  start.addEventListener('click', () => perform('youtubeStart'));
  stop.addEventListener('click', () => perform('youtubeStop'));
  transport.addEventListener('change', () => { dirty = true; start.disabled = true; showReader(); });
  backendKey.addEventListener('input', () => { dirty = true; start.disabled = true; });
  saveReader.addEventListener('click', async () => {
    busy = true; saveReader.disabled = start.disabled = true;
    try {
      const key = backendKey.value.trim();
      await request('youtubeConfigure', { mode: transport.value, ...(key ? { key } : {}) });
      backendKey.value = ''; dirty = false; feedback.textContent = 'Reader settings saved. Click Start reading when ready.';
    } catch (error) { feedback.textContent = error.message; }
    finally { busy = false; await refresh(); }
  });
  chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && changes['twitchLive:revision']) refresh(); });
  await refresh(); setInterval(refresh, 2000);
})();
