(() => {
  const app = globalThis.CrossChat;
  let enabled = true;
  let panel = null;
  let currentKey = null;
  let provider = null;
  let generation = 0;
  let loading = false;
  let loadError = null;
  let lastRenderError = null;
  function safelyReconcile() {
    try {
      reconcile();
      lastRenderError = null;
    } catch (error) {
      // A transient site DOM/render failure must not stop future recovery checks.
      if (error.message !== lastRenderError) console.warn('CrossChat panel will retry rendering.', error);
      lastRenderError = error.message;
    }
  }
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
        safelyReconcile();
      }).catch(error => {
        if (requestGeneration !== generation) return;
        console.warn('CrossChat could not load history.', error);
        loading = false;
        loadError = 'Could not load saved chat. Refresh to retry. Existing history has not been replaced.';
        safelyReconcile();
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
    // Mount outside the site's replaceable body so page transitions cannot leave
    // a connected panel trapped inside an old/hidden application container.
    const container = document.documentElement || document.body;
    if (panel.host.parentElement !== container) { container.append(panel.host); panel.mounted?.(); }
    const visible = !document.fullscreenElement;
    panel.host.style.setProperty('display', visible ? 'block' : 'none', 'important');
    if (visible && !panel.visible) panel.mounted?.();
    panel.visible = visible;
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
        safelyReconcile();
      }
    });
    const cleanup = () => {
      clearInterval(timer);
      generation++;
      panel?.destroy();
      provider?.destroy?.();
      observer?.disconnect();
      document.removeEventListener('fullscreenchange', safelyReconcile);
      document.removeEventListener('visibilitychange', safelyReconcile);
      window.removeEventListener('pageshow', safelyReconcile);
    };
    // Install recovery before the first render: even a failed initial mount is retried.
    const timer = setInterval(() => {
      if (!chrome.runtime.id) {
        cleanup();
        return;
      }
      safelyReconcile();
    }, 1000);
    const observer = new MutationObserver(() => {
      if (panel && !panel.host.isConnected) safelyReconcile();
    });
    observer.observe(document.documentElement, { childList: true });
    document.addEventListener('fullscreenchange', safelyReconcile);
    document.addEventListener('visibilitychange', safelyReconcile);
    window.addEventListener('pageshow', safelyReconcile);
    safelyReconcile();
  }
  start();
})();
