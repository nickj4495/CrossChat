(() => {
  const app = globalThis.CrossChat;
  app.createChatScroll = (log, jump) => {
    let active = true;
    let following = true;
    let reading = null;
    const capture = () => {
      const top = log.scrollTop || 0;
      const node = [...log.children].find(child => (child.offsetTop || 0) + (child.offsetHeight || 0) > top);
      return { node, offset: node ? (node.offsetTop || 0) - top : 0, top };
    };
    const paint = () => {
      jump.hidden = following;
      log.setAttribute('aria-live', following ? 'polite' : 'off');
    };
    const restore = saved => {
      paint();
      if (!log.clientHeight) return;
      if (following) log.scrollTop = log.scrollHeight;
      else if (saved) {
        log.scrollTop = saved.node && [...log.children].includes(saved.node) ? (saved.node.offsetTop || 0) - saved.offset : saved.top;
        reading = capture();
      }
    };
    const onScroll = () => {
      if (!log.clientHeight) return;
      following = log.scrollHeight - log.clientHeight - log.scrollTop <= 24;
      reading = following ? null : capture(); paint();
    };
    const newest = () => { following = true; reading = null; restore(null); };
    const onImage = () => Promise.resolve().then(() => { if (active) restore(reading); });
    const observer = globalThis.ResizeObserver ? new ResizeObserver(() => { if (active) restore(reading); }) : null;
    observer?.observe(log);
    log.addEventListener('scroll', onScroll, { passive: true });
    log.addEventListener('load', onImage, true);
    log.addEventListener('error', onImage, true);
    jump.addEventListener('click', newest);
    paint();
    return { beforeUpdate: () => following ? null : log.clientHeight ? capture() : reading, afterUpdate: restore, newest,
      isFollowing: () => following,
      destroy() {
        active = false; observer?.disconnect();
        log.removeEventListener('scroll', onScroll); log.removeEventListener('load', onImage, true);
        log.removeEventListener('error', onImage, true); jump.removeEventListener('click', newest);
      }
    };
  };
})();
