(() => {
  const app = globalThis.CrossChat;
  app.createYouTubeRouter = ({ polling, createBackend, session, publish }) => {
    let mode = 'polling'; let backend = null; let operations = Promise.resolve();
    const modeKey = 'youtubeTransport:v1'; const secretKey = 'youtubeBackendKey:v1';
    const selected = () => mode === 'local' ? (backend ||= createBackend()) : polling;
    const enqueue = operation => {
      const result = operations.then(operation); operations = result.catch(() => {}); return result;
    };
    const load = async () => { mode = (await session?.get(modeKey))?.[modeKey] === 'local' ? 'local' : 'polling'; };
    return {
      sync: () => enqueue(async () => { await load(); await selected().sync(); }),
      start: () => enqueue(async () => { await load(); return selected().start(); }),
      pause: message => enqueue(async () => { await load(); await selected().pause(message); }),
      stop() { polling.stop(); backend?.stop(); },
      getStatus: key => selected().getStatus(key),
      getMessages: key => selected().getMessages(key),
      async settings() {
        await load();
        return { mode, keyConfigured: Boolean((await session?.get(secretKey))?.[secretKey]), endpoint: '127.0.0.1:47831' };
      },
      configure: ({ mode: requested, key }) => enqueue(async () => {
        if (!['local', 'polling'].includes(requested)) throw new Error('Choose a supported YouTube reader.');
        if (key !== undefined && (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key))) throw new Error('Paste the 64-character connection key printed by your local backend.');
        await load();
        await selected().pause('YouTube reader changed. Click Start reading when ready.');
        if (key !== undefined) await session.set({ [secretKey]: key });
        await session.set({ [modeKey]: requested }); mode = requested;
        await selected().pause('YouTube reader configured. Click Start reading when ready.');
        publish(); return { configured: true };
      })
    };
  };
})();
