(() => {
  const app = globalThis.CrossChat;
  app.createRoomChat = async context => {
    const href = location.href;
    const request = async (action, extra = {}) => {
      const response = await chrome.runtime.sendMessage({ scope: 'crosschat', action, href, ...extra });
      if (!response?.ok) throw new Error(response?.error || 'CrossChat background is unavailable. Reload the extension and refresh this page.');
      return response.data;
    };
    let snapshot;
    let stopped = false;
    let sequence = 0;
    const listeners = new Set();
    const notify = error => listeners.forEach(listener => listener(error));
    const refresh = async () => {
      const version = ++sequence;
      try {
        const next = await request('snapshot');
        if (!stopped && version === sequence) {
          snapshot = next;
          notify(null);
        }
      } catch (error) {
        if (!stopped && version === sequence) notify(error);
      }
    };
    const changed = (changes, area) => {
      if (globalThis.document?.visibilityState === 'hidden') return;
      if (area === 'local' && (changes['roomPair:v1'] || changes['sourceSettings:v1'] || changes['viewPrefs:v1'] || changes['twitchLive:revision'] ||
          changes[`history:v1:${snapshot?.key}`])) refresh();
    };
    chrome.storage.onChanged.addListener(changed);
    try {
      snapshot = await request('snapshot');
      // Refresh once more to close the gap between initial read and subscription.
      await refresh();
    } catch (error) {
      chrome.storage.onChanged.removeListener(changed);
      throw error;
    }
    const becameVisible = () => { if (globalThis.document?.visibilityState !== 'hidden') refresh(); };
    globalThis.document?.addEventListener?.('visibilitychange', becameVisible);
    const directoryTimer = globalThis.setInterval?.(async () => {
      if (stopped || globalThis.document?.visibilityState === 'hidden') return;
      try {
        const settings = await chrome.storage.local.get({ enabled: true });
        if (settings.enabled !== false) await refresh();
      } catch { /* Retry on a later refresh. */ }
    }, 30000);
    return {
      getMessages: () => snapshot.messages.map(message => ({ ...message })),
      getRoom: () => ({ key: snapshot.key, pair: snapshot.pair }),
      getLiveStatus: () => snapshot.liveStatus,
      getYouTubeStatus: () => snapshot.youtubeStatus,
      getDirectory: () => snapshot.directory || { sources: snapshot.pair?.sources || [], refreshing: false },
      getViewPrefs: () => app.normalizeView(snapshot.viewPrefs),
      async updateView(patch) { const result = await request('setViewPrefs', { patch }); await refresh(); return result; },
      async updateSource(key, settings) { await request('setSourceSettings', { key, settings }); await refresh(); },
      subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
      async send(text) {
        const key = snapshot.key;
        const version = ++sequence;
        try {
          const next = await request('send', { key, text });
          if (!stopped && version === sequence) {
            snapshot = next;
            notify(null);
          }
          await refresh();
          return next.message;
        } catch (error) {
          await refresh();
          throw error;
        }
      },
      destroy() {
        stopped = true;
        globalThis.clearInterval?.(directoryTimer);
        globalThis.document?.removeEventListener?.('visibilitychange', becameVisible);
        sequence++;
        listeners.clear();
        chrome.storage.onChanged.removeListener(changed);
      }
    };
  };
})();
