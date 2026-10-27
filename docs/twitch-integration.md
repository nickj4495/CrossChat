# Real Twitch chat — integration decision pending

The current extension is still a local mock prototype. `src/twitch-eventsub.js` is a tested, pure notification adapter; it is not loaded by the manifest or connected to a network feed. No authentication, credentials, live ingestion, or additional permissions have been added.

## Verified integration options

Twitch recommends EventSub for receiving chat. `channel.chat.message` requires a user access token with `user:read:chat`. Using EventSub WebSockets requires creating subscriptions through Twitch's API using that token and a registered app's public Client ID.

Sources:
- [Twitch chat authentication](https://dev.twitch.tv/docs/chat/authenticating)
- [Channel chat message subscription and event fields](https://dev.twitch.tv/docs/eventsub/eventsub-subscription-types/#channelchatmessage)
- [EventSub WebSocket lifecycle](https://dev.twitch.tv/docs/eventsub/handling-websocket-events)
- [Documented IRC authentication](https://dev.twitch.tv/docs/chat/irc/#authenticating-with-the-twitch-irc-server)

The earlier instruction to defer authentication needs a new user decision before adding sign-in. Anonymous IRC approaches discussed on community forums are not the documented authentication route; this preparation does not depend on them.

## Recommended next implementation: read-only EventSub

- Register a Twitch app and configure an extension sign-in callback. A public Client ID is configuration, not a secret. A client secret must never be placed in the extension.
- Verify the current supported public-client OAuth flow before implementing sign-in. Ask only for read permission for this milestone; keep native posting disabled.
- Keep access tokens out of page scripts, logs, URLs displayed to users, Git, and durable message history. Implement validation, expiry, sign-out, and revoked-authorization handling.
- Resolve selected Twitch channel logins to broadcaster IDs, then subscribe each channel using an authenticated reader identity.
- Handle WebSocket welcome, subscription creation, keepalive deadlines, reconnect, revocation, failures, and duplicate delivery. Keep a single connection owner for multiple panels.
- Route selected sources into shared rooms. Distinguish native messages from local demo messages. Handle moderation deletion/clear events before claiming a complete chat mirror.
- Test with real authorization and active selected channels; fixture tests alone cannot establish that the connection works.

## Alternative while OAuth is deferred

An explicitly experimental DOM reader could collect messages rendered by open Twitch chat tabs. This requires keeping source chats open and depends on Twitch's changing markup. It does not provide the same functionality as an official multi-channel feed and must not be presented as one.

## Prepared adapter

`CrossChat.normalizeTwitchNotification(frame, allowedChannels)` accepts a documented `channel.chat.message` WebSocket notification. It checks subscription type/version, selected channel, broadcaster ID agreement, timestamp, message identity, and text fields. It returns a normalized object with a stable channel/message ID, source metadata, author ID, and `origin: twitch-eventsub`. It leaves message text literal and ignores invalid/unrelated frames.

The adapter is not a trust boundary or a complete EventSub client. The future transport must authenticate and validate subscriptions; a future ingestion service must deduplicate messages, enforce room membership, apply moderation, and decide retention.

Run the full preparation checks:

```powershell
node --test tests/prototype.test.cjs tests/twitch-eventsub.test.cjs
node --check src/twitch-eventsub.js
```
