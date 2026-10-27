(() => {
  const data = makeCrossChatFixture(); const listeners = new Set();
  let captured;
  const original = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function(options) { const root = original.call(this, options); captured = root; return root; };
  const notify = () => listeners.forEach(listener => listener(null));
  const provider = {
    getMessages: () => data.messages,
    getRoom: () => ({ key: data.pair.key, pair: data.pair }),
    getDirectory: () => ({ sources: data.sources, refreshing: false }),
    getViewPrefs: () => data.viewPrefs,
    getLiveStatus: () => ({ state: 'live', message: 'Twitch preview connection active.', sources: [] }),
    getYouTubeStatus: () => ({ state: 'paused', message: 'YouTube preview connection paused.', sources: [] }),
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async updateView(patch) { data.viewPrefs = CrossChat.normalizeView({ ...data.viewPrefs, ...patch }); notify(); return data.viewPrefs; },
    async updateSource(key, settings) { Object.assign(data.sources.find(source => source.key === key), settings); notify(); },
    async send(text) { const message = { id: `preview-${data.serial()}`, platform: 'twitch', sourceKey: data.sources[0].key, author: 'You', text, time: Date.now(), local: true }; data.messages.push(message); notify(); return message; }
  };
  const panel = CrossChat.createPanel({ key: data.sources[0].key, platform: 'twitch' }, provider); document.documentElement.append(panel.host); panel.mounted();
  Element.prototype.attachShadow = original;
  window.preview = { ready: true, root: captured, data, provider, panel, notify,
    add(count = 1) {
      for (let i = 0; i < count; i++) data.messages.push({ ...data.messages[i % data.messages.length], id: `preview-${data.serial()}`, text: `New incoming message ${data.serial()}`, time: Date.now() });
      while (data.messages.length > 200) data.messages.shift(); notify();
    }
  };
})();
