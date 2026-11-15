// Map skeleton: CRS, tile layers from layers.json, scale bar, cursor readout, view jumps.
/* global L */
import { t } from './i18n.js';
import { fmt, lonlat } from './format.js';
import { loadGrid, sampleGrid, inGrid } from './grid.js';
import { load } from './data.js';

// EPSG:4326 tile grid (= Mars Trek default028mm, zoomOffset 0, Plan/10 2-2) but with the Mars radius,
// so the scale bar and map.distance() measure on Mars (L.CRS.EPSG4326 inherits Earth's R = 6,371 km).
export const MarsCRS = L.extend({}, L.CRS.EPSG4326, { R: 3396190 });

const BLANK = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

export const VIEWS = {
  gale: { center: [-5.35, 137.75], zoom: 8 },
};

export function createMap(el) {
  const map = L.map(el, {
    crs: MarsCRS, minZoom: 3, maxZoom: 19, zoomSnap: 1, worldCopyJump: false,
    keyboard: true, attributionControl: true, preferCanvas: false,
  });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com">Leaflet</a>');
  L.control.scale({ imperial: false, maxWidth: 160, position: 'bottomright' }).addTo(map);
  map.getContainer().setAttribute('aria-label', t('ui.map_label'));
  return map;
}

/**
 * One logical tile layer = full-extent layer + one layer per hires rectangle (layers.json _comment).
 * All parts live in a dedicated pane: opacity is set on the pane (no double blending where parts
 * overlap) and JPEG layers are clipped to their data bounds so the black no-data margin of edge tiles
 * is hidden (Plan/10 sec.4 item 3).
 */
export function makeTileLayer(map, def, { clip = def.format === 'jpg', fallback = null, z = 205 } = {}) {
  const pane = 'p_' + def.id;
  if (!map.getPane(pane)) {
    const p = map.createPane(pane);
    p.style.zIndex = String(z);
    p.style.pointerEvents = 'none';
  }
  const paneEl = map.getPane(pane);
  const common = {
    pane, tileSize: 256, zoomOffset: def.zoomOffset ?? 0, maxZoom: 19, errorTileUrl: BLANK,
    attribution: def.attribution, keepBuffer: 1,
  };
  const parts = [];
  if (def.external) {
    parts.push(L.tileLayer(def.url, { ...common, maxNativeZoom: def.maxNativeZoom, minZoom: 0 }));
  } else {
    const b = L.latLngBounds(def.bounds);
    parts.push(L.tileLayer(def.url, {
      ...common, bounds: b, minNativeZoom: def.minZoom, minZoom: Math.max(0, def.minZoom - 4),
      maxNativeZoom: def.maxNativeZoom,
    }));
    for (const h of def.hires || []) {
      parts.push(L.tileLayer(def.url, {
        ...common, bounds: L.latLngBounds(h.bounds), minZoom: h.minNativeZoom,
        minNativeZoom: h.minNativeZoom, maxNativeZoom: h.maxNativeZoom, attribution: undefined,
      }));
    }
  }
  const group = L.layerGroup(fallback ? [fallback, ...parts] : parts);
  group.def = def;
  group.paneEl = paneEl;
  group.setOpacity = (o) => { paneEl.style.opacity = String(o); };
  group.setOpacity(def.opacity ?? 1);
  if (clip && def.bounds) {
    const update = () => {
      const b = L.latLngBounds(def.bounds);
      const nw = map.latLngToLayerPoint(b.getNorthWest());
      const se = map.latLngToLayerPoint(b.getSouthEast());
      paneEl.style.clipPath = `polygon(${nw.x}px ${nw.y}px, ${se.x}px ${nw.y}px, ${se.x}px ${se.y}px, ${nw.x}px ${se.y}px)`;
    };
    group.on('add', () => { update(); map.on('zoomend viewreset', update); });
    group.on('remove', () => { map.off('zoomend viewreset', update); });
    // during the zoom animation layer points change; drop the clip until zoomend
    map.on('zoomstart', () => { paneEl.style.clipPath = ''; });
  }
  return group;
}

/** Cursor readout: lon/lat always, elevation + slope from the 10 m grid inside its extent. */
export async function setupReadout(map, el) {
  const meta = await load('grid');
  let grid = null, loading = false, last = null;
  const render = () => {
    if (!last) { el.textContent = ''; return; }
    const { lat, lng } = last;
    let s = lonlat(lng, lat, 5);
    if (inGrid(meta, lng, lat)) {
      if (grid) {
        const v = sampleGrid(grid, lng, lat);
        if (v) s += ` · ${t('readout.elev')} ${fmt(v.elev_m, 1)} m · ${t('readout.slope')} ${fmt(v.slope_deg, 1)}° (${t('readout.grid')})`;
      } else {
        s += ` · ${t('readout.loading')}`;
        if (!loading) {
          loading = true;
          loadGrid().then((g) => { grid = g; render(); }).catch(() => { loading = false; });
        }
      }
    } else {
      s += ` · ${t('readout.no_grid')}`;
    }
    el.textContent = s;
  };
  // DOM listener, not map.on('mousemove'): Leaflet does not fire the map event while the pointer is
  // over an interactive layer (route lines, markers), which would freeze the readout there.
  const box = map.getContainer();
  box.addEventListener('mousemove', (e) => { last = map.mouseEventToLatLng(e); render(); });
  box.addEventListener('mouseleave', () => { last = null; render(); });
  return { refresh: render };
}
