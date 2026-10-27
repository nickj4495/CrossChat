(() => {
  const app = globalThis.CrossChat;
  app.statusText = source => ({ live: 'Live', offline: 'Offline', upcoming: 'Upcoming', unknown: 'Unknown' })[source.liveState] || 'Unknown';
  app.createGroupControls = (container, onChange) => {
    const doc = container.ownerDocument || document;
    let view = app.normalizeView();
    const controls = new Map();
    return { update(sources, preferences) {
      view = app.normalizeView(preferences);
      const groups = app.roomGroups(sources);
      if (sources.some(source => !(source.groups || []).length)) groups.push({ id: '__ungrouped__', name: 'Ungrouped' });
      for (const id of view.selectedGroups) if (!groups.some(group => group.id === id)) groups.push({ id, name: id === '__ungrouped__' ? 'Ungrouped (empty)' : `${id} (not in room)` });
      const choices = [{ id: '__all__', name: 'All chats' }, ...groups];
      for (const [key, button] of controls) if (!choices.some(choice => choice.id === key)) { button.remove(); controls.delete(key); }
      choices.forEach((choice, index) => {
        let button = controls.get(choice.id);
        if (!button) {
          button = doc.createElement('button'); button.type = 'button'; button.className = 'group-chip';
          button.addEventListener('click', () => {
            const selected = new Set(view.selectedGroups);
            if (choice.id === '__all__') onChange({ selectedGroups: [], hiddenSources: [] });
            else {
              if (selected.has(choice.id)) selected.delete(choice.id); else selected.add(choice.id);
              onChange({ selectedGroups: [...selected] });
            }
          });
          controls.set(choice.id, button);
        }
        button.textContent = choice.name;
        button.setAttribute('aria-pressed', String(choice.id === '__all__' ? !view.selectedGroups.length && !view.hiddenSources.length : view.selectedGroups.includes(choice.id)));
        if (container.children[index] !== button) container.insertBefore(button, container.children[index] || null);
      });
    } };
  };
  app.streamLink = (link, source) => {
    // Room URLs are canonicalized by the worker. Revalidate before placing a URL
    // in either UI so malformed storage cannot introduce another URL scheme.
    let url;
    try { url = new URL(source.url); } catch { url = null; }
    const allowed = url?.protocol === 'https:' && ['www.twitch.tv', 'www.youtube.com'].includes(url.hostname) && !url.username && !url.password;
    if (allowed) { link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; }
    else link.removeAttribute('href');
    link.textContent = source.displayName || source.label;
    link.setAttribute('aria-label', `Open ${source.displayName || source.label} on ${source.platform === 'twitch' ? 'Twitch' : 'YouTube'} in a new tab`);
    if (!allowed) link.setAttribute('aria-label', (source.label || 'Demo') + ' sample messages, no stream link');
    link.title = source.streamTitle || source.url || 'Sample messages';
  };
})();
