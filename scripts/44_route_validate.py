#!/usr/bin/env python3
"""Stage 4 validation (Plan/03 stage 4 tables, Plan/09 4 turnaround) -> work/stage4/validate.json

  python3 -I scripts/44_route_validate.py

Independent of 40_route_profile.py where possible: distances are recomputed from config.json line
coordinates with the haversine formula, bearings with the great-circle initial-bearing formula,
segment times by hand from the sample arrays. Dose inputs are read from site/data/rad.json by field
name (periods.<routes.json env.rad_period>.E_mean / B_mean and .spikes[] with series_cols; route A uses
periods.early, route B periods.recent), so a regenerated rad.json is picked up without code changes.

Also writes site/data/selftest_ref.json: the reference table that eva.html?selftest=1 loads
(site/src/eva/selftest.js), so a new rad.json / rems_*.json needs only a re-run of this script (Plan/17 P2-6).
"""
import json
import math
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, 'scripts', 'config.json')))
RJ = json.load(open(os.path.join(ROOT, 'site', 'data', 'routes.json')))
RAD = json.load(open(os.path.join(ROOT, 'site', 'data', 'rad.json')))
R = CFG['crs']['mars_radius_m']
WALK, EVA = CFG['walk'], CFG['eva']
LMST_H_S = EVA['sol_seconds'] / 24.0   # SI seconds per LMST hour (3698.97)
OUT = os.path.join(ROOT, 'work', 'stage4', 'validate.json')
OUT_REF = os.path.join(ROOT, 'site', 'data', 'selftest_ref.json')
res = {'checks': [], 'turnaround': []}


def hav(a, b):
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dp, dl = p2 - p1, math.radians(b[0] - a[0])
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def gc_bearing(a, b):
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[0] - a[0])
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return math.degrees(math.atan2(y, x)) % 360


def check(name, expected, got, ok):
    res['checks'].append(dict(item=name, expected=expected, got=got, ok=bool(ok)))
    print('%-4s %-48s expected %-28s got %s' % ('PASS' if ok else 'FAIL', name, expected, got))


# ------------------------------------------------------------------ stage 4 table
for rid in ('A', 'B'):
    r = RJ['routes'][rid]
    s, S = r['summary'], r['samples']
    line = CFG['routes'][rid]['line']
    hand = sum(hav(line[i], line[i + 1]) for i in range(len(line) - 1))
    check('%s distance vs haversine of line vertices' % rid, '<= 1%% of %.1f m' % hand,
          '%.1f m (%.3f%%)' % (s['dist_m'], 100 * (s['dist_m'] - hand) / hand), abs(s['dist_m'] - hand) / hand <= 0.01)
    check('%s round trip' % rid, '<= %.1f km' % WALK['max_round_trip_km'], '%.2f km' % (s['round_trip_m'] / 1000),
          s['round_trip_m'] <= WALK['max_round_trip_km'] * 1000)
    if rid == 'A':
        check('A one way', '0.5-0.8 km', '%.3f km' % (s['dist_m'] / 1000), 500 <= s['dist_m'] <= 800)
        check('A descent sum', 'about 20 m (rover -21 m)', '%.1f m (5 m DEM: %.1f m)' % (
            s['descent_m'], s['checks']['climb_descent_5m_dem'][1]), 15 <= s['descent_m'] <= 25)
        check('A no slope >= 15 deg (5 m and 2 m)', '0 m', '%.0f m / %.0f m (max %.1f / %.1f deg)' % (
            s['len_over15_m'], s['len_over15_2m_m'], s['max_slope_deg'], s['max_slope_2m_deg']),
            s['len_over15_m'] == 0 and s['len_over15_2m_m'] == 0)
    else:
        check('B base->dest elevation', '+120-130 m (rover +124 m)', '%+.1f m' % s['net_elev_m'],
              120 <= s['net_elev_m'] <= 130)
        check('B hazard >= 15 deg', '>= 1 segment', '5 m: %d (%.0f m), 2 m: %d (%.0f m)' % (
            s['n_hazards_15'], s['len_over15_m'], s['n_hazards_15_2m'], s['len_over15_2m_m']),
            s['n_hazards_15'] >= 1)
    # EVA additions
    check('%s t_out last = one-way time' % rid, '%.1f s' % s['one_way_time_s'], '%.1f s' % S['t_out_s'][-1],
          abs(S['t_out_s'][-1] - s['one_way_time_s']) < 0.05)
    v0 = WALK['flat_speed_kmh'] / 3.6
    for k in (10, len(S['d_m']) // 2, len(S['d_m']) - 2):
        sl = max(S['slope_deg'][k], S['slope_deg'][k + 1])
        f = 1.0 if sl < 5 else 0.7 if sl < 15 else 0.4 if sl < 25 else 0
        hand_t = (S['d_m'][k + 1] - S['d_m'][k]) / (v0 * f)
        got_t = S['t_out_s'][k + 1] - S['t_out_s'][k]
        check('%s segment %d time by hand' % (rid, k), '%.2f s (%.1f m, %.1f deg x%.1f)' % (
            hand_t, S['d_m'][k + 1] - S['d_m'][k], sl, f), '%.2f s' % got_t, abs(hand_t - got_t) <= 1.0)
    legs = [st['leg'] for st in r['stations'] if st['leg']]
    check('%s sum leg dist = one way' % rid, '%.1f m' % s['dist_m'], '%.1f m' % sum(l['dist_m'] for l in legs),
          abs(sum(l['dist_m'] for l in legs) - s['dist_m']) <= 1)
    check('%s sum leg time = one way' % rid, '%.1f s' % s['one_way_time_s'],
          '%.1f s' % sum(l['time_s'] for l in legs), abs(sum(l['time_s'] for l in legs) - s['one_way_time_s']) <= 1)
    check('%s sum leg climb/descent' % rid, '%.1f / %.1f m' % (s['climb_m'], s['descent_m']),
          '%.1f / %.1f m' % (sum(l['climb_m'] for l in legs), sum(l['descent_m'] for l in legs)),
          abs(sum(l['climb_m'] for l in legs) - s['climb_m']) <= 0.5)
    check('%s hazards[] lengths = summary' % rid, '%.1f / %.1f m' % (s['len_over15_m'], s['len_over25_m']),
          '%.1f / %.1f m' % (sum(l['len_over15_m'] for l in legs), sum(l['len_over25_m'] for l in legs)),
          abs(sum(l['len_over15_m'] for l in legs) - s['len_over15_m']) <= 0.5)
    check('%s comms gaps = legs' % rid, '%.1f m' % s['comms_out_m'], '%.1f m' % sum(l['comms_out_m'] for l in legs),
          abs(sum(l['comms_out_m'] for l in legs) - s['comms_out_m']) <= 0.5)
    for a, b in ((0, 1), (len(r['stations']) - 2, len(r['stations']) - 1)):
        A_, B_ = r['stations'][a], r['stations'][b]
        hb = gc_bearing((A_['lon'], A_['lat']), (B_['lon'], B_['lat']))
        check('%s bearing %s->%s by hand' % (rid, A_['id'], B_['id']), '%.1f deg (great circle)' % hb,
              '%d deg' % A_['leg']['bearing_deg'], abs((A_['leg']['bearing_deg'] - hb + 180) % 360 - 180) <= 1)
    n = len(r['stations'])
    check('%s station count' % rid, '6-12', n, 6 <= n <= 12)
size = os.path.getsize(os.path.join(ROOT, 'site', 'data', 'routes.json'))
check('routes.json size', '<= 300 KB (Plan/03), <= 1 MB (task)', '%.1f KB' % (size / 1024), size <= 300 * 1024)


# ------------------------------------------------------------------ turnaround (Plan/09 4)
def gts_at(rems, ls, lmst):
    g = rems['diurnal_by_ls30'][str(ls)]['gts']
    # value g[h] belongs to h+0.5; fill nulls by linear interpolation between valid neighbours (circular)
    pts = [(h + 0.5, v) for h, v in enumerate(g) if v is not None]
    x = lmst % 24
    xs = [p[0] for p in pts]
    for k in range(len(pts)):
        x0, v0 = pts[k - 1]
        x1, v1 = pts[k]
        if k == 0:
            x0 -= 24
        if x0 <= x <= x1 or (k == 0 and x < x1):
            return v0 + (v1 - v0) * (x - x0) / (x1 - x0)
    x0, v0 = pts[-1]
    x1, v1 = pts[0][0] + 24, pts[0][1]
    return v0 + (v1 - v0) * (x - x0) / (x1 - x0)


def spike_rate(lmst, col, period):
    sp = RAD['periods'][period]['spikes'][0]
    ci = sp['series_cols'].index(col)
    ser = [(row[0], row[ci]) for row in sp['series']]
    x = lmst % 24
    if x <= ser[0][0]:
        return ser[0][1]
    if x >= ser[-1][0]:
        return ser[-1][1]
    for (x0, v0), (x1, v1) in zip(ser[:-1], ser[1:]):
        if x0 <= x <= x1:
            return v0 + (v1 - v0) * (x - x0) / (x1 - x0)


def dose_curve(start, scenario, col, period, horizon_s=8 * 3600, dt=60):
    """cumulative dose (uGy) at elapsed SI seconds, 1-min trapezoid; elapsed t -> LMST start + t/3698.97"""
    rec = RAD['periods'][period]
    out, cum = [(0, 0.0)], 0.0
    for k in range(int(horizon_s / dt)):
        t0, t1 = k * dt, (k + 1) * dt
        if scenario == 'mean':
            r0 = r1 = rec[col + '_mean']
        else:
            r0, r1 = spike_rate(start + t0 / LMST_H_S, col, period), spike_rate(start + t1 / LMST_H_S, col, period)
        cum += (r0 + r1) / 2 * dt / 3600
        out.append((t1, cum))
    return out


def scenario(rid, start, ls, dose_sc, p, label, st_label):
    r = RJ['routes'][rid]
    S, st = r['samples'], r['stations']
    rems = json.load(open(os.path.join(ROOT, 'site', 'data', r['env']['rems'])))
    D = {'time': EVA['max_duration_h'] * 3600, 'daylight': (EVA['daylight_end_lmst_h'] - start) * LMST_H_S}
    tcold = EVA['min_ground_temp_C'] + 273.15
    T0 = gts_at(rems, ls, start)
    if T0 < tcold:
        D['temperature'] = 0.0
    else:
        D['temperature'] = float('inf')
        for m in range(1, 24 * 60):
            if gts_at(rems, ls, start + m / 60) < tcold:
                # refine linearly within the minute
                D['temperature'] = (m / 60) * LMST_H_S
                break
    period = r['env']['rad_period']
    E = dose_curve(start, dose_sc, 'E', period)
    B = dose_curve(start, dose_sc, 'B', period)
    budget = EVA['dose_budget_uGy_E']
    D['dose'] = float('inf')
    for (t0, c0), (t1, c1) in zip(E[:-1], E[1:]):
        if c1 >= budget:
            D['dose'] = t0 + (budget - c0) / (c1 - c0) * (t1 - t0)
            break
    lim = min(D, key=D.get)
    Dv = D[lim]
    Rv = EVA['reserve_min'] * 60
    dest = st[-1]
    T = S['t_out_s'][-1]
    # turnaround: largest i with (t_out[i] + t_ret[i]) / p <= D - R
    ok = [i for i in range(len(S['d_m'])) if (S['t_out_s'][i] + S['t_ret_s'][i]) / p <= Dv - Rv]
    ti = ok[-1] if ok else None
    reach = ti == len(S['d_m']) - 1
    max_stay = Dv - Rv - 2 * T / p if reach else None
    Lk = {s['id']: round(Dv - Rv - s['t_ret_s'] / p) for s in st}
    plan_total = (2 * T / p + min(dest['stay_s'], max_stay if max_stay is not None else 0))
    e_at = lambda t: [c for (tt, c) in E if tt >= t][0]
    out = dict(label=label, route=rid, rad_period=period, E_rate=RAD['periods'][period]['E_mean'],
               B_rate=RAD['periods'][period]['B_mean'], start_lmst=start, ls=ls, dose=dose_sc, pace=p,
               temp_at_start_K=round(T0, 1),
               limits_s={k: (None if v == float('inf') else round(v)) for k, v in D.items()},
               limits_h={k: (None if v == float('inf') else round(v / 3600, 3)) for k, v in D.items()},
               binding=lim, D_minus_R_s=round(Dv - Rv),
               turnaround_d_m=None if reach or ti is None else S['d_m'][ti],
               dest_reachable=reach, max_stay_at_dest_s=None if max_stay is None else round(max_stay),
               L_k_s=Lk, E_6h_uGy=round(e_at(6 * 3600), 1), B_6h_uGy=round([c for (tt, c) in B if tt >= 6 * 3600][0], 1),
               E_planned_uGy=round(e_at(int(plan_total // 60 * 60)), 1),
               planned_total_s=round(plan_total),
               return_lmst=round(start + (plan_total) / LMST_H_S, 2), st_label=st_label)
    res['turnaround'].append(out)
    print('\n[%s] %s start %.1f Ls %d %s (%s) pace %.0f%%' % (label, rid, start, ls, dose_sc, period, p * 100))
    print('  limits h', out['limits_h'], '-> binding', lim, ' D-R', out['D_minus_R_s'], 's')
    print('  dest reachable', reach, 'max stay', out['max_stay_at_dest_s'], 'turnaround d', out['turnaround_d_m'])
    print('  E/B over 6 h', out['E_6h_uGy'], out['B_6h_uGy'], ' L_k', Lk)
    return out


SPK = RAD['periods']['recent']['spikes'][0]['sol']
scenario('B', 10.0, 240, 'mean', 1.0, 'S1 default', 'S1 B 10:00 mean')
scenario('B', 9.0, 240, 'spike', 1.0, 'S2 spike sol %d, 09:00' % SPK, 'S2 B 09:00 sol %d' % SPK)
scenario('B', 9.0, 240, 'spike', 0.5, 'S3 spike + 50% pace', 'S3 B 09:00 sol %d, pace 50%%' % SPK)
scenario('B', 15.0, 240, 'mean', 1.0, 'S4 late start 15:00', 'S4 B 15:00 mean')
scenario('B', 10.0, 240, 'mean', 0.5, 'S5 slow 50%', 'S5 B 10:00 pace 50%')
scenario('A', 10.0, 180, 'mean', 1.0, 'S6 route A default (early RAD)', 'S6 A 10:00 mean (early RAD)')
scenario('A', 10.0, 180, 'mean', 0.5, 'S7 route A slow 50% (early RAD)', 'S7 A 10:00 pace 50%')
os.makedirs(os.path.dirname(OUT), exist_ok=True)
json.dump(res, open(OUT, 'w'), indent=1, ensure_ascii=False)


# ------------------------------------------------------------------ self-test reference (site/data/selftest_ref.json)
def spike_6h(start):
    e = dose_curve(start, 'spike', 'E', 'recent')
    b = dose_curve(start, 'spike', 'B', 'recent')
    at = lambda c: [v for (tt, v) in c if tt >= 6 * 3600][0]
    return round(at(e), 1), round(at(b), 1)


SC_JS = {'mean': 'normal', 'spike': 'spike4716'}   # scenario ids of the EVA page (site/src/eva/state.js)
LIM_JS = {'time': 'time', 'daylight': 'daylight', 'temperature': 'temp', 'dose': 'dose'}
ref = {
    '_comment': 'Generated by scripts/44_route_validate.py (Python standard library) from site/data/routes.json, rad.json, '
                'rems_*.json and scripts/config.json. Read by site/src/eva/selftest.js (eva.html?selftest=1). Do not edit by hand.',
    'generated_by': 'scripts/44_route_validate.py',
    'limits_note': 'limits rounded to 1 s; the temperature limit comes from a 1-minute search',
    'scenarios': [], 'spike': None}
for o in res['turnaround']:
    ref['scenarios'].append({
        'label': o['st_label'], 'route': o['route'], 'start': o['start_lmst'], 'ls': str(o['ls']), 'scenario': SC_JS[o['dose']],
        'pace': o['pace'], 'limits': {LIM_JS[k]: v for k, v in o['limits_s'].items()}, 'binding': LIM_JS[o['binding']],
        'deadline': o['D_minus_R_s'], 'turnD': o['turnaround_d_m'], 'maxStay': o['max_stay_at_dest_s'], 'L': o['L_k_s']})
e9, b9 = spike_6h(9.0)
e10, b10 = spike_6h(10.0)
s2 = [o for o in res['turnaround'] if o['route'] == 'B' and o['dose'] == 'spike' and o['pace'] == 1.0][0]
ref['spike'] = {'sol': SPK, 'utc': RAD['periods']['recent']['spikes'][0]['utc'],
                'start9': {'E_6h_uGy': e9, 'B_6h_uGy': b9, 'dose_limit_h': round(s2['limits_s']['dose'] / 3600, 3)},
                'start10': {'E_6h_uGy': e10, 'B_6h_uGy': b10},
                'note': 'replay of the sol series from LMST start, 1-min trapezoid; budget = config eva.dose_budget_uGy_E'}
json.dump(ref, open(OUT_REF, 'w'), indent=1, ensure_ascii=False)
print('wrote %s (%d bytes); spike start 09:00 E/B %.1f/%.1f, start 10:00 %.1f/%.1f' % (
    os.path.relpath(OUT_REF, ROOT), os.path.getsize(OUT_REF), e9, b9, e10, b10))
print('\n%d/%d checks pass; wrote %s' % (sum(c['ok'] for c in res['checks']), len(res['checks']), OUT))
