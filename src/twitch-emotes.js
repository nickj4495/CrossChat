(() => {
  const app = globalThis.CrossChat = globalThis.CrossChat || {};
  // Shared by the EventSub adapter and renderer. Keep text authoritative if the
  // fragment list is absent, incomplete, or inconsistent with Twitch's message.
  app.getTwitchFragments = (text, fragments) => {
    const plain = () => [{ type: 'text', text }];
    if (!Array.isArray(fragments) || !fragments.length || fragments.length > 500 ||
        fragments.some(part => !part || typeof part.text !== 'string') ||
        fragments.map(part => part.text).join('') !== text) return plain();
    return fragments.map(part => {
      const id = part.emote?.id;
      if (part.type !== 'emote' || typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || !part.text) {
        return { type: 'text', text: part.text };
      }
      const formats = Array.isArray(part.emote.format)
        ? ['static', 'animated'].filter(format => part.emote.format.includes(format)) : [];
      return { type: 'emote', text: part.text, emote: { id, format: formats.length ? formats : ['static'] } };
    });
  };
  app.renderMessageBody = (body, message) => {
    body.textContent = '';
    if (message.platform !== 'twitch' || message.origin !== 'twitch-eventsub' || message.local) {
      body.textContent = message.text;
      return;
    }
    const doc = body.ownerDocument || document;
    const reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
    const parts = app.getTwitchFragments(message.text, message.fragments);
    for (const part of parts) {
      const text = doc.createElement('span');
      text.textContent = part.text;
      if (part.type !== 'emote') { body.append(text); continue; }
      const image = doc.createElement('img');
      image.className = 'emote';
      image.alt = part.text;
      image.title = part.text;
      image.referrerPolicy = 'no-referrer';
      image.decoding = 'async';
      const format = !reducedMotion && part.emote.format.includes('animated') ? 'animated' : 'static';
      // Documented Twitch CDN template. IDs and format are constrained above;
      // incoming messages cannot supply URLs, HTML, styles, or event handlers.
      image.addEventListener('error', () => image.replaceWith(text), { once: true });
      image.src = `https://static-cdn.jtvnw.net/emoticons/v2/${part.emote.id}/${format}/dark/2.0`;
      body.append(image);
    }
  };
})();
