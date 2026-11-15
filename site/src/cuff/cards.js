// Cuff checklist model (Plan/09 sec.8, Plan/15). Pure functions, no DOM, no fetch.
// Every number comes from src/eva/state.js (makeParams / evaPlan / doseAt / groundAt / lmstAt / tripTotals)
// and routecalc.bearingDeg - the same functions EVA mode uses. Nothing is re-derived here.
import { makeParams, evaPlan, doseAt, groundAt, lmstAt, tripTotals, colAt } from '../eva/state.js';
import { bearingDeg } from '../routecalc.js';

/** URL query -> options for makeParams. Same contract as eva.html (Plan/13 sec.2; old ls=, extras pace/stay/auto). */
export function readSettings(search, core) {
  const q = new URLSearchParams(search);
  const ev = core.config.eva;
  const num = (k) => (q.has(k) && q.get(k) !== '' && Number.isFinite(Number(q.get(k))) ? Number(q.get(k)) : null);
  const start = num('start');
  const sc = q.get('scenario');
  return {
    route: q.get('route') === 'A' ? 'A' : 'B',
    start: start !== null && start >= 0 && start < 24 ? start : ev.default_start_lmst_h,
    season: q.get('season') ?? q.get('ls'),
    scenario: sc === 'spike4716' || sc === 'spike' ? 'spike4716' : 'normal',
    pace: num('pace') !== null ? Math.min(120, Math.max(50, num('pace'))) : 100,
    stay_min: num('stay') !== null ? Math.max(0, num('stay')) : ev.dest_stay_min,
    auto: q.get('auto') !== '0',
  };
}

export function paramsFor(core, st) {
  return makeParams(core, st.route, {
    start: st.start, ls: st.season, scenario: st.scenario, pace: st.pace / 100,
    stay_s: st.stay_min * 60, autoTurn: st.auto, manualTurnT: null,
  });
}

/** All numbers behind the cards. Seconds are elapsed SI seconds from the start (T+). */
export function buildModel(core, st) {
  const R = core.routes.routes[st.route];
  const P = paramsFor(core, st);
  const plan = evaPlan(R, P);
  const S = R.stations;
  const p = P.pace;
  const end = S.length - 1;

  const stops = S.map((s, k) => {
    const pl = plan.stations[k];
    const nx = S[k + 1] || null;
    const pv = S[k - 1] || null;
    const next = nx ? {
      id: nx.id,
      bearing_deg: bearingDeg(s.lon, s.lat, nx.lon, nx.lat),
      dist_m: nx.d_m - s.d_m,
      time_s: (nx.t_out_s - s.t_out_s) / p,
      elev_change_m: nx.elev_m - s.elev_m,
      climb_m: s.leg.climb_m, descent_m: s.leg.descent_m,
      max_slope_deg: s.leg.max_slope_deg, len_over15_m: s.leg.len_over15_m, len_over25_m: s.leg.len_over25_m,
      comms_out_m: s.leg.comms_out_m,
    } : null;
    const back = pv ? {
      id: pv.id,
      bearing_deg: bearingDeg(s.lon, s.lat, pv.lon, pv.lat),
      dist_m: s.d_m - pv.d_m,
    } : null;
    // EVA mode names the turnaround point as the next target when it lies before the next station
    let turn = null;
    if (!plan.reachable && plan.turnD > s.d_m + 0.5 && (!nx || nx.d_m > plan.turnD + 0.5)) {
      turn = {
        bearing_deg: bearingDeg(s.lon, s.lat, colAt(R, 'lon', plan.turnD), colAt(R, 'lat', plan.turnD)),
        dist_m: plan.turnD - s.d_m,
      };
    }
    const g = groundAt(P, pl.arrive_s);
    const dose = doseAt(P, pl.arrive_s);
    return {
      k, id: s.id, kind: s.kind, station: s, n: k + 1, total: S.length,
      lon: s.lon, lat: s.lat, elev_m: s.elev_m, d_m: s.d_m,
      arrive_s: pl.arrive_s, arrive_lmst: lmstAt(P, pl.arrive_s),
      latest_s: pl.L_s, latest_lmst: lmstAt(P, pl.L_s),
      beyond: s.d_m > plan.dTurn + 0.5, // arrival after the turnaround point: cannot be reached in time
      next, back, turn,
      ground_K: g.K, ground_interp: g.interpolated,
      dose_E: dose.E, dose_B: dose.B,
      stay_s: k === end ? plan.stay : 0,
    };
  });

  const totals = tripTotals(R, P, plan.dTurn);
  return { R, P, plan, stops, totals, end, st };
}
