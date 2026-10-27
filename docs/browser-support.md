# Firefox and Safari development builds

CrossChat now generates browser-specific manifests while keeping one shared UI/chat codebase. Chrome uses its MV3 service worker and existing Google Identity flow. Firefox/Safari use event-page background scripts. Firefox keeps its native Twitch Identity flow; Google uses the local backend's authorization-code flow with PKCE. Safari's Twitch fallback uses the backend's authorization-code flow. Secrets stay in the backend environment, never in extension files.

## Current verification

| Browser | What has been checked | Remaining live checks |
| --- | --- | --- |
| Chrome 116+ | Existing test suite and real Chrome offline UI checks; Twitch/Google streaming previously reported working | Recheck your signed-in live feeds after this update |
| Firefox desktop 140+ | Real Firefox 158.0.1 temporary add-on installation, background messaging, room storage, popup controls, exact-origin local WebSocket, and offline widget/scroll controls | Register Firefox's Twitch callback and test live Twitch; configure backend Google Web client and test real Google consent/YouTube reading |
| Safari on macOS | Shared source/build and simulated compatibility/OAuth tests | Convert in Xcode, review converter warnings, build/sign, enable website permissions, and test everything in real Safari on a Mac |

Safari is **prepared, not yet verified or released**. This Windows workspace cannot run Safari/Xcode. Target current desktop Safari (18+ for development testing); a supported minimum cannot be promised before Mac validation. iPhone/iPad Safari is outside this milestone: `127.0.0.1` on a phone does not reach a backend on your computer.

## Build packages

From the project root with Node.js 22+:

```powershell
node scripts/build-extension.cjs
```

This creates `dist/chrome`, `dist/firefox`, and `dist/safari`. Each contains only the manifest and extension assets. Backend code, dependencies, `.env`, test profiles and credentials are never copied. Generated folders are ignored by Git; rebuild after source changes. Source `manifest.json` remains the Chrome entry point.

## Load Firefox

1. Use a current Firefox desktop release, **140 or newer**. The Firefox 86 installation detected on this computer is too old for this build; update/install a current release before testing manually.
2. Build the packages as above.
3. Open `about:debugging#/runtime/this-firefox`.
4. Click **Load Temporary Add-on** and select **`dist/firefox/manifest.json`**, not the root Chrome manifest.
5. Pin/open CrossChat. Check add-on website permissions and allow Twitch/YouTube access if Firefox asks. Save a room and open its stream page.
6. To update, rebuild and click **Reload** on that temporary add-on; refresh stream tabs.

Temporary add-ons disappear when Firefox exits. Normal distribution requires Mozilla signing; generating this folder does not publish or sign it. Saved settings are browser/profile-specific, not shared with Chrome. Firefox's add-on ID is fixed as `crosschat@nickj4495.github.io` for a stable Identity callback; its internal `moz-extension://` origin is still installation-specific.

### Twitch in Firefox

In CrossChat Connections, expand **First-time Twitch setup**. Copy the exact **Callback URL** displayed there and add it to your existing Twitch application's OAuth Redirect URLs, keeping the Chrome callback too. Use that app's public Client ID in CrossChat and sign in. No backend/client secret is needed for Firefox's native Twitch sign-in.

### Local backend in Firefox/Safari

1. Open **Connections → Local backend connection setup** and copy the full **Extension origin**, such as `moz-extension://...` or `safari-web-extension://...`.
2. Stop the existing backend if running, restart it and paste that full origin at its prompt. A Chrome ID is also still accepted for Chrome. The server allows exactly one configured origin, not every extension or website. Switching browsers currently requires restarting/configuring the backend for the new origin.
3. Copy its new key. Under **Read YouTube chat**, choose Local streaming, paste the key and **Save reader settings**. This works even before Google sign-in. For a Safari Twitch-only room, save the backend key here too.

Firefox/Safari builds explicitly permit only the existing API hosts, Twitch's WebSocket host and the local loopback WebSocket in their connection CSP. This avoids Firefox's default upgrade of `ws://127.0.0.1` to TLS while leaving scripts restricted to packaged files. The backend still requires the exact extension Origin and mutual key proof; missing, website, wildcard and `null` origins are not accepted.

## Google sign-in outside Chrome

The existing Chrome Extension OAuth client cannot serve this new backend flow. **Leave it in the root manifest for Chrome.** For Firefox/Safari testing, create a separate client in the same Google Cloud project:

1. Enable YouTube Data API v3 and keep the read-only scope `https://www.googleapis.com/auth/youtube.readonly` in consent settings. Keep test users approved while the app is in Testing.
2. Create an OAuth client of type **Web application**.
3. Add this exact **Authorized redirect URI**: `http://127.0.0.1:47831/oauth/google/callback`.
4. Copy `backend/.env.example` to **`backend/.env`**. Set `CROSSCHAT_EXTENSION_ORIGIN`, `CROSSCHAT_GOOGLE_CLIENT_ID`, and `CROSSCHAT_GOOGLE_CLIENT_SECRET` using your actual values. This `.env` is ignored by Git. Never paste a client secret into the popup, manifest, source code, or a Git commit.
5. In the backend folder run:

   ```powershell
   npm ci
   npm run start:configured
   ```

6. Save the new connection key in CrossChat. Click **Sign in to Google**. Consent opens in a normal browser tab. On completion the local callback is processed; CrossChat closes its sign-in tab and the popup may need reopening.
7. Click **Start reading** with an active YouTube source. You can also choose Direct polling after sign-in, but the backend is still needed for the sign-in step outside Chrome.

The code flow uses server-generated state, an exact loopback callback, a single-use authorization code, and Google PKCE. Token exchange uses the backend-only secret. No Google refresh token is requested or retained. Access expires after approximately one hour: **sign in again when asked**. Chrome keeps its existing cache/renewal behavior. A future hosted service can add a secure refresh-token/session design.

## Safari on a Mac

For a packaged Safari Web Extension app, use Apple's packaging tool. Install Xcode and its command-line tools on the Mac, copy/clone this repo there, and build the packages. Then run from the project root:

```sh
xcrun safari-web-extension-packager dist/safari --project-location .artifacts/safari-project --app-name CrossChat
```

Older Xcode versions name this tool `safari-web-extension-converter`; use that name with the same arguments if the packager is unavailable. Open the generated Xcode project, select the macOS app target, review all warnings and signing settings, build and run it. Enable CrossChat in Safari's Extensions settings and allow access to Twitch/YouTube. For local unsigned testing or Safari versions offering temporary developer extensions, follow [Apple's current testing instructions](https://developer.apple.com/documentation/safariservices/building-and-testing-a-safari-web-extension). Signing/distribution and App Store review remain separate steps; no Safari app has been generated or signed in this Windows workspace.

Configure the backend on that same Mac with the Safari extension's displayed origin. Google uses the Web client above. Safari does not have Firefox's native Identity API, so Twitch also needs backend configuration:

- Add `http://127.0.0.1:47831/oauth/twitch/callback` to your Confidential Twitch application's Redirect URLs.
- Set `CROSSCHAT_TWITCH_CLIENT_ID` and `CROSSCHAT_TWITCH_CLIENT_SECRET` in `backend/.env` on the Mac. Use the matching public Client ID in CrossChat.
- Run `npm run start:configured`, save its new key, then use the normal Twitch sign-in button. The backend exchanges the authorization code; the extension still validates the token with Twitch before reading.

When native session storage is unavailable, the compatibility layer keeps credentials and the connection key only in background memory. An unloaded/restarted background page then requires setup/sign-in again. It deliberately never stores credentials in durable local storage. Safari local-network permissions, event-page lifetime and real provider redirects still need Mac testing.

## Testing

```powershell
node scripts/build-extension.cjs
npm --prefix backend ci
node --test
node scripts/browser-check.cjs
```

The optional real Firefox test uses geckodriver and Firefox, with a fresh temporary profile. Set `CROSSCHAT_FIREFOX` and `CROSSCHAT_GECKODRIVER` to their executable paths, then run `node scripts/firefox-check.cjs`. For isolated Windows binaries, `node scripts/fetch-test-firefox.cjs` downloads official Mozilla Firefox and geckodriver archives into ignored `.artifacts/browser-tools`; extract those archives as described by their vendors. The test uses no real account credentials and does not change your installed Firefox/profile.

- [ ] Save/open a room in Firefox; verify widget, labels, colors/groups, source links, sizes, local send, scroll-up and Jump to newest.
- [ ] Confirm typing `f`, `k`, `m`, spaces and Enter never invokes player shortcuts while editing CrossChat.
- [ ] Add Firefox's callback to Twitch, sign in, and verify live text/emotes and Stop/disconnect behavior.
- [ ] Configure Google Web OAuth in the backend, sign in, and confirm YouTube streaming alongside Twitch. Check visible errors for missing configuration/wrong key.
- [ ] Reload/disable the extension; stale connections should stop and native page controls should remain usable.
- [ ] On a Mac, convert/build Safari and repeat the full checklist, including consent, local-network access and background suspension/recovery.

References: [Mozilla background scripts](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background), [Identity](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/identity), [default CSP](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Content_Security_Policy), [temporary installation](https://extensionworkshop.com/documentation/develop/temporary-installation-in-firefox/), [Firefox data consent](https://extensionworkshop.com/documentation/develop/firefox-builtin-data-consent/), [Google server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [Twitch OAuth](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/), [Apple Safari extensions](https://developer.apple.com/safari/extensions/).
