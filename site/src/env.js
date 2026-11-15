// Shared environment lookups: REMS ground temperature by season/LMST and the sol-4716 dose replay.
// Used by planning mode now and EVA mode / cuff checklist later (Plan/09 sec.3-3, 3-4).

export const K_MINUS40 = 233.15;
export const K_MINUS55 = 218.15;
export const LMST_HOUR_S = 3698.97; // SI seconds per LMST hour (config eva.sol_seconds / 24)

/** Default season (Ls 30-degree bin) per route, Plan/09 3-4 (assumption). */
export const DEFAULT_LS = { A: '180', B: '240' };

export function lsBins(rems) {
  return Object.keys(rems.diurnal_by_ls30).sort((a, b) => Number(a) - Number(b));
}

/** Hourly-mean curve (24 values, K, null = no data) for an Ls bin; kind 'gts' (ground) or 'amb' (air). */
export function curve(rems, ls, kind = 'gts') {
  const c = rems.diurnal_by_ls30[String(ls)];
  return c ? c[kind] : null;
}

/**
 * Fill null hours by circular linear interpolation between valid neighbours (Plan/09 3-4).
 * Gaps longer than maxGapH stay null. Returns {vals, filled[]}.
 */
export function fillCurve(vals, maxGapH = 3) {
  const n = vals.length;
  const out = vals.slice();
  const filled = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    if (vals[i] !== null) continue;
    let a = i, b = i, la = 0, lb = 0;
    while (vals[a] === null && la < n) { a = (a - 1 + n) % n; la++; }
    while (vals[b] === null && lb < n) { b = (b + 1) % n; lb++; }
    const gap = la + lb - 1;
    if (vals[a] === null || vals[b] === null || gap > maxGapH) continue;
    out[i] = vals[a] + (vals[b] - vals[a]) * (la / (la + lb));
    filled[i] = true;
  }
  return { vals: out, filled };
}

/** Ground temperature at an LMST (hours) for a season: value at h+0.5 for bin h, interpolated. */
export function gtsAt(rems, ls, lmst, kind = 'gts') {
  const raw = curve(rems, ls, kind);
  if (!raw) return { K: null, interpolated: false };
  const { vals, filled } = fillCurve(raw);
  const x = (((lmst - 0.5) % 24) + 24) % 24;
  const h0 = Math.floor(x), h1 = (h0 + 1) % 24, f = x - h0;
  if (vals[h0] === null || vals[h1] === null) return { K: null, interpolated: false };
  return { K: vals[h0] + (vals[h1] - vals[h0]) * f, interpolated: filled[h0] || filled[h1] };
}

/** Min/max/range and hours below thresholds of an hourly curve (raw values, nulls skipped). */
export function curveStats(vals) {
  const v = vals.filter((x) => x !== null);
  const min = Math.min(...v), max = Math.max(...v);
  return {
    min, max, range: max - min,
    nValid: v.length,
    nMissing: vals.length - v.length,
    hBelow40: v.filter((x) => x < K_MINUS40).length,
    hBelow55: v.filter((x) => x < K_MINUS55).length,
  };
}

/** Mean of a per-sol field over sols with >= minHours of ground temperature (range statistics rule). */
export function solMean(rems, field, minHours = 20) {
  const v = rems.sols.filter((s) => s.hrs >= minHours && s[field] !== null).map((s) => s[field]);
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** Spike-day series value (B or E) at an LMST, circular linear interpolation. */
function seriesAt(series, col, lmst) {
  const n = series.length;
  const x = ((lmst % 24) + 24) % 24;
  let j = series.findIndex((r) => r[0] > x);
  if (j === -1) j = n; // after last point: wrap to first
  const a = series[(j - 1 + n) % n], b = series[j % n];
  let xa = a[0], xb = b[0];
  if (j === 0) xa -= 24;
  if (j === n) xb += 24;
  const f = xb > xa ? (x - xa) / (xb - xa) : 0;
  return a[col] + (b[col] - a[col]) * f;
}

/**
 * Dose accumulated while replaying the sol-4716 transient-event day (Plan/09 3-3):
 * start at LMST startH, integrate durationS SI seconds with a 1-minute trapezoid.
 * Returns {E, B} in uGy. Columns of spike.series: [lmst_h, B, E].
 */
export function spikeDose(spike, startH, durationS, stepS = 60) {
  let E = 0, B = 0, t = 0;
  const lm = (ts) => startH + ts / LMST_HOUR_S;
  while (t < durationS) {
    const dt = Math.min(stepS, durationS - t);
    const e0 = seriesAt(spike.series, 2, lm(t)), e1 = seriesAt(spike.series, 2, lm(t + dt));
    const b0 = seriesAt(spike.series, 1, lm(t)), b1 = seriesAt(spike.series, 1, lm(t + dt));
    E += (e0 + e1) / 2 * dt / 3600;
    B += (b0 + b1) / 2 * dt / 3600;
    t += dt;
  }
  return { E, B };
}
