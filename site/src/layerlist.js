// Left sidebar: layer list grouped base / terrain / surface & geology / Curiosity measurements / EVA plan.
// Tile layers come from layers.json; vector layers from vectors.js. Toggles, opacity, legends, source info.
import { t, escapeHtml as esc } from './i18n.js';
import { makeTileLayer } from './map.js';
import { fmt } from './format.js';

const GROUPS = ['base', 'terrain', 'surface', 'measure', 'plan'];
// draw order of tile overlays (bottom -> top)
const OVERLAY_ORDER = ['T3', 'T1', 'E1', 'T2', 'T5A', 'T5B'];
const DEFAULT_BASE = 'B2';

function tileLegend(def) {
  const L = def.legend || {};
  const note = L.note_en;
  let h = '';
  if (L.type === 'classes') {
    h += L.classes.map((c) => `<div><span class="sw" style="background:${c.color};opacity:${Math.max(0.55, c.alpha)}"></span>${esc(c.label_en)}</div>`).join('');
  } else if (L.type === 'ramp') {
    const stops = L.stops.map((s, i) => (Array.isArray(s) ? `${s[1]} ${((s[0] - L.min) / (L.max - L.min) * 100).toFixed(1)}%` : `${s} ${(i / (L.stops.length - 1) * 100).toFixed(0)}%`));
    h += `<div class="ramp" style="background:linear-gradient(90deg, ${stops.join(',')})"></div>
      <div class="ramp-lab"><span>${fmt(L.min)}</span><span>${esc(L.unit)}</span><span>${fmt(L.max)}</span></div>`;
  } else if (L.type === 'gray') {
    h += `<div class="ramp" style="background:linear-gradient(90deg,#000,#fff)"></div>
      <div class="ramp-lab"><span>${esc(L.low_en)}</span><span>${esc(L.high_en)}</span></div>`;
  }
  if (note) h += `<div class="small">${esc(note)}</div>`;
  return h;
}

function tileInfo(def) {
  let h = `<div class="small"><b>${esc(t('ui.source'))}:</b> ${esc(def.source || def.url)}</div>
    <div class="small"><b>${esc(t('ui.credit'))}:</b> ${esc(def.attribution || '')}</div>`;
  if (def.external) h += `<div class="small">${esc(t('layers.info.external'))}</div>`;
  // limits text comes from en.json (layers.limits.<id>); layers.json carries no Korean fields (Plan/17 P1-2, P2)
  if (t('layers.limits.' + def.id) !== 'layers.limits.' + def.id) h += `<div class="small"><b>${esc(t('ui.limits'))}:</b> ${esc(t('layers.limits.' + def.id))}</div>`;
  if (def.format === 'jpg' && !def.external) h += `<div class="small">${esc(t('layers.info.black_border'))}</div>`;
  return h;
}

export function buildLayerList({ map, layersDoc, vectors, container, onOpenPanel }) {
  const entries = []; // {id, group, kind, label(), legend(), info(), make(), layer, on, opacity}
  // tile layers: create panes in draw order (bases first, then overlays bottom->top)
  const tdefs = layersDoc.layers;
  const byId = Object.fromEntries(tdefs.map((d) => [d.id, d]));
  const bases = [...tdefs.filter((d) => d.kind === 'base'),
    ...layersDoc.external.map((e) => ({ ...e, external: true, kind: 'base', group: 'base', format: 'jpg', opacity: 1 }))];
  // order bases: own tiles first (D14), external last
  const baseOrder = ['B2', 'B1', 'B4', 'B5', 'T6', 'B3', 'B6'];
  bases.sort((a, b) => baseOrder.indexOf(a.id) - baseOrder.indexOf(b.id));
  const ctxUnder = makeTileLayer(map, { ...byId.B1, id: 'B1u' }, { z: 201 });
  for (const d of bases) {
    entries.push({
      id: d.id, group: 'base', kind: 'base', def: d,
      label: () => d.name.en,
      make: async () => makeTileLayer(map, d, { fallback: d.id === 'B2' ? ctxUnder : null, z: 202 }),
      legend: () => tileLegend(d) + (d.id === 'B2' ? `<div class="small">${esc(t('layers.b2_fallback'))}</div>` : ''),
      info: () => tileInfo(d),
      on: d.id === DEFAULT_BASE,
    });
  }
  for (const id of OVERLAY_ORDER) {
    const d = byId[id];
    if (!d) continue;
    entries.push({
      id, group: d.group, kind: 'overlay', def: d, opacity: d.opacity ?? 1,
      label: () => d.name.en,
      make: async () => makeTileLayer(map, d, { z: 210 + OVERLAY_ORDER.indexOf(id) }),
      legend: () => tileLegend(d), info: () => tileInfo(d), on: false,
    });
  }
  for (const v of vectors) entries.push({ ...v, kind: 'vector', on: v.defaultOn });

  const state = new Map(entries.map((e) => [e.id, e]));

  async function setOn(e, on) {
    e.on = on;
    if (on) {
      if (!e.layer) {
        e.loading = true;
        try { e.layer = await e.make(); } catch (err) { console.error(err); e.on = false; render(); return; }
        e.loading = false;
      }
      if (e.on && !map.hasLayer(e.layer)) e.layer.addTo(map);
      if (e.opacity !== undefined && e.layer.setOpacity) e.layer.setOpacity(e.opacity);
    } else if (e.layer && map.hasLayer(e.layer)) {
      map.removeLayer(e.layer);
    }
  }

  function render() {
    container.innerHTML = GROUPS.map((g) => {
      const items = entries.filter((e) => e.group === g);
      let extra = '';
      if (g === 'measure') {
        extra = `<div class="litem"><span class="lid">M3</span> <button type="button" class="info-btn" data-panel="rad">${esc(t('layers.open_rad'))}</button></div>
          <div class="litem"><span class="lid">M4</span> <button type="button" class="info-btn" data-panel="temp">${esc(t('layers.open_temp'))}</button></div>`;
      }
      if (g === 'plan') {
        extra = `<div class="litem"><span class="lid">P2</span> <button type="button" class="info-btn" data-panel="route">${esc(t('layers.open_route'))}</button></div>`;
      }
      return `<section class="lgroup" aria-labelledby="lg-${g}"><h3 id="lg-${g}">${esc(t('groups.' + g))}</h3>
        ${items.map((e) => {
          const type = e.kind === 'base' ? 'radio' : 'checkbox';
          const name = e.kind === 'base' ? 'name="base"' : '';
          return `<div class="litem" data-id="${e.id}">
            <label><input type="${type}" ${name} data-toggle="${e.id}" ${e.on ? 'checked' : ''}>
              <span class="lid">${esc(e.id.replace(/^P1[ABc]$/, 'P1').replace(/^(M1)w$/, '$1').replace(/^T4r$/, 'T4'))}</span>
              <span>${esc(e.label())}${e.loading ? ' …' : ''}</span></label>
            ${e.kind === 'overlay' ? `<div class="lctl"><label class="small">${esc(t('ui.opacity'))}
              <input type="range" min="0" max="1" step="0.05" value="${e.opacity}" data-opacity="${e.id}" aria-label="${esc(t('ui.opacity') + ': ' + e.label())}"></label></div>` : ''}
            ${e.on ? `<div class="legend">${e.legend ? e.legend() : ''}</div>` : ''}
            <details class="lctl"><summary class="small">${esc(t('ui.about_layer'))}</summary>${e.info ? e.info() : ''}</details>
          </div>`;
        }).join('')}${extra}</section>`;
    }).join('');
  }

  container.addEventListener('change', async (ev) => {
    const tg = ev.target.dataset.toggle;
    if (!tg) return;
    const e = state.get(tg);
    if (e.kind === 'base') {
      for (const b of entries.filter((x) => x.kind === 'base' && x !== e)) await setOn(b, false);
    }
    await setOn(e, ev.target.checked);
    render();
    container.querySelector(`[data-toggle="${tg}"]`)?.focus();
  });
  container.addEventListener('input', (ev) => {
    const id = ev.target.dataset.opacity;
    if (!id) return;
    const e = state.get(id);
    e.opacity = Number(ev.target.value);
    if (e.layer && e.layer.setOpacity) e.layer.setOpacity(e.opacity);
  });
  container.addEventListener('click', (ev) => {
    const p = ev.target.closest('[data-panel]');
    if (p) onOpenPanel(p.dataset.panel);
  });

  render();
  return {
    async init() { for (const e of entries) if (e.on) await setOn(e, true); render(); },
    render,
    entries,
    /** Rebuild vector layers (their tooltips/popups carry language-specific text). */
    async relabel() {
      for (const e of entries.filter((x) => x.kind === 'vector' && x.layer)) {
        if (map.hasLayer(e.layer)) map.removeLayer(e.layer);
        e.layer = null;
        if (e.on) await setOn(e, true);
      }
      render();
    },
    async show(id, on = true) { const e = state.get(id); if (e && e.on !== on) { await setOn(e, on); render(); } },
  };
}
