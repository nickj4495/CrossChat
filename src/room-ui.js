(async () => {
  const app = globalThis.CrossChat;
  const list = document.querySelector('#saved-streams'); const note = document.querySelector('#room-feedback');
  const cards = new Map(); let sources = []; let view = app.normalizeView(); let loading = false;
  let drafts = {};
  try { drafts = JSON.parse(localStorage.getItem('crosschat:sourceDrafts:v1') || '{}') || {}; } catch { /* Ignore an unreadable form draft. */ }
  const saveDrafts = () => { try { localStorage.setItem('crosschat:sourceDrafts:v1', JSON.stringify(drafts)); } catch { note.textContent = 'Could not preserve stream edits when this popup closes.'; } };
  const request = async (action, extra = {}) => {
    const result = await chrome.runtime.sendMessage({ scope: 'crosschat', action, ...extra });
    if (!result?.ok) throw new Error(result?.error || 'Could not update your room.');
    return result.data;
  };
  const changeView = async patch => {
    view = app.normalizeView({ ...view, ...patch }); groups.update(sources, view);
    try { view = await request('setViewPrefs', { patch }); paintSize(); note.textContent = 'Chat view updated across your widgets.'; }
    catch (error) { note.textContent = error.message; }
  };
  const groups = app.createGroupControls(document.querySelector('#popup-groups'), patch => { changeView(patch); });
  const paintSize = () => {
    for (const dimension of ['width', 'height']) {
      const input = document.querySelector(`#widget-${dimension}`);
      if (document.activeElement !== input) input.value = view[dimension];
      document.querySelector(`#widget-${dimension}-value`).textContent = `${view[dimension]}px`;
    }
  };
  const render = directory => {
    sources = directory.sources || []; groups.update(sources, view); paintSize();
    document.querySelector('#stream-count').textContent = `${sources.length} streams · ${sources.filter(source => source.liveState === 'live').length} live`;
    document.querySelector('#streams-empty').hidden = sources.length !== 0;
    document.querySelector('#status-refresh').disabled = directory.refreshing;
    for (const [key, card] of cards) if (!sources.some(source => source.key === key)) { card.row.remove(); cards.delete(key); }
    sources.forEach((source, index) => {
      let card = cards.get(source.key);
      if (!card) {
        const row = document.createElement('article'); row.className = 'stream-card';
        const heading = document.createElement('div'); heading.className = 'stream-heading';
        const link = document.createElement('a'); const badge = document.createElement('span'); heading.append(link, badge);
        const title = document.createElement('p'); title.className = 'stream-title';
        const fields = document.createElement('div'); fields.className = 'stream-fields';
        const colorLabel = document.createElement('label'); colorLabel.className = 'color-label'; colorLabel.textContent = 'Color';
        const color = document.createElement('input'); color.type = 'color'; color.setAttribute('aria-label', `Chat color for ${source.label}`); colorLabel.append(color);
        const groupLabel = document.createElement('label'); groupLabel.className = 'group-label'; groupLabel.textContent = 'Groups';
        const input = document.createElement('input'); input.type = 'text'; input.maxLength = 400;
        input.placeholder = 'League of Legends, Proplay'; input.setAttribute('aria-label', `Groups for ${source.label}, separated by commas`); groupLabel.append(input);
        fields.append(colorLabel, groupLabel);
        const actions = document.createElement('div'); actions.className = 'stream-actions';
        const save = document.createElement('button'); save.type = 'button'; save.className = 'secondary small'; save.textContent = 'Save stream';
        const feedback = document.createElement('span'); feedback.setAttribute('role', 'status'); actions.append(save, feedback);
        const remember = () => { drafts[source.key] = { groups: input.value, color: color.value }; saveDrafts(); feedback.textContent = 'Unsaved draft'; };
        input.addEventListener('input', remember); color.addEventListener('input', remember);
        save.addEventListener('click', async () => {
          save.disabled = true;
          try {
            await request('setSourceSettings', { key: source.key, settings: { groups: input.value.split(',').map(name => name.trim()).filter(Boolean), color: color.value } });
            delete drafts[source.key]; saveDrafts(); feedback.textContent = 'Saved'; await refresh();
          } catch (error) { feedback.textContent = error.message; }
          finally { save.disabled = false; }
        });
        row.append(heading, title, fields, actions); card = { row, link, badge, title, input, color }; cards.set(source.key, card);
      }
      app.streamLink(card.link, source);
      card.badge.className = `live-state ${['live', 'offline', 'upcoming'].includes(source.liveState) ? source.liveState : 'unknown'}`;
      card.badge.textContent = app.statusText(source);
      card.badge.title = `${source.statusReason || 'Not checked.'}${source.checkedAt ? ` Checked ${new Date(source.checkedAt).toLocaleTimeString()}.` : ''}`;
      card.badge.setAttribute('aria-label', `${app.statusText(source)}. ${card.badge.title}`);
      card.title.textContent = `${source.platform === 'twitch' ? 'Twitch' : 'YouTube'} · ${source.streamTitle || source.url}`;
      card.row.style.borderInlineStartColor = source.color;
      if (document.activeElement !== card.input) card.input.value = drafts[source.key]?.groups ?? (source.groups || []).join(', ');
      if (document.activeElement !== card.color) card.color.value = drafts[source.key]?.color ?? source.color;
      if (list.children[index] !== card.row) list.insertBefore(card.row, list.children[index] || null);
    });
  };
  async function refresh(force = false) {
    if (loading) return; loading = true;
    try { const result = await request('getRoomView', { force }); view = app.normalizeView(result.viewPrefs); render(result.directory); }
    catch (error) { note.textContent = error.message; }
    finally { loading = false; }
  }
  document.querySelector('#status-refresh').addEventListener('click', () => refresh(true));
  for (const dimension of ['width', 'height']) {
    const input = document.querySelector(`#widget-${dimension}`);
    input.addEventListener('input', () => { document.querySelector(`#widget-${dimension}-value`).textContent = `${input.value}px`; });
    input.addEventListener('change', () => { changeView({ [dimension]: Number(input.value) }); });
  }
  const activateTab = name => {
    for (const tab of ['room', 'connections']) {
      const button = document.querySelector(`#tab-${tab}`); const selected = tab === name;
      button.setAttribute('aria-selected', String(selected)); button.tabIndex = selected ? 0 : -1;
      document.querySelector(`#pane-${tab}`).hidden = !selected;
    }
  };
  for (const tab of ['room', 'connections']) {
    const button = document.querySelector(`#tab-${tab}`);
    button.addEventListener('click', () => activateTab(tab));
    button.addEventListener('keydown', event => {
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); const other = tab === 'room' ? 'connections' : 'room'; activateTab(other); document.querySelector(`#tab-${other}`).focus(); }
    });
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && ['roomPair:v1', 'sourceSettings:v1', 'viewPrefs:v1', 'twitchLive:revision'].some(key => changes[key])) refresh();
  });
  await refresh(); setInterval(refresh, 30000);
})();
