// Offline support (stage 5-5 B, Plan/09 sec.6): registers ../sw.js and draws the "Offline ready" control.
// Used by index.html (home), map.html, eva.html and cuff.html: <script type="module" src="src/sw-register.js">.
// The control appears only where the page has <div id="offline-slot"> (attributes: data-btn-class = class
// for its buttons, data-dict = "eva" or "main" for the strings, data-inline="1" = panel always open, no
// toggle button; used in the EVA setup dialog so the EVA header keeps one row). Strings: offline.* in src/i18n/en.json
// and src/i18n/eva.en.json (English only, Plan/17 P1-2).
// The page itself downloads the tiles into the cache the worker reads (names from the worker), so the
// progress and stored size are easy to show. All URLs are relative to the site root (GitHub Pages sub-path).

const ROOT = new URL('../', import.meta.url); // site root = worker scope
const LIST_URL = new URL('data/eva_precache.json', ROOT).href;
const PREFIX = 'gale-offline:' + ROOT.pathname + ':'; // = sw.js
const PARALLEL = 6;

const state = { doc: null, names: null, phase: 'idle', done: 0, total: 0, failed: 0, stored: { shell: 0, offline: 0, nOff: 0 }, msg: '' };
const dicts = {};
let ui = null;

const abs = (u) => new URL(u, ROOT).href;
const mb = (b) => (b / 1e6).toFixed(1);

async function loadDict(name) {
  if (!dicts[name]) {
    const file = name === 'eva' ? 'eva.en.json' : 'en.json';
    dicts[name] = fetch(new URL(`i18n/${file}`, import.meta.url)).then((r) => (r.ok ? r.json() : {})).then((d) => d.offline || {}, () => ({}));
  }
  return dicts[name];
}
let strings = {};
function s(key, vars) {
  let v = strings[key] ?? key;
  if (vars) v = v.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? vars[k] : m));
  return v;
}

function cacheNames(doc) {
  return { shell: PREFIX + 'shell-' + doc.shell.version, offline: PREFIX + 'offline-' + doc.tiles.version + '-' + doc.extras.version };
}

/** What is stored now: bytes of listed files present in our caches (sizes from the list). */
async function measure() {
  const { doc, names } = state;
  if (!doc || !('caches' in self)) return;
  const size = new Map([...doc.shell.files, ...doc.tiles.files, ...doc.extras.files].map((f) => [abs(f[0]), f[1]]));
  const sum = async (name) => {
    if (!(await caches.has(name))) return [0, 0];
    const keys = await (await caches.open(name)).keys();
    let b = 0, n = 0;
    for (const r of keys) { const x = size.get(r.url); if (x !== undefined) { b += x; n++; } }
    return [b, n];
  };
  const [sb] = await sum(names.shell);
  const [ob, on] = await sum(names.offline);
  state.stored = { shell: sb, offline: ob, nOff: on };
}

function status() {
  if (state.phase === 'unsupported') return 'unsupported';
  if (state.phase === 'saving') return 'saving';
  const need = state.doc ? state.doc.tiles.count + state.doc.extras.count : 0;
  if (state.stored.nOff >= need && need > 0) return 'ready';
  if (state.stored.nOff > 0) return 'partial';
  return 'none';
}
const SYMBOL = { ready: '●', partial: '◐', none: '○', saving: '◌', unsupported: '×' };

function render() {
  if (!ui) return;
  const st = status();
  const doc = state.doc;
  ui.root.dataset.state = st;
  ui.btnLabel.textContent = s('btn');
  ui.btnSym.textContent = SYMBOL[st];
  ui.btn.title = s('state_' + st);
  ui.title.textContent = s('title');
  ui.state.textContent = st === 'saving'
    ? s('state_saving', { p: state.total ? Math.floor(100 * state.done / state.total) : 0 }) : s('state_' + st);
  ui.note.textContent = s('note', { m: doc ? doc.params.buffer_m : 300, z0: doc ? doc.params.zmin : 13, z1: doc ? doc.params.zmax : 16 });
  ui.prog.hidden = st !== 'saving';
  ui.prog.max = state.total || 1;
  ui.prog.value = state.done;
  ui.count.textContent = st === 'saving' ? s('files', { n: state.done, total: state.total }) : '';
  const total = doc ? doc.total_bytes : 0;
  ui.size.textContent = doc ? s('size', { mb: mb(state.stored.shell + state.stored.offline), total: mb(total) }) : '';
  ui.msg.textContent = state.msg;
  ui.save.textContent = st === 'ready' ? s('update') : s('save');
  ui.save.disabled = st === 'saving' || st === 'unsupported' || !doc;
  ui.clear.textContent = s('clear');
  ui.clear.disabled = st === 'saving' || st === 'unsupported' || state.stored.nOff === 0;
}

/** Store tiles + extras in the worker's offline cache (the "Offline ready" button). */
async function saveOffline() {
  const { doc, names } = state;
  if (!doc) return;
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (e) { /* optional */ }
  const cache = await caches.open(names.offline);
  const have = new Set((await cache.keys()).map((r) => r.url));
  const todo = [...doc.tiles.files, ...doc.extras.files].map((f) => abs(f[0])).filter((u) => !have.has(u));
  Object.assign(state, { phase: 'saving', done: 0, total: todo.length, failed: 0, msg: '' });
  render();
  let i = 0;
  const worker = async () => {
    while (i < todo.length) {
      const u = todo[i++];
      try {
        const r = await fetch(u, { cache: 'no-cache' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        await cache.put(u, r);
      } catch (e) { state.failed++; }
      state.done++;
      if (state.done % 10 === 0 || state.done === state.total) render();
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  state.phase = 'idle';
  state.msg = state.failed ? s('failed', { n: state.failed }) : '';
  await measure();
  render();
  document.dispatchEvent(new CustomEvent('gale-offline', { detail: { status: status(), stored: state.stored, failed: state.failed } }));
}

async function clearOffline() {
  if (!state.names) return;
  await caches.delete(state.names.offline);
  state.msg = s('cleared');
  await measure();
  render();
}

function injectStyle() {
  if (document.getElementById('offl-style')) return;
  const st = document.createElement('style');
  st.id = 'offl-style';
  st.textContent = `
.offl { position: relative; display: inline-flex; }
.offl-btn { display: inline-flex; align-items: center; gap: 6px; white-space: nowrap; }
.offl-sym { font-size: .9em; }
.offl[data-state=ready] .offl-sym { color: var(--ok, #1baf7a); }
.offl-panel { position: absolute; right: 0; top: calc(100% + 6px); z-index: 2000; width: min(340px, calc(100vw - 16px));
  background: var(--surface, var(--card, #111)); color: var(--text, var(--fg, #fff));
  border: 2px solid var(--border, var(--line, #888)); border-radius: 6px; padding: 12px; box-shadow: 0 4px 16px #0006;
  font-size: 15px; line-height: 1.4; }
.offl-panel h2 { font-size: 16px; margin: 0 0 6px; }
.offl-panel p { margin: 4px 0; }
.offl-panel progress { width: 100%; height: 14px; }
.offl-panel .offl-btns { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 8px; }
.offl-panel .offl-small { font-size: 13px; color: var(--muted, var(--fg2, inherit)); }
.offl-inline { display: block; }
.offl-inline .offl-panel { position: static; width: auto; box-shadow: none; margin-top: 12px; }
`;
  document.head.appendChild(st);
}

function buildUi(slot) {
  injectStyle();
  const cls = slot.dataset.btnClass || '';
  const inline = slot.dataset.inline === '1'; // inline: panel always shown, no toggle button (EVA setup dialog)
  slot.innerHTML = `<div class="offl${inline ? ' offl-inline' : ''}" data-state="none">
  <button type="button" class="offl-btn ${cls}" aria-expanded="false" aria-controls="offl-panel">
    <span class="offl-sym" aria-hidden="true">○</span><span class="offl-lbl">Offline</span></button>
  <div class="offl-panel" id="offl-panel" ${inline ? '' : 'hidden'}>
    <h2></h2>
    <p class="offl-state" role="status" aria-live="polite"></p>
    <progress hidden></progress>
    <p class="offl-count num"></p>
    <p class="offl-size num"></p>
    <p class="offl-msg"></p>
    <p class="offl-small offl-note"></p>
    <div class="offl-btns">
      <button type="button" class="${cls} primary" id="offl-save"></button>
      <button type="button" class="${cls}" id="offl-clear"></button>
    </div>
  </div></div>`;
  const q = (c) => slot.querySelector(c);
  ui = {
    root: q('.offl'), btn: q('.offl-btn'), btnSym: q('.offl-sym'), btnLabel: q('.offl-lbl'), panel: q('.offl-panel'),
    title: q('h2'), state: q('.offl-state'), prog: q('progress'), count: q('.offl-count'), size: q('.offl-size'),
    msg: q('.offl-msg'), note: q('.offl-note'), save: q('#offl-save'), clear: q('#offl-clear'),
  };
  if (inline) {
    ui.btn.hidden = true;
    new IntersectionObserver(async (es) => { if (es.some((e) => e.isIntersecting)) { await measure(); render(); } }).observe(ui.panel);
    return;
  }
  const open = (on) => { ui.panel.hidden = !on; ui.btn.setAttribute('aria-expanded', String(on)); };
  ui.btn.addEventListener('click', async () => { const on = ui.panel.hidden; open(on); if (on) { await measure(); render(); } });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !ui.panel.hidden) { open(false); ui.btn.focus(); } });
  document.addEventListener('click', (e) => { if (!ui.panel.hidden && !slot.contains(e.target)) open(false); });
  ui.save.addEventListener('click', () => saveOffline().catch((e) => { state.phase = 'idle'; state.msg = String(e.message || e); render(); }));
  ui.clear.addEventListener('click', () => clearOffline());
}

async function relabel(dictName) {
  strings = await loadDict(dictName);
  render();
}

async function main() {
  const slot = document.getElementById('offline-slot');
  const page = location.pathname.split('/').pop();
  const dictName = slot && slot.dataset.dict ? slot.dataset.dict : (/^(eva|cuff)\.html$/.test(page) ? 'eva' : 'main');
  if (slot) {
    buildUi(slot);
    relabel(dictName);
  }
  if (!('serviceWorker' in navigator) || !('caches' in self)) { state.phase = 'unsupported'; render(); return; }
  const r = await fetch(LIST_URL, { cache: 'no-cache' });
  if (!r.ok) throw new Error('precache list HTTP ' + r.status);
  state.doc = await r.json();
  state.names = cacheNames(state.doc);
  await navigator.serviceWorker.register(new URL('sw.js?v=' + state.doc.version, ROOT), { scope: ROOT.pathname });
  await measure();
  render();
  // test hook (scripts/54_offline_check.mjs)
  window.galeOffline = { state, save: saveOffline, clear: clearOffline, measure, status, ready: navigator.serviceWorker.ready };
}

main().catch((e) => { console.warn('[offline] ' + (e && e.message ? e.message : e)); });
