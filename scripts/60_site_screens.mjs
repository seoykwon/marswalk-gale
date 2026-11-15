#!/usr/bin/env node
// W3: capture the website screenshots in headless Chrome (DevTools protocol, no npm packages).
//   (cd site && python3 -m http.server 8775)
//   node scripts/60_site_screens.mjs [http://127.0.0.1:8775/]
// Output: site/img/*.jpg|png and site/img/screens.json (file, width, height, bytes, alt, shows).
// Limits (Plan/18 sec.4): <=150 KB each, <=1.5 MB total. Encoding uses Chrome's own JPEG/PNG; the quality is
// lowered step by step until a file fits.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASE = process.argv[2] || 'http://127.0.0.1:8775/';
const OUT = path.join(ROOT, 'site', 'img');
fs.mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9335;
const MAX = 150000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'marswalk-shots-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`,
  '--window-size=1280,800', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });

let ws, seq = 0, inflight = 0;
const pending = new Map();
const send = (method, params = {}) => { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => pending.set(id, { res, rej, method })); };
async function ev(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + expr.slice(0, 80) + ' :: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
async function waitFor(expr, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await ev(expr)) return true; await sleep(150); }
  throw new Error('timeout waiting for ' + expr);
}
async function idle(quiet = 900, max = 25000) {
  const t0 = Date.now(); let q = Date.now();
  while (Date.now() - t0 < max) { if (inflight > 0) q = Date.now(); if (Date.now() - q > quiet) return; await sleep(100); }
}
async function viewport(w, h, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile });
}
async function open(url, ready = `document.body.dataset.ready === '1'`) {
  await send('Page.navigate', { url: BASE + url });
  await waitFor(ready);
  await sleep(300);
}
const manifest = [];
async function shot(file, alt, shows, opts = {}) {
  await idle(); await sleep(250);
  const png = file.endsWith('.png');
  const params = { format: png ? 'png' : 'jpeg', ...(opts.clip ? { clip: { ...opts.clip, scale: 1 } } : {}), captureBeyondViewport: !!opts.full };
  let q = opts.q || 82, buf;
  for (;;) {
    if (!png) params.quality = q;
    buf = Buffer.from((await send('Page.captureScreenshot', params)).data, 'base64');
    if (buf.length <= MAX || png || q <= 40) break;
    q -= 6;
  }
  fs.writeFileSync(path.join(OUT, file), buf);
  const dim = png ? [buf.readUInt32BE(16), buf.readUInt32BE(20)] : jpegSize(buf);
  manifest.push({ file, width: dim[0], height: dim[1], bytes: buf.length, alt, shows, ...(png ? {} : { jpeg_quality: q }) });
  console.log(file, dim.join('x'), buf.length);
}
function jpegSize(b) {
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const m = b[i + 1];
    if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
    i += 2 + b.readUInt16BE(i + 2);
  }
  return [0, 0];
}
const scrollPanelTo = async (sel) => { await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return false; e.scrollIntoView({block:'start'}); for (let p = e.parentElement; p; p = p.parentElement) { if (p.scrollHeight > p.clientHeight + 5 && getComputedStyle(p).overflowY !== 'visible') { p.scrollTop -= 70; break; } } return true; })()`); await sleep(400); };
const click = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (e) e.click(); return !!e; })()`);

async function main() {
  let list;
  for (let i = 0; i < 50; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); break; } catch { await sleep(200); } }
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  ws.addEventListener('message', (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); if (m.error) p.rej(new Error(p.method + ': ' + m.error.message)); else p.res(m.result); return; }
    if (m.method === 'Network.requestWillBeSent') inflight++;
    if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inflight = Math.max(0, inflight - 1);
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await viewport(1280, 800);

  // 1. Route B + route panel
  await open('map.html?route=B');
  await shot('map-route-b.jpg', 'Marswalk planning map: route B drawn over Gale Crater imagery, with the route panel showing distance, time and hazards.',
    'Map, route B selected, Route tab of the side panel.');
  // 2. Radiation panel charts
  await click('#tab-rad'); await sleep(400);
  await scrollPanelTo('#r2');
  await shot('map-radiation.jpg', 'Map with the Radiation tab open: charts of the dose rate measured by the Curiosity RAD instrument over recent sols.',
    'Map, Radiation tab, dose-rate charts (RAD measurements).');
  // 3. Temperature panel
  await click('#tab-temp'); await sleep(400);
  await scrollPanelTo('#h2');
  await shot('map-temperature.jpg', 'Map with the Temperature tab open: ground and air temperature charts measured by the Curiosity REMS instrument.',
    'Map, Temperature tab, REMS temperature charts.');
  // 4. Draw tool
  await open('map.html?route=B&tab=draw');
  await click('#dr-toggle'); await sleep(300);
  const pts = [[0.30, 0.62], [0.42, 0.50], [0.55, 0.48], [0.66, 0.36]];
  for (const [fx, fy] of pts) {
    const p = await ev(`(() => { const r = document.getElementById('map').getBoundingClientRect(); return [r.left + r.width * ${fx}, r.top + r.height * ${fy}]; })()`);
    for (const t of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type: t, x: p[0], y: p[1], button: 'left', clickCount: 1 });
    await sleep(350);
  }
  await click('#dr-finish'); await sleep(900);
  await shot('map-draw.jpg', 'Map with a hand-drawn line and the Draw tab showing its length, elevation profile and slope statistics.',
    'Draw tool: a 4-point line analysed against the 10 m terrain grid.');
  // 5. Alignment / layer overlay: slope + line of sight over route B
  await open('map.html?route=B');
  await ev(`(() => { for (const id of ['P1B','T2','T5B','M5']) { const e = document.querySelector('[data-toggle="'+id+'"]'); if (e && e.type==='checkbox' && !e.checked) e.click(); } return true; })()`);
  await ev(`galeMap.setView([-4.814, 137.383], 15, {animate:false}), true`);
  await idle(1200);
  await shot('map-layers.jpg', 'Map zoomed on route B with slope and line-of-sight layers switched on over the satellite imagery.',
    'Layer overlays (slope, line of sight and others) on route B at zoom 15; layer list on the left.');

  // 6. EVA landscape mid-replay
  await open('eva.html', `document.body.dataset.ready === '1' && !!window.evaApi`);
  await ev(`(() => { const d = document.getElementById('setup'); if (d.open) d.close('close'); return true; })()`);
  await ev(`(() => { const a = evaApi; a.seek(a.plan.tEnd * 0.3); return true; })()`);
  await sleep(800);
  await shot('eva-landscape.jpg', 'EVA replay screen in landscape: map with the walker position and cards for next stop, turnaround margin, slope, dose and comms, with the replay controls below.',
    'EVA mode at about 30% of the replay, 1280x800.');
  // 7. EVA portrait
  await viewport(390, 844, true);
  await ev(`evaApi.seek(evaApi.plan.tEnd * 0.3), true`);
  await sleep(900);
  await shot('eva-portrait.jpg', 'EVA replay screen on a phone in portrait: header, map, status cards and large replay buttons.',
    'EVA mode at about 30% of the replay, 390x844 phone viewport.');
  await viewport(1280, 800);

  // 8. Cuff checklist sheet
  await open('cuff.html');
  const clip = await ev(`(() => { const s = document.querySelector('.sheet'); const r = s.getBoundingClientRect(); return {x: Math.max(0, r.left + scrollX), y: r.top + scrollY, width: r.width, height: r.height}; })()`);
  await viewport(1280, Math.max(800, Math.ceil(clip.y + clip.height + 10)));
  await sleep(400);
  await shot('cuff-sheet.jpg', 'First printable cuff checklist sheet: a grid of small cards with the stop, time, distance and limits for a walking EVA.',
    'First sheet of the cuff checklist (A4 layout, 8 cards per page), cropped to the sheet.', { clip });

  fs.writeFileSync(path.join(OUT, 'screens.json'), JSON.stringify({ generated: new Date().toISOString(), total_bytes: manifest.reduce((s, m) => s + m.bytes, 0), screens: manifest }, null, 1) + '\n');
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => { try { ws.close(); } catch {} chrome.kill(); });
