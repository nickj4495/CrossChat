(() => {
  const app = globalThis.CrossChat;
  app.createPanel = (context, provider) => {
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
    // Only static markup goes through innerHTML. Message text always uses textContent.
    root.innerHTML = `
      <style>
        :host{color-scheme:dark}*{box-sizing:border-box}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:2px solid #b6a0ff;outline-offset:3px}
        .panel{width:350px;max-width:calc(100vw - 32px);font:14px/1.5 system-ui,sans-serif;color:#eeeef5;background:#14141c;border:1px solid #393344;border-radius:16px;box-shadow:0 12px 48px #0009;overflow:hidden}
        header{display:flex;align-items:center;gap:10px;padding:16px;border-bottom:1px solid #2c2936}.logo{display:grid;place-items:center;width:34px;height:34px;background:#a78bfa;color:#171022;border-radius:10px;font-weight:900}.title{flex:1}h2{font-size:16px;margin:0}small{font-size:11px;color:#aaa6ba}.collapse{background:#252331;border:1px solid #464052;border-radius:8px;color:#eee;width:32px;height:32px}
        .notice{margin:12px 14px 0;padding:8px 10px;background:#252033;color:#cbbbeb;border-radius:8px;font-size:12px}.messages{height:300px;max-height:calc(100dvh - 310px);min-height:70px;overflow:auto;overscroll-behavior:contain;padding:8px 14px;scrollbar-width:thin}.message{padding:10px 0;border-bottom:1px solid #ffffff08;overflow-wrap:anywhere}.meta{display:flex;align-items:center;gap:7px;font-size:12px}.badge{font-size:9px;font-weight:800;letter-spacing:.5px;padding:2px 5px;border-radius:4px}.twitch{background:#382452;color:#d5b7ff}.youtube{background:#48232b;color:#ffa8b1}time{margin-left:auto;color:#8e899f;font-size:10px}.text{margin:5px 0 0;color:#d9d6e3}.local{font-size:10px;color:#aaa6ba}
        form{padding:12px 14px 14px;border-top:1px solid #2c2936}label{display:block;font-size:12px;color:#aaa6ba;margin-bottom:6px}.compose{display:flex;gap:8px}input{min-width:0;flex:1;background:#20202b;color:#fff;border:1px solid #464052;border-radius:8px;padding:10px}button[type=submit]{border:0;border-radius:8px;background:#b399ff;color:#211435;font-weight:700;padding:0 13px}button:disabled{opacity:.45;cursor:default}.foot{display:block;margin-top:8px;color:#9791a9;font-size:11px}[hidden]{display:none!important}
      </style>
      <section class="panel" aria-label="CrossChat mock chat">
        <header><span class="logo" aria-hidden="true">C↔</span><div class="title"><h2>CrossChat</h2><small>TWITCH + YOUTUBE · PROTOTYPE</small></div><button class="collapse" aria-label="Collapse CrossChat" aria-expanded="true">−</button></header>
        <div class="body"><p class="notice">Mock chat · Messages stay in this page only.</p><div class="messages" role="log" aria-label="Chat messages" aria-live="polite" aria-relevant="additions" tabindex="0"></div>
        <form><label for="message">Your message <span class="destination"></span></label><div class="compose"><input id="message" maxlength="500" autocomplete="off" placeholder="Say hello to both chats…"><button type="submit" disabled>Send</button></div><span class="foot">Local demo only. Nothing is sent to either platform.</span></form></div>
      </section>`;
    const log = root.querySelector('.messages');
    const input = root.querySelector('input');
    const send = root.querySelector('[type=submit]');
    root.querySelector('.destination').textContent = `· ${context.platform === 'twitch' ? 'Twitch' : 'YouTube'} label`;
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
      body.textContent = message.text;
      row.append(meta, body);
      if (message.local) {
        const label = document.createElement('span');
        label.className = 'local';
        label.textContent = 'Only you can see this';
        row.append(label);
      }
      log.append(row);
      while (log.children.length > 200) log.firstElementChild.remove();
      log.scrollTop = log.scrollHeight;
    }
    provider.getMessages().forEach(append);
    input.addEventListener('input', () => { send.disabled = !input.value.trim(); });
    root.querySelector('form').addEventListener('submit', event => {
      event.preventDefault();
      const message = provider.send(input.value, context.platform);
      if (!message) return;
      append(message);
      input.value = '';
      send.disabled = true;
      input.focus();
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
        keyboardEvents.forEach(type => window.removeEventListener(type, isolateKeyboard, true));
        host.remove();
      }
    };
  };
})();

