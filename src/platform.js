(() => {
  // Firefox/Safari's browser namespace provides the Promise APIs used throughout.
  if (globalThis.browser?.runtime) globalThis.chrome = globalThis.browser;
  const app = globalThis.CrossChat = globalThis.CrossChat || {};
  const api = globalThis.chrome;
  app.extensionOrigin = api?.runtime?.getURL?.('').replace(/\/$/, '') || '';
  // Never fall back to durable storage for credentials on older Safari releases.
  const memory = {};
  app.session = api?.storage?.session || {
    async get(keys) {
      if (keys === null) return structuredClone(memory);
      if (typeof keys === 'string') return { [keys]: structuredClone(memory[keys]) };
      const entries = Array.isArray(keys) ? keys.map(key => [key, undefined]) : Object.entries(keys);
      return Object.fromEntries(entries.map(([key, fallback]) => [key, structuredClone(memory[key] ?? fallback)]));
    },
    async set(values) { Object.assign(memory, structuredClone(values)); },
    async remove(keys) { for (const key of Array.isArray(keys) ? keys : [keys]) delete memory[key]; },
    async clear() { for (const key of Object.keys(memory)) delete memory[key]; }
  };
})();
