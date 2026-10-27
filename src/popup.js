(async () => {
  const toggle = document.querySelector('#enabled');
  const status = document.querySelector('#status');
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
    } finally {
      toggle.disabled = false;
    }
  });
})();
