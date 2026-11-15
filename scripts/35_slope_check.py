#!/usr/bin/env python3
"""Slope validation: DEM slope vs Curiosity tilt at the waypoints (Plan/03 stage 3, item 6).

Criterion (assumption): median difference <= 3 deg over all waypoints. Slope spacing compared: 2, 5, 10 m.
Rover tilt = inclination of the rover body (roll/pitch from the waypoint file), i.e. the ground under a
~3 m vehicle, so it is closest to a 2-5 m slope.

Run: python3 -I scripts/35_slope_check.py   -> work/stage3/slope_check.json (+ csv)
"""
import json
import math
import os
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
G = '/Applications/Postgres.app/Contents/Versions/latest/bin/'
S3 = os.path.join(ROOT, 'work', 'stage3')
ENV = dict(os.environ, GDAL_PAM_ENABLED='NO')


def sample(raster, pts):
    inp = ''.join('%.8f %.8f\n' % p for p in pts)
    r = subprocess.run([G + 'gdallocationinfo', '-valonly', '-geoloc', raster], input=inp,
                       capture_output=True, text=True, env=ENV, check=True)
    out = []
    for line in r.stdout.splitlines():
        try:
            v = float(line)
            out.append(None if v < -1000 else v)
        except ValueError:
            out.append(None)
    return out


def q(vals, p):
    s = sorted(vals)
    k = (len(s) - 1) * p
    f = math.floor(k)
    return s[f] + (s[min(f + 1, len(s) - 1)] - s[f]) * (k - f)


def stats(pairs):
    d = [s - t for s, t in pairs]
    ad = [abs(x) for x in d]
    n = len(pairs)
    ms = sum(s for s, _ in pairs) / n
    mt = sum(t for _, t in pairs) / n
    cov = sum((s - ms) * (t - mt) for s, t in pairs)
    vs = sum((s - ms) ** 2 for s, _ in pairs)
    vt = sum((t - mt) ** 2 for _, t in pairs)
    return dict(n=n, median_signed=round(q(d, .5), 2), median_abs=round(q(ad, .5), 2), p90_abs=round(q(ad, .9), 2),
                mean_signed=round(sum(d) / n, 2), r=round(cov / math.sqrt(vs * vt), 3),
                median_slope=round(q([s for s, _ in pairs], .5), 2), median_tilt=round(q([t for _, t in pairs], .5), 2),
                share_abs_le3=round(sum(1 for x in ad if x <= 3) / n, 3))


def main():
    d = json.load(open(os.path.join(ROOT, 'Vector', 'MSL_traverse', 'MSL_waypoints.json')))
    wp = [f['properties'] for f in d['features']]
    # drop exact duplicate positions (same lon/lat repeated across sols)
    seen = set()
    uniq = []
    for p in wp:
        k = (p['lon'], p['lat'])
        if k in seen:
            continue
        seen.add(k)
        uniq.append(p)
    pts = [(p['lon'], p['lat']) for p in uniq]
    res = dict(n_waypoints=len(wp), n_unique_positions=len(uniq), criterion='median |slope - tilt| <= 3 deg (assumption)')
    rows = {}
    for step in (2, 5, 10):
        sl = sample(os.path.join(S3, 'slope_%dm.tif' % step), pts)
        rows[step] = sl
        pairs = [(s, p['tilt']) for s, p in zip(sl, uniq) if s is not None and p['tilt'] is not None]
        res['slope_%dm' % step] = dict(all=stats(pairs))
        for name, cond in (('sol_le_1000', lambda p: p['sol'] <= 1000), ('sol_ge_3000', lambda p: p['sol'] >= 3000),
                           ('tilt_ge_10', lambda p: p['tilt'] >= 10), ('tilt_lt_5', lambda p: p['tilt'] < 5)):
            pr = [(s, p['tilt']) for s, p in zip(sl, uniq) if s is not None and cond(p)]
            res['slope_%dm' % step][name] = stats(pr)
        a = res['slope_%dm' % step]['all']
        a['pass'] = abs(a['median_signed']) <= 3 and a['median_abs'] <= 3
    # classes agreement (5 m) for the 15/25 deg thresholds
    cfg = json.load(open(os.path.join(ROOT, 'scripts', 'config.json')))['walk']
    c15, c25 = cfg['slope_caution_deg'], cfg['slope_danger_deg']
    s5 = rows[5]
    over15_t = [p for p, s in zip(uniq, s5) if s is not None and p['tilt'] > c15]
    res['tilt_over_15'] = dict(n=len(over15_t),
                               slope5m_over_15=sum(1 for p, s in zip(uniq, s5) if s is not None and p['tilt'] > c15 and s > c15),
                               slope5m_over_25=sum(1 for p, s in zip(uniq, s5) if s is not None and s > c25))
    json.dump(res, open(os.path.join(S3, 'slope_check.json'), 'w'), indent=1)
    with open(os.path.join(S3, 'slope_check.csv'), 'w') as f:
        f.write('sol,lon,lat,tilt,slope2m,slope5m,slope10m\n')
        for i, p in enumerate(uniq):
            f.write('%d,%.7f,%.7f,%s,%s,%s,%s\n' % (p['sol'], p['lon'], p['lat'], p['tilt'], rows[2][i], rows[5][i], rows[10][i]))
    print(json.dumps(res, indent=1))


if __name__ == '__main__':
    main()
