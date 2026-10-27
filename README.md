# CrossChat — milestone 2: local history

A dependency-free Chrome Manifest V3 extension with mock Twitch and YouTube chat. No build step, backend, authentication, API keys, network requests, or real chat integration.

## Load in Chrome

1. Open `chrome://extensions`.
2. Turn on **Developer mode** in the upper-right corner.
3. Choose **Load unpacked** and select this CrossChat folder (the one containing `manifest.json`).
4. Refresh any Twitch or YouTube tabs that were already open.
5. Open `https://www.twitch.tv/CHANNEL_NAME` or a YouTube livestream at `https://www.youtube.com/watch?v=VIDEO_ID`.
6. Look for CrossChat at the bottom right. Six sample messages should appear with Twitch/YouTube labels.
7. Use Chrome's Extensions menu (puzzle icon) to pin CrossChat. Click its icon to enable or disable the panel across tabs.

After editing extension files, click **Reload** on its card at `chrome://extensions`, then refresh your test tabs. No PHP server or npm install is needed.

## Architecture

- `manifest.json`: MV3 configuration, domain-scoped content scripts, and storage permission.
- `src/mock-chat.js`: normalized message objects (`platform`, `author`, `text`, `time`, `local`), route detection, and mock provider. Replace the provider boundary with a network adapter in a later milestone.
- `src/history.js`: asynchronous storage adapter; loads and validates per-channel/video history, queues writes within a provider, and confirms saves before updating memory.
- `src/panel.js`: DOM rendering, isolated Shadow DOM styles, local compose form, loading/save feedback, collapse/expand. User text is rendered with `textContent`.
- `src/content.js`: loads the persistent provider and connects it to the panel; checks routes once per second, rejects stale loads after navigation, removes the panel on unsupported routes, and hides it during fullscreen.
- `src/popup.html`, `popup.css`, `popup.js`: persistent global enable/disable setting using `chrome.storage.local`.
- `tests/prototype.test.cjs`: dependency-free Node checks of routes, mock provider, manifest references, restoration, isolation, write failures/retries, retention, and invalid saved data.

The scripts load in manifest order and share a small namespace inside Chrome's isolated content-script environment. This avoids a bundler for the first milestone. Shadow DOM separates CSS from the host site. The panel appends its own floating element without replacing the native chat or changing player layout. No service worker is needed until background responsibilities exist.

A future backend can supply messages through the provider boundary. OAuth credentials, platform API contracts, identity linking, moderation, and cross-platform delivery remain future design work. Local sends currently use the platform of the page as their label; this does not represent a logged-in identity.

## Prototype limits

- Route detection does not verify live status: Twitch channel pages may be offline and YouTube watch pages may be recorded videos. YouTube Shorts, embedded players, popout chat, mobile subdomains, and Twitch video pages are outside this milestone.
- The floating panel covers part of the page while expanded. Collapse it with the minus button to access content underneath. Fullscreen video hides it.
- Messages are stored on this Chrome profile per Twitch channel or YouTube video, including sample messages and timestamps. Refreshing or returning to a channel restores its saved history. Disabling and enabling keeps history but resets the panel's collapsed state. Draft input text is not persisted.
- Maximum 500 characters per message; only the latest 200 messages are retained. No automatic mock feed or actual viewer counts are simulated.
- The enable/disable preference is shared across tabs. History does not synchronize between already open tabs: simultaneous sends to the same channel/video use the last saved snapshot. Prefer one tab per channel for this milestone. Incognito behavior depends on Chrome's extension settings.
- History uses `chrome.storage.local` under versioned keys such as `history:v1:twitch:channel`. No new permissions are requested. Uninstalling the extension clears this storage. There is no automatic expiration, global history cap, or clear-history button yet; quota/write errors leave the draft in the input for retry. Invalid saved histories display a load error and are left untouched. See [Chrome storage documentation](https://developer.chrome.com/docs/extensions/reference/api/storage).

## Testing checklist

- [ ] Load unpacked: Chrome shows no manifest or extension errors.
- [ ] Open a Twitch channel and a YouTube livestream: each shows exactly one panel with both platform labels.
- [ ] Send with the button and with Enter: text appears once as **You**, with the current platform label and local-only notice.
- [ ] Type `f`, `k`, `m`, spaces, and arrow keys inside the message input: video fullscreen, playback, mute, and seeking must not change. Check typing, Backspace, paste, Tab, and Enter-to-send still work. Click back on the player and confirm its shortcuts still work.
- [ ] Blank/whitespace messages cannot send; input stops at 500 characters.
- [ ] Send `<img src=x onerror=alert(1)>`: it appears as literal text.
- [ ] Toggle off in the extension popup: panels disappear in both tabs; toggle on: they return. Refresh: preference persists.
- [ ] Collapse/expand; tab through input and buttons; resize the window.
- [ ] Play/pause, seek, use native chat, and enter/exit fullscreen. Confirm original controls still work and panel hides in fullscreen.
- [ ] Navigate between videos/channels using site links: one panel remains, each video/channel loads its own saved history. Navigate home: panel disappears.
- [ ] Send a unique message, refresh, and verify it returns once with its original timestamp. Navigate to a different channel/video, send another message, then return: each history stays separate.
- [ ] Close/reopen the tab and restart Chrome: saved history should return. Revisit multiple times and check the six initial mock messages are not duplicated.
- [ ] Reload extension and refresh tabs after edits; inspect the extension card's Errors section and page DevTools console.

Run automated checks with Node.js installed:

```powershell
node --test tests/prototype.test.cjs
node --check src/mock-chat.js
node --check src/history.js
node --check src/panel.js
node --check src/content.js
node --check src/popup.js
```

Automated logic checks do not establish compatibility with live Twitch/YouTube layouts. The browser checklist must be completed in Chrome.
