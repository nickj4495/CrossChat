// Optional real-Chrome UI check. Uses Node built-ins only; no test credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs'); const path = require('node:path'); const http = require('node:http');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const chrome = process.env.CROSSCHAT_CHROME || 'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe';
if (!fs.existsSync(chrome)) throw new Error('Set CROSSCHAT_CHROME to a local Chrome executable.');
const artifacts = path.join(root, '.artifacts'); fs.mkdirSync(artifacts, { recursive: true });
const server = http.createServer((request, response) => {
  const pathname = new URL(request.url, 'http://localhost').pathname;
  const file = path.resolve(root, '.' + pathname);
  if (!file.startsWith(root + path.sep) || !/^\/(dev|src)\//.test(pathname)) { response.writeHead(404); response.end(); return; }
  fs.readFile(file, (error, data) => {
    if (error) { response.writeHead(404); response.end(); return; }
    response.setHeader('Content-Type', file.endsWith('.html') ? 'text/html' : file.endsWith('.css') ? 'text/css' : 'application/javascript'); response.end(data);
  });
});
let processHandle; let socket; let sessionId; const pending = new Map(); let serial = 0;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const send = (method, params = {}, session = sessionId) => new Promise((resolve, reject) => {
  const id = ++serial; pending.set(id, { resolve, reject });
  socket.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
});
const evaluate = async expression => {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text + ': ' + (result.exceptionDetails.exception?.description || expression));
  return result.result.value;
};
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const base = `http://127.0.0.1:${server.address().port}`;
    processHandle = spawn(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0',
      `--user-data-dir=${path.join(artifacts, 'chrome-' + Date.now())}`, 'about:blank'], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Chrome startup timed out')), 15000);
      let output = ''; processHandle.stderr.on('data', chunk => { output += chunk; const match = output.match(/DevTools listening on (ws:\/\/[^\s]+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      processHandle.on('error', reject);
    });
    socket = new WebSocket(endpoint);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    socket.onmessage = event => { const reply = JSON.parse(event.data); if (reply.id && pending.has(reply.id)) {
      const callback = pending.get(reply.id); pending.delete(reply.id); if (reply.error) callback.reject(new Error(reply.error.message)); else callback.resolve(reply.result);
    } };
    const target = await send('Target.createTarget', { url: 'about:blank' }, null);
    sessionId = (await send('Target.attachToTarget', { targetId: target.targetId, flatten: true }, null)).sessionId;
    await send('Page.enable'); await send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: base + '/dev/preview.html' });
    for (let i = 0; i < 50; i++) { if (await evaluate('Boolean(window.preview?.ready)')) break; await pause(100); }
    assert.equal(await evaluate('Boolean(window.preview?.ready)'), true);
    await pause(200);
    assert.equal(await evaluate("preview.root.querySelector('.messages').children.length"), 100);
    assert.ok(await evaluate("(() => { const log = preview.root.querySelector('.messages'); return log.scrollHeight - log.clientHeight - log.scrollTop < 3; })()"));
    await evaluate("{ const log = preview.root.querySelector('.messages'); log.scrollTop = 300; log.dispatchEvent(new Event('scroll')); const node = [...log.children].find(row => row.offsetTop + row.offsetHeight > log.scrollTop); window.savedAnchor = { node, offset: node.offsetTop - log.scrollTop }; }");
    await evaluate('preview.add(8)'); await pause(100);
    assert.ok(Math.abs(await evaluate("savedAnchor.node.offsetTop - preview.root.querySelector('.messages').scrollTop - savedAnchor.offset")) <= 1);
    assert.equal(await evaluate("preview.root.querySelector('.jump').hidden"), false);
    await evaluate("preview.panel.host.style.setProperty('display', 'none', 'important'); preview.add(3)");
    await pause(100);
    await evaluate("preview.panel.host.style.setProperty('display', 'block', 'important'); preview.panel.mounted()");
    await pause(100);
    assert.ok(Math.abs(await evaluate("savedAnchor.node.offsetTop - preview.root.querySelector('.messages').scrollTop - savedAnchor.offset")) <= 1);
    assert.equal(await evaluate("preview.root.querySelector('.jump').hidden"), false);
    await evaluate("preview.root.querySelector('.jump').click()");
    assert.ok(await evaluate("{ const log = preview.root.querySelector('.messages'); log.scrollHeight - log.clientHeight - log.scrollTop < 3; }") || await evaluate("(() => { const log = preview.root.querySelector('.messages'); return log.scrollHeight - log.clientHeight - log.scrollTop < 3; })()"));
    await evaluate("[...preview.root.querySelectorAll('.group-chip')].find(button => button.textContent === 'League of Legends').click()");
    assert.equal(await evaluate("preview.data.viewPrefs.selectedGroups[0]"), 'league of legends');
    assert.ok(await evaluate("preview.root.querySelector('.messages').children.length < preview.data.messages.length"));
    await evaluate("[...preview.root.querySelectorAll('.group-chip')].find(button => button.textContent === 'All chats').click()");
    await evaluate("{const checkbox = preview.root.querySelector('.source-option input[type=checkbox]'); checkbox.checked = false; checkbox.dispatchEvent(new Event('change'));}");
    assert.equal(await evaluate('preview.data.viewPrefs.hiddenSources.length'), 1);
    await evaluate("[...preview.root.querySelectorAll('.group-chip')].find(button => button.textContent === 'All chats').click()");
    assert.equal(await evaluate('preview.data.viewPrefs.hiddenSources.length'), 0);
    assert.equal(await evaluate("preview.root.querySelector('.messages').children.length"), await evaluate('preview.data.messages.length'));
    await evaluate("{const input = preview.root.querySelector('.width-range'); input.value = '600'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));}");
    assert.equal(Math.round(await evaluate("preview.root.querySelector('.panel').getBoundingClientRect().width")), 600);
    await evaluate("{const input = preview.root.querySelector('.height-range'); input.value = '800'; input.dispatchEvent(new Event('input')); input.dispatchEvent(new Event('change'));}");
    assert.equal(Math.round(await evaluate("preview.root.querySelector('.panel').getBoundingClientRect().height")), 800);
    await evaluate("preview.root.querySelector('.sources-details').open = true");
    assert.equal(await evaluate("preview.root.querySelectorAll('.source-info a[href]').length"), 3);
    await evaluate("{const color = preview.root.querySelector('.color-control'); color.value = '#00ff88'; color.dispatchEvent(new Event('change'));}");
    assert.equal(await evaluate("preview.root.querySelector('.message').style.borderInlineStartColor"), 'rgb(0, 255, 136)');
    fs.writeFileSync(path.join(artifacts, 'widget.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    const preload = fs.readFileSync(path.join(root, 'dev/fixtures.js'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'dev/popup-fixture.js'), 'utf8');
    await send('Page.addScriptToEvaluateOnNewDocument', { source: preload });
    await send('Emulation.setDeviceMetricsOverride', { width: 500, height: 900, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url: base + '/src/popup.html' }); await pause(500);
    assert.equal(await evaluate("document.querySelectorAll('.stream-card').length"), 3);
    await evaluate("document.querySelector('#tab-connections').click()");
    assert.equal(await evaluate("document.querySelector('#pane-room').hidden"), true);
    await evaluate("{const reader = document.querySelector('#youtube-transport'); reader.value = 'local'; reader.dispatchEvent(new Event('change')); document.querySelector('#youtube-backend-key').value = 'b'.repeat(64); document.querySelector('#youtube-backend-key').dispatchEvent(new Event('input')); popupFixture.emit(['twitchLive:revision']);}"); await pause(100);
    assert.equal(await evaluate("document.querySelector('#youtube-backend-settings').hidden"), false);
    assert.equal(await evaluate("document.querySelector('#youtube-transport').value"), 'local');
    assert.equal(await evaluate("document.querySelector('#youtube-backend-key').value.length"), 64);
    assert.equal(await evaluate("document.querySelector('#youtube-start').disabled"), true);
    await evaluate("document.querySelector('#youtube-reader-save').click()"); await pause(100);
    assert.equal(await evaluate("document.querySelector('#youtube-backend-key').value"), '');
    assert.equal(await evaluate('popupFixture.youtube.transport.keyConfigured'), true);
    assert.match(await evaluate("document.querySelector('#youtube-reader-hint').textContent"), /fallback to polling is manual/);
    fs.writeFileSync(path.join(artifacts, 'connections.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    await evaluate("document.querySelector('#tab-room').click()");
    await evaluate("{const input = document.querySelector('.group-label input'); input.value = 'League of Legends, Proplay, Worlds'; input.dispatchEvent(new Event('input')); const color = document.querySelector('.color-label input'); color.value = '#ff9900'; color.dispatchEvent(new Event('input')); document.querySelector('.stream-actions button').click();}"); await pause(100);
    assert.ok(await evaluate("popupFixture.data.sources[0].groups.includes('Worlds')"));
    assert.equal(await evaluate('popupFixture.data.sources[0].color'), '#ff9900');
    assert.ok(await evaluate("[...document.querySelectorAll('#popup-groups button')].some(button => button.textContent === 'Worlds')"));
    await evaluate("{const input = document.querySelector('.group-label input'); input.focus(); input.value = 'Unsaved group'; input.dispatchEvent(new Event('input')); popupFixture.emit(['twitchLive:revision']);}"); await pause(100);
    assert.equal(await evaluate("document.activeElement === document.querySelector('.group-label input')"), true);
    assert.equal(await evaluate("document.querySelector('.group-label input').value"), 'Unsaved group');
    fs.writeFileSync(path.join(artifacts, 'popup.png'), Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
    console.log('Chrome UI checks passed: scroll anchoring/newest, group filters, sizing, links, colors, popup tabs, reader settings and preserved edit focus.');
    console.log('Screenshots: .artifacts/widget.png, .artifacts/popup.png, .artifacts/connections.png');
  } finally {
    if (socket?.readyState === 1) { try { await send('Browser.close', {}, null); } catch {} socket.close(); }
    processHandle?.kill(); server.close();
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
