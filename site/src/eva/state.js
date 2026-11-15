// EVA mode core (Plan/09 sec.3-5). Pure functions only - no DOM, no fetch.
//
//   P = makeParams(core, routeId, options)   resolved settings + the data the EVA needs (rates, curves, limits)
//   evaPlan(route, P)                         limits D, binding limit, turnaround point, timeline, L_k
//   evaState(route, P, t)                     everything the EVA screen shows at elapsed SI second t
//
// The replay, the time slider and the self-test all call evaState(); the screen never computes anything else.
// Distances/times/slopes are read from routes.json columns (never recomputed); dose = routecalc.doseUGy
// (period mean x time) or env.spikeDose (sol 4716 replay); ground temperature = env.gtsAt.
import { searchSorted, doseUGy, bearingDeg, radPeriodKey } from '../routecalc.js';
import { gtsAt, spikeDose, fillCurve, curve, LMST_HOUR_S, K_MINUS40, DEFAULT_LS } from '../env.js';

export const LIMIT_ORDER = ['time', 'daylight', 'temp', 'dose'];
export const NOW_WINDOW_S = 60; // assumption: 'turn back now' shows for the last minute of margin

/** Resolve URL/UI options into a frozen parameter object (all assumptions from config.eva). */
export function makeParams(core, rid, o = {}) {
  const { config, rad, rems, routes } = core;
  const R = routes.routes[rid];
  const ev = config.eva;
  const remsR = rems[R.env.rems] || rems[rid];
  const key = radPeriodKey(R);
  const per = rad.periods[key];
  const spikeOk = !!(R.env.spike_scenario && per.spikes && per.spikes[0]);
  const scenarioRequested = o.scenario === 'spike4716' ? 'spike4716' : 'normal';
  const scenario = scenarioRequested === 'spike4716' && spikeOk ? 'spike4716' : 'normal';
  const bins = Object.keys(remsR.diurnal_by_ls30);
  const ls = bins.includes(String(o.ls)) ? String(o.ls) : DEFAULT_LS[rid];
  return Object.freeze({
    rid,
    start: clampNum(o.start, 0, 24, ev.default_start_lmst_h),
    ls,
    scenario, scenarioRequested, spikeAvailable: spikeOk,
    pace: clampNum(o.pace, 0.5, 1.2, 1.0),
    stay_s: clampNum(o.stay_s, 0, 86400, ev.dest_stay_min * 60),
    autoTurn: o.autoTurn !== false,
    manualTurnT: Number.isFinite(o.manualTurnT) ? o.manualTurnT : null,
    lim: Object.freeze({
      max_duration_s: ev.max_duration_h * 3600,
      reserve_s: ev.reserve_min * 60,
      daylight_end_h: ev.daylight_end_lmst_h,
      min_ground_K: ev.min_ground_temp_C + 273.15,
      dose_budget_E: ev.dose_budget_uGy_E,
      turn_soon_s: ev.turn_soon_margin_min * 60,
      slope_lookahead_m: ev.slope_lookahead_m,
      comms_lookahead_m: ev.comms_lookahead_m,
      surface_sols: ev.equipment_surface_sols,
      sol_h: ev.sol_seconds / 3600,
    }),
    walk: { caution: config.walk.slope_caution_deg, danger: config.walk.slope_danger_deg },
    dose: Object.freeze({
      period: key, sols: per.sol_range_in_data,
      E_rate: per.E_mean, B_rate: per.B_mean,
      spike: scenario === 'spike4716' ? per.spikes[0] : null,
    }),
    rems: remsR,
  });
}

function clampNum(v, lo, hi, dflt) {
  const x = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(x)) return dflt;
  return Math.min(hi, Math.max(lo, x));
}

// ---------------------------------------------------------------- column interpolation helpers

/** Value of column `col` at along-track distance d (linear between 2 m samples). */
export function colAt(route, col, d) {
  const S = route.samples;
  const i = searchSorted(S.d_m, d);
  const j = Math.min(i + 1, S.d_m.length - 1);
  const span = S.d_m[j] - S.d_m[i];
  const f = span > 0 ? Math.min(1, Math.max(0, (d - S.d_m[i]) / span)) : 0;
  return S[col][i] + (S[col][j] - S[col][i]) * f;
}

/** Distance reached when the cumulative column `col` (t_out_s or t_ret_s, increasing) equals v. */
export function distAtCol(route, col, v) {
  const S = route.samples;
  const a = S[col];
  const i = searchSorted(a, v);
  const j = Math.min(i + 1, a.length - 1);
  const span = a[j] - a[i];
  const f = span > 0 ? Math.min(1, Math.max(0, (v - a[i]) / span)) : 0;
  return S.d_m[i] + (S.d_m[j] - S.d_m[i]) * f;
}

// ---------------------------------------------------------------- environment at a time

/** Cumulative absorbed dose (uGy) after t SI seconds: crew E (plastic detector, used as the body-side reading) and equipment B (silicon). */
export function doseAt(P, t) {
  if (t <= 0) return { E: 0, B: 0 };
  if (P.dose.spike) return spikeDose(P.dose.spike, P.start, t);
  return { E: doseUGy(P.dose.E_rate, t), B: doseUGy(P.dose.B_rate, t) };
}

export const lmstAt = (P, t) => P.start + t / LMST_HOUR_S;

/** Ground temperature (hourly-mean curve of the chosen season, interpolated) at elapsed t. */
export function groundAt(P, t) {
  const lm = lmstAt(P, t);
  const g = gtsAt(P.rems, P.ls, lm);
  const rate = P.rems.mean_rate_K_per_h_by_hour[Math.floor(((lm % 24) + 24) % 24)];
  return { K: g.K, interpolated: g.interpolated, rate_K_h: rate ?? null,
    unc_K: P.rems.summary.mean_long_term_uncertainty_K };
}

// ---------------------------------------------------------------- limits and plan

function tempLimit(P) {
  const minK = P.lim.min_ground_K;
  const k0 = groundAt(P, 0).K;
  if (k0 === null) return { s: Infinity, unknown: true, coldStart: false };
  if (k0 < minK) return { s: 0, unknown: false, coldStart: true };
  const step = 60, horizon = 24 * LMST_HOUR_S;
  let prev = 0;
  for (let t = step; t <= horizon; t += step) {
    const k = groundAt(P, t).K;
    if (k === null) return { s: Infinity, unknown: true, coldStart: false };
    if (k < minK) {
      let lo = prev, hi = t; // bisection to 0.5 s
      while (hi - lo > 0.5) {
        const m = (lo + hi) / 2;
        if (groundAt(P, m).K < minK) hi = m; else lo = m;
      }
      return { s: (lo + hi) / 2, unknown: false, coldStart: false };
    }
    prev = t;
  }
  return { s: Infinity, unknown: false, coldStart: false };
}

/** Time (s) when cumulative crew dose E reaches the budget: closed form (mean) or 1-min trapezoid (spike). */
export function doseLimit(P) {
  const budget = P.lim.dose_budget_E;
  if (!P.dose.spike) return budget / P.dose.E_rate * 3600;
  // same integration as env.spikeDose (1-minute trapezoid), stepped until E crosses the budget
  const step = 60, horizon = 72 * 3600;
  let E = 0;
  for (let t = 0; t < horizon; t += step) {
    const d = spikeDose(P.dose.spike, P.start + t / LMST_HOUR_S, step).E;
    if (E + d >= budget) return t + step * (budget - E) / d;
    E += d;
  }
  return Infinity;
}

const planCache = new WeakMap();

/** Limits, turnaround and the replay timeline for route + params (memoised per params object). */
export function evaPlan(route, P) {
  let byRoute = planCache.get(P);
  if (!byRoute) { byRoute = new Map(); planCache.set(P, byRoute); }
  if (byRoute.has(route)) return byRoute.get(route);

  const S = route.samples;
  const n = S.d_m.length, last = n - 1;
  const p = P.pace, R = P.lim.reserve_s;
  const dDest = S.d_m[last];

  const temp = tempLimit(P);
  const limits = {
    time: P.lim.max_duration_s,
    daylight: Math.max(0, (P.lim.daylight_end_h - P.start) * LMST_HOUR_S),
    temp: temp.s,
    dose: doseLimit(P),
  };
  let binding = LIMIT_ORDER[0];
  for (const k of LIMIT_ORDER) if (limits[k] < limits[binding]) binding = k;
  const D = limits[binding];
  const deadline = D - R; // latest return to base (elapsed s)

  // turnaround: largest d with (t_out(d) + t_ret(d)) / p <= D - R (Plan/09 4-2, step 2)
  const g = (i) => (S.t_out_s[i] + S.t_ret_s[i]) / p;
  let reachable = g(last) <= deadline;
  let turnD, maxStay = null;
  if (reachable) {
    turnD = dDest;
    maxStay = deadline - g(last);
  } else if (deadline < g(0) || deadline <= 0) {
    turnD = 0;
  } else {
    let lo = 0, hi = last; // g increasing: binary search last i with g(i) <= deadline
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (g(m) <= deadline) lo = m; else hi = m; }
    const f = g(hi) > g(lo) ? (deadline - g(lo)) / (g(hi) - g(lo)) : 0;
    turnD = S.d_m[lo] + (S.d_m[hi] - S.d_m[lo]) * f;
  }

  // planned timeline (auto turnaround on: go to turnD; off: follow the full plan regardless)
  const goal = P.autoTurn ? turnD : dDest;
  const atDest = goal >= dDest - 1e-9;
  let stay = atDest ? (P.autoTurn ? Math.min(P.stay_s, Math.max(0, maxStay ?? 0)) : P.stay_s) : 0;
  let dTurn = goal;
  let tArr = colAt(route, 't_out_s', goal) / p;
  let manual = false;
  if (P.manualTurnT !== null && P.manualTurnT < tArr + stay) {
    manual = true;
    if (P.manualTurnT <= tArr) {
      dTurn = distAtCol(route, 't_out_s', Math.max(0, P.manualTurnT) * p);
      tArr = Math.max(0, P.manualTurnT);
      stay = 0;
    } else {
      stay = P.manualTurnT - tArr;
    }
  }
  const tRet = colAt(route, 't_ret_s', dTurn) / p;
  const tRetStart = tArr + stay;
  const tEnd = tRetStart + tRet;

  // latest turn-back time per station: L_k = D - R - t_ret(k) / p (Plan/09 4-2, step 4)
  const stations = route.stations.map((s) => ({
    id: s.id, d_m: s.d_m,
    arrive_s: s.t_out_s / p,
    L_s: deadline - s.t_ret_s / p,
  }));

  const plan = {
    limits, binding, D, deadline, R, temp,
    reachable, turnD, maxStay, dDest,
    dTurn, tArr, stay, tRetStart, tEnd, manual,
    overLimit: tEnd > deadline + 0.5,
    stations,
  };
  byRoute.set(route, plan);
  return plan;
}

// ---------------------------------------------------------------- per-route cumulative sums (cached)

const cumCache = new WeakMap();
/** Cumulative climb / descent / hazard length (>=15 deg) / out-of-LOS length along the samples. */
export function routeCum(route, P) {
  if (cumCache.has(route)) return cumCache.get(route);
  const S = route.samples, n = S.d_m.length;
  const climb = new Float64Array(n), desc = new Float64Array(n), hz = new Float64Array(n), los = new Float64Array(n);
  const hasVis = Array.isArray(S.vis);
  for (let i = 1; i < n; i++) {
    const dz = S.elev_m[i] - S.elev_m[i - 1], ds = S.d_m[i] - S.d_m[i - 1];
    climb[i] = climb[i - 1] + Math.max(0, dz);
    desc[i] = desc[i - 1] + Math.max(0, -dz);
    hz[i] = hz[i - 1] + (Math.max(S.slope_deg[i], S.slope_deg[i - 1]) >= P.walk.caution ? ds : 0);
    los[i] = los[i - 1] + (hasVis && (S.vis[i] === 0 || S.vis[i - 1] === 0) ? ds : 0);
  }
  const out = { climb, desc, hz, los };
  cumCache.set(route, out);
  return out;
}
function cumAt(route, arr, d) {
  const S = route.samples;
  const i = searchSorted(S.d_m, d);
  const j = Math.min(i + 1, S.d_m.length - 1);
  const span = S.d_m[j] - S.d_m[i];
  const f = span > 0 ? Math.min(1, Math.max(0, (d - S.d_m[i]) / span)) : 0;
  return arr[i] + (arr[j] - arr[i]) * f;
}

/**
 * Trip totals for an outbound reach of dTurn. A full trip (dTurn = route end) reports routes.json `summary`,
 * the object the planning panel prints (sample columns are stored rounded to 0.1 m, so re-summing them
 * differs by 0.1-0.3 m - Plan/12 3-2). A partial trip sums the sample columns up to dTurn.
 */
export function tripTotals(route, P, dTurn) {
  const c = routeCum(route, P);
  const full = dTurn >= route.samples.d_m[route.samples.d_m.length - 1] - 1e-9;
  const fromSamples = {
    one_way_m: dTurn, round_trip_m: 2 * dTurn,
    climb_m: cumAt(route, c.climb, dTurn), descent_m: cumAt(route, c.desc, dTurn),
    len_over15_m: cumAt(route, c.hz, dTurn), comms_out_m: cumAt(route, c.los, dTurn),
  };
  if (!full || !route.summary || route.summary.round_trip_m === undefined) return { source: 'samples', ...fromSamples, fromSamples };
  const s = route.summary;
  return { source: 'summary', one_way_m: s.dist_m, round_trip_m: s.round_trip_m, climb_m: s.climb_m,
    descent_m: s.descent_m, len_over15_m: s.len_over15_m, comms_out_m: s.comms_out_m, fromSamples };
}

// ---------------------------------------------------------------- the state function

/**
 * Whole EVA screen state at elapsed SI second t (t >= 0). Pure: same (route, P, t) -> same result.
 * Phases: out -> stay (destination or turnaround point) -> back -> done.
 */
export function evaState(route, P, t) {
  const plan = evaPlan(route, P);
  const S = route.samples;
  const p = P.pace;
  t = Math.max(0, t);
  const tc = Math.min(t, plan.tEnd); // nothing accumulates after the return to base

  let phase, d, dir;
  if (t < plan.tArr) { phase = 'out'; d = distAtCol(route, 't_out_s', t * p); dir = 1; }
  else if (t < plan.tRetStart) { phase = 'stay'; d = plan.dTurn; dir = -1; }
  else if (t < plan.tEnd) {
    phase = 'back'; dir = -1;
    d = distAtCol(route, 't_ret_s', (plan.tEnd - t) * p);
  } else { phase = 'done'; d = 0; dir = -1; }
  if (plan.tEnd === 0) phase = 'done';

  const pos = {
    d_m: d,
    lon: colAt(route, 'lon', d), lat: colAt(route, 'lat', d), elev_m: colAt(route, 'elev_m', d),
    slope_deg: slopeAt(route, d), grade_deg: colAt(route, 'grade_deg', d) * (dir || 1),
  };
  const walked = phase === 'out' ? d : phase === 'stay' ? plan.dTurn : phase === 'back' ? 2 * plan.dTurn - d : 2 * plan.dTurn;

  // turnaround margin (Plan/09 4-2, step 5)
  let margin, status;
  if (phase === 'out' || phase === 'stay') {
    margin = plan.deadline - colAt(route, 't_ret_s', d) / p - t;
    // 'now' from one minute before zero: the countdown is shown in whole minutes, and with auto turnaround
    // the walker turns exactly at zero, so a strict "<= 0" would never be visible on screen.
    status = margin > P.lim.turn_soon_s ? 'ok' : margin >= NOW_WINDOW_S ? 'soon' : 'now';
  } else {
    margin = plan.deadline - plan.tEnd;
    status = margin >= -0.5 ? (phase === 'done' ? 'done' : 'back') : 'over';
  }
  // limits leave no time to walk out (e.g. ground already below -40 C at the start): do not start
  if (plan.tEnd === 0 && P.autoTurn) status = 'nogo';

  const dose = doseAt(P, tc);
  const lm = lmstAt(P, tc);
  const ground = groundAt(P, tc);

  return {
    t, tc, phase, dir, pos, walked_m: walked,
    lmst: lm,
    margin_s: margin, status,
    plan,
    next: nextTarget(route, P, plan, phase, d, pos),
    remaining: {
      to_dest_m: phase === 'out' ? Math.max(0, plan.dTurn - d) : 0,
      to_dest_s: phase === 'out' ? Math.max(0, plan.tArr - t) : 0,
      dest_is_turn: plan.dTurn < plan.dDest - 1e-9,
      to_base_m: Math.max(0, 2 * plan.dTurn - walked),
      to_base_s: Math.max(0, plan.tEnd - t),
    },
    dose: { E: dose.E, B: dose.B, budget: P.lim.dose_budget_E, share: dose.E / P.lim.dose_budget_E, scenario: P.scenario },
    ground,
    slope: slopeWarning(route, P, d, dir, phase),
    comms: commsWarning(route, P, d, dir, phase),
    equipment: equipment(P, dose.B),
    totals: phase === 'done' ? { ...tripTotals(route, P, plan.dTurn), time_s: plan.tEnd, walk_s: plan.tEnd - plan.stay, E: dose.E, B: dose.B } : null,
  };
}

function slopeAt(route, d) {
  const S = route.samples;
  const i = searchSorted(S.d_m, d);
  const j = Math.min(i + 1, S.d_m.length - 1);
  return Math.max(S.slope_deg[i], S.slope_deg[j]);
}

function nextTarget(route, P, plan, phase, d, pos) {
  const p = P.pace;
  const eps = 0.5;
  let st = null, isTurn = false;
  if (phase === 'out') {
    st = route.stations.find((s) => s.d_m > d + eps) || null;
    if (plan.dTurn < plan.dDest - 1e-9 && (!st || st.d_m > plan.dTurn + eps)) isTurn = true;
  } else if (phase === 'stay' || phase === 'back') {
    for (const s of route.stations) if (s.d_m < d - eps) st = s;
  }
  if (!st && !isTurn) return null;
  const tgt = isTurn
    ? { id: null, d_m: plan.dTurn, lon: colAt(route, 'lon', plan.dTurn), lat: colAt(route, 'lat', plan.dTurn), elev_m: colAt(route, 'elev_m', plan.dTurn) }
    : st;
  const along = Math.abs(tgt.d_m - d);
  const time = phase === 'out'
    ? (colAt(route, 't_out_s', tgt.d_m) - colAt(route, 't_out_s', d)) / p
    : (colAt(route, 't_ret_s', d) - colAt(route, 't_ret_s', tgt.d_m)) / p;
  const L = isTurn ? plan.deadline - colAt(route, 't_ret_s', plan.dTurn) / p : plan.deadline - (st.t_ret_s / p);
  return {
    turn: isTurn, station: isTurn ? null : st, id: isTurn ? null : st.id,
    d_m: tgt.d_m, along_m: along,
    bearing_deg: along > 0.5 ? bearingDeg(pos.lon, pos.lat, tgt.lon, tgt.lat) : null,
    time_s: Math.max(0, time),
    elev_change_m: tgt.elev_m - pos.elev_m,
    latest_turn_s: L,
  };
}

/** Slope warning over the next slope_lookahead_m in the walking direction (hazards[] = planning panel). */
function slopeWarning(route, P, d, dir, phase) {
  const look = P.lim.slope_lookahead_m;
  const S = route.samples;
  const a = dir > 0 ? d : Math.max(0, d - look);
  const b = dir > 0 ? Math.min(S.d_m[S.d_m.length - 1], d + look) : d;
  let maxAhead = 0;
  const i0 = searchSorted(S.d_m, a), i1 = Math.min(S.d_m.length - 1, searchSorted(S.d_m, b) + 1);
  for (let i = i0; i <= i1; i++) maxAhead = Math.max(maxAhead, S.slope_deg[i]);
  const cur = slopeAt(route, d);
  if (phase === 'done') return { level: 'normal', current_deg: cur, max_ahead_deg: maxAhead, hazard: null };
  let hit = null;
  for (const h of route.hazards || []) {
    if (h.to_m >= a && h.from_m <= b) {
      const inside = d >= h.from_m && d <= h.to_m;
      const dist = inside ? 0 : dir > 0 ? h.from_m - d : d - h.to_m;
      if (!hit || dist < hit.dist_m) hit = { ...h, dist_m: Math.max(0, dist), inside };
    }
  }
  let level = 'normal';
  if (hit) level = hit.level === 'danger' || hit.max_slope_deg >= P.walk.danger ? 'danger' : 'caution';
  return { level, current_deg: cur, max_ahead_deg: maxAhead, hazard: hit };
}

/** Line-of-sight warning: in a comms gap now, or one starting within comms_lookahead_m. */
function commsWarning(route, P, d, dir, phase) {
  if (!Array.isArray(route.samples.vis)) return { available: false };
  const end = route.samples.d_m[route.samples.d_m.length - 1];
  const gaps = route.comms_gaps || [];
  const inGap = gaps.find((g) => d >= g.from_m && (d < g.to_m || (g.to_m >= end - 1e-9 && d <= g.to_m)));
  if (phase === 'done') return { available: true, los: true, gap: null, ahead: null };
  if (inGap) return { available: true, los: false, gap: inGap, to_los_m: d - inGap.from_m, ahead: null };
  let ahead = null;
  for (const g of gaps) {
    const dist = dir > 0 ? g.from_m - d : d - g.to_m;
    if (dist > 0 && dist <= P.lim.comms_lookahead_m && (!ahead || dist < ahead.dist_m)) ahead = { ...g, dist_m: dist };
  }
  return { available: true, los: true, gap: null, ahead };
}

/** Equipment gauges (Plan/09 3-7): silicon dose this EVA, mission total (assumed surface sols), thermal cycles. */
function equipment(P, evaB) {
  const raw = curve(P.rems, P.ls, 'gts') || [];
  const { vals } = fillCurve(raw);
  const v = vals.filter((x) => x !== null);
  const rate = P.rems.mean_rate_K_per_h_by_hour;
  const rv = rate.filter((x) => x !== null);
  const up = Math.max(...rv), down = Math.min(...rv);
  return {
    eva_B: evaB,
    mission_B: P.dose.B_rate * P.lim.sol_h * P.lim.surface_sols + evaB,
    sols: P.lim.surface_sols,
    cycles: P.lim.surface_sols,
    dT_season_K: v.length ? Math.max(...v) - Math.min(...v) : null,
    dT_period_K: P.rems.summary.range_mean_K,
    fastest_up: { K_h: up, hour: rate.indexOf(up) },
    fastest_down: { K_h: down, hour: rate.indexOf(down) },
  };
}

/** K_MINUS40 re-exported for the gauge scale. */
export { K_MINUS40, LMST_HOUR_S };
