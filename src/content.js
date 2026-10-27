(() => {
  const app = globalThis.CrossChat;
  let enabled = true;
  let panel = null;
  let currentKey = null;
  let provider = null;
  function reconcile() {
    const context = app.getPageContext(location.href);
    if (context?.key !== currentKey) {
      panel?.destroy();
      panel = null;
      currentKey = context?.key ?? null;
      provider = context ? app.createMockChat() : null;
    }
    if (!enabled || !context) {
      panel?.destroy();
      panel = null;
      return;
    }
    // Leave site layouts and native chat untouched; only append our own element.
    if (!panel) panel = app.createPanel(context, provider);
    if (!panel.host.isConnected) document.body.append(panel.host);
    panel.host.hidden = Boolean(document.fullscreenElement);
    // The host's important display rule means fullscreen hiding must be explicit.
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
    // Both platforms use client-side navigation. A small URL check avoids patching
    // their history methods or observing every chat/video DOM change.
    const timer = setInterval(() => {
      if (!chrome.runtime.id) {
        clearInterval(timer);
        panel?.destroy();
        return;
      }
      reconcile();
    }, 1000);
    document.addEventListener('fullscreenchange', reconcile);
  }
  start();
})();
