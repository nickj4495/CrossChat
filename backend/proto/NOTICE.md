# YouTube streaming schema attribution

`youtube-live-chat.proto` is copied from Google's published code sample:
https://developers.google.com/youtube/data/live/streaming-live-chat

Google Developers code samples are licensed under the Apache License, Version 2.0:
https://developers.google.com/terms/site-policies

A copy of that license is included as `LICENSE-2.0.txt`. The sample schema is used with its original package/service and field numbers. Source/license comments and the missing standard `google/protobuf/duration.proto` import were added (the published sample references Duration). The loader supplies that well-known Google type. `scripts/fetch-youtube-proto.cjs` can refresh it; review schema changes and rerun the backend tests before committing updates.
