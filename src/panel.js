(() => {
  const app = globalThis.CrossChat;
  app.createPanel = (context, provider, loadError = null) => {
    const host = document.createElement('crosschat-panel');
    host.style.cssText = 'all:initial!important;position:fixed!important;right:16px!important;bottom:16px!important;z-index:2147483647!important;display:block!important;max-width:calc(100vw - 32px)!important;';
    const root = host.attachShadow({ mode: 'closed' });
    // Outside a Shadow DOM, an input's keyboard events appear to come from the
    // host element. Site shortcut handlers may therefore mistake typing for a
    // player shortcut. Intercept at window capture before document handlers.
    // Keep browser defaults: typing, editing, Tab, and Enter-to-submit still work.
    const keyboardEvents = ['keydown', 'keypress', 'keyup'];
    const isolateKeyboard = event => {
      if (event.composedPath().includes(host)) event.stopImmediatePropagation();
    };
    keyboardEvents.forEach(type => window.addEventListener(type, isolateKeyboard, true));
    // Only static markup goes through innerHTML. Message text uses safe DOM nodes; only validated Twitch fragments can create emote images.
    root.innerHTML = `
      <style>
        :host{color-scheme:dark}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:2px solid #b6a0ff;outline-offset:3px}
        .panel{width:350px;max-width:calc(100vw - 32px);font:14px/1.5 system-ui,sans-serif;color:#eeeef5;background:#14141c;border:1px solid #393344;border-radius:16px;box-shadow:0 12px 48px #0009;overflow:hidden}
        header{display:flex;align-items:center;gap:10px;padding:16px;border-bottom:1px solid #2c2936}.logo{display:grid;place-items:center;width:34px;height:34px;background:#a78bfa;color:#171022;border-radius:10px;font-weight:900}.title{flex:1}h2{font-size:16px;margin:0}small{font-size:11px;color:#aaa6ba}.collapse{background:#252331;border:1px solid #464052;border-radius:8px;color:#eee;width:32px;height:32px}
        .notice{margin:12px 14px 0;padding:8px 10px;background:#252033;color:#cbbbeb;border-radius:8px;font-size:12px}.messages{height:300px;max-height:calc(100dvh - 440px);min-height:70px;overflow:auto;overscroll-behavior:contain;padding:8px 14px;scrollbar-width:thin}.message{padding:10px 0;border-bottom:1px solid #ffffff08;overflow-wrap:anywhere}.meta{display:flex;align-items:center;gap:7px;font-size:12px}.badge{font-size:9px;font-weight:800;letter-spacing:.5px;padding:2px 5px;border-radius:4px}.twitch{background:#382452;color:#d5b7ff}.youtube{background:#48232b;color:#ffa8b1}time{margin-left:auto;color:#8e899f;font-size:10px}.text{margin:5px 0 0;color:#d9d6e3}.local{font-size:10px;color:#aaa6ba}
        form{padding:12px 14px 14px;border-top:1px solid #2c2936}label{display:block;font-size:12px;color:#aaa6ba;margin-bottom:6px}.compose{display:flex;gap:8px}input{min-width:0;flex:1;background:#20202b;color:#fff;border:1px solid #464052;border-radius:8px;padding:10px}button[type=submit]{border:0;border-radius:8px;background:#b399ff;color:#211435;font-weight:700;padding:0 13px}button:disabled{opacity:.45;cursor:default}.foot{display:block;margin-top:8px;color:#9791a9;font-size:11px}[hidden]{display:none!important}
        .source{display:block;color:#b9acd3;font-size:11px;margin-top:4px;overflow-wrap:anywhere}.filters{margin:10px 14px;color:#bbb3cd;font-size:12px}.filters summary{cursor:pointer}.source-options{max-height:120px;overflow:auto;padding-top:6px}.source-option{display:flex;align-items:center;gap:7px;font-size:11px;overflow-wrap:anywhere;margin:6px 0}.source-option input{flex:none;min-width:16px;width:16px;height:16px;margin:0;accent-color:#b399ff}.empty{margin:10px 14px;color:#aaa6ba;font-size:12px}
        .connection{margin:8px 14px;font-size:11px;color:#c0b4d9;white-space:pre-line;overflow-wrap:anywhere}
        .text{white-space:pre-wrap}.emote{display:inline-block;height:28px;width:auto;max-width:112px;object-fit:contain;vertical-align:middle}
      </style>
      <section class="panel" aria-label="CrossChat combined chat">
        <header><span class="logo" aria-hidden="true">C↔</span><div class="title"><h2>CrossChat</h2><small>MULTI-SOURCE CHAT</small></div><button class="collapse" aria-label="Collapse CrossChat" aria-expanded="true">−</button></header>
        <div class="body"><p class="notice">Mock chat · History saved on this device.</p><p class="connection" role="status">Checking Twitch connection…</p><details class="filters"><summary>Sources</summary><div class="source-options"></div></details><p class="empty" hidden>No messages match your source filters.</p><div class="messages" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions" tabindex="0"></div>
        <form><label for="message">Your message <span class="destination"></span></label><div class="compose"><input id="message" maxlength="500" autocomplete="off" placeholder="Send a local demo message…"><button type="submit" disabled>Send demo</button></div><span class="foot" role="status">Local demo only. Nothing is sent to either platform.</span></form></div>
      </section>`;
    const log = root.querySelector('.messages');
    const input = root.querySelector('input');
    const send = root.querySelector('[type=submit]');
    root.querySelector('.destination').textContent = `· from ${context.key || context.platform}`;
    function append(message) {
      const row = document.createElement('div');
      row.className = 'message';
      const meta = document.createElement('div');
      meta.className = 'meta';
      const badge = document.createElement('span');
      badge.className = `badge ${message.platform}`;
      badge.textContent = message.platform === 'twitch' ? 'TWITCH' : 'YOUTUBE';
      const author = document.createElement('strong');
      author.textContent = message.author;
      const time = document.createElement('time');
      time.dateTime = new Date(message.time).toISOString();
      time.textContent = new Date(message.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      meta.append(badge, author, time);
      const body = document.createElement('p');
      body.className = 'text';
      app.renderMessageBody(body, message);
      const origin = document.createElement('span');
      origin.className = 'source';
      origin.textContent = message.sourceLabel || `Demo ${message.platform} sample`;
      row.append(meta, origin, body);
      if (message.local) {
        const label = document.createElement('span');
        label.className = 'local';
        label.textContent = 'Local demo · Shared across your room tabs';
        row.append(label);
      }
      if (!message.local) {
        const kind = document.createElement('span');
        kind.className = 'local';
        kind.textContent = message.origin === 'twitch-eventsub' ? 'Live Twitch message · received this session' : 'Sample message';
        row.append(kind);
      }
      log.append(row);
      while (log.children.length > 200) log.firstElementChild.remove();
      log.scrollTop = log.scrollHeight;
    }
    const status = root.querySelector('.foot');
    let sending = false;
    input.disabled = !provider;
    const hiddenSources = new Set();
    let filterRoomKey = null;
    let filterSignature = null;
    const render = error => {
      if (error) {
        status.textContent = 'Could not refresh chat. Your next send will retry the connection.';
        return;
      }
      const live = provider.getLiveStatus?.();
      root.querySelector('.connection').textContent = live
        ? [live.message, ...(live.sources || []).filter(source => source.state === 'error').map(source => `${source.label}: ${source.message}`)].join('\n')
        : 'Local demo. Sign in through the extension popup for read-only Twitch chat.';
      const messages = provider.getMessages();
      const room = provider.getRoom();
      if (room.key !== filterRoomKey) {
        hiddenSources.clear();
        filterRoomKey = room.key;
        filterSignature = null;
      }
      const sources = new Map((room.pair?.sources || []).map(source => [source.key, source]));
      messages.forEach(message => {
        const key = message.sourceKey || `demo:${message.platform}`;
        if (!sources.has(key)) sources.set(key, { key, platform: message.platform,
          label: message.sourceLabel || `Demo ${message.platform} sample` });
      });
      const signature = JSON.stringify([...sources.keys()]);
      if (signature !== filterSignature) {
        const options = root.querySelector('.source-options');
        options.replaceChildren();
        sources.forEach(source => {
          const label = document.createElement('label');
          label.className = 'source-option';
          const checkbox = document.createElement('input');
          checkbox.type = 'checkbox';
          checkbox.checked = !hiddenSources.has(source.key);
          const name = document.createElement('span');
          name.textContent = `${source.platform === 'twitch' ? 'Twitch' : 'YouTube'} · ${source.label}`;
          checkbox.addEventListener('change', () => {
            if (checkbox.checked) hiddenSources.delete(source.key);
            else hiddenSources.add(source.key);
            render(null);
          });
          label.append(checkbox, name);
          options.append(label);
        });
        filterSignature = signature;
      }
      root.querySelector('.filters summary').textContent = `Sources · ${[...sources.keys()].filter(key => !hiddenSources.has(key)).length}/${sources.size} shown`;
      const visible = messages.filter(message => !hiddenSources.has(message.sourceKey || `demo:${message.platform}`));
      log.replaceChildren();
      visible.forEach(append);
      root.querySelector('.empty').hidden = visible.length !== 0;
      root.querySelector('.notice').textContent = room.pair
        ? `Local shared room · ${room.pair.sources?.length || 2} sources`
        : 'Separate local chat · Add sources in the extension popup.';
    };
    const unsubscribe = provider?.subscribe(render);
    if (provider) render(null);
    else status.textContent = loadError || 'Loading saved chat…';
    input.addEventListener('input', () => { send.disabled = sending || !input.value.trim(); });
    root.querySelector('form').addEventListener('submit', async event => {
      event.preventDefault();
      if (!provider || sending || !input.value.trim()) return;
      sending = true;
      input.disabled = true;
      send.disabled = true;
      status.textContent = 'Saving on this device…';
      try {
        const message = await provider.send(input.value, context.platform);
        if (message) {
          render(null);
          input.value = '';
          status.textContent = 'Saved in CrossChat on this device. Nothing posted to native chat.';
        } else {
          status.textContent = 'Enter a message of 1–500 characters.';
        }
      } catch (error) {
        console.warn('CrossChat could not save message.', error);
        status.textContent = error.message || 'Message not saved. Your text is kept here; please try again.';
      } finally {
        sending = false;
        input.disabled = false;
        send.disabled = !input.value.trim();
        if (host.isConnected) input.focus();
      }
    });
    const collapse = root.querySelector('.collapse');
    collapse.addEventListener('click', () => {
      const body = root.querySelector('.body');
      body.hidden = !body.hidden;
      collapse.setAttribute('aria-expanded', String(!body.hidden));
      collapse.setAttribute('aria-label', `${body.hidden ? 'Expand' : 'Collapse'} CrossChat`);
      collapse.textContent = body.hidden ? '+' : '−';
    });
    return {
      host,
      destroy() {
        unsubscribe?.();
        keyboardEvents.forEach(type => window.removeEventListener(type, isolateKeyboard, true));
        host.remove();
      }
    };
  };
})();
