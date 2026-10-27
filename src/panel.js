(() => {
  const app = globalThis.CrossChat;
  app.createPanel = (context, provider, loadError = null) => {
    const host = document.createElement('crosschat-panel');
    host.style.cssText = 'all:initial!important;position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483647!important;display:block!important;max-width:calc(100vw - 32px)!important;';
    const root = host.attachShadow({ mode: 'closed' });
    const keyboardEvents = ['keydown', 'keypress', 'keyup'];
    const isolateKeyboard = event => { if (event.composedPath().includes(host)) event.stopImmediatePropagation(); };
    keyboardEvents.forEach(type => window.addEventListener(type, isolateKeyboard, true));
    // Only static markup is parsed. All message/source/user text uses DOM nodes.
    root.innerHTML = `
      <style>
        :host{color-scheme:dark}*{box-sizing:border-box}button,input{font:inherit}button,summary{cursor:pointer}button:focus-visible,input:focus-visible,a:focus-visible,summary:focus-visible{outline:2px solid #c2afff;outline-offset:3px}[hidden]{display:none!important}
        .panel{width:380px;height:640px;max-width:calc(100vw - 32px);max-height:calc(100dvh - 32px);display:flex;flex-direction:column;font:13px/1.5 system-ui,sans-serif;color:#eeeef5;background:#121219;border:1px solid #3b344a;border-radius:16px;box-shadow:0 16px 56px #0009;overflow:hidden}.panel.is-collapsed{height:auto!important}
        header{display:flex;align-items:center;gap:10px;padding:13px 14px;background:#1b1925;border-bottom:1px solid #302b3e;flex:none}.logo{display:grid;place-items:center;width:34px;height:34px;background:#b59aff;color:#211637;border-radius:10px;font-weight:900}.title{flex:1}h2{font-size:16px;margin:0}.subtitle{font-size:10px;color:#b4a7ce;letter-spacing:.8px}.collapse{background:#2b2638;border:1px solid #514465;border-radius:8px;color:#eee;width:30px;height:30px}
        .body{display:flex;flex:1;flex-direction:column;min-height:0;overflow:auto}.notice{font-size:11px;color:#a9a0ba;padding:9px 14px 0;margin:0}.group-controls{display:flex;gap:6px;overflow-x:auto;padding:9px 14px;flex:none;scrollbar-width:thin}.group-chip{white-space:nowrap;border:1px solid #3b344b;background:#211d2c;color:#c3bad4;border-radius:20px;padding:5px 10px;font-size:11px}.group-chip[aria-pressed=true]{background:#bda4ff;border-color:#bda4ff;color:#221736;font-weight:700}
        .tools{display:flex;gap:12px;padding:0 14px 8px;flex:none;align-items:flex-start}.tools details{min-width:0;font-size:11px;color:#bdb3ce}.tools summary{list-style-position:inside}.sources-details{flex:1}.source-options{max-height:170px;overflow:auto;padding-top:8px;scrollbar-width:thin}.source-option{display:flex;align-items:center;gap:7px;padding:7px 0;border-bottom:1px solid #ffffff0a}.source-option.is-excluded{opacity:.6}.source-option input[type=checkbox]{width:14px;height:14px;flex:none;accent-color:#b59aff}.source-info{min-width:0;flex:1}.source-info a{display:block;color:#ece7f6;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.source-info a:hover{text-decoration:underline}.source-groups{font-size:10px;color:#968ba9;overflow-wrap:anywhere}.color-control{width:23px;height:23px;padding:0;border:1px solid #514365;background:transparent;border-radius:6px;cursor:pointer;flex:none}.live-state{font-size:9px;font-weight:700;padding:2px 5px;border-radius:5px;background:#292630;color:#b8afc5;flex:none}.live-state.live{color:#79ebaf;background:#163228}.live-state.offline{color:#c6c1d0}.live-state.upcoming{color:#f4d07e;background:#342e1b}
        .size-options{width:150px;padding-top:8px}.size-options label{display:block;margin:5px 0;color:#bdb3ce}.size-options input{width:100%;accent-color:#b59aff}.connection-details{padding:0 14px 8px;color:#8f849f;font-size:10px;flex:none}.connection{max-height:80px;overflow:auto;white-space:pre-line;margin:6px 0}.messages{position:relative;flex:1;min-height:80px;overflow:auto;overflow-anchor:none;overscroll-behavior:contain;padding:4px 12px 8px;scrollbar-width:thin}.message{padding:9px 10px;margin:5px 0;border-left:3px solid #827392;background:#1b1822;border-radius:0 8px 8px 0;overflow-wrap:anywhere}.meta{display:flex;gap:7px;align-items:center;font-size:12px}.badge{font-size:8px;font-weight:800;letter-spacing:.5px;padding:2px 4px;border-radius:4px}.twitch{background:#382452;color:#d5b7ff}.youtube{background:#48232b;color:#ffa8b1}time{margin-left:auto;color:#8e849c;font-size:10px}.source{display:inline-block;max-width:100%;font-size:10px;color:#dbd4e6;margin-top:5px;border-radius:5px;padding:1px 5px;overflow-wrap:anywhere}.text{margin:5px 0 0;color:#e3ddea;white-space:pre-wrap}.local{display:block;font-size:9px;color:#8e819f;margin-top:4px}.emote{display:inline-block;height:28px;width:auto;max-width:112px;object-fit:contain;vertical-align:middle}.empty{color:#9e91ad;margin:12px 14px;font-size:12px}.jump{flex:none;margin:0 12px 8px;padding:7px;border:1px solid #695187;border-radius:8px;background:#332341;color:#e4d2ff;font-size:11px}
        form{flex:none;border-top:1px solid #30283c;padding:10px 14px 12px;background:#18151f}form label{display:block;font-size:10px;color:#aa9cba;margin-bottom:5px}.compose{display:flex;gap:7px}#message{min-width:0;flex:1;background:#24202e;color:#fff;border:1px solid #494057;border-radius:8px;padding:9px;font-size:12px}button[type=submit]{border:0;border-radius:8px;background:#bda4ff;color:#211435;font-weight:700;padding:0 11px;font-size:11px}button:disabled{opacity:.45;cursor:default}.foot{display:block;font-size:10px;color:#9688a6;margin-top:6px}
      </style>
      <section class="panel" aria-label="CrossChat combined chat">
        <header><span class="logo" aria-hidden="true">C↔</span><div class="title"><h2>CrossChat</h2><span class="subtitle">YOUR STREAMS. ONE CONVERSATION.</span></div><button class="collapse" aria-label="Collapse CrossChat" aria-expanded="true">−</button></header>
        <div class="body"><p class="notice">Loading your room…</p><div class="group-controls" role="group" aria-label="Show chats by group"></div>
          <div class="tools"><details class="sources-details"><summary class="source-summary">Streams</summary><div class="source-options"></div></details><details class="size-details"><summary>Widget size</summary><div class="size-options"><label>Width <output class="width-value"></output><input class="width-range" type="range" min="320" max="720" step="20" aria-label="Widget width"></label><label>Height <output class="height-value"></output><input class="height-range" type="range" min="420" max="1000" step="20" aria-label="Widget height"></label></div></details></div>
          <details class="connection-details"><summary>Chat connections</summary><p class="connection" role="status">Checking connections…</p></details>
          <p class="empty" hidden>No messages match these filters. Choose All chats to show everything.</p><div class="messages" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions" tabindex="0"></div><button class="jump" type="button" hidden>Jump to newest ↓</button>
          <form><label for="message">Local demo message <span class="destination"></span></label><div class="compose"><input id="message" maxlength="500" autocomplete="off" placeholder="Say something to your local room…"><button type="submit" disabled>Send demo</button></div><span class="foot" role="status">Nothing is posted to native Twitch or YouTube chat.</span></form>
        </div>
      </section>`;
    const panel = root.querySelector('.panel'); const log = root.querySelector('.messages');
    const input = root.querySelector('#message'); const send = root.querySelector('[type=submit]');
    const status = root.querySelector('.foot'); const jump = root.querySelector('.jump');
    const scrolling = app.createChatScroll(log, jump);
    const rows = new Map(); const sourceRows = new Map();
    let view = app.normalizeView(provider?.getViewPrefs?.()); let sending = false; let destroyed = false; let viewRequest = 0;
    let previousSignature = null;
    const applySize = () => {
      const saved = scrolling.beforeUpdate();
      panel.style.width = `${view.width}px`; panel.style.height = `${view.height}px`;
      root.querySelector('.width-range').value = view.width; root.querySelector('.height-range').value = view.height;
      root.querySelector('.width-value').textContent = `${view.width}px`; root.querySelector('.height-value').textContent = `${view.height}px`;
      scrolling.afterUpdate(saved);
    };
    const changeView = async patch => {
      const requestId = ++viewRequest; const prior = view;
      view = app.normalizeView({ ...view, ...patch });
      if ('selectedGroups' in patch || 'hiddenSources' in patch) scrolling.newest();
      applySize(); render(null, true);
      try {
        const saved = await provider?.updateView?.(patch);
        if (!destroyed && requestId === viewRequest && saved) { view = app.normalizeView(saved); applySize(); render(null, true); }
      } catch (error) {
        if (!destroyed && requestId === viewRequest) { view = prior; status.textContent = error.message || 'Could not save display settings.'; render(null, true); }
      }
    };
    const groups = app.createGroupControls(root.querySelector('.group-controls'), patch => { changeView(patch); });
    root.querySelector('.destination').textContent = `· from ${context.key || context.platform}`;
    const createRow = message => {
      const row = document.createElement('div'); row.className = 'message';
      const meta = document.createElement('div'); meta.className = 'meta';
      const badge = document.createElement('span'); badge.className = `badge ${message.platform}`; badge.textContent = message.platform === 'twitch' ? 'TWITCH' : 'YOUTUBE';
      const author = document.createElement('strong'); author.textContent = message.author;
      const time = document.createElement('time'); time.dateTime = new Date(message.time).toISOString();
      time.textContent = new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      meta.append(badge, author, time);
      const origin = document.createElement('span'); origin.className = 'source';
      const body = document.createElement('p'); body.className = 'text'; app.renderMessageBody(body, message);
      const kind = document.createElement('span'); kind.className = 'local';
      kind.textContent = message.local ? 'Local demo · visible in your browser profile' : message.origin === 'twitch-eventsub' ? 'Live Twitch' : message.origin === 'youtube-api' ? 'Live YouTube' : 'Sample message';
      row.append(meta, origin, body, kind);
      return { row, origin };
    };
    const updateSources = sources => {
      const container = root.querySelector('.source-options');
      for (const [key, entry] of sourceRows) if (!sources.some(source => source.key === key)) { entry.row.remove(); sourceRows.delete(key); }
      sources.forEach((source, index) => {
        let entry = sourceRows.get(source.key);
        if (!entry) {
          const row = document.createElement('div');
          const checkbox = document.createElement('input'); checkbox.type = 'checkbox';
          checkbox.setAttribute('aria-label', `Include ${source.label} chat within selected groups`);
          checkbox.addEventListener('change', () => {
            const hidden = new Set(view.hiddenSources);
            if (checkbox.checked) hidden.delete(source.key); else hidden.add(source.key);
            changeView({ hiddenSources: [...hidden] });
          });
          const info = document.createElement('div'); info.className = 'source-info';
          const link = document.createElement('a'); const tags = document.createElement('span'); tags.className = 'source-groups'; info.append(link, tags);
          const state = document.createElement('span'); const color = document.createElement('input'); color.type = 'color'; color.className = 'color-control';
          color.setAttribute('aria-label', `Chat color for ${source.label}`);
          color.addEventListener('change', async () => {
            try { await provider?.updateSource?.(source.key, { color: color.value }); }
            catch (error) { status.textContent = error.message || 'Could not save this color.'; }
          });
          row.append(checkbox, info, state, color); entry = { row, checkbox, link, tags, state, color }; sourceRows.set(source.key, entry);
        }
        entry.row.className = `source-option${app.sourceVisible(source.key, sources, view) ? '' : ' is-excluded'}`;
        entry.checkbox.checked = !view.hiddenSources.includes(source.key);
        entry.color.hidden = !source.url;
        app.streamLink(entry.link, source);
        entry.tags.textContent = `${source.platform === 'twitch' ? 'Twitch' : 'YouTube'} · ${(source.groups || []).join(' · ') || 'Ungrouped'}`;
        entry.state.textContent = app.statusText(source); entry.state.className = `live-state ${['live', 'offline', 'upcoming'].includes(source.liveState) ? source.liveState : 'unknown'}`;
        entry.state.title = `${source.statusReason || 'Not checked.'}${source.checkedAt ? ` Checked ${new Date(source.checkedAt).toLocaleTimeString()}.` : ''}`;
        entry.state.setAttribute('aria-label', `${app.statusText(source)}. ${entry.state.title}`);
        if (root.activeElement !== entry.color) entry.color.value = source.color || app.sourcePalette[index % app.sourcePalette.length];
        if (container.children[index] !== entry.row) container.insertBefore(entry.row, container.children[index] || null);
      });
      root.querySelector('.source-summary').textContent = `Streams · ${sources.filter(source => source.liveState === 'live').length} live / ${sources.length}`;
    };
    const render = (error, keepLocalView = false) => {
      if (destroyed) return;
      if (error) { status.textContent = 'Could not update chat. A later update will retry.'; return; }
      if (!provider) return;
      if (!keepLocalView && provider.getViewPrefs) view = app.normalizeView(provider.getViewPrefs());
      const room = provider.getRoom(); const directory = provider.getDirectory?.();
      const messages = provider.getMessages();
      const sources = [...(directory?.sources?.length ? directory.sources : room.pair?.sources || [])];
      messages.forEach(message => {
        const key = message.sourceKey || `demo:${message.platform}`;
        if (!sources.some(source => source.key === key)) sources.push({ key, platform: message.platform, label: message.sourceLabel || `Demo ${message.platform} samples`, groups: [], color: '#827392' });
      });
      groups.update(sources, view); updateSources(sources);
      const signature = JSON.stringify([view.width, view.height]);
      if (signature !== previousSignature) { applySize(); previousSignature = signature; }
      const connectionLines = [provider.getLiveStatus?.(), provider.getYouTubeStatus?.()].filter(Boolean).flatMap(feed => [feed.message,
        ...(feed.sources || []).filter(source => source.state === 'error').map(source => `${source.label}: ${source.message}`)]);
      root.querySelector('.connection').textContent = connectionLines.join('\n') || 'Connect platforms from the extension popup to read live chat.';
      root.querySelector('.notice').textContent = room.pair ? `${room.pair.sources?.length || 2} streams in your room · Filter by group below` : 'Separate local chat · Add a room from the extension popup';
      const saved = scrolling.beforeUpdate(); const visible = messages.filter(message => app.sourceVisible(message.sourceKey || `demo:${message.platform}`, sources, view));
      const occurrences = new Map();
      const desired = visible.map(message => {
        const base = app.messageKey(message); const count = occurrences.get(base) || 0; occurrences.set(base, count + 1);
        return { key: app.messageKey(message, count), message };
      });
      const keys = new Set(desired.map(item => item.key));
      for (const [key, entry] of rows) if (!keys.has(key)) { entry.row.remove(); rows.delete(key); }
      desired.forEach(({ key, message }, index) => {
        let entry = rows.get(key);
        if (!entry) { entry = createRow(message); rows.set(key, entry); }
        const source = sources.find(item => item.key === (message.sourceKey || `demo:${message.platform}`));
        const color = /^#[0-9a-f]{6}$/i.test(source?.color) ? source.color : '#827392';
        entry.row.style.borderInlineStartColor = color;
        entry.origin.style.backgroundColor = `${color}22`; entry.origin.textContent = source?.displayName || message.sourceLabel || source?.label || message.platform;
        if (log.children[index] !== entry.row) log.insertBefore(entry.row, log.children[index] || null);
      });
      root.querySelector('.empty').hidden = visible.length !== 0;
      scrolling.afterUpdate(saved);
    };
    applySize(); input.disabled = !provider;
    const unsubscribe = provider?.subscribe(error => render(error));
    if (provider) render(null); else status.textContent = loadError || 'Loading saved chat…';
    for (const dimension of ['width', 'height']) {
      const control = root.querySelector(`.${dimension}-range`);
      control.addEventListener('input', () => { view = app.normalizeView({ ...view, [dimension]: Number(control.value) }); applySize(); });
      control.addEventListener('change', () => { changeView({ [dimension]: Number(control.value) }); });
    }
    input.addEventListener('input', () => { send.disabled = sending || !input.value.trim(); });
    root.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault(); if (!provider || sending || !input.value.trim()) return;
      sending = true; input.disabled = true; send.disabled = true; status.textContent = 'Saving local demo…';
      try {
        const message = await provider.send(input.value, context.platform);
        if (message) { render(null); input.value = ''; status.textContent = 'Saved locally. Nothing posted to native chat.'; }
      } catch (error) { status.textContent = error.message || 'Message not saved. Please try again.'; }
      finally { sending = false; input.disabled = false; send.disabled = !input.value.trim(); if (host.isConnected) input.focus(); }
    });
    const collapse = root.querySelector('.collapse');
    collapse.addEventListener('click', () => {
      const body = root.querySelector('.body'); body.hidden = !body.hidden;
      panel.className = body.hidden ? 'panel is-collapsed' : 'panel';
      collapse.setAttribute('aria-expanded', String(!body.hidden)); collapse.setAttribute('aria-label', `${body.hidden ? 'Expand' : 'Collapse'} CrossChat`); collapse.textContent = body.hidden ? '+' : '−';
      if (!body.hidden && scrolling.isFollowing()) scrolling.newest();
    });
    return { host, mounted() { if (scrolling.isFollowing()) scrolling.newest(); }, destroy() {
      destroyed = true; unsubscribe?.(); scrolling.destroy(); keyboardEvents.forEach(type => window.removeEventListener(type, isolateKeyboard, true)); host.remove();
    } };
  };
})();
