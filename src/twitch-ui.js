(async () => {
  const client = document.querySelector('#twitch-client-id');
  const callback = document.querySelector('#twitch-callback');
  const login = document.querySelector('#twitch-sign-in');
  const logout = document.querySelector('#twitch-sign-out');
  const reconnect = document.querySelector('#twitch-reconnect');
  const stateText = document.querySelector('#twitch-state');
  const feedback = document.querySelector('#twitch-feedback');
  let busy = false;
  let loading = false;
  const request = async (action, extra = {}) => {
    const response = await chrome.runtime.sendMessage({ scope: 'crosschat', action, ...extra });
    if (!response?.ok) throw new Error(response?.error || 'Could not contact CrossChat. Reload the extension.');
    return response.data;
  };
  const refresh = async () => {
    if (loading) return;
    loading = true;
    try {
      const state = await request('getTwitchState');
      if (!client.value) {
        let draft = null;
        try { draft = localStorage.getItem('crosschat:twitchClientDraft'); } catch { /* Use saved configuration. */ }
        client.value = draft ?? state.auth.clientId;
      }
      callback.value = state.auth.redirectUri;
      client.disabled = busy || state.auth.signingIn;
      login.disabled = busy || state.auth.signingIn;
      logout.disabled = busy || !(state.auth.login || state.auth.signingIn);
      reconnect.disabled = busy || !state.auth.login;
      stateText.textContent = [state.auth.signingIn ? 'Finish sign-in in the Twitch window.' :
        state.auth.login ? `Signed in as ${state.auth.login} · read-only` : 'Not signed in to Twitch.',
        state.live.message, ...(state.live.sources || []).filter(source => source.state === 'error').map(source => `${source.label}: ${source.message}`)].join('\n');
    } catch (error) { stateText.textContent = error.message; }
    finally { loading = false; }
  };
  client.addEventListener('input', () => {
    try { localStorage.setItem('crosschat:twitchClientDraft', client.value); } catch { /* Client ID can be re-entered. */ }
  });
  callback.addEventListener('click', () => callback.select());
  const perform = async action => {
    busy = true;
    login.disabled = logout.disabled = reconnect.disabled = true;
    feedback.textContent = action === 'twitchSignIn' ? 'Opening Twitch sign-in… This popup may close; reopen it afterward.' : 'Working…';
    try {
      const result = await request(action, { clientId: client.value.trim() });
      feedback.textContent = action === 'twitchSignOut' && !result.revoked
        ? 'Signed out locally. Twitch revocation could not be confirmed; remove CrossChat in Twitch Settings → Connections if needed.'
        : action === 'twitchSignIn' ? 'Signed in. Watching for new Twitch chat messages.'
        : action === 'twitchSignOut' ? 'Signed out of Twitch.' : 'Reconnecting…';
    } catch (error) { feedback.textContent = error.message; }
    finally { busy = false; await refresh(); }
  };
  login.addEventListener('click', () => perform('twitchSignIn'));
  logout.addEventListener('click', () => perform('twitchSignOut'));
  reconnect.addEventListener('click', () => perform('twitchReconnect'));
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes['twitchLive:revision']) refresh();
  });
  await refresh();
  setInterval(refresh, 2000);
})();
