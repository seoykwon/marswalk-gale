#!/usr/bin/env python3
"""Stage 2-3: vectors + photos.   Run: python3 -I scripts/22_vectors.py

Outputs (site/data/): traverse.geojson, waypoints.geojson, sites.geojson, places.geojson,
                      context_vectors.geojson, photos.json ;  site/photos/full|thumb/<imageid>.jpg
Inputs: Vector/MSL_traverse/*.json, Vector/gazetteer/gale_features.geojson, Photos/index.json + Photos/images,
        Geology/sim3292 (G1), MarsTrek/extra/*.zip (E3) clipped with ogr2ogr -spat (GDAL 3.8.5, Postgres.app).
NOT done here: Murray-Stimson contact (G2) -> TODO, its georeferencing is decided by stage 1.
"""
import json, math, os, shutil, subprocess, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GDAL = '/Applications/Postgres.app/Contents/Versions/latest/bin'
OUT = os.path.join(ROOT, 'site/data')
PH = os.path.join(ROOT, 'site/photos')
WORK = os.path.join(ROOT, 'work/stage2/ctx')
M_PER_DEG = 59274.7            # scripts/config.json crs.meters_per_degree
SIMPLIFY_M = 1.0
GALE_BBOX = (136.0, -6.6, 139.3, -2.8)   # xmin ymin xmax ymax: Gale crater range (same as THEMIS clip in Plan/02 B4)
MAX_FULL, MAX_THUMB = 1280, 320
REPORT = {}


def jdump(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'w') as f:
        json.dump(obj, f, separators=(',', ':'), ensure_ascii=False)
    REPORT[os.path.relpath(path, ROOT)] = os.path.getsize(path)


def rnd(c, d=6):
    return [round(v, d) for v in c]


# ---------- Douglas-Peucker in local metres ----------
def dp(pts, tol_m):
    if len(pts) < 3:
        return pts
    lat0 = math.radians(sum(p[1] for p in pts) / len(pts))
    k = math.cos(lat0)
    xy = [(p[0] * M_PER_DEG * k, p[1] * M_PER_DEG) for p in pts]
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        ax, ay = xy[a]; bx, by = xy[b]
        dx, dy = bx - ax, by - ay
        L2 = dx * dx + dy * dy
        best, bi = -1.0, None
        for i in range(a + 1, b):
            px, py = xy[i]
            if L2 == 0:
                d = math.hypot(px - ax, py - ay)
            else:
                t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
                d = math.hypot(px - (ax + t * dx), py - (ay + t * dy))
            if d > best:
                best, bi = d, i
        if bi is not None and best > tol_m:
            keep[bi] = True
            stack.append((a, bi)); stack.append((bi, b))
    return [p for p, kf in zip(pts, keep) if kf]


def traverse_waypoints():
    src = os.path.join(ROOT, 'Vector/MSL_traverse')
    tr = json.load(open(os.path.join(src, 'MSL_traverse.json')))
    feats = []
    nin = nout = 0
    for ft in tr['features']:
        g = ft['geometry']
        lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        outl = []
        for ln in lines:
            nin += len(ln)
            s = dp([[c[0], c[1]] for c in ln], SIMPLIFY_M)
            nout += len(s)
            outl.append([rnd(c) for c in s])
        feats.append({'type': 'Feature', 'properties': {'len_m': round(ft['properties'].get('Length', 0), 1)},
                      'geometry': {'type': 'MultiLineString', 'coordinates': outl}})
    jdump(os.path.join(OUT, 'traverse.geojson'), {'type': 'FeatureCollection', 'features': feats})
    REPORT['traverse'] = {'features': len(feats), 'vertices_in': nin, 'vertices_out': nout, 'tolerance_m': SIMPLIFY_M}

    wp = json.load(open(os.path.join(src, 'MSL_waypoints.json')))
    wf = []
    wprops = []
    for ft in wp['features']:
        p = ft['properties']; c = ft['geometry']['coordinates']
        wf.append({'type': 'Feature', 'properties': {'sol': p['sol'], 'elev': round(p['elev_geoid'], 1), 'tilt': round(p['tilt'], 1),
                                                       'dist_m': round(p['dist_total_m'], 1)},
                   'geometry': {'type': 'Point', 'coordinates': rnd(c[:2])}})
        wprops.append((p['sol'], p['site'], p['drive'], c[0], c[1], p['dist_total_m']))
    jdump(os.path.join(OUT, 'waypoints.geojson'), {'type': 'FeatureCollection', 'features': wf})
    REPORT['waypoints'] = {'n': len(wf), 'sol_min': wf[0]['properties']['sol'], 'sol_max': wf[-1]['properties']['sol'],
                           'last_dist_total_m': wf[-1]['properties']['dist_m']}

    ss = json.load(open(os.path.join(src, 'MSL_SurfaceSites.json')))
    sf = []
    for ft in ss['features']:
        g = ft['geometry']
        sf.append({'type': 'Feature', 'properties': {'name': ft['properties'].get('Name'), 'site': ft['properties'].get('site')},
                   'geometry': {'type': g['type'], 'coordinates': [[rnd(c[:2]) for c in ring] for ring in g['coordinates']]}})
    jdump(os.path.join(OUT, 'sites.geojson'), {'type': 'FeatureCollection', 'features': sf})
    REPORT['sites'] = len(sf)

    pl = json.load(open(os.path.join(ROOT, 'Vector/gazetteer/gale_features.geojson')))
    pf = []
    for ft in pl['features']:
        p = ft['properties']
        pf.append({'type': 'Feature',
                   'properties': {'name': p['name'], 'type': p['type'], 'diameter_km': p['diameter'], 'approval': p['approval'],
                                  'origin': p['origin'], 'link': p['link']},
                   'geometry': {'type': 'Point', 'coordinates': [p['center_lon'], p['center_lat']]}})
    jdump(os.path.join(OUT, 'places.geojson'), {'type': 'FeatureCollection', 'features': pf})
    REPORT['places'] = len(pf)
    return wprops


# ---------- context vectors via ogr2ogr ----------
def ogr(args):
    r = subprocess.run([os.path.join(GDAL, 'ogr2ogr')] + args, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)


def round_geom(g, d=5):
    def rc(c):
        if isinstance(c[0], (int, float)):
            return [round(v, d) for v in c[:2]]
        return [rc(x) for x in c]
    return {'type': g['type'], 'coordinates': rc(g['coordinates'])}


def context_vectors():
    os.makedirs(WORK, exist_ok=True)
    bb = [str(v) for v in GALE_BBOX]
    zips = os.path.join(ROOT, 'MarsTrek/extra')
    shp = os.path.join(ROOT, 'Geology/sim3292/extracted/SIM3292_MarsGlobalGeologicGIS_20M/SIM3292_Shapefiles/SIM3292_Global_Geology.shp')
    jobs = [  # (layer id, out, source, layername or None, clip polygons?, keep fields)
        ('G1_geology_sim3292', 'geo.geojson', shp, None, True, ['Unit', 'UnitDesc']),
        ('E3_dune_field', 'dune.geojson', '/vsizip/' + os.path.join(zips, 'Dune_Field.zip'), None, True, []),
        ('E3_hydrous_crism', 'crism.geojson', '/vsizip/' + os.path.join(zips, 'Hydrous_Mineral_Detections_CRISM_clon0.zip'),
         'Hydrous_Mineral_Detections_CRISM_clon0', False, None),
        ('E3_hydrous_omega', 'omega.geojson', '/vsizip/' + os.path.join(zips, 'Hydrous_Mineral_Detections_CRISM_clon0.zip'),
         'Hydrous_Mineral_Detections_OMEGA_clon0', False, None),
        ('E3_aqueous_options', 'aq.geojson', '/vsizip/' + os.path.join(zips, 'Aqueous_Mineral_Distribution_Options_clon0.zip'),
         None, False, None),
    ]
    feats = []
    counts = {}
    for lid, fn, src, lname, clip, keep in jobs:
        out = os.path.join(WORK, fn)
        if os.path.exists(out):
            os.remove(out)
        args = ['-f', 'GeoJSON', out, src] + ([lname] if lname else []) + ['-spat'] + bb
        if clip:
            args += ['-clipsrc'] + bb
        ogr(args)
        d = json.load(open(out))
        n = 0
        for ft in d['features']:
            if not ft.get('geometry'):
                continue
            pr = ft['properties']
            if keep is not None:
                pr = {k: pr[k] for k in keep if k in pr}
            else:  # point layers: keep short attributes only, drop shape bookkeeping
                pr = {k: v for k, v in pr.items() if not k.lower().startswith(('shape', 'objectid', 'fid', 'jc_')) and k not in ('Radius', 'lwidth', 'filled', 'Long_East')}
            pr = dict(pr); pr['layer'] = lid
            feats.append({'type': 'Feature', 'properties': pr, 'geometry': round_geom(ft['geometry'])})
            n += 1
        counts[lid] = n
    jdump(os.path.join(OUT, 'context_vectors.geojson'), {'type': 'FeatureCollection', 'features': feats,
          'meta': {'bbox_lon_lat': list(GALE_BBOX), 'sources': {
              'G1_geology_sim3292': 'Geology/sim3292 SIM3292_Global_Geology.shp (USGS SIM 3292, Tanaka et al. 2014; polygons clipped to bbox)',
              'E3_*': 'MarsTrek/extra/{Dune_Field, Hydrous_Mineral_Detections_*, Aqueous_Mineral_Distribution_Options_clon0}.zip (-spat bbox)'},
              'G2_murray_stimson_contact': 'TODO: not included; georeferencing decided in stage 1'}})
    REPORT['context_counts'] = counts


# ---------- photos ----------
def sips_dims(path):
    r = subprocess.run(['sips', '-g', 'pixelWidth', '-g', 'pixelHeight', path], capture_output=True, text=True)
    w = h = None
    for ln in r.stdout.splitlines():
        if 'pixelWidth' in ln:
            w = int(ln.split()[-1])
        if 'pixelHeight' in ln:
            h = int(ln.split()[-1])
    return w, h


def resize(src, dst, maxdim):
    w, h = sips_dims(src)
    if w is None:
        raise RuntimeError('sips cannot read ' + src)
    os.makedirs(os.path.dirname(dst), exist_ok=True)
    # sips -Z only shrinks when the long side exceeds maxdim; smaller images are just re-encoded (never upscaled)
    args = ['sips'] + (['-Z', str(maxdim)] if max(w, h) > maxdim else []) + ['-s', 'format', 'jpeg', '-s', 'formatOptions', '60', src, '--out', dst]
    r = subprocess.run(args, capture_output=True, text=True)
    if r.returncode != 0:
        raise RuntimeError(r.stderr)
    return sips_dims(dst)


def photos(wprops):
    idx = json.load(open(os.path.join(ROOT, 'Photos/index.json')))
    ims = idx['images']
    by_sd = {}
    for i, (sol, site, drive, lon, lat, dist) in enumerate(wprops):
        by_sd.setdefault((site, drive), i)
    by_site = {}
    for i, w in enumerate(wprops):
        by_site.setdefault(w[1], []).append(i)
    sols = [w[0] for w in wprops]
    out = []
    methods = {}
    ids = set()
    for im in ims:
        method = None
        if im['camera'] == 'Navcam' and im.get('site') is not None:
            k = (im['site'], im['drive'])
            if k in by_sd:
                wi = by_sd[k]; method = 'navcam_exact_site_drive'
            elif im['site'] in by_site:
                cand = [i for i in by_site[im['site']] if wprops[i][2] <= im['drive']]
                if cand:
                    wi = max(cand, key=lambda i: wprops[i][2]); method = 'navcam_same_site_drive_le'
                else:
                    wi = min(by_site[im['site']], key=lambda i: wprops[i][2]); method = 'navcam_same_site_first_drive'
        if method is None:
            cand = [i for i, s in enumerate(sols) if s <= im['sol']]
            if cand:
                wi = max(cand); method = ('mastcam' if im['camera'] == 'Mastcam' else 'navcam_no_site') + '_latest_waypoint_sol_le'
            else:
                wi = 0; method = ('mastcam' if im['camera'] == 'Mastcam' else 'navcam') + '_before_first_waypoint_use_first'
        methods[method] = methods.get(method, 0) + 1
        w = wprops[wi]
        iid = im['imageid']
        assert iid not in ids, iid
        ids.add(iid)
        src = os.path.join(ROOT, 'Photos', im['path'])
        full = os.path.join(PH, 'full', iid + '.jpg')
        thumb = os.path.join(PH, 'thumb', iid + '.jpg')
        fw, fh = resize(src, full, MAX_FULL)
        tw, th = resize(src, thumb, MAX_THUMB)
        out.append({'id': iid, 'sol': im['sol'], 'camera': im['camera'], 'instrument': im['instrument'], 'date_utc': im['date_utc'],
                    'lon': round(w[3], 6), 'lat': round(w[4], 6), 'match': method, 'wp_sol': w[0], 'wp_site': w[1], 'wp_drive': w[2],
                    'wp_dist_m': round(w[5], 1), 'sol_diff': im['sol'] - w[0],
                    'full': 'photos/full/%s.jpg' % iid, 'thumb': 'photos/thumb/%s.jpg' % iid, 'size_full': [fw, fh], 'size_thumb': [tw, th],
                    'title': im['title'], 'credit': im['credit'], 'source_url': im['source_url'],
                    'note': 'position = rover waypoint (not a photo geotag)'})
    jdump(os.path.join(OUT, 'photos.json'), {'count': len(out), 'credit_note': 'NASA/JPL-Caltech (Navcam), NASA/JPL-Caltech/MSSS (Mastcam); raw unprocessed images; '
                                                                           'source: https://mars.nasa.gov/msl/multimedia/raw-images/', 'photos': out})
    tot = lambda d: sum(os.path.getsize(os.path.join(d, f)) for f in os.listdir(d))
    REPORT['photos'] = {'count': len(out), 'navcam': sum(1 for o in out if o['camera'] == 'Navcam'),
                        'mastcam': sum(1 for o in out if o['camera'] == 'Mastcam'), 'match_methods': methods,
                        'full_dir_bytes': tot(os.path.join(PH, 'full')), 'thumb_dir_bytes': tot(os.path.join(PH, 'thumb')),
                        'max_abs_sol_diff': max(abs(o['sol_diff']) for o in out),
                        'sol_diff_hist': {str(k): sum(1 for o in out if o['sol_diff'] == k) for k in sorted({o['sol_diff'] for o in out})}}


def main():
    wprops = traverse_waypoints()
    context_vectors()
    photos(wprops)
    print(json.dumps(REPORT, indent=1))


if __name__ == '__main__':
    main()
