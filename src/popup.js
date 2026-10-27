(async () => {
  const toggle = document.querySelector('#enabled');
  const status = document.querySelector('#status');
  const urls = document.querySelector('#source-urls');
  const save = document.querySelector('#save-pair');
  const clear = document.querySelector('#clear-pair');
  const pairStatus = document.querySelector('#pair-status');
  let pair = null;
  const draftKey = 'crosschat:roomDraft:v2';
  const legacyDraftKey = 'crosschat:pairDraft:v1';
  const readDraft = () => {
    const draft = localStorage.getItem(draftKey);
    if (draft !== null) return draft;
    const legacy = JSON.parse(localStorage.getItem(legacyDraftKey) || 'null');
    return legacy && typeof legacy.twitchUrl === 'string' && typeof legacy.youtubeUrl === 'string'
      ? [legacy.twitchUrl, legacy.youtubeUrl].join('\n') : null;
  };
  const request = async (action, extra = {}) => {
    const result = await chrome.runtime.sendMessage({ scope: 'crosschat', action, ...extra });
    if (!result?.ok) throw new Error(result?.error || 'Could not reach CrossChat. Reload the extension.');
    return result.data;
  };
  const describe = () => { status.textContent = toggle.checked ? 'Enabled on supported pages.' : 'Disabled across Twitch and YouTube.'; };
  try {
    const settings = await chrome.storage.local.get({ enabled: true });
    toggle.checked = settings.enabled !== false;
    toggle.disabled = false;
    describe();
  } catch { status.textContent = 'Could not load settings. Try reopening this popup.'; }
  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    try {
      await chrome.storage.local.set({ enabled: toggle.checked });
      describe();
    } catch {
      toggle.checked = !toggle.checked;
      status.textContent = 'Could not save. Please try again.';
    } finally { toggle.disabled = false; }
  });
  try {
    pair = await request('getPair');
    let draft = null;
    try { draft = readDraft(); } catch { /* Active room is unaffected by unreadable drafts. */ }
    const activeUrls = pair?.sources?.map(source => source.url) || (pair ? [pair.twitchUrl, pair.youtubeUrl] : []);
    urls.value = draft ?? activeUrls.join('\n');
    pairStatus.textContent = draft !== null ? 'Draft restored. Click Save room to activate this list.' : pair ? 'Room active. All listed pages share local chat.' : 'No room yet. Add at least two sources.';
    urls.disabled = save.disabled = false;
    clear.disabled = !pair;
  } catch (error) { pairStatus.textContent = error.message; }
  urls.addEventListener('input', () => {
    try {
      // Synchronous extension-page storage survives the popup closing immediately.
      localStorage.setItem(draftKey, urls.value);
      pairStatus.textContent = 'Draft saved. Copy more URLs, then click Save room.';
    } catch { pairStatus.textContent = 'Could not save draft. Keep this popup open until you save the room.'; }
  });
  const update = async action => {
    save.disabled = clear.disabled = urls.disabled = true;
    pairStatus.textContent = 'Saving…';
    try {
      pair = await request(action, { urls: urls.value.split(/\r?\n/).map(url => url.trim()).filter(Boolean) });
      if (action === 'clearPair') { pair = null; urls.value = ''; }
      else urls.value = pair.sources.map(source => source.url).join('\n');
      try { localStorage.removeItem(draftKey); localStorage.removeItem(legacyDraftKey); } catch { /* Room operation succeeded. */ }
      pairStatus.textContent = pair ? `Room saved with ${pair.sources.length} sources.` : 'Disconnected. Pages use separate saved histories again.';
    } catch (error) { pairStatus.textContent = error.message; }
    finally { save.disabled = urls.disabled = false; clear.disabled = !pair; }
  };
  document.querySelector('#pair-form').addEventListener('submit', event => { event.preventDefault(); update('setSources'); });
  clear.addEventListener('click', () => update('clearPair'));
})();
