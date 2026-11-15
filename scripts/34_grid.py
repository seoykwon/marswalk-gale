#!/usr/bin/env python3
"""Numeric 10 m grid for the draw tool P3 (Plan/03 stage 3 item 5).

Outputs (site/data/grid/):
  elev_10m.bin   uint16 little-endian, row-major from the north-west corner.
                 elevation_m = value * 0.1 - 5000 ; 65535 = no data
  slope_10m.bin  uint8, slope_deg = value * 0.5 ; 255 = no data
  grid.json      geometry + encoding + provenance

Grid = the 10 m mean DEM (work/dem_10m.tif, exact 10x10 mean of the 1 m HiRISE DEM) cropped to the
HiRISE colour (B2) extent, snapped to the DEM pixel grid. Slope per 10 m cell = maximum of the four
5 m-spacing slopes inside it (work/stage3/slope_5m.tif), chosen over the mean because it is closer to
the rover tilt at the waypoints (numbers in grid.json "validation").

Run: python3 -I scripts/34_grid.py
"""
import array
import json
import math
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = '/Applications/Postgres.app/Contents/Versions/latest/bin/'
W = os.path.join(ROOT, 'work')
S3 = os.path.join(W, 'stage3')
OUT = os.path.join(ROOT, 'site', 'data', 'grid')
ENV = dict(os.environ, GDAL_PAM_ENABLED='NO')
B2 = (137.3267235, -4.8756048, 137.4785590, -4.5550633)
M = 59274.7


def run(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], check=True, env=ENV, capture_output=True, text=True, **kw)


def read_f32(path):
    a = array.array('f')
    a.frombytes(open(path, 'rb').read())
    if sys.byteorder != 'little':
        a.byteswap()
    return a


def main():
    os.makedirs(OUT, exist_ok=True)
    dem10 = os.path.join(W, 'dem_10m.tif')
    info = json.loads(run([G + 'gdalinfo', '-json', dem10]).stdout)
    gt = info['geoTransform']
    x0, px, y0, py = gt[0], gt[1], gt[3], gt[5]
    c0 = math.floor((B2[0] - x0) / px)
    c1 = math.ceil((B2[2] - x0) / px)
    r0 = math.floor((y0 - B2[3]) / -py)
    r1 = math.ceil((y0 - B2[1]) / -py)
    nx, ny = c1 - c0, r1 - r0
    west, north = x0 + c0 * px, y0 + r0 * py
    east, south = west + nx * px, north + ny * py
    te = [repr(west), repr(south), repr(east), repr(north)]
    e_raw = os.path.join(S3, 'grid_elev.raw')
    run([G + 'gdal_translate', '-q', '-of', 'ENVI', '-srcwin', c0, r0, nx, ny, dem10, e_raw])
    slopes = {}
    for r in ('max', 'average'):
        p = os.path.join(S3, 'grid_slope_%s.raw' % r)
        run([G + 'gdalwarp', '-q', '-overwrite', '-te'] + te + ['-ts', nx, ny, '-r', r, '-of', 'ENVI',
            '-dstnodata', -9999, os.path.join(S3, 'slope_5m.tif'), p])
        slopes[r] = read_f32(p)
    elev = read_f32(e_raw)
    # choose slope aggregation by agreement with rover tilt
    d = json.load(open(os.path.join(ROOT, 'Vector', 'MSL_traverse', 'MSL_waypoints.json')))
    wp = [f['properties'] for f in d['features']]
    val = {}
    for r, arr in slopes.items():
        diffs = []
        for p in wp:
            i = int((p['lon'] - west) / px)
            j = int((north - p['lat']) / -py)
            if 0 <= i < nx and 0 <= j < ny and arr[j * nx + i] > -1000:
                diffs.append(arr[j * nx + i] - p['tilt'])
        diffs.sort()
        ad = sorted(abs(x) for x in diffs)
        val[r] = dict(n=len(diffs), median_signed=round(diffs[len(diffs) // 2], 2), median_abs=round(ad[len(ad) // 2], 2))
    pick = min(val, key=lambda r: abs(val[r]['median_signed']))
    sl = slopes[pick]
    ev = array.array('H', bytes(2 * nx * ny))
    sv = array.array('B', bytes(nx * ny))
    emin, emax, nd_e, nd_s = 1e9, -1e9, 0, 0
    for k in range(nx * ny):
        e = elev[k]
        if e < -1e30 or e != e:
            ev[k] = 65535
            nd_e += 1
        else:
            v = int(round((e + 5000.0) * 10))
            assert 0 <= v < 65535, e
            ev[k] = v
            emin, emax = min(emin, e), max(emax, e)
        s = sl[k]
        if s < -1000 or s != s:
            sv[k] = 255
            nd_s += 1
        else:
            sv[k] = min(254, int(round(s * 2)))
    if sys.byteorder != 'little':
        ev.byteswap()
    open(os.path.join(OUT, 'elev_10m.bin'), 'wb').write(ev.tobytes())
    open(os.path.join(OUT, 'slope_10m.bin'), 'wb').write(sv.tobytes())
    gj = dict(
        crs='+proj=longlat +R=3396190 +no_defs (degrees on the Mars sphere)',
        west=west, north=north, east=east, south=south, dlon=px, dlat=-py, cols=nx, rows=ny,
        cell_size_m=round(px * M, 3), order='row-major, row 0 = north edge, col 0 = west edge',
        cell_lookup='col = floor((lon - west) / dlon), row = floor((north - lat) / dlat); value represents the cell '
                    '(centre at west + (col + 0.5) * dlon)',
        files=dict(
            elev=dict(file='elev_10m.bin', dtype='uint16', byte_order='little', scale=0.1, offset=-5000.0, nodata=65535,
                      unit='m', formula='elev_m = v * 0.1 - 5000',
                      source='10 m mean of HiRISE DEM 1 m (work/dem_10m.tif), areoid elevation',
                      bytes=os.path.getsize(os.path.join(OUT, 'elev_10m.bin')), min_m=round(emin, 1), max_m=round(emax, 1),
                      nodata_cells=nd_e),
            slope=dict(file='slope_10m.bin', dtype='uint8', scale=0.5, offset=0.0, nodata=255, unit='deg',
                       formula='slope_deg = v * 0.5 (capped at 127 deg)',
                       source='%s of the four 5 m-spacing slopes per 10 m cell (gdaldem slope on the 5 m mean DEM, '
                              '-s 59274.7)' % ('maximum' if pick == 'max' else 'mean'),
                       bytes=os.path.getsize(os.path.join(OUT, 'slope_10m.bin')), nodata_cells=nd_s)),
        validation=dict(slope_vs_rover_tilt=val, chosen=pick,
                        note='rover tilt at %d waypoints; signed = grid slope - tilt' % len(wp)),
        note_en='10 m grid approximation for the draw tool; walking thresholds are assumptions (scripts/config.json walk)',
        note_ko='10m 격자 기준 근사. 경사 기준은 가정(scripts/config.json walk)',
        generated_by='scripts/34_grid.py')
    json.dump(gj, open(os.path.join(OUT, 'grid.json'), 'w'), indent=1)
    for f in os.listdir(S3):
        if f.startswith('grid_'):
            os.remove(os.path.join(S3, f))
    # spot check: decode 3 waypoints from the written files vs dem_10m via gdallocationinfo
    eb = array.array('H')
    eb.frombytes(open(os.path.join(OUT, 'elev_10m.bin'), 'rb').read())
    checks = []
    for p in (wp[0], wp[700], wp[-1]):
        i = int((p['lon'] - west) / px)
        j = int((north - p['lat']) / -py)
        dec = eb[j * nx + i] * 0.1 - 5000
        ref = float(run([G + 'gdallocationinfo', '-valonly', '-geoloc', dem10, p['lon'], p['lat']]).stdout)
        checks.append(dict(sol=p['sol'], decoded=round(dec, 2), gdal=round(ref, 2)))
    print(json.dumps(dict(cols=nx, rows=ny, chosen=pick, validation=val, spot=checks), indent=1))


if __name__ == '__main__':
    main()
