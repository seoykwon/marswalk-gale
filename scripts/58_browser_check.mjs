#!/usr/bin/env node
// Stage 5-1/5-2: drive the planning page in headless Chrome via the DevTools protocol (no npm packages).
//
//   (cd site && python3 -m http.server 8765)          # in another terminal
//   node scripts/58_browser_check.mjs [http://127.0.0.1:8765/]
//
// Records: console errors / exceptions, every HTTP response >= 400 (tile 404s grouped per layer - dropped
// empty tiles are expected, Plan/10), screenshots, and the text of every [data-check] element for
// scripts/59_check_panels.py. Output: work/stage5/browser_check.json, work/stage5/screens/*.png
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASE = process.argv[2] || 'http://127.0.0.1:8765/';
const OUT = path.join(ROOT, 'work', 'stage5');
const SHOTS = path.join(OUT, 'screens');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'gale-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`,
  '--window-size=1440,900', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'],
{ stdio: 'ignore' });

async function targets() {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch (e) { await sleep(200); }
  }
  throw new Error('Chrome DevTools not reachable');
}

const result = { base: BASE, started: new Date().toISOString(), console: [], exceptions: [], http_errors: [],
  tile_404: {}, requests: 0, responses_by_type: {}, checks: {}, shots: [], steps: [], layers: {} };

let ws, seq = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((res, rej) => pending.set(id, { res, rej, method }));
}
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + expr.slice(0, 80) + ' :: ' + JSON.stringify(r.exceptionDetails).slice(0, 300));
  return r.result.value;
}
async function waitFor(expr, ms = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evaluate(expr)) return true; await sleep(150); }
  throw new Error('timeout waiting for ' + expr);
}
let inflight = 0;
async function idle(quietMs = 800, maxMs = 20000) {
  const t0 = Date.now();
  let quietSince = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (inflight > 0) quietSince = Date.now();
    if (Date.now() - quietSince > quietMs) return;
    await sleep(100);
  }
}
async function shot(name) {
  await idle();
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(SHOTS, name + '.png');
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  result.shots.push(path.relative(ROOT, f));
}
async function grabChecks(tag) {
  const v = await evaluate(`Object.fromEntries([...document.querySelectorAll('[data-check]')].map(e => [e.dataset.check, e.textContent.trim()]))`);
  Object.assign(result.checks, v);
  result.steps.push({ step: tag, n_checks: Object.keys(v).length });
}
async function scrollPanelTo(sel) {
  await evaluate(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (el) el.scrollIntoView({block:'start'}); return !!el; })()`);
  await sleep(300);
}

async function main() {
  const list = await targets();
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const reqType = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.rej(new Error(p.method + ': ' + m.error.message)); else p.res(m.result);
      return;
    }
    if (m.method === 'Network.requestWillBeSent') { inflight++; result.requests++; reqType.set(m.params.requestId, m.params.request.url); }
    if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inflight = Math.max(0, inflight - 1);
    if (m.method === 'Network.responseReceived') {
      const { url, status, mimeType } = m.params.response;
      result.responses_by_type[mimeType] = (result.responses_by_type[mimeType] || 0) + 1;
      if (status >= 400) {
        const tm = url.match(/\/tiles\/([A-Z0-9]+)\//);
        if (tm && status === 404) result.tile_404[tm[1]] = (result.tile_404[tm[1]] || 0) + 1;
        else result.http_errors.push({ url, status });
      }
      const lm = url.match(/\/tiles\/([A-Z0-9]+)\/(\d+)\//) || url.match(/trek\.nasa\.gov\/tiles\/Mars\/EQ\/([^/]+)\/.*?\/(\d+)\/\d+\/\d+\.jpg/);
      if (lm) {
        const k = lm[1].length > 6 ? (lm[1].includes('MOLA') ? 'B3' : 'B6') : lm[1];
        const o = (result.layers[k] ||= { ok: 0, not_found: 0, other: 0, zooms: {} });
        if (status === 200) o.ok++; else if (status === 404) o.not_found++; else o.other++;
        o.zooms[lm[2]] = (o.zooms[lm[2]] || 0) + 1;
      }
    }
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) {
      result.http_errors.push({ url: reqType.get(m.params.requestId), failed: m.params.errorText });
    }
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type)) {
      result.console.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400) });
    }
    if (m.method === 'Runtime.exceptionThrown') result.exceptions.push(JSON.stringify(m.params.exceptionDetails).slice(0, 600));
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Network.setCacheDisabled', { cacheDisabled: false });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });

  // 1. Route B, English (initial view)
  await send('Page.navigate', { url: BASE + 'map.html' });
  await waitFor(`document.body.dataset.ready === '1'`);
  await shot('01_routeB_en');
  // cursor readout: move the mouse to three map points, wait for the 10 m grid, record text + lat/lon
  result.readout = [];
  for (const [fx, fy] of [[0.5, 0.5], [0.35, 0.3], [0.8, 0.62]]) {
    const pt = await evaluate(`(() => { const r = document.getElementById('map').getBoundingClientRect(); return [r.left + r.width * ${fx}, r.top + r.height * ${fy}, r.width * ${fx}, r.height * ${fy}]; })()`);
    const prev = await evaluate(`document.getElementById('readout').textContent`);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: pt[0], y: pt[1] });
    await waitFor(`(() => { const s = document.getElementById('readout').textContent; return s !== ${JSON.stringify(prev)} && (/elev/.test(s) || /no 10 m grid/.test(s)); })()`, 30000);
    const ll = await evaluate(`(() => { const l = galeMap.containerPointToLatLng([${pt[2]}, ${pt[3]}]); return [l.lat, l.lng]; })()`);
    result.readout.push({ lat: ll[0], lon: ll[1], text: await evaluate(`document.getElementById('readout').textContent`) });
  }
  await grabChecks('route B en');
  await scrollPanelTo('#rt-profile'); await shot('02_routeB_profile_hazards');
  await scrollPanelTo('#rt-ls'); await shot('03_routeB_dose_thermal');
  await scrollPanelTo('#assumptions');
  await evaluate(`document.querySelector('#assumptions').open = true`); await shot('04_assumptions');

  // 2. Route A via panel button
  await evaluate(`document.querySelector('[data-route=A]').click()`); await sleep(300);
  await evaluate(`document.querySelector('[data-jump=A]').click()`);
  await shot('05_routeA_en');
  await grabChecks('route A en');

  // 3. Radiation (recent, then early) and temperature
  await evaluate(`document.querySelector('#tab-rad').click()`); await sleep(300);
  await shot('06_rad_recent'); await grabChecks('rad recent');
  await scrollPanelTo('#r2'); await shot('07_rad_spike');
  await scrollPanelTo('#r4'); await shot('08_rad_r4_r5');
  await evaluate(`document.querySelector('[data-period=early]').click()`); await sleep(300);
  await grabChecks('rad early');
  await evaluate(`document.querySelector('[data-period=recent]').click()`); await sleep(200);
  await evaluate(`document.querySelector('#tab-temp').click()`); await sleep(300);
  await shot('09_temp_A'); await grabChecks('temp A');
  await evaluate(`document.querySelector('[data-set=B]').click()`); await sleep(300);
  await grabChecks('temp B');
  await scrollPanelTo('#h2'); await shot('10_temp_B_h2_h3');
  await scrollPanelTo('#h6'); await shot('11_temp_B_h6_h7');

  // 4. Every layer on (bases one at a time) at three views; tile requests counted per layer
  const ids = await evaluate(`[...document.querySelectorAll('[data-toggle]')].map(e => [e.dataset.toggle, e.type])`);
  result.layer_ids = ids.map((x) => x[0]);
  const views = [['gale', null], ['B', null], ['A', null]];
  for (const [id, type] of ids) {
    if (type === 'checkbox') {
      await evaluate(`(() => { const e = document.querySelector('[data-toggle="${id}"]'); if (!e.checked) e.click(); return true; })()`);
      await sleep(250);
    }
  }
  for (const [id, type] of ids) {
    if (type !== 'radio') continue;
    await evaluate(`document.querySelector('[data-toggle="${id}"]').click()`);
    for (const [v] of views) { await evaluate(`document.querySelector('[data-jump="${v}"]').click()`); await idle(600); }
  }
  // zoom sweep on route B with B2 base and all overlays
  await evaluate(`document.querySelector('[data-toggle="B2"]').click()`);
  for (const z of [10, 12, 14, 16, 17]) { await evaluate(`galeMap.setView([-4.814, 137.383], ${z}, {animate:false}), true`); await idle(600); }
  await evaluate(`document.querySelector('[data-jump=B]').click()`);
  await shot('12_all_layers_routeB');
  // overlays off again except slope + line of sight, then a clean B view
  for (const [id, type] of ids) {
    if (type === 'checkbox' && !['P1A', 'P1B', 'T2', 'T5B', 'M5', 'M1'].includes(id)) {
      await evaluate(`(() => { const e = document.querySelector('[data-toggle="${id}"]'); if (e.checked) e.click(); return true; })()`);
      await sleep(100);
    }
  }
  await shot('13_routeB_slope_los');
  // Gale overview: MOLA external (B3) vs own T6 at the same view, to confirm the zoomOffset visually
  await evaluate(`galeMap.setView([-5.0, 137.6], 6, {animate:false}), true`);
  await evaluate(`document.querySelector('[data-toggle="B3"]').click()`); await shot('14_gale_B3_trek_mola');
  await evaluate(`document.querySelector('[data-toggle="T6"]').click()`); await shot('15_gale_T6_own_mola');
  await evaluate(`document.querySelector('[data-toggle="B1"]').click()`); await shot('16_gale_B1_ctx');

  // 5. Photo popup + lightbox
  await evaluate(`document.querySelector('[data-toggle="B2"]').click()`);
  await evaluate(`document.querySelector('#tab-route').click()`);
  await evaluate(`document.querySelector('[data-route=B]').click()`); await sleep(400);
  await evaluate(`document.querySelector('[data-jump=B]').click()`);
  await scrollPanelTo('.thumbs');
  const hasThumb = await evaluate(`!!document.querySelector('#pane-route [data-photo]')`);
  if (hasThumb) { await evaluate(`document.querySelector('#pane-route [data-photo]').click()`); await sleep(800); await shot('17_photo_lightbox'); await evaluate(`document.querySelector('.lb-close').click()`); }
  result.photo_lightbox_tested = hasThumb;

  // 6. (Korean screens removed: the site is English only, Plan/17 P1-2. ?lang=ko is probed at the end.)
  await evaluate(`document.querySelector('#tab-rad').click()`); await sleep(300); await shot('19_rad_en');

  // 7. Keyboard: tab order reaches the layer list and the tabs; arrow keys switch tabs
  await evaluate(`document.querySelector('#tab-rad').focus()`);
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowRight', code: 'ArrowRight', windowsVirtualKeyCode: 39 });
  await sleep(200);
  result.keyboard_tab_switch = await evaluate(`document.activeElement.id + ' / ' + document.querySelector('#tab-temp').getAttribute('aria-selected')`);

  // 7b. Light colour scheme (tokens re-stepped for light mode)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }] });
  await evaluate(`document.querySelector('#tab-temp').click()`); await sleep(300);
  await shot('19b_temp_light');
  await evaluate(`document.querySelector('#tab-route').click()`); await sleep(300);
  await shot('19c_route_light');

  // 8. Stage 5-3: draw tool on desktop (mouse clicks along route A's vertices, undo, outside-grid, keyboard, Korean)
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
  await send('Page.navigate', { url: BASE + 'map.html?route=A' });
  await waitFor(`document.body.dataset.ready === '1'`);
  const rt = await evaluate(`fetch('data/routes.json').then(r => r.json()).then(d => Object.fromEntries(Object.entries(d.routes).map(([k, r]) => [k, { line: r.line, summary: r.summary }])))`);
  result.draw = { route_summary: { A: rt.A.summary, B: rt.B.summary } };
  await evaluate(`document.querySelector('[data-jump=A]').click()`);
  await idle(600);
  await evaluate(`galeMap.fitBounds(L.latLngBounds(${JSON.stringify(rt.A.line.map(([lo, la]) => [la, lo]))}), { padding: [60, 60], animate: false }), true`);
  await sleep(500);
  const mapPt = (lon, lat) => evaluate(`(() => { const r = document.getElementById('map').getBoundingClientRect(); const p = galeMap.latLngToContainerPoint([${lat}, ${lon}]); return [r.left + p.x, r.top + p.y]; })()`);
  const click = async (x, y) => {
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 });
    await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 });
    await sleep(40);
  };
  const state = () => evaluate(`(() => { const s = galeDraw.state; return { pts: s.pts.length, active: s.active, status: s.status, result: s.result && { n_points: s.result.n_points, total_m: s.result.total_m, in_m: s.result.in_m, out_m: s.result.out_m, climb_m: s.result.climb_m, descent_m: s.result.descent_m, time_s: s.result.time_s, impassable_m: s.result.impassable_m, slope_max: s.result.slope_max, classes: s.result.classes } }; })()`);
  const gridBefore = await evaluate(`performance.getEntriesByType('resource').filter(e => /elev_10m|slope_10m/.test(e.name)).length`);
  result.draw.grid_requests_before_first_use = gridBefore;
  await evaluate(`document.getElementById('dr-toggle').click()`);
  await waitFor(`galeDraw.state.active`);
  const verts = rt.A.line;
  result.draw.vertices = verts.length;
  for (const [lo, la] of verts) { const [x, y] = await mapPt(lo, la); await click(x, y); }
  result.draw.after_clicks = await state();
  // undo one point (button), then re-add it
  await evaluate(`document.getElementById('dr-undo').click()`); await sleep(100);
  result.draw.after_undo = await state();
  { const [lo, la] = verts[verts.length - 1]; const [x, y] = await mapPt(lo, la); await click(x, y); }
  await evaluate(`document.getElementById('dr-finish').click()`);
  await waitFor(`galeDraw.state.status === 'ready' && !galeDraw.state.active`);
  result.draw.clicks = await state();
  result.draw.clicks.drawn_latlngs = await evaluate(`galeDraw.state.pts`);
  result.draw.grid_requests_after = await evaluate(`performance.getEntriesByType('resource').filter(e => /elev_10m|slope_10m/.test(e.name)).length`);
  result.draw.tab_open = await evaluate(`document.getElementById('tab-draw').getAttribute('aria-selected')`);
  await grabChecks('draw clicks');
  await evaluate(`document.getElementById('dr-profile') && document.getElementById('dr-profile').scrollIntoView()`);
  await scrollPanelTo('#pane-draw h2'); await shot('21_draw_routeA_desktop');
  await scrollPanelTo('#dr-profile'); await shot('21b_draw_profile');
  // same vertices, exact (no pixel rounding): separates pixel error from grid-vs-2m error
  await evaluate(`galeDraw.setLine(${JSON.stringify(verts.map(([lo, la]) => [la, lo]))})`);
  await waitFor(`galeDraw.state.status === 'ready' && galeDraw.state.result.n_points === ${verts.length}`);
  result.draw.exact = await state();
  await grabChecks('draw exact');
  // line partly outside the 10 m grid: first vertex inside, second 0.05 deg west (outside)
  await evaluate(`galeDraw.setLine([[${verts[0][1]}, ${verts[0][0]}], [${verts[0][1]}, ${verts[0][0] - 0.3}]])`);
  await waitFor(`galeDraw.state.status === 'ready' && galeDraw.state.pts.length === 2`);
  result.draw.outside = await state();
  result.draw.outside_text = await evaluate(`document.querySelector('#dr-body').innerText.slice(0, 400)`);
  await evaluate(`galeMap.fitBounds([[${verts[0][1] - 0.01}, ${verts[0][0] - 0.3}], [${verts[0][1] + 0.01}, ${verts[0][0]}]], {animate:false}), true`);
  await idle(600); await shot('22_draw_outside_grid');
  // keyboard: Enter on the toolbar button starts drawing, arrow keys move the map, Enter adds, Backspace undoes, F finishes
  const key = async (k, code, vk, text) => {
    await send('Input.dispatchKeyEvent', { type: text ? 'keyDown' : 'rawKeyDown', key: k, code, windowsVirtualKeyCode: vk, text });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  };
  await evaluate(`galeDraw.clear(); galeDraw.finish(); galeMap.setView([${verts[0][1]}, ${verts[0][0]}], 17, {animate:false}), true`);
  await sleep(300);
  await evaluate(`document.getElementById('dr-toggle').focus()`);
  await key('Enter', 'Enter', 13, '\r'); await sleep(200);
  result.draw.kb = { started: await evaluate(`galeDraw.state.active`), focus_on_map: await evaluate(`document.activeElement === galeMap.getContainer()`) };
  await key('Enter', 'Enter', 13, '\r');
  await key('ArrowRight', 'ArrowRight', 39); await sleep(500);
  await key('Enter', 'Enter', 13, '\r');
  await key('ArrowDown', 'ArrowDown', 40); await sleep(500);
  await key('Enter', 'Enter', 13, '\r'); await sleep(100);
  result.draw.kb.pts_after_3 = await evaluate(`galeDraw.state.pts.length`);
  await key('Backspace', 'Backspace', 8); await sleep(100);
  result.draw.kb.pts_after_backspace = await evaluate(`galeDraw.state.pts.length`);
  await key('ArrowDown', 'ArrowDown', 40); await sleep(500);
  await key('Enter', 'Enter', 13, '\r'); await sleep(100);
  await shot('24_draw_keyboard_crosshair');
  await key('f', 'KeyF', 70, 'f'); await sleep(200);
  await waitFor(`galeDraw.state.status === 'ready'`);
  result.draw.kb.final = await state();

  // 8b. Links to EVA mode / cuff checklist
  await evaluate(`galeDraw.clear()`);
  await evaluate(`document.querySelector('#tab-route').click()`); await sleep(300);
  const links = async () => evaluate(`({ eva: document.getElementById('btn-eva').getAttribute('href'), cuff: document.getElementById('btn-cuff').getAttribute('href'), aria: document.getElementById('btn-eva').getAttribute('aria-disabled') })`);
  result.links = { A: await links() };
  await evaluate(`(() => { const e = document.getElementById('rt-start'); e.value = '9'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  result.links.A_start9 = await links();
  await evaluate(`document.querySelector('[data-route=B]').click()`); await sleep(400);
  result.links.B = await links();
  await evaluate(`(() => { const e = document.getElementById('rt-ls'); e.value = '300'; e.dispatchEvent(new Event('change', { bubbles: true })); })()`); await sleep(300);
  result.links.B_ls300 = await links();
  await scrollPanelTo('#btn-eva'); await shot('25_route_buttons');

  // 9. Mobile layouts: 390x844 and 360x640, touch input
  result.mobile = {};
  await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const tap = async (x, y) => {
    await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await sleep(80);
  };
  const centre = (sel) => evaluate(`(() => { const r = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
  const measure = () => evaluate(`(() => {
    const R = (e) => e.getBoundingClientRect();
    const m = R(document.getElementById('map')), p = R(document.getElementById('panel')), a = R(document.querySelector('.leaflet-control-attribution'));
    const top = R(document.querySelector('.topbar'));
    const btns = [...document.querySelectorAll('#drawbar .btn, #sheet-handle, .topbar .btn, .topbar button')].filter((b) => R(b).width > 0 && R(b).height > 0) // skip closed popups (offline panel, 5-5)
      .map((b) => Math.min(R(b).width, R(b).height));
    const vh = window.innerHeight, vw = window.innerWidth;
    return { vw, vh, overflow_x: document.documentElement.scrollWidth - vw, sheet: document.getElementById('panel').dataset.sheet,
      topbar_h: Math.round(top.height), sheet_h: Math.round(p.height), map_free_h: Math.round(Math.min(p.top, vh) - top.bottom),
      map_free_share: +((Math.min(p.top, vh) - top.bottom) / vh).toFixed(3),
      attr_w: Math.round(a.width), attr_h: Math.round(a.height), attr_share_of_map: +(a.width * a.height / (m.width * m.height)).toFixed(4),
      attr_above_sheet: a.bottom <= p.top + 1, min_touch_target_px: Math.round(Math.min(...btns)) };
  })()`);
  const mobileRun = async (w, h, tag, full) => {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 2, mobile: true });
    await send('Page.navigate', { url: BASE + 'map.html?route=B' });
    await waitFor(`document.body.dataset.ready === '1'`);
    await sleep(500);
    const M = { size: `${w}x${h}` };
    M.collapsed = await measure();
    await shot(`${tag}_collapsed`);
    await tap(...(await centre('#sheet-handle'))); await sleep(400);
    M.half = await measure();
    await shot(`${tag}_half`);
    if (full) {
      await tap(...(await centre('#sheet-handle'))); await sleep(400);
      M.full = await measure();
      await shot(`${tag}_full`);
      await tap(...(await centre('#sheet-handle'))); await sleep(400);
    } else { await evaluate(`document.getElementById('sheet-handle').click(); document.getElementById('sheet-handle').click()`); await sleep(400); }
    M.back_to_collapsed = await evaluate(`document.getElementById('panel').dataset.sheet`);
    // layer drawer
    await tap(...(await centre('#btn-layers'))); await sleep(400);
    M.drawer_open = await evaluate(`document.getElementById('layers').classList.contains('open')`);
    await shot(`${tag}_layers`);
    await tap(...(await centre('#btn-layers'))); await sleep(400);
    // route buttons reachable inside the sheet
    // draw by touch: toggle, 4 taps, undo, 1 tap, finish
    await tap(...(await centre('#dr-toggle'))); await sleep(300);
    M.draw_started = await evaluate(`galeDraw.state.active`);
    M.sheet_while_drawing = await evaluate(`document.getElementById('panel').dataset.sheet`);
    const mp = await evaluate(`(() => { const r = document.getElementById('map').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()`);
    const pts = [[0.25, 0.25], [0.45, 0.35], [0.6, 0.3], [0.7, 0.42], [0.55, 0.5]];
    for (const [fx, fy] of pts.slice(0, 4)) await tap(mp[0] + mp[2] * fx, mp[1] + mp[3] * fy);
    await shot(`${tag}_draw`);
    await tap(...(await centre('#dr-undo'))); await sleep(200);
    await tap(mp[0] + mp[2] * pts[4][0], mp[1] + mp[3] * pts[4][1]);
    M.pts_touch = await evaluate(`galeDraw.state.pts.length`);
    await tap(...(await centre('#dr-finish'))); await sleep(300);
    await waitFor(`galeDraw.state.status === 'ready' || galeDraw.state.status === 'idle'`);
    M.draw_final = await state();
    M.sheet_after_finish = await evaluate(`document.getElementById('panel').dataset.sheet`);
    M.draw_tab = await evaluate(`document.getElementById('tab-draw').getAttribute('aria-selected')`);
    await sleep(500);
    await shot(`${tag}_draw_result`);
    // attribution tap expands
    M.attr_after_draw = await measure();
    result.mobile[tag] = M;
  };
  await mobileRun(390, 844, '30_m390', true);
  await mobileRun(360, 640, '31_m360', false);
  await send('Emulation.setTouchEmulationEnabled', { enabled: false });

  // 10. English only (Plan/17 P1-2): an old ?lang=ko link renders English (checked by 59_check_panels.py)
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: BASE + 'map.html?lang=ko' });
  await waitFor(`document.body.dataset.ready === '1'`);
  await sleep(500);
  result.en_only = await evaluate(`({ lang: document.documentElement.lang, title: document.title, langBtns: document.querySelectorAll('[data-lang]').length,
    hangul: /[\\uac00-\\ud7a3\\u3131-\\u318e]/.test(document.body.innerText + document.title) })`);
  await shot('40_map_lang_ko_ignored');

  // 11. Site move (Plan/21 W1): home links on the map page, and the old map URL on index.html redirects to map.html
  result.home = await evaluate(`(() => { const t = document.getElementById('lnk-home'); document.querySelector('#tab-about').click();
    const a = document.getElementById('about-home'); return { title_href: t && t.getAttribute('href'), title_text: t && t.textContent.trim(), about_href: a && a.getAttribute('href') }; })()`);
  result.redirect = [];
  for (const q of ['?route=A', '?route=A&tab=rad', '?tab=temp', '']) {
    await send('Page.navigate', { url: BASE + 'index.html' + q });
    const want = q ? 'map.html' : 'index.html';
    await waitFor(`location.pathname.endsWith('/${want}') && document.readyState === 'complete' && (${!!q} ? document.body.dataset.ready === '1' : document.querySelectorAll('.cards a').length === 3)`);
    await sleep(300);
    result.redirect.push(await evaluate(`({ from: ${JSON.stringify(q)}, path: location.pathname.split('/').pop(), search: location.search, route: window.galeMap ? document.querySelector('[data-route].on, [data-route][aria-pressed=true]')?.dataset.route ?? null : null,
      tab: document.querySelector('[role=tab][aria-selected=true]')?.id ?? null, cards: document.querySelectorAll('.cards a').length, history: history.length })`));
    if (!q) {
      // home page (W2 skeleton): strings and [data-fact] values filled by src/site/site.js
      await waitFor(`document.body.dataset.ready === '1' || document.body.dataset.ready === 'error'`);
      result.home_page = await evaluate(`({ ready: document.body.dataset.ready, error: document.body.dataset.siteError || null, factsMissing: document.body.dataset.factsMissing,
        facts: [...document.querySelectorAll('[data-fact]')].map((e) => [e.dataset.fact, e.textContent]),
        nav: [...document.querySelectorAll('#site-nav a')].map((a) => [a.getAttribute('href'), a.getAttribute('aria-current')]),
        cards: [...document.querySelectorAll('.cards a')].map((a) => a.getAttribute('href')),
        footer: document.getElementById('site-footer').innerText.trim(), title: document.title,
        overflowX: document.documentElement.scrollWidth - window.innerWidth })`);
      await shot('41_home_tmp');
    }
  }

  result.finished = new Date().toISOString();
  fs.writeFileSync(path.join(OUT, 'browser_check.json'), JSON.stringify(result, null, 1));
  console.log(JSON.stringify({
    console: result.console.length, exceptions: result.exceptions.length, http_errors: result.http_errors.length,
    tile_404: result.tile_404, requests: result.requests, checks: Object.keys(result.checks).length,
    layers: Object.fromEntries(Object.entries(result.layers).map(([k, v]) => [k, `${v.ok} ok / ${v.not_found} 404 z${Object.keys(v.zooms).join(',')}`])),
    keyboard: result.keyboard_tab_switch, draw: result.draw && { clicks: result.draw.clicks, exact: result.draw.exact, kb: result.draw.kb }, links: result.links, mobile: result.mobile, shots: result.shots.length,
  }, null, 1));
}

main().then(() => { ws.close(); chrome.kill(); }, (e) => {
  console.error(e);
  fs.writeFileSync(path.join(OUT, 'browser_check.json'), JSON.stringify({ ...result, fatal: String(e) }, null, 1));
  chrome.kill();
  process.exitCode = 1;
});
