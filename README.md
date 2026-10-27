# CrossChat — milestone 6: Twitch emote images

CrossChat aims to combine live chats for streamers and viewers. This dependency-free Manifest V3 extension supports a shared local room across **2–10 Twitch channels and/or YouTube videos in one Chrome profile**. It implements Twitch OAuth and read-only EventSub chat for the room's Twitch sources, now with inline native Twitch emote images. YouTube and message sending remain local demos. Cross-device CrossChat rooms are not implemented.

## Load locally

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked**, then this folder containing `manifest.json`.
3. After extension edits, click **Reload** on its card and refresh existing test tabs.
4. Pin CrossChat through Chrome's Extensions menu (puzzle icon) to access the popup.

No build step, npm install, or server is required. Local demos need no credentials. For real Twitch reading, register a Twitch app and enter its public Client ID in the popup; no client secret is used. Follow [Twitch setup and testing](docs/twitch-integration.md).

## Create a multi-source room

1. Open the CrossChat popup and paste **one URL per line** into **Stream URLs**, for example:

   ```text
   https://www.twitch.tv/channel_one
   https://www.twitch.tv/channel_two
   https://www.youtube.com/watch?v=VIDEO_ID
   ```

2. Click **Save room**. You may use all Twitch channels, all YouTube videos, or a mix. Enter 2–10 distinct sources. Duplicate channel names and alternative URLs for the same YouTube video are rejected.
3. Open any listed page. It should show **Local shared room** with the source count and sample messages labeled by platform and channel/video.
4. Open another listed source in a second tab and send a message from each page. Both panels should update. Messages carry the origin of the page where they were sent; this is a demo label, not authenticated identity.
5. Expand **Sources** above the message log and uncheck sources to hide their messages. Recheck them to restore the messages.

To add a source, add a URL line. To remove one, delete its line. Then click **Save room** again. URL drafts survive popup closure, so you can copy URLs one at a time. Draft changes do not affect the active room until saved.

Only one source list is active at a time. Other pages keep separate histories. You can watch one video and close the other tabs. After Twitch sign-in, the background connection reads all selected Twitch channels without keeping their pages open. Without sign-in, only saved samples/local demos appear. To generate a local demo message from another source, open its page and send through CrossChat there.

## History and compatibility

- The same source set identifies the same room regardless of URL order. Changing the source set selects a separate history rather than merging or deleting earlier histories. Restore the previous set to return to its saved conversation.
- Existing Twitch+YouTube pairs and their histories are preserved. Legacy pair drafts migrate to the new URL list. Old messages gain source labels when their origin is unambiguous; otherwise they appear as demo samples rather than guessing a channel.
- **Disconnect room** restores each page's separate saved history. It does not delete room history.
- Each history keeps its latest 200 messages, with a 500-character input limit. New room samples cover every configured source. Refreshing restores timestamps and history without adding new samples.
- Source filters are per panel and remain active as new messages arrive. They do not delete messages, stop sends, or affect other tabs. Filters reset after refresh, panel recreation, or switching rooms. Chat drafts and scroll position are not persisted.
- Native Twitch messages have a separate, temporary 200-message worker buffer; see the Twitch guide for its clearing/reconnect behavior. The enable toggle controls panel visibility and pauses live reading across tabs. Collapse with the minus button to reach content under the panel; fullscreen video hides it.

## Architecture

- `manifest.json`: MV3 (Chrome 116+), scoped content scripts, popup, service worker, storage/identity/alarms permissions, and host access limited to Twitch identity/API endpoints.
- `src/mock-chat.js`: route detection, normalized mock messages, and optional source metadata (`sourceKey`, `sourceLabel`).
- `src/history.js`: validated versioned history storage, retention, and save confirmation before memory is updated.
- `src/rooms.js`: validates/canonicalizes source lists, identifies rooms, resolves page membership, decorates legacy messages, and serializes reads/writes to avoid conflicting sends from different tabs.
- `src/twitch-auth.js`: browser OAuth, verified callbacks, session-only tokens, validation, revocation, and constrained API requests.
- `src/twitch-eventsub.js`, `twitch-buffer.js`, `twitch-live.js`: event normalization, bounded native-message buffer, moderation, subscription checks, reconnects, and multi-source connection status.
- `src/twitch-emotes.js`: shared fragment validation and safe text/image rendering, with reduced-motion support and readable image-error fallback.
- `src/twitch-ui.js`: popup setup/sign-in/sign-out/reconnect controls.
- `src/background.js`: single-writer service worker. Validates senders, accepts room changes only from the popup, and derives origin labels from the sending page URL.
- `src/room-client.js`: message/snapshot requests and live storage-change subscriptions with stale-response protection and cleanup.
- `src/content.js`: navigation and panel lifecycle; guarded recovery checks start before initial rendering. Rechecks removal, fullscreen, visibility, and page restoration.
- `src/panel.js`: isolated Shadow DOM UI, source labels/filters, safe text rendering, keyboard isolation, local sends, save/error feedback, collapse/expand.
- `src/popup.html`, `popup.css`, `popup.js`: enable toggle and multi-line source editor with synchronous extension-page draft storage.
- `tests/prototype.test.cjs`: dependency-free Node tests, including simulated Chrome messaging/storage and UI checks.

The background service provides a single place to coordinate room changes and sends. Durable state is reloaded from storage for each operation, so worker restarts preserve it. Messages use asynchronous replies as documented in [Chrome message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).

A later backend can implement shared rooms across computers. Twitch read-only OAuth/EventSub ingestion is implemented, with simulated-service coverage. Live Twitch reading has been reported working in Chrome. Emote rendering has automated coverage and CDN endpoint checks but still needs browser verification with real messages. YouTube ingestion, CrossChat identities, streamer ownership verification, native cross-posting, and cross-device delivery remain future work.

## Prototype limits

- Storage uses `roomPair:v1` (now with a source list) and `history:v1:...` keys in `chrome.storage.local`. Pair URL drafts use extension-page localStorage. There is no global history cap, automatic expiration, or clear-history button. Uninstalling clears local extension storage; see [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage).
- Save failures keep the current draft for retry. Invalid stored histories are left untouched. A queued send rejects if its selected room changed before processing. No automatic send retries are used, since a lost response could otherwise duplicate a message.
- URL matching does not verify streamer ownership or live status. Twitch channels may be offline and YouTube videos may be recordings. YouTube source labels use video IDs because no metadata API is connected.
- Supported URLs use `https://www.twitch.tv/CHANNEL`, `https://www.youtube.com/watch?v=ID`, or `https://www.youtube.com/live/ID`. Mobile subdomains, Shorts, embedded players, chat popouts, and Twitch video pages are outside this milestone.
- Local demo sends are labeled **You**; native Twitch messages show their actual author. CrossChat sends do not enter native Twitch/YouTube chat, and other viewers/profiles cannot see your local demo sends. Use regular tabs in the same Chrome profile for testing.

## Browser checklist

- [ ] Reload the extension and refresh test tabs. Confirm no extension errors.
- [ ] Verify an existing two-source room still restores its messages.
- [ ] Save three Twitch URLs: all three pages show the same room and correctly labeled samples.
- [ ] Send quickly from each page: all messages appear once in every room tab with their source labels, including after refresh.
- [ ] Try a mixed Twitch/YouTube room and an all-YouTube room.
- [ ] Hide one source via **Sources**: its messages disappear only in that panel. Send from the hidden source in another tab: it remains hidden until rechecked.
- [ ] Hide all sources: see the empty-filter message. Restore them: history returns.
- [ ] Add/remove a URL and save: the active source set changes. Restore the original set: its earlier history returns. Reordering URLs does not reset history.
- [ ] Try duplicate URLs, invalid URLs, fewer than 2, or more than 10 sources: get an error while the active room stays unchanged.
- [ ] Paste a URL, close/reopen the popup to copy another: the draft survives. Disconnect the room: separate page histories return.
- [ ] Check toggle, collapse/expand, site navigation, Back/Forward, tab switching, and fullscreen recovery. The extension itself being reloaded still requires refreshing old tabs.
- [ ] Type `f`, `k`, `m`, spaces, and arrows in CrossChat: no player shortcuts. Enter sends, Tab navigates, and native player/chat controls work outside the panel.
- [ ] Send `<img src=x onerror=alert(1)>`: it displays literally. Blank messages cannot send.

## Automated checks

With Node.js installed:

```powershell
node --test tests/prototype.test.cjs tests/twitch-eventsub.test.cjs tests/twitch-auth.test.cjs tests/twitch-live.test.cjs tests/twitch-ui.test.cjs tests/twitch-emotes.test.cjs
Get-ChildItem src -Filter *.js | ForEach-Object { node --check $_.FullName }
```

Simulated messaging/storage/UI tests do not establish Chrome extension lifecycle or live platform compatibility. Complete the browser checklist for those behaviors.

For Twitch app registration, sign-in setup, current verification limits, and live-chat browser checks, see [docs/twitch-integration.md](docs/twitch-integration.md).
