const { randomBytes, createHash } = require('node:crypto');
const scope = 'https://www.googleapis.com/auth/youtube.readonly';
function createOAuth({ config = {}, fetcher = fetch, now = Date.now } = {}) {
  const pending = new Map();
  function begin(provider, deliver, port, clientId) {
    const settings = config[provider];
    if (!['google', 'twitch'].includes(provider) || !settings?.clientId || !settings?.clientSecret) throw new Error(`Configure ${provider === 'google' ? 'Google Web application' : 'Twitch'} OAuth credentials in the backend environment. See docs/browser-support.md.`);
    if (provider === 'twitch' && clientId !== settings.clientId) throw new Error('The Twitch Client ID must match the backend configuration.');
    if (pending.size >= 20) throw new Error('Too many pending sign-ins. Wait and retry.');
    const state = randomBytes(32).toString('hex'); const verifier = randomBytes(32).toString('base64url');
    const redirectUri = `http://127.0.0.1:${port}/oauth/${provider}/callback`;
    const url = new URL(provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth' : 'https://id.twitch.tv/oauth2/authorize');
    url.search = new URLSearchParams({ client_id: settings.clientId, redirect_uri: redirectUri, response_type: 'code', state,
      scope: provider === 'google' ? scope : 'user:read:chat', ...(provider === 'google' ? {
        code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', access_type: 'online', prompt: 'consent'
      } : { force_verify: 'true' }) });
    const entry = { provider, deliver, verifier, redirectUri, settings, expiresAt: now() + 5 * 60000, abort: new AbortController() };
    const cleanup = () => { clearTimeout(entry.timer); entry.abort.abort(); pending.delete(state); };
    entry.timer = setTimeout(() => { cleanup(); deliver({ type: 'auth-error', message: 'Sign-in timed out. Try again.' }); }, 5 * 60000); entry.timer.unref();
    pending.set(state, entry);
    return { url: url.href, cancel: cleanup };
  }
  async function callback(url) {
    const state = url.searchParams.get('state'); const entry = pending.get(state);
    if (!entry || entry.expiresAt < now() || url.pathname !== `/oauth/${entry.provider}/callback`) return false;
    // Consume before any network request: a callback can never exchange twice.
    pending.delete(state); clearTimeout(entry.timer);
    try {
      if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error('declined');
      const body = new URLSearchParams({ client_id: entry.settings.clientId, client_secret: entry.settings.clientSecret,
        grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: entry.redirectUri,
        ...(entry.provider === 'google' ? { code_verifier: entry.verifier } : {}) });
      const response = await fetcher(entry.provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://id.twitch.tv/oauth2/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(), redirect: 'error',
        signal: AbortSignal.any([entry.abort.signal, AbortSignal.timeout(15000)]) });
      if (!response.ok) throw new Error('exchange');
      const data = await response.json();
      const scopes = Array.isArray(data.scope) ? data.scope : typeof data.scope === 'string' ? data.scope.split(' ') : [];
      const required = entry.provider === 'google' ? scope : 'user:read:chat';
      if (typeof data.access_token !== 'string' || data.access_token.length < 10 || data.token_type?.toLowerCase() !== 'bearer' ||
          !Number.isFinite(data.expires_in) || data.expires_in <= 0 || !scopes.includes(required)) throw new Error('grant');
      if (!entry.abort.signal.aborted) entry.deliver({ type: 'auth-token', token: data.access_token, expiresIn: Math.min(data.expires_in, 86400), scopes });
      return true;
    } catch {
      if (!entry.abort.signal.aborted) entry.deliver({ type: 'auth-error', message: 'Authorization was declined or failed. Check the backend OAuth client, redirect URL, and scopes.' });
      return true;
    }
  }
  return { begin, callback, close() { for (const entry of pending.values()) { clearTimeout(entry.timer); entry.abort.abort(); } pending.clear(); } };
}
module.exports = { createOAuth };
