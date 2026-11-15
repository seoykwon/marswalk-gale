#!/usr/bin/env node
// Stage 5-5 B: offline check in headless Chrome via the DevTools protocol (no npm packages).
//
//   node scripts/54_offline_check.mjs            # starts and stops its own servers
//
// Runs twice:
//   root     python3 -m http.server 8768 in site/                → http://127.0.0.1:8768/
//   subpath  python3 -m http.server 8769 in work/stage5/subpath/ (symlink marswalk-gale → site)
//                                                                 → http://127.0.0.1:8769/marswalk-gale/
// Each run: fresh Chrome profile; open map.html online (installs the service worker, stores the shell);
// open the "Offline" panel and press "Make offline ready"; wait; measure the cache (bytes of every stored
// body + navigator.storage.estimate()); then go offline (stop the http server AND
// Network.emulateNetworkConditions offline on the page and the service worker); reload the home (index.html), map.html,
// eva.html?route=A, eva.html?route=B, cuff.html. Per page: panels show numbers, own tiles from the list
// render, no tile of the list fails, console errors classified (external Trek tiles / own tiles that are
// not on the list = expected; anything else = failure).
// Output: work/stage5/offline_check.json, work/stage5/offline_screens/*.png. Exit code 1 when a check fails.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SITE = path.join(ROOT, 'site');
const OUT = path.join(ROOT, 'work', 'stage5');
const SHOTS = path.join(OUT, 'offline_screens');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LIST = JSON.parse(fs.readFileSync(path.join(SITE, 'data', 'eva_precache.json'), 'utf8'));
const listed = new Set([...LIST.shell.files, ...LIST.tiles.files, ...LIST.extras.files].map((f) => f[0]));
const tileList = new Set(LIST.tiles.files.map((f) => f[0]));
const hasCuff = fs.existsSync(path.join(SITE, 'cuff.html'));

const result = { started: new Date().toISOString(), list_version: LIST.version, list_bytes: LIST.total_bytes, runs: [], checks: [] };
const check = (name, pass, detail = '') => {
  result.checks.push({ name, pass: !!pass, detail: String(detail) });
  console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : ''));
};

function startServer(dir, port) {
  const p = spawn('python3', ['-m', 'http.server', String(port), '--bind', '127.0.0.1'], { cwd: dir, stdio: 'ignore' });
  return p;
}
async function waitHttp(url) {
  for (let i = 0; i < 50; i++) { try { const r = await fetch(url); if (r.ok) return; } catch (e) { /* not yet */ } await sleep(200); }
  throw new Error('server not reachable: ' + url);
}
const stopProc = (p) => new Promise((res) => { if (p.exitCode !== null) return res(); p.once('exit', res); p.kill('SIGTERM'); });

async function run(name, base, serverDir, port, cdpPort) {
  const R = { name, base, pages: [], cache: null, save: null };
  result.runs.push(R);
  let server = startServer(serverDir, port);
  await waitHttp(base + 'index.html');
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'gale-offline-chrome-'));
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${prof}`,
    '--window-size=1280,800', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
  let ws;
  try {
    let ver = null;
    for (let i = 0; i < 50 && !ver; i++) { try { ver = await (await fetch(`http://127.0.0.1:${cdpPort}/json/version`)).json(); } catch (e) { await sleep(200); } }
    if (!ver) throw new Error('Chrome DevTools not reachable');
    ws = new WebSocket(ver.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener('open', r));
    let seq = 0;
    const pending = new Map();
    const send = (method, params = {}, sessionId) => {
      const id = ++seq;
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      return new Promise((res, rej) => pending.set(id, { res, rej, method }));
    };
    let page = null; // current page log bucket
    let pageSession = null;
    const reqUrl = new Map();
    let inflight = 0;
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        if (m.error) p.rej(new Error(p.method + ': ' + m.error.message)); else p.res(m.result);
        return;
      }
      if (!page) return;
      const P = m.params || {};
      if (m.sessionId && m.sessionId !== pageSession) { // service worker session: its own network tries (expected to fail offline)
        if (m.method === 'Network.loadingFailed') page.sw_net_failed++;
        return;
      }
      if (m.method === 'Network.requestWillBeSent') { inflight++; reqUrl.set(P.requestId, P.request.url); page.requests++; }
      if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inflight = Math.max(0, inflight - 1);
      if (m.method === 'Network.responseReceived') {
        const u = P.response.url;
        if (u.startsWith(base)) {
          const rel = u.slice(base.length).split('?')[0];
          if (P.response.fromServiceWorker) page.from_sw++;
          if (tileList.has(rel)) page.listed_tiles_ok.add(rel);
          if (P.response.status >= 400) page.failed.push({ url: u, status: P.response.status });
        }
      }
      if (m.method === 'Network.loadingFailed' && !P.canceled) page.failed.push({ url: reqUrl.get(P.requestId), failed: P.errorText });
      if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(P.entry.level)) page.log.push({ level: P.entry.level, source: P.entry.source, text: P.entry.text.slice(0, 300), url: P.entry.url || '' });
      if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(P.type)) page.log.push({ level: P.type, source: 'console', text: P.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300), url: '' });
      if (m.method === 'Runtime.exceptionThrown') page.log.push({ level: 'error', source: 'exception', text: JSON.stringify(P.exceptionDetails).slice(0, 400), url: '' });
    });
    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId: S } = await send('Target.attachToTarget', { targetId, flatten: true });
    pageSession = S;
    const ps = (method, params) => send(method, params, S);
    await ps('Page.enable'); await ps('Runtime.enable'); await ps('Network.enable'); await ps('Log.enable');
    await ps('Emulation.setDeviceMetricsOverride', { width: 1280, height: 800, deviceScaleFactor: 1, mobile: false });
    const evaluate = async (expr) => {
      const r = await ps('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw new Error('eval failed: ' + expr.slice(0, 80) + ' :: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
      return r.result.value;
    };
    const waitFor = async (expr, ms = 30000) => {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) { try { if (await evaluate(expr)) return true; } catch (e) { /* navigating */ } await sleep(150); }
      throw new Error('timeout waiting for ' + expr);
    };
    const idle = async (quietMs = 800, maxMs = 20000) => {
      const t0 = Date.now(); let q = Date.now();
      while (Date.now() - t0 < maxMs) { if (inflight > 0) q = Date.now(); if (Date.now() - q > quietMs) return; await sleep(100); }
    };
    const newBucket = (label, url) => ({ label, url, requests: 0, from_sw: 0, listed_tiles_ok: new Set(), failed: [], log: [], sw_net_failed: 0 });
    const nav = async (rel, label) => {
      page = newBucket(label, base + rel);
      inflight = 0;
      await ps('Page.navigate', { url: base + rel });
    };
    const shot = async (n) => {
      const r = await ps('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, `${name}_${n}.png`), Buffer.from(r.data, 'base64'));
    };

    // ---- 1. online first visit: worker installs, shell stored
    await nav('map.html', 'online map');
    await waitFor(`document.body.dataset.ready === '1' && !!window.galeOffline`);
    await waitFor(`navigator.serviceWorker.ready.then(() => !!navigator.serviceWorker.controller)`, 30000);
    await waitFor(`window.galeOffline.measure().then(() => window.galeOffline.state.stored.shell > 0)`, 30000);
    const shellStored = await evaluate(`window.galeOffline.state.stored.shell`);
    check(`${name}: shell stored on first visit`, shellStored >= LIST.shell.bytes * 0.99, `${(shellStored / 1e6).toFixed(2)} MB of ${(LIST.shell.bytes / 1e6).toFixed(2)} MB`);
    const st0 = await evaluate(`window.galeOffline.status()`);
    check(`${name}: status before button = none`, st0 === 'none', st0);

    // ---- 2. press "Offline ready"
    await evaluate(`document.querySelector('#offline-slot .offl-btn').click(), true`);
    await sleep(300);
    await shot('01_panel_before');
    const t0 = Date.now();
    await evaluate(`document.getElementById('offl-save').click(), true`);
    await waitFor(`window.galeOffline.state.phase === 'saving'`, 5000).catch(() => {});
    await waitFor(`window.galeOffline.state.phase !== 'saving' && window.galeOffline.status() === 'ready'`, 180000);
    R.save = { seconds: (Date.now() - t0) / 1000, failed: await evaluate(`window.galeOffline.state.failed`), status: await evaluate(`window.galeOffline.status()`),
      panel_text: await evaluate(`document.querySelector('.offl-panel').innerText`) };
    await shot('02_panel_ready');
    check(`${name}: offline ready after button`, R.save.status === 'ready' && R.save.failed === 0, `${R.save.seconds.toFixed(1)} s, failed ${R.save.failed}`);

    // ---- 3. measure the real cache
    R.cache = await evaluate(`(async () => {
      const out = { caches: {}, body_bytes: 0, entries: 0 };
      for (const k of await caches.keys()) {
        const c = await caches.open(k); let b = 0, n = 0;
        for (const req of await c.keys()) { const r = await c.match(req); b += (await r.blob()).size; n++; }
        out.caches[k] = { entries: n, bytes: b }; out.body_bytes += b; out.entries += n;
      }
      const e = await navigator.storage.estimate();
      out.estimate_usage = e.usage; out.estimate_details = e.usageDetails || null; out.quota = e.quota;
      out.persisted = navigator.storage.persisted ? await navigator.storage.persisted() : null;
      return out;
    })()`);
    check(`${name}: cache body bytes = list bytes`, Math.abs(R.cache.body_bytes - (LIST.total_bytes + fs.statSync(path.join(SITE, 'data', 'eva_precache.json')).size)) < 5000,
      `${(R.cache.body_bytes / 1e6).toFixed(2)} MB in ${R.cache.entries} entries; storage.estimate ${(R.cache.estimate_usage / 1e6).toFixed(2)} MB`);

    // ---- 4. offline
    await stopProc(server); server = null;
    const off = { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 };
    await ps('Network.emulateNetworkConditions', off);
    const swT = (await send('Target.getTargets')).targetInfos.filter((t) => t.type === 'service_worker' && t.url.startsWith(base));
    for (const t of swT) {
      const { sessionId } = await send('Target.attachToTarget', { targetId: t.targetId, flatten: true });
      await send('Network.enable', {}, sessionId).catch(() => {});
      await send('Network.emulateNetworkConditions', off, sessionId).catch(() => {});
    }
    R.sw_targets_offline = swT.length;
    let reachable = true;
    try { await fetch(base + 'index.html'); } catch (e) { reachable = false; }
    check(`${name}: server stopped`, !reachable);

    const pages = [
      ['index.html', 'home', `document.readyState === 'complete' && document.querySelectorAll('.cards a').length === 3`],
      ['map.html?route=B', 'map', `document.body.dataset.ready === '1'`],
      ['eva.html?route=A', 'eva_A', `document.body.dataset.ready === '1'`],
      ['eva.html?route=B', 'eva_B', `document.body.dataset.ready === '1'`],
    ];
    if (hasCuff) pages.push(['cuff.html?route=B', 'cuff', `document.readyState === 'complete' && (document.body.dataset.ready === '1' || document.querySelectorAll('section, article, .card').length > 2)`]);
    for (const [rel, label, readyExpr] of pages) {
      await nav(rel, label);
      let ready = true;
      try { await waitFor(readyExpr, 30000); } catch (e) { ready = false; }
      if (label === 'eva_A') {
        // wait for the cache measurement to finish (it can take over 600 ms offline); record how long it took
        const tS = Date.now();
        await waitFor(`/Offline ready/.test((document.querySelector('#setup #offline-slot .offl-state') || {}).textContent || '')`, 15000).catch(() => {});
        R.eva_setup_state_ms = Date.now() - tS;
        const offState = await evaluate(`(document.querySelector('#setup #offline-slot .offl-state') || {}).textContent || ''`);
        await shot('offline_eva_A_setup');
        R.eva_setup_offline_state = offState;
        check(`${name} offline eva_A: setup dialog shows offline ready`, /Offline ready/.test(offState), `${offState} (after ${R.eva_setup_state_ms} ms)`);
      }
      if (label.startsWith('eva')) await evaluate(`(() => { const d = document.getElementById('setup'); if (d && d.open) d.close('close'); return true; })()`).catch(() => {});
      await idle();
      await sleep(800);
      const info = await evaluate(`(() => {
        const vis = (e) => e && !e.hidden && e.getBoundingClientRect().width > 0;
        const tiles = [...document.querySelectorAll('img.leaflet-tile')];
        const own = tiles.filter((i) => i.src.startsWith(${JSON.stringify(base)} + 'tiles/'));
        const ok = own.filter((i) => i.classList.contains('leaflet-tile-loaded') && i.naturalWidth === 256);
        const bootErr = document.getElementById('boot-error');
        const txt = (sel) => [...document.querySelectorAll(sel)].map((e) => e.innerText).join(' | ');
        const panelText = ${JSON.stringify(label)}.startsWith('eva') ? txt('#v2, #v3, #v4, #v5, #v6, #v8')
          : ${JSON.stringify(label)} === 'map' ? txt('#pane-route') : document.body.innerText;
        return { controlled: !!navigator.serviceWorker.controller, own_tiles: own.length, own_tiles_loaded: ok.length,
          zoom: (window.evaMap || window.galeMap) ? (window.evaMap || window.galeMap).getZoom() : null,
          boot_error: vis(bootErr) ? bootErr.textContent : '', digits: (panelText.match(/\\d/g) || []).length,
          sample: panelText.replace(/\\s+/g, ' ').slice(0, 220), offline_btn: document.querySelector('#offline-slot .offl-btn')?.innerText || null };
      })()`);
      await shot('offline_' + label);
      const failedOwn = page.failed.filter((f) => f.url && f.url.startsWith(base)).map((f) => ({ ...f, rel: f.url.slice(base.length).split('?')[0] }));
      const failedListed = failedOwn.filter((f) => listed.has(f.rel));
      const classify = (l) => {
        const u = l.url || (l.text.match(/https?:\/\/\S+/) || [''])[0];
        if (/trek\.nasa\.gov/.test(u)) return 'external_tile';
        if (u.startsWith(base + 'tiles/') && !tileList.has(u.slice(base.length).split('?')[0])) return 'own_tile_not_listed';
        if (l.source === 'network' && /favicon/.test(u)) return 'favicon';
        return 'other';
      };
      const logs = page.log.map((l) => ({ ...l, kind: classify(l) }));
      const counts = logs.reduce((a, l) => { a[l.kind] = (a[l.kind] || 0) + 1; return a; }, {});
      const notListedTiles = [...new Set(logs.filter((l) => l.kind === 'own_tile_not_listed').map((l) => l.url.slice(base.length)))];
      const P = { label, url: base + rel, ready, ...info, requests: page.requests, from_sw: page.from_sw, sw_net_failed: page.sw_net_failed,
        listed_tiles_served: page.listed_tiles_ok.size, failed_listed: failedListed, log_counts: counts,
        other_errors: logs.filter((l) => l.kind === 'other' && l.level === 'error'),
        other_warnings: logs.filter((l) => l.kind === 'other' && l.level !== 'error'),
        own_tiles_not_listed: notListedTiles.slice(0, 40), own_tiles_not_listed_n: notListedTiles.length };
      R.pages.push(P);
      check(`${name} offline ${label}: page starts`, ready && !info.boot_error && info.controlled, info.boot_error || `controlled ${info.controlled}`);
      // the temporary home (Plan/21 W1) shows no numbers and no map yet
      if (label !== 'home') check(`${name} offline ${label}: numbers shown`, info.digits >= 10, `${info.digits} digits: ${info.sample.slice(0, 120)}`);
      if (label !== 'cuff' && label !== 'home') check(`${name} offline ${label}: own tiles render`, info.own_tiles_loaded > 0 && P.listed_tiles_served > 0, `${info.own_tiles_loaded}/${info.own_tiles} tile imgs loaded at z${info.zoom}, ${P.listed_tiles_served} listed tiles served`);
      check(`${name} offline ${label}: no listed file failed`, failedListed.length === 0, failedListed.slice(0, 3).map((f) => f.rel).join(', '));
      check(`${name} offline ${label}: no unexpected console errors`, P.other_errors.length === 0,
        JSON.stringify(counts) + (P.other_errors.length ? ' ' + P.other_errors.slice(0, 2).map((l) => l.text).join(' / ') : ''));
      if (label === 'eva_B') {
        // replay sweep: the map follows the walker along the whole route (start, 10 steps, end) at z16
        const before = page.failed.length;
        page.listed_tiles_ok = new Set();
        const sweep = [];
        for (let k = 0; k <= 10; k++) {
          await evaluate(`(window.evaApi.seek(window.evaApi.plan.tEnd * ${k} / 10), true)`);
          await idle(500, 8000);
          sweep.push(await evaluate(`(() => { const t = [...document.querySelectorAll('img.leaflet-tile')].filter((i) => i.src.includes('/tiles/'));
            return { z: window.evaMap.getZoom(), n: t.length, ok: t.filter((i) => i.classList.contains('leaflet-tile-loaded') && i.naturalWidth === 256).length }; })()`));
        }
        const fl = page.failed.slice(before).filter((f) => f.url && f.url.startsWith(base) && listed.has(f.url.slice(base.length).split('?')[0]));
        const notListed = page.failed.slice(before).filter((f) => f.url && f.url.startsWith(base + 'tiles/') && !listed.has(f.url.slice(base.length).split('?')[0]));
        R.sweep_B = { steps: sweep, listed_served: page.listed_tiles_ok.size, failed_listed: fl.length, failed_not_listed: notListed.length };
        check(`${name} offline eva_B replay sweep: tiles along the whole route`, fl.length === 0 && sweep.every((x) => x.n > 0 && x.ok === x.n),
          `${page.listed_tiles_ok.size} listed tiles served, ${sweep.reduce((a, x) => a + x.ok, 0)}/${sweep.reduce((a, x) => a + x.n, 0)} imgs loaded over 11 steps, not-listed failures ${notListed.length}`);
        await shot('offline_eva_B_end');
        // zoom 17 (above the stored z16): expected to show upscaled z16, z17 detail tiles are not stored
        const b2 = page.failed.length;
        await evaluate(`(window.evaMap.setZoom(17), true)`);
        await idle(800, 8000);
        const z17 = page.failed.slice(b2).filter((f) => f.url && f.url.startsWith(base + 'tiles/'));
        R.zoom17_B = { failed_tiles: z17.length, sample: z17.slice(0, 3).map((f) => f.url.slice(base.length)) };
        await shot('offline_eva_B_z17');
      }
    }
    // old planning-map URL on the home page goes to map.html with the same parameters (offline, from the worker)
    await nav('index.html?route=A&tab=rad', 'home_redirect');
    let rd = null;
    try {
      await waitFor(`location.pathname.endsWith('/map.html') && document.body && document.body.dataset.ready === '1'`, 30000);
      rd = await evaluate(`({ path: location.pathname.slice(${JSON.stringify(new URL(base).pathname)}.length), search: location.search, tab: document.querySelector('[role=tab][aria-selected=true]')?.id, controlled: !!navigator.serviceWorker.controller })`);
    } catch (e) { rd = { error: String(e) }; }
    R.home_redirect = rd;
    check(`${name} offline: index.html?route=A&tab=rad redirects to map.html?route=A&tab=rad`, rd && rd.path === 'map.html' && rd.search === '?route=A&tab=rad' && rd.tab === 'tab-rad' && rd.controlled, JSON.stringify(rd));
    page = null;
    await send('Target.closeTarget', { targetId }).catch(() => {});
  } finally {
    try { ws && ws.close(); } catch (e) { /* ignore */ }
    chrome.kill();
    if (server) await stopProc(server);
    await sleep(300);
    fs.rmSync(prof, { recursive: true, force: true });
  }
}

async function main() {
  // English only (Plan/17 P1-2): no Korean dictionary in the precache list
  const koFiles = [...listed].filter((f) => /(^|\/)([a-z]+\.)?ko\.json$/.test(f));
  check('precache lists no *.ko.json (English only)', koFiles.length === 0, koFiles.join(', ') || 'none');
  await run('root', 'http://127.0.0.1:8768/', SITE, 8768, 9351);
  const sub = path.join(OUT, 'subpath');
  const link = path.join(sub, 'marswalk-gale');
  const unlinkOnly = () => { try { if (fs.lstatSync(link).isSymbolicLink()) fs.unlinkSync(link); } catch (e) { /* none */ } fs.rmSync(sub, { recursive: true, force: true }); };
  unlinkOnly();
  fs.mkdirSync(sub, { recursive: true });
  fs.symlinkSync(SITE, path.join(sub, 'marswalk-gale'));
  try {
    await run('subpath', 'http://127.0.0.1:8769/marswalk-gale/', sub, 8769, 9352);
  } finally {
    unlinkOnly(); // removes the symlink, never the site folder
  }
  result.n_fail = result.checks.filter((c) => !c.pass).length;
  result.finished = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'offline_check.json'), JSON.stringify(result, null, 1));
  console.log(`\n${result.checks.length - result.n_fail}/${result.checks.length} checks passed. → work/stage5/offline_check.json`);
}

main().then(() => process.exit(result.n_fail ? 1 : 0)).catch((e) => { console.error(e); process.exit(2); });
