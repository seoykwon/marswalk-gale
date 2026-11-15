// P3 draw tool (stage 5-3): analysis of a user-drawn polyline on the 10 m grid + the drawing controller.
// No external draw plugin. Uses grid.js (lazy 10 m grid), routecalc.js (distance, slope class, speed rule).
/* global L */
import { loadGrid, sampleGrid, sampleElevBilinear } from './grid.js';
import { distanceM, slopeClass, walkTimeS } from './routecalc.js';

export const STEP_M = 5; // resampling step along the drawn line (half a 10 m cell)
export const CLASS_KEYS = ['0-5', '5-15', '15-25', '25+'];

/**
 * Analyse a polyline on the 10 m grid. pts = [[lat, lng], ...]. Parts outside the grid (or on nodata)
 * are measured for length only; elevation, slope and time are NOT invented for them.
 * Segment slope = larger of its two end samples (same rule as the route files, 40_route_profile.py).
 */
export function analyzeLine(g, pts, walk, step = STEP_M) {
  const out = {
    n_points: pts.length, total_m: 0, in_m: 0, out_m: 0, climb_m: 0, descent_m: 0, time_s: 0,
    impassable_m: 0, classes: CLASS_KEYS.map(() => ({ len_m: 0, time_s: 0 })),
    elev_min: null, elev_max: null, slope_max: null, samples: [], hazard_runs: [], outside_runs: [],
  };
  if (pts.length < 2) return out;
  // resample
  const S = [];
  let cum = 0;
  for (let k = 0; k < pts.length - 1; k++) {
    const [la0, lo0] = pts[k], [la1, lo1] = pts[k + 1];
    const len = distanceM(lo0, la0, lo1, la1);
    const n = Math.max(1, Math.ceil(len / step));
    for (let i = k === 0 ? 0 : 1; i <= n; i++) {
      const f = i / n;
      S.push({ d: cum + len * f, lat: la0 + (la1 - la0) * f, lon: lo0 + (lo1 - lo0) * f });
    }
    cum += len;
  }
  out.total_m = cum;
  for (const s of S) {
    const c = sampleGrid(g, s.lon, s.lat);
    s.slope = c ? c.slope_deg : null;
    s.elev = c && c.elev_m !== null ? sampleElevBilinear(g, s.lon, s.lat) : null;
    s.ok = s.slope !== null && s.elev !== null;
  }
  let run = null, outRun = null;
  for (let i = 0; i < S.length - 1; i++) {
    const a = S[i], b = S[i + 1], len = b.d - a.d;
    if (!(a.ok && b.ok)) {
      out.out_m += len;
      if (outRun) outRun.x1 = b.d; else { outRun = { x0: a.d, x1: b.d }; out.outside_runs.push(outRun); }
      run = null;
      continue;
    }
    outRun = null;
    out.in_m += len;
    const sl = Math.max(a.slope, b.slope);
    const cls = slopeClass(sl, walk);
    out.classes[cls].len_m += len;
    const tm = walkTimeS(len, sl, walk);
    if (tm === null) out.impassable_m += len; else { out.classes[cls].time_s += tm; out.time_s += tm; }
    const dz = b.elev - a.elev;
    if (dz > 0) out.climb_m += dz; else out.descent_m -= dz;
    if (cls >= 2) {
      if (run) run.x1 = b.d; else { run = { x0: a.d, x1: b.d }; out.hazard_runs.push(run); }
    } else run = null;
  }
  for (const s of S) {
    if (!s.ok) continue;
    if (out.elev_min === null || s.elev < out.elev_min) out.elev_min = s.elev;
    if (out.elev_max === null || s.elev > out.elev_max) out.elev_max = s.elev;
    if (out.slope_max === null || s.slope > out.slope_max) out.slope_max = s.slope;
  }
  out.samples = S;
  return out;
}

/**
 * Drawing controller. Mouse/touch: click or tap adds a vertex, double-click/double-tap finishes.
 * Keyboard (map focused): Enter adds a vertex at the map centre (crosshair), Backspace undoes,
 * F or Escape finishes, Delete clears. Toolbar buttons do the same (see map.html #drawbar).
 */
export function createDrawTool(map, { walk }) {
  const listeners = new Set();
  const st = { pts: [], active: false, result: null, status: 'idle', version: 0 };
  const box = map.getContainer();
  const wrap = box.parentElement;
  map.createPane('drawPane').style.zIndex = 650;
  const casing = L.polyline([], { pane: 'drawPane', color: '#ffffff', weight: 7, opacity: 0.9, interactive: false }).addTo(map);
  const line = L.polyline([], { pane: 'drawPane', color: '#d6249f', weight: 3.5, interactive: false }).addTo(map);
  const rubber = L.polyline([], { pane: 'drawPane', color: '#d6249f', weight: 2, dashArray: '4 6', interactive: false }).addTo(map);
  const dots = L.layerGroup().addTo(map);
  const emit = () => listeners.forEach((fn) => fn(st));

  function redraw() {
    const ll = st.pts.map((p) => L.latLng(p[0], p[1]));
    casing.setLatLngs(ll); line.setLatLngs(ll);
    dots.clearLayers();
    ll.forEach((p, i) => {
      L.circleMarker(p, { pane: 'drawPane', radius: i === 0 ? 7 : 5, color: '#ffffff', weight: 2, fillColor: i === 0 ? '#1d9a4a' : '#d6249f',
        fillOpacity: 1, interactive: false }).addTo(dots);
    });
    rubber.setLatLngs([]);
  }
  async function update() {
    const v = ++st.version;
    redraw();
    if (st.pts.length < 2) { st.result = null; st.status = 'idle'; emit(); return; }
    st.status = 'loading';
    emit();
    try {
      const g = await loadGrid();
      if (v !== st.version) return;
      st.result = analyzeLine(g, st.pts, walk);
      st.status = 'ready';
    } catch (e) {
      if (v !== st.version) return;
      st.status = 'error';
      st.result = null;
    }
    emit();
  }
  const api = {
    state: st,
    onChange(fn) { listeners.add(fn); },
    addPoint(lat, lng) { st.pts.push([lat, lng]); update(); },
    addAtCenter() { const c = map.getCenter(); api.addPoint(c.lat, c.lng); },
    undo() { if (st.pts.length) { st.pts.pop(); update(); } },
    clear() { st.pts = []; update(); },
    start() {
      if (st.active) return;
      st.active = true;
      box.classList.add('drawing');
      wrap.classList.add('drawing');
      map.doubleClickZoom.disable();
      loadGrid().catch(() => {}); // first use: fetch the 10 m grid (~5 MB) now
      emit();
    },
    finish() {
      if (!st.active) return;
      st.active = false;
      box.classList.remove('drawing');
      wrap.classList.remove('drawing');
      map.doubleClickZoom.enable();
      rubber.setLatLngs([]);
      emit();
    },
    toggle() { if (st.active) api.finish(); else api.start(); },
    /** Test hook / programmatic use: replace the line. */
    setLine(pts) { st.pts = pts.map((p) => [p[0], p[1]]); update(); },
    resultReady() { return st.status === 'ready' || (st.pts.length < 2 && st.status === 'idle'); },
  };

  map.on('click', (e) => { if (st.active) api.addPoint(e.latlng.lat, e.latlng.lng); });
  map.on('dblclick', () => {
    // A double click/tap delivers two clicks first. Finish only when the last two vertices sit on
    // (almost) the same screen spot; two quick taps in different places are just two points.
    if (!st.active) return;
    if (st.pts.length >= 2) {
      const [a, b] = st.pts.slice(-2);
      const pa = map.latLngToContainerPoint(L.latLng(a[0], a[1])), pb = map.latLngToContainerPoint(L.latLng(b[0], b[1]));
      if (pa.distanceTo(pb) > 12) return;
      st.pts.pop();
      update();
    }
    api.finish();
  });
  box.addEventListener('mousemove', (e) => {
    if (!st.active || !st.pts.length) return;
    const last = st.pts[st.pts.length - 1];
    rubber.setLatLngs([L.latLng(last[0], last[1]), map.mouseEventToLatLng(e)]);
  });
  box.addEventListener('mouseleave', () => rubber.setLatLngs([]));
  box.addEventListener('keydown', (e) => {
    if (!st.active || e.target !== box || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (k === 'Enter') api.addAtCenter();
    else if (k === 'Backspace') api.undo();
    else if (k === 'f' || k === 'F' || k === 'Escape') api.finish();
    else if (k === 'Delete') api.clear();
    else return;
    e.preventDefault();
    e.stopPropagation();
  });
  return api;
}
