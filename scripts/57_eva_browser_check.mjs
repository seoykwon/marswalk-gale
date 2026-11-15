#!/usr/bin/env node
// Stage 5-4: drive the EVA page (site/eva.html) in headless Chrome via the DevTools protocol (no npm packages).
//
//   (cd site && python3 -m http.server 8766)          # in another terminal
//   node scripts/57_eva_browser_check.mjs [http://127.0.0.1:8766/]
//
// Checks: self-test (eva.html?selftest=1), end-of-replay totals vs the numbers the planning page actually
// draws (map.html [data-check]), replay at every speed, both scenarios, both routes, turnaround cases,
// landscape 1024x768 and portrait 360x640, button sizes, text contrast, keyboard, control bar inside the viewport
// (4 viewports, banner hidden and shown), English-only (?lang=ko ignored), console errors.
// Output: work/stage5/eva_check.json, work/stage5/eva_screens/*.png. Exit code 1 when a check fails.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASE = process.argv[2] || 'http://127.0.0.1:8766/';
const OUT = path.join(ROOT, 'work', 'stage5');
const SHOTS = path.join(OUT, 'eva_screens');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9341; // 58_browser_check.mjs uses 9333
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'gale-eva-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`,
  '--window-size=1024,768', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'],
{ stdio: 'ignore' });

const result = { base: BASE, started: new Date().toISOString(), console: [], exceptions: [], http_errors: [],
  tile_404: {}, requests: 0, checks: [], shots: [], selftest: null, replays: [], layout: {}, contrast: {}, panel_vs_eva: [] };
const check = (name, pass, detail = '') => { result.checks.push({ name, pass: !!pass, detail: String(detail) }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  — ' + detail : '')); };

async function targets() {
  for (let i = 0; i < 50; i++) {
    try { return await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch (e) { await sleep(200); }
  }
  throw new Error('Chrome DevTools not reachable');
}
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
async function waitFor(expr, ms = 30000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await evaluate(expr)) return true; await sleep(150); }
  throw new Error('timeout waiting for ' + expr);
}
let inflight = 0;
async function idle(quietMs = 600, maxMs = 15000) {
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
  await sleep(200);
  const r = await send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(SHOTS, name + '.png');
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  result.shots.push(path.relative(ROOT, f));
}
async function viewport(w, h, mobile = false) {
  await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile,
    screenOrientation: w > h ? { type: 'landscapePrimary', angle: 90 } : { type: 'portraitPrimary', angle: 0 } });
}
async function open(q, { selftest = false } = {}) {
  await send('Page.navigate', { url: BASE + 'eva.html' + q });
  await waitFor(`document.body && document.body.dataset.ready === '1'`);
  if (selftest) await waitFor(`!!document.body.dataset.selftest`);
  await sleep(300);
}
async function closeSetup() {
  await evaluate(`(() => { const d = document.getElementById('setup'); if (d.open) d.close('close'); return true; })()`);
  await sleep(100);
}
async function key(k, code, vk, text) {
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: vk, text });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code, windowsVirtualKeyCode: vk });
  await sleep(120);
}
const texts = () => evaluate(`Object.fromEntries([...document.querySelectorAll('[data-check]')].map(e => [e.dataset.check, e.textContent.trim()]))`);

// contrast of every visible text node against the first opaque ancestor background (WCAG relative luminance)
const CONTRAST_JS = `(() => {
  const lum = (c) => { const m = c.match(/[\\d.]+/g).map(Number); const f = (x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
  const alpha = (c) => { const m = c.match(/[\\d.]+/g); return m && m.length === 4 ? Number(m[3]) : 1; };
  const bgOf = (el) => { for (let e = el; e; e = e.parentElement) { const b = getComputedStyle(e).backgroundColor; if (b && alpha(b) > 0.5) return b; } return 'rgb(0,0,0)'; };
  const out = []; const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walker.nextNode());) {
    if (!n.textContent.trim()) continue;
    const el = n.parentElement;
    if (!el || seen.has(el)) continue; seen.add(el);
    if (el.closest('.leaflet-tile-pane, [hidden], dialog:not([open]), option, .vh')) continue;
    const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const fg = cs.color, bg = bgOf(el);
    const a = lum(fg), b = lum(bg); const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    out.push({ text: n.textContent.trim().slice(0, 40), ratio: Math.round(ratio * 100) / 100, fg, bg, size: cs.fontSize, cls: el.className && el.className.baseVal === undefined ? el.className : '' });
  }
  out.sort((x, y) => x.ratio - y.ratio);
  return { n: out.length, min: out[0], below7: out.filter((x) => x.ratio < 7), below45: out.filter((x) => x.ratio < 4.5) };
})()`;

const SIZE_JS = `(() => {
  const vis = (e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && !e.closest('[hidden], dialog:not([open])'); };
  const main = ['btn-play', 'btn-turn', 'zin', 'zout'].map((id) => document.getElementById(id)).filter(vis)
    .map((e) => ({ id: e.id, w: Math.round(e.getBoundingClientRect().width), h: Math.round(e.getBoundingClientRect().height) }));
  const others = [...document.querySelectorAll('button, select, a.btnlink, summary, input[type=checkbox]')].filter(vis)
    .filter((e) => !['btn-play', 'btn-turn', 'zin', 'zout'].includes(e.id) && !e.closest('.leaflet-control'))
    .map((e) => { const r = (e.type === 'checkbox' ? e.closest('label') || e : e).getBoundingClientRect(); return { id: e.id || e.textContent.trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height) }; });
  const gap = (a, b) => { const r1 = document.getElementById(a).getBoundingClientRect(), r2 = document.getElementById(b).getBoundingClientRect();
    return Math.round(Math.max(r2.left - r1.right, r1.left - r2.right, r2.top - r1.bottom, r1.top - r2.bottom)); };
  const z = vis(document.getElementById('zin'));
  return { main, small: others.filter((o) => o.w < 48 || o.h < 48), nOthers: others.length,
    gapPlayTurn: gap('btn-play', 'btn-turn'), gapZoom: z ? gap('zin', 'zout') : null,
    overflowX: document.documentElement.scrollWidth - window.innerWidth };
})()`;

async function main() {
  const list = await targets();
  const page = list.find((t) => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const reqUrl = new Map();
  ws.addEventListener('message', (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id);
      if (m.error) p.rej(new Error(p.method + ': ' + m.error.message)); else p.res(m.result);
      return;
    }
    if (m.method === 'Network.requestWillBeSent') { inflight++; result.requests++; reqUrl.set(m.params.requestId, m.params.request.url); }
    if (m.method === 'Network.loadingFinished' || m.method === 'Network.loadingFailed') inflight = Math.max(0, inflight - 1);
    if (m.method === 'Network.responseReceived') {
      const { url, status } = m.params.response;
      if (status >= 400) {
        const tm = url.match(/\/tiles\/([A-Z0-9]+)\//);
        if (tm && status === 404) result.tile_404[tm[1]] = (result.tile_404[tm[1]] || 0) + 1;
        else result.http_errors.push({ url, status });
      }
    }
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) result.http_errors.push({ url: reqUrl.get(m.params.requestId), failed: m.params.errorText });
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type)) {
      result.console.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400) });
    }
    if (m.method === 'Runtime.exceptionThrown') result.exceptions.push(JSON.stringify(m.params.exceptionDetails).slice(0, 600));
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await viewport(1024, 768);

  // ---------------------------------------------------------------- 1. self-test
  await open('?selftest=1', { selftest: true });
  const st = await evaluate(`({ pass: window.evaSelftest.pass, n: window.evaSelftest.n, nPass: window.evaSelftest.nPass,
    cases: window.evaSelftest.cases, totals: window.evaSelftest.totals })`);
  result.selftest = st;
  check('self-test eva.html?selftest=1', st.pass, `${st.nPass}/${st.n}`);
  for (const c of st.cases.filter((x) => !x.pass)) check('self-test case: ' + c.name, false, `expected ${c.expected}, got ${c.got}`);
  await shot('01_selftest_en');
  await evaluate(`window.scrollTo(0, 0); document.getElementById('selftest').scrollTo(0, 99999)`);
  await shot('02_selftest_cases_en');

  // ---------------------------------------------------------------- 2. planning page numbers vs EVA end-of-replay totals
  await viewport(1440, 900);
  for (const rid of ['B', 'A']) {
    await send('Page.navigate', { url: BASE + `map.html?route=${rid}` });
    await waitFor(`document.body && document.body.dataset.ready === '1'`);
    await sleep(500);
    if (rid === 'A') { await evaluate(`(() => { const b = document.querySelector('[data-route=A]'); if (b) b.click(); return true; })()`); await sleep(500); }
    const ck = await texts();
    const T = st.totals[rid];
    const P = `route.${rid}`;
    const pairs = [
      ['dist_m', 'one-way distance', (p, e) => e === p],
      ['round_trip_m', 'round-trip distance', (p, e) => e === p],
      ['eva_s', 'EVA total time (walk + stay)', (p, e) => e.startsWith(p)],
      ['climb_m', 'ascent / descent (one way)', (p, e) => e.startsWith(p + ' /')],
      ['descent_m', 'ascent / descent (one way)', (p, e) => e.includes('/ ' + p + ' m')],
      ['hazards_5m', 'hazard length ≥15° (one way, 5 m)', (p, e) => p.includes(e.replace(' m', ''))],
      ['comms_out_m', 'out-of-LOS length (one way)', (p, e) => e === p],
      ['dose_E', 'crew dose E (period mean)', (p, e) => e === p + ' µGy'],
      ['dose_B', 'equipment dose B (period mean)', (p, e) => e === p + ' µGy(Si)'],
    ];
    for (const [k, item, ok] of pairs) {
      const pv = ck[`${P}.${k}`];
      const ev = T[item].eva;
      const pass = pv !== undefined && ok(pv, ev);
      result.panel_vs_eva.push({ route: rid, key: k, planning_page: pv ?? null, eva: ev, pass });
      check(`route ${rid}: planning page ${k} = EVA end`, pass, `page "${pv}" / EVA "${ev}"`);
    }
  }
  // follow the planning page's own "Open EVA mode" link (Plan/13 sec.2 contract)
  const href = await evaluate(`(() => { const a = document.getElementById('btn-eva'); return a ? a.getAttribute('href') : null; })()`);
  await viewport(1024, 768);
  if (href) {
    await send('Page.navigate', { url: new URL(href, BASE + 'map.html').href });
    await waitFor(`document.body && document.body.dataset.ready === '1'`);
    const pr = await evaluate(`({ rid: evaApi.params.rid, start: evaApi.params.start, ls: evaApi.params.ls, sc: evaApi.params.scenario, lang: document.documentElement.lang })`);
    const q = new URLSearchParams(href.split('?')[1] || '');
    check('planning page link opens eva.html with its parameters', pr.rid === (q.get('route') || 'B') && String(pr.start) === String(Number(q.get('start') ?? 10))
      && pr.ls === (q.get('season') || pr.ls) && pr.sc === 'normal', `${href} -> ${JSON.stringify(pr)}`);
  } else check('planning page link opens eva.html with its parameters', false, 'no #btn-eva');

  // ---------------------------------------------------------------- 3. replays: every speed, both routes, both scenarios
  const combos = [
    { q: '?route=B&scenario=normal', tag: 'B_normal' },
    { q: '?route=B&scenario=spike4716&start=9', tag: 'B_spike' },
    { q: '?route=A&scenario=normal', tag: 'A_normal' },
    { q: '?route=A&scenario=spike4716', tag: 'A_spike_request' },
  ];
  for (const c of combos) {
    await open(c.q);
    if (c.tag === 'B_normal') await shot('03_setup_dialog_en');
    await closeSetup();
    const info = await evaluate(`({ scen: evaApi.params.scenario, req: evaApi.params.scenarioRequested, tEnd: evaApi.plan.tEnd, binding: evaApi.plan.binding })`);
    if (c.tag === 'A_spike_request') check('route A + scenario=spike4716 falls back to normal (no transient event in sols 1-359)', info.scen === 'normal' && info.req === 'spike4716');
    if (c.tag === 'B_spike') check('route B spike scenario active, binding = dose', info.scen === 'spike4716' && info.binding === 'dose', info.binding);
    for (const sp of [1, 30, 120, 600]) {
      await evaluate(`evaApi.seek(0); evaApi.setSpeed(${sp}); evaApi.play(); true`);
      const w0 = Date.now();
      await sleep(1500);
      const t = await evaluate(`evaApi.t`);
      const wall = (Date.now() - w0) / 1000;
      const expect = Math.min(info.tEnd, sp * wall);
      const ok = t > 0 && Math.abs(t - expect) <= Math.max(2, 0.25 * expect);
      result.replays.push({ combo: c.tag, speed: sp, t, expect: Math.round(expect), ok });
      check(`replay ${c.tag} ×${sp}`, ok, `t=${t.toFixed(1)} s after ${wall.toFixed(2)} s (expected ≈${expect.toFixed(0)})`);
      await evaluate(`evaApi.pause(); true`);
    }
    // run ×600 to the end and read the end-of-replay numbers from the screen
    await evaluate(`evaApi.seek(Math.max(0, evaApi.plan.tEnd - 600)); evaApi.setSpeed(600); evaApi.play(); true`);
    await waitFor(`!evaApi.playing && evaApi.t >= evaApi.plan.tEnd - 0.01`, 20000);
    await sleep(300);
    const end = await texts();
    const s = await evaluate(`({ phase: evaLast.phase, E: evaLast.dose.E, B: evaLast.dose.B, walked: evaLast.walked_m })`);
    check(`replay ${c.tag} reaches base (phase done)`, s.phase === 'done', JSON.stringify(end['eva.dose_E']));
    if (c.tag === 'B_normal' || c.tag === 'A_normal') {
      const rid = c.tag[0];
      const T = st.totals[rid];
      check(`replay ${c.tag} end dose on screen = planning panel`, end['eva.dose_E'] === T['crew dose E (period mean)'].panel && end['eva.dose_B'] === T['equipment dose B (period mean)'].panel,
        `${end['eva.dose_E']} / ${end['eva.dose_B']}`);
    }
    await shot(`04_end_${c.tag}`);
  }

  // ---------------------------------------------------------------- 4. warning and turnaround scenes (landscape)
  const scene = async (q, seekExpr, name, after) => {
    await open(q); await closeSetup();
    await evaluate(`evaApi.seek(${seekExpr}); true`);
    await sleep(400);
    const s = await evaluate(`({ status: evaLast.status, phase: evaLast.phase, slope: evaLast.slope.level, los: evaLast.comms.los, ahead: !!evaLast.comms.ahead,
      banner: !document.getElementById('banner').hidden, d: evaLast.pos.d_m, margin: evaLast.margin_s, ground: document.querySelector('[data-check="eva.ground"]').textContent })`);
    if (after) after(s);
    await shot(name);
    return s;
  };
  // B outbound at the 3rd hazard approach (1,600 m): caution banner
  let s;
  s = await scene('?route=B', `(function(){ const S = window.evaApi; let lo = 0, hi = S.plan.tArr; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (S.state(m).pos.d_m < 1600) lo = m; else hi = m; } return lo; })()`,
    '05_B_slope_caution', (x) => check('B at 1,600 m outbound: slope caution banner', x.slope === 'caution' && x.banner, `level ${x.slope}, d ${x.d.toFixed(0)}`));
  s = await scene('?route=B', `(function(){ const S = window.evaApi; let lo = 0, hi = S.plan.tArr; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (S.state(m).pos.d_m < 900) lo = m; else hi = m; } return lo; })()`,
    '06_B_no_los', (x) => check('B at 900 m: no line of sight', x.los === false));
  s = await scene('?route=B', `(function(){ const S = window.evaApi; let lo = 0, hi = S.plan.tArr; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (S.state(m).pos.d_m < 520) lo = m; else hi = m; } return lo; })()`,
    '07_B_los_ahead', (x) => check('B at 520 m: LOS loss announced ahead', x.los === true && x.ahead === true));
  s = await scene('?route=B&start=9&scenario=spike4716&pace=50', `evaApi.plan.tArr - 30`,
    '08_B_spike_pace50_turn_now', (x) => check('S3 (spike, 09:00, pace 50%): TURN BACK NOW before the turnaround point', x.status === 'now' && x.phase === 'out', `status ${x.status}, d ${x.d.toFixed(1)}`));
  const s3 = await evaluate(`({ turnD: evaApi.plan.turnD, reachable: evaApi.plan.reachable, binding: evaApi.plan.binding })`);
  check('S3 turnaround point 1,802 m (±2), binding dose', !s3.reachable && Math.abs(s3.turnD - 1802) <= 2 && s3.binding === 'dose', JSON.stringify(s3));
  s = await scene('?route=B&start=9&scenario=spike4716&pace=50', `evaApi.plan.tArr - 400`,
    '09_B_turn_soon', (x) => check('S3 400 s before turnaround (margin ≈ 13 min): TURN SOON', x.status === 'soon', x.status));
  s = await scene('?route=B&start=15', `evaApi.plan.tArr + 5`, '10_B_late_start_sunset', (x) => check('S4 15:00 start: binding sunset, stay curtailed', true, x.status));
  const s4 = await evaluate(`({ binding: evaApi.plan.binding, maxStay: evaApi.plan.maxStay, stay: evaApi.plan.stay })`);
  check('S4 binding = daylight, max stay 17 s', s4.binding === 'daylight' && Math.abs(s4.maxStay - 17) <= 1 && Math.abs(s4.stay - s4.maxStay) < 1e-6, JSON.stringify(s4));
  s = await scene('?route=B&start=10&auto=0&pace=50&stay=240', `evaApi.plan.tEnd - 60`, '11_B_auto_off_over', (x) => check('auto turnaround off + pace 50% + 4 h stay: OVER LIMIT on return', x.status === 'over', x.status));
  s = await scene('?route=B&season=270&start=9.5', `0`, '12_B_ls270_interpolated', (x) => check('B Ls 270 at 09:30: ground value shown', /K/.test(x.ground), x.ground));
  const interp = await evaluate(`!!document.querySelector('#v8 .tag') && document.querySelector('#v8 .tag').textContent`);
  check('B Ls 270 at 09:30: "interpolated" tag on screen', interp === 'interpolated', interp);
  s = await scene('?route=B&start=7', `0`, '13_B_cold_start', (x) => check('07:00 start: ground below −40 °C at start → DO NOT START', x.status === 'nogo', x.status));
  // manual turn with the T key, then layers
  await open('?route=B'); await closeSetup();
  await evaluate(`evaApi.seek(1500); document.activeElement.blur(); true`);
  await key('t', 'KeyT', 84, 't');
  const mt = await evaluate(`({ manual: evaApi.plan.manual, dTurn: evaApi.plan.dTurn, phase: evaLast.phase })`);
  check('keyboard T: manual turn at the current point', mt.manual && mt.dTurn < 800, JSON.stringify(mt));
  await evaluate(`evaApi.seek(1700); true`);
  await evaluate(`document.getElementById('ly-los').click(); document.getElementById('ly-base').click(); true`);
  await shot('14_B_manual_turn_hillshade_los');
  // keyboard: space / arrows
  await open('?route=B'); await closeSetup();
  await evaluate(`document.activeElement.blur(); true`);
  await key(' ', 'Space', 32, ' ');
  const playing = await evaluate(`evaApi.playing`);
  await key(' ', 'Space', 32, ' ');
  const t0 = await evaluate(`evaApi.t`);
  await key('ArrowRight', 'ArrowRight', 39);
  const t1 = await evaluate(`evaApi.t`);
  check('keyboard: Space toggles play, → seeks +5 min', playing && Math.abs(t1 - t0 - 300) < 1, `playing ${playing}, Δt ${(t1 - t0).toFixed(1)}`);
  // tab order reaches the main controls
  const tabbed = [];
  for (let i = 0; i < 25; i++) { await key('Tab', 'Tab', 9); tabbed.push(await evaluate(`document.activeElement.id || document.activeElement.tagName`)); }
  check('keyboard: Tab reaches play, turn, slider', ['btn-play', 'slider'].every((x) => tabbed.includes(x)), tabbed.join(','));

  // ---------------------------------------------------------------- 5. layout, sizes, contrast (landscape + portrait)
  for (const [w, h, tag] of [[1024, 768, 'landscape'], [360, 640, 'portrait']]) {
    await viewport(w, h, tag === 'portrait');
    await open('?route=B'); await closeSetup();
    await evaluate(`(function(){ const S = window.evaApi; let lo = 0, hi = S.plan.tArr; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (S.state(m).pos.d_m < 1600) lo = m; else hi = m; } S.seek(lo); return true; })()`);
    await sleep(400);
    const sz = await evaluate(SIZE_JS);
    result.layout[tag] = sz;
    check(`${tag}: main buttons >= 72x72`, sz.main.length >= 2 && sz.main.every((b) => b.w >= 72 && b.h >= 72), JSON.stringify(sz.main));
    check(`${tag}: other controls >= 48x48`, sz.small.length === 0, JSON.stringify(sz.small));
    check(`${tag}: gap play–turn >= 16 px` + (sz.gapZoom !== null ? ', zoom +/− >= 16 px' : ''), sz.gapPlayTurn >= 16 && (sz.gapZoom === null || sz.gapZoom >= 16), `${sz.gapPlayTurn} / ${sz.gapZoom}`);
    check(`${tag}: no horizontal overflow`, sz.overflowX <= 0, sz.overflowX + ' px');
    const ct = await evaluate(CONTRAST_JS);
    result.contrast[tag] = ct;
    check(`${tag}: text contrast >= 7:1 (${ct.n} text elements)`, ct.below7.length === 0, ct.below7.length ? JSON.stringify(ct.below7.slice(0, 5)) : 'min ' + ct.min.ratio);
    await shot(`20_${tag}_B_caution`);
    if (tag === 'portrait') {
      const order = await evaluate(`[...document.querySelectorAll('#info > .card')].slice(0, 3).map(e => e.id + ':' + Math.round(e.getBoundingClientRect().top))`);
      check('portrait: next stop, margin, slope shown first', order[0].startsWith('v2') && order[1].startsWith('v4') && order[2].startsWith('v7'), order.join(' '));
      await evaluate(`document.getElementById('btn-map').click(); true`);
      await sleep(600);
      const sz2 = await evaluate(SIZE_JS);
      check('portrait map view: zoom buttons >= 72x72, gap >= 16', sz2.main.filter((b) => b.id.startsWith('z')).every((b) => b.w >= 72 && b.h >= 72) && sz2.gapZoom >= 16, JSON.stringify(sz2.main));
      await shot('21_portrait_map');
      await evaluate(`document.getElementById('btn-map').click(); true`);
      await open('?route=B');
      await shot('22_portrait_setup');
      await closeSetup();
      await evaluate(`evaApi.seek(evaApi.plan.tArr + 60); true`);
      await shot('23_portrait_B_at_dest');
    }
  }

  // ---------------------------------------------------------------- 6. control bar inside the viewport (Plan/17 P1-1)
  // Play and Turn-back must lie fully inside the viewport with the warning banner hidden and shown,
  // and the page itself must not scroll (scrollY stays 0).
  const BAR_JS = `(() => {
    const r = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right) }; };
    const play = r('btn-play'), turn = r('btn-turn');
    const inside = (b) => b.top >= 0 && b.left >= 0 && b.bottom <= window.innerHeight && b.right <= window.innerWidth && b.bottom > b.top;
    const y0 = window.scrollY;
    window.scrollTo(0, 100000); document.scrollingElement.scrollTop = 100000;
    const y1 = window.scrollY;
    window.scrollTo(0, 0);
    return { vh: window.innerHeight, vw: window.innerWidth, banner: !document.getElementById('banner').hidden, play, turn,
      ebar_h: Math.round(document.querySelector('.ebar').getBoundingClientRect().height * 10) / 10,
      inside: inside(play) && inside(turn), scrollY: y0, scrollYAfterTry: y1 };
  })()`;
  const seekTo = (d) => `(function(){ const S = window.evaApi; let lo = 0, hi = S.plan.tArr; for (let i = 0; i < 60; i++) { const m = (lo + hi) / 2; if (S.state(m).pos.d_m < ${d}) lo = m; else hi = m; } S.seek(lo); return true; })()`;
  result.control_bar = [];
  for (const [w, h] of [[1024, 768], [768, 1024], [390, 844], [360, 640]]) {
    await viewport(w, h, w < h);
    await open('?route=B'); await closeSetup();
    for (const [want, d] of [[false, 170], [true, 1600]]) {
      await evaluate(seekTo(d));
      await sleep(400);
      const b = await evaluate(BAR_JS);
      result.control_bar.push({ viewport: `${w}x${h}`, ...b });
      const tag = `${w}x${h} banner ${want ? 'shown' : 'hidden'}`;
      check(`control bar ${tag}: Play and Turn back fully inside the viewport, scrollY 0`,
        b.banner === want && b.inside && b.scrollY === 0 && b.scrollYAfterTry === 0,
        `banner ${b.banner}, play ${b.play.top}–${b.play.bottom}, turn ${b.turn.top}–${b.turn.bottom}, viewport ${b.vh}, scrollY ${b.scrollY}/${b.scrollYAfterTry}`);
      await shot(`40_ctlbar_${w}x${h}_${want ? 'banner' : 'nobanner'}`);
    }
  }

  // ---------------------------------------------------------------- 6a. Home link (Plan/21 W1): in the setup dialog, not in the header band
  // The header band (.ebar) keeps exactly its two controls, so its height cannot change; the measured heights are recorded per viewport.
  {
    await viewport(1024, 768);
    await open('?route=B');
    const hl = await evaluate(`(() => { const a = document.getElementById('lnk-home'); const bar = document.querySelector('.ebar');
      return { href: a ? a.getAttribute('href') : null, inSetup: !!(a && a.closest('#setup')), inBar: !!(a && a.closest('.ebar')), text: a ? a.textContent.trim() : null,
        barControls: [...bar.querySelectorAll('a, button')].map((e) => e.id), plan: document.getElementById('lnk-plan').getAttribute('href') }; })()`);
    await closeSetup();
    const hs = [...new Set(result.control_bar.map((b) => `${b.viewport}:${b.ebar_h}`))];
    result.home_link = { ...hl, ebar_heights: hs };
    check('Home link in the setup dialog (href index.html); header band holds only Setup + Planning mode (→ map.html)',
      hl.href === 'index.html' && hl.inSetup && !hl.inBar && hl.text === 'Home' && hl.barControls.join(',') === 'btn-setup,lnk-plan' && /^map\.html\?route=B$/.test(hl.plan),
      JSON.stringify(hl) + ' ebar heights ' + hs.join(' '));
  }

  // ---------------------------------------------------------------- 6b. English only (Plan/17 P1-2): ?lang=ko is ignored
  await viewport(1024, 768);
  await open('?route=B&lang=ko'); await closeSetup();
  const en = await evaluate(`({ title: document.title, lab: document.querySelector('#v2 .lab').textContent, sim: document.querySelector('.sim-tag').textContent,
    lang: document.documentElement.lang, langBtns: document.querySelectorAll('[data-lang]').length, hangul: /[\\uac00-\\ud7a3\\u3131-\\u318e]/.test(document.body.innerText + document.title) })`);
  check('?lang=ko renders English (no language buttons, no Hangul)', en.lang === 'en' && en.title === 'Marswalk · EVA' && en.sim === 'SIMULATION' && en.langBtns === 0 && !en.hangul, JSON.stringify(en));

  // ---------------------------------------------------------------- 7. errors
  check('console errors / warnings', result.console.length === 0, JSON.stringify(result.console.slice(0, 5)));
  check('uncaught exceptions', result.exceptions.length === 0, JSON.stringify(result.exceptions.slice(0, 3)));
  // the planning page (now map.html) probed cuff.html with HEAD until stage 5-5 built it (Plan/12 3-1: intended 404)
  const httpErr = result.http_errors.filter((e) => !/\/cuff\.html$/.test(e.url || ''));
  result.expected_404 = result.http_errors.length - httpErr.length;
  check('HTTP errors (non-tile; cuff.html probe from index.html excluded)', httpErr.length === 0, JSON.stringify(httpErr.slice(0, 5)));

  result.finished = new Date().toISOString();
  result.n_fail = result.checks.filter((c) => !c.pass).length;
  fs.writeFileSync(path.join(OUT, 'eva_check.json'), JSON.stringify(result, null, 1));
  console.log(`\n${result.checks.length - result.n_fail}/${result.checks.length} checks passed; requests ${result.requests}; tile 404 ${JSON.stringify(result.tile_404)}`);
}

main().then(() => { ws.close(); chrome.kill(); fs.rmSync(prof, { recursive: true, force: true }); process.exit(result.n_fail ? 1 : 0); })
  .catch((e) => { console.error(e); try { chrome.kill(); } catch (x) { /* ignore */ } fs.rmSync(prof, { recursive: true, force: true }); process.exit(2); });
