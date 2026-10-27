(() => {
  const app = globalThis.CrossChat;
  app.requestBackendOAuth = async ({ api, session, provider, clientId, signal, socketFactory = url => new WebSocket(url), cryptography = crypto }) => {
    const key = (await session.get('youtubeBackendKey:v1'))['youtubeBackendKey:v1'];
    if (!/^[a-f0-9]{64}$/.test(key || '')) throw new Error('Save your local backend connection key under Read YouTube chat before signing in.');
    if (signal?.aborted) throw new Error('Sign-in cancelled.');
    return new Promise((resolve, reject) => {
      const socket = socketFactory('ws://127.0.0.1:47831/youtube'); let tabId; let finished = false; let verified = false; let sentHello = false; let opened = false;
      const nonce = Array.from(cryptography.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('');
      const finish = (error, result) => {
        if (finished) return; finished = true; clearTimeout(deadline); clearTimeout(handshake); signal?.removeEventListener('abort', abort); socket.close();
        if (tabId !== undefined) Promise.resolve(api.tabs.remove(tabId)).catch(() => {});
        error ? reject(error) : resolve(result);
      };
      const deadline = setTimeout(() => finish(new Error('Sign-in timed out. Start again.')), 5 * 60000);
      const handshake = setTimeout(() => { if (!verified) finish(new Error('Local backend handshake failed. Check the running backend and connection key.')); }, 15000);
      const abort = () => finish(new Error('Sign-in cancelled.'));
      signal?.addEventListener('abort', abort, { once: true });
      const send = data => { if (!finished && socket.readyState === 1) socket.send(JSON.stringify(data)); };
      socket.onopen = () => send({ type: 'hello', nonce });
      let chain = Promise.resolve();
      socket.onmessage = event => {
        chain = chain.then(async () => {
          if (finished) return;
          if (typeof event.data !== 'string' || event.data.length > 65536) throw new Error('Invalid sign-in response.');
          const data = JSON.parse(event.data);
          if (data.type === 'heartbeat') { send({ type: 'heartbeat-ack' }); return; }
          if (data.type === 'hello') {
            if (sentHello || data.protocol !== 1 || !/^[a-f0-9]{64}$/.test(data.challenge || '')) throw new Error('Invalid sign-in handshake.');
            sentHello = true;
            const expected = await app.backendProof(key, 'server:' + nonce, cryptography);
            if (finished) return;
            if (expected !== data.proof) throw new Error('Backend connection key does not match.');
            const proof = await app.backendProof(key, `client:${data.challenge}:${nonce}`, cryptography);
            if (finished) return; verified = true; clearTimeout(handshake);
            send({ type: 'oauth', provider, clientId, proof }); return;
          }
          if (!verified) throw new Error('Unverified sign-in response.');
          if (data.type === 'auth-url') {
            const url = new URL(data.url);
            const allowed = provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://id.twitch.tv/oauth2/authorize';
            if (opened || url.origin + url.pathname !== allowed || url.username || url.password) throw new Error('Invalid sign-in destination.');
            opened = true; const tab = await api.tabs.create({ url: url.href, active: true }); tabId = tab.id;
            if (finished) Promise.resolve(api.tabs.remove(tabId)).catch(() => {});
          } else if (data.type === 'auth-token') {
            const required = provider === 'google' ? 'https://www.googleapis.com/auth/youtube.readonly' : 'user:read:chat';
            if (!opened || typeof data.token !== 'string' || data.token.length < 10 || !Number.isFinite(data.expiresIn) || data.expiresIn <= 0 || !Array.isArray(data.scopes) || !data.scopes.includes(required)) throw new Error('Missing sign-in permission.');
            finish(null, { token: data.token, expiresAt: Date.now() + Math.min(data.expiresIn, 86400) * 1000, grantedScopes: data.scopes });
          } else if (data.type === 'auth-error') finish(new Error(typeof data.message === 'string' ? data.message.slice(0, 400) : 'Backend sign-in failed.'));
        }).catch(error => finish(error instanceof SyntaxError ? new Error('Invalid sign-in response.') : error));
      };
      socket.onerror = () => {};
      socket.onclose = () => finish(new Error('The local backend disconnected during sign-in. Check it and retry.'));
    });
  };
  app.createBrowserIdentity = ({ api, session }) => {
    const native = api.identity;
    if (typeof native?.getAuthToken === 'function') return native;
    const tokenKey = 'portableGoogleToken:v1'; let generation = 0; let pending = null;
    return {
      crossChatPortable: true,
      getRedirectURL: path => native?.getRedirectURL ? native.getRedirectURL(path) : 'http://127.0.0.1:47831/oauth/twitch/callback',
      async launchWebAuthFlow(options) {
        if (native?.launchWebAuthFlow) return native.launchWebAuthFlow(options);
        const original = new URL(options.url);
        if (original.origin !== 'https://id.twitch.tv' || original.pathname !== '/oauth2/authorize' || !options.interactive || original.searchParams.get('scope') !== 'user:read:chat') throw new Error('Unsupported authorization request.');
        const result = await app.requestBackendOAuth({ api, session, provider: 'twitch', clientId: original.searchParams.get('client_id') });
        return 'http://127.0.0.1:47831/oauth/twitch/callback#' + new URLSearchParams({ access_token: result.token, token_type: 'bearer', state: original.searchParams.get('state') }).toString();
      },
      async getAuthToken({ interactive }) {
        const expected = generation;
        let saved = (await session.get(tokenKey))[tokenKey];
        if (generation !== expected) throw new Error('Sign-in cancelled.');
        if (interactive) {
          pending = new AbortController();
          try { saved = await app.requestBackendOAuth({ api, session, provider: 'google', signal: pending.signal }); }
          finally { pending = null; }
          if (generation !== expected) throw new Error('Sign-in cancelled.');
          await session.set({ [tokenKey]: saved });
          if (generation !== expected) { await session.remove(tokenKey); throw new Error('Sign-in cancelled.'); }
        }
        if (!saved || saved.expiresAt <= Date.now() + 30000 || generation !== expected) throw new Error('Google authorization expired. Sign in again.');
        return { token: saved.token, grantedScopes: saved.grantedScopes };
      },
      async removeCachedAuthToken() { generation++; pending?.abort(); await session.remove(tokenKey); },
      async clearAllCachedAuthTokens() { generation++; pending?.abort(); await session.remove(tokenKey); }
    };
  };
})();
