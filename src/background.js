importScripts('mock-chat.js', 'history.js', 'rooms.js');
const service = CrossChat.createRoomService(chrome.storage.local);
chrome.runtime.onMessage.addListener((request, sender, respond) => {
  if (request?.scope !== 'crosschat') return;
  const execute = async () => {
    if (sender.id !== chrome.runtime.id) throw new Error('Invalid extension sender.');
    const popup = sender.url === chrome.runtime.getURL('src/popup.html');
    if (request.action === 'getPair' && popup) return service.getPair();
    if (request.action === 'setPair' && popup) return service.setPair(request.twitchUrl, request.youtubeUrl);
    if (request.action === 'setSources' && popup) return service.setSources(request.urls);
    if (request.action === 'clearPair' && popup) return service.clearPair();
    if (!sender.tab || sender.frameId !== 0 ||
        new URL(sender.url).origin !== new URL(request.href).origin) {
      throw new Error('This request must come from a supported stream page.');
    }
    if (request.action === 'snapshot') return service.snapshot(request.href);
    if (request.action === 'send') return service.send(request.href, request.key, request.text);
    throw new Error('Unknown CrossChat action.');
  };
  execute().then(data => respond({ ok: true, data }), error => {
    console.warn('CrossChat request failed.', error);
    respond({ ok: false, error: error.message || 'CrossChat could not complete this request.' });
  });
  return true;
});
