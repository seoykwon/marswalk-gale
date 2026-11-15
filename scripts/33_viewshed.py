#!/usr/bin/env python3
"""T5 line-of-sight (viewshed) from an EVA base (Plan/02 T5, Plan/03 stage 3).

  python3 -I scripts/33_viewshed.py <ROUTE_ID> <lon> <lat> [--obs-h 2] [--tgt-h 2] [--basis TEXT]
  python3 -I scripts/33_viewshed.py defaults      # provisional bases A (sol 3) and B (sol 4614)
  python3 -I scripts/33_viewshed.py refresh-meta [A B]   # only add the final-base fields to the JSON
A --basis starting with "FINAL" at the config base gives provisional=false, base_name_en, base_sol and
legend_note_en in the JSON; scripts/30_tiler.py layers reads them (scripts/42_t5_finalize.py is retired).

Stage 4 re-runs this with the fixed base coordinates, then rebuilds tiles:
  python3 -I scripts/30_tiler.py build T5A   (or T5B)  &&  python3 -I scripts/30_tiler.py layers

Method: the 5 m mean DEM is copied to metres (equirectangular, true scale at lat -4.7, same sphere
R = 3,396,190 m) so gdal_viewshed gets equal horizontal/vertical units. Curvature coefficient 1.0
(geometric curvature of the Mars sphere, no atmospheric refraction). Observer and target heights are
assumptions from scripts/config.json "comms". Output on the 5 m lon/lat grid:
  work/stage3/T5_<ID>_viewshed_cls.tif  Byte: 1 = visible from base, 2 = hidden, 0 = no DEM
  work/stage3/T5_<ID>_viewshed.json     inputs + summary (stage 4 reads the .tif with gdallocationinfo)
"""
import json
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = '/Applications/Postgres.app/Contents/Versions/latest/bin/'
W = os.path.join(ROOT, 'work')
S3 = os.path.join(W, 'stage3')
CFG = json.load(open(os.path.join(ROOT, 'scripts', 'config.json')))
M = CFG['crs']['meters_per_degree']
LL = CFG['crs']['common']
EQC = '+proj=eqc +lat_ts=-4.7 +lon_0=137.4 +R=3396190 +units=m +no_defs'
ENV = dict(os.environ, GDAL_PAM_ENABLED='NO')
TILE_RADIUS_M = 6000   # z9-13 tiles cover the base +- 6 km (clipped to the DEM)
DEMBOX = (137.12247113204074, -4.925474311955847, 137.72981290693286, -4.248963057145466)


def run(cmd, **kw):
    return subprocess.run([str(c) for c in cmd], check=True, env=ENV, capture_output=True, text=True, **kw)


def defaults():
    d = json.load(open(os.path.join(ROOT, 'Vector', 'MSL_traverse', 'MSL_waypoints.json')))
    wp = [f['properties'] for f in d['features']]
    out = {}
    for rid, sol in (('A', 3), ('B', 4614)):
        p = [q for q in wp if q['sol'] == sol][0]
        out[rid] = (p['lon'], p['lat'], 'PROVISIONAL: rover waypoint sol %d (site %s drive %s) from '
                    'Vector/MSL_traverse/MSL_waypoints.json, Plan/02 sec.2 base (assumed). Stage 4 fixes the base.'
                    % (sol, p['site'], p['drive']))
    return out


def viewshed(rid, lon, lat, obs_h, tgt_h, basis):
    os.makedirs(S3, exist_ok=True)
    dem5 = os.path.join(W, 'dem_5m.tif')
    eqc = os.path.join(S3, 'dem_5m_eqc.tif')
    if not os.path.exists(eqc):
        run([G + 'gdalwarp', '-q', '-t_srs', EQC, '-tr', 5, 5, '-r', 'bilinear', '-co', 'TILED=YES', dem5, eqc])
    xy = run([G + 'gdaltransform', '-s_srs', LL, '-t_srs', EQC, '-output_xy'],
             input='%.9f %.9f\n' % (lon, lat)).stdout.split()
    ox, oy = float(xy[0]), float(xy[1])
    vs = os.path.join(S3, 'T5_%s_viewshed_eqc.tif' % rid)
    run([G + 'gdal_viewshed', '-q', '-ox', ox, '-oy', oy, '-oz', obs_h, '-tz', tgt_h, '-cc', 1.0,
         '-vv', 1, '-iv', 2, '-ov', 0, '-om', 'NORMAL', '-co', 'TILED=YES', eqc, vs])
    # back to the 5 m lon/lat grid of dem_5m.tif (nearest), then zero where the DEM has no data
    info = json.loads(run([G + 'gdalinfo', '-json', dem5]).stdout)
    gt, (nx, ny) = info['geoTransform'], info['size']
    te = [gt[0], gt[3] + ny * gt[5], gt[0] + nx * gt[1], gt[3]]
    ll = os.path.join(S3, 'T5_%s_viewshed_ll.tif' % rid)
    run([G + 'gdalwarp', '-q', '-overwrite', '-t_srs', LL, '-te'] + te + ['-ts', nx, ny, '-r', 'near',
        '-dstnodata', 'None', '-wo', 'INIT_DEST=0', '-co', 'TILED=YES', vs, ll])
    # mask: DEM nodata -> 0 (VRT 'mul' of class * (dem valid ? 1 : 0) via the DEM mask band)
    cls = os.path.join(S3, 'T5_%s_viewshed_cls.tif' % rid)
    mvrt = os.path.join(S3, 'T5_%s_mask.vrt' % rid)
    open(mvrt, 'w').write(f'''<VRTDataset rasterXSize="{nx}" rasterYSize="{ny}">
  <SRS>{LL}</SRS>
  <GeoTransform>{", ".join(repr(v) for v in gt)}</GeoTransform>
  <VRTRasterBand dataType="Byte" band="1" subClass="VRTDerivedRasterBand">
    <PixelFunctionType>mul</PixelFunctionType>
    <SimpleSource><SourceFilename relativeToVRT="0">{ll}</SourceFilename><SourceBand>1</SourceBand></SimpleSource>
    <ComplexSource><SourceFilename relativeToVRT="0">{dem5}</SourceFilename><SourceBand>mask,1</SourceBand><ScaleRatio>{1 / 255!r}</ScaleRatio></ComplexSource>
  </VRTRasterBand>
</VRTDataset>
''')
    run([G + 'gdal_translate', '-q', '-co', 'TILED=YES', mvrt, cls])
    hist = json.loads(run([G + 'gdalinfo', '-json', '-hist', cls]).stdout)['bands'][0]['histogram']
    c = hist['buckets']
    # histogram buckets for Byte -0.5..255.5 -> index = value
    vis, hid = (c[1], c[2]) if hist['count'] == 256 else (None, None)
    # visible share within 1 / 2 km of the base
    near = {}
    for r_m in (1000, 2000):
        d = r_m / M
        sub = os.path.join(S3, 'T5_%s_sub.vrt' % rid)
        run([G + 'gdal_translate', '-q', '-of', 'VRT', '-projwin', lon - d, lat + d, lon + d, lat - d, cls, sub])
        h = json.loads(run([G + 'gdalinfo', '-json', '-hist', sub]).stdout)['bands'][0]['histogram']['buckets']
        near['%dkm_box' % (r_m // 1000)] = round(h[1] / max(h[1] + h[2], 1), 3)
        os.remove(sub)
    d = TILE_RADIUS_M / M
    tb = [max(lon - d, DEMBOX[0]), max(lat - d, DEMBOX[1]), min(lon + d, DEMBOX[2]), min(lat + d, DEMBOX[3])]
    base_val = run([G + 'gdallocationinfo', '-valonly', '-geoloc', cls, lon, lat]).stdout.strip()
    meta = dict(route=rid, lon=lon, lat=lat, provisional=True, basis=basis)
    meta.update(final_base_fields(rid, lon, lat, basis))
    meta.update(observer_h_m=obs_h, target_h_m=tgt_h,
                curvature_coefficient=1.0, dem='work/dem_5m.tif -> work/stage3/dem_5m_eqc.tif (%s)' % EQC,
                observer_eqc_xy=[round(ox, 2), round(oy, 2)], value_at_base=base_val,
                visible_cells=vis, hidden_cells=hid, visible_share_near_base=near, tile_bbox=[round(v, 6) for v in tb],
                output='work/stage3/T5_%s_viewshed_cls.tif (1 visible, 2 hidden, 0 no DEM)' % rid,
                generated_by='scripts/33_viewshed.py')
    json.dump(meta, open(os.path.join(S3, 'T5_%s_viewshed.json' % rid), 'w'), indent=1)
    for p in (vs, ll, mvrt):
        os.remove(p)
    print(json.dumps(meta, indent=1))


def final_base_fields(rid, lon, lat, basis):
    """Fields scripts/30_tiler.py reads for the T5 layer name and legend note (Plan/17 P2-7).

    A base is final when --basis starts with "FINAL" and the position equals scripts/config.json
    routes.<rid>.stops[0]; then provisional=False plus base_name_en, base_sol and legend_note_en.
    """
    st = CFG.get('routes', {}).get(rid, {}).get('stops', [None])[0]
    if not (str(basis).upper().startswith('FINAL') and st and abs(st['lon'] - lon) <= 1e-7 and abs(st['lat'] - lat) <= 1e-7):
        return {}
    return dict(provisional=False, base_name_en=st['name_en'], base_sol=st['sol'],
                legend_note_en='Base: %s, rover waypoint sol %d (assumed base). Antenna %g m (assumption).'
                               % (st['name_en'], st['sol'], CFG['comms']['antenna_height_m']))


def main(argv):
    if argv and argv[0] == 'refresh-meta':
        # add the final-base fields to existing T5_<A|B>_viewshed.json without recomputing the viewshed
        for rid in argv[1:] or ('A', 'B'):
            path = os.path.join(S3, 'T5_%s_viewshed.json' % rid)
            meta = json.load(open(path))
            extra = final_base_fields(rid, meta['lon'], meta['lat'], meta['basis'])
            if not extra:
                raise SystemExit('T5%s: basis is not FINAL or base differs from config; nothing changed' % rid)
            meta.update(extra)
            json.dump(meta, open(path, 'w'), indent=1)
            print('T5%s:' % rid, json.dumps(extra))
        return
    ch = CFG['comms']
    if argv and argv[0] == 'defaults':
        for rid, (lo, la, basis) in defaults().items():
            viewshed(rid, lo, la, ch['antenna_height_m'], ch['target_height_m'], basis)
        return
    if len(argv) < 3:
        raise SystemExit(__doc__)
    rid, lon, lat = argv[0], float(argv[1]), float(argv[2])
    opts = dict(zip(argv[3::2], argv[4::2]))
    viewshed(rid, lon, lat, float(opts.get('--obs-h', ch['antenna_height_m'])),
             float(opts.get('--tgt-h', ch['target_height_m'])), opts.get('--basis', 'given on command line'))


if __name__ == '__main__':
    main(sys.argv[1:])
