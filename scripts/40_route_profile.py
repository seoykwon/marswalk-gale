#!/usr/bin/env python3
"""Stage 4 step 2: route profiles -> site/data/routes.json (Plan/03 stage 4, Plan/09 2-2, Plan/02 sec.5).

  python3 -I scripts/40_route_profile.py

Reads scripts/config.json ("routes" from scripts/40_route_build.py, "walk", "comms", "eva") and rasters:
  elevation   work/vrt/dem_1m.vrt                     (bilinear)
  slope 5 m   work/stage3/slope_5m.tif                (cell value; drives time, hazards, warnings)
  slope 2 m   work/stage3/slope_2m.tif                (cell value; reference: 5 m underestimates steep ground, Plan/10 4)
  elev 5 m    work/dem_5m.tif                         (bilinear; only for the climb/descent cross-check in meta)
  line of sight work/stage3/T5_<A|B>_viewshed_cls.tif (1 visible, 2 hidden; from scripts/33_viewshed.py)
  thermal inertia work/vrt/E1_themis_ti_100m.vrt      (TIU, nearest)
  night IR    work/vrt/B4_themis_night_ir_100m.vrt    (8-bit brightness DN, not a temperature; nearest)
Rasters are read in bulk: a small window around each route is cut with gdal_translate to an ENVI
Float32 file in work/stage4/ and read with the stdlib (no per-point gdallocationinfo calls).

Conventions (also written to routes.json meta):
  * samples every 2 m of horizontal distance along the route line (last sample = destination).
  * segment k joins samples k and k+1. Its slope class uses the larger 5 m slope of its two ends, so
    times, hazard lengths and leg sums all add up exactly (and outbound = return time).
  * time = segment length / (flat speed x factor of that class); >= slope_danger_deg is impassable.
  * climb/descent = sum of positive / negative elevation steps between consecutive 2 m samples.
  * grade_deg = signed along-track slope from the two neighbouring samples (+ = uphill outbound).
  * hazards = runs of consecutive segments >= 15 deg (caution, incl. >= 25) and >= 25 deg (danger).
  * comms_gaps = runs of segments with at least one end outside the base line of sight.
"""
import array
import datetime
import json
import math
import os
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = '/Applications/Postgres.app/Contents/Versions/latest/bin/'
WK = os.path.join(ROOT, 'work', 'stage4')
CFG = json.load(open(os.path.join(ROOT, 'scripts', 'config.json')))
R_MARS = CFG['crs']['mars_radius_m']
STEP = CFG['routes']['method']['sample_spacing_m']
WALK = CFG['walk']
EVA = CFG['eva']
ENV = dict(os.environ, GDAL_PAM_ENABLED='NO')
OUT = os.path.join(ROOT, 'site', 'data', 'routes.json')
RAST = {
    'elev': ('work/vrt/dem_1m.vrt', 'bilinear'),
    'elev5': ('work/dem_5m.tif', 'bilinear'),
    'slope5': ('work/stage3/slope_5m.tif', 'near'),
    'slope2': ('work/stage3/slope_2m.tif', 'near'),
    'ti': ('work/vrt/E1_themis_ti_100m.vrt', 'near'),
    'nir': ('work/vrt/B4_themis_night_ir_100m.vrt', 'near'),
}
# Which measured environment data belong to each route (read by the planning panel and EVA mode).
# Dose values are NOT copied here: read site/data/rad.json periods.<rad_period> at run time.
ENV_DATA = {
    'A': dict(rad_period='early', rems='rems_A.json', spike_scenario=False,
              note_en='RAD periods.early (sols 1-359) and REMS sols 1-360 were measured at this site '
                      '(rover within ~550 m of Bradbury Landing until sol 358).'),
    'B': dict(rad_period='recent', rems='rems_B.json', spike_scenario=True,
              note_en='RAD periods.recent (sols 4613-4843) and REMS sols 4134-4843 were measured on this route.'),
}
TURN_DEG = 30.0       # Plan/09: a station where the direction changes by >= 30 deg
TURN_ARM_M = 40.0     # direction measured over this distance before / after a sample
MAX_STATIONS = 12     # Plan/09: 6-12 per route
MIN_SEP0_M = 60.0     # initial minimum spacing between stations (raised if > MAX_STATIONS)


def run(cmd):
    return subprocess.run([str(c) for c in cmd], check=True, env=ENV, capture_output=True, text=True).stdout


# ------------------------------------------------------------------ geometry
def kxy(lat):
    k = math.pi / 180 * R_MARS
    return k * math.cos(math.radians(lat)), k


def dist(a, b):
    kx, ky = kxy((a[1] + b[1]) / 2)
    return math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky)


def bearing(a, b):
    """Plan/09: atan2(dlon * cos(lat), dlat), 0-360 from map north"""
    lat = math.radians((a[1] + b[1]) / 2)
    return math.degrees(math.atan2((b[0] - a[0]) * math.cos(lat), b[1] - a[1])) % 360


def densify(line):
    """points every STEP m along the polyline; returns lon, lat, d (cumulative, m), vertex sample index"""
    cum = [0.0]
    for i in range(len(line) - 1):
        cum.append(cum[-1] + dist(line[i], line[i + 1]))
    L = cum[-1]
    n = int(math.floor(L / STEP + 1e-9))
    ds = [k * STEP for k in range(n + 1)]
    if L - ds[-1] > 1e-6:
        ds.append(L)
    lon, lat, j = [], [], 0
    for d in ds:
        while j < len(line) - 2 and cum[j + 1] < d:
            j += 1
        seg = cum[j + 1] - cum[j]
        t = 0 if seg == 0 else min(1, max(0, (d - cum[j]) / seg))
        lon.append(line[j][0] + t * (line[j + 1][0] - line[j][0]))
        lat.append(line[j][1] + t * (line[j + 1][1] - line[j][1]))
    # exact cumulative distance of the sampled points (equals ds up to float error)
    vsamp = [min(range(len(ds)), key=lambda k: abs(ds[k] - c)) for c in cum]
    return lon, lat, ds, L, vsamp


# ------------------------------------------------------------------ raster window reading
class Window:
    def __init__(self, key, path, bbox):
        info = json.loads(run([G + 'gdalinfo', '-json', os.path.join(ROOT, path)]))
        gt = info['geoTransform']
        nx, ny = info['size']
        x0, y0, dx, dy = gt[0], gt[3], gt[1], gt[5]
        c0 = max(0, int(math.floor((bbox[0] - x0) / dx)) - 3)
        c1 = min(nx, int(math.ceil((bbox[2] - x0) / dx)) + 3)
        r0 = max(0, int(math.floor((bbox[3] - y0) / dy)) - 3)
        r1 = min(ny, int(math.ceil((bbox[1] - y0) / dy)) + 3)
        self.w, self.h = c1 - c0, r1 - r0
        self.x0, self.y0, self.dx, self.dy = x0 + c0 * dx, y0 + r0 * dy, dx, dy
        b = info['bands'][0]
        self.nodata = b.get('noDataValue')
        os.makedirs(WK, exist_ok=True)
        out = os.path.join(WK, '%s.bin' % key)
        run([G + 'gdal_translate', '-q', '-of', 'ENVI', '-ot', 'Float32', '-b', 1, '-srcwin', c0, r0, self.w, self.h,
             os.path.join(ROOT, path), out])
        hdr = open(out[:-4] + '.hdr').read() if os.path.exists(out[:-4] + '.hdr') else open(out + '.hdr').read()
        a = array.array('f')
        a.frombytes(open(out, 'rb').read())
        big = 'byte order = 1' in hdr
        if big != (sys.byteorder == 'big'):
            a.byteswap()
        assert len(a) == self.w * self.h, (key, len(a), self.w, self.h)
        self.a = a
        self.path = path

    def ok(self, v):
        if v is None or v != v:
            return False
        if self.nodata is not None and abs(v - self.nodata) <= abs(self.nodata) * 1e-6:
            return False
        return abs(v) < 1e30 and v > -9000

    def near(self, lon, lat):
        c = int((lon - self.x0) / self.dx)
        r = int((lat - self.y0) / self.dy)
        v = self.a[r * self.w + c]
        return v if self.ok(v) else None

    def bilinear(self, lon, lat):
        fc = (lon - self.x0) / self.dx - 0.5
        fr = (lat - self.y0) / self.dy - 0.5
        c, r = int(math.floor(fc)), int(math.floor(fr))
        tx, ty = fc - c, fr - r
        vals = [self.a[(r + j) * self.w + c + i] for j in (0, 1) for i in (0, 1)]
        if not all(self.ok(v) for v in vals):
            return self.near(lon, lat)
        return (vals[0] * (1 - tx) * (1 - ty) + vals[1] * tx * (1 - ty) + vals[2] * (1 - tx) * ty + vals[3] * tx * ty)


# ------------------------------------------------------------------ speed rule
def factor(s):
    if s >= WALK['slope_danger_deg']:
        return WALK['speed_factor_danger']
    if s >= WALK['slope_caution_deg']:
        return WALK['speed_factor_caution']
    if s >= WALK['slope_moderate_deg']:
        return WALK['speed_factor_moderate']
    return 1.0


def runs(flags):
    """[(k0, k1)] inclusive index runs of True"""
    out, k0 = [], None
    for k, f in enumerate(flags):
        if f and k0 is None:
            k0 = k
        if not f and k0 is not None:
            out.append((k0, k - 1))
            k0 = None
    if k0 is not None:
        out.append((k0, len(flags) - 1))
    return out


def r1(x):
    return None if x is None else round(x, 1)


# ------------------------------------------------------------------ one route
def profile(rid, rdef):
    line = rdef['line']
    lon, lat, d, L, vsamp = densify(line)
    n = len(d)
    pad = 0.002
    bbox = (min(lon) - pad, min(lat) - pad, max(lon) + pad, max(lat) + pad)
    rast = dict(RAST)
    rast['vis'] = ('work/stage3/T5_%s_viewshed_cls.tif' % rid, 'near')
    W = {k: Window('%s_%s' % (rid, k), p, bbox) for k, (p, m) in rast.items()}
    get = {k: [(W[k].bilinear if rast[k][1] == 'bilinear' else W[k].near)(lon[i], lat[i]) for i in range(n)]
           for k in rast}
    missing = {k: sum(1 for v in get[k] if v is None) for k in get}
    elev = [r1(v) for v in get['elev']]
    elev_raw = get['elev']
    s5 = [r1(v) for v in get['slope5']]
    s2 = [r1(v) for v in get['slope2']]
    vis = [1 if v == 1 else 0 for v in get['vis']]
    ti = [None if v is None else int(round(v)) for v in get['ti']]
    nir = [None if v is None else int(round(v)) for v in get['nir']]
    if any(v is None for v in elev + s5 + s2):
        raise SystemExit('route %s: DEM/slope missing %s' % (rid, missing))
    # segments
    v0 = WALK['flat_speed_kmh'] / 3.6
    seg_len = [d[k + 1] - d[k] for k in range(n - 1)]
    seg_s5 = [max(s5[k], s5[k + 1]) for k in range(n - 1)]
    seg_s2 = [max(s2[k], s2[k + 1]) for k in range(n - 1)]
    seg_f = [factor(s) for s in seg_s5]
    impassable = [k for k, f in enumerate(seg_f) if f <= 0]
    seg_t = [seg_len[k] / (v0 * seg_f[k]) if seg_f[k] > 0 else float('inf') for k in range(n - 1)]
    seg_dz = [elev_raw[k + 1] - elev_raw[k] for k in range(n - 1)]
    seg_hid = [not (vis[k] and vis[k + 1]) for k in range(n - 1)]
    t_out = [0.0]
    for t in seg_t:
        t_out.append(t_out[-1] + t)
    T = t_out[-1]
    # time from the sample back to the base along the same path. The speed rule depends only on the slope
    # magnitude, so walking a segment back takes as long as walking it out: t_ret = t_out (Plan/09 2-2)
    t_ret = [sum(seg_t[:i]) for i in range(n)]
    # grade (signed, along track) from neighbouring samples
    grade = []
    for i in range(n):
        a, b = max(0, i - 1), min(n - 1, i + 1)
        grade.append(r1(math.degrees(math.atan2(elev_raw[b] - elev_raw[a], d[b] - d[a]))))

    def seg_runs(flags, s_seg, s_samp, level, basis):
        out = []
        for k0, k1 in runs(flags):
            out.append(dict(from_m=round(d[k0], 1), to_m=round(d[k1 + 1], 1), len_m=round(d[k1 + 1] - d[k0], 1),
                            level=level, max_slope_deg=max(s_samp[k0:k1 + 2]), basis=basis))
        return out

    c15, c25 = WALK['slope_caution_deg'], WALK['slope_danger_deg']
    hz5 = (seg_runs([s >= c15 for s in seg_s5], seg_s5, s5, 'caution', 'slope_5m')
           + seg_runs([s >= c25 for s in seg_s5], seg_s5, s5, 'danger', 'slope_5m'))
    hz2 = (seg_runs([s >= c15 for s in seg_s2], seg_s2, s2, 'caution', 'slope_2m')
           + seg_runs([s >= c25 for s in seg_s2], seg_s2, s2, 'danger', 'slope_2m'))
    hz5.sort(key=lambda h: (h['from_m'], h['level']))
    hz2.sort(key=lambda h: (h['from_m'], h['level']))
    gaps = [dict(from_m=round(d[k0], 1), to_m=round(d[k1 + 1], 1), len_m=round(d[k1 + 1] - d[k0], 1))
            for k0, k1 in runs(seg_hid)]

    def seg_sum(vals, k0, k1, pred=lambda k: True):
        return sum(vals[k] for k in range(k0, k1) if pred(k))

    # ---------------- stations (Plan/09 2-2 rule)
    stops = rdef['stops']
    fixed = []
    for st in stops:
        fixed.append(dict(i=vsamp[st['line_vertex']], kind=st['kind'], reason='stop', stop=st))
    hz_starts = []
    for h in hz5:
        if h['level'] == 'caution':
            i = int(round(h['from_m'] / STEP))
            hz_starts.append((h['max_slope_deg'], min(i, n - 1)))
    arm = int(round(TURN_ARM_M / STEP))
    turns = []
    for i in range(arm, n - arm):
        b1 = bearing((lon[i - arm], lat[i - arm]), (lon[i], lat[i]))
        b2 = bearing((lon[i], lat[i]), (lon[i + arm], lat[i + arm]))
        dlt = abs((b2 - b1 + 180) % 360 - 180)
        turns.append((dlt, i))
    # local maxima >= TURN_DEG
    tmax = [(dl, i) for k, (dl, i) in enumerate(turns) if dl >= TURN_DEG and
            dl >= max(x[0] for x in turns[max(0, k - arm):k + arm + 1])]
    cands = [(2, -s, i, 'hazard') for s, i in hz_starts] + [(3, -dl, i, 'turn') for dl, i in tmax]
    cands.sort()
    sep = MIN_SEP0_M
    while True:
        acc = list(fixed)
        for _, _, i, why in cands:
            if all(abs(d[i] - d[a['i']]) >= sep for a in acc):
                acc.append(dict(i=i, kind='hazard' if why == 'hazard' else 'via', reason=why))
        acc.sort(key=lambda a: a['i'])
        # fill gaps > station_max_spacing_m
        filled = []
        for a, b in zip(acc[:-1], acc[1:]):
            filled.append(a)
            gap = d[b['i']] - d[a['i']]
            m = int(math.ceil(gap / EVA['station_max_spacing_m'] - 1e-9)) - 1
            for q in range(1, m + 1):
                i = int(round((d[a['i']] + gap * q / (m + 1)) / STEP))
                filled.append(dict(i=i, kind='via', reason='spacing'))
        filled.append(acc[-1])
        if len(filled) <= MAX_STATIONS or sep > 1000:
            break
        sep += 10
    stations = []
    for k, a in enumerate(filled):
        i = a['i']
        sid = '%s%d' % (rid, k + 1)
        st = a.get('stop')
        s = dict(id=sid, name_en=st['name_en'] if st else sid,
                 kind=a['kind'], reason=a['reason'], sol=st['sol'] if st else None, sample_idx=i,
                 d_m=round(d[i], 1), lon=round(lon[i], 7), lat=round(lat[i], 7), elev_m=elev[i],
                 t_out_s=round(t_out[i], 1), t_ret_s=round(t_ret[i], 1),
                 stay_s=EVA['dest_stay_min'] * 60 if a['kind'] == 'dest' else 0)
        stations.append(s)
    for s, nx in zip(stations, stations[1:] + [None]):
        if nx is None:
            s['leg'] = None
            continue
        k0, k1 = s['sample_idx'], nx['sample_idx']
        rng = range(k0, k1)
        s['leg'] = dict(
            to=nx['id'], dist_m=round(seg_sum(seg_len, k0, k1), 1),
            straight_m=round(dist((s['lon'], s['lat']), (nx['lon'], nx['lat'])), 1),
            bearing_deg=round(bearing((s['lon'], s['lat']), (nx['lon'], nx['lat']))),
            back_bearing_deg=round(bearing((nx['lon'], nx['lat']), (s['lon'], s['lat']))),
            climb_m=round(seg_sum(seg_dz, k0, k1, lambda k: seg_dz[k] > 0), 1),
            descent_m=round(-seg_sum(seg_dz, k0, k1, lambda k: seg_dz[k] < 0), 1),
            time_s=round(seg_sum(seg_t, k0, k1), 1),
            max_slope_deg=max(s5[k0:k1 + 1]), max_slope_2m_deg=max(s2[k0:k1 + 1]),
            len_over15_m=round(sum(seg_len[k] for k in rng if seg_s5[k] >= c15), 1),
            len_over25_m=round(sum(seg_len[k] for k in rng if seg_s5[k] >= c25), 1),
            len_over15_2m_m=round(sum(seg_len[k] for k in rng if seg_s2[k] >= c15), 1),
            comms_out_m=round(sum(seg_len[k] for k in rng if seg_hid[k]), 1))
    # ---------------- rover tilt along the route (waypoints within 5 m of the route line)
    wp = [f['properties'] for f in json.load(open(os.path.join(ROOT, 'Vector', 'MSL_traverse',
                                                              'MSL_waypoints.json')))['features']]
    s0, s1 = stops[0]['sol'], stops[-1]['sol']
    tilt = []
    for p in wp:
        if not (s0 <= p['sol'] <= s1):
            continue
        k = min(range(n), key=lambda i: (lon[i] - p['lon']) ** 2 + (lat[i] - p['lat']) ** 2)
        if dist((lon[k], lat[k]), (p['lon'], p['lat'])) <= 5:
            tilt.append([round(d[k], 1), p['tilt'], p['sol']])
    tilt.sort()
    # ---------------- summary
    def stats(v):
        v = [x for x in v if x is not None]
        return dict(min=min(v), mean=round(sum(v) / len(v), 1), max=max(v)) if v else None
    climb = sum(x for x in seg_dz if x > 0)
    desc = -sum(x for x in seg_dz if x < 0)
    e5 = get['elev5']
    climb5 = sum(max(0, e5[k + 1] - e5[k]) for k in range(n - 1))
    desc5 = sum(max(0, e5[k] - e5[k + 1]) for k in range(n - 1))
    d3 = sum(math.hypot(seg_len[k], seg_dz[k]) for k in range(n - 1))
    by_class = {}
    for name, lo, hi in (('0-5', 0, WALK['slope_moderate_deg']), ('5-15', WALK['slope_moderate_deg'], c15),
                         ('15-25', c15, c25), ('25+', c25, 1e9)):
        by_class[name] = dict(len_m=round(sum(seg_len[k] for k in range(n - 1) if lo <= seg_s5[k] < hi), 1),
                              time_s=round(sum(seg_t[k] for k in range(n - 1) if lo <= seg_s5[k] < hi), 1))
    summary = dict(
        dist_m=round(L, 1), dist_3d_m=round(d3, 1), round_trip_m=round(2 * L, 1),
        one_way_time_s=round(T, 1), round_trip_walk_s=round(2 * T, 1),
        dest_stay_s=EVA['dest_stay_min'] * 60, round_trip_with_stay_s=round(2 * T + EVA['dest_stay_min'] * 60, 1),
        climb_m=round(climb, 1), descent_m=round(desc, 1), net_elev_m=round(elev_raw[-1] - elev_raw[0], 1),
        elev_base_m=elev[0], elev_dest_m=elev[-1], elev_min_m=min(elev), elev_max_m=max(elev),
        max_slope_deg=max(s5), max_slope_2m_deg=max(s2),
        len_over15_m=round(sum(h['len_m'] for h in hz5 if h['level'] == 'caution'), 1),
        len_over25_m=round(sum(h['len_m'] for h in hz5 if h['level'] == 'danger'), 1),
        n_hazards_15=sum(1 for h in hz5 if h['level'] == 'caution'),
        n_hazards_25=sum(1 for h in hz5 if h['level'] == 'danger'),
        len_over15_2m_m=round(sum(h['len_m'] for h in hz2 if h['level'] == 'caution'), 1),
        len_over25_2m_m=round(sum(h['len_m'] for h in hz2 if h['level'] == 'danger'), 1),
        n_hazards_15_2m=sum(1 for h in hz2 if h['level'] == 'caution'),
        n_hazards_25_2m=sum(1 for h in hz2 if h['level'] == 'danger'),
        impassable_m=round(sum(seg_len[k] for k in impassable), 1),
        comms_out_m=round(sum(g['len_m'] for g in gaps), 1), n_comms_gaps=len(gaps),
        comms_out_share=round(sum(g['len_m'] for g in gaps) / L, 3),
        by_slope_class=by_class,
        thermal_inertia_tiu=stats(ti), night_ir_dn=stats(nir),
        rover_tilt=dict(n=len(tilt), median=sorted(t[1] for t in tilt)[len(tilt) // 2] if tilt else None,
                        max=max((t[1] for t in tilt), default=None),
                        n_over15=sum(1 for t in tilt if t[1] > c15)),
        n_stations=len(stations),
        checks=dict(climb_descent_5m_dem=[round(climb5, 1), round(desc5, 1)], raster_missing=missing))
    samples = dict(d_m=[round(x, 1) for x in d], lon=[round(x, 7) for x in lon], lat=[round(x, 7) for x in lat],
                   elev_m=elev, slope_deg=s5, slope_2m_deg=s2, grade_deg=grade, vis=vis,
                   t_out_s=[round(x, 1) for x in t_out], t_ret_s=[round(x, 1) for x in t_ret],
                   ti=ti, nir=nir)
    env = ENV_DATA[rid]
    return dict(id=rid, name_en=rdef['name_en'], env=env,
                base=dict(lon=stops[0]['lon'], lat=stops[0]['lat'], sol=stops[0]['sol'], basis=stops[0]['basis']),
                stops=[dict(sol=s['sol'], kind=s['kind'], name_en=s['name_en'],
                            lon=s['lon'], lat=s['lat'], rover_elev_m=s['rover_elev_m']) for s in stops],
                line=line, summary=summary, stations=stations, hazards=hz5, hazards_2m=hz2, comms_gaps=gaps,
                rover_tilt=tilt, samples=samples)


def main():
    routes = {}
    for rid in ('A', 'B'):
        routes[rid] = profile(rid, CFG['routes'][rid])
        s = routes[rid]['summary']
        print(rid, json.dumps({k: v for k, v in s.items() if k not in ('by_slope_class', 'checks')}))
        print('  checks', s['checks'])
        print('  stations', [(x['id'], x['kind'], x['reason'], x['d_m']) for x in routes[rid]['stations']])
        print('  hazards5', routes[rid]['hazards'])
        print('  hazards2', routes[rid]['hazards_2m'])
        print('  gaps', routes[rid]['comms_gaps'])
    vs = {r: json.load(open(os.path.join(ROOT, 'work', 'stage3', 'T5_%s_viewshed.json' % r))) for r in routes}
    meta = dict(
        generated_by='scripts/40_route_profile.py (routes from scripts/40_route_build.py -> config.json routes)',
        generated=datetime.date.today().isoformat(),
        sample_spacing_m=STEP,
        speed_rule=dict(flat_speed_kmh=WALK['flat_speed_kmh'],
                        classes=[dict(slope_deg=[0, WALK['slope_moderate_deg']], factor=1.0),
                                 dict(slope_deg=[WALK['slope_moderate_deg'], WALK['slope_caution_deg']],
                                      factor=WALK['speed_factor_moderate']),
                                 dict(slope_deg=[WALK['slope_caution_deg'], WALK['slope_danger_deg']],
                                      factor=WALK['speed_factor_caution']),
                                 dict(slope_deg=[WALK['slope_danger_deg'], 90], factor=WALK['speed_factor_danger'],
                                      note='impassable')],
                        segment_rule='segment between two samples uses the larger 5 m slope of its two ends',
                        source='assumption (scripts/config.json walk; Plan/02 sec.5)'),
        return_rule='same path back; t_ret_s = time from the sample back to the base (equals outbound time '
                    'because the rule depends only on slope magnitude)',
        elevation='work/vrt/dem_1m.vrt (HiRISE DEM 1 m), bilinear; climb/descent = sums of 2 m steps',
        slope='slope_deg: work/stage3/slope_5m.tif (5 m mean DEM, gdaldem). slope_2m_deg: slope_2m.tif. '
              '5 m slope reads ~2.4 deg low where rover tilt >= 10 deg (Plan/10 4); hazards_2m is the reference.',
        grade='grade_deg: signed along-track slope from neighbouring samples, + = uphill in the outbound direction',
        line_of_sight=dict(source='work/stage3/T5_<id>_viewshed_cls.tif (scripts/33_viewshed.py)',
                           antenna_height_m=CFG['comms']['antenna_height_m'],
                           target_height_m=CFG['comms']['target_height_m'],
                           bases={r: dict(lon=v['lon'], lat=v['lat'], basis=v['basis']) for r, v in vs.items()},
                           rule='vis 1 = sample cell visible from base; a segment is out of sight if either end is'),
        thermal_inertia='ti: work/vrt/E1_themis_ti_100m.vrt (THEMIS TI 100 m, alignment-corrected), TIU, nearest',
        night_ir='nir: work/vrt/B4_themis_night_ir_100m.vrt, 8-bit brightness DN (relative, not a temperature)',
        stations_rule='base / via / dest from config.json routes + starts of 5 m >= 15 deg hazards + turns >= %d deg '
                      '(direction over %d m before vs after), min spacing raised until <= %d stations, '
                      'gaps > %d m split (Plan/09 2-2)' % (TURN_DEG, TURN_ARM_M, MAX_STATIONS,
                                                           EVA['station_max_spacing_m']),
        env='routes.<id>.env: rad_period = key of site/data/rad.json periods to use for dose (A: early, B: recent); '
            'rems = temperature file. Dose numbers are read from rad.json at run time, not stored here.',
        rover_tilt='[d_m, tilt_deg, sol] for rover waypoints within 5 m of the route (MSL_waypoints.json)',
        units=dict(d_m='m', lon='deg E', lat='deg (north +)', elev_m='m (DEM datum)', slope_deg='deg',
                   t_out_s='s (SI)', ti='TIU = J m-2 K-1 s-1/2', nir='DN'),
        limits_en='Slope is a 5 m grid mean and can read lower than the real slope on steep ground (median 2.4 deg low '
                  'where rover tilt >= 10 deg); read the 2 m slope (hazards_2m) as well. Direct line of sight only '
                  '(no diffraction, no relays). Speed rules and limits are assumptions.')
    doc = dict(_comment='Route profiles for the planning panel and EVA mode (Plan/02 sec.5, Plan/09 2-2). '
                        'Arrays in samples are columns over 2 m samples; stations[].leg summarises the way to '
                        'the next station.', meta=meta, routes=routes)
    txt = json.dumps(doc, ensure_ascii=False, separators=(',', ':'))
    open(OUT, 'w').write(txt)
    print('wrote %s %.1f KB' % (OUT, len(txt.encode()) / 1024))


if __name__ == '__main__':
    main()
