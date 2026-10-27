(() => {
  const app = globalThis.CrossChat = globalThis.CrossChat || {};
  app.sourcePalette = ['#a78bfa', '#38bdf8', '#fb7185', '#34d399', '#fbbf24', '#f472b6', '#2dd4bf', '#fb923c', '#818cf8', '#a3e635'];
  app.normalizeGroups = input => {
    if (!Array.isArray(input) || input.length > 8) throw new Error('Use up to 8 groups for a stream.');
    const names = new Map();
    for (const value of input) {
      if (typeof value !== 'string') throw new Error('Group names must be text.');
      const name = value.trim().replace(/\s+/g, ' ').normalize('NFC');
      if (!name) continue;
      if (['__ungrouped__', '__all__'].includes(name.toLowerCase()) || name.length > 40 || /[,\x00-\x1f]/.test(name)) throw new Error('Group names must be 1–40 characters without commas.');
      if (!names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    }
    return [...names.values()];
  };
  app.normalizeView = (value = {}) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
    return ({
    width: Number.isFinite(value.width) ? Math.max(320, Math.min(720, Math.round(value.width))) : 380,
    height: Number.isFinite(value.height) ? Math.max(420, Math.min(1000, Math.round(value.height))) : 640,
    selectedGroups: Array.isArray(value.selectedGroups) ? [...new Set(value.selectedGroups.filter(name => typeof name === 'string' && name.length <= 40).map(name => name.trim().normalize('NFC').toLowerCase()).filter(Boolean))].slice(0, 21) : [],
    hiddenSources: Array.isArray(value.hiddenSources) ? [...new Set(value.hiddenSources.filter(key => typeof key === 'string' && key.length <= 300))].slice(0, 50) : []
  });
  };
  app.roomGroups = sources => {
    const groups = new Map();
    for (const source of sources) for (const name of source.groups || []) {
      if (!groups.has(name.toLowerCase())) groups.set(name.toLowerCase(), name);
    }
    return [...groups].map(([id, name]) => ({ id, name }));
  };
  app.sourceVisible = (key, sources, view) => {
    if (view.hiddenSources.includes(key)) return false;
    if (!view.selectedGroups.length) return true;
    const source = sources.find(item => item.key === key);
    const groups = (source?.groups || []).map(name => name.toLowerCase());
    return groups.length ? groups.some(name => view.selectedGroups.includes(name)) : view.selectedGroups.includes('__ungrouped__');
  };
  app.messageKey = (message, occurrence = 0) => `${message.id || JSON.stringify([message.sourceKey || message.platform, message.author, message.time, message.text, Boolean(message.local)])}:${occurrence}`;
  app.createViewSettings = storage => {
    let pending = Promise.resolve();
    const get = async () => app.normalizeView((await storage.get('viewPrefs:v1'))['viewPrefs:v1']);
    return { get, update(patch) {
      const operation = pending.then(async () => {
        if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Invalid display settings.');
        for (const field of Object.keys(patch)) if (!['width', 'height', 'selectedGroups', 'hiddenSources'].includes(field)) throw new Error('Unknown display setting.');
        for (const field of ['width', 'height']) if (field in patch && !Number.isFinite(patch[field])) throw new Error('Widget sizes must be numbers.');
        for (const field of ['selectedGroups', 'hiddenSources']) if (field in patch && !Array.isArray(patch[field])) throw new Error('Invalid chat filter.');
        const next = app.normalizeView({ ...await get(), ...patch });
        await storage.set({ 'viewPrefs:v1': next });
        return next;
      });
      pending = operation.catch(() => {});
      return operation;
    } };
  };
})();
