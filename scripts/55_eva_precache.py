#!/usr/bin/env python3
"""Stage 5-5 B: list the files the service worker (site/sw.js) stores for offline use.

  python3 -I scripts/55_eva_precache.py

Output: site/data/eva_precache.json (read by site/sw.js and site/src/sw-register.js).

Three groups (Plan/09 sec.6, Plan/03 5-5):
  shell    stored by the service worker on the first visit: root *.html, src/**/*.js|css,
           src/i18n/*.json, vendor/leaflet/leaflet.{js,css}, data/*.json, data/grid/grid.json,
           icon files if any. Globbed at build time, so cuff.html and src/cuff/* are picked up
           once they exist.
  tiles    stored only when the user presses "Offline ready": tiles z13-16 of the EVA map layers
           (B2, T2, T1, plus T5A for route A and T5B for route B; = site/src/eva/eva.js) whose
           tile rectangle touches the route extent + eva.offline_tile_buffer_m, and that exist on disk.
  extras   stored with the tiles: planning-mode data that is not JSON shell (data/*.geojson,
           data/grid/*.bin, and the photo thumbnails the route panel shows: within 30 m of a
           route, first 40 per route along the route; the panel shows 24), so the planning page also opens offline.

Every file: [relative URL, bytes, sha256[:10]]. Group version = sha256 of its file list
(URL + size + hash) [:12]. The service worker names its caches after these versions.
No file outside site/ and scripts/config.json is read. Raw data folders are not touched.
"""
import glob
import hashlib
import json
import math
import os
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, 'site')
CFG = os.path.join(ROOT, 'scripts', 'config.json')
OUT = os.path.join(SITE, 'data', 'eva_precache.json')

ZMIN = 13
PHOTO_KEEP = 40  # the panel shows 24 per route (photos.js thumbsHtml(list, 24))
PHOTO_NEAR_M = 30  # = route panel (site/src/panels/route.js photosNearRoute(R, photos, 30))
R_MARS = 3396190.0
M_PER_DEG = R_MARS * math.pi / 180.0  # 59,274.7 m

# layer id -> routes it is used with (eva.js: B2/T1/T2 always, T5A only on route A, T5B only on route B)
EVA_LAYERS = {'B2': ('A', 'B'), 'T2': ('A', 'B'), 'T1': ('A', 'B'), 'T5A': ('A',), 'T5B': ('B',)}


def rel(p):
    return os.path.relpath(p, SITE).replace(os.sep, '/')


def entry(path):
    with open(path, 'rb') as f:
        b = f.read()
    return [rel(path), len(b), hashlib.sha256(b).hexdigest()[:10]]


def version(files):
    h = hashlib.sha256()
    for u, n, x in files:
        h.update(f'{u}\t{n}\t{x}\n'.encode())
    return h.hexdigest()[:12]


def group(files, **extra):
    files = sorted(files, key=lambda e: e[0])
    return {'version': version(files), 'count': len(files), 'bytes': sum(e[1] for e in files), **extra,
            'files': files}


def shell_files():
    pats = ['*.html', 'src/**/*.js', 'src/**/*.css', 'src/i18n/*.json', 'vendor/leaflet/leaflet.js',
            'vendor/leaflet/leaflet.css', 'data/*.json', 'data/grid/*.json',
            '*.webmanifest', '*.png', '*.svg', '*.ico', 'icons/*']
    seen = set()
    for p in pats:
        for f in glob.glob(os.path.join(SITE, p), recursive=True):
            if os.path.isfile(f):
                seen.add(os.path.abspath(f))
    skip = {os.path.abspath(OUT)}  # the list itself: fetched by sw.js separately (no self-hash)
    return [entry(f) for f in sorted(seen - skip)]


def near_route_thumbs(routes, max_m=PHOTO_NEAR_M):
    """Thumbnails the planning route panel shows: routecalc.photosNearRoute(R, photos, 30) sorted by distance
    along the route, then sol; thumbsHtml shows the first 24. Here: nearest 2 m sample, first PHOTO_KEEP
    (margin for the small difference between nearest sample and true projection)."""
    photos = json.load(open(os.path.join(SITE, 'data', 'photos.json'), encoding='utf-8'))['photos']
    out = set()
    for r in routes.values():
        lons, lats, dm = r['samples']['lon'], r['samples']['lat'], r['samples']['d_m']
        k = math.cos(math.radians(sum(lats) / len(lats)))
        near = []
        for p in photos:
            d, i = min((math.hypot((p['lon'] - lo) * k, p['lat'] - la), i) for i, (lo, la) in enumerate(zip(lons, lats)))
            if d * M_PER_DEG <= max_m + 2:
                near.append((dm[i], p['sol'], p['thumb']))
        out.update(t for _, _, t in sorted(near)[:PHOTO_KEEP])
    return sorted(out)


def extra_files(routes):
    fs = glob.glob(os.path.join(SITE, 'data', '*.geojson')) + glob.glob(os.path.join(SITE, 'data', 'grid', '*.bin'))
    fs += glob.glob(os.path.join(SITE, 'img', '*.jpg')) + glob.glob(os.path.join(SITE, 'img', '*.png'))  # website screenshots (W4)
    fs += [os.path.join(SITE, t) for t in near_route_thumbs(routes) if os.path.isfile(os.path.join(SITE, t))]
    return [entry(f) for f in sorted(fs)]


def route_box(route, buf_m):
    lons = list(route['samples']['lon']) + [p[0] for p in route['line']]
    lats = list(route['samples']['lat']) + [p[1] for p in route['line']]
    lat_c = (min(lats) + max(lats)) / 2
    dlat = buf_m / M_PER_DEG
    dlon = buf_m / (M_PER_DEG * math.cos(math.radians(lat_c)))
    return [min(lons) - dlon, min(lats) - dlat, max(lons) + dlon, max(lats) + dlat]  # W S E N


def tiles_in_box(box, z):
    """EPSG:4326 grid, zoomOffset 0: tile {z}/{y}/{x} spans 180/2^z deg, origin (-180, 90)."""
    w, s, e, n = box
    d = 180.0 / 2 ** z
    x0, x1 = math.floor((w + 180) / d), math.floor((e + 180) / d)
    y0, y1 = math.floor((90 - n) / d), math.floor((90 - s) / d)
    for y in range(y0, y1 + 1):
        for x in range(x0, x1 + 1):
            yield y, x


def main():
    cfg = json.load(open(CFG, encoding='utf-8'))['eva']
    buf_m = float(cfg['offline_tile_buffer_m'])
    zmax = int(cfg['offline_max_zoom'])
    layers = {d['id']: d for d in json.load(open(os.path.join(SITE, 'data', 'layers.json'), encoding='utf-8'))['layers']}
    routes = json.load(open(os.path.join(SITE, 'data', 'routes.json'), encoding='utf-8'))['routes']

    tile_paths = {}  # rel url -> (layer, z, routes set)
    per_route = {}
    for rid in ('A', 'B'):
        box = route_box(routes[rid], buf_m)
        n_route = 0
        b_route = 0
        for lid, used in EVA_LAYERS.items():
            if rid not in used or lid not in layers:
                continue
            d = layers[lid]
            for z in range(ZMIN, zmax + 1):
                for y, x in tiles_in_box(box, z):
                    u = d['url'].replace('{z}', str(z)).replace('{y}', str(y)).replace('{x}', str(x))
                    p = os.path.join(SITE, u)
                    if not os.path.isfile(p):
                        continue
                    n_route += 1
                    b_route += os.path.getsize(p)
                    tile_paths.setdefault(u, (lid, z, set()))[2].add(rid)
        per_route[rid] = {'bbox_wsen': [round(v, 6) for v in box], 'tiles': n_route, 'bytes': b_route}

    tiles = [entry(os.path.join(SITE, u)) for u in tile_paths]
    by_layer = {}
    for u, (lid, z, _) in tile_paths.items():
        k = by_layer.setdefault(lid, {})
        c = k.setdefault(str(z), [0, 0])
        c[0] += 1
        c[1] += os.path.getsize(os.path.join(SITE, u))
    shell = group(shell_files())
    t = group(tiles, by_layer_zoom_count_bytes=by_layer, per_route=per_route)
    ex = group(extra_files(routes))
    cuff = [e[0] for e in shell['files'] if e[0] == 'cuff.html' or e[0].startswith('src/cuff/') or '/cuff.' in e[0]]
    out = {
        '_comment': 'Generated by scripts/55_eva_precache.py (stage 5-5 B). Files are [relative URL, bytes, sha256[:10]], '
                    'relative to the site root (= service worker scope). shell: stored on first visit; tiles + extras: '
                    'stored when the user presses "Offline ready". Cache names use the group versions.',
        'generated': datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'version': version(shell['files'] + t['files'] + ex['files']),
        'params': {'buffer_m': buf_m, 'zmin': ZMIN, 'zmax': zmax,
                   'layers': {k: list(v) for k, v in EVA_LAYERS.items()}},
        'cuff_files': cuff,
        'total_bytes': shell['bytes'] + t['bytes'] + ex['bytes'],
        'shell': shell,
        'tiles': t,
        'extras': ex,
    }
    with open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, separators=(',', ':'))
        f.write('\n')
    mb = lambda b: f'{b / 1e6:.2f} MB'
    print(f'wrote {rel(OUT)} ({mb(os.path.getsize(OUT))}) version {out["version"]}')
    print(f'shell : {shell["count"]:5d} files {mb(shell["bytes"])}  v{shell["version"]}')
    print(f'tiles : {t["count"]:5d} files {mb(t["bytes"])}  v{t["version"]}')
    for rid, r in per_route.items():
        print(f'  route {rid}: {r["tiles"]} tiles {mb(r["bytes"])} bbox {r["bbox_wsen"]}')
    for lid, zs in by_layer.items():
        print('  ' + lid + ': ' + ', '.join(f'z{z} {c[0]} ({mb(c[1])})' for z, c in sorted(zs.items())))
    print(f'extras: {ex["count"]:5d} files {mb(ex["bytes"])}  v{ex["version"]}')
    print(f'total : {mb(out["total_bytes"])}')
    print('cuff files in shell: ' + (', '.join(cuff) if cuff else 'none (cuff.html not found yet)'))


if __name__ == '__main__':
    main()
