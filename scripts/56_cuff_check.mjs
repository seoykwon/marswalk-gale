#!/usr/bin/env node
// Stage 5-5 part A: check the printable cuff checklist (site/cuff.html) in headless Chrome via the DevTools
// protocol (no npm packages).
//
//   (cd site && python3 -m http.server 8767)          # in another terminal
//   node scripts/56_cuff_check.mjs [http://127.0.0.1:8767/]
//
// Checks: both routes load with 0 console errors (English only; ?lang=ko is ignored); card counts and 8 per sheet; no card
// overflows its 90 x 60 mm box; print emulation (card size, inside the sheet, black on white); PDF via
// Page.printToPDF (A4) with pdftotext per page (no card split across pages); every bearing / distance / time on
// the cards vs what eva.html shows for the same URL parameters; link from map.html (planning page, Plan/21 W1).
// Output: work/stage5/cuff_check.json, work/stage5/cuff/*.pdf, *.png. Exit code 1 when a check fails.
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BASE = process.argv[2] || 'http://127.0.0.1:8767/';
const OUT = path.join(ROOT, 'work', 'stage5');
const CUFF = path.join(OUT, 'cuff');
fs.mkdirSync(CUFF, { recursive: true });
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PORT = 9356;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MM = 96 / 25.4; // CSS px per mm

const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'gale-cuff-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`,
  '--window-size=1100,900', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'],
{ stdio: 'ignore' });

const result = { base: BASE, started: new Date().toISOString(), console: [], exceptions: [], http_errors: [], requests: 0,
  checks: [], pdfs: [], cases: {}, eva_compare: {} };
const check = (name, pass, detail = '') => { result.checks.push({ name, pass: !!pass, detail: String(detail) }); console.log((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  - ' + detail : '')); };

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
  while (Date.now() - t0 < ms) { if (await evaluate(expr)) return true; await sleep(100); }
  throw new Error('timeout waiting for ' + expr);
}
async function openCuff(q) {
  await send('Page.navigate', { url: BASE + 'cuff.html' + q });
  await waitFor(`document.body && document.body.dataset.ready === '1'`);
  await sleep(150);
}
async function openEva(q) {
  await send('Page.navigate', { url: BASE + 'eva.html' + q });
  await waitFor(`document.body && document.body.dataset.ready === '1'`);
  await evaluate(`(() => { const d = document.getElementById('setup'); if (d && d.open) d.close('close'); return true; })()`);
  await sleep(200);
}
async function shot(name, fullPage = true) {
  const r = await send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage });
  const f = path.join(CUFF, name + '.png');
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
}

// ---- in-page probes
const LAYOUT_JS = `(() => {
  const sheets = [...document.querySelectorAll('.sheet')];
  return {
    nCards: document.querySelectorAll('.card').length,
    perSheet: sheets.map((s) => s.querySelectorAll('.card').length),
    ids: [...document.querySelectorAll('.card')].map((c) => c.dataset.card + ':' + (c.dataset.stop || '')),
    overflow: [...document.querySelectorAll('.card')].filter((c) => c.scrollHeight > c.clientHeight + 0.5 || c.scrollWidth > c.clientWidth + 0.5)
      .map((c) => ({ id: c.dataset.card + ':' + (c.dataset.stop || ''), sh: c.scrollHeight, ch: c.clientHeight, sw: c.scrollWidth, cw: c.clientWidth })),
    sizes: [...document.querySelectorAll('.card')].map((c) => { const r = c.getBoundingClientRect(); return [r.width, r.height]; }),
    sheetBox: sheets.map((s) => { const r = s.getBoundingClientRect(); return { w: r.width, h: r.height }; }),
    inside: [...document.querySelectorAll('.card')].every((c) => { const r = c.getBoundingClientRect(), s = c.parentElement.getBoundingClientRect();
      return r.left >= s.left - 0.5 && r.right <= s.right + 0.5 && r.top >= s.top - 0.5 && r.bottom <= s.bottom + 0.5; }),
    minFontPx: Math.min(...[...document.querySelectorAll('.card *')].filter((e) => e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => parseFloat(getComputedStyle(e).fontSize))),
    colors: [...new Set([...document.querySelectorAll('.card, .card *')].flatMap((e) => { const s = getComputedStyle(e); return [s.color, s.backgroundColor].filter((x) => x !== 'rgba(0, 0, 0, 0)'); }))],
    barDisplay: getComputedStyle(document.querySelector('.screen-only')).display,
    langAttr: document.documentElement.lang,
    text: document.querySelector('.sheets').innerText.slice(0, 200),
  };
})()`;

function pdfText(file, page) {
  return execFileSync('pdftotext', ['-f', String(page), '-l', String(page), '-layout', file, '-'], { encoding: 'utf8' });
}
function pdfPages(file) {
  const out = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
  return { pages: Number(/Pages:\s+(\d+)/.exec(out)[1]), size: /Page size:\s+(.*)/.exec(out)[1] };
}

const num = (s) => Number(String(s).replace(/[^\d.−-]/g, '').replace('−', '-'));

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
    if (m.method === 'Network.requestWillBeSent') { result.requests++; reqUrl.set(m.params.requestId, m.params.request.url); }
    if (m.method === 'Network.responseReceived') {
      const { url, status } = m.params.response;
      if (status >= 400) result.http_errors.push({ url, status });
    }
    if (m.method === 'Network.loadingFailed' && !m.params.canceled) result.http_errors.push({ url: reqUrl.get(m.params.requestId), failed: m.params.errorText });
    if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type)) {
      result.console.push({ type: m.params.type, text: m.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400) });
    }
    if (m.method === 'Runtime.exceptionThrown') result.exceptions.push(JSON.stringify(m.params.exceptionDetails).slice(0, 600));
  });
  await send('Page.enable'); await send('Runtime.enable'); await send('Network.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });

  // ============================================================ 1. layout, both routes (English only)
  const combos = [['B', 'en'], ['A', 'en']];
  const expectedCards = { A: 7 + 3, B: 11 + 3 }; // summary + stops + limits + contingency
  for (const [route, lang] of combos) {
    const key = `${route}_${lang}`;
    const q = `?route=${route}&start=10&season=${route === 'A' ? 180 : 240}`;
    await openCuff(q);
    await send('Emulation.setEmulatedMedia', { media: 'screen' });
    const L = await evaluate(LAYOUT_JS);
    result.cases[key] = { q, nCards: L.nCards, perSheet: L.perSheet, minFontPx: L.minFontPx };
    check(`${key}: lang attribute`, L.langAttr === lang, L.langAttr);
    check(`${key}: card count = summary + stops + limits + contingency`, L.nCards === expectedCards[route], `${L.nCards} (expected ${expectedCards[route]})`);
    const expSheets = Math.ceil(L.nCards / 8);
    check(`${key}: 8 cards per sheet (last sheet gets the rest)`, L.perSheet.length === expSheets && L.perSheet.slice(0, -1).every((n) => n === 8) && L.perSheet.at(-1) === L.nCards - 8 * (expSheets - 1), JSON.stringify(L.perSheet));
    check(`${key}: card order summary, stops..., limits, contingency`, L.ids[0] === 'summary:' && L.ids.at(-2) === 'limits:' && L.ids.at(-1) === 'contingency:' && L.ids.slice(1, -2).every((x) => x.startsWith('stop:')), L.ids.join(' '));
    check(`${key}: no card text overflows its box (screen)`, L.overflow.length === 0, JSON.stringify(L.overflow));
    const foot = await evaluate(`((document.querySelector('.cont [data-v="footer"]') || {}).textContent || '').trim()`);
    check(`${key}: contingency card footer names the project`, foot === 'Marswalk · Gale Crater EVA planner', foot);
    await shot(`screen_${key}`);

    // ---- print emulation
    await send('Emulation.setEmulatedMedia', { media: 'print' });
    await send('Emulation.setDeviceMetricsOverride', { width: Math.round(190 * MM), height: 1047, deviceScaleFactor: 1, mobile: false });
    await sleep(150);
    const Pr = await evaluate(LAYOUT_JS);
    check(`${key}: print - cards are 90 x 60 mm (+-1px)`, Pr.sizes.every(([w, h]) => Math.abs(w - 90 * MM) < 1 && Math.abs(h - 60 * MM) < 1), JSON.stringify(Pr.sizes[0]));
    check(`${key}: print - no overflow, cards inside sheet, sheet <= 277 mm`, Pr.overflow.length === 0 && Pr.inside && Pr.sheetBox.every((b) => b.h <= 277 * MM + 0.5 && b.w <= 190 * MM + 0.5), JSON.stringify(Pr.sheetBox));
    check(`${key}: print - screen-only bar hidden`, Pr.barDisplay === 'none', Pr.barDisplay);
    check(`${key}: print - black text on white only`, Pr.colors.every((c) => c === 'rgb(0, 0, 0)' || c === 'rgb(255, 255, 255)'), JSON.stringify(Pr.colors));
    check(`${key}: print - smallest text >= 9 pt`, Pr.minFontPx >= 12 - 0.01, `${Pr.minFontPx} px (${(Pr.minFontPx * 0.75).toFixed(2)} pt)`);

    // ---- PDF (A4), pages checked with pdftotext
    const pdf = await send('Page.printToPDF', { preferCSSPageSize: true, printBackground: false, displayHeaderFooter: false });
    const file = path.join(CUFF, `cuff_${key}.pdf`);
    fs.writeFileSync(file, Buffer.from(pdf.data, 'base64'));
    const info = pdfPages(file);
    const perPageHeaders = [], perPageTails = [], ownership = [];
    for (let p = 1; p <= info.pages; p++) {
      const t = pdfText(file, p).replace(/\s+/g, ' ');
      perPageHeaders.push((t.match(new RegExp('SIMULATION · Route ' + route, 'g')) || []).length);
      // tail marker of each card type: stop -> "Si x µGy", summary -> "†", limits/contingency -> their last note
      perPageTails.push((t.match(/Si [\d.]+ µGy/g) || []).length
        + (t.includes('† = assumption') ? 1 : 0)
        + (t.includes('► binding.') ? 1 : 0)
        + (t.includes('Line of sight: no relays') ? 1 : 0));
      ownership.push(t);
    }
    // each sheet i of cards must be exactly the cards printed on PDF page i: stop ids
    const sheetsIds = await evaluate(`[...document.querySelectorAll('.sheet')].map((s) => [...s.querySelectorAll('.card')].map((c) => c.dataset.card === 'stop' ? c.dataset.stop : c.dataset.card))`);
    let idsOk = true; const idDetail = [];
    sheetsIds.forEach((ids, i) => {
      for (const id of ids) {
        const re = id === 'summary' ? /SUMMARY/ : id === 'limits' ? /LIMITS†/ : id === 'contingency' ? /IF…†/ : new RegExp('\\b' + id + '\\s+\\d+/\\d+');
        const here = re.test(ownership[i] || '');
        const elsewhere = ownership.some((t, j) => j !== i && re.test(t) && !(id === route + '1' && false));
        if (!here) { idsOk = false; idDetail.push(`${id} missing on page ${i + 1}`); }
        if (elsewhere && (id === 'summary' || id === 'limits' || id === 'contingency')) { idsOk = false; idDetail.push(`${id} also on another page`); }
      }
    });
    const expHeaders = L.perSheet;
    check(`${key}: PDF is A4 with ${expSheets} pages`, info.pages === expSheets && /59[45]\.\d+ x 84[12]\.\d+/.test(info.size), `${info.pages} pages, ${info.size}`);
    check(`${key}: PDF cards per page = ${JSON.stringify(expHeaders)} (headers and tails both)`, JSON.stringify(perPageHeaders) === JSON.stringify(expHeaders) && JSON.stringify(perPageTails) === JSON.stringify(expHeaders), `headers ${JSON.stringify(perPageHeaders)}, tails ${JSON.stringify(perPageTails)}`);
    check(`${key}: PDF - every card sits wholly on its sheet's page`, idsOk, idDetail.join('; '));
    result.pdfs.push({ file: path.relative(ROOT, file), pages: info.pages, size: info.size, perPageHeaders, perPageTails, bytes: fs.statSync(file).size });
    await send('Emulation.setEmulatedMedia', { media: 'screen' });
    await send('Emulation.setDeviceMetricsOverride', { width: 1100, height: 900, deviceScaleFactor: 1, mobile: false });
  }

  // ============================================================ 2. cuff vs EVA mode (same URL parameters)
  const setups = [
    ['B normal 10:00', '?route=B&start=10&season=240'],
    ['A normal 10:00', '?route=A&start=10&season=180'],
    ['B spike 09:00', '?route=B&start=9&season=240&scenario=spike4716'],
    ['B 50% 09:00 spike (turns back)', '?route=B&start=9&season=240&scenario=spike4716&pace=50'],
    ['B 15:00 (sunset binds)', '?route=B&start=15&season=240'],
    ['B 11:00 Ls 270', '?route=B&start=11&season=270'],
  ];
  for (const [label, q] of setups) {
    await openCuff(q);
    const C = await evaluate(`(() => {
      const M = window.cuffApi.model;
      const cardText = (id) => { const c = document.querySelector('.card[data-stop="' + id + '"]'); const g = (v) => { const e = c.querySelector('[data-v="' + v + '"]'); return e ? e.textContent.trim() : null; }; return { bearing: g('bearing'), dist: g('dist'), legtime: g('legtime'), climb: g('climb'), backbearing: g('backbearing'), backdist: g('backdist'), turnbearing: g('turnbearing'), turndist: g('turndist'), arrive: g('arrive'), latest: g('latest'), ground: g('ground') }; };
      return { params: { start: M.P.start, ls: M.P.ls, scenario: M.P.scenario, pace: M.P.pace, stay_s: M.P.stay_s, autoTurn: M.P.autoTurn },
        plan: { binding: M.plan.binding, D: M.plan.D, deadline: M.plan.deadline, turnD: M.plan.turnD, reachable: M.plan.reachable, tEnd: M.plan.tEnd, tArr: M.plan.tArr, stay: M.plan.stay, limits: M.plan.limits, maxStay: M.plan.maxStay },
        totals: { round_trip_m: M.totals.round_trip_m },
        stops: M.stops.map((s) => ({ id: s.id, k: s.k, arrive_s: s.arrive_s, latest_s: s.latest_s, beyond: s.beyond, next: s.next && { id: s.next.id, bearing_deg: s.next.bearing_deg, dist_m: s.next.dist_m, time_s: s.next.time_s, elev: s.next.elev_change_m }, turn: s.turn, back: s.back && { id: s.back.id, bearing_deg: s.back.bearing_deg }, ground_K: s.ground_K, E: s.dose_E, B: s.dose_B, text: cardText(s.id) })),
        summaryText: Object.fromEntries([...document.querySelectorAll('.summary [data-v]')].map((e) => [e.dataset.v, e.textContent.trim()])),
        limitRows: Object.fromEntries([...document.querySelectorAll('.limits [data-limit]')].map((e) => [e.dataset.limit, e.textContent.replace(/\\s+/g, ' ').trim()])) };
    })()`);
    await openEva(q);
    const E = await evaluate(`(() => {
      const api = window.evaApi; const out = { params: { start: api.params.start, ls: api.params.ls, scenario: api.params.scenario, pace: api.params.pace, stay_s: api.params.stay_s, autoTurn: api.params.autoTurn },
        plan: { binding: api.plan.binding, D: api.plan.D, deadline: api.plan.deadline, turnD: api.plan.turnD, reachable: api.plan.reachable, tEnd: api.plan.tEnd, tArr: api.plan.tArr, stay: api.plan.stay, limits: api.plan.limits, maxStay: api.plan.maxStay }, stops: [] };
      return out; })()`);
    const stops = [];
    for (const s of C.stops) {
      const reachableOut = !s.beyond && s.k < C.stops.length - 1;
      const lastOK = !s.beyond && s.k === C.stops.length - 1;
      let rec = { id: s.id };
      if (reachableOut) {
        const t = s.arrive_s;
        await evaluate(`evaApi.seek(${t}); true`); await sleep(40);
        rec = await evaluate(`(() => { const st = evaApi.state(${t}); const n = st.next; const txt = ((document.querySelector('[data-check="eva.next"]') || {}).textContent || '').trim(); const sub = (document.querySelector('#v2 .sub') || {}).textContent || '';
          return { id: ${JSON.stringify(s.id)}, phase: st.phase, nextId: n && n.id, bearing: n && n.bearing_deg, along: n && n.along_m, time: n && n.time_s, elev: n && n.elev_change_m, latest: n && n.latest_turn_s,
            E: st.dose.E, B: st.dose.B, K: st.ground.K, screen: txt, sub, doseE: document.querySelector('[data-check="eva.dose_E"]').textContent, ground: document.querySelector('[data-check="eva.ground"]').textContent.trim() }; })()`);
      } else if (lastOK && C.plan.stay > 2) {
        const t = C.plan.tArr + C.plan.stay / 2;
        await evaluate(`evaApi.seek(${t}); true`); await sleep(40);
        rec = await evaluate(`(() => { const st = evaApi.state(${t}); const n = st.next; return { id: ${JSON.stringify(s.id)}, phase: st.phase, nextId: n && n.id, bearing: n && n.bearing_deg, along: n && n.along_m, screen: document.querySelector('[data-check="eva.next"]').textContent.trim() }; })()`);
      }
      stops.push(rec);
    }
    E.stops = stops;
    // ---- compare
    const diffs = []; let n = 0;
    const eq = (what, a, b, tol = 0) => { n++; if (!(Math.abs(a - b) <= tol)) diffs.push(`${what}: cuff ${a} vs eva ${b}`); };
    const same = (what, a, b) => { n++; if (a !== b) diffs.push(`${what}: cuff ${a} vs eva ${b}`); };
    for (const k of Object.keys(C.params)) same('param ' + k, C.params[k], E.params[k]);
    same('binding', C.plan.binding, E.plan.binding);
    for (const k of ['D', 'deadline', 'turnD', 'tEnd', 'tArr', 'stay']) eq('plan.' + k, C.plan[k], E.plan[k], 1e-9);
    same('reachable', C.plan.reachable, E.plan.reachable);
    let compared = 0, textCompared = 0, turnPoints = 0;
    for (let i = 0; i < C.stops.length; i++) {
      const cs = C.stops[i], es = E.stops[i];
      if (!es || es.bearing === undefined || es.bearing === null) continue;
      compared++;
      if (cs.k < C.stops.length - 1) {
        if (es.nextId === null && cs.turn) {
          // EVA names the turnaround point as the next target here; the card prints it as a TURN POINT line
          eq(`${cs.id} turn point bearing`, cs.turn.bearing_deg, es.bearing, 1e-6);
          eq(`${cs.id} turn point dist`, cs.turn.dist_m, es.along, 1e-6);
          const mt = /(\d+)° (\w+) · ([\d,]+) m/.exec(es.screen);
          eq(`${cs.id} text turn bearing`, num(cs.text.turnbearing.split('°')[0]), num(mt[1]));
          eq(`${cs.id} text turn dist`, num(cs.text.turndist), num(mt[3]));
          turnPoints++;
        } else {
        same(`${cs.id} next id`, cs.next.id, es.nextId);
        eq(`${cs.id} bearing`, cs.next.bearing_deg, es.bearing, 1e-6);
        eq(`${cs.id} dist`, cs.next.dist_m, es.along, 1e-6);
        eq(`${cs.id} leg time`, cs.next.time_s, es.time, 1e-6);
        eq(`${cs.id} elev change`, cs.next.elev, es.elev, 1e-6);
        }
        if (es.nextId !== null && cs.k + 1 <= C.stops.length - 1) eq(`${cs.id} next L_k`, C.stops[cs.k + 1].latest_s, es.latest, 1e-6);
        eq(`${cs.id} dose E`, cs.E, es.E, 1e-9); eq(`${cs.id} dose Si`, cs.B, es.B, 1e-9);
        if (cs.ground_K !== null) eq(`${cs.id} ground K`, cs.ground_K, es.K, 1e-9);
        // text level: numbers printed on the card vs numbers printed on the EVA screen
        const m = /^(\S+) · (\d+)° (\w+) · ([\d,]+) m · (\d+) ?min · ([+−]\S+) m$/.exec(es.screen);
        if (es.nextId === null && cs.turn) { /* turn point compared above */ } else if (m) {
          textCompared++;
          eq(`${cs.id} text bearing`, num(cs.text.bearing.split('°')[0]), num(m[2]));
          same(`${cs.id} text 8-point`, cs.text.bearing.split(' ')[1], m[3]);
          eq(`${cs.id} text dist`, num(cs.text.dist), num(m[4]));
          const [h, mi] = cs.text.legtime.split(':').map(Number);
          eq(`${cs.id} text leg minutes`, h * 60 + mi, num(m[5]));
          same(`${cs.id} text elevation`, `${cs.next.elev >= 0 ? '+' : '−'}${Math.round(Math.abs(cs.next.elev)).toLocaleString('en-US')}`, m[6]);
        } else diffs.push(`${cs.id}: eva next text not parsed: ${es.screen}`);
        if (es.nextId !== null && cs.k + 1 <= C.stops.length - 1) {
          const nextLatest = C.stops[cs.k + 1].text.latest;
          same(`${cs.id} text next L_k`, /(T[+−]\d+:\d\d)/.exec(es.sub)[1], nextLatest);
        }
      } else {
        // destination: EVA shows the way back to the previous stop
        same(`${cs.id} back id`, cs.back.id, es.nextId);
        eq(`${cs.id} back bearing`, cs.back.bearing_deg, es.bearing, 1e-6);
        const mm2 = /(\d+)° (\w+) · ([\d,]+) m/.exec(es.screen);
        eq(`${cs.id} text back bearing`, num(cs.text.backbearing.split('°')[0]), num(mm2[1]));
        eq(`${cs.id} text back dist`, num(cs.text.backdist), num(mm2[3]));
        textCompared++;
      }
    }
    result.eva_compare[label] = { q, n_compared: n, stops_compared: compared, text_stops: textCompared, turn_points: turnPoints, diffs: diffs.slice(0, 10), binding: C.plan.binding, reachable: C.plan.reachable, turnD: C.plan.turnD, nBeyond: C.stops.filter((s) => s.beyond).length };
    check(`cuff = EVA: ${label}`, diffs.length === 0 && compared > 0, `${n} values on ${compared} stops (${textCompared} text-level, ${turnPoints} turn-point), binding ${C.plan.binding}, turn ${C.plan.reachable ? 'dest' : C.plan.turnD.toFixed(1) + ' m'}${diffs.length ? ' DIFF ' + diffs.slice(0, 3).join(' | ') : ''}`);
    // summary card = EVA numbers: round trip, D, deadline
    const sm = C.summaryText;
    check(`cuff summary: D / deadline text = EVA plan (${label})`, sm.D === `T+${Math.floor(Math.round(E.plan.D / 60) / 60)}:${String(Math.round(E.plan.D / 60) % 60).padStart(2, '0')}` || !Number.isFinite(E.plan.D), `${sm.D} deadline ${sm.deadline}`);
  }

  // ============================================================ 3. hand computation hook (value printed for the Python check)
  await openCuff('?route=B&start=10&season=240');
  const hand = await evaluate(`(() => { const M = window.cuffApi.model; const a = M.R.stations[0], b = M.R.stations[1]; const t = document.querySelector('.card[data-stop="B1"] [data-v="bearing"]').textContent.trim();
    return { from: [a.lon, a.lat], to: [b.lon, b.lat], card: t, stored: a.leg.bearing_deg, dist: document.querySelector('.card[data-stop="B1"] [data-v="dist"]').textContent.trim(), leg_dist_json: a.leg.dist_m }; })()`);
  result.hand = hand;
  fs.writeFileSync(path.join(OUT, 'cuff_hand_input.json'), JSON.stringify(hand));
  console.log('hand input', JSON.stringify(hand));

  // ============================================================ 4. link from map.html (the planning page moved from index.html, Plan/21 W1)
  await send('Page.navigate', { url: BASE + 'map.html?route=B' });
  await waitFor(`document.getElementById('btn-cuff') && document.getElementById('btn-cuff').getAttribute('href')`, 30000);
  await sleep(500);
  const href = await evaluate(`document.getElementById('btn-cuff').href`);
  const disabled = await evaluate(`document.getElementById('btn-cuff').getAttribute('aria-disabled')`);
  check('map.html "Print cuff checklist" link present and enabled', !!href && disabled !== 'true', `${href} aria-disabled=${disabled}`);
  // follow the link (route A as well, after selecting it)
  await evaluate(`document.querySelector('[data-route="A"]').click(); true`);
  await sleep(500);
  const hrefA = await evaluate(`document.getElementById('btn-cuff').href`);
  for (const [lbl, h] of [['B', href], ['A', hrefA]]) {
    await send('Page.navigate', { url: h });
    await waitFor(`document.body && document.body.dataset.ready === '1'`);
    const got = await evaluate(`({ q: location.search, route: window.cuffApi.model.st.route, start: window.cuffApi.params.start, ls: window.cuffApi.params.ls, lang: document.documentElement.lang, n: window.cuffApi.nCards })`);
    const u = new URL(h);
    check(`map link ${lbl}: params arrive (route, start, season; no lang)`, got.route === u.searchParams.get('route') && got.start === Number(u.searchParams.get('start')) && got.ls === u.searchParams.get('season') && got.lang === 'en' && !u.searchParams.has('lang'), `${h} -> ${JSON.stringify(got)}`);
  }
  // Home link (Plan/21 W1): on the screen-only bar, not printed; Planning mode now points at map.html
  await openCuff('?route=B&start=10&season=240');
  const homeScreen = await evaluate(`(() => { const a = document.getElementById('lnk-home'); const r = a && a.getBoundingClientRect();
    return { href: a && a.getAttribute('href'), text: a && a.textContent.trim(), visible: !!(r && r.width > 0 && r.height >= 44), plan: document.getElementById('lnk-plan').getAttribute('href') }; })()`);
  await send('Emulation.setEmulatedMedia', { media: 'print' });
  const homePrint = await evaluate(`(() => { const a = document.getElementById('lnk-home'); return a.getBoundingClientRect().width === 0 && getComputedStyle(a.closest('.screen-only')).display === 'none'; })()`);
  await send('Emulation.setEmulatedMedia', { media: 'screen' });
  check('Home link on screen (href index.html, >= 44 px), hidden in print; Planning mode -> map.html?route=B',
    homeScreen.href === 'index.html' && homeScreen.text === 'Home' && homeScreen.visible && homePrint && homeScreen.plan === 'map.html?route=B', JSON.stringify({ ...homeScreen, hiddenInPrint: homePrint }));
  // ground already below -40 C at 08:30 (Ls 270): summary says do not start
  await openCuff('?route=B&start=8.5&season=270');
  const ng = await evaluate(`document.querySelector('.summary').innerText`);
  check('summary shows DO NOT START when the limits leave no time', /DO NOT START/.test(ng), ng.replace(/\n/g, ' | ').slice(0, 200));
  // old ls= and EVA extras
  await openCuff('?route=B&start=11&ls=210&pace=80&stay=10&auto=0');
  const ex = await evaluate(`({ ls: window.cuffApi.params.ls, pace: window.cuffApi.params.pace, stay: window.cuffApi.params.stay_s, auto: window.cuffApi.params.autoTurn })`);
  check('old ls= and pace/stay/auto extras accepted', ex.ls === '210' && ex.pace === 0.8 && ex.stay === 600 && ex.auto === false, JSON.stringify(ex));
  await shot('screen_extras');
  // English only (Plan/17 P1-2): an old ?lang=ko link renders English
  await openCuff('?route=B&start=10&season=240&lang=ko');
  const enOnly = await evaluate(`({ lang: document.documentElement.lang, title: document.title, langBtns: document.querySelectorAll('[data-lang]').length,
    hangul: /[\\uac00-\\ud7a3\\u3131-\\u318e]/.test(document.body.innerText + document.title) })`);
  check('?lang=ko renders English (no language buttons, no Hangul)', enOnly.lang === 'en' && enOnly.title === 'Marswalk · Cuff checklist' && enOnly.langBtns === 0 && !enOnly.hangul, JSON.stringify(enOnly));
  // bad params fall back
  await openCuff('?route=Z&start=99&season=abc&lang=xx');
  const bad = await evaluate(`({ r: window.cuffApi.model.st.route, s: window.cuffApi.params.start, ls: window.cuffApi.params.ls, lang: document.documentElement.lang })`);
  check('bad parameters fall back to defaults (language en)', bad.r === 'B' && bad.s === 10 && bad.ls === '240' && bad.lang === 'en', JSON.stringify(bad));

  // ============================================================ 5. string keys
  // every key used in cuff.js exists
  const src = fs.readFileSync(path.join(ROOT, 'site/src/cuff/cuff.js'), 'utf8') + fs.readFileSync(path.join(ROOT, 'site/cuff.html'), 'utf8');
  const en = JSON.parse(fs.readFileSync(path.join(ROOT, 'site/src/i18n/cuff.en.json'), 'utf8'));
  const has = (key) => key.split('.').reduce((o, k) => (o && typeof o === 'object' ? o[k] : undefined), en) !== undefined;
  const used = [...new Set([...src.matchAll(/\bc\('([\w.]+)'/g)].map((m) => m[1]).concat([...src.matchAll(/data-c(?:-aria)?="([\w.]+)"/g)].map((m) => m[1])))];
  const missing = used.filter((k) => !has(k) && !k.startsWith('stop.kind.'));
  check('all string keys used by cuff.js / cuff.html exist', missing.length === 0, `${used.length} keys used, missing ${JSON.stringify(missing)}`);

  // ============================================================ 6. errors
  check('console errors / warnings', result.console.length === 0, JSON.stringify(result.console.slice(0, 5)));
  check('uncaught exceptions', result.exceptions.length === 0, JSON.stringify(result.exceptions.slice(0, 3)));
  const swOnly = result.http_errors.filter((e) => /sw-register\.js$/.test(e.url || ''));
  const httpErr = result.http_errors.filter((e) => !/sw-register\.js$/.test(e.url || ''));
  result.expected_404_sw_register = swOnly.length;
  check('HTTP errors (src/sw-register.js 404 is expected until the offline agent adds it)', httpErr.length === 0, JSON.stringify(httpErr.slice(0, 5)) + ` ; sw-register 404s: ${swOnly.length}`);

  result.finished = new Date().toISOString();
  result.n_fail = result.checks.filter((c) => !c.pass).length;
  fs.writeFileSync(path.join(OUT, 'cuff_check.json'), JSON.stringify(result, null, 1));
  console.log(`\n${result.checks.length - result.n_fail}/${result.checks.length} checks passed; requests ${result.requests}`);
}

main().then(() => { ws.close(); chrome.kill(); fs.rmSync(prof, { recursive: true, force: true }); process.exit(result.n_fail ? 1 : 0); })
  .catch((e) => { console.error(e); try { chrome.kill(); } catch (x) { /* ignore */ } fs.rmSync(prof, { recursive: true, force: true }); process.exit(2); });
