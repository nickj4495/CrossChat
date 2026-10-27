# Local YouTube streaming backend

The extension now has two YouTube readers. **Direct polling** is the existing fallback. **Local streaming** uses Google's official [gRPC streaming service](https://developers.google.com/youtube/data/live/streaming-live-chat) through a Node.js process on your own computer. The extension still uses vanilla JavaScript and needs no build step.

```text
Google OAuth in Chrome → background worker
                              ↕ authenticated local WebSocket
                         Node.js backend
                              ↕ TLS + OAuth
                      YouTube StreamList gRPC
```

This removes CrossChat's intentional 15-second polling wait. It does not guarantee zero latency. Google documents a [5-unit cost per streamList call](https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages/streamList); video lookups and reconnect calls also use project quota. There is no 30-minute/300-request test cap in streaming mode. Those caps still apply to Direct polling.

## Start it locally

1. Install **Node.js 22 or later** if needed. Check with `node --version`.
2. Reload CrossChat at `chrome://extensions`, then refresh stream tabs. Reloading clears session connection settings, so reconnect Google/Twitch as needed.
3. Open **Connections → Read YouTube chat → First-time Google setup** and copy the displayed Extension ID. Keep your existing Google OAuth client configuration; no new client secret, API key, or Google redirect URL is needed.
4. Open a terminal in the CrossChat project folder:

   ```powershell
   cd backend
   npm ci
   npm start
   ```

5. Paste your extension ID when prompted. Leave the terminal running. It prints a new **connection key** and the listening address `127.0.0.1:47831`.
6. Open CrossChat **Connections → Read YouTube chat**. Choose **Local streaming (requires backend)**. Paste that connection key into **Local backend connection key** and click **Save reader settings**. Saving settings stops the previous reader; it does not start reading.
7. Sign in to Google if disconnected. Save a room containing an active YouTube live video, then click **Start reading**. Check the per-source status and open any room stream page.

The popup may close while you copy the terminal key. Copy it first, then reopen the popup, select Local streaming, paste, and save. You only paste one key; Google tokens are handled by the extension. Leave the key field blank when saving later to keep the session's existing key. Firefox/Safari use their full extension origin instead of a Chrome ID, and a backend OAuth flow for Google: see [Browser setup](browser-support.md).

For terminals without an interactive prompt, supply the extension ID before starting:

```powershell
$env:CROSSCHAT_EXTENSION_ID = 'your_32_character_extension_id'
npm start
```

To stop the backend, press **Ctrl+C** in its terminal. A restart creates a new connection key, so paste/save that new key before retrying. Extension reloads and Chrome restarts clear the saved key and selected transport (session storage); configure again. An ordinary service-worker restart can recover an active streaming run using saved cursors, beginning with an empty native-message buffer.

## Fallback and troubleshooting

- Backend unavailable: start it and check that the ID matches the popup. The extension retries with bounded backoff. Click Start reading to retry after the limit.
- Key mismatch: copy the latest terminal key. The extension refuses to send a Google token to a backend that cannot prove it knows that key.
- No active chat: check that the saved YouTube URL is a currently live, accessible video with chat enabled. Scheduled/offline videos do not become readable automatically; retry once live.
- Google authorization error: reconnect Google and Start reading again. The extension attempts one token renewal for an authorization failure and refreshes an ongoing connection after about 55 minutes.
- Quota/access error: check Google Cloud project quota/API access before restarting. A quota error does not trigger repeated automatic upstream retries.
- Prefer the old reader: choose **Direct polling (fallback)**, click **Save reader settings**, then **Start reading**. CrossChat never starts polling automatically after a streaming failure, so a failure cannot silently double reading or start spending polling quota.

Group/source visibility filters do not stop readers. Stop ends the selected YouTube reader. Disconnect also clears the extension's Google token cache. Disabling CrossChat or changing room membership stops streaming and requires another explicit Start. Twitch remains a separate reader.

## Scope and security

- This is a **local development backend**, not hosted infrastructure. It listens only on IPv4 loopback, not your LAN or the internet. Chrome's live feed has been reported working. Firefox has real extension/UI/local-handshake coverage; portable Google consent still needs a configured client/browser test. Safari requires Mac validation.
- The WebSocket upgrade requires the exact configured `chrome-extension://`, `moz-extension://`, or `safari-web-extension://` Origin, the loopback Host, and a mutual HMAC challenge using the random connection key. The key itself is not sent over the socket. Do not expose this port through a proxy/tunnel or deploy this prototype as a public service.
- Google access tokens travel only from the background worker to this local process and onward to Google over TLS. Tokens remain in RAM and are never logged, returned to content scripts, or saved in durable storage, files, or chat history. Chrome manages its token cache; Firefox/Safari use trusted session storage or background memory. Local WebSocket traffic is unencrypted loopback traffic; use only a backend/process you trust on your machine.
- The connection key and active-run/cursor data use Chrome session storage, inaccessible to content scripts by default. Popup/public state exposes only whether a key is configured, not its value. The extension uses a fixed local endpoint; content scripts cannot change transport, configure the backend, or request a token.
- The backend uses three pinned dependencies: `@grpc/grpc-js`, `@grpc/proto-loader`, and `ws`. The extension has no runtime dependencies. Identical token/chat subscriptions may share one upstream connection; unrelated tokens are isolated. Cross-viewer access rules and shared hosted rooms are future work.
- Sending is still a local demo. This milestone does not post to YouTube/Twitch or sync demo messages across computers.

## Message and moderation limits

Standard text uses the existing normalizer and bounded native buffer, so colors/groups/source labels work with either reader. Tombstones and user-ban events remove retained messages; reconnect/error gaps clear affected retained text to avoid keeping messages whose moderation may have been missed. Resume tokens reduce duplicate history delivery.

The published Google streaming schema currently does **not** declare REST's `messageDeletedEvent`/`messageDeletedDetails`. We preserve its published wire schema and do not promise immediate individual-message deletion parity with polling. Rich YouTube events/custom emote images are still not rendered. Revisit the schema and moderation coverage before public distribution.

## Verification and checklist

From the project root:

```powershell
npm --prefix backend ci
node --test
node scripts/browser-check.cjs
```

Automated checks include a real **local fixture gRPC server → protobuf client → WebSocket** path, OAuth metadata, cursor resume, source normalization, moderation event conversion, authorization isolation, origin/key rejection, disconnect cleanup, bounded reconnect/token renewal, worker recovery, and Chrome popup/scroll controls. The Chrome UI check uses offline fixtures, not real Google credentials. Live streaming against Google still needs your browser test; the existing polling feed was reported working by you.

- [ ] Start the backend, select/configure Local streaming, and Start reading with a live YouTube source.
- [ ] Confirm real new YouTube text arrives with the correct author/source alongside Twitch, without waiting for the old 15-second polling interval.
- [ ] Check colors, groups, source links, scroll-up anchoring, and Jump to newest.
- [ ] Close other source tabs; messages should continue arriving in the one room page you watch.
- [ ] Stop YouTube and confirm Twitch continues. A page refresh/popup reopen must not restart stopped reading.
- [ ] Stop/restart the backend; verify visible reconnect/key-mismatch feedback. Save its new key and Start again.
- [ ] Switch to Direct polling manually and verify the existing reader still works.
- [ ] Disable CrossChat or change room sources; reading should stop until explicitly started again.

Stop after this milestone for feedback. Hosted deployment and cross-device chat are separate work.
