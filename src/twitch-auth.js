(() => {
  const app = globalThis.CrossChat = globalThis.CrossChat || {};
  app.createTwitchAuth = ({ local, session, identity, fetcher = fetch, random = crypto, now = Date.now }) => {
    let validatedThisWorker = false;
    let validating = null;
    let signingIn = false;
    let generation = 0;
    const tokenKey = 'twitchAuth:v1';
    const configKey = 'twitchClientId:v1';
    const redirectUri = () => identity.getRedirectURL('twitch');
    const http = async (url, options = {}) => {
      try { return await fetcher(url, { ...options, signal: AbortSignal.timeout(15000), redirect: 'error' }); }
      catch { throw new Error('Could not reach Twitch. Check your connection and retry.'); }
    };
    const clear = async () => { generation++; validatedThisWorker = false; await session.remove(tokenKey); };
    const validate = async credentials => {
      const response = await http('https://id.twitch.tv/oauth2/validate', {
        headers: { Authorization: `OAuth ${credentials.token}` }
      });
      if (response.status === 401) { await clear(); throw new Error('Twitch authorization expired or was revoked. Sign in again.'); }
      if (!response.ok) throw new Error('Twitch could not validate your sign-in. Retry shortly.');
      const data = await response.json();
      if (data.client_id !== credentials.clientId || !data.user_id || !data.login ||
          !Array.isArray(data.scopes) || !data.scopes.includes('user:read:chat') ||
          !Number.isFinite(data.expires_in) || data.expires_in <= 0) {
        await clear();
        throw new Error('Twitch sign-in does not match this app or lacks chat-read permission. Sign in again.');
      }
      return { token: credentials.token, clientId: credentials.clientId, userId: data.user_id,
        login: data.login, validatedAt: now(), expiresAt: now() + data.expires_in * 1000 };
    };
    const credentials = async () => {
      if (validating) return validating;
      validating = (async () => {
        const initialGeneration = generation;
        const saved = (await session.get(tokenKey))[tokenKey];
        if (!saved) return null;
        if (saved.expiresAt <= now()) { await clear(); return null; }
        if (!validatedThisWorker || now() - saved.validatedAt >= 55 * 60000) {
          const checked = await validate(saved);
          if (initialGeneration !== generation) return null;
          await session.set({ [tokenKey]: checked });
          validatedThisWorker = true;
          return checked;
        }
        return saved;
      })();
      try { return await validating; } finally { validating = null; }
    };
    return {
      redirectUri,
      async state() {
        const clientId = (await local.get(configKey))[configKey] || '';
        const saved = (await session.get(tokenKey))[tokenKey];
        return { clientId, redirectUri: redirectUri(), signingIn,
          login: saved?.expiresAt > now() ? saved.login : null };
      },
      credentials,
      async signIn(clientId) {
        if (signingIn) throw new Error('Twitch sign-in is already open. Finish it or close that window first.');
        if (typeof clientId !== 'string' || !/^[a-zA-Z0-9]{10,100}$/.test(clientId.trim())) throw new Error('Enter the public Twitch Client ID from your registered application.');
        clientId = clientId.trim();
        signingIn = true;
        const initialGeneration = ++generation;
        try {
          await local.set({ [configKey]: clientId });
          const state = Array.from(random.getRandomValues(new Uint8Array(32)), value => value.toString(16).padStart(2, '0')).join('');
          const url = new URL('https://id.twitch.tv/oauth2/authorize');
          url.search = new URLSearchParams({ response_type: 'token', client_id: clientId,
            redirect_uri: redirectUri(), scope: 'user:read:chat', state, force_verify: 'true' });
          let callback;
          try { callback = await identity.launchWebAuthFlow({ url: url.href, interactive: true }); }
          catch { throw new Error('Twitch sign-in was cancelled or could not complete. Check the registered redirect URL and try again.'); }
          if (!callback || initialGeneration !== generation) throw new Error('Twitch sign-in was cancelled.');
          const returned = new URL(callback);
          const expected = new URL(redirectUri());
          const params = new URLSearchParams(returned.hash.slice(1));
          if (returned.origin !== expected.origin || returned.pathname !== expected.pathname ||
              returned.search || params.get('state') !== state) throw new Error('Twitch sign-in response could not be verified. Try again.');
          if (params.has('error')) throw new Error('Twitch authorization was declined.');
          const token = params.get('access_token');
          if (!token || params.get('token_type')?.toLowerCase() !== 'bearer') throw new Error('Twitch did not return a usable access token.');
          const checked = await validate({ token, clientId });
          if (initialGeneration !== generation) throw new Error('Twitch sign-in was cancelled.');
          await session.set({ [tokenKey]: checked });
          validatedThisWorker = true;
          return { login: checked.login };
        } finally { signingIn = false; }
      },
      async signOut() {
        const saved = (await session.get(tokenKey))[tokenKey];
        await clear();
        if (!saved) return { revoked: true };
        try {
          const response = await http('https://id.twitch.tv/oauth2/revoke', { method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: saved.clientId, token: saved.token }).toString() });
          return { revoked: response.ok };
        } catch { return { revoked: false }; }
      },
      invalidate: clear,
      async api(path, options = {}) {
        if (!/^\/(users\?|eventsub\/subscriptions(?:\?|$))/.test(path)) throw new Error('Unsupported Twitch API request.');
        const saved = await credentials();
        if (!saved) throw new Error('Sign in to Twitch to read live chat.');
        const response = await http(`https://api.twitch.tv/helix${path}`, { ...options,
          headers: { ...options.headers, Authorization: `Bearer ${saved.token}`, 'Client-Id': saved.clientId } });
        if (response.status === 401) { await clear(); throw new Error('Twitch authorization expired or was revoked. Sign in again.'); }
        if (!response.ok) {
          const error = new Error(response.status === 403 ? 'Twitch denied access to this chat (permissions, ban, or channel access).' :
            response.status === 429 ? 'Twitch rate limit reached. Pause and use Reconnect later.' : `Twitch API request failed (${response.status}).`);
          error.status = response.status;
          throw error;
        }
        return response.status === 204 ? null : response.json();
      }
    };
  };
})();
