# Room workspace, stream groups, and widget controls

This milestone adds a shared room workspace to the popup and widget. It does not change the room's member limit, native posting, or the YouTube polling safeguards.

## Streams, links, and broadcast status

Open the popup's **Your room** tab. Expand **Add or remove stream URLs** to edit the existing 2–10-source list. Each saved stream has a card with its link, status badge, color picker, and groups. Click its name to open the stream in a new tab.

In the widget, expand **Streams** to access the same stream links, statuses, group labels, include checkboxes, and color pickers. This list stays available even when you filter a source's chat out of view.

The badge describes the **broadcast**, not the chat connection:

- **Live**: the platform API currently reports a live video.
- **Offline**: a known Twitch channel has no live stream, or YouTube reports that the video is not an active/upcoming broadcast.
- **Upcoming**: YouTube reports a scheduled broadcast.
- **Unknown**: sign-in is missing, the source cannot be found/accessed, a lookup failed, or status is stale. Missing credentials and quota errors are never interpreted as Offline.

Hover a status badge for its reason/check time; an accessible label exposes the same information. You can still connect to an offline Twitch channel's chat. Conversely, a live video may have disabled/inaccessible chat. Expand **Chat connections** in the widget or use the popup's **Connections** tab to inspect reader status separately.

Lookups share a cached batch per platform, normally refreshed no more than once a minute while a visible popup/widget requests updates. The cache survives background-worker restarts. **Refresh status** allows a manual recheck, bounded to once per 10 seconds. Hidden widget tabs skip updates and catch up when visible again.

Twitch checks use authenticated Get Users/Get Streams calls. YouTube checks use `videos.list` metadata with the already-approved read-only Google permission. No new OAuth scope or host permission was added. YouTube metadata calls consume project quota even when YouTube **chat reading** is stopped; they are separate from the 300-chat-request budget. Stop/disconnect a platform or close the UI to avoid further status lookups. A Google grant is still needed for status if the API requires it; native site login alone does not authorize the extension.

Sources: [Twitch Get Streams](https://dev.twitch.tv/docs/api/reference/#get-streams), [YouTube video live status](https://developers.google.com/youtube/data/reference/rest/v3/videos#snippet.liveBroadcastContent).

## Groups and colors

On a stream card, enter comma-separated group names, such as `League of Legends, Proplay`, choose a color, and click **Save stream**. A stream can belong to several groups. Names are case-insensitive for filtering; the UI preserves their display spelling. Limits are 8 groups per stream, 20 groups per room, and 40 characters per group name.

Color and group form drafts survive popup closure. These edits take effect only after Save stream. Status updates do not replace a focused field or discard its draft. In the widget, changing a stream color applies immediately. Colors appear as a chat-row accent and source-label background; text remains readable independently of color.

Groups/colors are stored separately under `sourceSettings:v1`, keyed by canonical source identity. Saving them does not reset room history, change room membership, reconnect Twitch, or stop/restart YouTube. Removing and later re-adding the same stream restores its chosen groups/colors.

## Chat filtering

Group chips appear in both UIs:

- Select one group to show chats from its streams.
- Select multiple groups to show the union of their streams.
- **Ungrouped** shows sources without group assignments.
- **All chats** clears group filtering and individual source exclusions, enabling every source's messages again.

The widget's stream checkboxes can hide individual sources within the chosen groups. A dimmed row is excluded by one of those filters; its link and live status remain accessible. If a previously selected group no longer exists in the room, its chip remains visible as “not in room” so it can be cleared.

These preferences are shared across the popup and widgets in this Chrome profile and persist after refresh/restart. Filtering affects presentation only: readers continue receiving all configured sources and YouTube polling continues using quota. Use platform Stop/Disconnect controls or edit the room membership to stop reading a source.

## Widget size and chat scrolling

Use **Widget size** in the popup or widget to choose width (320–720 px) and height (420–1000 px). Saved dimensions apply across widgets. The actual panel is constrained to the current browser viewport so it remains reachable on smaller windows. Collapsing the panel preserves its saved expanded size.

The chat follows new messages while you are at the bottom. Scroll up and auto-follow pauses; incoming messages no longer pull you down. Existing message nodes are retained and the first visible message is used as an anchor when rows change. Images/layout changes also preserve the reading position. Live announcements pause while you read older messages.

Press **Jump to newest ↓** or scroll back to the bottom to resume following. Filtering deliberately takes you to the newest matching messages when changed in the widget. Changes made from the popup preserve a widget's paused reading position where possible.

This does not create unlimited history. The existing buffers/panel retain up to 200 messages; if the message you are reading ages out, the app cannot recover it from that buffer. Native history remains temporary, with the existing moderation/connection clearing rules.

## Verification

```powershell
node --test
node scripts/browser-check.cjs
```

The second command requires local Chrome (default Windows path included; set `CROSSCHAT_CHROME` if needed). It uses a separate test profile, an ephemeral localhost server, and offline fixtures: no OAuth, tokens, platform API requests, or real stream pages. It checks initial newest position, reading-anchor preservation on incoming messages, Jump to newest, group filtering/All chats, size changes, source links, colors, popup tabs, and preserved editing focus. Screenshots/test profiles are ignored under `.artifacts/`.

For a manual offline preview, serve the project using any local static server and open `dev/preview.html`. Do not use these fixtures as proof of real-platform status accuracy.

Browser checklist after reloading the extension and refreshing tabs:

- [ ] Sign in under Connections and check Live/Offline/Upcoming/Unknown badges against real stream pages. Check both popup and widget links open the correct source in a new tab.
- [ ] Assign League of Legends, Valorant, and Proplay across sources. Save each stream and filter one/multiple groups in either UI. All chats restores all sources.
- [ ] Customize two stream colors. Check source-card accents and matching chat rows; refresh to confirm persistence.
- [ ] While editing a group, allow a status update or reopen the popup: your draft remains. Confirm metadata edits preserve room history and active readers.
- [ ] Resize width/height from both UIs and check smaller windows, collapse/expand, and fullscreen recovery.
- [ ] Scroll up during active chat. Incoming messages and emote loads should leave your reading position intact. Jump to newest resumes following.
- [ ] Check keyboard navigation, player shortcut isolation, source filters, local sends, native emotes, and platform Start/Stop still work.
