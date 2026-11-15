// eva.html?selftest=1 - reproduces the Plan/09 4-4 hand cases on a virtual route and checks the real routes
// against (a) the planning-panel numbers, (b) the independent Python recomputation of stage 4
// (scripts/44_route_validate.py -> site/data/selftest_ref.json, loaded by eva.js and passed in as `ref`),
// (c) the JSON curves / hazards / comms gaps. Every value is produced by evaState()/evaPlan().
import { fmt, dur } from '../format.js';
import { routeDose, evaTimeS } from '../routecalc.js';
import { curve } from '../env.js';
import { makeParams, evaPlan, evaState } from './state.js';
import { dictsForCheck, keyPaths } from './ei18n.js';

/** Plan/09 4-4: flat straight 1,000 m, 2.5 km/h (0.6944 m/s), stay 0. 2 m samples like routes.json. */
function virtualRoute() {
  const v = 2500 / 3600;
  const n = 501;
  const S = { d_m: [], lon: [], lat: [], elev_m: [], slope_deg: [], grade_deg: [], vis: [], t_out_s: [], t_ret_s: [] };
  for (let i = 0; i < n; i++) {
    const d = i * 2;
    S.d_m.push(d); S.lon.push(137 + d / 59274.7); S.lat.push(0); S.elev_m.push(0);
    S.slope_deg.push(0); S.grade_deg.push(0); S.vis.push(1);
    S.t_out_s.push(d / v); S.t_ret_s.push(d / v);
  }
  const st = (id, kind, i) => ({ id, name_en: id, kind, d_m: S.d_m[i], lon: S.lon[i], lat: 0, elev_m: 0,
    t_out_s: S.t_out_s[i], t_ret_s: S.t_ret_s[i], stay_s: 0, leg: null });
  return { id: 'V', env: { rad_period: 'v', rems: 'v', spike_scenario: false }, samples: S,
    stations: [st('V1', 'base', 0), st('V2', 'dest', n - 1)], hazards: [], comms_gaps: [] };
}

function virtualCore(route, ev) {
  const warm = { gts: new Array(24).fill(280), amb: new Array(24).fill(250), sols: 1 };
  return {
    config: { eva: ev, walk: { slope_caution_deg: 15, slope_danger_deg: 25 } },
    // Plan/09 4-4 hand case uses the rates of that date: E 6.443, B 6.903 uGy/h (assumed numbers for the test)
    rad: { periods: { v: { E_mean: 6.443, B_mean: 6.903, spikes: [], sol_range_in_data: [0, 0] } } },
    rems: { v: { diurnal_by_ls30: { 0: warm }, mean_rate_K_per_h_by_hour: new Array(24).fill(0),
      summary: { mean_long_term_uncertainty_K: 0, range_mean_K: 0 } } },
    routes: { routes: { V: route } },
  };
}

export function runSelftest(core, ref) {
  // ref = site/data/selftest_ref.json (scripts/44_route_validate.py, Python standard library):
  // { scenarios: [...], spike: { sol, start9: { E_6h_uGy, B_6h_uGy, dose_limit_h }, start10: { E_6h_uGy, B_6h_uGy } } }
  const PY_REF = ref.scenarios;
  const SP = ref.spike;
  const cases = [];
  const add = (group, name, expected, got, pass, note = '') => cases.push({ group, name, expected: String(expected), got: String(got), pass: !!pass, note });
  const near = (a, b, tol) => a !== null && b !== null && Math.abs(a - b) <= tol;

  // ---- 1. Plan/09 4-4 hand cases (virtual route)
  const V = virtualRoute();
  const baseEv = { ...core.config.eva, daylight_end_lmst_h: 1000, min_ground_temp_C: -200, dose_budget_uGy_E: 1e9, dest_stay_min: 0 };
  {
    const P = makeParams(virtualCore(V, { ...baseEv, max_duration_h: 1, reserve_min: 10 }), 'V', { ls: '0', start: 10 });
    const pl = evaPlan(V, P);
    add('4-4', 'Ex1 one-way time 1,000 m @ 2.5 km/h', '1,440 s', fmt(V.samples.t_out_s.at(-1)) + ' s', near(V.samples.t_out_s.at(-1), 1440, 0.5));
    add('4-4', 'Ex1 D 1 h, reserve 10 min: destination reachable', 'yes', pl.reachable ? 'yes' : 'no', pl.reachable);
    add('4-4', 'Ex1 max stay at destination', '120 s', fmt(pl.maxStay) + ' s', near(pl.maxStay, 120, 0.5));
  }
  {
    const P = makeParams(virtualCore(V, { ...baseEv, max_duration_h: 0.75, reserve_min: 10 }), 'V', { ls: '0', start: 10 });
    const pl = evaPlan(V, P);
    const end = evaState(V, P, pl.tEnd + 1);
    add('4-4', 'Ex2 D 45 min, reserve 10 min: turnaround point', '729 m (±2)', fmt(pl.turnD, 1) + ' m', !pl.reachable && near(pl.turnD, 729, 2));
    add('4-4', 'Ex2 return to base', '2,100 s', fmt(pl.tEnd) + ' s', near(pl.tEnd, 2100, 0.5));
    add('4-4', 'Ex2 dose at return E (6.443 µGy/h)', '3.76 µGy', fmt(end.dose.E, 2) + ' µGy', fmt(end.dose.E, 2) === '3.76');
    add('4-4', 'Ex2 dose at return B (6.903 µGy/h)', '4.03 µGy', fmt(end.dose.B, 2) + ' µGy', fmt(end.dose.B, 2) === '4.03');
    add('4-4', 'Ex2 margin at the turnaround point', '0 s → TURN NOW', fmt(evaState(V, P, pl.tArr - 1e-6).margin_s) + ' s → ' + evaState(V, P, pl.tArr - 1e-6).status,
      evaState(V, P, pl.tArr - 1e-6).status === 'now');
  }
  {
    const P = makeParams(virtualCore(V, { ...baseEv, max_duration_h: 1000, reserve_min: 0 }), 'V', { ls: '0', start: 10, stay_s: 30000 });
    const s = evaState(V, P, 6 * 3600);
    add('4-4', 'Ex3 start LMST 10:00 + 6 SI h', 'LMST 15.84 h', 'LMST ' + fmt(s.lmst, 2) + ' h', fmt(s.lmst, 2) === '15.84');
  }

  // ---- 2. transient-day replay dose vs the Python recomputation (selftest_ref.json spike block; ±0.1 µGy)
  {
    const P = makeParams(core, 'B', { start: 9, ls: '240', scenario: 'spike4716', autoTurn: false, stay_s: 30000 });
    const pl = evaPlan(core.routes.routes.B, P);
    const s = evaState(core.routes.routes.B, P, 6 * 3600);
    const a9 = SP.start9, a10 = SP.start10;
    add('spike', `sol ${SP.sol} replay, start 09:00, 6 h: E`, fmt(a9.E_6h_uGy, 1) + ' µGy', fmt(s.dose.E, 1) + ' µGy', near(s.dose.E, a9.E_6h_uGy, 0.1), 'Python reference, tolerance 0.1 µGy');
    add('spike', `sol ${SP.sol} replay, start 09:00, 6 h: B`, fmt(a9.B_6h_uGy, 1) + ' µGy', fmt(s.dose.B, 1) + ' µGy', near(s.dose.B, a9.B_6h_uGy, 0.1), 'Python reference, tolerance 0.1 µGy');
    add('spike', 'E reaches the dose budget', fmt(a9.dose_limit_h, 2) + ' h (±0.02)', fmt(pl.limits.dose / 3600, 3) + ' h', near(pl.limits.dose / 3600, a9.dose_limit_h, 0.02));
    const P10 = makeParams(core, 'B', { start: 10, ls: '240', scenario: 'spike4716', autoTurn: false, stay_s: 30000 });
    const s10 = evaState(core.routes.routes.B, P10, 6 * 3600);
    add('spike', `sol ${SP.sol} replay, start 10:00, 6 h: E / B`, fmt(a10.E_6h_uGy, 1) + ' / ' + fmt(a10.B_6h_uGy, 1) + ' µGy', fmt(s10.dose.E, 1) + ' / ' + fmt(s10.dose.B, 1) + ' µGy',
      near(s10.dose.E, a10.E_6h_uGy, 0.1) && near(s10.dose.B, a10.B_6h_uGy, 0.1), 'Python reference, tolerance 0.1 µGy');
  }

  // ---- 3. scenarios vs the independent Python recomputation (stage 4)
  for (const ref of PY_REF) {
    const R = core.routes.routes[ref.route];
    const P = makeParams(core, ref.route, { start: ref.start, ls: ref.ls, scenario: ref.scenario, pace: ref.pace });
    const pl = evaPlan(R, P);
    const lim = ['time', 'daylight', 'dose'].every((k) => near(pl.limits[k], ref.limits[k], 1)) && near(pl.limits.temp, ref.limits.temp, 60);
    add('py', ref.label + ': limits time / daylight / temp / dose (s)',
      `${ref.limits.time} / ${ref.limits.daylight} / ${ref.limits.temp} / ${ref.limits.dose}`,
      `${fmt(pl.limits.time)} / ${fmt(pl.limits.daylight)} / ${fmt(pl.limits.temp)} / ${fmt(pl.limits.dose)}`.replace(/,/g, ''), lim,
      'tolerance 1 s; temp 60 s (Python used a 1-min search, this page bisects to 0.5 s)');
    add('py', ref.label + ': binding limit', ref.binding, pl.binding, pl.binding === ref.binding);
    add('py', ref.label + ': D − R (s)', ref.deadline, fmt(pl.deadline).replace(/,/g, ''), near(pl.deadline, ref.deadline, 1));
    if (ref.turnD === null) {
      add('py', ref.label + ': destination reachable, max stay (s)', 'yes, ' + ref.maxStay, (pl.reachable ? 'yes, ' : 'no, ') + fmt(pl.maxStay).replace(/,/g, ''),
        pl.reachable && near(pl.maxStay, ref.maxStay, 1));
    } else {
      add('py', ref.label + ': turnaround point (m)', ref.turnD + ' (±2)', fmt(pl.turnD, 1), !pl.reachable && near(pl.turnD, ref.turnD, 2));
    }
    const bad = pl.stations.filter((s) => !near(s.L_s, ref.L[s.id], 1));
    add('py', ref.label + ': latest turn-back L_k, all stations (±1 s)', Object.keys(ref.L).length + ' stations',
      bad.length ? 'mismatch ' + bad.map((s) => `${s.id} ${fmt(s.L_s)}≠${ref.L[s.id]}`).join(', ') : pl.stations.length + ' equal', !bad.length && pl.stations.length === Object.keys(ref.L).length);
  }

  // ---- 4. end of replay = planning panel route summary (same expressions as src/panels/route.js)
  const totals = {};
  for (const rid of ['A', 'B']) {
    const R = core.routes.routes[rid];
    const S = R.summary;
    const P = makeParams(core, rid, {}); // defaults: 10:00, default season, normal, pace 100 %, stay 30 min, auto
    const pl = evaPlan(R, P);
    const end = evaState(R, P, pl.tEnd + 1);
    const T = end.totals;
    const dose = routeDose(R, core.rad);
    const evaS = evaTimeS(R);
    const rows = [
      ['one-way distance', fmt(S.dist_m, 1) + ' m', fmt(T.one_way_m, 1) + ' m'],
      ['round-trip distance', fmt(S.round_trip_m, 1) + ' m', fmt(T.round_trip_m, 1) + ' m'],
      ['round-trip walk time', `${dur(S.round_trip_walk_s)} (${fmt(S.round_trip_walk_s)} s)`, `${dur(T.walk_s)} (${fmt(T.walk_s)} s)`],
      ['EVA total time (walk + stay)', `${dur(evaS)} (${fmt(evaS)} s)`, `${dur(T.time_s)} (${fmt(T.time_s)} s)`],
      ['ascent / descent (one way)', `+${fmt(S.climb_m, 1)} / −${fmt(S.descent_m, 1)} m`, `+${fmt(T.climb_m, 1)} / −${fmt(T.descent_m, 1)} m`],
      ['hazard length ≥15° (one way, 5 m)', fmt(S.len_over15_m, 1) + ' m', fmt(T.len_over15_m, 1) + ' m'],
      ['out-of-LOS length (one way)', fmt(S.comms_out_m, 1) + ' m', fmt(T.comms_out_m, 1) + ' m'],
      ['crew dose E (period mean)', fmt(dose.E, 1) + ' µGy', fmt(T.E, 1) + ' µGy'],
      ['equipment dose B (period mean)', fmt(dose.B, 1) + ' µGy(Si)', fmt(T.B, 1) + ' µGy(Si)'],
    ];
    totals[rid] = Object.fromEntries(rows.map(([k, a, b]) => [k, { panel: a, eva: b }]));
    totals[rid]._raw = { tEnd: pl.tEnd, walk_s: T.walk_s, E: T.E, B: T.B, source: T.source, fromSamples: T.fromSamples };
    for (const [k, a, b] of rows) add('panel', `Route ${rid}: ${k}`, a, b, a === b, T.source === 'summary' && /distance|ascent|hazard|LOS/.test(k) ? 'distance-type totals read routes.json summary (same object as the panel)' : 'recomputed from the replay timeline');
    const fs = T.fromSamples;
    const ok = near(fs.round_trip_m, S.round_trip_m, 0.15) && near(fs.climb_m, S.climb_m, 0.5) && near(fs.descent_m, S.descent_m, 0.5)
      && near(fs.len_over15_m, S.len_over15_m, 0.01) && near(fs.comms_out_m, S.comms_out_m, 0.01);
    add('panel', `Route ${rid}: same totals re-summed from samples (tolerance 0.15 m / 0.5 m)`,
      `${fmt(S.round_trip_m, 1)}, +${fmt(S.climb_m, 1)}/−${fmt(S.descent_m, 1)}, ${fmt(S.len_over15_m, 1)}, ${fmt(S.comms_out_m, 1)}`,
      `${fmt(fs.round_trip_m, 1)}, +${fmt(fs.climb_m, 1)}/−${fmt(fs.descent_m, 1)}, ${fmt(fs.len_over15_m, 1)}, ${fmt(fs.comms_out_m, 1)}`, ok,
      'samples are stored rounded to 0.1 m (Plan/12 3-2)');
  }

  // ---- 5. ground temperature: screen value at h+0.5 equals the JSON hourly mean; gap hours flagged
  for (const [rid, ls, h] of [['B', '240', 12], ['B', '0', 8], ['A', '180', 15]]) {
    const R = core.routes.routes[rid];
    const P = makeParams(core, rid, { ls, start: h + 0.5 });
    const g = evaState(R, P, 0).ground;
    const raw = curve(P.rems, ls, 'gts')[h];
    add('temp', `Route ${rid} Ls ${ls}, LMST ${h}:30`, fmt(raw, 2) + ' K', fmt(g.K, 2) + ' K' + (g.interpolated ? ' (interp.)' : ''), fmt(raw, 2) === fmt(g.K, 2) && !g.interpolated);
  }
  {
    const P = makeParams(core, 'B', { ls: '270', start: 9.5 });
    const g = evaState(core.routes.routes.B, P, 0).ground;
    add('temp', 'Route B Ls 270, LMST 9:30 (JSON hours 9-10 empty)', 'value + "interpolated"', (g.K === null ? 'none' : fmt(g.K, 1) + ' K') + (g.interpolated ? ' interpolated' : ' not flagged'), g.K !== null && g.interpolated);
  }

  // ---- 6. slope warning windows and 7. comms windows, scanned along an outbound replay (1 m steps)
  for (const rid of ['A', 'B']) {
    const R = core.routes.routes[rid];
    const P = makeParams(core, rid, { autoTurn: false });
    const pl = evaPlan(R, P);
    const slopeOn = [], losOff = [];
    let curS = null, curL = null;
    for (let d = 0; d <= pl.dDest; d += 1) {
      const t = R.samples.t_out_s.length ? colTime(R, d) : 0;
      const s = evaState(R, P, Math.min(t, pl.tArr - 1e-6));
      const on = s.slope.level !== 'normal';
      if (on && !curS) { curS = { from: d }; slopeOn.push(curS); }
      if (!on && curS) { curS.to = d - 1; curS = null; }
      const off = s.comms.available && !s.comms.los;
      if (off && !curL) { curL = { from: d }; losOff.push(curL); }
      if (!off && curL) { curL.to = d - 1; curL = null; }
    }
    if (curS) curS.to = Math.floor(pl.dDest);
    if (curL) curL.to = Math.floor(pl.dDest);
    const exp = R.hazards.map((h) => `${fmt(Math.max(0, h.from_m - P.lim.slope_lookahead_m))}–${fmt(h.to_m)}`);
    const got = slopeOn.map((w) => `${fmt(w.from)}–${fmt(w.to)}`);
    const okS = slopeOn.length === R.hazards.length && R.hazards.every((h, i) => Math.abs(slopeOn[i].from - Math.max(0, h.from_m - P.lim.slope_lookahead_m)) <= 1 && Math.abs(slopeOn[i].to - h.to_m) <= 1);
    add('warn', `Route ${rid}: slope warning on (m, outbound, 50 m ahead)`, exp.join(', ') || 'never', got.join(', ') || 'never', okS);
    const expL = R.comms_gaps.map((g) => `${fmt(g.from_m)}–${fmt(g.to_m)}`);
    const gotL = losOff.map((w) => `${fmt(w.from)}–${fmt(w.to)}`);
    const okL = losOff.length === R.comms_gaps.length && R.comms_gaps.every((g, i) => Math.abs(losOff[i].from - g.from_m) <= 1 && Math.abs(losOff[i].to - g.to_m) <= 1);
    add('warn', `Route ${rid}: no line of sight (m)`, expL.join(', ') || 'never', gotL.join(', ') || 'never', okL);
  }

  // ---- 8. strings: every data-et / data-et-aria key used on the page exists in eva.en.json (English only)
  {
    const have = new Set(keyPaths(dictsForCheck().en));
    const used = [...new Set([...document.querySelectorAll('[data-et]')].map((e) => e.dataset.et)
      .concat([...document.querySelectorAll('[data-et-aria]')].map((e) => e.dataset.etAria)))];
    const miss = used.filter((k) => !have.has(k));
    add('i18n', 'page keys present in eva.en.json', used.length + ' keys, all present', miss.length ? 'missing: ' + miss.join(', ') : used.length + ' keys, all present', !miss.length);
  }

  const pass = cases.every((c) => c.pass);
  return { pass, n: cases.length, nPass: cases.filter((c) => c.pass).length, cases, totals };
}

function colTime(R, d) {
  // outbound walking time at distance d (pace 1): linear in the t_out_s column
  const S = R.samples;
  let i = 0;
  while (i < S.d_m.length - 2 && S.d_m[i + 1] < d) i++;
  const f = (d - S.d_m[i]) / (S.d_m[i + 1] - S.d_m[i]);
  return S.t_out_s[i] + (S.t_out_s[i + 1] - S.t_out_s[i]) * Math.min(1, Math.max(0, f));
}
