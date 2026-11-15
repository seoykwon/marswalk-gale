#!/usr/bin/env python3
"""Stage 5-2: cross-check the numbers shown in the planning-mode panels against the JSON.

  (cd site && python3 -m http.server 8765) ; node scripts/58_browser_check.mjs ; python3 -I scripts/59_check_panels.py

Reads work/stage5/browser_check.json (text of every [data-check] element as rendered in headless Chrome)
and recomputes each value independently from site/data/*.json with the Python standard library. Where
possible the value is rebuilt from raw arrays (2 m samples, per-sol tables), not copied from summaries,
so a summary/array mismatch would also show up. Also checks the cursor readout against the 10 m grid.
Rounding mirrors site/src/format.js (half away from zero, thousands separator ",").
Output: table on stdout, work/stage5/panel_check.json. Exit code 1 if any check fails.
"""
import json
import math
import os
import re
import struct
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
D = os.path.join(ROOT, 'site', 'data')
J = lambda n: json.load(open(os.path.join(D, n)))

routes, rad, config = J('routes.json'), J('rad.json'), J('config.json')
rems = {'A': J('rems_A.json'), 'B': J('rems_B.json')}
shown = json.load(open(os.path.join(ROOT, 'work', 'stage5', 'browser_check.json')))
checks = shown['checks']
DEFAULT_LS = {'A': '180', 'B': '240'}  # site/src/env.js (Plan/09 3-4)


def fmt(x, d=0):
    m = 10 ** d
    r = math.copysign(math.floor(abs(x) * m + 0.5 + 1e-9) / m, x)
    s = '{:,.{d}f}'.format(abs(r), d=d)
    return ('-' if r < 0 else '') + s


def dur(s):
    m = int(math.floor(s / 60 + 0.5))
    h, mm = divmod(m, 60)
    return '%d h %02d min' % (h, mm) if h else '%d min' % mm


def temp_ck(k, d=1):
    return '%s °C (%s K)' % (fmt(k - 273.15, d).replace('-', '−'), fmt(k, d))


rows = []


def check(key, expected, how, contains=False):
    got = checks.get(key)
    ok = got is not None and ((expected in got) if contains else got == expected)
    rows.append({'key': key, 'shown': got, 'expected': expected, 'how': how, 'ok': ok})


def tol(key, value, recomputed, limit, how):
    rows.append({'key': key, 'shown': '%.2f' % value, 'expected': '%.2f (±%s)' % (recomputed, limit), 'how': how,
                 'ok': abs(value - recomputed) <= limit})


# ---------------- route panel
for rid in ('A', 'B'):
    R = routes['routes'][rid]
    S, sm = R['summary'], R['samples']
    P = 'route.%s' % rid
    d, sl, vis, ti = sm['d_m'], sm['slope_deg'], sm['vis'], sm['ti']
    n = len(d)
    seg = [(d[i + 1] - d[i], max(sl[i], sl[i + 1]), vis[i] and vis[i + 1]) for i in range(n - 1)]
    dist = d[-1]
    # walking time from samples with the speed rule in config (independent of t_out_s)
    w = config['walk']
    v0 = w['flat_speed_kmh'] / 3.6

    def factor(s):
        if s >= w['slope_danger_deg']:
            return w['speed_factor_danger']
        if s >= w['slope_caution_deg']:
            return w['speed_factor_caution']
        if s >= w['slope_moderate_deg']:
            return w['speed_factor_moderate']
        return 1.0
    t_one = sum(L / (v0 * factor(s)) for L, s, _ in seg)
    stay = config['eva']['dest_stay_min'] * 60
    T = 2 * t_one + stay
    climb = sum(max(0, sm['elev_m'][i + 1] - sm['elev_m'][i]) for i in range(n - 1))
    desc = sum(max(0, sm['elev_m'][i] - sm['elev_m'][i + 1]) for i in range(n - 1))
    over15 = sum(L for L, s, _ in seg if s >= w['slope_caution_deg'])
    runs, prev = 0, False
    for L, s, _ in seg:
        cur = s >= w['slope_caution_deg']
        runs += cur and not prev
        prev = cur
    comms = sum(L for L, _, v in seg if not v)

    check(P + '.dist_m', fmt(dist, 1) + ' m', 'last samples.d_m')
    check(P + '.round_trip_m', fmt(S['round_trip_m'], 1) + ' m', 'summary.round_trip_m')
    tol(P + '.round_trip_vs_samples', S['round_trip_m'], 2 * dist, 0.15, '2 x last samples.d_m (d_m stored to 0.1 m)')
    check(P + '.one_way_time_s', dur(t_one), 'sum(2 m segment / speed(class of larger end slope)), config.walk')
    check(P + '.eva_s', dur(T), '2 x one-way + config.eva.dest_stay_min')
    check(P + '.climb_m', '+' + fmt(S['climb_m'], 1), 'summary.climb_m')
    check(P + '.descent_m', '−' + fmt(S['descent_m'], 1), 'summary.descent_m')
    tol(P + '.climb_vs_samples', S['climb_m'], climb, 0.5, 'sum of positive 2 m steps of samples.elev_m (stored to 0.1 m)')
    tol(P + '.descent_vs_samples', S['descent_m'], desc, 0.5, 'sum of negative 2 m steps of samples.elev_m (stored to 0.1 m)')
    check(P + '.max_slope_deg', fmt(max(sl), 1) + '°', 'max samples.slope_deg')
    check(P + '.hazards_5m', '%d sections ≥15°, %s m' % (runs, fmt(over15, 1)), 'runs of 2 m segments with slope >= 15', contains=True)
    check(P + '.comms_out_m', fmt(comms, 1) + ' m', '2 m segments with vis 0 at either end')
    check(P + '.ti_mean', fmt(sum(ti) / len(ti), 1), 'mean samples.ti')

    per = rad['periods'][R['env']['rad_period']]
    st = [r for r in per['sol_table'] if r[2] and r[4] is not None]
    wE = sum(r[2] * r[4] for r in st) / sum(r[2] for r in st)
    wB = sum(r[2] * r[3] for r in st) / sum(r[2] for r in st)
    rows.append({'key': P + '.rad_mean_vs_sol_table', 'shown': '%.3f / %.3f' % (per['E_mean'], per['B_mean']),
                 'expected': '%.3f / %.3f' % (wE, wB), 'how': 'n_valid-weighted mean of sol_table (E/B)',
                 'ok': abs(wE - per['E_mean']) < 0.002 and abs(wB - per['B_mean']) < 0.002})
    check(P + '.E_rate', fmt(per['E_mean'], 3), 'rad.json periods[%s].E_mean' % R['env']['rad_period'])
    check(P + '.B_rate', fmt(per['B_mean'], 3), 'rad.json periods[%s].B_mean' % R['env']['rad_period'])
    check(P + '.dose_E', fmt(per['E_mean'] * T / 3600, 1), 'E_mean x total EVA time')
    check(P + '.dose_B', fmt(per['B_mean'] * T / 3600, 1), 'B_mean x total EVA time')
    check(P + '.B_year_mGy', fmt(per['B_mean'] * 8766 / 1000, 1), 'B_mean x 8766 h')
    if R['env']['spike_scenario']:
        top = max(st, key=lambda r: r[4])
        check(P + '.dose_E_spike', fmt(top[4] * T / 3600, 1), 'highest E sol mean (sol %d) x total EVA time' % top[0])
        check(P + '.dose_B_spike', fmt(top[3] * T / 3600, 1), 'B mean of that sol x total EVA time')
    else:
        rows.append({'key': P + '.no_spike', 'shown': str(per['spikes']), 'expected': '[]', 'how': 'period has no spike',
                     'ok': per['spikes'] == []})

    RM = rems[rid]
    g = RM['diurnal_by_ls30'][DEFAULT_LS[rid]]['gts']
    gv = [x for x in g if x is not None]
    check(P + '.gts_min', temp_ck(min(gv)), 'min of diurnal_by_ls30[%s].gts' % DEFAULT_LS[rid])
    check(P + '.gts_range', fmt(max(gv) - min(gv), 1) + ' K', 'max - min of that curve')
    check(P + '.h_below40', str(sum(1 for x in gv if x < 233.15)), 'hours < 233.15 K in that curve')
    full = [s for s in RM['sols'] if s['hrs'] >= 20]
    check(P + '.range_mean_K', fmt(sum(s['rng'] for s in full) / len(full), 1) + ' K', 'mean sols[].rng where hrs >= 20')

# route B hazard rows: union of 5 m and 2 m hazard intervals (Plan/11 sec.2-1 table); rover tilt = max
# recorded tilt within 15 m. Row 4 must show the 24.0 deg tilt of sol 4970.
RB = routes['routes']['B']
iv = sorted([(h['from_m'], h['to_m']) for h in RB['hazards'] + RB['hazards_2m']])
merged = []
for a, b in iv:
    if merged and a <= merged[-1][1] + 4:
        merged[-1][1] = max(merged[-1][1], b)
    else:
        merged.append([a, b])
for k, (a, b) in enumerate(merged, 1):
    near = [t for t in RB['rover_tilt'] if a - 15 <= t[0] <= b + 15]
    if near:
        top = max(near, key=lambda t: t[1])
        check('route.B.hz%d.tilt' % k, '%s° (sol %d, %s m)' % (fmt(top[1], 1), top[2], fmt(top[0])),
              'max rover_tilt within 15 m of merged hazard %d (%g-%g m)' % (k, a, b))
rows.append({'key': 'route.B.hz4.is_24deg', 'shown': checks.get('route.B.hz4.tilt'), 'expected': '24.0° (sol 4970',
             'how': 'Plan/11: rover tilt 24.0 deg at hazard 4', 'ok': (checks.get('route.B.hz4.tilt') or '').startswith('24.0° (sol 4970')})

# ---------------- radiation panel
for pk in ('recent', 'early'):
    per = rad['periods'][pk]
    st = [r for r in per['sol_table'] if r[2] and r[4] is not None]
    conv = per['conversion']
    check('rad.%s.B_mean' % pk, fmt(per['B_mean'], 3), 'periods.%s.B_mean' % pk)
    check('rad.%s.E_mean' % pk, fmt(per['E_mean'], 3), 'periods.%s.E_mean' % pk)
    check('rad.%s.c_equip6' % pk, fmt(per['B_mean'] * 6, 1), 'B_mean x 6 h')
    check('rad.%s.c_equip6' % pk, fmt(conv['equipment_6h_uGy_Si'], 1), 'rad.json conversion.equipment_6h_uGy_Si')
    check('rad.%s.c_year_mGy' % pk, fmt(conv['equipment_earth_year_mGy_Si'], 2), 'rad.json conversion.equipment_earth_year_mGy_Si')
    check('rad.%s.c_human6' % pk, fmt(conv['human_6h_uGy_E'], 1), 'rad.json conversion.human_6h_uGy_E')
    if per['spikes']:
        top = max(st, key=lambda r: r[4])
        thr = per['spike_threshold']['E']
        above = [r[0] for r in st if r[4] > thr]
        rows.append({'key': 'rad.%s.spike_rule' % pk, 'shown': str([s['sol'] for s in per['spikes']]), 'expected': str(above),
                     'how': 'sols with E sol mean > threshold (mean + 3 SD)', 'ok': above == [s['sol'] for s in per['spikes']]})
        check('rad.%s.spike_E_solmean' % pk, fmt(top[4], 3), 'highest E in sol_table (sol %d)' % top[0])
        check('rad.%s.c_spike6' % pk, fmt(conv['human_6h_uGy_E_at_max_spike_sol_mean'], 1), 'conversion.human_6h_uGy_E_at_max_spike_sol_mean')
check('rad.r4.r_E_obs', fmt(rems['B']['r4_rad_pressure']['obs_level']['r_E_P'], 3), 'rems_B r4 obs_level r_E_P')

# ---------------- temperature panel
for s in ('A', 'B'):
    RM = rems[s]
    full = [x for x in RM['sols'] if x['hrs'] >= 20]
    check('temp.%s.range_mean_K' % s, fmt(sum(x['rng'] for x in full) / len(full), 1) + ' K', 'mean sols[].rng where hrs >= 20')
    check('temp.%s.h40' % s, fmt(sum(x['g40'] for x in full) / len(full), 1) + ' h', 'mean sols[].g40 where hrs >= 20')

# ---------------- cursor readout vs the 10 m grid binary
G = json.load(open(os.path.join(D, 'grid', 'grid.json')))
elev = open(os.path.join(D, 'grid', 'elev_10m.bin'), 'rb').read()
slope = open(os.path.join(D, 'grid', 'slope_10m.bin'), 'rb').read()
for i, r in enumerate(shown.get('readout', [])):
    m = re.match(r'([\d.]+)°([NS]), ([\d.]+)°E · elev\. (-?[\d,.]+) m · slope ([\d.]+)°', r['text'])
    if not m:
        rows.append({'key': 'readout.%d' % i, 'shown': r['text'], 'expected': 'parsable', 'how': '', 'ok': False})
        continue
    lat = float(m.group(1)) * (-1 if m.group(2) == 'S' else 1)
    lon = float(m.group(3))
    cands = []
    for dl in (0, -1e-5, 1e-5):  # text has 5 decimals (~0.6 m); allow the neighbouring cell at a boundary
        for dn in (0, -1e-5, 1e-5):
            col = int((lon + dl - G['west']) // G['dlon'])
            row = int((G['north'] - (lat + dn)) // G['dlat'])
            idx = row * G['cols'] + col
            e = struct.unpack_from('<H', elev, idx * 2)[0] * 0.1 - 5000
            sv = slope[idx] * 0.5
            cands.append('%s / %s' % (fmt(e, 1), fmt(sv, 1)))
    got = '%s / %s' % (m.group(4), m.group(5))
    rows.append({'key': 'readout.%d' % i, 'shown': got, 'expected': cands[0], 'how': 'decode elev_10m.bin / slope_10m.bin at %.5f, %.5f' % (lat, lon),
                 'ok': got in cands})

# ---------------- stage 5-3: draw tool (independent re-implementation: sphere distance, 5 m resampling,
# bilinear elevation between 10 m cell centres, nearest-cell slope, speed rule from config)
R_MARS = config['crs']['R_m'] if 'R_m' in config.get('crs', {}) else 3396190.0
W = config['walk']


def hav(lo1, la1, lo2, la2):
    p1, p2 = math.radians(la1), math.radians(la2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * R_MARS * math.asin(min(1.0, math.sqrt(a)))


def g_cell(lon, lat):
    if not (G['west'] <= lon < G['east'] and G['south'] < lat <= G['north']):
        return None
    c = int(math.floor((lon - G['west']) / G['dlon']))
    r = int(math.floor((G['north'] - lat) / G['dlat']))
    if c < 0 or r < 0 or c >= G['cols'] or r >= G['rows']:
        return None
    return c, r


def g_elev(c, r):
    v = struct.unpack_from('<H', elev, (r * G['cols'] + c) * 2)[0]
    return None if v == 65535 else v * 0.1 - 5000


def g_slope(c, r):
    v = slope[r * G['cols'] + c]
    return None if v == 255 else v * 0.5


def g_sample(lon, lat):
    cr = g_cell(lon, lat)
    if not cr:
        return None
    sl, el = g_slope(*cr), g_elev(*cr)
    if sl is None or el is None:
        return None
    fc, fr = (lon - G['west']) / G['dlon'] - 0.5, (G['north'] - lat) / G['dlat'] - 0.5
    c, r = int(math.floor(fc)), int(math.floor(fr))
    if c >= 0 and r >= 0 and c + 1 < G['cols'] and r + 1 < G['rows']:
        v = [g_elev(c, r), g_elev(c + 1, r), g_elev(c, r + 1), g_elev(c + 1, r + 1)]
        if None not in v:
            tx, ty = fc - c, fr - r
            el = v[0] * (1 - tx) * (1 - ty) + v[1] * tx * (1 - ty) + v[2] * (1 - tx) * ty + v[3] * tx * ty
    return el, sl


def draw_calc(pts, step=5.0):
    """pts = [(lat, lon)] -> dict like analyzeLine()"""
    S, cum = [], 0.0
    for k in range(len(pts) - 1):
        (la0, lo0), (la1, lo1) = pts[k], pts[k + 1]
        ln = hav(lo0, la0, lo1, la1)
        n = max(1, int(math.ceil(ln / step)))
        for i in range(0 if k == 0 else 1, n + 1):
            f = i / n
            S.append((cum + ln * f, lo0 + (lo1 - lo0) * f, la0 + (la1 - la0) * f))
        cum += ln
    smp = [(d, g_sample(lo, la)) for d, lo, la in S]
    out = dict(total=cum, inside=0.0, outside=0.0, climb=0.0, descent=0.0, time=0.0, imp=0.0, smax=0.0,
               cls=[0.0] * 4, ctime=[0.0] * 4)
    v0 = W['flat_speed_kmh'] / 3.6
    for (d0, a), (d1, b) in zip(smp, smp[1:]):
        ln = d1 - d0
        if a is None or b is None:
            out['outside'] += ln
            continue
        out['inside'] += ln
        sl = max(a[1], b[1])
        out['smax'] = max(out['smax'], a[1], b[1])
        if sl >= W['slope_danger_deg']:
            c, f = 3, W['speed_factor_danger']
        elif sl >= W['slope_caution_deg']:
            c, f = 2, W['speed_factor_caution']
        elif sl >= W['slope_moderate_deg']:
            c, f = 1, W['speed_factor_moderate']
        else:
            c, f = 0, 1.0
        out['cls'][c] += ln
        if f > 0:
            out['time'] += ln / (v0 * f)
            out['ctime'][c] += ln / (v0 * f)
        else:
            out['imp'] += ln
        dz = b[0] - a[0]
        out['climb'] += max(0, dz)
        out['descent'] += max(0, -dz)
    return out


DR = shown.get('draw')
if DR:
    RA = routes['routes']['A']
    ptsA = [(la, lo) for lo, la in RA['line']]
    ex = draw_calc(ptsA)
    SA = RA['summary']
    # (1) numbers shown in the panel for the exact vertices vs the independent recomputation
    check('draw.n_points', str(len(ptsA)), 'number of route A vertices')
    check('draw.total_m', fmt(ex['total'], 1) + ' m', 'sphere distance over the 20 route A vertices')
    check('draw.in_m', fmt(ex['inside'], 1) + ' m', 'length with grid values')
    check('draw.climb_m', '+' + fmt(ex['climb'], 1), '5 m resampling, bilinear 10 m elevation')
    check('draw.descent_m', '−' + fmt(ex['descent'], 1), 'same')
    check('draw.slope_max', fmt(ex['smax'], 1) + '°', 'max nearest-cell slope along the line')
    check('draw.time_s', dur(ex['time']), 'speed rule on 10 m slopes, segment = larger end slope')
    # (2) the numbers the tool computed for the mouse-clicked line vs the same recomputation on the clicked points
    ck_pts = DR['clicks']['drawn_latlngs']
    cl = draw_calc([tuple(p) for p in ck_pts])
    res = DR['clicks']['result']
    for k, a, b, lim in (('total_m', res['total_m'], cl['total'], 0.01), ('climb_m', res['climb_m'], cl['climb'], 0.01),
                         ('descent_m', res['descent_m'], cl['descent'], 0.01), ('time_s', res['time_s'], cl['time'], 0.05)):
        tol('draw.clicked.' + k, a, b, lim, 'tool vs Python on the 20 clicked points')
    # (3) outside-the-grid case: only length is counted outside; boundary distance computed independently
    o = DR['outside']['result']
    p0 = ptsA[0]
    edge = hav(p0[1], p0[0], G['west'], p0[0])  # distance from first vertex to the grid's west edge, same latitude
    tol('draw.outside.in_m', o['in_m'], edge, 10, 'distance to the grid west edge (cell size 10 m)')
    tol('draw.outside.total', o['total_m'], hav(p0[1], p0[0], p0[1] - 0.3, p0[0]), 0.01, 'sphere distance')
    rows.append({'key': 'draw.outside.sum', 'shown': '%.2f' % (o['in_m'] + o['out_m']), 'expected': '%.2f' % o['total_m'], 'how': 'in + out = total',
                 'ok': abs(o['in_m'] + o['out_m'] - o['total_m']) < 0.01})
    rows.append({'key': 'draw.outside.warning', 'shown': 'present' if 'outside the 10 m grid' in shown['draw']['outside_text'] else 'missing',
                 'expected': 'present', 'how': 'panel text', 'ok': 'outside the 10 m grid' in shown['draw']['outside_text']})
    # (4) behaviour checks
    def flag(key, ok, shown_, expected, how):
        rows.append({'key': key, 'shown': str(shown_), 'expected': str(expected), 'how': how, 'ok': bool(ok)})
    flag('draw.grid_lazy', DR['grid_requests_before_first_use'] == 0 and DR['grid_requests_after'] == 2,
         '%s -> %s' % (DR['grid_requests_before_first_use'], DR['grid_requests_after']), '0 -> 2', '10 m grid files requested only after the tool is used')
    flag('draw.undo', DR['after_clicks']['pts'] == 20 and DR['after_undo']['pts'] == 19, DR['after_undo']['pts'], 19, 'undo button removes one point')
    flag('draw.finish', DR['clicks']['active'] is False and DR['clicks']['pts'] == 20, DR['clicks']['pts'], 20, 'finish button ends drawing')
    kb = DR['kb']
    flag('draw.keyboard', kb['started'] and kb['focus_on_map'] and kb['pts_after_3'] == 3 and kb['pts_after_backspace'] == 2 and kb['final']['pts'] == 3
         and not kb['final']['active'], '%s/%s/%s' % (kb['pts_after_3'], kb['pts_after_backspace'], kb['final']['pts']), '3/2/3', 'Enter adds, Backspace undoes, F finishes')
    # (5) route A from routes.json vs the 10 m grid line (honest differences, stated tolerances)
    def rel(key, got, ref, lim_rel, how, abs_floor=0.0):
        d = got - ref
        lim = max(abs(ref) * lim_rel, abs_floor)
        rows.append({'key': key, 'shown': '%.1f (diff %+.1f, %+.1f%%)' % (got, d, 100 * d / ref if ref else 0),
                     'expected': '%.1f (limit +-%.1f)' % (ref, lim), 'how': how, 'ok': abs(d) <= lim})
    exr = DR['exact']['result']
    rel('draw.vs_route.dist_m', exr['total_m'], SA['dist_m'], 0.01, 'drawn along the 20 vertices vs routes.json summary.dist_m (limit 1 %)')
    rel('draw.vs_route.time_s', exr['time_s'], SA['one_way_time_s'], 0.15, '10 m slope time vs 2 m-sample/5 m-slope time (limit 15 %)')
    rel('draw.vs_route.climb_m', exr['climb_m'], SA['climb_m'], 0.25, '10 m grid climb vs summary.climb_m (limit 25 % or 3 m)', 3.0)
    rel('draw.vs_route.descent_m', exr['descent_m'], SA['descent_m'], 0.25, '10 m grid descent vs summary.descent_m (limit 25 % or 3 m)', 3.0)
    ccl = DR['clicks']['result']
    rel('draw.vs_route.clicked_dist_m', ccl['total_m'], SA['dist_m'], 0.02, 'mouse-clicked line (pixel rounding) vs summary.dist_m (limit 2 %)')
    rel('draw.vs_route.clicked_time_s', ccl['time_s'], SA['one_way_time_s'], 0.15, 'mouse-clicked line vs summary.one_way_time_s (limit 15 %)')
    # per-class lengths for the report
    DR['_cls_exact_m'] = [round(c, 1) for c in ex['cls']]
    DR['_cls_route_m'] = [SA['by_slope_class'][k]['len_m'] for k in ('0-5', '5-15', '15-25', '25+')]

# ---------------- links to EVA mode / cuff checklist (parameter contract, Plan/13 sec.2)
LK = shown.get('links')
if LK:
    from urllib.parse import urlparse, parse_qs

    def qs(h):
        u = urlparse(h)
        return u.path, {k: v[0] for k, v in parse_qs(u.query).items()}

    def link_check(key, href_eva, href_cuff, route, start, season):
        # English only (Plan/17 P1-2): the links carry no lang parameter
        pe, qe = qs(href_eva)
        pc, qc = qs(href_cuff)
        ok = (pe == 'eva.html' and qe == {'route': route, 'start': str(start), 'season': season, 'scenario': 'normal'}
              and pc == 'cuff.html' and qc == {'route': route, 'start': str(start), 'season': season})
        rows.append({'key': key, 'shown': href_eva + '  |  ' + href_cuff, 'expected': 'route=%s start=%s season=%s' % (route, start, season),
                     'how': 'hrefs of the two buttons', 'ok': ok})
    link_check('links.A', LK['A']['eva'], LK['A']['cuff'], 'A', 10, DEFAULT_LS['A'])
    link_check('links.A_start9', LK['A_start9']['eva'], LK['A_start9']['cuff'], 'A', 9, DEFAULT_LS['A'])
    link_check('links.B', LK['B']['eva'], LK['B']['cuff'], 'B', 9, DEFAULT_LS['B'])
    link_check('links.B_ls300', LK['B_ls300']['eva'], LK['B_ls300']['cuff'], 'B', 9, '300')

# ---------------- English only (Plan/17 P1-2): map.html?lang=ko renders English (the map moved from index.html, Plan/21 W1)
EN = shown.get('en_only')
if EN:
    rows.append({'key': 'en_only.map_lang_ko', 'shown': '%s, title %r, %d lang buttons, hangul %s' % (EN['lang'], EN['title'], EN['langBtns'], EN['hangul']),
                 'expected': "en, 'Marswalk · Map', 0, False", 'how': 'map.html?lang=ko: <html lang>, title, [data-lang] count, Hangul in page text',
                 'ok': EN['lang'] == 'en' and EN['title'] == 'Marswalk · Map' and EN['langBtns'] == 0 and EN['hangul'] is False})
else:
    rows.append({'key': 'en_only.map_lang_ko', 'shown': 'missing', 'expected': 'present', 'how': 'browser_check.json en_only block', 'ok': False})

# ---------------- site move (Plan/21 W1): home links on the map page; old map URLs on index.html go to map.html
HM = shown.get('home')
rows.append({'key': 'site.map_home_links', 'shown': json.dumps(HM), 'expected': "title link and About-pane link -> index.html",
             'how': 'map.html: #lnk-home (header title) and #about-home (About pane) hrefs',
             'ok': bool(HM) and HM.get('title_href') == 'index.html' and HM.get('title_text') == 'Marswalk' and HM.get('about_href') == 'index.html'})
RD = {r['from']: r for r in (shown.get('redirect') or [])}
for q, tab, route in (('?route=A', 'tab-route', 'A'), ('?route=A&tab=rad', 'tab-rad', 'A'), ('?tab=temp', 'tab-temp', 'B'), ('', None, None)):
    r = RD.get(q)
    if q:
        ok = bool(r) and r['path'] == 'map.html' and r['search'] == q and r['tab'] == tab and r['route'] in (route, None)
        exp = 'map.html%s, %s, route %s' % (q, tab, route)
    else:
        ok = bool(r) and r['path'] == 'index.html' and r['search'] == '' and r['cards'] == 3
        exp = 'index.html stays (home, 3 cards)'
    rows.append({'key': 'site.redirect.%s' % (q.lstrip('?').replace('&', '_').replace('=', '-') or 'none'), 'shown': json.dumps(r), 'expected': exp,
                 'how': 'navigate to index.html%s, read location and the selected tab' % q, 'ok': ok})

HP = shown.get('home_page')
SF = J('site_facts.json')['facts']
hp_ok = bool(HP) and HP['ready'] == '1' and HP['factsMissing'] == '0' and len(HP['facts']) > 0 and all(SF.get(k, {}).get('t') == v for k, v in HP['facts']) \
    and HP['cards'] == ['map.html', 'eva.html?route=B', 'cuff.html?route=B'] and HP['overflowX'] <= 0 \
    and [h for h, _ in HP['nav']] == ['index.html', 'map.html', 'eva.html?route=B', 'cuff.html?route=B', 'about.html', 'electronics.html', 'sources.html'] and HP['nav'][0][1] == 'page'
rows.append({'key': 'site.home_facts', 'shown': json.dumps(HP, ensure_ascii=False)[:300], 'expected': 'ready, every [data-fact] = site_facts.json t, 3 cards, menu, no overflow',
             'how': 'index.html after src/site/site.js: [data-fact] texts vs site/data/site_facts.json (scripts/61_site_facts.py)', 'ok': hp_ok})

# ---------------- mobile layout
MB = shown.get('mobile')
if MB:
    for tag, M in MB.items():
        for st_name in [k for k in ('collapsed', 'half', 'full') if k in M]:
            m = M[st_name]
            rows.append({'key': 'mobile.%s.%s.overflow' % (tag, st_name), 'shown': str(m['overflow_x']), 'expected': '0', 'how': 'document scrollWidth - viewport width (px)', 'ok': m['overflow_x'] == 0})
        c = M['collapsed']
        rows.append({'key': 'mobile.%s.map_free' % tag, 'shown': '%.1f %%' % (100 * c['map_free_share']), 'expected': '>= 60 %', 'how': 'collapsed sheet: map area not covered by top bar / sheet, share of viewport height', 'ok': c['map_free_share'] >= 0.6})
        h = M['half']
        rows.append({'key': 'mobile.%s.map_free_half' % tag, 'shown': '%.1f %%' % (100 * h['map_free_share']), 'expected': '>= 40 %', 'how': 'half-open sheet', 'ok': h['map_free_share'] >= 0.4})
        rows.append({'key': 'mobile.%s.attribution' % tag, 'shown': '%.2f %% of map, above sheet=%s' % (100 * c['attr_share_of_map'], c['attr_above_sheet']), 'expected': '< 3 % and above the sheet', 'how': 'attribution box area / map area', 'ok': c['attr_share_of_map'] < 0.03 and c['attr_above_sheet']})
        rows.append({'key': 'mobile.%s.touch_target' % tag, 'shown': '%d px' % c['min_touch_target_px'], 'expected': '>= 36 px', 'how': 'smallest side of top bar / toolbar / handle buttons', 'ok': c['min_touch_target_px'] >= 36})
        rows.append({'key': 'mobile.%s.touch_draw' % tag, 'shown': '%s pts, sheet %s -> %s' % (M['pts_touch'], M['sheet_while_drawing'], M['sheet_after_finish']), 'expected': '4 pts, collapsed -> half',
                     'how': 'tap Draw, 4 taps, undo, 1 tap, finish', 'ok': M['pts_touch'] == 4 and M['sheet_while_drawing'] == 'collapsed' and M['sheet_after_finish'] == 'half' and M['draw_final']['status'] == 'ready'})
        rows.append({'key': 'mobile.%s.drawer' % tag, 'shown': str(M['drawer_open']), 'expected': 'True', 'how': 'Layers button opens the drawer', 'ok': M['drawer_open'] is True})

bad = [r for r in rows if not r['ok']]
w = max(len(r['key']) for r in rows)
for r in rows:
    print('%s  %-*s  shown=%-26s expected=%-26s %s' % ('OK ' if r['ok'] else 'BAD', w, r['key'], r['shown'], r['expected'], r['how']))
if DR:
    print('\nDraw vs routes.json (route A): exact vertices %s; clicked %s; class lengths (m) drawn %s vs route %s' % (
        {k: round(v, 1) for k, v in DR['exact']['result'].items() if k in ('total_m', 'time_s', 'climb_m', 'descent_m', 'slope_max')},
        {k: round(v, 1) for k, v in DR['clicks']['result'].items() if k in ('total_m', 'time_s', 'climb_m', 'descent_m', 'slope_max')},
        DR['_cls_exact_m'], DR['_cls_route_m']))
unchecked = sorted(set(checks) - {r['key'] for r in rows})
print('\n%d checks, %d failed. Shown values not covered: %s' % (len(rows), len(bad), unchecked or 'none'))
json.dump({'rows': rows, 'failed': len(bad), 'unchecked': unchecked}, open(os.path.join(ROOT, 'work', 'stage5', 'panel_check.json'), 'w'),
          indent=1, ensure_ascii=False)
sys.exit(1 if bad else 0)
