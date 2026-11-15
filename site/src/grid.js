// 10 m elevation/slope grid (site/data/grid/, Plan/10 sec.1-5). Shared by the cursor readout (5-1)
// and the draw tool (5-3). Loaded lazily on first use (~5 MB).
import { load } from './data.js';

let gridP = null;

export function loadGrid() {
  if (!gridP) {
    gridP = (async () => {
      const meta = await load('grid');
      const [e, s] = await Promise.all([
        fetch('data/grid/' + meta.files.elev.file).then((r) => { if (!r.ok) throw new Error('elev grid'); return r.arrayBuffer(); }),
        fetch('data/grid/' + meta.files.slope.file).then((r) => { if (!r.ok) throw new Error('slope grid'); return r.arrayBuffer(); }),
      ]);
      // uint16 little-endian; DataView keeps it endian-safe
      return { meta, elev: new DataView(e), slope: new Uint8Array(s) };
    })();
    gridP.catch(() => { gridP = null; });
  }
  return gridP;
}

export function gridLoaded() { return gridP !== null; }

/** Inside the grid extent? (meta only) */
export function inGrid(meta, lon, lat) {
  return lon >= meta.west && lon < meta.east && lat <= meta.north && lat > meta.south;
}

/** Cell value at lon/lat: {elev_m, slope_deg} or null outside / nodata. */
export function sampleGrid(g, lon, lat) {
  const m = g.meta;
  if (!inGrid(m, lon, lat)) return null;
  const col = Math.floor((lon - m.west) / m.dlon);
  const row = Math.floor((m.north - lat) / m.dlat);
  if (col < 0 || row < 0 || col >= m.cols || row >= m.rows) return null;
  const idx = row * m.cols + col;
  const ev = g.elev.getUint16(idx * 2, true);
  const sv = g.slope[idx];
  const fe = m.files.elev, fs = m.files.slope;
  return {
    elev_m: ev === fe.nodata ? null : ev * fe.scale + fe.offset,
    slope_deg: sv === fs.nodata ? null : sv * fs.scale + fs.offset,
  };
}

/**
 * Elevation (m) with bilinear interpolation between 10 m cell centres (draw tool, 5-3).
 * Falls back to the nearest cell near the grid edge or next to nodata; null outside the grid.
 */
export function sampleElevBilinear(g, lon, lat) {
  const m = g.meta;
  if (!inGrid(m, lon, lat)) return null;
  const fc = (lon - m.west) / m.dlon - 0.5, fr = (m.north - lat) / m.dlat - 0.5;
  const c = Math.floor(fc), r = Math.floor(fr);
  const fe = m.files.elev;
  if (c >= 0 && r >= 0 && c + 1 < m.cols && r + 1 < m.rows) {
    const v = (cc, rr) => g.elev.getUint16((rr * m.cols + cc) * 2, true);
    const a = v(c, r), b = v(c + 1, r), d = v(c, r + 1), e = v(c + 1, r + 1);
    if (a !== fe.nodata && b !== fe.nodata && d !== fe.nodata && e !== fe.nodata) {
      const tx = fc - c, ty = fr - r;
      const raw = a * (1 - tx) * (1 - ty) + b * tx * (1 - ty) + d * (1 - tx) * ty + e * tx * ty;
      return raw * fe.scale + fe.offset;
    }
  }
  const s = sampleGrid(g, lon, lat);
  return s ? s.elev_m : null;
}
