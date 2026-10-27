// Real Firefox WebDriver check, isolated profile; no platform credentials used.
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http'); const assert = require('node:assert/strict'); const { spawn } = require('node:child_process');
const { build } = require('./build-extension.cjs'); const root = path.resolve(__dirname, '..');
const binary = process.env.CROSSCHAT_FIREFOX || path.join(root, '.artifacts/browser-tools/firefox/core/firefox.exe');
const driver = process.env.CROSSCHAT_GECKODRIVER || path.join(root, '.artifacts/browser-tools/geckodriver/geckodriver.exe');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms)); let processHandle; let endpoint; let session; let bridge;
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname; const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !/^\/(dev|src)\//.test(pathname)) { response.writeHead(404); response.end(); return; }
  fs.readFile(file, (error, data) => { if (error) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript'); response.end(data); });
});
async function command(method, route, body) {
  const response = await fetch(endpoint + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(45000) });
  const result = await response.json(); if (!response.ok) throw new Error(result.value?.message || `WebDriver error (${response.status})`); return result.value;
}
const execute = script => command('POST', `/session/${session}/execute/sync`, { script, args: [] });
const invoke = request => command('POST', `/session/${session}/execute/async`, { script: 'const done = arguments[arguments.length - 1]; browser.runtime.sendMessage(arguments[0]).then(done, error => done({error:error.message}));', args: [{ scope: 'crosschat', ...request }] });
async function waitFor(script) { for (let i = 0; i < 100; i++) { if (await execute(script)) return; await pause(50); } throw new Error('Firefox UI check timed out: ' + script); }
(async () => {
  try {
    const destination = build('firefox');
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const probe = http.createServer(); await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve)); const port = probe.address().port; await new Promise(resolve => probe.close(resolve));
    processHandle = spawn(driver, ['--port', String(port), '--log', 'warn', '--allow-system-access'], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    endpoint = `http://127.0.0.1:${port}`; processHandle.on('error', error => { console.error(error.message); });
    let started = false; for (let i = 0; i < 100; i++) { try { await command('GET', '/status'); started = true; break; } catch { await pause(50); } }
    if (!started) throw new Error('Set CROSSCHAT_GECKODRIVER to an installed geckodriver executable.');
    const created = await command('POST', '/session', { capabilities: { alwaysMatch: { browserName: 'firefox', 'moz:firefoxOptions': { binary, args: ['-headless'] } } } });
    session = created.sessionId; console.log('Testing Firefox ' + created.capabilities.browserVersion);
    await command('POST', `/session/${session}/moz/addon/install`, { path: destination, temporary: true });
    await command('POST', `/session/${session}/moz/context`, { context: 'chrome' });
    const ids = JSON.parse(await execute("return Services.prefs.getStringPref('extensions.webextensions.uuids');"));
    const origin = 'moz-extension://' + ids['crosschat@nickj4495.github.io']; assert.ok(ids['crosschat@nickj4495.github.io']);
    await command('POST', `/session/${session}/moz/context`, { context: 'content' });
    await command('POST', `/session/${session}/url`, { url: origin + '/src/popup.html' });
    await waitFor("return document.querySelector('#status')?.textContent !== 'Loading settings…';");
    const state = await invoke({ action: 'getYouTubeState' }); assert.equal(state.ok, true); assert.equal(state.data.auth.portable, true);
    assert.equal(await execute("return document.querySelector('#backend-origin').value;"), origin);
    const { createBridge, hmac } = require('../backend/server.cjs'); const connectionKey = 'e'.repeat(64);
    bridge = createBridge({ extensionOrigin: origin, key: connectionKey, adapter: { close() {} } }); const backendAddress = await bridge.listen(0);
    let observedOrigin = 'no-upgrade-received'; bridge.server.on('upgrade', request => { observedOrigin = String(request.headers.origin); });
    const hello = await command('POST', `/session/${session}/execute/async`, { script: "const done=arguments[arguments.length-1]; const socket=new WebSocket(arguments[0]); const timer=setTimeout(()=>{socket.close();done({error:'timeout'});},5000); socket.onopen=()=>socket.send(JSON.stringify({type:'hello',nonce:'a'.repeat(64)})); socket.onmessage=event=>{clearTimeout(timer); const data=JSON.parse(event.data);socket.close();done(data);};socket.onerror=()=>{clearTimeout(timer);done({error:'connection failed'});};", args: [`ws://127.0.0.1:${backendAddress.port}/youtube`] });
    assert.equal(hello.type, 'hello', `Firefox socket failed: ${JSON.stringify(hello)}; observed Origin=${observedOrigin}`); assert.equal(hello.proof, hmac(connectionKey, 'server:' + 'a'.repeat(64)));
    const saved = await invoke({ action: 'setSources', urls: ['https://www.twitch.tv/alpha', 'https://www.twitch.tv/beta', 'https://www.youtube.com/watch?v=fixture'] }); assert.equal(saved.ok, true);
    await waitFor("return document.querySelectorAll('.stream-card').length === 3;");
    const twitch = await invoke({ action: 'getTwitchState' }); assert.equal(twitch.ok, true); assert.match(twitch.data.auth.redirectUri, /^https:\/\//);
    await execute("document.querySelector('#tab-connections').click();");
    assert.equal(await execute("return document.querySelector('#google-chrome-setup').hidden;"), true);
    assert.equal(await execute("return document.querySelector('#portable-auth-hint').hidden;"), false);
    fs.writeFileSync(path.join(root, '.artifacts/firefox-connections.png'), Buffer.from(await command('GET', `/session/${session}/screenshot`), 'base64'));
    // Shared widget rendering in Firefox, using offline fixtures and real DOM.
    await command('POST', `/session/${session}/url`, { url: `http://127.0.0.1:${server.address().port}/dev/preview.html` });
    await waitFor('return Boolean(window.preview?.ready);');
    assert.equal(await execute("return preview.root.querySelector('.messages').children.length;"), 100);
    await execute("{const log=preview.root.querySelector('.messages'); log.scrollTop=100; log.dispatchEvent(new Event('scroll')); preview.add(3);}");
    await pause(150); assert.equal(await execute("return preview.root.querySelector('.jump').hidden;"), false);
    await execute("preview.root.querySelector('.jump').click();");
    assert.equal(await execute("return preview.root.querySelector('.jump').hidden;"), true);
    fs.writeFileSync(path.join(root, '.artifacts/firefox-widget.png'), Buffer.from(await command('GET', `/session/${session}/screenshot`), 'base64'));
    console.log('Firefox checks passed: actual temporary add-on/background messaging, saved room, portable auth UI, callback/origin, and fixture widget/newest control.');
  } finally {
    await bridge?.close();
    if (session) { try { await command('DELETE', `/session/${session}`); } catch {} }
    processHandle?.kill(); server.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
