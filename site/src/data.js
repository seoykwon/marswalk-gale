// Shared data loading (planning mode, EVA mode, cuff checklist).
// All paths are relative to the page (works under a GitHub Pages sub-path). Each file is fetched once.

const cache = new Map();

export function loadJSON(path) {
  if (!cache.has(path)) {
    const p = fetch(path).then((r) => {
      if (!r.ok) throw new Error(`${path}: HTTP ${r.status}`);
      return r.json();
    });
    p.catch(() => cache.delete(path));
    cache.set(path, p);
  }
  return cache.get(path);
}

export const DATA = {
  layers: 'data/layers.json',
  config: 'data/config.json',
  routes: 'data/routes.json',
  rad: 'data/rad.json',
  remsA: 'data/rems_A.json',
  remsB: 'data/rems_B.json',
  photos: 'data/photos.json',
  traverse: 'data/traverse.geojson',
  waypoints: 'data/waypoints.geojson',
  sites: 'data/sites.geojson',
  places: 'data/places.geojson',
  context: 'data/context_vectors.geojson',
  contours50: 'data/contours_50m.geojson',
  contours10A: 'data/contours_10m_A.geojson',
  contours10B: 'data/contours_10m_B.geojson',
  rudolph: 'data/geology_rudolph.geojson',
  grid: 'data/grid/grid.json',
  selftestRef: 'data/selftest_ref.json', // written by scripts/44_route_validate.py
};

export function load(name) {
  if (!(name in DATA)) throw new Error('unknown data set ' + name);
  return loadJSON(DATA[name]);
}

/** Core data every screen needs: routes + env data + exported config. */
export async function loadCore() {
  const [config, routes, rad, remsA, remsB] = await Promise.all(
    ['config', 'routes', 'rad', 'remsA', 'remsB'].map(load));
  return { config, routes, rad, rems: { 'rems_A.json': remsA, 'rems_B.json': remsB, A: remsA, B: remsB } };
}

/** Does a sibling page exist yet (eva.html / cuff.html arrive in stages 5-4 / 5-5)? */
export async function pageExists(path) {
  try {
    const r = await fetch(path, { method: 'HEAD' });
    return r.ok;
  } catch (e) {
    return false;
  }
}
