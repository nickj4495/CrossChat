(() => {
  const app = globalThis.CrossChat;
  let enabled = true;
  let panel = null;
  let currentKey = null;
  let provider = null;
  let generation = 0;
  let loading = false;
  let loadError = null;
  function reconcile() {
    const context = app.getPageContext(location.href);
    const key = context?.key ?? null;
    if (key !== currentKey) {
      generation++;
      panel?.destroy();
      panel = null;
      currentKey = key;
      provider?.destroy?.();
      provider = null;
      loading = false;
      loadError = null;
    }
    if (!enabled || !context) {
      panel?.destroy();
      panel = null;
      return;
    }
    if (!provider && !loading && !loadError) {
      loading = true;
      const requestGeneration = generation;
      app.createRoomChat(context).then(chat => {
        if (requestGeneration !== generation) { chat.destroy?.(); return; }
        provider = chat;
        loading = false;
        reconcile();
      }).catch(error => {
        if (requestGeneration !== generation) return;
        console.warn('CrossChat could not load history.', error);
        loading = false;
        loadError = 'Could not load saved chat. Refresh to retry. Existing history has not been replaced.';
        reconcile();
      });
    }
    // Mount a loading/error panel immediately; remount when history is ready.
    const state = provider ? 'ready' : loadError ? 'error' : 'loading';
    if (panel && panel.state !== state) {
      panel.destroy();
      panel = null;
    }
    if (!panel) {
      panel = app.createPanel(context, provider, loadError);
      panel.state = state;
    }
    if (!panel.host.isConnected) document.body.append(panel.host);
    panel.host.style.setProperty('display', document.fullscreenElement ? 'none' : 'block', 'important');
  }
  async function start() {
    try {
      const settings = await chrome.storage.local.get({ enabled: true });
      enabled = settings.enabled !== false;
    } catch (error) {
      console.warn('CrossChat could not read settings.', error);
    }
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.enabled) {
        enabled = changes.enabled.newValue !== false;
        reconcile();
      }
    });
    reconcile();
    const timer = setInterval(() => {
      if (!chrome.runtime.id) {
        clearInterval(timer);
        generation++;
        panel?.destroy();
        document.removeEventListener('fullscreenchange', reconcile);
        return;
      }
      reconcile();
    }, 1000);
    document.addEventListener('fullscreenchange', reconcile);
  }
  start();
})();
