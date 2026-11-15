// Shared route math for planning mode, EVA mode (5-4) and the cuff checklist (5-5).
// Rule (Plan/09 sec.1): never recompute distance/time/slope - read routes.json arrays and summaries.
// Dose = period mean rate x time, with the period chosen per route by routes.json env.rad_period.

export const MARS_R = 3396190; // m, sphere used throughout (scripts/config.json crs)
const RAD = Math.PI / 180;

export function distanceM(lon1, lat1, lon2, lat2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD;
  const dp = p2 - p1, dl = (lon2 - lon1) * RAD;
  const a = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * MARS_R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Initial great-circle bearing, deg 0-360 from map north. */
export function bearingDeg(lon1, lat1, lon2, lat2) {
  const p1 = lat1 * RAD, p2 = lat2 * RAD, dl = (lon2 - lon1) * RAD;
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / RAD) + 360) % 360;
}

/** rad.json period object used for a route (A: early = measured at that site, B: recent). */
export function radPeriodKey(route) {
  return route.env?.rad_period ?? 'recent';
}
export function radPeriod(rad, route) {
  return rad.periods[radPeriodKey(route)];
}

/** Total planned EVA time (s): round-trip walk + destination stay (equals the end of an EVA replay). */
export function evaTimeS(route) {
  return route.summary.round_trip_with_stay_s;
}

export function doseUGy(rateUGyPerH, seconds) {
  return rateUGyPerH * seconds / 3600;
}

/**
 * Dose for the planned EVA of a route (mean-rate scenario).
 * Returns rates, doses and the transient-event-day doses where the period has one (route B).
 */
export function routeDose(route, rad, seconds = evaTimeS(route)) {
  const key = radPeriodKey(route);
  const P = rad.periods[key];
  const out = {
    period: key,
    sols: P.sol_range_in_data,
    nSols: P.n_sols,
    nValid: P.n_valid,
    seconds,
    hours: seconds / 3600,
    E_rate: P.E_mean,
    B_rate: P.B_mean,
    E: doseUGy(P.E_mean, seconds),
    B: doseUGy(P.B_mean, seconds),
    B_year_mGy: P.B_mean * 8766 / 1000,
    spike: null,
  };
  const sp = P.spikes && P.spikes[0];
  if (sp && route.env?.spike_scenario) {
    out.spike = {
      sol: sp.sol,
      E_rate: sp.E_solmean,
      B_rate: sp.B_solmean,
      E: doseUGy(sp.E_solmean, seconds),
      B: doseUGy(sp.B_solmean, seconds),
      E_obs_max: sp.E_obs_max,
    };
  }
  return out;
}

/** Index of the last sample with arr[i] <= v (binary search on a sorted array). */
export function searchSorted(arr, v) {
  let lo = 0, hi = arr.length - 1;
  if (v <= arr[0]) return 0;
  if (v >= arr[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= v) lo = mid; else hi = mid;
  }
  return lo;
}

/** Linear interpolation of sample columns at along-track distance d (m). */
export function sampleAtDistance(route, d) {
  const S = route.samples;
  const i = searchSorted(S.d_m, d);
  const j = Math.min(i + 1, S.d_m.length - 1);
  const span = S.d_m[j] - S.d_m[i];
  const f = span > 0 ? (d - S.d_m[i]) / span : 0;
  const lerp = (k) => S[k][i] + (S[k][j] - S[k][i]) * f;
  return { i, f, d, lon: lerp('lon'), lat: lerp('lat'), elev_m: lerp('elev_m'), t_out_s: lerp('t_out_s'),
    slope_deg: Math.max(S.slope_deg[i], S.slope_deg[j]) };
}

/** Distance along the route reached after walking t seconds outbound. */
export function distanceAtTime(route, t) {
  const S = route.samples;
  const i = searchSorted(S.t_out_s, t);
  const j = Math.min(i + 1, S.t_out_s.length - 1);
  const span = S.t_out_s[j] - S.t_out_s[i];
  const f = span > 0 ? (t - S.t_out_s[i]) / span : 0;
  return S.d_m[i] + (S.d_m[j] - S.d_m[i]) * f;
}

/** Slope class index (0: <5, 1: 5-15, 2: 15-25, 3: >=25) with walk thresholds from config. */
export function slopeClass(deg, walk) {
  if (deg >= walk.slope_danger_deg) return 3;
  if (deg >= walk.slope_caution_deg) return 2;
  if (deg >= walk.slope_moderate_deg) return 1;
  return 0;
}

/** Route polyline split into runs of equal slope class (segment = larger 5 m slope of its two ends). */
export function classRuns(route, walk) {
  const S = route.samples;
  const runs = [];
  let cur = null;
  for (let i = 0; i < S.d_m.length - 1; i++) {
    const c = slopeClass(Math.max(S.slope_deg[i], S.slope_deg[i + 1]), walk);
    if (!cur || cur.cls !== c) {
      cur = { cls: c, from_m: S.d_m[i], latlngs: [[S.lat[i], S.lon[i]]] };
      runs.push(cur);
    }
    cur.latlngs.push([S.lat[i + 1], S.lon[i + 1]]);
    cur.to_m = S.d_m[i + 1];
  }
  return runs;
}

/**
 * Hazard table: 5 m hazards (used for time and warnings) side by side with 2 m hazards (reference)
 * and the rover-recorded tilt nearby (Plan/11 sec.2-1). Overlapping intervals are merged into one row.
 */
export function hazardRows(route, tiltWindowM = 15) {
  const items = [
    ...(route.hazards || []).map((h) => ({ ...h, src: '5m' })),
    ...(route.hazards_2m || []).map((h) => ({ ...h, src: '2m' })),
  ].sort((a, b) => a.from_m - b.from_m);
  const rows = [];
  for (const h of items) {
    const last = rows[rows.length - 1];
    if (last && h.from_m <= last.to_m + 4) {
      last.to_m = Math.max(last.to_m, h.to_m);
      last[h.src] = last[h.src] ? mergeHz(last[h.src], h) : h;
    } else {
      rows.push({ from_m: h.from_m, to_m: h.to_m, [h.src]: h });
    }
  }
  for (const r of rows) {
    let best = null;
    for (const [d, tilt, sol] of route.rover_tilt || []) {
      if (d >= r.from_m - tiltWindowM && d <= r.to_m + tiltWindowM && (!best || tilt > best.tilt)) {
        best = { d, tilt, sol };
      }
    }
    r.tilt = best;
  }
  return rows;
}
function mergeHz(a, b) {
  return { ...a, from_m: Math.min(a.from_m, b.from_m), to_m: Math.max(a.to_m, b.to_m),
    len_m: a.len_m + b.len_m, max_slope_deg: Math.max(a.max_slope_deg, b.max_slope_deg),
    level: a.level === 'danger' || b.level === 'danger' ? 'danger' : a.level };
}

/** Minimum distance (m) from a point to the route samples (2 m spacing, so exact to ~1 m). */
export function distanceToRoute(route, lon, lat) {
  const S = route.samples;
  let best = Infinity, bi = 0;
  for (let i = 0; i < S.lon.length; i++) {
    const d = distanceM(lon, lat, S.lon[i], S.lat[i]);
    if (d < best) { best = d; bi = i; }
  }
  return { dist_m: best, d_m: S.d_m[bi] };
}

/** Photos whose (waypoint) position is within maxM of the route, nearest first. */
export function photosNearRoute(route, photos, maxM = 30) {
  const byPos = new Map();
  const out = [];
  for (const p of photos) {
    const k = p.lon + ',' + p.lat;
    if (!byPos.has(k)) byPos.set(k, distanceToRoute(route, p.lon, p.lat));
    const r = byPos.get(k);
    if (r.dist_m <= maxM) out.push({ photo: p, ...r });
  }
  return out.sort((a, b) => a.d_m - b.d_m || a.photo.sol - b.photo.sol);
}

/** Route bounds [[s, w], [n, e]] from the sample columns. */
export function routeBounds(route) {
  const S = route.samples;
  return [[Math.min(...S.lat), Math.min(...S.lon)], [Math.max(...S.lat), Math.max(...S.lon)]];
}

/** Walking speed multiplier for a slope (deg): 1.0 / 0.7 / 0.4 / 0 (impassable) from config.walk (same rule as 40_route_profile.py). */
export function walkFactor(deg, walk) {
  return [1.0, walk.speed_factor_moderate, walk.speed_factor_caution, walk.speed_factor_danger][slopeClass(deg, walk)];
}

/** Walk time (s) over lenM at slope deg; null when the slope is impassable. Used by the draw tool (5-3). */
export function walkTimeS(lenM, deg, walk) {
  const f = walkFactor(deg, walk);
  return f > 0 ? lenM / ((walk.flat_speed_kmh / 3.6) * f) : null;
}
