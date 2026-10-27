const fs = require('node:fs'); const path = require('node:path');
const root = path.resolve(__dirname, '..');
function build(browser, outputRoot = path.join(root, 'dist')) {
  if (!['chrome', 'firefox', 'safari'].includes(browser)) throw new Error('Choose chrome, firefox, or safari.');
  const destination = path.join(outputRoot, browser);
  fs.mkdirSync(destination, { recursive: true });
  // Only copy extension assets, never backend secrets, dependencies or dev files.
  fs.cpSync(path.join(root, 'src'), path.join(destination, 'src'), { recursive: true });
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (browser !== 'chrome') {
    delete manifest.minimum_chrome_version; delete manifest.oauth2;
    // Firefox's MV3 default upgrades ws:// loopback to wss://. Keep scripts
    // packaged-only while explicitly allowing the existing local transport.
    manifest.content_security_policy = { extension_pages: "script-src 'self'; object-src 'self'; connect-src https://id.twitch.tv https://api.twitch.tv https://www.googleapis.com wss://eventsub.wss.twitch.tv ws://127.0.0.1:*" };
    const background = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
    const imports = [...background.matchAll(/^\uFEFF?importScripts\(([^\n]+)\);\r?$/gm)];
    const scripts = imports.flatMap(match => [...match[1].matchAll(/'([^']+)'/g)].map(item => 'src/' + item[1]));
    if (!scripts.includes('src/platform.js') || !scripts.includes('src/browser-auth.js')) throw new Error('Could not resolve background dependencies.');
    fs.writeFileSync(path.join(destination, 'src/background-page.js'), background.replace(/^\uFEFF?importScripts\([^\n]+\);\r?\n/gm, ''));
    manifest.background = { scripts: [...scripts, 'src/background-page.js'], persistent: false };
    if (browser === 'firefox') manifest.browser_specific_settings = { gecko: { id: 'crosschat@nickj4495.github.io', strict_min_version: '140.0', data_collection_permissions: { required: ['authenticationInfo', 'browsingActivity', 'personalCommunications'], optional: [] } } };
    if (browser === 'safari') manifest.permissions = manifest.permissions.filter(permission => permission !== 'identity');
  }
  fs.writeFileSync(path.join(destination, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return destination;
}
if (require.main === module) {
  for (const browser of process.argv.slice(2).length ? process.argv.slice(2) : ['chrome', 'firefox', 'safari']) console.log(build(browser));
}
module.exports = { build };
