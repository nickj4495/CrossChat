(async () => {
  const toggle = document.querySelector('#enabled');
  const status = document.querySelector('#status');
  const twitch = document.querySelector('#twitch-url');
  const youtube = document.querySelector('#youtube-url');
  const save = document.querySelector('#save-pair');
  const clear = document.querySelector('#clear-pair');
  const pairStatus = document.querySelector('#pair-status');
  let pair = null;
  // The toolbar popup is destroyed when it loses focus. Synchronous storage in
  // this extension page preserves drafts immediately, without an unload handler.
  // These are form drafts only; active pairing stays in chrome.storage.local.
  const draftKey = 'crosschat:pairDraft:v1';
  const readDraft = () => {
    const draft = JSON.parse(localStorage.getItem(draftKey) || 'null');
    return draft && typeof draft.twitchUrl === 'string' && typeof draft.youtubeUrl === 'string' ? draft : null;
  };
  const saveDraft = () => {
    try {
      localStorage.setItem(draftKey, JSON.stringify({ twitchUrl: twitch.value, youtubeUrl: youtube.value }));
      pairStatus.textContent = 'Draft saved. You can close this popup to copy the other URL. Click Save pair when ready.';
    } catch {
      pairStatus.textContent = 'Could not save draft. Keep this popup open until you save the pair.';
    }
  };
  twitch.disabled = youtube.disabled = true;
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
  } catch {
    status.textContent = 'Could not load settings. Try reopening this popup.';
  }
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
    try { draft = readDraft(); } catch { /* Ignore unreadable drafts; active pairing is unaffected. */ }
    twitch.value = draft?.twitchUrl ?? pair?.twitchUrl ?? '';
    youtube.value = draft?.youtubeUrl ?? pair?.youtubeUrl ?? '';
    pairStatus.textContent = draft ? 'Draft restored. Click Save pair to activate these URLs.' : pair ? 'Pair active. Open both pages to try shared chat.' : 'No pair yet. Each page currently has separate chat.';
    twitch.disabled = youtube.disabled = false;
    save.disabled = false;
    clear.disabled = !pair;
  } catch (error) { pairStatus.textContent = error.message; }
  const update = async action => {
    save.disabled = clear.disabled = true;
    twitch.disabled = youtube.disabled = true;
    pairStatus.textContent = 'Saving…';
    try {
      pair = await request(action, { twitchUrl: twitch.value.trim(), youtubeUrl: youtube.value.trim() });
      if (action === 'clearPair') {
        pair = null;
        twitch.value = youtube.value = '';
      }
      try { localStorage.removeItem(draftKey); } catch { /* Pair operation already succeeded. */ }
      pairStatus.textContent = pair ? 'Pair saved. Both pages now share a local room.' : 'Unpaired. Pages use their separate saved histories again.';
    } catch (error) { pairStatus.textContent = error.message; }
    finally {
      save.disabled = false;
      clear.disabled = !pair;
      twitch.disabled = youtube.disabled = false;
    }
  };
  document.querySelector('#pair-form').addEventListener('submit', event => {
    event.preventDefault();
    update('setPair');
  });
  clear.addEventListener('click', () => update('clearPair'));
  twitch.addEventListener('input', saveDraft);
  youtube.addEventListener('input', saveDraft);
})();
