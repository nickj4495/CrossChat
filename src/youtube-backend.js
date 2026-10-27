(() => {
  const app = globalThis.CrossChat;
  const endpoint = 'ws://127.0.0.1:47831/youtube';
  app.backendProof = async (key, text, cryptography = crypto) => {
    // Match Node's UTF-8 HMAC key encoding; the key itself never crosses the socket.
    const encoder = new TextEncoder();
    const imported = await cryptography.subtle.importKey('raw', encoder.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await cryptography.subtle.sign('HMAC', imported, encoder.encode(text));
    return Array.from(new Uint8Array(signature), byte => byte.toString(16).padStart(2, '0')).join('');
  };
  app.createYouTubeBackend = ({ auth, service, local, session, publish, socketFactory = url => new WebSocket(url),
    cryptography = crypto, delay = setTimeout, cancel = clearTimeout, now = Date.now }) => {
    const buffer = app.createYouTubeBuffer(); const runKey = 'youtubeBackendRun:v1';
    let run = null; let socket = null; let generation = 0; let reconnectTimer = null;
    let watchdog = null; let renewal = null; let checkpointTimer = null; let handshakeTimer = null;
    let retries = 0; let authRetries = 0; let forceRefresh = false; let operations = Promise.resolve();
    let status = { state: 'paused', message: 'Local YouTube streaming is off. Start the backend, then click Start reading.', sources: [] };
    const records = new Map();
    const notify = () => { Promise.resolve(publish()).catch(() => {}); };
    const update = (state, message) => { status = { state, message, sources: [...records.values()].map(({ source, state, message }) => ({ key: source.key, label: source.label, state, message })) }; notify(); };
    const persist = () => session.set({ [runKey]: run });
    const stop = () => {
      generation++; cancel(reconnectTimer); cancel(watchdog); cancel(renewal); cancel(checkpointTimer); cancel(handshakeTimer);
      reconnectTimer = watchdog = renewal = checkpointTimer = handshakeTimer = null;
      const old = socket; socket = null; old?.close(); buffer.clear(); records.clear();
    };
    const pause = async message => {
      stop(); run ||= (await session.get(runKey))[runKey];
      if (run) { run.active = false; await persist(); }
      update('paused', message || 'Local YouTube streaming stopped.');
    };
    const fail = async message => {
      stop(); update('error', message); if (run) { run.active = false; await persist(); }
    };
    const summarize = async () => {
      const values = [...records.values()];
      const ready = values.filter(record => record.state === 'streaming').length;
      const pending = values.some(record => ['connecting', 'reconnecting'].includes(record.state));
      update(ready ? 'streaming' : pending ? 'connecting' : 'ended', ready
        ? `YouTube streaming: ${ready}/${values.length} chats connected through your local backend.`
        : pending ? 'Connecting to YouTube streaming…' : 'No YouTube chats are active. Check sources; Start reading to retry.');
      if (!ready && !pending) {
        // Release upstream subscriptions/tokens instead of keeping an ended room alive.
        stop(); run.active = false; await persist(); notify();
      }
    };
    const connect = async () => {
      const pendingGeneration = generation;
      const key = (await session.get('youtubeBackendKey:v1'))['youtubeBackendKey:v1'];
      if (!run?.active || generation !== pendingGeneration) return;
      if (!/^[a-f0-9]{64}$/.test(key || '')) { await fail('Configure the local backend connection key in Connections first.'); return; }
      const expected = ++generation;
      const current = socketFactory(endpoint); socket = current;
      const nonce = Array.from(cryptography.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
      let verified = false; let helloReceived = false; let lastMessage = now(); let chain = Promise.resolve();
      const valid = () => expected === generation && socket === current && run?.active;
      const send = value => { if (valid() && current.readyState === 1) current.send(JSON.stringify(value)); };
      const armWatchdog = () => {
        cancel(watchdog); watchdog = delay(() => {
          if (!valid()) return;
          if (now() - lastMessage >= 45000) current.close(); else armWatchdog();
        }, 15000);
      };
      update('connecting', 'Connecting to the local backend…');
      // Also bounds connection/handshake stalls before any server heartbeat.
      armWatchdog();
      handshakeTimer = delay(() => { if (valid() && !verified) current.close(); }, 15000);
      current.onopen = () => send({ type: 'hello', nonce });
      current.onmessage = event => {
        chain = chain.then(async () => {
          if (!valid()) return;
          if (typeof event.data !== 'string' || event.data.length > 4 * 1024 * 1024) throw new Error('Invalid backend response.');
          const data = JSON.parse(event.data); lastMessage = now();
          if (data.type === 'heartbeat') { send({ type: 'heartbeat-ack' }); return; }
          if (data.type === 'hello') {
            if (helloReceived || data.protocol !== 1 || !/^[a-f0-9]{64}$/.test(data.challenge || '')) throw new Error('Invalid backend handshake.');
            helloReceived = true;
            const proof = await app.backendProof(key, 'server:' + nonce, cryptography);
            if (!valid()) return;
            if (data.proof !== proof) { await fail('Backend connection key does not match. Copy the key from your backend terminal again.'); return; }
            // Obtain the OAuth token only after proving this is the configured backend.
            const accessToken = await auth.streamToken(forceRefresh); forceRefresh = false;
            if (!valid()) return;
            const clientProof = await app.backendProof(key, `client:${data.challenge}:${nonce}`, cryptography);
            if (!valid()) return;
            verified = true;
            cancel(handshakeTimer); handshakeTimer = null;
            send({ type: 'join', proof: clientProof, accessToken, videoIds: run.sources.map(source => source.key.slice(8)), cursors: run.cursors });
            cancel(renewal); renewal = delay(() => {
              if (valid()) { forceRefresh = true; authRetries = 0; current.close(); }
            }, 55 * 60000);
            return;
          }
          if (!verified) throw new Error('Backend sent chat before authentication.');
          if (data.type === 'auth-required') {
            if (++authRetries > 1) { await fail('Google authorization could not be renewed. Sign in again.'); return; }
            forceRefresh = true; current.close(); return;
          }
          if (data.type === 'error') { await fail(typeof data.message === 'string' ? data.message.slice(0, 400) : 'Local backend error.'); return; }
          const record = records.get(data.videoId);
          if (!record) return;
          if (data.type === 'source') {
            if (typeof data.liveChatId !== 'string' || !data.liveChatId) throw new Error('Invalid YouTube source.');
            record.chatId = data.liveChatId;
            if (typeof data.label === 'string') record.source.label = data.label.slice(0, 300);
          } else if (data.type === 'source-status') {
            if (!['connecting', 'streaming', 'reconnecting', 'error', 'ended'].includes(data.state)) return;
            record.state = data.state; record.message = typeof data.message === 'string' ? data.message.slice(0, 400) : '';
            if (['reconnecting', 'error'].includes(data.state)) buffer.clearSource(record.source.key);
            await summarize();
          } else if (data.type === 'page' && record.chatId === data.liveChatId) {
            if (!Array.isArray(data.page?.items) || data.page.items.length > 2000) throw new Error('Invalid YouTube chat page.');
            for (const item of data.page.items) buffer.apply(app.normalizeYouTubeMessage(item, record.source, record.chatId));
            if (typeof data.page.nextPageToken === 'string' && data.page.nextPageToken.length <= 8192) run.cursors[data.videoId] = data.page.nextPageToken;
            retries = 0;
            if (!checkpointTimer) checkpointTimer = delay(() => { checkpointTimer = null; if (valid()) persist().catch(() => {}); }, 500);
            notify();
          }
        }).catch(async () => { if (valid()) await fail('Local streaming failed. Check backend setup and Google sign-in, then Start reading again.'); });
      };
      current.onerror = () => {}; // onclose reports a safe, actionable error.
      current.onclose = () => {
        if (!valid()) return;
        generation++; socket = null; cancel(watchdog); cancel(renewal); cancel(checkpointTimer); cancel(handshakeTimer); checkpointTimer = handshakeTimer = null;
        buffer.clear(); notify();
        if (++retries > 6) { fail('Local backend unavailable. Start it and retry, or manually choose Direct polling.').catch(() => {}); return; }
        const wait = Math.min(60000, 2000 * 2 ** (retries - 1));
        update('reconnecting', `Local backend disconnected. Retrying in ${wait / 1000}s. Polling fallback is manual.`);
        persist().catch(() => {});
        reconnectTimer = delay(() => { reconnectTimer = null; connect().catch(() => fail('Could not connect to the local backend.')); }, wait);
      };
    };
    const sync = () => {
      const result = operations.then(async () => {
        const expected = generation;
        const [pair, settings, saved, signedIn] = await Promise.all([service.getPair(), local.get({ enabled: true }), session.get(runKey), auth.state()]);
        if (expected !== generation) return;
        run ||= saved[runKey];
        if (!run?.active) return;
        if (settings.enabled === false || !signedIn.connected || pair?.key !== run.roomKey) {
          await pause('YouTube reading stopped. Check sign-in and room sources, then Start reading.'); return;
        }
        if (socket || reconnectTimer) return;
        records.clear(); run.sources.forEach(source => records.set(source.key.slice(8), { source: { ...source }, state: 'connecting', message: '' }));
        await connect();
      }); operations = result.catch(() => {}); return result;
    };
    return {
      sync, stop, pause,
      async start() {
        const pair = await service.getPair();
        if ((await local.get({ enabled: true })).enabled === false) throw new Error('Enable CrossChat first.');
        if (!(await auth.state()).connected) throw new Error('Sign in to YouTube first.');
        if (!pair?.sources.some(source => source.platform === 'youtube')) throw new Error('Save a room containing a YouTube livestream first.');
        stop(); retries = authRetries = 0; forceRefresh = false;
        run = { active: true, roomKey: pair.key, sources: pair.sources.filter(source => source.platform === 'youtube'), cursors: {} };
        await persist(); await sync(); return { started: true };
      },
      getStatus: key => key && run && key !== run.roomKey ? { state: 'idle', message: 'YouTube reading applies to the saved room only.', sources: [] } : { ...status, sources: status.sources.map(source => ({ ...source })) },
      getMessages: key => key === run?.roomKey ? buffer.getMessages() : []
    };
  };
})();
