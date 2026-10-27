# YouTube read-only integration — setup and testing

This milestone implements an official YouTube Data API reader alongside Twitch. It uses Google OAuth through Chrome's Identity API, not page scraping or your Twitch credentials. Google sign-in and live reading are separate actions. Message sending remains a local demo; CrossChat does not post into either native chat.

Automated tests simulate Google OAuth/API responses and polling timers. Google's official API discovery document was checked for the endpoint and read-only scope. **Real Google sign-in and live chat delivery have not yet been verified with a configured project in Chrome.** Follow this guide to perform that verification.

## Create the Google OAuth client

1. Use a Chrome profile signed in to your Google account. The `chrome.identity.getAuthToken` flow uses Chrome's Google account authorization.
2. Open [Google Cloud Console](https://console.cloud.google.com/) and create/select a project for CrossChat.
3. In the API Library, find **YouTube Data API v3** and enable it for that project.
4. Configure your project's Google OAuth consent settings (Google Auth Platform). Supply the app information Google requires. If using an external app in **Testing**, add the Google accounts that will test it as test users. Add the read-only scope `https://www.googleapis.com/auth/youtube.readonly` to the requested data access.
5. At `chrome://extensions`, reload CrossChat and open its toolbar popup. Expand **Read YouTube chat → First-time Google setup** and copy the displayed **Extension ID**.
6. In Google Auth Platform's Clients section, create an OAuth client with application type **Chrome Extension**. Enter the copied extension ID in **Item ID**, name the client, and create it. This is not a Web application client and does not use Twitch's callback URL.
7. Copy the public Client ID, which ends in `.apps.googleusercontent.com`.
8. In this project's `manifest.json`, replace only the placeholder under `oauth2.client_id`:

   ```json
   "oauth2": {
     "client_id": "YOUR_ACTUAL_GOOGLE_CLIENT_ID.apps.googleusercontent.com",
     "scopes": ["https://www.googleapis.com/auth/youtube.readonly"]
   }
   ```

   Use the real complete ID. No client secret or API key is needed. Keep the existing scope as shown. A public Client ID is configuration, not a credential to hide; never put access tokens or client secrets in this file.
9. Reload CrossChat at `chrome://extensions` and refresh the test stream tabs. Reloading also clears the extension's Twitch session, so sign in to Twitch again if testing both platforms.
10. Open **Read YouTube chat**, click **Sign in to Google**, and approve read-only YouTube access. Reopen the toolbar popup if it closed when Google's consent window opened.

Chrome requires the client ID in the manifest for `getAuthToken`; it cannot be supplied at runtime like our Twitch Client ID. See [Chrome OAuth setup](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth) and [OAuth manifest configuration](https://developer.chrome.com/docs/extensions/reference/manifest/oauth2).

If moving/reinstalling the unpacked extension changes its extension ID, the Google OAuth client must match the new Item ID. A friend testing a different unpacked extension ID needs a matching client configuration. Stable store distribution can simplify this later.

## Start a combined Twitch/YouTube room

1. Save a room containing the Twitch channel(s) and YouTube live video(s) you want. YouTube sources must be currently active streams with enabled and accessible live chat. Recordings, scheduled broadcasts without active chat, and disabled chats are reported as unavailable.
2. Sign in to Twitch for its live feed. Sign in to Google separately for YouTube.
3. Under **Read YouTube chat**, click **Start reading**. Sign-in alone does not consume chat-polling quota.
4. Open any room page (Twitch or YouTube). New native YouTube text messages should appear alongside Twitch messages with their actual authors and source labels. The YouTube label says **Live YouTube message · received this session**.
5. Use **Stop** to stop only YouTube reading. **Disconnect** also clears the extension's Google token cache/connection state. Neither action stops Twitch. **Enable CrossChat** off stops both readers and hides the panels.

You do not need to keep all source tabs open. Source filtering remains a local panel preference and does not stop a source's API reading. Stop pauses chat polling; disconnect also removes the local Google connection. Broadcast-status metadata lookups in a visible room UI use separate API quota even when chat polling is stopped. See [Room workspace](room-workspace.md).

## Polling, continuation, and quota

This prototype uses `videos.list` to resolve source videos to their `liveStreamingDetails.activeLiveChatId`, then `liveChatMessages.list` for chat pages. It requests read-only access, confirmed against Google's official [YouTube API discovery document](https://www.googleapis.com/discovery/v1/apis/youtube/v3/rest). No write endpoints are exposed.

Each source waits at least 15 seconds **after a response**, or longer if `pollingIntervalMillis` requires it. This introduces noticeable latency compared with Twitch's WebSocket feed. Continuation tokens avoid repeatedly loading the initial page. On the first request, YouTube may return recent messages. Duplicate message IDs are suppressed.

Google documents a cost of **5 quota units per chat-list request**. Lookup calls also use quota. A run stops after **30 minutes or 300 chat requests across all selected YouTube sources**, whichever comes first. The request counter and per-source continuation/deadline data are kept in extension session storage so ordinary worker restarts do not reset those safeguards. If a request was interrupted, a conservative retry deadline is retained. These are per-run safeguards, not the project's authoritative daily quota accounting.

Clicking Start reading explicitly starts a new run and resets that run's counter. More sources spend the request budget faster. Shared project quota is also used by other instances/apps using that project. Quota/rate errors stop the affected source and show an error; check Google Cloud before retrying. This implementation does not request or purchase more quota.

Google recommends [streamList](https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages/streamList) for efficient server streaming. Its [published streaming demo](https://developers.google.com/youtube/data/live/streaming-live-chat) uses gRPC. That is a future backend/transport milestone; this vanilla-JavaScript prototype uses the documented [list endpoint](https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages/list) and its timing contract instead of inventing a browser streaming endpoint.

## Data, moderation, and lifecycle

- Chrome manages Google access tokens. The extension stores only a connected flag in `chrome.storage.session`; token values are used inside the worker for Authorization headers and are not returned to content scripts, placed in request URLs, written to project files, or saved in message histories.
- Noninteractive token access is used only after explicit sign-in. The cache handles expiry; unauthorized responses clear the connection and require sign-in. Google authorization is independent of Twitch authorization.
- Disconnect clears local cached Google tokens for this extension; it does not sign you out of Chrome or revoke the app's Google account grant. Remove that grant in Google Account's third-party access settings if desired.
- Reloading/disabling the extension or restarting Chrome clears the extension session flags/run state. Connect/start again; Chrome may reuse a previously approved grant rather than showing consent again. Saved rooms, local demo history, and the manifest's public Client ID remain.
- YouTube uses a separate in-memory buffer of up to 200 messages. The panel merges native Twitch, native YouTube, and local demo messages and shows at most the newest 200 combined. Native messages are not saved as durable demo history.
- Deletion events, tombstones, and user-ban events remove relevant retained native messages. Delayed older messages cannot restore deleted/banned text. Moderation is seen on polling responses, so removals can be delayed. Source/API errors clear that source's retained text because moderation may have been missed during a gap.
- Stop, disconnect, disable, and source-list changes cancel pending requests and clear the native YouTube buffer. Changing sources requires another explicit Start. Ordinary worker recovery resumes an active run from session continuation data but begins with an empty native buffer.
- Standard text messages and Unicode emoji are supported. YouTube custom emote images, Super Chats, stickers, memberships, polls, and other rich event rendering remain future work. Twitch's native emote rendering stays intact.

The source schema and moderation events are documented in [YouTube liveChatMessages](https://developers.google.com/youtube/data/live/reference/rest/v3/liveChatMessages).

## Browser checklist

- [ ] Reload the extension and verify Google setup does not prevent Twitch sign-in/emote rendering or existing local room behavior.
- [ ] Configure the Chrome Extension OAuth client with the exact extension ID and enable YouTube Data API v3. Sign in as a permitted test user.
- [ ] Sign-in alone leaves reading off. Click Start reading and confirm source status changes to receiving updates.
- [ ] Use one active Twitch stream and one active YouTube stream in a room. Confirm real messages from both appear in the same panel, with correct authors/source labels, on either platform's page.
- [ ] Close other source tabs and verify new messages still arrive. Allow at least 15 seconds for YouTube updates.
- [ ] Refresh the panel page: no duplicate copies of already-buffered IDs. Filter a source off/on; messages return correctly.
- [ ] Send a local demo message: it remains labeled as local and is not posted into either native platform.
- [ ] Where you can moderate a test stream, delete/ban a test message/user and verify retained native messages disappear after an API update.
- [ ] Try an offline/disabled-chat video: see its source error while other accessible sources remain usable.
- [ ] Stop YouTube: its requests/messages stop while Twitch continues. Changing room sources or disabling CrossChat requires explicitly starting YouTube again.
- [ ] Reach the session limit or Stop manually; reading does not restart merely by reopening the popup. Restart Chrome/reload and check the documented sign-in/session behavior.
- [ ] Verify native video controls, typing isolation, collapse/expand, fullscreen recovery, and existing popup URL drafts still work.

## Automated checks

```powershell
node --test
Get-ChildItem src -Filter *.js | ForEach-Object { node --check $_.FullName }
```

Tests cover mocked Google consent/identity, safe token use, input normalization, moderation/tombstones, cursor/timing rules, request/time budgets, stale replies, worker recovery, popup actions, and mixed-provider snapshots. Real Google OAuth and API access require your project setup and browser verification.
