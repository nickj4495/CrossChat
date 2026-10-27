(() => {
  const app = globalThis.CrossChat;
  app.createYouTubeLive = ({ auth, service, local, session, publish, now = Date.now, delay = setTimeout, cancel = clearTimeout }) => {
    const buffer = app.createYouTubeBuffer();
    const runKey = 'youtubeRun:v1';
    let run = null;
    let generation = 0;
    let signature = null;
    let records = [];
    let lookupAbort = null;
    let operations = Promise.resolve();
    let status = { state: 'paused', message: 'YouTube reading is off. Configure Google sign-in, then click Start reading.', sources: [] };
    const notify = () => { Promise.resolve(publish()).catch(() => {}); };
    const update = (state, message, sources = []) => {
      const next = { state, message, sources };
      if (JSON.stringify(next) !== JSON.stringify(status)) { status = next; notify(); }
    };
    const stop = () => {
      generation++;
      lookupAbort?.abort(); lookupAbort = null;
      records.forEach(record => { cancel(record.timer); record.abort.abort(); });
      records = []; signature = null; buffer.clear();
    };
    const persist = () => session.set({ [runKey]: run });
    const pause = async message => {
      stop();
      run = run || (await session.get(runKey))[runKey];
      if (run) { run.active = false; await persist(); }
      update('paused', message || 'YouTube reading stopped.');
    };
    const summarize = () => {
      const sources = records.map(record => ({ key: record.source.key, label: record.source.label,
        state: record.state, message: record.error }));
      const active = records.filter(record => ['waiting', 'reading', 'connecting'].includes(record.state));
      const ready = active.filter(record => record.received).length;
      update(active.length ? ready ? 'polling' : 'connecting' : 'ended',
        active.length ? `YouTube: ${ready}/${records.length} chats receiving updates (about every 15s or slower). ${run.requests}/300 chat requests used.`
          : 'No YouTube chats are still being read. Check source status; use Start reading to retry.', sources);
    };
    const poll = async (record, expectedGeneration) => {
      if (generation !== expectedGeneration || !run?.active) return;
      if (now() >= run.until || run.requests >= 300) {
        await pause('YouTube test session limit reached (30 minutes or 300 chat requests). Click Start reading to continue.');
        return;
      }
      if (record.notBefore > now()) {
        record.timer = delay(() => { poll(record, expectedGeneration).catch(() => {}); }, record.notBefore - now());
        return;
      }
      try {
        run.requests++;
        run.cursors[record.source.key] = { chatId: record.chatId, cursor: record.cursor || null, notBefore: now() + 60000 };
        await persist();
        if (generation !== expectedGeneration) return;
        const params = { part: 'id,snippet,authorDetails', liveChatId: record.chatId, maxResults: '200' };
        if (record.cursor) params.pageToken = record.cursor;
        const result = await auth.api('liveChat/messages', params, record.abort.signal);
        if (generation !== expectedGeneration) return;
        if (!Array.isArray(result.items)) throw new Error('YouTube returned an invalid chat response.');
        const events = result.items.map(item => app.normalizeYouTubeMessage(item, record.source, record.chatId));
        const ended = Boolean(result.offlineAt) || events.some(event => event?.kind === 'end');
        if (!ended && (!Number.isFinite(result.pollingIntervalMillis) || result.pollingIntervalMillis < 0 || result.pollingIntervalMillis > 86400000 ||
            typeof result.nextPageToken !== 'string' || !result.nextPageToken)) {
          throw new Error('YouTube returned no safe continuation interval/token. Start again to retry.');
        }
        for (const event of events) buffer.apply(event);
        record.received = true;
        record.cursor = result.nextPageToken || null;
        record.notBefore = now() + Math.max(15000, result.pollingIntervalMillis || 15000);
        run.cursors[record.source.key] = { chatId: record.chatId, cursor: record.cursor, notBefore: record.notBefore };
        await persist();
        if (generation !== expectedGeneration) return;
        record.state = ended ? 'ended' : 'reading';
        if (!ended) record.timer = delay(() => { poll(record, expectedGeneration).catch(() => {}); }, record.notBefore - now());
        summarize(); notify();
      } catch (error) {
        if (generation !== expectedGeneration) return;
        record.state = 'error'; record.error = error.message;
        // A gap can hide moderation events. Discard this source's retained text.
        buffer.clearSource(record.source.key);
        summarize(); notify();
      }
    };
    const synchronize = async () => {
      const expected = generation;
      const [pair, settings, saved, signedIn] = await Promise.all([
        service.getPair(), local.get({ enabled: true }), session.get(runKey), auth.state()
      ]);
      if (generation !== expected) return;
      const stored = saved[runKey];
      if (!run || run.id !== stored?.id) run = stored || null;
      if (!run?.active) {
        if (records.length) stop();
        if (status.state === 'paused') return;
        update('paused', 'YouTube reading is off. Click Start reading when ready.'); return;
      }
      if (settings.enabled === false) { await pause('CrossChat is disabled. Start YouTube reading again when enabled.'); return; }
      if (!signedIn.connected) { await pause('Sign in to YouTube, then click Start reading.'); return; }
      if (!pair || pair.key !== run.roomKey) { await pause('Room sources changed. Click Start reading to read the new room.'); return; }
      if (now() >= run.until || run.requests >= 300) { await pause('YouTube test session limit reached. Click Start reading to continue.'); return; }
      if (signature === run.id) return;
      stop(); signature = run.id;
      const requestGeneration = generation;
      const desired = pair.sources.filter(source => source.platform === 'youtube');
      if (!desired.length) { await pause('Add YouTube live videos to your saved room first.'); return; }
      update('connecting', 'Looking up YouTube livestreams…');
      try {
        lookupAbort = new AbortController();
        const result = await auth.api('videos', { part: 'snippet,liveStreamingDetails', id: desired.map(source => source.key.slice(8)).join(',') }, lookupAbort.signal);
        if (generation !== requestGeneration) return;
        lookupAbort = null;
        records = desired.map(source => {
          const video = result.items?.find(item => item.id === source.key.slice(8));
          const chatId = video?.liveStreamingDetails?.activeLiveChatId;
          const checkpoint = run.cursors[source.key];
          return { source: { ...source, label: video?.snippet?.channelTitle ? `${video.snippet.channelTitle} · ${(video.snippet.title || '').slice(0, 120)}` : source.label },
            chatId, cursor: checkpoint?.chatId === chatId ? checkpoint.cursor : undefined,
            notBefore: checkpoint?.chatId === chatId ? checkpoint.notBefore || 0 : 0,
            state: chatId ? 'waiting' : 'error', error: chatId ? undefined : 'No active live chat (offline, disabled, or inaccessible video).',
            received: false, abort: new AbortController(), timer: null };
        });
        records.filter(record => record.chatId).forEach(record => {
          record.timer = delay(() => { poll(record, requestGeneration).catch(() => {}); }, Math.max(0, record.notBefore - now()));
        });
        summarize();
      } catch (error) {
        if (generation !== requestGeneration) return;
        update('error', error.message);
      }
    };
    const sync = () => {
      const result = operations.then(synchronize);
      operations = result.catch(() => {});
      return result;
    };
    return {
      sync, stop,
      async start() {
        const pair = await service.getPair();
        const settings = await local.get({ enabled: true });
        if (settings.enabled === false) throw new Error('Enable CrossChat first.');
        if (!(await auth.state()).connected) throw new Error('Sign in to YouTube first.');
        if (!pair?.sources.some(source => source.platform === 'youtube')) throw new Error('Save a room containing a YouTube livestream first.');
        stop();
        run = { id: `${now()}:${generation}`, roomKey: pair.key, active: true, until: now() + 30 * 60000, requests: 0, cursors: {} };
        await persist(); await sync();
        return { started: true };
      },
      pause,
      getStatus: key => key && run && run.roomKey !== key ? { state: 'idle', message: 'YouTube reading applies to the saved room only.', sources: [] }
        : { ...status, sources: status.sources.map(source => ({ ...source })) },
      getMessages: key => key === run?.roomKey ? buffer.getMessages() : []
    };
  };
})();
