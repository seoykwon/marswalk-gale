// Planning mode bootstrap (map.html): map + layer list + panels.
import { initI18n, t } from './i18n.js';
import { load, loadCore, pageExists } from './data.js';
import { createMap, setupReadout, VIEWS } from './map.js';
import { buildLayerList } from './layerlist.js';
import { vectorDefs } from './vectors.js';
import { routeBounds } from './routecalc.js';
import { registerPhotos, setupLightbox } from './photos.js';
import { renderRoutePanel } from './panels/route.js';
import { renderRadPanel } from './panels/radiation.js';
import { renderTempPanel } from './panels/temperature.js';
import { renderAboutPanel } from './panels/about.js';
import { renderDrawPanel, drawStatusText } from './panels/draw.js';
import { createDrawTool } from './draw.js';

const TABS = ['route', 'rad', 'temp', 'draw', 'about'];
const MOBILE = window.matchMedia('(max-width: 999px)');
const SHEETS = ['collapsed', 'half', 'full'];

async function main() {
  await initI18n();
  const q = new URLSearchParams(location.search);
  const startRoute = q.get('route') === 'A' ? 'A' : 'B';
  const [layersDoc, core, photosDoc] = await Promise.all([load('layers'), loadCore(), load('photos')]);
  const photos = photosDoc.photos;
  registerPhotos(photos);
  setupLightbox();

  const map = createMap('map');
  window.galeMap = map; // for the headless browser check (scripts/58_browser_check.mjs)
  const state = {
    route: startRoute, startH: 10, ls: {}, radPeriod: 'recent', tempSet: startRoute, tempLs: {},
    tab: TABS.includes(q.get('tab')) ? q.get('tab') : 'route',
  };
  const bounds = { A: routeBounds(core.routes.routes.A), B: routeBounds(core.routes.routes.B) };
  const panelEl = document.getElementById('panel');
  const fit = (k) => {
    // on a phone the bottom sheet covers the lower part of the map: keep the route in the free part
    const pb = MOBILE.matches ? Math.min(panelEl.offsetHeight, window.innerHeight * 0.5) : 0;
    if (k === 'gale') map.setView(VIEWS.gale.center, VIEWS.gale.zoom);
    else map.fitBounds(bounds[k], { paddingTopLeft: [30, 30], paddingBottomRight: [30, 30 + pb], maxZoom: 17 });
  };

  const ctx = {
    core, photos, map,
    pages: Promise.all([pageExists('eva.html'), pageExists('cuff.html')]).then(([eva, cuff]) => ({ eva, cuff })),
    selectRoute(r) { state.route = r; state.tempSet = r; openTab('route'); render('route'); render('temp'); },
    rerender: (k) => render(k),
    draw: null,
  };
  const panes = Object.fromEntries(TABS.map((k) => [k, document.getElementById('pane-' + k)]));
  const renderers = {
    route: () => renderRoutePanel(panes.route, ctx, state),
    rad: () => renderRadPanel(panes.rad, ctx, state),
    temp: () => renderTempPanel(panes.temp, ctx, state),
    draw: () => renderDrawPanel(panes.draw, ctx, state),
    about: () => renderAboutPanel(panes.about),
  };
  const rendered = new Set();
  function render(k) {
    if (k !== state.tab && !rendered.has(k)) return; // lazy: render when first shown
    const y = panes[k].parentElement.scrollTop;
    renderers[k]();
    rendered.add(k);
    panes[k].parentElement.scrollTop = y;
  }
  function openTab(k) {
    state.tab = k;
    for (const x of TABS) {
      const tab = document.getElementById('tab-' + x);
      const on = x === k;
      tab.setAttribute('aria-selected', String(on));
      tab.tabIndex = on ? 0 : -1;
      panes[x].hidden = !on;
    }
    if (!rendered.has(k)) render(k);
  }
  const tabsEl = document.querySelector('.tabs');
  tabsEl.addEventListener('click', () => { if (MOBILE.matches && panelEl.dataset.sheet === 'collapsed') setSheet('half'); });

  // ---- mobile bottom sheet (< 1000 px): collapsed (handle + tabs) / half / full ----
  const handle = document.getElementById('sheet-handle');
  function setSheet(s) {
    panelEl.dataset.sheet = s;
    handle.setAttribute('aria-expanded', String(s !== 'collapsed'));
  }
  handle.addEventListener('click', () => setSheet(SHEETS[(SHEETS.indexOf(panelEl.dataset.sheet) + 1) % 3]));
  let y0 = null;
  handle.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; }, { passive: true });
  handle.addEventListener('touchend', (e) => {
    if (y0 === null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    if (Math.abs(dy) < 24) return; // a tap: the click handler cycles the state
    e.preventDefault();
    const i = SHEETS.indexOf(panelEl.dataset.sheet);
    setSheet(SHEETS[Math.max(0, Math.min(2, i + (dy < 0 ? 1 : -1)))]);
  });
  const syncSheetVar = () => document.documentElement.style.setProperty('--sheet-h', (MOBILE.matches ? panelEl.offsetHeight : 0) + 'px');
  new ResizeObserver(syncSheetVar).observe(panelEl);
  MOBILE.addEventListener('change', () => { syncSheetVar(); map.invalidateSize(); });
  if (MOBILE.matches) setSheet('collapsed');
  // layer list drawer
  const layersBtn = document.getElementById('btn-layers');
  const sidebar = document.getElementById('layers');
  const setDrawer = (on) => { sidebar.classList.toggle('open', on); layersBtn.setAttribute('aria-expanded', String(on)); };
  layersBtn.addEventListener('click', () => setDrawer(!sidebar.classList.contains('open')));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sidebar.classList.contains('open')) { setDrawer(false); layersBtn.focus(); } });
  // attribution: one short line on phones, tap to expand
  map.attributionControl.getContainer().addEventListener('click', (e) => {
    if (MOBILE.matches && e.target.tagName !== 'A') e.currentTarget.classList.toggle('expanded');
  });
  // tabs: click + arrow keys (WAI-ARIA tabs pattern)
  const tablist = document.querySelector('[role=tablist]');
  tablist.addEventListener('click', (e) => {
    const b = e.target.closest('[role=tab]');
    if (b) openTab(b.id.replace('tab-', ''));
  });
  tablist.addEventListener('keydown', (e) => {
    const i = TABS.indexOf(state.tab);
    let j = null;
    if (e.key === 'ArrowRight') j = (i + 1) % TABS.length;
    if (e.key === 'ArrowLeft') j = (i - 1 + TABS.length) % TABS.length;
    if (e.key === 'Home') j = 0;
    if (e.key === 'End') j = TABS.length - 1;
    if (j !== null) { e.preventDefault(); openTab(TABS[j]); document.getElementById('tab-' + TABS[j]).focus(); }
  });

  const vectors = vectorDefs({ routes: core.routes, config: core.config, photos, onRouteSelect: (r) => ctx.selectRoute(r) });
  const list = buildLayerList({
    map, layersDoc, vectors, container: document.getElementById('layer-list'),
    onOpenPanel: (k) => { openTab(k); document.getElementById('panel').focus(); },
  });
  fit(startRoute);
  await list.init();
  await setupReadout(map, document.getElementById('readout'));

  // ---- P3 draw tool (5-3) ----
  const draw = createDrawTool(map, { walk: core.config.walk });
  ctx.draw = draw;
  window.galeDraw = draw; // for the headless browser check
  const $ = (id) => document.getElementById(id);
  const syncBar = () => {
    const st = draw.state;
    $('dr-toggle').setAttribute('aria-pressed', String(st.active));
    $('dr-toggle').textContent = t(st.active ? 'draw.btn_drawing' : 'draw.btn_draw');
    $('dr-undo').disabled = !st.pts.length;
    $('dr-clear').disabled = !st.pts.length;
    $('dr-finish').disabled = !st.active;
    $('dr-status').textContent = drawStatusText(st);
  };
  let wasActive = false;
  draw.onChange((st) => {
    syncBar();
    render('draw');
    if (st.active && !wasActive) {
      openTab('draw');
      if (MOBILE.matches) setSheet('collapsed'); // keep the map free while drawing
      map.getContainer().focus({ preventScroll: true });
    }
    if (!st.active && wasActive && st.pts.length >= 2) {
      openTab('draw');
      if (MOBILE.matches) setSheet('half');
    }
    wasActive = st.active;
  });
  $('dr-toggle').addEventListener('click', () => draw.toggle());
  $('dr-undo').addEventListener('click', () => { draw.undo(); if (draw.state.active) map.getContainer().focus({ preventScroll: true }); });
  $('dr-finish').addEventListener('click', () => draw.finish());
  $('dr-clear').addEventListener('click', () => draw.clear());
  syncBar();

  document.querySelectorAll('[data-jump]').forEach((b) => b.addEventListener('click', () => fit(b.dataset.jump)));
  map.getContainer().setAttribute('aria-label', t('ui.map_label'));

  openTab(state.tab);
  document.body.dataset.ready = '1';
}

main().catch((err) => {
  console.error(err);
  const el = document.getElementById('boot-error');
  el.hidden = false;
  el.textContent = 'Failed to start: ' + err.message + ' — serve the site folder with "python3 -m http.server" (file:// is not supported).';
});
