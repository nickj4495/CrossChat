const fs = require('node:fs');
const path = require('node:path');
(async () => {
 const response = await fetch('https://developers.google.com/youtube/data/live/streaming-live-chat');
 if (!response.ok) throw new Error('Could not fetch official schema page');
 const html = await response.text();
 const decode = text => text.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
 const blocks = [...html.matchAll(/<pre\b[^>]*>([\s\S]*?)<\/pre>/g)].map(match => decode(match[1]));
 let schema = blocks.find(text => text.includes('syntax = "proto2"') && text.includes('service V3DataLiveChatMessageService'));
 if (!schema || !schema.includes('message LiveChatMessage')) throw new Error('Published schema not found');
 // The sample references Duration without importing it. Add the standard import;
 // protobuf-loader supplies this well-known Google type. No wire fields change.
 if (!schema.includes('import "google/protobuf/duration.proto"')) schema = schema.replace('syntax = "proto2";', 'syntax = "proto2";\n// Required by LiveChatGiftDetails in the published sample.\nimport "google/protobuf/duration.proto";');
 fs.writeFileSync(path.join(__dirname, '../backend/proto/youtube-live-chat.proto'), '// Source: https://developers.google.com/youtube/data/live/streaming-live-chat\n// Google code sample licensed under Apache-2.0. See NOTICE.md.\n' + schema.trim() + '\n');
 console.log('Saved published protobuf schema (' + schema.split('\n').length + ' lines).');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
