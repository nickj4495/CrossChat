(() => {
  const app = globalThis.CrossChat = globalThis.CrossChat || {};
  const scope = 'https://www.googleapis.com/auth/youtube.readonly';
  app.createYouTubeAuth = ({ identity, session, manifest, fetcher = fetch }) => {
    let generation = 0;
    let busy = false;
    const key = 'youtubeAuth:v1';
    const configured = () => {
      if (identity?.crossChatPortable) return true;
      const id = manifest().oauth2?.client_id || '';
      return id.endsWith('.apps.googleusercontent.com') && !/YOUR_|REPLACE_/i.test(id);
    };
    const clear = async () => { generation++; await session.remove(key); };
    const token = async interactive => {
      if (!configured()) throw new Error('Configure the Google Chrome Extension OAuth Client ID in manifest.json first. See docs/youtube-integration.md.');
      let result;
      try { result = await identity.getAuthToken({ interactive, scopes: [scope], enableGranularPermissions: true }); }
      catch (error) { throw new Error(identity?.crossChatPortable ? error.message : interactive ? 'Google sign-in was cancelled or failed. Check the OAuth client, extension ID, consent setup, and Chrome profile sign-in.' : 'Google authorization is unavailable. Sign in to YouTube again.'); }
      if (!result?.token || result.grantedScopes && !result.grantedScopes.includes(scope)) {
        if (result?.token) await identity.removeCachedAuthToken({ token: result.token });
        throw new Error('Google did not grant YouTube read-only permission.');
      }
      return result.token;
    };
    const credentials = async () => {
      const expected = generation;
      const saved = (await session.get(key))[key];
      if (!saved?.active) return null;
      try {
        const accessToken = await token(false);
        if (expected !== generation) return null;
        return accessToken;
      } catch (error) { if (expected === generation) await clear(); throw error; }
    };
    return {
      // Background-only transport dependency. Never expose this through RPC.
      async streamToken(refresh = false) {
        let accessToken = await credentials();
        if (!accessToken) throw new Error('Sign in to YouTube first.');
        if (refresh && !identity?.crossChatPortable) {
          await identity.removeCachedAuthToken({ token: accessToken });
          accessToken = await credentials();
          if (!accessToken) throw new Error('Sign in to YouTube again.');
        }
        return accessToken;
      },
      async state() {
        return { configured: configured(), extensionId: manifest().extensionId,
          portable: Boolean(identity?.crossChatPortable),
          connected: Boolean((await session.get(key))[key]?.active), signingIn: busy };
      },
      async signIn() {
        if (busy) throw new Error('Google sign-in is already open.');
        busy = true;
        const expected = ++generation;
        try {
          await token(true);
          if (expected !== generation) throw new Error('Google sign-in was cancelled.');
          await session.set({ [key]: { active: true } });
          return { connected: true };
        } finally { busy = false; }
      },
      async signOut() {
        await clear();
        // Chrome owns the token cache. Removing this extension's cached tokens
        // does not sign the user out of Google/Chrome or affect Twitch's flow.
        await identity.clearAllCachedAuthTokens();
        return { connected: false };
      },
      async api(resource, params, signal) {
        if (!['videos', 'liveChat/messages'].includes(resource)) throw new Error('Unsupported YouTube API request.');
        const accessToken = await credentials();
        if (!accessToken) throw new Error('Sign in to YouTube to read live chat.');
        const url = new URL(`https://www.googleapis.com/youtube/v3/${resource}`);
        url.search = new URLSearchParams(params);
        let response;
        try {
          response = await fetcher(url.href, { headers: { Authorization: `Bearer ${accessToken}` },
            signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000), redirect: 'error' });
        } catch (error) {
          if (signal?.aborted) throw new Error('YouTube reading stopped.');
          throw new Error('Could not reach YouTube. Check your connection, then start reading again.');
        }
        if (response.status === 401) {
          await identity.removeCachedAuthToken({ token: accessToken });
          await clear();
          throw new Error('Google authorization expired or was revoked. Sign in again.');
        }
        if (!response.ok) {
          let reason = '';
          try { reason = (await response.json()).error?.errors?.[0]?.reason || ''; } catch { /* Use a safe status error. */ }
          const known = {
            quotaExceeded: 'YouTube project quota is exhausted. Check Google Cloud quota before retrying.',
            dailyLimitExceeded: 'YouTube project daily quota is exhausted.',
            rateLimitExceeded: 'YouTube rate limit reached. Wait before starting again.',
            liveChatDisabled: 'Live chat is disabled for this video.',
            liveChatEnded: 'This YouTube live chat has ended.',
            liveChatNotFound: 'This YouTube live chat could not be found.',
            accessNotConfigured: 'Enable YouTube Data API v3 in your Google Cloud project.',
            forbidden: 'Google denied access to this YouTube chat.'
          };
          throw new Error(known[reason] || `YouTube API request failed (${response.status}). Check your Google project and chat access.`);
        }
        return response.json();
      }
    };
  };
})();
