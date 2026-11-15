// EVA mode page (eva.html): setup, replay loop, rendering of evaState() (Plan/09 sec.3, 5, 7).
// URL contract (shared with the planning page): route=A|B, start=<LMST h>, season=<Ls bin key, e.g. 240>
// (ls= accepted too), scenario=normal|spike4716, selftest=1
// (lang= is ignored: English only, Plan/17 P1-2). Optional: pace=<50-120 %>,
// stay=<min>, auto=0. Missing -> defaults from config.eva / env.DEFAULT_LS.
/* global L */
import { initI18n, pick, escapeHtml as esc } from '../i18n.js';
import { load, loadCore } from '../data.js';
import { createMap, makeTileLayer } from '../map.js';
import { classRuns } from '../routecalc.js';
import { fmt, dur, tempCK, bearing8 } from '../format.js';
import { assumptionsHtml } from '../panels/assumptions.js';
import { lsBins, DEFAULT_LS, K_MINUS40, K_MINUS55, LMST_HOUR_S } from '../env.js';
import { makeParams, evaPlan, evaState, LIMIT_ORDER } from './state.js';
import { loadEvaDicts, et, applyEt } from './ei18n.js';
import { runSelftest } from './selftest.js';

const CLASS_COLORS = ['#ffffff', '#fed976', '#fd8d3c', '#800026']; // = vectors.js / T2 slope classes
const CLASS_WIDTH = [5, 5, 8, 8];
const SPEEDS_FALLBACK = [1, 30, 120, 600];
const PACES = [50, 60, 70, 80, 90, 100, 110, 120];
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ small formatters
/** Elapsed seconds -> "T+1:05". */
function tplus(s) {
  if (!Number.isFinite(s)) return '—';
  const neg = s < 0;
  const m = Math.round(Math.abs(s) / 60);
  return `${neg ? 'T−' : 'T+'}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
/** Duration -> "1:05" (h:mm) or "—". */
function hmm(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.round(Math.abs(s) / 60);
  return `${s < 0 ? '−' : ''}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
/** LMST hours -> "10:30". */
function clock(h) {
  const x = ((h % 24) + 24) % 24;
  let m = Math.round(x * 60);
  if (m === 1440) m = 0;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
const mm = (s) => et('u.min', { m: fmt(Math.round(s / 60)) });
const pct = (x) => fmt(x * 100);

const SHAPES = {
  ok: '<svg viewBox="0 0 24 24" class="shape" aria-hidden="true"><circle cx="12" cy="12" r="10"/></svg>',
  soon: '<svg viewBox="0 0 24 24" class="shape" aria-hidden="true"><path d="M12 2 23 21H1Z"/></svg>',
  now: '<svg viewBox="0 0 24 24" class="shape" aria-hidden="true"><path d="M8 1h8l7 7v8l-7 7H8l-7-7V8Z"/></svg>',
};
SHAPES.back = SHAPES.ok; SHAPES.done = SHAPES.ok; SHAPES.over = SHAPES.now; SHAPES.nogo = SHAPES.now;
SHAPES.caution = SHAPES.soon; SHAPES.danger = SHAPES.now; SHAPES.normal = SHAPES.ok;

// ------------------------------------------------------------------ settings from the URL
function readSettings(core) {
  const q = new URLSearchParams(location.search);
  const ev = core.config.eva;
  const route = q.get('route') === 'A' ? 'A' : 'B';
  const num = (k) => (q.has(k) && q.get(k) !== '' && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);
  const start = num('start');
  const sc = q.get('scenario');
  return {
    route,
    start: start !== null && start >= 0 && start < 24 ? start : ev.default_start_lmst_h,
    season: q.get('season') ?? q.get('ls'),
    scenario: sc === 'spike4716' || sc === 'spike' ? 'spike4716' : 'normal',
    pace: num('pace') !== null ? Math.min(120, Math.max(50, num('pace'))) : 100,
    stay_min: num('stay') !== null ? Math.max(0, num('stay')) : ev.dest_stay_min,
    auto: q.get('auto') !== '0',
    selftest: q.get('selftest') === '1',
  };
}

function writeUrl(st, P) {
  const u = new URL(location.href);
  const sp = u.searchParams;
  sp.set('route', st.route);
  sp.set('start', String(st.start));
  sp.set('season', P.ls);
  sp.delete('ls');
  sp.set('scenario', P.scenario);
  sp.delete('lang');
  for (const [k, v, d] of [['pace', st.pace, 100], ['stay', st.stay_min, st.stayDefault], ['auto', st.auto ? 1 : 0, 1]]) {
    if (v === d) sp.delete(k); else sp.set(k, String(v));
  }
  history.replaceState(null, '', u);
}

// ------------------------------------------------------------------ main
async function main() {
  await initI18n();
  await loadEvaDicts();
  const [core, layersDoc] = await Promise.all([loadCore(), load('layers')]);
  const ev = core.config.eva;
  const st = readSettings(core);
  st.stayDefault = ev.dest_stay_min;
  const speeds = ev.replay_speeds || SPEEDS_FALLBACK;
  const rp = { t: 0, playing: false, speed: speeds.includes(120) ? 120 : speeds[0], manualTurnT: null, follow: true };

  let R = core.routes.routes[st.route];
  let P = null, plan = null;
  const rebuild = () => {
    R = core.routes.routes[st.route];
    P = makeParams(core, st.route, {
      start: st.start, ls: st.season, scenario: st.scenario, pace: st.pace / 100,
      stay_s: st.stay_min * 60, autoTurn: st.auto, manualTurnT: rp.manualTurnT,
    });
    st.season = P.ls;
    plan = evaPlan(R, P);
    if (rp.t > plan.tEnd) rp.t = plan.tEnd;
    writeUrl(st, P);
  };
  rebuild();

  // ---------------- map
  const map = createMap('map');
  window.evaMap = map; // for scripts/57_eva_browser_check.mjs
  if (map.zoomControl) map.zoomControl.remove();
  map.setMaxZoom(18);
  const defs = Object.fromEntries(layersDoc.layers.map((d) => [d.id, d]));
  const tl = {
    B2: makeTileLayer(map, defs.B2, { z: 202 }),
    T1: makeTileLayer(map, defs.T1, { z: 203, clip: true }),
    T2: makeTileLayer(map, defs.T2, { z: 206 }),
    T5A: defs.T5A ? makeTileLayer(map, defs.T5A, { z: 207 }) : null,
    T5B: defs.T5B ? makeTileLayer(map, defs.T5B, { z: 207 }) : null,
  };
  tl.B2.setOpacity(0.8); // darker base on the dark UI (Plan/09 3-2, assumption)
  const lay = { shade: false, slope: true, los: false };
  const applyLayers = () => {
    if (lay.shade) { map.removeLayer(tl.B2); tl.T1.addTo(map); } else { map.removeLayer(tl.T1); tl.B2.addTo(map); }
    if (lay.slope) tl.T2.addTo(map); else map.removeLayer(tl.T2);
    for (const k of ['T5A', 'T5B']) if (tl[k]) map.removeLayer(tl[k]);
    const los = tl['T5' + st.route];
    if (lay.los && los) los.addTo(map);
    $('ly-los').hidden = !los;
    $('ly-base').setAttribute('aria-pressed', String(lay.shade));
    $('ly-slope').setAttribute('aria-pressed', String(lay.slope));
    $('ly-los').setAttribute('aria-pressed', String(lay.los));
  };
  $('ly-base').onclick = () => { lay.shade = !lay.shade; applyLayers(); };
  $('ly-slope').onclick = () => { lay.slope = !lay.slope; applyLayers(); };
  $('ly-los').onclick = () => { lay.los = !lay.los; applyLayers(); };
  $('ly-follow').onclick = () => { rp.follow = !rp.follow; $('ly-follow').setAttribute('aria-pressed', String(rp.follow)); if (rp.follow) panTo(true); };
  $('zin').onclick = () => map.zoomIn();
  $('zout').onclick = () => map.zoomOut();
  map.on('dragstart', () => { rp.follow = false; $('ly-follow').setAttribute('aria-pressed', 'false'); });

  let routeLayer = null, turnMarker = null, posMarker = null;
  const drawRoute = () => {
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.layerGroup();
    const S = R.samples;
    L.polyline(S.lat.map((la, i) => [la, S.lon[i]]), { color: '#000', weight: 12, opacity: 0.9, interactive: false }).addTo(routeLayer);
    for (const run of classRuns(R, core.config.walk)) {
      L.polyline(run.latlngs, { color: CLASS_COLORS[run.cls], weight: CLASS_WIDTH[run.cls], opacity: 1, lineCap: 'butt', interactive: false }).addTo(routeLayer);
    }
    for (const s of R.stations) {
      L.circleMarker([s.lat, s.lon], { radius: 7, color: '#000', weight: 3, fillColor: '#fff', fillOpacity: 1, interactive: false })
        .bindTooltip(s.id, { permanent: true, direction: 'right', offset: [8, 0], className: 'st-label' })
        .addTo(routeLayer);
    }
    routeLayer.addTo(map);
    posMarker = L.marker([S.lat[0], S.lon[0]], {
      icon: L.divIcon({ className: 'pos-icon', html: '<span></span>', iconSize: [34, 34] }),
      keyboard: false, interactive: false, zIndexOffset: 1000,
    }).addTo(routeLayer);
    drawTurn();
  };
  const drawTurn = () => {
    if (turnMarker) { routeLayer.removeLayer(turnMarker); turnMarker = null; }
    if (plan.dTurn < plan.dDest - 1e-9) {
      const s = evaState(R, P, plan.tArr);
      turnMarker = L.marker([s.pos.lat, s.pos.lon], {
        icon: L.divIcon({ className: 'turn-icon', html: '↩', iconSize: [36, 36] }),
        title: et('map.turn'), alt: et('map.turn'), keyboard: false, interactive: false, zIndexOffset: 900,
      }).addTo(routeLayer);
    }
  };
  const panTo = (force) => {
    const s = evaState(R, P, rp.t);
    if (rp.follow || force) map.panTo([s.pos.lat, s.pos.lon], { animate: false });
  };
  drawRoute();
  map.setView([R.samples.lat[0], R.samples.lon[0]], 16);
  applyLayers();

  // ---------------- controls
  const speedBox = $('speeds');
  speedBox.innerHTML = speeds.map((x) => `<button type="button" class="b48" data-speed="${x}" aria-pressed="${x === rp.speed}">×${x}</button>`).join('');
  speedBox.addEventListener('click', (e) => {
    const b = e.target.closest('[data-speed]');
    if (!b) return;
    setSpeed(Number(b.dataset.speed));
  });
  // narrow screens: one button cycles the speeds (the segmented group is hidden there)
  const setSpeed = (x) => {
    rp.speed = x;
    speedBox.querySelectorAll('[data-speed]').forEach((b) => b.setAttribute('aria-pressed', String(Number(b.dataset.speed) === rp.speed)));
    $('btn-speed').textContent = '×' + x;
    $('btn-speed').setAttribute('aria-label', et('ctl.speed') + ' ×' + x);
  };
  $('btn-speed').onclick = () => setSpeed(speeds[(speeds.indexOf(rp.speed) + 1) % speeds.length]);
  setSpeed(rp.speed);
  const paceSel = $('pace');
  paceSel.innerHTML = PACES.map((p) => `<option value="${p}" ${p === st.pace ? 'selected' : ''}>${p} %</option>`).join('');
  if (!PACES.includes(st.pace)) paceSel.insertAdjacentHTML('beforeend', `<option value="${st.pace}" selected>${st.pace} %</option>`);
  paceSel.onchange = () => { st.pace = Number(paceSel.value); settingsChanged(false); };
  const autoCb = $('auto');
  autoCb.checked = st.auto;
  autoCb.onchange = () => { st.auto = autoCb.checked; settingsChanged(false); };

  const slider = $('slider');
  slider.addEventListener('input', () => seek(Number(slider.value)));
  slider.addEventListener('keydown', (e) => {
    const step = { ArrowLeft: -60, ArrowDown: -60, ArrowRight: 60, ArrowUp: 60, PageDown: -600, PageUp: 600 }[e.key];
    if (step) { e.preventDefault(); seek(rp.t + step); }
  });
  $('btn-play').onclick = () => (rp.playing ? pause() : play());
  $('btn-turn').onclick = () => turnNow();
  $('btn-map').onclick = () => {
    const on = !document.body.classList.contains('show-map');
    document.body.classList.toggle('show-map', on);
    $('btn-map').setAttribute('aria-pressed', String(on));
    $('btn-map').textContent = on ? et('ctl.info') : et('ctl.map');
    setTimeout(() => { map.invalidateSize(); panTo(true); }, 50);
  };

  function seek(t) {
    rp.t = Math.max(0, Math.min(plan.tEnd, t));
    if (rp.manualTurnT !== null && rp.t < rp.manualTurnT) { rp.manualTurnT = null; rebuild(); drawTurn(); renderStatic(); }
    render(true);
  }
  let wake = null;
  async function play() {
    if (rp.t >= plan.tEnd) seek(0);
    rp.playing = true;
    try { if (navigator.wakeLock && !wake) wake = await navigator.wakeLock.request('screen'); } catch (e) { wake = null; }
    render(true);
  }
  function pause() {
    rp.playing = false;
    if (wake) { wake.release().catch(() => {}); wake = null; }
    render(true);
  }
  function turnNow() {
    const s = evaState(R, P, rp.t);
    if (s.phase !== 'out' && s.phase !== 'stay') return;
    rp.manualTurnT = rp.t;
    rebuild(); drawTurn(); renderStatic(); render(true);
  }
  function settingsChanged(resetTime) {
    if (resetTime) { rp.t = 0; rp.manualTurnT = null; }
    rebuild(); drawRoute(); applyLayers(); renderStatic(); render(true); panTo(true);
  }

  // ---------------- setup dialog
  const dlg = $('setup');
  const fillSetup = () => {
    $('su-route').innerHTML = ['A', 'B'].map((r) => `<button type="button" class="b48" data-r="${r}" aria-pressed="${r === st.route}">${esc(et('hdr.route', { id: r }))}</button>`).join('');
    const starts = [];
    for (let h = 6; h <= 18; h += 0.5) starts.push(h);
    if (!starts.includes(st.start)) starts.push(st.start);
    starts.sort((a, b) => a - b);
    $('su-start').innerHTML = starts.map((h) => `<option value="${h}" ${h === st.start ? 'selected' : ''}>${clock(h)}</option>`).join('');
    const remsR = P.rems;
    $('su-season').innerHTML = lsBins(remsR).map((b) => `<option value="${b}" ${b === P.ls ? 'selected' : ''}>Ls ${b}–${Number(b) + 30}° (${remsR.diurnal_by_ls30[b].sols} sols)${b === DEFAULT_LS[st.route] ? ' · ' + esc(et('setup.default')) : ''}</option>`).join('');
    $('su-scenario').innerHTML = `<option value="normal">${esc(et('setup.sc_normal'))}</option>`
      + `<option value="spike4716" ${P.spikeAvailable ? '' : 'disabled'}>${esc(et('setup.sc_spike'))}</option>`;
    $('su-scenario').value = P.scenario;
    $('su-spike-note').textContent = P.spikeAvailable ? et('setup.spike_note') : et('setup.spike_na', { a: P.dose.sols[0], b: P.dose.sols[1] });
    const stays = [0, 10, 20, 30, 45, 60, 90, 120];
    if (!stays.includes(st.stay_min)) stays.push(st.stay_min);
    stays.sort((a, b) => a - b);
    $('su-stay').innerHTML = stays.map((m) => `<option value="${m}" ${m === st.stay_min ? 'selected' : ''}>${m} min${m === ev.dest_stay_min ? ' · ' + esc(et('setup.default')) : ''}</option>`).join('');
    $('su-assume').innerHTML = assumptionsHtml({ core });
    $('disc-full').textContent = disclaimer(true);
  };
  $('su-route').addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]');
    if (!b || b.dataset.r === st.route) return;
    st.route = b.dataset.r; st.season = null;
    if (st.scenario === 'spike4716' && !core.routes.routes[st.route].env.spike_scenario) st.scenario = 'normal';
    settingsChanged(true); fillSetup();
    map.setView([R.samples.lat[0], R.samples.lon[0]], 16);
  });
  $('su-start').onchange = (e) => { st.start = Number(e.target.value); settingsChanged(false); fillSetup(); };
  $('su-season').onchange = (e) => { st.season = e.target.value; settingsChanged(false); };
  $('su-scenario').onchange = (e) => { st.scenario = e.target.value; settingsChanged(false); fillSetup(); };
  $('su-stay').onchange = (e) => { st.stay_min = Number(e.target.value); settingsChanged(false); };
  const openSetup = () => { pause(); fillSetup(); if (!dlg.open) { dlg.showModal(); $('su-go').focus({ preventScroll: true }); dlg.scrollTop = 0; } };
  $('btn-setup').onclick = openSetup;
  dlg.addEventListener('close', () => {
    if (dlg.returnValue === 'go') { seek(0); play(); }
    $('btn-setup').focus();
  });

  // ---------------- keyboard (Plan/09 7-1)
  document.addEventListener('keydown', (e) => {
    if (dlg.open || e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = (e.target.tagName || '').toLowerCase();
    const inForm = ['input', 'select', 'textarea'].includes(tag);
    if (e.key === ' ' && !inForm && tag !== 'button' && tag !== 'a' && tag !== 'summary') { e.preventDefault(); rp.playing ? pause() : play(); }
    else if (inForm) return;
    else if (e.key === 'ArrowRight' && !e.target.closest('#map')) { e.preventDefault(); seek(rp.t + 300); }
    else if (e.key === 'ArrowLeft' && !e.target.closest('#map')) { e.preventDefault(); seek(rp.t - 300); }
    else if (e.key === 't' || e.key === 'T') { e.preventDefault(); turnNow(); }
    else if ((e.key === '+' || e.key === '=') && !e.target.closest('#map')) { e.preventDefault(); map.zoomIn(); }
    else if ((e.key === '-' || e.key === '_') && !e.target.closest('#map')) { e.preventDefault(); map.zoomOut(); }
  });

  // ---------------- rendering
  function disclaimer(full) {
    const sols = P.dose.sols;
    const where = et(st.route === 'A' ? 'disc.dose_where_A' : 'disc.dose_where_B', { a: sols[0], b: sols[1] });
    return full ? et('disc.full', { where }) : et('disc.short');
  }

  /** Parts that change only with settings/language: slider range + ticks, limit list, header. */
  function renderStatic() {
    slider.max = String(Math.max(1, Math.round(plan.tEnd)));
    const T = Math.max(1, plan.tEnd);
    const ticks = R.stations.filter((s) => s.d_m <= plan.dTurn + 1e-6).map((s) => ({ x: s.t_out_s / P.pace, lab: s.id, k: 'st' }));
    ticks.push({ x: plan.tRetStart, lab: '↩', k: 'tk-turn' });
    $('ticks').innerHTML = ticks.map((k) => `<span class="tick ${k.k}" style="left:${(k.x / T * 100).toFixed(2)}%"></span>`).join('');
    $('h-route').textContent = et('hdr.route_full', { id: st.route, start: clock(st.start), ls: P.ls, ls2: Number(P.ls) + 30 })
      + (P.scenario === 'spike4716' ? ' · ' + et('hdr.spike') : '');
    $('disc-line').textContent = disclaimer(false);
    $('lnk-plan').href = `map.html?route=${st.route}`;
  }

  let lastText = 0;
  function render(force = false) {
    const s = evaState(R, P, rp.t);
    // marker every frame, text 4 times a second (Plan/09 5)
    posMarker.setLatLng([s.pos.lat, s.pos.lon]);
    const now = performance.now();
    if (!force && now - lastText < 250) return;
    lastText = now;
    if (rp.follow) map.panTo([s.pos.lat, s.pos.lon], { animate: false });
    slider.value = String(Math.round(rp.t));
    slider.setAttribute('aria-valuetext', `${tplus(rp.t)}, LMST ${clock(s.lmst)}`);
    $('clock').textContent = `${tplus(rp.t)} · LMST ${clock(s.lmst)}`;
    const pb = $('btn-play');
    pb.setAttribute('aria-pressed', String(rp.playing));
    pb.querySelector('.ico').textContent = rp.playing ? '❚❚' : '▶';
    pb.querySelector('.lbl').textContent = rp.playing ? et('ctl.pause') : et('ctl.play');
    $('btn-turn').disabled = !(s.phase === 'out' || s.phase === 'stay');
    $('h-phase').textContent = phaseText(s);
    document.body.dataset.status = s.status;
    renderNext(s); renderMargin(s); renderSlope(s); renderRemain(s); renderLimit(s); renderDose(s); renderGround(s); renderComms(s); renderEquip(s);
    window.evaLast = s; // for the browser check
  }

  function phaseText(s) {
    if (s.phase === 'stay') return et('phase.stay', { where: s.plan.dTurn >= s.plan.dDest - 1e-9 ? et('phase.dest') : et('phase.turnpt') });
    return et('phase.' + s.phase);
  }

  function renderNext(s) {
    const n = s.next;
    const el = $('v2');
    if (!n) {
      el.innerHTML = `<h2 class="lab">${esc(et('next.label'))}</h2><p class="big num" data-check="eva.next">${esc(s.phase === 'done' ? et('next.arrived') : '—')}</p>`;
      return;
    }
    const name = n.turn ? et('next.turn_point') : n.station.kind === 'base' ? et('next.base') : n.id;
    const full = n.turn ? '' : pick(n.station, 'name');
    const brg = n.bearing_deg === null ? '—' : `${fmt(n.bearing_deg)}° ${bearing8(n.bearing_deg)}`;
    const dz = n.elev_change_m;
    el.innerHTML = `<h2 class="lab">${esc(et('next.label'))}</h2>
      <p class="big num" data-check="eva.next"><b>${esc(name)}</b> · ${esc(brg)} · ${fmt(n.along_m)} m · ${esc(mm(n.time_s))} · ${dz >= 0 ? '+' : '−'}${fmt(Math.abs(dz))} m</p>
      <p class="sub">${full && full !== n.id ? esc(full) + ' · ' : ''}${esc(et('next.latest', { t: tplus(n.latest_turn_s) }))}</p>`;
  }

  function renderMargin(s) {
    const el = $('v4');
    const pl = s.plan;
    el.className = 'card margin st-' + s.status;
    let head, big, sub = '';
    if (s.phase === 'out' || s.phase === 'stay') {
      head = et('margin.label');
      big = hmm(s.margin_s);
    } else {
      head = et('margin.label_back');
      big = (s.margin_s >= 0 ? '+' : '') + hmm(s.margin_s);
      sub = et('margin.back_detail', { eta: tplus(pl.tEnd), dl: tplus(pl.deadline) });
    }
    if (pl.temp.coldStart) sub = et('margin.cold_start') + (sub ? ' · ' + sub : '');
    const plan2 = pl.reachable
      ? et('margin.dest_ok', { s: hmm(pl.maxStay), stay: hmm(pl.stay) })
      : pl.turnD > 0 ? et('margin.turn_at', { d: fmt(pl.turnD), p: fmt(pl.turnD / pl.dDest * 100) }) : et('margin.no_go');
    const extra = [plan2];
    if (pl.manual) extra.push(et('margin.manual', { t: tplus(P.manualTurnT) }));
    if (!P.autoTurn && pl.overLimit) extra.push(et('margin.over_expected', { m: hmm(pl.tEnd - pl.deadline) }));
    el.innerHTML = `<h2 class="lab">${esc(head)}</h2>
      <div class="mrow">${SHAPES[s.status]}<span class="state">${esc(et('margin.' + s.status))}</span><span class="big num" data-check="eva.margin">${esc(big)}</span></div>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}<p class="sub">${esc(extra.join(' · '))}</p>`;
  }

  let lastBanner = '';
  function renderSlope(s) {
    const w = s.slope;
    const el = $('v7');
    const arrow = s.pos.grade_deg > 1 ? '↑' : s.pos.grade_deg < -1 ? '↓' : '→';
    let text;
    if (w.level === 'normal') text = et('slope.normal', { deg: fmt(w.current_deg), arrow, max: fmt(w.max_ahead_deg), m: P.lim.slope_lookahead_m });
    else if (w.level === 'danger') text = et('slope.danger', { max: fmt(w.hazard.max_slope_deg, 1) });
    else if (w.hazard.inside) text = et('slope.caution_in', { max: fmt(w.hazard.max_slope_deg, 1), len: fmt(w.hazard.len_m) });
    else text = et('slope.caution', { max: fmt(w.hazard.max_slope_deg, 1), dist: fmt(w.hazard.dist_m), len: fmt(w.hazard.len_m) });
    el.className = 'card slope lv-' + w.level;
    el.innerHTML = `<h2 class="lab">${esc(et('slope.label'))}</h2><p class="mid">${SHAPES[w.level]}<span data-check="eva.slope">${esc(text)}</span></p>
      <p class="sub">${esc(et('slope.note'))}</p>`;
    const banner = $('banner');
    if (w.level === 'normal') { banner.hidden = true; banner.className = 'banner'; lastBanner = ''; }
    else {
      const key = w.level + w.hazard.from_m;
      banner.hidden = false;
      banner.className = 'banner lv-' + w.level + (key !== lastBanner ? ' flash' : '');
      banner.innerHTML = `${SHAPES[w.level]}<span>${esc(text)}</span>`;
      lastBanner = key;
    }
  }

  function renderRemain(s) {
    const r = s.remaining;
    const destLab = r.dest_is_turn ? et('remain.to_turn') : et('remain.to_dest');
    $('v3').innerHTML = `<table class="kv">
      <tr><th>${esc(destLab)}</th><td class="num">${s.phase === 'out' ? `${fmt(r.to_dest_m)} m · ${esc(hmm(r.to_dest_s))}` : '—'}</td></tr>
      <tr><th>${esc(et('remain.to_base'))}</th><td class="num" data-check="eva.to_base">${fmt(r.to_base_m)} m · ${esc(hmm(r.to_base_s))}</td></tr>
      <tr><th>${esc(et('remain.elapsed'))}</th><td class="num">${esc(tplus(s.tc))} · LMST ${clock(s.lmst)} · ${fmt(s.walked_m)} m</td></tr></table>`;
  }

  function renderLimit(s) {
    const pl = s.plan;
    const D = pl.D;
    const frac = D > 0 ? Math.min(1, s.tc / D) : 1;
    const fmtLim = (k) => (pl.limits[k] === Infinity ? et(k === 'temp' && pl.temp.unknown ? 'limit.unknown' : 'limit.never') : hmm(pl.limits[k]));
    $('v5').innerHTML = `<h2 class="lab">${esc(et('limit.label'))}: <span class="bind" data-check="eva.binding">${esc(et('limit.' + pl.binding))}</span> <span class="num">${esc(hmm(D))}</span> <span class="tag">${esc(et('u.assumption'))}</span></h2>
      <div class="bar" role="img" aria-label="${esc(et('limit.bar_aria', { e: hmm(s.tc), d: hmm(D) }))}">
        <span class="fill" style="width:${(frac * 100).toFixed(1)}%"></span>
        ${D > 0 ? `<span class="mark dl" style="left:${Math.max(0, pl.deadline / D * 100).toFixed(1)}%" title="${esc(et('limit.deadline'))}"></span>` : ''}
        ${D > 0 ? `<span class="mark end" style="left:${Math.min(100, pl.tEnd / D * 100).toFixed(1)}%" title="${esc(et('limit.planned_end'))}"></span>` : ''}
      </div>
      <p class="sub num">${LIMIT_ORDER.map((k) => `${esc(et('limit.' + k))} ${esc(fmtLim(k))}`).join(' · ')}</p>
      <p class="sub">${esc(et('limit.return_by', { dl: tplus(pl.deadline), lm: clock(P.start + pl.deadline / LMST_HOUR_S), r: hmm(pl.R) }))}</p>`;
  }

  function renderDose(s) {
    const d = s.dose;
    const W = (x) => Math.min(100, x / d.budget * 100).toFixed(1);
    const sc = P.scenario === 'spike4716' ? et('dose.sc_spike', { sol: P.dose.spike.sol })
      : et('dose.sc_normal', { a: P.dose.sols[0], b: P.dose.sols[1], e: fmt(P.dose.E_rate, 3), bb: fmt(P.dose.B_rate, 3) });
    $('v6').innerHTML = `<h2 class="lab">${esc(et('dose.label'))}</h2>
      <div class="drow"><span class="dl">${esc(et('dose.crew'))}</span><span class="num" data-check="eva.dose_E">${fmt(d.E, 1)} µGy</span><span class="sub">${esc(et('dose.share', { p: pct(d.share), b: d.budget }))}</span></div>
      <div class="bar e" role="img" aria-label="${esc(et('dose.crew'))} ${fmt(d.E, 1)} µGy"><span class="fill" style="width:${W(d.E)}%"></span></div>
      <div class="drow"><span class="dl">${esc(et('dose.equip'))}</span><span class="num" data-check="eva.dose_B">${fmt(d.B, 1)} µGy(Si)</span></div>
      <div class="bar b" role="img" aria-label="${esc(et('dose.equip'))} ${fmt(d.B, 1)} µGy"><span class="fill" style="width:${W(d.B)}%"></span></div>
      <p class="sub">${esc(sc)} ${esc(et('dose.budget_note', { b: d.budget }))}</p>`;
  }

  function renderGround(s) {
    const g = s.ground;
    let main;
    if (g.K === null) main = et('ground.nodata');
    else main = `${tempCK(g.K)} · ${g.rate_K_h === null ? '—' : (g.rate_K_h >= 0 ? '+' : '−') + fmt(Math.abs(g.rate_K_h), 1)} K/h · ±${fmt(g.unc_K)} K`;
    const cold = g.K !== null && g.K < K_MINUS40;
    $('v8').className = 'card ground' + (cold ? ' lv-caution' : '');
    $('v8').innerHTML = `<h2 class="lab">${esc(et('ground.label'))}</h2>
      <p class="mid num"><span data-check="eva.ground">${esc(main)}</span>${g.interpolated ? ` <span class="tag">${esc(et('ground.interp'))}</span>` : ''}${cold ? ` <span class="tag warn">${esc(et('ground.below'))}</span>` : ''}</p>
      <p class="sub">${esc(et('ground.note', { ls: P.ls, ls2: Number(P.ls) + 30 }))}</p>`;
  }

  function renderComms(s) {
    const c = s.comms;
    const el = $('v9');
    if (!c.available) { el.className = 'card comms'; el.innerHTML = `<h2 class="lab">${esc(et('comms.label'))}</h2><p class="mid">${esc(et('comms.nodata'))}</p>`; return; }
    let text, lv = 'normal', sub = '';
    if (!c.los) {
      lv = 'caution'; text = et('comms.none');
      sub = s.phase === 'out' || s.phase === 'stay' ? et('comms.back_out', { d: fmt(c.to_los_m) }) : et('comms.back_ret', { d: fmt(c.to_los_m) });
    } else if (c.ahead) {
      lv = 'caution'; text = et('comms.ahead', { dist: fmt(c.ahead.dist_m), len: fmt(c.ahead.len_m) });
    } else text = et('comms.ok');
    el.className = 'card comms lv-' + lv;
    el.innerHTML = `<h2 class="lab">${esc(et('comms.label'))}</h2><p class="mid">${SHAPES[lv]}<span data-check="eva.comms">${esc(text)}</span></p>
      ${sub ? `<p class="sub">${esc(sub)}</p>` : ''}<p class="sub">${esc(et('comms.note', { h: core.config.comms.antenna_height_m }))}</p>`;
  }

  function renderEquip(s) {
    const q = s.equipment;
    const g = s.ground;
    const lo = 180, hi = 300; // K scale of the gauge
    const xp = (k) => ((Math.min(hi, Math.max(lo, k)) - lo) / (hi - lo) * 100).toFixed(1);
    const startH = P.start, endH = P.start + s.plan.tEnd / LMST_HOUR_S;
    const crosses = (h) => { for (let x = Math.floor(startH); x <= endH; x++) if (((x % 24) + 24) % 24 === h) return true; return false; };
    $('v10-body').innerHTML = `<table class="kv">
      <tr><th>${esc(et('equip.eva_si'))}</th><td class="num">${fmt(q.eva_B, 1)} µGy(Si)</td></tr>
      <tr><th>${esc(et('equip.mission', { sols: q.sols }))}</th><td class="num">${fmt(q.mission_B)} µGy(Si) = ${fmt(q.mission_B / 1000, 2)} mGy(Si) = ${fmt(q.mission_B / 10000, 2)} rad(Si)</td></tr>
      <tr><th>${esc(et('equip.cycles'))}</th><td class="num">${esc(et('equip.cycles_val', { n: q.cycles }))}</td></tr>
      <tr><th>${esc(et('equip.swing'))}</th><td class="num">${esc(et('equip.swing_val', { s: fmt(q.dT_season_K), p: fmt(q.dT_period_K, 1) }))}</td></tr>
      <tr><th>${esc(et('equip.rate'))}</th><td class="num">${esc(et('equip.rate_val', { up: fmt(q.fastest_up.K_h, 1), hu: q.fastest_up.hour, down: fmt(q.fastest_down.K_h, 1), hd: q.fastest_down.hour }))}${crosses(q.fastest_up.hour) || crosses(q.fastest_down.hour) ? ` <span class="tag warn">${esc(et('equip.in_window'))}</span>` : ''}</td></tr></table>
      <div class="gauge" role="img" aria-label="${esc(et('equip.gauge_aria', { k: g.K === null ? '—' : tempCK(g.K) }))}">
        <span class="gl l55" style="left:${xp(K_MINUS55)}%"><i>−55 °C</i></span><span class="gl l40" style="left:${xp(K_MINUS40)}%"><i>−40 °C</i></span>
        ${g.K === null ? '' : `<span class="gp" style="left:${xp(g.K)}%"></span>`}
      </div>
      <p class="sub">${esc(et('equip.gauge_note', { lo: fmt(lo - 273.15), hi: fmt(hi - 273.15) }))}</p>
      <p class="sub">${esc(et('equip.note'))}</p>`;
  }

  // ---------------- self-test
  let stResult = null;
  function renderSelftest(ref) {
    if (!stResult) stResult = runSelftest(core, ref);
    const r = stResult;
    const el = $('selftest');
    el.hidden = false;
    const row = (c) => `<tr class="${c.pass ? 'ok' : 'bad'}"><td>${esc(c.group)}</td><td>${esc(c.name)}</td><td class="num">${esc(c.expected)}</td><td class="num">${esc(c.got)}</td><td><b>${c.pass ? 'PASS' : 'FAIL'}</b></td><td class="small">${esc(c.note)}</td></tr>`;
    const tot = (rid) => `<h3>${esc(et('selftest.totals', { id: rid }))}</h3><table class="tbl"><thead><tr><th>${esc(et('selftest.item'))}</th><th>${esc(et('selftest.panel'))}</th><th>${esc(et('selftest.eva'))}</th></tr></thead><tbody>
      ${Object.entries(r.totals[rid]).filter(([k]) => k !== '_raw').map(([k, v]) => `<tr><td>${esc(k)}</td><td class="num" data-check="st.${rid}.${esc(k)}.panel">${esc(v.panel)}</td><td class="num" data-check="st.${rid}.${esc(k)}.eva">${esc(v.eva)}</td></tr>`).join('')}</tbody></table>`;
    el.innerHTML = `<div class="st-head"><h2 id="st-h">${esc(et('selftest.title'))}: <span data-check="st.result" class="${r.pass ? 'okc' : 'badc'}">${r.pass ? 'PASS' : 'FAIL'}</span> · ${esc(et('selftest.summary', { p: r.nPass, n: r.n }))}</h2>
      <button type="button" class="b48" id="st-close">${esc(et('setup.close'))}</button></div>
      <p class="small">${esc(et('selftest.intro'))}</p>
      ${tot('A')}${tot('B')}
      <h3>${esc(et('selftest.cases'))}</h3>
      <table class="tbl cases"><thead><tr><th>#</th><th>${esc(et('selftest.check'))}</th><th>${esc(et('selftest.expected'))}</th><th>${esc(et('selftest.got'))}</th><th></th><th></th></tr></thead><tbody>${r.cases.map(row).join('')}</tbody></table>`;
    $('st-close').onclick = () => { el.hidden = true; };
    document.body.dataset.selftest = r.pass ? 'pass' : 'fail';
    window.evaSelftest = r;
  }

  // ---------------- start
  applyEt();
  renderStatic();
  render(true);
  if (st.selftest) renderSelftest(await load('selftestRef'));
  else { fillSetup(); dlg.showModal(); $('su-go').focus({ preventScroll: true }); dlg.scrollTop = 0; }

  let last = performance.now();
  const frame = (now) => {
    const dt = Math.min(0.5, (now - last) / 1000);
    last = now;
    if (rp.playing) {
      rp.t += dt * rp.speed;
      if (rp.t >= plan.tEnd) { rp.t = plan.tEnd; pause(); }
      render(false);
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // hooks for scripts/57_eva_browser_check.mjs (read-only use of the same functions)
  window.evaApi = {
    seek, play, pause, turnNow,
    setSpeed: (x) => setSpeed(x),
    get t() { return rp.t; }, get plan() { return plan; }, get params() { return P; }, get playing() { return rp.playing; },
    state: (t) => evaState(R, P, t ?? rp.t),
  };
  document.body.dataset.ready = '1';
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('boot-error');
  el.hidden = false;
  el.textContent = 'Failed to start: ' + err.message + ' — serve the site folder with "python3 -m http.server" (file:// is not supported).';
});
