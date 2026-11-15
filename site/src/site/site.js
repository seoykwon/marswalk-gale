// Site pages (home, method, electronics, sources; Plan/18 sec.3, Plan/21 W2): shared menu and footer,
// page strings and fact values. English only. Used as <script type="module" src="src/site/site.js">.
//
// Markup it fills (all optional):
//   <nav id="site-nav"></nav>          menu; the current page gets aria-current="page"
//   <footer id="site-footer"></footer> repository link only (Plan/18 user decision: no name, no contact)
//   data-s="key"                       text from src/i18n/site.en.json, or from a page dictionary named in
//                                      <body data-dict="home"> (src/i18n/home.en.json; its keys win)
//   data-s-aria="key"                  aria-label from the same dictionaries
//   data-fact="key"                    value from data/site_facts.json (written by scripts/61_site_facts.py);
//                                      data-fact-part="t" (default: formatted text with unit), "n" (number only), "u" (unit)
// The page HTML keeps English fallback text in every slot, so it reads without JavaScript.
// When done: <body data-ready="1">, and window.siteFacts holds the loaded facts (for scripts/62 later).
// All URLs are relative (GitHub Pages sub-path, e.g. /marswalk-gale/).

// TODO(release): set the public repository URL here, in this one place. While it is empty the footer
// shows a plain-text note instead of a link (Plan/18 decision 9 + user decision: footer = repo link only).
export const REPO_URL = 'https://github.com/seoykwon/marswalk-gale';

/** Menu order and targets. `live: false` = page not built yet (W4–W6); it is left out of the menu. */
export const PAGES = [
  { id: 'home', href: 'index.html', live: true },
  { id: 'map', href: 'map.html', live: true },
  { id: 'eva', href: 'eva.html?route=B', live: true },
  { id: 'cuff', href: 'cuff.html?route=B', live: true },
  { id: 'about', href: 'about.html', live: true },
  { id: 'electronics', href: 'electronics.html', live: true },
  { id: 'sources', href: 'sources.html', live: true },
];

const ROOT = new URL('../../', import.meta.url); // site root
let dict = {};

function lookup(d, key) {
  let o = d;
  for (const part of key.split('.')) {
    if (o == null || typeof o !== 'object') return undefined;
    o = o[part];
  }
  return o;
}

/** s('nav.map') -> string; missing keys return undefined so the HTML fallback text stays. */
export function s(key, vars) {
  let v = lookup(dict, key);
  if (typeof v !== 'string') return undefined;
  if (vars) v = v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return v;
}

const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function loadJson(rel) {
  const r = await fetch(new URL(rel, ROOT));
  if (!r.ok) throw new Error(`${rel}: HTTP ${r.status}`);
  return r.json();
}

function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && a[k] && typeof a[k] === 'object' ? merge(a[k], v) : v;
  }
  return out;
}

function currentPageId() {
  const file = location.pathname.split('/').pop() || 'index.html';
  const p = PAGES.find((x) => x.href.split('?')[0] === file);
  return p ? p.id : null;
}

export function renderNav(el) {
  const cur = currentPageId();
  const items = PAGES.filter((p) => p.live && p.id !== 'home');
  el.setAttribute('aria-label', s('nav.label') ?? 'Site');
  el.innerHTML = `<a class="site-name" href="index.html"${cur === 'home' ? ' aria-current="page"' : ''}>${esc(s('site.name') ?? 'Marswalk')}</a>
    <ul>${items.map((p) => `<li><a href="${p.href}"${p.id === cur ? ' aria-current="page"' : ''}>${esc(s('nav.' + p.id) ?? p.id)}</a></li>`).join('')}</ul>`;
}

export function renderFooter(el) {
  if (!el.getAttribute('aria-label')) el.setAttribute('aria-label', s('footer.label') ?? 'Site footer');
  el.innerHTML = REPO_URL
    ? `<p><a href="${esc(REPO_URL)}" rel="noopener">${esc(s('footer.repo'))}</a></p>`
    : `<p class="muted" data-todo="repo-url">${esc(s('footer.repo_pending'))}</p>`;
}

export function applyStrings(root = document) {
  root.querySelectorAll('[data-s]').forEach((e) => { const v = s(e.dataset.s); if (v !== undefined) e.textContent = v; });
  root.querySelectorAll('[data-s-aria]').forEach((e) => { const v = s(e.dataset.sAria); if (v !== undefined) e.setAttribute('aria-label', v); });
}

/** Fill every [data-fact] from data/site_facts.json. Unknown keys keep their fallback and get data-fact-missing. */
export function applyFacts(facts, root = document) {
  let missing = 0;
  root.querySelectorAll('[data-fact]').forEach((e) => {
    const f = facts[e.dataset.fact];
    if (!f) { e.setAttribute('data-fact-missing', ''); missing++; return; }
    const part = e.dataset.factPart || 't';
    e.textContent = part === 'n' ? f.n : part === 'u' ? (f.u || '') : f.t;
    e.classList.add('num');
  });
  return missing;
}

async function main() {
  const pageDict = document.body.dataset.dict;
  const [base, page] = await Promise.all([
    loadJson('src/i18n/site.en.json'),
    pageDict ? loadJson(`src/i18n/${pageDict}.en.json`) : Promise.resolve({}),
  ]);
  dict = merge(base, page);
  document.documentElement.lang = 'en';
  const nav = document.getElementById('site-nav');
  if (nav) renderNav(nav);
  const foot = document.getElementById('site-footer');
  if (foot) renderFooter(foot);
  applyStrings();
  // a page dictionary may set the document title (as eva.en.json does); otherwise the HTML <title> stays
  const title = pageDict ? s('doc_title') : undefined;
  if (title) document.title = title;
  if (document.querySelector('[data-fact]')) {
    const doc = await loadJson('data/site_facts.json');
    window.siteFacts = doc.facts;
    document.body.dataset.factsMissing = String(applyFacts(doc.facts));
  }
  document.body.dataset.ready = '1';
}

main().catch((e) => {
  // keep the static fallback text; mark the page so a check can see it
  document.body.dataset.ready = 'error';
  document.body.dataset.siteError = String(e && e.message || e);
});
