// Cuff checklist page (Plan/09 sec.8, Plan/15). Builds the cards from src/cuff/cards.js (which reuses
// src/eva/state.js) and lays them out 8 per A4 sheet. No numbers are computed in this file.
import { initI18n, pick, escapeHtml as esc } from '../i18n.js';
import { loadCore } from '../data.js';
import { fmt, lonlat, bearing8 } from '../format.js';
import { buildModel, readSettings } from './cards.js';
import { LMST_HOUR_S } from '../eva/state.js';

const PER_SHEET = 8;
const dicts = {};
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ strings (cuff.en.json, eva.en.json read-only; English only)
async function loadDicts() {
  const get = async (n) => {
    const r = await fetch(new URL(`../i18n/${n}.en.json`, import.meta.url));
    if (!r.ok) throw new Error(`${n}.en.json: HTTP ${r.status}`);
    return r.json();
  };
  [dicts.cuff, dicts.eva] = await Promise.all([get('cuff'), get('eva')]);
}
function look(d, key) {
  let o = d;
  for (const part of key.split('.')) { if (o == null || typeof o !== 'object') return undefined; o = o[part]; }
  return o;
}
function tr(set, key, vars) {
  let s = look(dicts[set], key);
  if (s === undefined) return key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}
const c = (key, vars) => tr('cuff', key, vars);
const ev = (key, vars) => tr('eva', key, vars);

// ------------------------------------------------------------------ small formatters (same text rules as eva.js)
function tplus(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.round(Math.abs(s) / 60);
  return `${s < 0 ? 'T−' : 'T+'}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
function hmm(s) {
  if (!Number.isFinite(s)) return '—';
  const m = Math.round(Math.abs(s) / 60);
  return `${s < 0 ? '−' : ''}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
}
function clock(h) {
  if (!Number.isFinite(h)) return '—';
  const x = ((h % 24) + 24) % 24;
  let m = Math.round(x * 60);
  if (m === 1440) m = 0;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
const brg = (deg) => `${String(Math.round(((deg % 360) + 360) % 360) % 360).padStart(3, '0')}° ${bearing8(deg)}`;
const sgn = (x, d = 0) => `${x >= 0 ? '+' : '−'}${fmt(Math.abs(x), d)}`;
const tempC = (K) => { if (K === null) return '—'; const r = Math.round(K - 273.15); return `${r === 0 ? '0' : fmt(r).replace('-', '−')} °C`; };
const m1 = (x) => fmt(x, 1);

const SYM = { caution: '▲', danger: '■', binding: '►' };

// ------------------------------------------------------------------ cards
const head = (M, left) => `<header class="ch"><span class="ch-l">${left}</span><span class="ch-r">${esc(c('card.sim'))} · ${esc(c('card.route', { id: M.st.route }))}</span></header>`;

function summaryCard(M) {
  const { plan, P, totals } = M;
  const limName = ev('limit.' + plan.binding);
  const dLm = P.start + plan.D / LMST_HOUR_S;
  let turn;
  if (plan.tEnd === 0 && P.autoTurn) turn = `<p class="flag"><b>${SYM.danger}</b> ${esc(c('summary.no_go'))}</p>`;
  else if (plan.reachable) turn = `<p><b>${esc(c('summary.turn'))}:</b> ${esc(c('summary.turn_dest', { s: hmm(plan.maxStay) }))}</p>`;
  else {
    const prev = [...M.R.stations].filter((s) => s.d_m <= plan.turnD + 0.5).pop();
    turn = `<p class="flag"><b>${SYM.caution}</b> <b>${esc(c('summary.turn'))}:</b> ${esc(c('summary.turn_at', { d: fmt(plan.turnD), id: prev ? prev.id : '—' }))}</p>`;
  }
  const over = !P.autoTurn && plan.overLimit ? `<p class="flag"><b>${SYM.danger}</b> ${esc(c('summary.over'))}</p>` : '';
  const dose = P.scenario === 'spike4716' ? c('summary.dose_spike') : c('summary.dose_normal', { a: P.dose.sols[0], b: P.dose.sols[1] });
  const dsr = Number.isFinite(plan.D);
  return `<article class="card summary" data-card="summary">
    ${head(M, `<b class="ttl">${esc(c('summary.title'))}</b> ${esc(pick(M.R, 'name') || M.R.id)}`)}
    <p><b>${esc(c('summary.round_trip'))}</b> <span class="v" data-v="round_trip">${fmt(totals.round_trip_m)} m</span> · <b>${esc(c('summary.planned'))}</b> <span class="v" data-v="planned">${hmm(plan.tEnd)}</span> (${esc(c('summary.walk'))} ${hmm(plan.tEnd - plan.stay)})</p>
    <p><b>${esc(c('summary.start'))}</b> <span class="v" data-v="start">LMST ${clock(P.start)}</span> · ${esc(c('summary.season', { ls: P.ls, ls2: Number(P.ls) + 30 }))}</p>
    <p class="key"><b>${esc(c('summary.limit'))}</b> <span data-v="D">${dsr ? tplus(plan.D) : '—'}</span> ${esc(limName)} <span class="sm">(LMST ${dsr ? clock(dLm) : '—'})</span></p>
    <p class="key"><b>${esc(c('summary.deadline'))}</b> <span data-v="deadline">${tplus(plan.deadline)}</span> <span class="sm">(LMST ${clock(P.start + plan.deadline / LMST_HOUR_S)}) · ${esc(c('summary.reserve'))} ${hmm(plan.R)}</span></p>
    ${turn}${over}
    <p class="sm">${esc(dose)} · ${esc(c('summary.pace', { p: fmt(P.pace * 100) }))}</p>
    <p class="sm note">${esc(c('summary.compass'))}</p>
    <p class="sm foot">${esc(c('summary.made', { date: M.date }))} · ${esc(c('summary.size'))} · ${esc(c('card.assumed'))}</p>
  </article>`;
}

function stopCard(M, s) {
  const { P } = M;
  const kind = c('stop.kind.' + (s.kind in { base: 1, dest: 1, via: 1, hazard: 1 } ? s.kind : 'via'));
  const full = pick(s.station, 'name');
  const nm = full && full !== s.id ? `<p class="sm name">${esc(full)}</p>` : '';
  const flags = [];
  let nextHtml = '', backHtml = '';
  if (s.next) {
    const n = s.next;
    nextHtml = `<p class="big nxt" data-v="next">${esc(c('stop.next'))} <b>→ ${esc(n.id)}</b> <b data-v="bearing">${esc(brg(n.bearing_deg))}</b> <b data-v="dist">${fmt(n.dist_m)} m</b></p>
      <p class="sm"><span data-v="legtime">${hmm(n.time_s)}</span> · <span data-v="climb">+${m1(n.climb_m)} / −${m1(n.descent_m)} m</span></p>`;
    if (n.len_over25_m > 0 || n.max_slope_deg >= P.walk.danger) flags.push(`<b>${SYM.danger}</b> ${esc(c('stop.slope_max_25', { max: fmt(n.max_slope_deg), len: fmt(n.len_over25_m) }))}`);
    else if (n.len_over15_m > 0 || n.max_slope_deg >= P.walk.caution) flags.push(`<b>${SYM.caution}</b> ${esc(c('stop.slope_max', { max: fmt(n.max_slope_deg), len: fmt(n.len_over15_m) }))}`);
    else nextHtml += `<p class="sm">${esc(c('stop.slope_none', { max: fmt(n.max_slope_deg) }))}</p>`;
    if (n.comms_out_m > 0) flags.push(`<b>${SYM.caution}</b> ${esc(c('stop.los_out', { m: fmt(n.comms_out_m) }))}`);
  } else {
    nextHtml = `<p class="big nxt">${esc(c('stop.stay', { m: fmt(s.stay_s / 60) }))}</p>`;
  }
  if (s.back) {
    const b = s.back;
    backHtml = `<p class="back"><b>${esc(c('stop.back'))}</b> ← ${esc(b.id)} <b data-v="backbearing">${esc(brg(b.bearing_deg))}</b> · <span data-v="backdist">${fmt(b.dist_m)} m</span></p>`;
  }
  if (s.turn) flags.unshift(`<b>${SYM.danger}</b> ${esc(c('stop.turn_point'))} <b data-v="turnbearing">${esc(brg(s.turn.bearing_deg))}</b> <span data-v="turndist">${fmt(s.turn.dist_m)} m</span>`);
  const flagHtml = flags.map((f) => `<p class="flag">${f}</p>`).join('');
  const beyond = s.beyond ? `<p class="flag strong"><b>${SYM.danger}</b> ${esc(c('stop.beyond'))}</p>` : '';
  const by = s.k === 0 ? c('stop.return_by') : c('stop.turnby');
  const g = s.ground_K === null ? c('stop.nodata') : `${tempC(s.ground_K)}${s.ground_interp ? ' (' + c('stop.ground_interp') + ')' : ''}`;
  return `<article class="card stop${s.beyond ? ' beyond' : ''}" data-card="stop" data-stop="${esc(s.id)}">
    ${head(M, `<b class="ttl">${esc(s.id)}</b> ${s.n}/${s.total} · ${esc(kind)}`)}
    ${nm}
    <p class="sm coord">${esc(lonlat(s.lon, s.lat))} · ${sgn(s.elev_m)} m</p>
    ${nextHtml}${backHtml}${flagHtml}${beyond}
    <p class="arr">${esc(c('stop.arrive'))} <span data-v="arrive">${tplus(s.arrive_s)}</span> <span class="sm">LMST <span data-v="arrive_lmst">${clock(s.arrive_lmst)}</span></span></p>
    <p class="turnby key"><b>${esc(by)}</b> <span data-v="latest">${tplus(s.latest_s)}</span> <span class="sm">LMST ${clock(s.latest_lmst)}</span></p>
    <p class="sm">${esc(c('stop.ground'))} <span data-v="ground">${esc(g)}</span> · ${esc(c('stop.dose'))} E ${m1(s.dose_E)} / Si ${m1(s.dose_B)} µGy</p>
  </article>`;
}

function limitsCard(M) {
  const { plan, P } = M;
  const row = (k) => {
    const v = plan.limits[k];
    const ok = Number.isFinite(v);
    const bind = plan.binding === k;
    return `<p class="lim${bind ? ' bind' : ''}" data-limit="${k}">${bind ? `<b>${SYM.binding}</b> ` : ''}<b>${esc(ev('limit.' + k))}</b> <span class="v">${ok ? tplus(v) : '—'}</span> <span class="sm">${ok ? clock(P.start + v / LMST_HOUR_S) : ''}</span></p>`;
  };
  const rows = M.stops.map((s) => `<tr data-stop="${esc(s.id)}"><th>${esc(s.id)}${s.beyond ? ' ' + SYM.danger : ''}</th><td class="t" data-v="latest">${tplus(s.latest_s)}</td><td class="t" data-v="arrive">${tplus(s.arrive_s)}</td></tr>`);
  const half = Math.ceil(rows.length / 2);
  const tbl = (rs) => `<table><thead><tr><th>${esc(c('limits.stop'))}</th><th>${esc(c('limits.turnby'))}</th><th>${esc(c('limits.arrive'))}</th></tr></thead><tbody>${rs.join('')}</tbody></table>`;
  return `<article class="card limits" data-card="limits">
    ${head(M, `<b class="ttl">${esc(c('limits.title'))}</b>`)}
    <div class="limgrid">${['time', 'daylight', 'temp', 'dose'].map(row).join('')}</div>
    <div class="tbls">${tbl(rows.slice(0, half))}${rows.length > half ? tbl(rows.slice(half)) : ''}</div>
    <p class="sm note">${esc(c('limits.note'))}</p>
  </article>`;
}

function contingencyCard(M) {
  const P = M.P;
  const where = ev(M.st.route === 'A' ? 'disc.dose_where_A' : 'disc.dose_where_B', { a: P.dose.sols[0], b: P.dose.sols[1] });
  return `<article class="card cont" data-card="contingency">
    ${head(M, `<b class="ttl">${esc(c('contingency.title'))}</b>`)}
    <p class="flag"><b>${SYM.danger}</b> ${esc(c('contingency.steep'))}</p>
    <p class="flag"><b>${SYM.caution}</b> ${esc(c('contingency.los'))}</p>
    <p class="flag"><b>${SYM.danger}</b> ${esc(c('contingency.dose'))}</p>
    <p class="sm">${esc(c('contingency.assumed'))}</p>
    <p class="sm note">${esc(c('contingency.disc', { where }))}</p>
    <footer class="sm cf" data-v="footer">${esc(c('card.footer'))}</footer>
  </article>`;
}

// ------------------------------------------------------------------ page
function render(core, st) {
  const M = buildModel(core, st);
  M.date = new Date().toISOString().slice(0, 10);
  const cards = [summaryCard(M), ...M.stops.map((s) => stopCard(M, s)), limitsCard(M), contingencyCard(M)];
  const sheets = [];
  for (let i = 0; i < cards.length; i += PER_SHEET) sheets.push(cards.slice(i, i + PER_SHEET));
  $('sheets').innerHTML = sheets.map((sh, i) => `<section class="sheet" data-sheet="${i + 1}" aria-label="${esc(c('screen.page', { n: i + 1 }))}">${sh.join('')}</section>`).join('');
  const P = M.P;
  $('count').textContent = c('screen.count', { n: cards.length, p: sheets.length });
  $('settings').textContent = [
    c('screen.set_route', { id: st.route }), c('screen.set_start', { h: clock(P.start) }),
    c('screen.set_season', { ls: P.ls, ls2: Number(P.ls) + 30 }), c('screen.set_pace', { p: fmt(P.pace * 100) }),
    c('screen.set_stay', { m: fmt(P.stay_s / 60) }),
    c('screen.set_auto', { v: P.autoTurn ? c('screen.on') : c('screen.off') }),
    P.scenario === 'spike4716' ? c('summary.dose_spike') : '',
  ].filter(Boolean).join(' · ');
  window.cuffApi = { model: M, params: P, plan: M.plan, nCards: cards.length, nSheets: sheets.length };
  return M;
}

function applyStatic() {
  document.title = c('doc_title');
  document.querySelectorAll('[data-c]').forEach((el) => { el.textContent = c(el.dataset.c); });
  document.querySelectorAll('[data-c-aria]').forEach((el) => el.setAttribute('aria-label', c(el.dataset.cAria)));
}

function evaHref(st, P) {
  const sp = new URLSearchParams({ route: st.route, start: String(st.start), season: P.ls, scenario: P.scenario });
  if (st.pace !== 100) sp.set('pace', String(st.pace));
  if (st.stay_min !== st.stayDefault) sp.set('stay', String(st.stay_min));
  if (!st.auto) sp.set('auto', '0');
  return 'eva.html?' + sp;
}

async function main() {
  await initI18n();
  await loadDicts();
  const core = await loadCore();
  const st = readSettings(location.search, core);
  st.stayDefault = core.config.eva.dest_stay_min;
  const redraw = () => {
    applyStatic();
    const M = render(core, st);
    st.season = M.P.ls;
    $('lnk-eva').href = evaHref(st, M.P);
    $('lnk-plan').href = `map.html?route=${st.route}`;
    // keep the URL contract (Plan/13 sec.2); lang= is ignored and dropped (English only)
    const u = new URL(location.href);
    u.searchParams.set('route', st.route); u.searchParams.set('start', String(st.start));
    u.searchParams.set('season', M.P.ls); u.searchParams.delete('ls'); u.searchParams.delete('lang');
    history.replaceState(null, '', u);
  };
  $('btn-print').addEventListener('click', () => window.print());
  redraw();
  document.body.dataset.ready = '1';
}

main().catch((err) => {
  console.error(err);
  const el = $('boot-error');
  el.hidden = false;
  el.textContent = dicts.cuff ? c('screen.error', { msg: err.message }) : 'Failed to load: ' + err.message;
});
