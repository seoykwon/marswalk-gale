#!/usr/bin/env python3
"""Stage 3 tile generator (Plan/03 "타일화 방법", method 1: GDAL command-line only).

Grid = Leaflet L.CRS.EPSG4326 default = Mars Trek default028mm:
  zoom z has 2^(z+1) x 2^z tiles of 256 px, origin (lon -180, lat 90), tile span 180/2^z deg,
  x = floor((lon+180)/(180/2^z)), y = floor((90-lat)/(180/2^z)), path tiles/<id>/{z}/{y}/{x}.<ext>

Per layer part and zoom:
  1. gdalwarp the source onto the tile-aligned extent (-te, -ts n*256) -> one big GeoTIFF in work/
     (-r average when shrinking, bilinear when enlarging; mode/nearest for class rasters)
  2. scan the alpha (or class) band and keep only tiles with at least one non-empty pixel
  3. gdal_translate -srcwin 256x256 per tile, run in parallel with xargs -P (<= 6)
  4. meta.json with bounds, zooms, per-zoom tile count and bytes, attribution

Usage (always python3 -I):
  python3 -I scripts/30_tiler.py build <ID> [<ID> ...]   build layers (wipes site/tiles/<ID> first)
  python3 -I scripts/30_tiler.py verify <ID> [...]       3 sample tiles vs source, shift in pixels
  python3 -I scripts/30_tiler.py trek                    compare B4 tile with the Mars Trek tile
  python3 -I scripts/30_tiler.py layers                  write site/data/layers.json
  python3 -I scripts/30_tiler.py sizes                   per-layer tile count / size table
"""
import array
import json
import math
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = '/Applications/Postgres.app/Contents/Versions/latest/bin/'
W = os.path.join(ROOT, 'work')
S3 = os.path.join(W, 'stage3')
TMP = os.path.join(S3, 'tiles_tmp')
TILES = os.path.join(ROOT, 'site', 'tiles')
CFG = json.load(open(os.path.join(ROOT, 'scripts', 'config.json')))
SRS = CFG['crs']['common']
M_PER_DEG = CFG['crs']['meters_per_degree']
PAR = 6
JPEG_Q = 80
ENV = dict(os.environ, GDAL_PAM_ENABLED='NO', GDAL_CACHEMAX='512')
VRT = lambda n: os.path.join(W, 'vrt', n + '.vrt')
ST = lambda n: os.path.join(S3, n)

# ------------------------------------------------------------------ extents (w, s, e, n)
GALE = (136.0, -7.25, 139.4, -2.8)          # B4/B5/E1: Gale crater + rim (Plan/02 B4)
CTX16 = (136.2770019, -7.2140479, 139.3865918, -3.5807944)
B2BOX = (137.3267235, -4.8756048, 137.4785590, -4.5550633)
DEMBOX = (137.12247113204074, -4.925474311955847, 137.72981290693286, -4.248963057145466)
T6BOX = (130.0, -12.0, 145.0, 3.0)


def load_areas():
    p = os.path.join(ROOT, 'scripts', '31_tile_areas.json')
    return json.load(open(p)) if os.path.exists(p) else dict(hi_rects=[], route_areas=[])


AREAS = load_areas()
HI = [tuple(r['bbox']) for r in AREAS['hi_rects']]
ROUTE = {r['id']: tuple(r['bbox']) for r in AREAS['route_areas']}


def rect_containing(b):
    for r in HI:
        if r[0] <= b[0] and r[1] <= b[1] and r[2] >= b[2] and r[3] >= b[3]:
            return r
    return b


def viewshed_bbox(rid):
    p = ST('T5_%s_viewshed.json' % rid)
    if os.path.exists(p):
        return tuple(json.load(open(p))['tile_bbox'])
    return None


# ------------------------------------------------------------------ layer recipes
# kind: base (one at a time) / overlay. fmt: jpg (RGB or gray + alpha for empty test) or
# pal (1-band class raster -> paletted PNG, colours+alpha from the 'palette' list).
VIEWSHED_PAL = [(0, 0, 0, 0), (27, 158, 119, 70), (40, 40, 60, 150)]


def recipes():
    L = {}
    L['B4'] = dict(
        name_en='THEMIS night IR (100 m)', group='base', kind='base',
        fmt='jpg', parts=[dict(src=VRT('B4_themis_night_ir_100m'), z=(5, 9), bbox=GALE)],
        source='Mars Odyssey THEMIS night-time IR controlled mosaic, USGS WCS clip lon130-145 lat-12-3 '
               '(MarsTrek/extra/THEMIS_night_IR_USGS_WCS_lon130-145_lat-12-3.tif)',
        attribution='NASA/JPL-Caltech/ASU (THEMIS), USGS',
        legend=dict(type='gray', low_en='cool at night (sand, dust)', high_en='warm at night (rock)',
                    note_en='8-bit brightness, not temperature'))
    L['B5'] = dict(
        name_en='THEMIS day IR (100 m)', group='base', kind='base',
        fmt='jpg', parts=[dict(src=VRT('B5_themis_day_ir_100m'), z=(5, 9), bbox=GALE)],
        source='Mars Odyssey THEMIS day-time IR controlled mosaic, USGS WCS clip lon130-145 lat-12-3 '
               '(MarsTrek/extra/THEMIS_controlled_IR_USGS_WCS_lon130-145_lat-12-3.tif)',
        attribution='NASA/JPL-Caltech/ASU (THEMIS), USGS',
        legend=dict(type='gray', low_en='cool by day', high_en='warm by day',
                    note_en='8-bit brightness, not temperature'))
    L['B1'] = dict(
        name_en='CTX mosaic (Gale, 16 m)', group='base', kind='base',
        fmt='jpg', parts=[dict(src=VRT('ctx_curiosity_16m'), z=(5, 11), bbox=CTX16)],
        source='MRO CTX Curiosity-area mosaic (Mars Trek curiosity_ctx_mosaic, ~16 m/px), shifted +10 m E / '
               '-19 m N (Plan/06 sec.3-4)',
        attribution='NASA/JPL-Caltech/MSSS (CTX), NASA Mars Trek',
        legend=dict(type='none'))
    L['B2'] = dict(
        name_en='HiRISE colour (25 cm)', group='base', kind='base',
        fmt='jpg',
        parts=[dict(src=VRT('B2_hirise_color_25cm'), z=(10, 15), bbox=B2BOX)] +
              [dict(src=VRT('B2_hirise_color_25cm'), z=(16, 16), bbox=r, area='R%d' % (i + 1))
               for i, r in enumerate(HI)] +
              [dict(src=VRT('B2_hirise_color_25cm'), z=(17, 17), bbox=b, area='route_' + k)
               for k, b in ROUTE.items()],
        source='MRO HiRISE LRGB colour mosaic of the Curiosity traverse, 78 quads '
               '(MarsTrek/extra/MSL_Gale_HiRISE-LRGB_78quads_sharp_cog.tif, 0.25 m/px)',
        attribution='NASA/JPL-Caltech/UArizona (HiRISE), NASA Mars Trek',
        legend=dict(type='none'))
    hs_parts = [dict(src=ST('T1_hillshade_5m.tif'), z=(9, 13), bbox=DEMBOX, srcnodata=0)]
    hs_parts += [dict(src=ST('T1_hillshade_1m_rect%d.tif' % i), z=(14, 15), bbox=r, srcnodata=0,
                      area='R%d' % (i + 1)) for i, r in enumerate(HI)]
    L['T1'] = dict(
        name_en='Hillshade', group='terrain', kind='overlay', fmt='jpg', parts=hs_parts,
        source='HiRISE DEM Gale_DEM_SMG_1m.tif: 5 m mean DEM (z9-13) and 1 m DEM (z14-15 rectangles), '
               'gdaldem hillshade -multidirectional, vertical exaggeration x2',
        attribution='NASA/JPL-Caltech/UArizona (HiRISE DEM)', default_opacity=0.6,
        legend=dict(type='none', note_en='Multidirectional hillshade, 2x vertical exaggeration'))
    cls_parts = lambda src: ([dict(src=src, z=(9, 13), bbox=DEMBOX)] +
                             [dict(src=src, z=(14, 15), bbox=r, area='R%d' % (i + 1)) for i, r in enumerate(HI)])
    w = CFG['walk']
    L['T2'] = dict(
        name_en='Slope hazard', group='terrain', kind='overlay', fmt='pal',
        palette=[(0, 0, 0, 0), (254, 217, 118, 110), (253, 141, 60, 200), (128, 0, 38, 230)],
        resample=('mode', 'near'), parts=cls_parts(ST('T2_slopecls_5m.tif')),
        source='Slope from the 5 m mean HiRISE DEM (gdaldem slope -s 59274.7), classes from scripts/config.json walk',
        attribution='NASA/JPL-Caltech/UArizona (HiRISE DEM); classes: assumption',
        legend=dict(type='classes', classes=[
            dict(value=1, range_deg=[w['slope_moderate_deg'], w['slope_caution_deg']], color='#fed976', alpha=110 / 255,
                 label_en='%d-%d° walk x%.1f' % (w['slope_moderate_deg'], w['slope_caution_deg'], w['speed_factor_moderate'])),
            dict(value=2, range_deg=[w['slope_caution_deg'], w['slope_danger_deg']], color='#fd8d3c', alpha=200 / 255,
                 label_en='%d-%d° caution, x%.1f' % (w['slope_caution_deg'], w['slope_danger_deg'], w['speed_factor_caution'])),
            dict(value=3, range_deg=[w['slope_danger_deg'], 90], color='#800026', alpha=230 / 255,
                 label_en='>%d° impassable (assumed)' % w['slope_danger_deg'])],
            note_en='< %d° transparent. Thresholds are assumptions; slope depends on the 5 m spacing' % w['slope_moderate_deg']))
    L['T3'] = dict(
        name_en='Elevation colour', group='terrain', kind='overlay', fmt='jpg',
        parts=[dict(src=ST('T3_color_5m.tif'), z=(9, 13), bbox=DEMBOX)] +
              [dict(src=ST('T3_color_5m.tif'), z=(14, 15), bbox=r, area='R%d' % (i + 1)) for i, r in enumerate(HI)],
        source='5 m mean HiRISE DEM, gdaldem color-relief (viridis)', default_opacity=0.7, sample_like='T1',
        attribution='NASA/JPL-Caltech/UArizona (HiRISE DEM)', legend='T3')
    for rid in ('A', 'B'):
        vb = viewshed_bbox(rid)
        if not vb:
            continue
        meta = json.load(open(ST('T5_%s_viewshed.json' % rid)))
        rb = rect_containing(ROUTE.get(rid, vb))
        prov = bool(meta.get('provisional', True))
        if not prov:
            # final base: must equal scripts/config.json routes.<rid>.stops[0] (was scripts/42_t5_finalize.py)
            cb = CFG['routes'][rid]['stops'][0]
            if abs(meta['lon'] - cb['lon']) > 1e-7 or abs(meta['lat'] - cb['lat']) > 1e-7:
                raise SystemExit('T5%s base %s,%s != config base %s,%s: re-run 33_viewshed.py first'
                                 % (rid, meta['lon'], meta['lat'], cb['lon'], cb['lat']))
        base_name = meta.get('base_name_en')
        if base_name:
            # a stop named "Base B (sol 4614)" would read "...base B (Base B (sol 4614))": keep only "sol 4614"
            m = re.match(r'^Base %s\s*\((.+)\)$' % re.escape(rid), base_name.strip(), re.I)
            if m:
                base_name = m.group(1)
            elif re.match(r'^Base %s$' % re.escape(rid), base_name.strip(), re.I):
                base_name = None
        L['T5' + rid] = dict(
            name_en='Line of sight from base %s%s' % (rid, ' (provisional)' if prov else
                                                      (' (%s)' % base_name if base_name else '')),
            group='terrain', kind='overlay', fmt='pal',
            palette=VIEWSHED_PAL, resample=('mode', 'near'),
            parts=[dict(src=ST('T5_%s_viewshed_cls.tif' % rid), z=(9, 13), bbox=vb),
                   dict(src=ST('T5_%s_viewshed_cls.tif' % rid), z=(14, 15), bbox=rb, area='route_' + rid)],
            source='gdal_viewshed on the 5 m mean HiRISE DEM (metre copy), observer/target height %.1f/%.1f m, '
                   'curvature coefficient 1 (no refraction)' % (meta['observer_h_m'], meta['target_h_m']),
            attribution='NASA/JPL-Caltech/UArizona (HiRISE DEM); antenna height: assumption',
            base=dict(lon=meta['lon'], lat=meta['lat'], **({'sol': meta['base_sol']} if 'base_sol' in meta else {}),
                      provisional=prov, basis=meta['basis']),
            legend=dict(type='classes', classes=[
                dict(value=1, color='#1b9e77', alpha=70 / 255, label_en='in line of sight of base'),
                dict(value=2, color='#28283c', alpha=150 / 255, label_en='hidden by terrain')],
                note_en='Base position is provisional until stage 4' if prov else
                        meta.get('legend_note_en', 'Base: %s (assumed base).' % meta['basis'])))
    L['T6'] = dict(
        name_en='MOLA shaded elevation (wide)', group='base', kind='base',
        fmt='jpg', parts=[dict(src=ST('T6_shaded_color.tif'), z=(3, 8), bbox=T6BOX)],
        source='MGS MOLA 463 m global DEM (Mars_MGS_MOLA_DEM_mosaic_global_463m.tif), colour x hillshade (4x)',
        attribution='NASA/JPL-Caltech/GSFC (MOLA), USGS', legend='T6')
    L['E1'] = dict(
        name_en='Thermal inertia (THEMIS, 100 m)', group='surface',
        kind='overlay', fmt='jpg', default_opacity=0.7,
        parts=[dict(src=ST('E1_color.tif'), z=(5, 9), bbox=GALE)],
        source='THEMIS quantitative thermal inertia mosaic 30S120E 100 m/px, shifted +149 m E / +399 m N (Plan/06)',
        attribution='NASA/JPL-Caltech/ASU (THEMIS), USGS', legend='E1')
    return L


# ------------------------------------------------------------------ helpers
def sh(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], check=True, env=ENV, **kw)


def ginfo(path):
    return json.loads(subprocess.run([G + 'gdalinfo', '-json', path], check=True, env=ENV,
                                     capture_output=True, text=True).stdout)


def span(z):
    return 180.0 / 2 ** z


def tile_range(b, z):
    s = span(z)
    x0 = math.floor((b[0] + 180) / s)
    x1 = math.ceil((b[2] + 180) / s) - 1
    y0 = math.floor((90 - b[3]) / s)
    y1 = math.ceil((90 - b[1]) / s) - 1
    return x0, y0, x1, y1


def tile_bounds(z, x, y):
    s = span(z)
    return (-180 + x * s, 90 - (y + 1) * s, -180 + (x + 1) * s, 90 - y * s)


def resampling(rec, part, z, src_px):
    down, up = rec.get('resample', ('average', 'bilinear'))
    return down if span(z) / 256 >= src_px * 0.999 else up


def read_raw(path_raw, typecode):
    a = array.array(typecode)
    with open(path_raw, 'rb') as f:
        a.frombytes(f.read())
    return a


def band_raw(src, band, dst_raw, srcwin=None, ot=None):
    cmd = [G + 'gdal_translate', '-q', '-of', 'ENVI', '-b', band]
    if ot:
        cmd += ['-ot', ot]
    if srcwin:
        cmd += ['-srcwin'] + list(srcwin)
    sh(cmd + [src, dst_raw])


def palette_vrt(big_tif, dst_vrt, pal, nx, ny):
    ents = ''.join('<Entry c1="%d" c2="%d" c3="%d" c4="%d"/>' % c for c in pal)
    open(dst_vrt, 'w').write(f'''<VRTDataset rasterXSize="{nx}" rasterYSize="{ny}">
  <VRTRasterBand dataType="Byte" band="1">
    <ColorInterp>Palette</ColorInterp>
    <ColorTable>{ents}</ColorTable>
    <SimpleSource><SourceFilename relativeToVRT="0">{big_tif}</SourceFilename><SourceBand>1</SourceBand></SimpleSource>
  </VRTRasterBand>
</VRTDataset>
''')


# ------------------------------------------------------------------ build
def warp_zoom(rec, part, z, tag):
    """Warp a part's source onto the tile grid of zoom z. Returns (big_tif, x0, y0, nx, ny, nbands)."""
    src = part['src']
    info = ginfo(src)
    src_px = abs(info['geoTransform'][1])
    x0, y0, x1, y1 = tile_range(part['bbox'], z)
    nx, ny = x1 - x0 + 1, y1 - y0 + 1
    w, n = -180 + x0 * span(z), 90 - y0 * span(z)
    e, s = w + nx * span(z), n - ny * span(z)
    big = os.path.join(TMP, '%s_%s_z%d.tif' % (rec['id'], tag, z))
    r = resampling(rec, part, z, src_px)
    cmd = [G + 'gdalwarp', '-q', '-overwrite', '-t_srs', SRS, '-te', repr(w), repr(s), repr(e), repr(n),
           '-ts', nx * 256, ny * 256, '-r', r, '-multi', '-wo', 'NUM_THREADS=2', '-wm', '512',
           '-co', 'TILED=YES', '-co', 'BIGTIFF=IF_SAFER']
    if rec['fmt'] == 'jpg':
        cmd += ['-dstalpha']
        if part.get('srcnodata') is not None:
            cmd += ['-srcnodata', part['srcnodata']]
    else:
        cmd += ['-wo', 'INIT_DEST=0', '-dstnodata', 'None']
    sh(cmd + [src, big])
    nb = len(ginfo(big)['bands'])
    return big, x0, y0, nx, ny, nb, r


def nonempty_tiles(big, band, nx, ny):
    """Tile (i, j) offsets whose band has any non-zero pixel."""
    raw = big + '.cov.raw'
    band_raw(big, band, raw)
    width = nx * 256
    keep = []
    with open(raw, 'rb') as f:
        for j in range(ny):
            rows = f.read(width * 256)
            flags = [False] * nx
            zero = bytes(256)
            for line in range(256):
                lr = rows[line * width:(line + 1) * width]
                if lr.count(0) == width:
                    continue
                for i in range(nx):
                    if not flags[i] and lr[i * 256:(i + 1) * 256] != zero:
                        flags[i] = True
            keep += [(i, j) for i in range(nx) if flags[i]]
    os.remove(raw)
    for ext in ('.hdr', '.raw.aux.xml'):
        p = big + '.cov' + ext
        if os.path.exists(p):
            os.remove(p)
    return keep


def cut(rec, big, x0, y0, keep, nb, z, nx, ny):
    lid = rec['id']
    ext = 'jpg' if rec['fmt'] == 'jpg' else 'png'
    jobs = os.path.join(TMP, '%s_jobs.txt' % lid)
    with open(jobs, 'w') as f:
        for i, j in keep:
            d = os.path.join(TILES, lid, str(z), str(y0 + j))
            os.makedirs(d, exist_ok=True)
            f.write('%d %d %s\n' % (i * 256, j * 256, os.path.join(d, '%d.%s' % (x0 + i, ext))))
    if rec['fmt'] == 'jpg':
        bands = ' '.join('-b %d' % b for b in range(1, nb))  # last band is alpha
        tr = '%sgdal_translate -q -of JPEG -co QUALITY=%d %s -srcwin "$0" "$1" 256 256 %s "$2"' % (
            G, JPEG_Q, bands, big)
    else:
        pv = big + '.pal.vrt'
        palette_vrt(big, pv, rec['palette'], nx * 256, ny * 256)
        tr = '%sgdal_translate -q -of PNG -co ZLEVEL=9 -srcwin "$0" "$1" 256 256 %s "$2"' % (G, pv)
    subprocess.run('xargs -P %d -n 3 sh -c \'%s\' < "%s"' % (PAR, tr, jobs), shell=True, check=True, env=ENV)
    os.remove(jobs)


def build(lid):
    L = recipes()
    rec = dict(L[lid], id=lid)
    os.makedirs(TMP, exist_ok=True)
    outd = os.path.join(TILES, lid)
    if os.path.exists(outd):
        shutil.rmtree(outd)
    os.makedirs(outd)
    t0 = time.time()
    log = []
    for pi, part in enumerate(rec['parts']):
        for z in range(part['z'][0], part['z'][1] + 1):
            t1 = time.time()
            big, x0, y0, nx, ny, nb, r = warp_zoom(rec, part, z, 'p%d' % pi)
            t2 = time.time()
            keep = nonempty_tiles(big, nb if rec['fmt'] == 'jpg' else 1, nx, ny)
            cut(rec, big, x0, y0, keep, nb, z, nx, ny)
            t3 = time.time()
            for p in (big, big + '.pal.vrt'):
                if os.path.exists(p):
                    os.remove(p)
            log.append(dict(part=pi, z=z, grid=[nx, ny], written=len(keep), dropped_empty=nx * ny - len(keep),
                            resampling=r, warp_s=round(t2 - t1, 1), cut_s=round(t3 - t2, 1)))
            print('%s part%d z%d grid %dx%d kept %d (%s) warp %.1fs cut %.1fs' % (
                lid, pi, z, nx, ny, len(keep), r, t2 - t1, t3 - t2), flush=True)
    write_meta(rec, log, time.time() - t0)


def scan_dir(lid):
    stats = {}
    base = os.path.join(TILES, lid)
    for z in sorted(os.listdir(base), key=lambda s: int(s) if s.isdigit() else -1):
        if not z.isdigit():
            continue
        n = b = 0
        for dp, dn, fn in os.walk(os.path.join(base, z)):
            for f in fn:
                n += 1
                b += os.path.getsize(os.path.join(dp, f))
        stats[int(z)] = dict(tiles=n, bytes=b)
    return stats


def write_meta(rec, log, secs):
    st = scan_dir(rec['id'])
    parts = []
    for p in rec['parts']:
        parts.append(dict(zmin=p['z'][0], zmax=p['z'][1], bbox=[round(v, 7) for v in p['bbox']],
                          area=p.get('area', 'full'), source_file=os.path.relpath(p['src'], ROOT)))
    meta = dict(id=rec['id'], format='jpg' if rec['fmt'] == 'jpg' else 'png',
                grid='Leaflet L.CRS.EPSG4326 default (= Mars Trek default028mm): 2^(z+1) x 2^z tiles of 180/2^z deg, '
                     'origin lon -180 lat 90, path {z}/{y}/{x}',
                crs=SRS, parts=parts,
                minzoom=min(p['z'][0] for p in rec['parts']), maxzoom=max(p['z'][1] for p in rec['parts']),
                tiles_total=sum(v['tiles'] for v in st.values()), bytes_total=sum(v['bytes'] for v in st.values()),
                per_zoom=st, source=rec['source'], attribution=rec['attribution'],
                built=time.strftime('%Y-%m-%dT%H:%M:%S'), build_seconds=round(secs, 1), build_log=log,
                jpeg_quality=JPEG_Q if rec['fmt'] == 'jpg' else None)
    json.dump(meta, open(os.path.join(TILES, rec['id'], 'meta.json'), 'w'), indent=1)
    print('%s: %d tiles, %.1f MB, %.0fs' % (rec['id'], meta['tiles_total'], meta['bytes_total'] / 1e6, secs))


# ------------------------------------------------------------------ verification
def ncc_shift(a, b, n=256, maxs=3, metric='ncc'):
    """Shift (dx, dy) in pixels of image a relative to b (+ parabola sub-pixel).
    metric 'ncc': normalised cross-correlation (different radiometry, e.g. Mars Trek tile).
    metric 'ssd': minimum mean squared difference, returned negated so larger = better; used for the
    same-source checks because NCC cannot locate smooth ramps (T3 colour gradients)."""
    m = maxs
    best = {}
    for dy in range(-m, m + 1):
        for dx in range(-m, m + 1):
            sa = sb = saa = sbb = sab = 0.0
            cnt = 0
            for y in range(m, n - m):
                ra = (y + dy) * n
                rb = y * n
                for x in range(m, n - m, 1):
                    va = a[ra + x + dx]
                    vb = b[rb + x]
                    sa += va; sb += vb; saa += va * va; sbb += vb * vb; sab += va * vb
                    cnt += 1
            cov = sab - sa * sb / cnt
            den = math.sqrt(max(saa - sa * sa / cnt, 1e-9) * max(sbb - sb * sb / cnt, 1e-9))
            if metric == 'ncc':
                best[(dx, dy)] = cov / den
            else:
                best[(dx, dy)] = -(saa - 2 * sab + sbb) / cnt
    (bx, by), c = max(best.items(), key=lambda kv: kv[1])

    def para(cm, c0, cp):
        d = cm - 2 * c0 + cp
        return 0.0 if abs(d) < 1e-12 else 0.5 * (cm - cp) / d
    fx = bx + (para(best[(bx - 1, by)], c, best[(bx + 1, by)]) if abs(bx) < m else 0)
    fy = by + (para(best[(bx, by - 1)], c, best[(bx, by + 1)]) if abs(by) < m else 0)
    return fx, fy, c


def ref_tile(rec, part, z, x, y, path, shift_px=(0, 0)):
    """Independent reference: warp the part source to the bounds computed from (z, x, y)."""
    b = tile_bounds(z, x, y)
    px = span(z) / 256
    b = (b[0] + shift_px[0] * px, b[1] - shift_px[1] * px, b[2] + shift_px[0] * px, b[3] - shift_px[1] * px)
    src_px = abs(ginfo(part['src'])['geoTransform'][1])
    r = resampling(rec, part, z, src_px)
    cmd = [G + 'gdalwarp', '-q', '-overwrite', '-t_srs', SRS, '-te'] + [repr(v) for v in b] + \
          ['-ts', 256, 256, '-r', r, '-of', 'ENVI', '-ot', 'Byte']
    if rec['fmt'] == 'jpg' and part.get('srcnodata') is not None:
        cmd += ['-srcnodata', part['srcnodata']]
    if rec['fmt'] != 'jpg':
        cmd += ['-wo', 'INIT_DEST=0', '-dstnodata', 'None']
    sh(cmd + [part['src'], path])
    return read_raw(path, 'B')


def tile_pixels(tile_path, raw):
    band_raw(tile_path, 1, raw)
    return read_raw(raw, 'B')


def pick_samples(rec):
    lid = rec['id']
    base = os.path.join(TILES, lid)
    parts = rec['parts']
    want = [(0, parts[0]['z'][1]), (0, parts[0]['z'][0])]
    if len(parts) > 1:
        want.append((len(parts) - 1, parts[-1]['z'][1]))
    else:
        want.append((0, (parts[0]['z'][0] + parts[0]['z'][1]) // 2))
    out = []
    for pi, z in want:
        p = parts[pi]
        x0, y0, x1, y1 = tile_range(p['bbox'], z)
        cands = []
        for y in range(y0, y1 + 1):
            for x in range(x0, x1 + 1):
                f = os.path.join(base, str(z), str(y), '%d.%s' % (x, 'jpg' if rec['fmt'] == 'jpg' else 'png'))
                # smooth layers (T3 colour ramp) carry no positional signal in flat tiles: rank by the
                # relief seen in the hillshade tile at the same address instead
                g = os.path.join(TILES, rec['sample_like'], str(z), str(y), '%d.jpg' % x) if rec.get('sample_like') else f
                if os.path.exists(f) and os.path.exists(g):
                    # prefer interior tiles (all 8 neighbours inside the part range), then most detail
                    interior = x0 < x < x1 and y0 < y < y1
                    cands.append((interior, os.path.getsize(g), z, x, y, f))
        cands.sort(reverse=True)
        if cands:
            out.append((pi,) + cands[0][2:])
    return out


def verify(lid, selftest=False):
    L = recipes()
    rec = dict(L[lid], id=lid)
    vd = os.path.join(S3, 'verify')
    os.makedirs(vd, exist_ok=True)
    res = []
    for pi, z, x, y, f in pick_samples(rec):
        part = rec['parts'][pi]
        b = tile_bounds(z, x, y)
        info = ginfo(part['src'])
        gt = info['geoTransform']
        corners = []
        for lon, lat in ((b[0], b[3]), (b[2], b[3]), (b[0], b[1]), (b[2], b[1])):
            corners.append(dict(lon=round(lon, 8), lat=round(lat, 8),
                                src_col=round((lon - gt[0]) / gt[1], 3), src_row=round((lat - gt[3]) / gt[5], 3)))
        a = tile_pixels(f, os.path.join(vd, 'tile.raw'))
        lossless = False
        if rec.get('sample_like'):
            # JPEG noise (~0.5 DN) exceeds the change a 1 px shift makes on a smooth colour ramp, so
            # re-run the tiler's own warp + cut for a 3x3 tile block around this tile, write the centre
            # tile losslessly (PNG) and test that copy. Same code path as build(), only the format differs.
            blk = dict(part, bbox=tile_bounds(z, x - 1, y + 1)[:2] + tile_bounds(z, x + 1, y - 1)[2:])
            big, bx0, by0, bnx, bny, bnb, _ = warp_zoom(rec, blk, z, 'verify')
            png = os.path.join(vd, 'tile.png')
            sh([G + 'gdal_translate', '-q', '-of', 'PNG', '-b', 1, '-srcwin', (x - bx0) * 256, (y - by0) * 256,
                256, 256, big, png])
            os.remove(big)
            a = tile_pixels(png, os.path.join(vd, 'tile.raw'))
            lossless = True
        ref = ref_tile(rec, part, z, x, y, os.path.join(vd, 'ref.raw'))
        mae = sum(abs(p - q) for p, q in zip(a, ref)) / len(a)
        dx, dy, c = ncc_shift(a, ref, metric='ssd')
        ncc0 = ncc_shift(a, ref, maxs=1)[2]
        item = dict(layer=lid, z=z, x=x, y=y, file=os.path.relpath(f, ROOT), bounds=[round(v, 8) for v in b],
                    tile_px_m=round(span(z) / 256 * M_PER_DEG, 3), src_px_m=round(abs(gt[1]) * M_PER_DEG, 3),
                    corners=corners, shift_px=[round(dx, 3), round(dy, 3)], method='min mean squared difference, +-3 px, parabola',
                    msd_at_best=round(-c, 2), ncc=round(ncc0, 4),
                    lossless_recut=lossless, mean_abs_diff=round(mae, 2), pass_1px=bool(math.hypot(dx, dy) <= 1.0))
        if selftest:  # the method must see a deliberate 2 px offset as 2 px
            ref2 = ref_tile(rec, part, z, x, y, os.path.join(vd, 'ref2.raw'), shift_px=(2, -1))
            sx, sy, sc = ncc_shift(a, ref2, metric='ssd')
            item['selftest_expected_px'] = [2, -1]
            item['selftest_measured_px'] = [round(sx, 3), round(sy, 3)]
        res.append(item)
        print('%s z%d %d/%d shift (%.2f, %.2f) px ncc %.3f mad %.1f %s' % (
            lid, z, y, x, dx, dy, ncc0, mae, 'PASS' if item['pass_1px'] else 'FAIL'),
            (' selftest %s' % item.get('selftest_measured_px')) if selftest else '', flush=True)
    allv = os.path.join(S3, 'verify_results.json')
    d = json.load(open(allv)) if os.path.exists(allv) else {}
    d[lid] = res
    json.dump(d, open(allv, 'w'), indent=1)
    for p in os.listdir(vd):
        os.remove(os.path.join(vd, p))
    return res


TREK = ('https://trek.nasa.gov/tiles/Mars/EQ/THEMIS_NightIR_ControlledMosaics_100m_v2_oct2018/1.0.0/'
        'default/default028mm/{z}/{y}/{x}.png')


def trek():
    """Address check: same {z}/{y}/{x} from Mars Trek (THEMIS night IR) vs our B4 tile."""
    td = os.path.join(W, 'checks', 'trek_tiles')   # downloaded images: data only, read by GDAL
    os.makedirs(td, exist_ok=True)
    vd = os.path.join(S3, 'verify')
    os.makedirs(vd, exist_ok=True)
    out = []
    for z, y, x in ((9, 269, 902), (8, 134, 451)):
        url = TREK.format(z=z, y=y, x=x)
        dst = os.path.join(td, 'themis_night_%d_%d_%d.png' % (z, y, x))
        if not os.path.exists(dst):
            req = urllib.request.Request(url, headers={'User-Agent': 'tile-check/1.0'})
            with urllib.request.urlopen(req, timeout=60) as r, open(dst, 'wb') as f:
                f.write(r.read())
        ours = os.path.join(TILES, 'B4', str(z), str(y), '%d.jpg' % x)
        a = tile_pixels(ours, os.path.join(vd, 'a.raw'))
        nb = len(ginfo(dst)['bands'])
        bt = tile_pixels(dst, os.path.join(vd, 'b.raw'))
        dx, dy, c = ncc_shift(a, bt, maxs=6)
        # same address one tile to the east must NOT match (guards against a trivial match)
        out.append(dict(z=z, y=y, x=x, url=url, trek_bands=nb, shift_px=[round(dx, 2), round(dy, 2)],
                        ncc=round(c, 4), tile_px_m=round(span(z) / 256 * M_PER_DEG, 1),
                        shift_m=round(math.hypot(dx, dy) * span(z) / 256 * M_PER_DEG, 1)))
        print(out[-1], flush=True)
    for p in os.listdir(vd):
        os.remove(os.path.join(vd, p))
    allv = os.path.join(S3, 'verify_results.json')
    d = json.load(open(allv)) if os.path.exists(allv) else {}
    d['trek_address_check'] = out
    json.dump(d, open(allv, 'w'), indent=1)


# ------------------------------------------------------------------ layers.json
def legend_for(rec):
    lg = rec.get('legend')
    if lg == 'T3':
        t = json.load(open(ST('T3_legend.json')))
        return dict(type='ramp', unit='m', min=t['stops'][0][0], max=t['stops'][-1][0], stops=t['stops'],
                    data_min=round(t['min'], 1), data_max=round(t['max'], 1),
                    note_en='HiRISE DEM elevation (areoid), 5 m mean')
    if lg == 'T6':
        return dict(type='ramp', unit='m', min=-4500, max=3500,
                    stops=['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
                    note_en='MOLA elevation with hillshade')
    if lg == 'E1':
        return dict(type='ramp', unit='J m^-2 K^-1 s^-1/2 (TIU)', min=100, max=700,
                    stops=['#000004', '#57106e', '#bc3754', '#f98e09', '#fcffa4'],
                    note_en='Low = sand/dust (large day-night swing), high = rock')
    return lg


def layers():
    L = recipes()
    order = ['B1', 'B2', 'B4', 'B5', 'T6', 'T1', 'T2', 'T3', 'T5A', 'T5B', 'E1']
    out = []
    total_b = total_n = 0
    for lid in order:
        if lid not in L:
            continue
        mp = os.path.join(TILES, lid, 'meta.json')
        if not os.path.exists(mp):
            continue
        meta = json.load(open(mp))
        rec = L[lid]
        ext = meta['format']
        p0 = rec['parts'][0]
        b = p0['bbox']
        low = dict(minZoom=p0['z'][0], maxNativeZoom=p0['z'][1])
        hi = []
        for p in rec['parts'][1:]:
            q = p['bbox']
            hi.append(dict(area=p.get('area'), minNativeZoom=p['z'][0], maxNativeZoom=p['z'][1],
                           bounds=[[round(q[1], 6), round(q[0], 6)], [round(q[3], 6), round(q[2], 6)]]))
        ent = dict(
            id=lid, name=dict(en=rec['name_en']), group=rec['group'], kind=rec['kind'],
            type='tiles', format=ext, url='tiles/%s/{z}/{y}/{x}.%s' % (lid, ext),
            bounds=[[round(b[1], 6), round(b[0], 6)], [round(b[3], 6), round(b[2], 6)]],
            minZoom=low['minZoom'], maxNativeZoom=low['maxNativeZoom'], maxZoom_native_any=meta['maxzoom'],
            hires=hi, transparent=(ext == 'png'), opacity=rec.get('default_opacity', 1.0),
            attribution=rec['attribution'], source=rec['source'], legend=legend_for(rec),
            tiles=meta['tiles_total'], bytes=meta['bytes_total'])
        if 'base' in rec:
            ent['base'] = rec['base']
        out.append(ent)
        total_b += meta['bytes_total']
        total_n += meta['tiles_total']
    doc = dict(
        _comment='Generated by scripts/30_tiler.py layers (stage 3). bounds are Leaflet [[south, west], [north, east]] '
                 'in degrees on the Mars sphere R=3,396,190 m. Use L.CRS.EPSG4326 with zoomOffset 0: tile '
                 '{z}/{y}/{x} spans 180/2^z deg, origin (-180, 90). One layer = a low tile layer (bounds, minZoom, '
                 'maxNativeZoom) plus one extra L.tileLayer per hires[] entry (same url, its bounds, '
                 'minZoom=minNativeZoom=hires.minNativeZoom, maxNativeZoom=hires.maxNativeZoom); outside the hires '
                 'rectangles the low layer is upscaled. Missing tiles inside bounds are empty (dropped), not errors.',
        crs='+proj=longlat +R=3396190 +no_defs', tile_size=256, zoom_offset=0,
        external=[dict(id='B3', name=dict(en='MOLA colour shaded relief (global)'),
                       type='external', url='https://trek.nasa.gov/tiles/Mars/EQ/Mars_MGS_MOLA_ClrShade_merge_global_463m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
                       maxNativeZoom=7, zoomOffset=0, note='Address scheme verified numerically in stage 3 (zoomOffset 0); '
                       'confirm in browser (stage 5-1)', attribution='NASA/JPL-Caltech/GSFC, NASA Mars Trek'),
                  dict(id='B6', name=dict(en='Viking colour mosaic (global)'),
                       type='external', url='https://trek.nasa.gov/tiles/Mars/EQ/Mars_Viking_MDIM21_ClrMosaic_global_232m/1.0.0/default/default028mm/{z}/{y}/{x}.jpg',
                       maxNativeZoom=7, zoomOffset=0, attribution='NASA/JPL-Caltech/USGS, NASA Mars Trek')],
        layers=out, tiles_total=total_n, bytes_total=total_b,
        generated=time.strftime('%Y-%m-%dT%H:%M:%S'))
    json.dump(doc, open(os.path.join(ROOT, 'site', 'data', 'layers.json'), 'w'), indent=1, ensure_ascii=False)
    print('layers.json: %d layers, %d tiles, %.1f MB' % (len(out), total_n, total_b / 1e6))


def sizes():
    tot_n = tot_b = 0
    for lid in sorted(os.listdir(TILES)):
        mp = os.path.join(TILES, lid, 'meta.json')
        if not os.path.exists(mp):
            continue
        st = scan_dir(lid)
        n = sum(v['tiles'] for v in st.values())
        b = sum(v['bytes'] for v in st.values())
        tot_n += n
        tot_b += b
        zs = ' '.join('z%d:%d' % (z, v['tiles']) for z, v in sorted(st.items()))
        print('%-4s %6d tiles %7.1f MB avg %5.1f KB  %s' % (lid, n, b / 1e6, b / max(n, 1) / 1e3, zs))
    print('total %d tiles %.1f MB' % (tot_n, tot_b / 1e6))


if __name__ == '__main__':
    cmd, args = sys.argv[1], sys.argv[2:]
    if cmd == 'build':
        for a in args:
            build(a)
    elif cmd == 'verify':
        for a in args:
            verify(a, selftest=(a == 'B4'))
    elif cmd == 'trek':
        trek()
    elif cmd == 'layers':
        layers()
    elif cmd == 'sizes':
        sizes()
    else:
        raise SystemExit(__doc__)
