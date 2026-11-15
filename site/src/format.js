// Shared number/unit formatting. Rounding rules here are mirrored by scripts/59_check_panels.py.
import { t } from './i18n.js';

/** Fixed decimals with thousands separators (en-US separators). Half away from zero. */
export function fmt(x, d = 0) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  const m = 10 ** d;
  const r = Math.sign(x) * Math.round(Math.abs(x) * m + 1e-9) / m;
  return r.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
}

export function signed(x, d = 0) {
  const s = fmt(x, d);
  return x > 0 ? '+' + s : s.replace('-', '−');
}

/** Seconds -> "1 h 02 min" (rounded to the minute). */
export function dur(s) {
  if (s === null || s === undefined) return '—';
  const m = Math.round(s / 60);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return h ? t('units.h_min', { h, m: String(mm).padStart(2, '0') }) : t('units.min', { m: mm });
}

export const K0 = 273.15;
export const kToC = (k) => k - K0;
export function tempCK(k, d = 0) {
  if (k === null || k === undefined) return '—';
  return `${fmt(kToC(k), d).replace('-', '−')} °C (${fmt(k, d)} K)`;
}

export function lonlat(lon, lat, d = 5) {
  const ns = lat < 0 ? 'S' : 'N';
  return `${fmt(Math.abs(lat), d)}°${ns}, ${fmt(lon, d)}°E`;
}

const DIR8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
export function bearing8(deg) {
  return DIR8[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
