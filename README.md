# CrossChat — milestone 3: shared local room

CrossChat aims to combine a streamer's Twitch and YouTube chats for streamers and viewers. This dependency-free Manifest V3 prototype demonstrates a shared conversation between paired pages in **one Chrome profile**. It does not read or post native platform chat, connect different computers, or use authentication/APIs.

## Load locally

1. Open `chrome://extensions` and enable **Developer mode**.
2. Select **Load unpacked**, then this folder containing `manifest.json`.
3. After any extension edits, click **Reload** on its extension card and refresh all test tabs.
4. Pin CrossChat through Chrome's Extensions menu (puzzle icon) to access its popup.

No npm install, build step, PHP server, or API keys are required.

## Pair a streamer's broadcasts

1. Open the streamer's Twitch channel and YouTube livestream in two tabs.
2. Click the CrossChat toolbar icon.
3. Paste full URLs into **Twitch channel URL** and **YouTube livestream URL**. Supported formats:
   - `https://www.twitch.tv/channel`
   - `https://www.youtube.com/watch?v=VIDEO_ID` or `https://www.youtube.com/live/VIDEO_ID`
   URL fields save as a draft as you type/paste. You can close the popup to copy the other URL, then reopen it; the first URL should still be there. Drafts do not change the active pair until you click Save pair.
4. Click **Save pair**. Both pages should show **Local shared room** and the same six sample messages.
5. Send from Twitch and check YouTube, then send from YouTube and check Twitch. Labels indicate which page sent each message.
6. Refresh either page: the shared history should remain.

One pair is active at a time. Saving a new pair switches the active room. Other channels/videos keep separate histories. Shared rooms start fresh rather than importing old page histories. **Unpair** restores separate histories; saving the same pair again restores its shared room. Changing the YouTube video ID creates a different room. Twitch channel names are normalized to lowercase.

The enable/disable toggle still controls panel visibility across tabs. Collapse the panel with the minus button to access content under it. Fullscreen video hides the panel.

## Architecture

- `manifest.json`: MV3 configuration, domain-scoped content scripts, popup, service worker, and only the `storage` permission.
- `src/mock-chat.js`: route detection, mock sample data, normalized message shape, and synchronous mock sending.
- `src/history.js`: storage adapter; versioned histories, validation, 200-message retention, and save confirmation before updating memory. Existing milestone-2 histories remain compatible.
- `src/rooms.js`: shared-room service; validates pair URLs, resolves a page to its room, and queues all reads/writes so two tabs cannot overwrite each other's sends.
- `src/background.js`: service worker; the single writer for histories and pairing. Validates message senders and derives platform labels from page URLs. Pair changes are accepted only from the extension popup.
- `src/room-client.js`: content-script provider; requests snapshots/sends and uses storage-change notifications to refresh paired tabs. Subscription cleanup and response sequencing prevent stale updates.
- `src/content.js`: page/panel lifecycle; detects navigation once per second and discards old loads after switching pages.
- `src/panel.js`: Shadow DOM UI; safe text rendering, keyboard isolation, live history rendering, compose form, save/error feedback, and collapse/expand.
- `src/popup.html`, `popup.css`, `popup.js`: enable toggle and manual stream pairing.
- `tests/prototype.test.cjs`: dependency-free unit/integration checks using Node's test runner and simulated Chrome messaging/storage.

The panel appends its own floating element and does not replace native chat or modify player layout. Shared message operations now go through the service worker rather than writing snapshots directly from tabs. Durable state is reloaded from storage for each operation, so worker restarts do not reset history. Chrome messaging uses asynchronous replies as documented in [Chrome message passing](https://developer.chrome.com/docs/extensions/develop/concepts/messaging).

The room service/client boundary can later connect to a Node.js backend and WebSockets. Cross-device room membership, identities, OAuth, moderation, official chat adapters, and any native cross-posting require future implementation and verification.

## Persistence and limits

- Pair configuration is saved as `roomPair:v1`; histories use `history:v1:...` in `chrome.storage.local`. No network backend is used. Uninstalling the extension clears its storage; see [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage).
- Each history keeps its latest 200 messages, including samples, with a 500-character input limit. There is no global cap, automatic expiration, or clear-history button yet. Quota/save errors keep the current draft for retry.
- History validation failures display an error and leave saved data untouched. Chat-message drafts, collapsed state, and scroll position are not persisted. Pairing URL drafts are saved synchronously in the extension popup's localStorage and cleared after successful Save pair or Unpair. Pair changes replace the visible log while preserving the current input text; review it before sending into a newly selected room.
- Queued sends use the room selected at submission; a room change before processing rejects the send rather than redirecting it silently. Automatic retries are not used, since a lost response could otherwise duplicate a saved message.
- Matching uses URLs, not verified streamer ownership or live status. Twitch channel pages may be offline, and YouTube watch pages may be recordings. Pair URLs must use the `www` hosts shown above. Shorts, embedded players, chat popouts, mobile subdomains, and Twitch video pages are outside this milestone.
- Everyone is labeled **You** because this is a local prototype without identities. Extension messages appear only in CrossChat and never in native Twitch/YouTube chat. Other viewers and browser profiles cannot see them.
- Incognito behavior depends on Chrome extension settings; use regular tabs in the same profile for this test.

## Browser checklist

- [ ] Reload the extension and refresh both tabs. Confirm no extension-card errors.
- [ ] Paste the first URL, click away to copy the second, and reopen the popup: the first URL remains. Repeat with the second URL. Save the pair.
- [ ] Save the pair: both pages show the shared-room notice and matching sample messages.
- [ ] Send a unique message from each platform: it appears once in both tabs with the correct origin label.
- [ ] Send quickly from both tabs: both messages remain in both tabs after refresh.
- [ ] Close/reopen tabs and restart Chrome: the pair and shared history return without duplicate samples.
- [ ] Open another channel/video: it stays separate. Navigate back via site links: the shared room returns, with only one panel.
- [ ] Unpair: separate histories return. Save the same pair: shared history returns. Save another pair: unrelated pages stay separate.
- [ ] Enter invalid URLs or swap Twitch/YouTube fields: pairing fails with a useful error and leaves the active pair intact.
- [ ] Toggle off/on: panels disappear/return across tabs and messages remain saved.
- [ ] Type `f`, `k`, `m`, spaces, arrow keys, Backspace, and paste inside the input: player shortcuts do not activate. Enter sends and Tab navigates. Player shortcuts still work outside the panel.
- [ ] Send `<img src=x onerror=alert(1)>`: it displays literally. Blank messages cannot send.
- [ ] Collapse/expand, resize, use native chat/player controls, and enter/exit fullscreen.

## Automated checks

With Node.js installed:

```powershell
node --test tests/prototype.test.cjs
node --check src/mock-chat.js
node --check src/history.js
node --check src/rooms.js
node --check src/background.js
node --check src/room-client.js
node --check src/content.js
node --check src/panel.js
node --check src/popup.js
```

Simulated messaging/storage tests do not verify Chrome permissions, extension lifecycle, or compatibility with live platform pages. Complete the browser checklist to verify those behaviors.
