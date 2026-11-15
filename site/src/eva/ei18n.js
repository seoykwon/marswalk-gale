// EVA-mode strings live in src/i18n/eva.en.json. English only (Plan/17 P1-2); the shared i18n.js owns
// the shared dictionary (units, assumptions table).
const dicts = {};

export async function loadEvaDicts() {
  const r = await fetch(new URL('../i18n/eva.en.json', import.meta.url));
  if (!r.ok) throw new Error(`eva i18n en: HTTP ${r.status}`);
  dicts.en = await r.json();
  return dicts;
}

function lookup(d, key) {
  let o = d;
  for (const part of key.split('.')) {
    if (o == null || typeof o !== 'object') return undefined;
    o = o[part];
  }
  return o;
}

/** et('a.b', {n: 1}) from eva.en.json, or the key itself when missing. */
export function et(key, vars) {
  let s = lookup(dicts.en, key);
  if (s === undefined) return key;
  if (typeof s !== 'string') return s;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

/** Apply [data-et], [data-et-aria], [data-et-title] attributes. */
export function applyEt(root = document) {
  root.querySelectorAll('[data-et]').forEach((el) => { el.textContent = et(el.dataset.et); });
  root.querySelectorAll('[data-et-aria]').forEach((el) => el.setAttribute('aria-label', et(el.dataset.etAria)));
  root.querySelectorAll('[data-et-title]').forEach((el) => el.setAttribute('title', et(el.dataset.etTitle)));
  document.title = et('doc_title');
}

/** Key paths of a dictionary (for the self-test key check). */
export function keyPaths(o, pre = '') {
  return Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' && !Array.isArray(v)
    ? keyPaths(v, pre + k + '.') : [pre + k]));
}
export function dictsForCheck() { return dicts; }
