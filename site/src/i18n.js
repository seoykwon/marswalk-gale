// Shared strings: the site is English only (Plan/17 P1-2). Strings live in src/i18n/en.json.
// A ?lang= URL parameter is ignored (old links with lang=ko render English). Missing keys return the key.

let dict = {};

function lookup(d, key) {
  let o = d;
  for (const part of key.split('.')) {
    if (o == null || typeof o !== 'object') return undefined;
    o = o[part];
  }
  return o;
}

export async function initI18n() {
  const r = await fetch(new URL('./i18n/en.json', import.meta.url));
  if (!r.ok) throw new Error(`i18n en: HTTP ${r.status}`);
  dict = await r.json();
  document.documentElement.lang = 'en';
  applyI18n();
}

/** t('a.b', {n: 3}) -> string with {n} replaced. Arrays/objects are returned as-is. */
export function t(key, vars) {
  let s = lookup(dict, key);
  if (s === undefined) return key;
  if (typeof s !== 'string') return s;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return s;
}

/** Pick the English field of a data object: name_en, or name.en (other-language fields are not used). */
export function pick(obj, base = 'name') {
  if (!obj) return '';
  if (obj[base] && typeof obj[base] === 'object') return obj[base].en ?? '';
  return obj[`${base}_en`] ?? obj[base] ?? '';
}

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-aria]').forEach((el) => el.setAttribute('aria-label', t(el.dataset.i18nAria)));
  root.querySelectorAll('[data-i18n-title]').forEach((el) => el.setAttribute('title', t(el.dataset.i18nTitle)));
  if (root === document) document.title = t('ui.doc_title');
}

/** Inline glossary term: dotted underline, one-line explanation as tooltip (Plan/00 glossary). */
export function term(key, label) {
  const text = label ?? t(`glossary.${key}.term`);
  const def = t(`glossary.${key}.def`);
  return `<span class="term" tabindex="0" title="${escapeAttr(def)}">${escapeHtml(text)}</span>`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const escapeAttr = escapeHtml;
