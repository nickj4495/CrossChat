# CrossChat — milestone 1

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
- `src/panel.js`: DOM rendering, isolated Shadow DOM styles, local compose form, collapse/expand. User text is rendered with `textContent`.
- `src/content.js`: connects the provider to the panel; checks routes once per second to support navigation without full reloads; removes the panel on unsupported routes; hides it during fullscreen.
- `src/popup.html`, `popup.css`, `popup.js`: persistent global enable/disable setting using `chrome.storage.local`.
- `tests/prototype.test.cjs`: dependency-free Node checks of routes, mock provider, and manifest references.

The scripts load in manifest order and share a small namespace inside Chrome's isolated content-script environment. This avoids a bundler for the first milestone. Shadow DOM separates CSS from the host site. The panel appends its own floating element without replacing the native chat or changing player layout. No service worker is needed until background responsibilities exist.

A future backend can supply messages through the provider boundary. OAuth credentials, platform API contracts, identity linking, moderation, and cross-platform delivery remain future design work. Local sends currently use the platform of the page as their label; this does not represent a logged-in identity.

## Prototype limits

- Route detection does not verify live status: Twitch channel pages may be offline and YouTube watch pages may be recorded videos. YouTube Shorts, embedded players, popout chat, mobile subdomains, and Twitch video pages are outside this milestone.
- The floating panel covers part of the page while expanded. Collapse it with the minus button to access content underneath. Fullscreen video hides it.
- Messages are local to the current page. Refreshing or navigating to another channel/video resets them. Disabling and enabling preserves the current page's provider but resets the panel's collapsed state.
- Maximum 500 characters per message; only the latest 200 messages are retained. No automatic mock feed or actual viewer counts are simulated.
- Only the enable/disable preference persists; it is shared across tabs. Incognito behavior depends on Chrome's extension settings.

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
- [ ] Navigate between videos/channels using site links: one panel remains, mock state resets on a new video/channel. Navigate home: panel disappears.
- [ ] Reload extension and refresh tabs after edits; inspect the extension card's Errors section and page DevTools console.

Run automated checks with Node.js installed:

```powershell
node --test tests/prototype.test.cjs
node --check src/mock-chat.js
node --check src/panel.js
node --check src/content.js
node --check src/popup.js
```

Automated logic checks do not establish compatibility with live Twitch/YouTube layouts. The browser checklist must be completed in Chrome.

