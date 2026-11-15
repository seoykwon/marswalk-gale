#!/usr/bin/env python3
"""Stage 3 DEM derivatives (Plan/03 stage 3, items 2-3; Plan/02 T1-T4).

Run with:  python3 -I scripts/32_dem_derive.py <step> [<step> ...]
Steps (in order):
  aggregate   1m DEM (work/vrt/dem_1m.vrt) -> work/dem_2m.tif, work/dem_5m.tif, work/dem_10m.tif (mean)
  check5m     DEM 5m vs 1m at waypoints (criterion: mean |diff| <= 1 m)
  slope       slope (deg) at 2m/5m/10m spacing -> work/stage3/slope_{2,5,10}m.tif
  t2          slope classes (config walk thresholds) -> work/stage3/T2_slopecls_5m.vrt (paletted)
  t1          multidirectional hillshade 5m (+1m inside high-zoom rectangles)
  t3          elevation colour (RGBA) from the 5m DEM
  t4          contours: 50m whole DEM, 10m inside route areas -> site/data/contours_*.geojson
  t6          MOLA 463m wide-area colour x hillshade
  e1          THEMIS thermal inertia colour (Gale crop)
  all         every step above in order

Only GDAL command-line tools + Python stdlib. Horizontal units are degrees, so every
gdaldem call gets -s 59274.7 (metres per degree on the R=3,396,190 m sphere).
"""
import json
import math
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = '/Applications/Postgres.app/Contents/Versions/latest/bin/'
W = os.path.join(ROOT, 'work')
S3 = os.path.join(W, 'stage3')
CFG = json.load(open(os.path.join(ROOT, 'scripts', 'config.json')))
M_PER_DEG = CFG['crs']['meters_per_degree']
SRS = CFG['crs']['common']
DEM1 = os.path.join(W, 'vrt', 'dem_1m.vrt')
ENV = dict(os.environ, GDAL_PAM_ENABLED='NO', GDAL_CACHEMAX='1024')

# 1m DEM grid (from work/vrt/dem_1m.vrt)
DEM_X0, DEM_Y0, DEM_PX = 137.12247113204074, -4.248963057145466, 1.6870604858114251e-05
DEM_NX, DEM_NY = 36000, 40100
HILLSHADE_Z = 2.0   # vertical exaggeration for hillshade only (display)


def run(cmd, **kw):
    print('+', ' '.join(str(c) for c in cmd)[:300], flush=True)
    subprocess.run([str(c) for c in cmd], check=True, env=ENV, **kw)


def out(cmd):
    return subprocess.run([str(c) for c in cmd], check=True, env=ENV,
                          capture_output=True, text=True).stdout


def areas():
    return json.load(open(os.path.join(ROOT, 'scripts', '31_tile_areas.json')))


# ---------------------------------------------------------------- aggregate
def aggregate():
    os.makedirs(S3, exist_ok=True)
    xmax = DEM_X0 + DEM_NX * DEM_PX
    ymin = DEM_Y0 - DEM_NY * DEM_PX
    te = [DEM_X0, ymin, xmax, DEM_Y0]
    co = ['-co', 'TILED=YES', '-co', 'BIGTIFF=IF_SAFER']
    for step, src in ((2, DEM1), (5, DEM1), (10, os.path.join(W, 'dem_5m.tif'))):
        dst = os.path.join(W, 'dem_%dm.tif' % step)
        if os.path.exists(dst):
            print('exists', dst)
            continue
        nx, ny = DEM_NX // step, DEM_NY // step
        assert nx * step == DEM_NX and ny * step == DEM_NY, step
        run([G + 'gdalwarp', '-q', '-overwrite', '-r', 'average', '-te'] + te +
            ['-ts', nx, ny, '-dstnodata', '-3.4028230607370965e+38', '-multi', '-wo', 'NUM_THREADS=4',
             '-wm', '1024'] + co + [src, dst + '.tmp.tif'])
        os.rename(dst + '.tmp.tif', dst)


# ---------------------------------------------------------------- waypoints
def waypoints():
    d = json.load(open(os.path.join(ROOT, 'Vector', 'MSL_traverse', 'MSL_waypoints.json')))
    return [f['properties'] for f in d['features']]


def sample(raster, pts):
    """Values of band 1 at lon/lat points (gdallocationinfo -valonly -geoloc)."""
    inp = ''.join('%.8f %.8f\n' % (lo, la) for lo, la in pts)
    r = subprocess.run([G + 'gdallocationinfo', '-valonly', '-geoloc', raster], input=inp,
                       capture_output=True, text=True, env=ENV, check=True)
    vals = []
    for line in r.stdout.splitlines():
        try:
            v = float(line)
            vals.append(None if abs(v) > 1e30 else v)
        except ValueError:
            vals.append(None)
    assert len(vals) == len(pts), (len(vals), len(pts))
    return vals


def check5m():
    wp = waypoints()
    pts = [(p['lon'], p['lat']) for p in wp]
    v1 = sample(DEM1, pts)
    res = {}
    for step in (2, 5, 10):
        vs = sample(os.path.join(W, 'dem_%dm.tif' % step), pts)
        d = [b - a for a, b in zip(v1, vs) if a is not None and b is not None]
        ad = sorted(abs(x) for x in d)
        res['dem_%dm' % step] = dict(n=len(d), mean=round(sum(d) / len(d), 3),
                                    mean_abs=round(sum(ad) / len(ad), 3),
                                    median_abs=round(ad[len(ad) // 2], 3), max_abs=round(ad[-1], 3))
    print(json.dumps(res, indent=1))
    json.dump(res, open(os.path.join(S3, 'check_dem_aggregate.json'), 'w'), indent=1)


# ---------------------------------------------------------------- slope
def slope():
    for step in (2, 5, 10):
        dst = os.path.join(S3, 'slope_%dm.tif' % step)
        if os.path.exists(dst):
            continue
        run([G + 'gdaldem', 'slope', '-q', '-s', M_PER_DEG, '-compute_edges', '-co', 'TILED=YES',
             os.path.join(W, 'dem_%dm.tif' % step), dst])


# ---------------------------------------------------------------- T2
T2_COLORS = [  # class: (r, g, b, a, label)
    (0, 0, 0, 0),          # 0: < 5 deg or no data -> transparent
    (254, 217, 118, 110),  # 1: 5-15 deg   (speed x0.7)
    (253, 141, 60, 200),   # 2: 15-25 deg  (speed x0.4, caution)
    (128, 0, 38, 230),     # 3: >= 25 deg  (impassable, assumption)
]


def write_palette_vrt(src_tif, dst_vrt, colors):
    """Wrap a 1-band Byte class raster in a VRT that carries a colour table with alpha."""
    info = json.loads(out([G + 'gdalinfo', '-json', src_tif]))
    nx, ny = info['size']
    gt = info['geoTransform']
    ents = ''.join('<Entry c1="%d" c2="%d" c3="%d" c4="%d"/>' % c for c in colors)
    ents += '<Entry c1="0" c2="0" c3="0" c4="0"/>' * (256 - len(colors))
    xml = f'''<VRTDataset rasterXSize="{nx}" rasterYSize="{ny}">
  <SRS>{SRS}</SRS>
  <GeoTransform>{", ".join(repr(v) for v in gt)}</GeoTransform>
  <VRTRasterBand dataType="Byte" band="1">
    <ColorInterp>Palette</ColorInterp>
    <ColorTable>{ents}</ColorTable>
    <SimpleSource>
      <SourceFilename relativeToVRT="0">{src_tif}</SourceFilename>
      <SourceBand>1</SourceBand>
    </SimpleSource>
  </VRTRasterBand>
</VRTDataset>
'''
    open(dst_vrt, 'w').write(xml)


def classify(src, dst_tif, breaks, nodata_class=0):
    """Class index raster via gdaldem color-relief: the 'colour' written is the class number."""
    eps = 1e-4
    lines = []
    lo = -1e6
    for i, b in enumerate(breaks):
        lines.append('%r %d %d %d' % (lo, i, i, i))
        lines.append('%r %d %d %d' % (b - eps, i, i, i))
        lo = b
    n = len(breaks)
    lines.append('%r %d %d %d' % (lo, n, n, n))
    lines.append('%r %d %d %d' % (1e6, n, n, n))
    lines.append('nv %d %d %d' % ((nodata_class,) * 3))
    cfile = dst_tif + '.classes.txt'
    open(cfile, 'w').write('\n'.join(lines) + '\n')
    tmp = dst_tif + '.rgb.tif'
    run([G + 'gdaldem', 'color-relief', '-q', '-co', 'TILED=YES', src, cfile, tmp])
    run([G + 'gdal_translate', '-q', '-b', 1, '-co', 'TILED=YES', '-a_nodata', 'none', tmp, dst_tif])
    os.remove(tmp)


def t2():
    w = CFG['walk']
    br = [w['slope_moderate_deg'], w['slope_caution_deg'], w['slope_danger_deg']]
    cls = os.path.join(S3, 'T2_slopecls_5m.tif')
    classify(os.path.join(S3, 'slope_5m.tif'), cls, br)
    write_palette_vrt(cls, os.path.join(S3, 'T2_slopecls_5m.vrt'), T2_COLORS)


# ---------------------------------------------------------------- T1
def t1():
    run([G + 'gdaldem', 'hillshade', '-q', '-multidirectional', '-s', M_PER_DEG, '-z', HILLSHADE_Z,
         '-compute_edges', '-co', 'TILED=YES', os.path.join(W, 'dem_5m.tif'),
         os.path.join(S3, 'T1_hillshade_5m.tif')])
    # 1m hillshade inside the z14-15 rectangles (+ 50 m margin so edges are real)
    pad = 50 / M_PER_DEG
    for i, r in enumerate(areas()['hi_rects']):
        # widen to the z14 tile grid so partial edge tiles are fully covered (z15 tiles nest inside)
        t = 180.0 / 2 ** 14
        w, s, e, n = r['bbox']
        w, e = -180 + math.floor((w + 180) / t) * t, -180 + math.ceil((e + 180) / t) * t
        n, s = 90 - math.floor((90 - n) / t) * t, 90 - math.ceil((90 - s) / t) * t
        crop = os.path.join(S3, 'dem_1m_rect%d.vrt' % i)
        run([G + 'gdal_translate', '-q', '-of', 'VRT', '-projwin', w - pad, n + pad, e + pad, s - pad,
             DEM1, crop])
        run([G + 'gdaldem', 'hillshade', '-q', '-multidirectional', '-s', M_PER_DEG, '-z', HILLSHADE_Z,
             '-compute_edges', '-co', 'TILED=YES', crop,
             os.path.join(S3, 'T1_hillshade_1m_rect%d.tif' % i)])


# ---------------------------------------------------------------- T3
# viridis stops (colour-vision-deficiency safe, perceptually uniform)
VIRIDIS = ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725']


def hexrgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def ramp_file(path, vmin, vmax, stops):
    lines = []
    for i, h in enumerate(stops):
        v = vmin + (vmax - vmin) * i / (len(stops) - 1)
        lines.append('%r %d %d %d 255' % ((v,) + hexrgb(h)))
    lines.append('nv 0 0 0 0')
    open(path, 'w').write('\n'.join(lines) + '\n')


def dem_minmax():
    info = json.loads(out([G + 'gdalinfo', '-json', '-mm', os.path.join(W, 'dem_5m.tif')]))
    b = info['bands'][0]
    return b['computedMin'], b['computedMax']


def t3():
    # Non-linear stops: half the DEM area lies between -4,530 and -4,270 m and the routes span
    # -4,520 to -3,470 m, while the north rim reaches +360 m (10 m DEM percentiles: 5% -4512,
    # 50% -4267, 75% -3700, 95% -1224, max +359). Stops are denser on the crater floor / lower Mount Sharp.
    lo, hi = dem_minmax()
    stops = list(zip(T3_STOP_M, VIRIDIS7))
    rf = os.path.join(S3, 'T3_ramp.txt')
    lines = ['%d %d %d %d 255' % ((v,) + hexrgb(h)) for v, h in stops] + ['nv 0 0 0 0']
    open(rf, 'w').write('\n'.join(lines) + '\n')
    run([G + 'gdaldem', 'color-relief', '-q', '-alpha', '-co', 'TILED=YES',
         os.path.join(W, 'dem_5m.tif'), rf, os.path.join(S3, 'T3_color_5m.tif')])
    json.dump(dict(min=lo, max=hi, stops=[[v, h] for v, h in stops]),
              open(os.path.join(S3, 'T3_legend.json'), 'w'))
    print('DEM 5m min/max', lo, hi)


T3_STOP_M = [-4600, -4450, -4200, -3800, -3300, -2000, 400]
VIRIDIS7 = ['#440154', '#443983', '#31688e', '#21918c', '#35b779', '#90d743', '#fde725']


# ---------------------------------------------------------------- T4
def t4():
    dd = os.path.join(ROOT, 'site', 'data')
    tmp = os.path.join(S3, 'contours')
    os.makedirs(tmp, exist_ok=True)
    # 50 m, whole DEM, from the 10 m mean DEM
    raw = os.path.join(tmp, 'c50_raw.geojson')
    if os.path.exists(raw):
        os.remove(raw)
    run([G + 'gdal_contour', '-q', '-i', 50, '-a', 'elev_m', '-f', 'GeoJSON',
         os.path.join(W, 'dem_10m.tif'), raw])
    contour_out(raw, os.path.join(dd, 'contours_50m.geojson'), simp_m=CONTOUR50_SIMPLIFY_M,
                min_len_m=CONTOUR50_MIN_LEN_M, decimals=5,
                meta=dict(interval_m=50, source='work/dem_10m.tif (10 m mean of HiRISE DEM 1 m)'))
    # 10 m, inside each route area, from the 5 m mean DEM
    for r in areas()['route_areas']:
        w, s, e, n = r['bbox']
        crop = os.path.join(tmp, 'dem5_%s.vrt' % r['id'])
        run([G + 'gdal_translate', '-q', '-of', 'VRT', '-projwin', w, n, e, s,
             os.path.join(W, 'dem_5m.tif'), crop])
        raw = os.path.join(tmp, 'c10_%s_raw.geojson' % r['id'])
        if os.path.exists(raw):
            os.remove(raw)
        run([G + 'gdal_contour', '-q', '-i', 10, '-a', 'elev_m', '-f', 'GeoJSON', crop, raw])
        contour_out(raw, os.path.join(dd, 'contours_10m_%s.geojson' % r['id']), simp_m=3, min_len_m=20,
                    decimals=6, meta=dict(interval_m=10, area=r['id'], area_bbox=r['bbox'], provisional_area=True,
                                          source='work/dem_5m.tif (5 m mean of HiRISE DEM 1 m)'))


CONTOUR50_SIMPLIFY_M = 10
CONTOUR50_MIN_LEN_M = 100


def contour_out(raw, dst, simp_m, min_len_m, decimals, meta):
    """ogr2ogr -simplify, then drop short closed/open bits and round coordinates (stdlib JSON)."""
    tmp = raw.replace('_raw', '_simp')
    if os.path.exists(tmp):
        os.remove(tmp)
    run([G + 'ogr2ogr', '-f', 'GeoJSON', '-simplify', simp_m / M_PER_DEG, tmp, raw])
    d = json.load(open(tmp))
    feats = []
    nv = 0
    for f in d['features']:
        g = f['geometry']
        lines = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        keep = []
        for ln in lines:
            L = sum(math.hypot((b[0] - a[0]) * math.cos(math.radians(a[1])), b[1] - a[1])
                    for a, b in zip(ln, ln[1:])) * M_PER_DEG
            if L >= min_len_m:
                keep.append([[round(c[0], decimals), round(c[1], decimals)] for c in ln])
        if not keep:
            continue
        nv += sum(len(k) for k in keep)
        geom = dict(type='LineString', coordinates=keep[0]) if len(keep) == 1 else \
            dict(type='MultiLineString', coordinates=keep)
        e = f['properties']['elev_m']
        feats.append(dict(type='Feature', properties=dict(elev_m=int(round(e))), geometry=geom))
    meta = dict(meta, simplify_m=simp_m, min_length_m=min_len_m, crs='+proj=longlat +R=3396190 (degrees)',
                elevation='HiRISE DEM elevation (m, areoid); DEM is up to ~20 m above rover-recorded elevation '
                          'on upper Mount Sharp (Plan/06 3-2)', generated_by='scripts/32_dem_derive.py t4')
    out = dict(type='FeatureCollection', meta=meta, features=feats)
    with open(dst, 'w') as fo:
        json.dump(out, fo, separators=(',', ':'))
    print(dst, 'features', len(feats), 'vertices', nv, 'bytes', os.path.getsize(dst))


# ---------------------------------------------------------------- T6
def mul_vrt(color_tif, shade_tif, dst_vrt, nx, ny, gt):
    """VRT whose RGB bands = colour * hillshade / 255 (built-in 'mul' pixel function)."""
    bands = ''
    for b, ci in ((1, 'Red'), (2, 'Green'), (3, 'Blue')):
        bands += f'''  <VRTRasterBand dataType="Byte" band="{b}" subClass="VRTDerivedRasterBand">
    <ColorInterp>{ci}</ColorInterp>
    <PixelFunctionType>mul</PixelFunctionType>
    <SourceTransferType>Float32</SourceTransferType>
    <ComplexSource><SourceFilename relativeToVRT="0">{color_tif}</SourceFilename><SourceBand>{b}</SourceBand></ComplexSource>
    <ComplexSource><SourceFilename relativeToVRT="0">{shade_tif}</SourceFilename><SourceBand>1</SourceBand><ScaleOffset>0.25</ScaleOffset><ScaleRatio>{0.75 / 255!r}</ScaleRatio></ComplexSource>
  </VRTRasterBand>
'''
    bands += f'''  <VRTRasterBand dataType="Byte" band="4">
    <ColorInterp>Alpha</ColorInterp>
    <SimpleSource><SourceFilename relativeToVRT="0">{color_tif}</SourceFilename><SourceBand>4</SourceBand></SimpleSource>
  </VRTRasterBand>
'''
    xml = f'''<VRTDataset rasterXSize="{nx}" rasterYSize="{ny}">
  <SRS>{SRS}</SRS>
  <GeoTransform>{", ".join(repr(v) for v in gt)}</GeoTransform>
{bands}</VRTDataset>
'''
    open(dst_vrt, 'w').write(xml)


def t6():
    src = os.path.join(S3, 'mola_crop.tif')
    if not os.path.exists(src):
        run([G + 'gdal_translate', '-q', '-projwin', 129, 4, 146, -13,
             os.path.join(W, 'vrt', 'T6_mola_463m.vrt'), src])
    rf = os.path.join(S3, 'T6_ramp.txt')
    ramp_file(rf, -4500, 3500, VIRIDIS)
    col = os.path.join(S3, 'T6_color.tif')
    shd = os.path.join(S3, 'T6_shade.tif')
    run([G + 'gdaldem', 'color-relief', '-q', '-alpha', src, rf, col])
    run([G + 'gdaldem', 'hillshade', '-q', '-multidirectional', '-s', M_PER_DEG, '-z', 4,
         '-compute_edges', src, shd])
    info = json.loads(out([G + 'gdalinfo', '-json', src]))
    mul_vrt(col, shd, os.path.join(S3, 'T6_shaded_color.vrt'), info['size'][0], info['size'][1],
            info['geoTransform'])
    run([G + 'gdal_translate', '-q', '-co', 'TILED=YES', os.path.join(S3, 'T6_shaded_color.vrt'),
         os.path.join(S3, 'T6_shaded_color.tif')])


# ---------------------------------------------------------------- E1
E1_STOPS = ['#000004', '#57106e', '#bc3754', '#f98e09', '#fcffa4']  # inferno
E1_RANGE = (100, 700)


def e1():
    src = os.path.join(S3, 'ti_crop.tif')
    if not os.path.exists(src):
        run([G + 'gdal_translate', '-q', '-projwin', 135.5, -2.5, 140, -8,
             os.path.join(W, 'vrt', 'E1_themis_ti_100m.vrt'), src])
    rf = os.path.join(S3, 'E1_ramp.txt')
    ramp_file(rf, E1_RANGE[0], E1_RANGE[1], E1_STOPS)
    run([G + 'gdaldem', 'color-relief', '-q', '-alpha', '-co', 'TILED=YES', src, rf,
         os.path.join(S3, 'E1_color.tif')])


STEPS = dict(aggregate=aggregate, check5m=check5m, slope=slope, t2=t2, t1=t1, t3=t3, t4=t4, t6=t6, e1=e1)

if __name__ == '__main__':
    os.makedirs(S3, exist_ok=True)
    args = sys.argv[1:] or ['all']
    if args == ['all']:
        args = list(STEPS)
    for a in args:
        print('== step', a, flush=True)
        STEPS[a]()
