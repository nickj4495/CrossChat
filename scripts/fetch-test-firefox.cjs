// Downloads isolated test binaries; never installs/replaces the user's browser.
const fs = require('node:fs'); const path = require('node:path');
const destination = path.resolve(__dirname, '../.artifacts/browser-tools');
fs.mkdirSync(destination, { recursive: true });
async function save(url, name) {
  const response = await fetch(url, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('Test browser download failed (' + response.status + ')');
  fs.writeFileSync(path.join(destination, name), Buffer.from(await response.arrayBuffer()));
}
(async () => {
  await save('https://download.mozilla.org/?product=firefox-latest-ssl&os=win64&lang=en-US', 'firefox-setup.exe');
  const release = await (await fetch('https://api.github.com/repos/mozilla/geckodriver/releases/latest')).json();
  const asset = release.assets.find(item => item.name.endsWith('win64.zip'));
  if (!asset) throw new Error('Official geckodriver Windows artifact not found');
  await save(asset.browser_download_url, 'geckodriver.zip');
  console.log('Downloaded Firefox and geckodriver to .artifacts/browser-tools.');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
