# Twitch read-only integration — setup and validation

The extension now implements OAuth sign-in and an EventSub WebSocket reader for the Twitch channels in your active room. YouTube ingestion and native chat posting remain unimplemented. Local demo sending continues separately.

Automated tests use fake OAuth/API/WebSocket responses. The public Twitch WebSocket endpoint has also been checked for a real `session_welcome`, without credentials or subscriptions. This does **not** verify real sign-in or authorized chat delivery. Complete the setup and browser checklist below to test those.

## First-time setup in Chrome

1. At `chrome://extensions`, reload CrossChat and refresh your stream tabs. New permissions cover Chrome identity, alarms, and requests to Twitch's identity/API hosts. Chrome 116 or newer is required.
2. Open the CrossChat toolbar popup. Under **Read Twitch chat**, expand **First-time Twitch setup**.
3. Click the **Callback URL** field to select it and copy the exact URL. It looks like `https://YOUR_EXTENSION_ID.chromiumapp.org/twitch`. Do not use this placeholder; use the actual value displayed by your extension.
4. Visit [Twitch Developer Console → Applications](https://dev.twitch.tv/console/apps) and choose **Register Your Application**. Twitch requires a verified account and two-factor authentication for app registration.
5. Give the app an available name, add the exact copied value as an **OAuth Redirect URL**, select a suitable chat-tool category from Twitch's current choices, and create the app.
6. Open **Manage** for the registered app and copy its **Client ID**.
7. Paste that public Client ID into CrossChat's **Public Twitch Client ID** field. Do not paste a client secret or token. You do not need to generate a secret for this implementation.
8. Click **Sign in to Twitch**. Complete the Twitch window and consent to read-chat access. The toolbar popup may close when sign-in opens; reopen it afterward to see the result.
9. Save a CrossChat room containing at least two sources, including the Twitch channels you want to read. An all-Twitch room is supported. A mixed room can show incoming Twitch messages while YouTube sources remain local demos.
10. Open one of the room's pages and watch for **Reading N/N Twitch chats**. New native messages should appear labeled **Live Twitch message · received this session**, with their author and source channel. You do not need to keep the other channel tabs open.

Twitch documents app registration and public Client IDs in [Register Your App](https://dev.twitch.tv/docs/authentication/register-app/). This implementation uses the [implicit grant flow](https://dev.twitch.tv/docs/authentication/getting-tokens-oauth/#implicit-grant-flow) for a serverless browser client, requesting only `user:read:chat`. It does not request write permission or use a client secret.

The callback depends on Chrome's extension ID. Moving/reinstalling the unpacked extension may change that ID. If it changes, update the redirect in Twitch to the value the popup currently shows. Keep the project folder in place during development.

## Sign-in and tokens

- Sign-in uses `chrome.identity.launchWebAuthFlow`, a cryptographically random state, and exact callback origin/path/state verification. Twitch's `/validate` response must match the configured Client ID, identify a user, and grant read-chat scope.
- The Client ID is public and saved locally. Access tokens are stored only in `chrome.storage.session`, whose default access is restricted to trusted extension contexts. Tokens are never returned to content scripts or saved in message histories, project files, Git, or UI drafts.
- Session storage is cleared by browser restart, extension reload/update/disable, and uninstall. Sign in again after those events. Room configuration, public Client ID, and local demo histories remain in persistent storage unless uninstalled.
- Tokens are validated on worker startup and at least hourly while the extension runs; expiry checks occur through requests and a minute alarm. Expired/invalid tokens end live reading and require another sign-in. There is no implicit-flow refresh token.
- **Sign out** immediately stops reading, removes local session credentials, and attempts Twitch token revocation. If revocation cannot be confirmed, the popup says so; revoke the app through Twitch Settings → Connections if necessary.

Twitch requires startup/hourly validation in [Validating Tokens](https://dev.twitch.tv/docs/authentication/validate-tokens/). Chrome explains the callback mechanism in [Identity API](https://developer.chrome.com/docs/extensions/reference/api/identity).

## Live connection behavior

One background connection subscribes to four events per configured Twitch channel: messages, individual message deletion, channel chat clear, and user message clear. A channel's messages are accepted only after all four subscriptions succeed. Channels with failures appear in the popup/panel rather than being marked live.

Subscriptions are checked by ID, event type/version, reader ID, broadcaster ID, and channel login before events reach the adapter/buffer. Duplicate channel/message IDs are suppressed using a bounded cache. Text/emotes render as plain text. Badges, images, subscriber notifications, and historical backfill are outside this milestone.

Native messages use an in-memory 200-message buffer for the active room. They are not saved to disk. Refreshing a tab can show the current worker buffer; restarting/reloading the extension loses it. Sign-out, source-list changes, disable, manual Reconnect, ordinary connection loss, and revocation clear it. Clearing on connection loss avoids retaining messages whose moderator removals might have occurred during the gap. Local demo history remains durable and separate.

Twitch's server-driven reconnect flow overlaps the old/new socket and retains subscriptions. Other disconnects use backoff and create fresh subscriptions. Missing messages cannot be replayed. API lookup/subscription failures may require **Reconnect** after correcting the error. Reconnect attempts do not bypass access restrictions, bans, or rate limits.

The connection requests a 10-second keepalive interval and uses a watchdog. Browser WebSockets handle protocol ping/pong; the extension sends no application-level pings, which EventSub prohibits. Chrome 116+ can retain a worker receiving WebSocket activity within its inactivity window. See [Twitch WebSocket lifecycle](https://dev.twitch.tv/docs/eventsub/handling-websocket-events/) and [Chrome WebSocket workers](https://developer.chrome.com/docs/extensions/how-to/web-platform/websockets).

The signed-in session reads the saved room even if you close all stream tabs. Disable CrossChat or sign out to stop it. A service worker restart revalidates session credentials and reconnects when awakened by a panel/popup request or the health alarm. Revoked subscriptions pause the connection until authorization is restored or you reconnect.

## Browser testing checklist

- [ ] Register the app with the exact displayed callback. Sign in and confirm the correct login appears as read-only.
- [ ] Cancel/decline sign-in: get a readable error and no newly signed-in session. Reopen the popup after sign-in closes it; status should load correctly.
- [ ] Save two active Twitch channels in a room. Confirm both show live status and messages from both arrive in one CrossChat panel with correct authors/source labels.
- [ ] Close the second stream tab: its new chat messages should still arrive in the first panel.
- [ ] Use the same room on a YouTube page: incoming Twitch messages should appear there, with YouTube clearly remaining demo-only.
- [ ] Send a CrossChat demo message: it appears in your local room only, stays labeled as a demo, and does not post into native Twitch chat.
- [ ] Hide/show sources, refresh tabs, navigate, collapse/expand, and test player-keyboard isolation.
- [ ] Where you can moderate a test channel, delete a test message, clear a user's messages, and clear chat. Verify the corresponding native messages disappear from CrossChat without affecting other sources or local demo messages.
- [ ] Try a nonexistent or inaccessible channel: verify the error is visible and other successfully subscribed sources still work.
- [ ] Disable CrossChat: reading stops. Re-enable: it starts a fresh native buffer. Disconnect/change the room: old sources stop supplying messages.
- [ ] Temporarily interrupt connectivity, restore it, and use Reconnect if needed. Verify clear gap/error status and no duplicate copies of retained message IDs.
- [ ] Sign out: reading stops and the login clears. Restart Chrome or reload the extension: sign-in is required again; the public Client ID, room, and local demo history remain.
- [ ] Revoke authorization via Twitch Settings → Connections. Verify reading stops when Twitch reports revocation or validation detects it.

## Automated checks

```powershell
node --test tests/prototype.test.cjs tests/twitch-eventsub.test.cjs tests/twitch-auth.test.cjs tests/twitch-live.test.cjs tests/twitch-ui.test.cjs
Get-ChildItem src -Filter *.js | ForEach-Object { node --check $_.FullName }
```

Fixtures and simulated services test behavior without tokens. They do not replace a real Chrome OAuth/API/subscription test with your registered application.
