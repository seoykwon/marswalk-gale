#!/usr/bin/env python3
"""Stage 2-2: MSL REMS MODRDR (RMD*.TAB) -> site/data/rems_A.json (sols 1-360), rems_B.json (sols 4134-4843)
Run: python3 -I scripts/21_parse_rems.py

Column positions come from Weather/pds_rems/mslrem_1001/LABEL/MODRDR6.FMT (START_BYTE, 1-based; fixed 372-byte rows):
  LMST 13/18 ("SSSSSMHH:MM:SS.sss"), HORIZONTAL_WIND_SPEED 50/7, BRIGHTNESS_TEMP 85/7 (K),
  BRIGHTNESS_TEMP_LONG_TERM_UNCERTAINTY 93/7, GTS_CONFIDENCE_LEVEL 110/8, AMBIENT_TEMP 158/7,
  AMBIENT_TEMP_CONFIDENCE_LEVEL 167/12, UV_ABC 205/7 (W/m2), PRESSURE 345/7 (Pa).
Missing value -999.00.  RNV (ENVRDR) files are ignored.
Per-file aggregates per (sol, LMST hour) are cached in work/stage2/rems_cache/.
Ls per sol is computed with the Mars24 algorithm (Allison and McEwen 2000; scripts/ls_mars24.py) from the
MODRDR TIMESTAMP column 1/10 ("seconds since noon 1-Jan-2000"): every row gives the time of LMST 12:00 of its
sol as TIMESTAMP - (LMST seconds - 43200) * 1.0274912517 (Mars solar day / Earth day, Mars24 eq. C-2), and
Ls is taken at the mean of these per sol. Weather/weather.txt (CAB outreach file) is no longer read.
"""
import glob, json, math, os, sys, time
from multiprocessing import Pool

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from ls_mars24 import ls_from_timestamp  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, 'scripts/config.json')))
SUFFIX = CFG['rems']['gts_confidence_suffix']          # '111'
MIN_H = CFG['rems']['min_hours_covered_for_range']      # 20
MISS = CFG['rems']['missing_value']
BASE = os.path.join(ROOT, 'Weather/pds_rems/mslrem_1001')
FMT = os.path.join(BASE, 'LABEL/MODRDR6.FMT')
CACHE = os.path.join(ROOT, 'work/stage2/rems_cache')
RADCACHE = os.path.join(ROOT, 'work/stage2/rad_cache')
OUTDIR = os.path.join(ROOT, 'site/data')
PERIODS = {'A': (1, 360), 'B': (4134, 4843)}
RECENT_YEAR = (4175, 4843)
K0 = 273.15
RECLEN = 372
MARS_SOL_DAYS = 1.0274912517   # Mars mean solar day in Earth days (Mars24 eq. C-2)


def read_fmt():
    cols = {}
    name = sb = by = None
    for ln in open(FMT, errors='replace'):
        ln = ln.strip()
        if ln.startswith('NAME') and '=' in ln and 'COLUMN' not in ln.split('=')[0]:
            name = ln.split('"')[1] if '"' in ln else ln.split('=')[1].strip()
        elif ln.startswith('START_BYTE'):
            sb = int(ln.split('=')[1])
        elif ln.startswith('BYTES') and not ln.startswith('BYTES_'):
            by = int(ln.split('=')[1])
        elif ln.startswith('END_OBJECT') and name and sb is not None and by is not None:
            cols[name] = (sb - 1, sb - 1 + by)
            name = sb = by = None
    return cols


COLS = read_fmt()
NEED = ['TIMESTAMP', 'LMST', 'HORIZONTAL_WIND_SPEED', 'BRIGHTNESS_TEMP', 'BRIGHTNESS_TEMP_LONG_TERM_UNCERTAINTY',
        'GTS_CONFIDENCE_LEVEL', 'AMBIENT_TEMP', 'AMBIENT_TEMP_CONFIDENCE_LEVEL', 'UV_ABC', 'PRESSURE']
for n in NEED:
    assert n in COLS, n
SL = {n: slice(*COLS[n]) for n in NEED}


def lbl_info(lbl):
    try:
        t = open(lbl, 'rb').read().decode('latin1')
    except OSError:
        return None, False
    fr = None
    for ln in t.splitlines():
        if ln.startswith('FILE_RECORDS'):
            fr = int(ln.split('=')[1].split()[0]); break
    return fr, t.rstrip().endswith('END')


def parse_file(tab):
    try:
        return _parse_file(tab)
    except Exception as e:
        return {'file': os.path.basename(tab), 'skip': 'parse error %r' % (e,)}


def _parse_file(tab):
    fr, has_end = lbl_info(tab[:-4] + '.LBL')
    if fr is None or not has_end:
        return {'file': os.path.basename(tab), 'skip': 'LBL missing / no END'}
    st = os.stat(tab)
    key = [st.st_size, int(st.st_mtime), SUFFIX, 'noon_ts_v2']
    cp = os.path.join(CACHE, os.path.basename(tab)[:-4] + '.json')
    if os.path.exists(cp):
        try:
            c = json.load(open(cp))
            if c.get('key') == key:
                return c
        except Exception:
            pass
    sl = SL
    sTS, sLM, sW, sBT, sLU, sGC, sAT, sAC, sUV, sP = (sl[n] for n in NEED)
    agg = {}
    rows = wind = 0
    nl = 0
    with open(tab, 'rb') as f:
        for ln in f:
            nl += 1
            if len(ln) < 340:
                continue
            rows += 1
            lm = ln[sLM]
            try:
                sol = int(lm[:5]); hr = int(lm[6:8])
                lsec = hr * 3600 + int(lm[9:11]) * 60 + float(lm[12:18])
                ts = int(ln[sTS])
            except ValueError:
                continue
            a = agg.get((sol, hr))
            if a is None:
                a = agg[(sol, hr)] = [0, 0, 0.0, 0.0, 0, 0.0, 0, 0.0, -1.0, 0, 0.0, 0]
            a[0] += 1
            a[10] += ts - (lsec - 43200.0) * MARS_SOL_DAYS   # Earth time of LMST 12:00 of this sol
            a[11] += 1
            if float(ln[sW]) != MISS:
                wind += 1
                a[9] += 1
            bt = float(ln[sBT])
            if bt != MISS and ln[sGC].decode('latin1').strip().strip('"')[-3:] == SUFFIX:
                a[1] += 1; a[2] += bt
                u = float(ln[sLU])
                if u != MISS:
                    a[3] += u
            at = float(ln[sAT])
            if at != MISS and ln[sAC][-1:] == b'1':   # last character of the confidence string
                a[4] += 1; a[5] += at
            p = float(ln[sP])
            if p != MISS:
                a[6] += 1; a[7] += p
            uv = float(ln[sUV])
            if uv != MISS and uv > a[8]:
                a[8] = uv
    res = {'file': os.path.basename(tab), 'key': key, 'lines': nl, 'file_records': fr, 'rows': rows, 'wind_rows': wind}
    if nl != fr:
        res['skip'] = 'line count %d != FILE_RECORDS %d' % (nl, fr)
        return res
    res['agg'] = [[s, h] + v for (s, h), v in agg.items()]
    os.makedirs(CACHE, exist_ok=True)
    json.dump(res, open(cp + '.tmp', 'w'), separators=(',', ':'))
    os.replace(cp + '.tmp', cp)
    return res


def r(x, d=2):
    return None if x is None else round(x, d)


def mean(v):
    return sum(v) / len(v) if v else None


def pearson(x, y):
    n = len(x)
    if n < 3:
        return None
    mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x); syy = sum((b - my) ** 2 for b in y)
    sxy = sum((a - mx) * (b - my) for a, b in zip(x, y))
    if sxx == 0 or syy == 0:
        return None
    return sxy / math.sqrt(sxx * syy)


def slope(x, y):
    n = len(x); mx, my = sum(x) / n, sum(y) / n
    sxx = sum((a - mx) ** 2 for a in x)
    return sum((a - mx) * (b - my) for a, b in zip(x, y)) / sxx if sxx else None


def ls_per_sol(hourly_all):
    """sol -> Ls (deg, 2 decimals) at the sol's LMST 12:00, from the MODRDR TIMESTAMP (Mars24 algorithm)."""
    acc = {}
    for (s, h), v in hourly_all.items():
        t = acc.setdefault(s, [0.0, 0])
        t[0] += v[10]; t[1] += v[11]
    return {s: round(ls_from_timestamp(t[0] / t[1]), 2) for s, t in acc.items() if t[1]}


def build_period(pname, lo, hi, hourly_all, files_info, ls_map):
    """hourly_all: {(sol,hr): [rows, gn, gsum, usum, an, asum, pn, psum, uvmax, wind]}"""
    sols = sorted({s for (s, h) in hourly_all if lo <= s <= hi})
    out_rows = []
    per_sol = {}
    wind_rows = 0
    for s in sols:
        g = {}; a = {}; pn = 0; ps = 0.0; uv = -1.0; gn = 0; us = 0.0; nrows = 0
        for h in range(24):
            v = hourly_all.get((s, h))
            if not v:
                continue
            nrows += v[0]; wind_rows += v[9]
            if v[1]:
                g[h] = v[2] / v[1]
            if v[4]:
                a[h] = v[5] / v[4]
            pn += v[6]; ps += v[7]
            gn += v[1]; us += v[3]
            uv = max(uv, v[8])
        per_sol[s] = {'g': g, 'a': a}
        gv = list(g.values())
        tmin = min(gv) if gv else None; tmax = max(gv) if gv else None
        # max neighbouring-hour change
        mr = None
        for h in sorted(g):
            if h + 1 in g:
                d = g[h + 1] - g[h]
                if mr is None or abs(d) > abs(mr[0]):
                    mr = (d, h)
        below = lambda dd, t: sum(1 for x in dd.values() if x < t + K0)
        out_rows.append({
            's': s, 'ls': ls_map.get(s), 'rows': nrows, 'hrs': len(g),
            'tmin': r(tmin), 'tmax': r(tmax), 'rng': r(tmax - tmin) if gv else None,
            'tmean': r(mean(gv)), 'p': r(ps / pn) if pn else None, 'uv': r(uv) if uv >= 0 else None,
            'unc': r(us / gn) if gn else None,
            'dTmax': r(mr[0]) if mr else None, 'dTh': mr[1] if mr else None,
            'g40': below(g, -40), 'g55': below(g, -55), 'a40': below(a, -40), 'a55': below(a, -55),
            'ahrs': len(a), 'amin': r(min(a.values())) if a else None,
        })
    full = [x for x in out_rows if x['hrs'] >= MIN_H]
    rng = [x['rng'] for x in full]
    summ = {
        'n_sols_with_rows': len(sols), 'n_sols_hours_ge_%d' % MIN_H: len(full),
        'rows_total': sum(x['rows'] for x in out_rows),
        'range_mean_K': r(mean(rng), 1) if rng else None, 'range_max_K': r(max(rng), 1) if rng else None,
        'range_min_K': r(min(rng), 1) if rng else None,
        'hourly_mean_T_min_K': r(min(x['tmin'] for x in full), 1) if full else None,
        'hourly_mean_T_max_K': r(max(x['tmax'] for x in full), 1) if full else None,
        'pressure_solmean_range_Pa': [r(min(x['p'] for x in out_rows if x['p'] is not None), 0),
                                      r(max(x['p'] for x in out_rows if x['p'] is not None), 0)],
        'wind_rows': wind_rows,
        'mean_long_term_uncertainty_K': r(mean([x['unc'] for x in out_rows if x['unc'] is not None]), 2),
        'mean_h_below_-40C_gts_full_sols': r(mean([x['g40'] for x in full]), 1) if full else None,
        'mean_h_below_-55C_gts_full_sols': r(mean([x['g55'] for x in full]), 1) if full else None,
    }
    # range distribution (5 K bins) for full sols
    hist = {}
    for v in rng:
        b = int(v // 5) * 5
        hist[b] = hist.get(b, 0) + 1
    dist = [[b, hist[b]] for b in sorted(hist)]
    # diurnal curves by Ls bin (30 deg) from sol-hour means, full sols only
    curves = {}
    for x in full:
        if x['ls'] is None:
            continue
        b = int(x['ls'] // 30) * 30
        c = curves.setdefault(b, {'g': [[0.0, 0] for _ in range(24)], 'a': [[0.0, 0] for _ in range(24)], 'sols': 0})
        c['sols'] += 1
        for h, v in per_sol[x['s']]['g'].items():
            c['g'][h][0] += v; c['g'][h][1] += 1
        for h, v in per_sol[x['s']]['a'].items():
            c['a'][h][0] += v; c['a'][h][1] += 1
    cur_out = {}
    for b in sorted(curves):
        c = curves[b]
        cur_out[str(b)] = {'sols': c['sols'], 'gts': [r(t / n, 1) if n else None for t, n in c['g']],
                           'amb': [r(t / n, 1) if n else None for t, n in c['a']]}
    # mean heating/cooling rate by hour-of-day (K/h), full sols, all seasons
    rate = [[0.0, 0] for _ in range(24)]
    for x in full:
        g = per_sol[x['s']]['g']
        for h in range(24):
            if h in g and (h + 1) in g:
                rate[h][0] += g[h + 1] - g[h]; rate[h][1] += 1
    rate_out = [r(t / n, 1) if n else None for t, n in rate]
    maxrate_hour_hist = {}
    for x in full:
        if x['dTh'] is not None:
            maxrate_hour_hist[x['dTh']] = maxrate_hour_hist.get(x['dTh'], 0) + 1
    return out_rows, summ, dist, cur_out, rate_out, maxrate_hour_hist, per_sol


def r4(hourly_all):
    """RAD valid observations vs REMS pressure (same sol, same LMST hour)."""
    files = sorted(glob.glob(os.path.join(RADCACHE, 'RAD_RDR_*.json')))
    if not files:
        return {'error': 'rad cache missing: run scripts/20_parse_rad.py first'}
    recs = []
    for fp in files:
        c = json.load(open(fp))
        if c.get('skip'):
            continue
        for x in c.get('recs', []):
            if x[7] and 4613 <= x[0] <= 4843:
                recs.append(x)
    pairs = []
    unmatched = 0
    for x in recs:
        v = hourly_all.get((x[0], min(23, x[1] // 3600)))
        if not v or not v[6]:
            unmatched += 1; continue
        pairs.append((x[0], x[1] // 3600, v[7] / v[6], x[4], x[5]))
    out = {'n_rad_valid_obs': len(recs), 'n_matched': len(pairs), 'n_unmatched_no_pressure': unmatched,
           'matching': 'RAD observation start LMST hour == REMS LMST hour; pressure = mean of valid PRESSURE rows (!=-999) in that sol-hour (no confidence filter)'}
    if len(pairs) < 10:
        return out
    P = [p[2] for p in pairs]; B = [p[3] for p in pairs]; E = [p[4] for p in pairs]
    out['obs_level'] = {'n': len(pairs), 'r_E_P': r(pearson(P, E), 3), 'r_B_P': r(pearson(P, B), 3),
                        'slope_E_uGy_h_per_Pa': r(slope(P, E), 5), 'slope_E_pct_per_Pa': r(100 * slope(P, E) / mean(E), 4),
                        'P_range_Pa': [r(min(P), 1), r(max(P), 1)]}
    # sol-hour means
    g = {}
    for s, h, p, b, e in pairs:
        t = g.setdefault((s, h), [p, [], []]); t[1].append(b); t[2].append(e)
    sh = [(k, v[0], mean(v[1]), mean(v[2])) for k, v in g.items()]
    out['solhour_level'] = {'n': len(sh), 'r_E_P': r(pearson([x[1] for x in sh], [x[3] for x in sh]), 3),
                            'r_B_P': r(pearson([x[1] for x in sh], [x[2] for x in sh]), 3)}
    # sol means
    gs = {}
    for s, h, p, b, e in pairs:
        t = gs.setdefault(s, [[], [], []]); t[0].append(p); t[1].append(b); t[2].append(e)
    sm = [(mean(v[0]), mean(v[1]), mean(v[2])) for v in gs.values()]
    out['solmean_level'] = {'n': len(sm), 'r_E_P': r(pearson([x[0] for x in sm], [x[2] for x in sm]), 3),
                            'r_B_P': r(pearson([x[0] for x in sm], [x[1] for x in sm]), 3),
                            'slope_E_pct_per_Pa': r(100 * slope([x[0] for x in sm], [x[2] for x in sm]) / mean([x[2] for x in sm]), 4)}
    # within-sol (diurnal) : subtract sol means -> separates daily tide from seasonal drift
    dp = []; de = []; db = []
    smean = {s: (mean(v[0]), mean(v[1]), mean(v[2])) for s, v in gs.items()}
    for s, h, p, b, e in pairs:
        m = smean[s]; dp.append(p - m[0]); db.append(b - m[1]); de.append(e - m[2])
    out['within_sol_level'] = {'n': len(dp), 'r_E_P': r(pearson(dp, de), 3), 'r_B_P': r(pearson(dp, db), 3),
                               'note': 'sol mean removed from P, E, B: day-to-day / seasonal drift excluded, only within-sol variation remains'}
    # scatter (sol-hour means, rounded) for the web panel
    out['scatter_cols'] = ['sol', 'lmst_hour', 'P_Pa', 'B_uGy_h', 'E_uGy_h']
    out['scatter'] = [[k[0], k[1], r(p, 1), r(b, 2), r(e, 2)] for k, p, b, e in sorted(sh)]
    return out


def main():
    t0 = time.time()
    tabs = sorted(glob.glob(os.path.join(BASE, 'DATA', 'SOL_*', 'SOL*', 'RME_*RMD*.TAB')))
    print('RMD TAB files: %d' % len(tabs))
    os.makedirs(CACHE, exist_ok=True)
    results = []
    with Pool(2) as pool:
        for i, res in enumerate(pool.imap_unordered(parse_file, tabs, chunksize=2)):
            results.append(res)
            if res.get('skip'):
                print('  SKIP', res['file'], res['skip'], flush=True)
            if (i + 1) % 100 == 0:
                print('  ... %d/%d (%.0fs)' % (i + 1, len(tabs), time.time() - t0), flush=True)
    good = [x for x in results if not x.get('skip')]
    skipped = [{'file': x['file'], 'reason': x['skip']} for x in results if x.get('skip')]
    hourly_all = {}
    for x in good:
        for row in x['agg']:
            k = (row[0], row[1]); v = row[2:]
            t = hourly_all.get(k)
            if t is None:
                hourly_all[k] = list(v)
            else:
                for i in (0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11):
                    t[i] += v[i]
                t[8] = max(t[8], v[8])
    ls_map = ls_per_sol(hourly_all)
    os.makedirs(OUTDIR, exist_ok=True)
    allsum = {}
    for pname, (lo, hi) in PERIODS.items():
        files_p = [x for x in good if x['agg'] and lo <= x['agg'][0][0] <= hi]
        rows, summ, dist, curves, rate, mrh, per_sol = build_period(pname, lo, hi, hourly_all, files_p, ls_map)
        summ['files_used'] = len(files_p)
        summ['rows_all_files_in_period'] = sum(x['rows'] for x in files_p)
        summ['wind_rows_all_files'] = sum(x['wind_rows'] for x in files_p)
        meta = {
            'generated_by': 'scripts/21_parse_rems.py',
            'sources': {'data': 'Weather/pds_rems/mslrem_1001/DATA/*/SOL*/RME_*RMD*.TAB (MSL REMS MODRDR, PDS)',
                        'columns': 'Weather/pds_rems/mslrem_1001/LABEL/MODRDR6.FMT', 'ls': 'Mars24 algorithm (Allison and McEwen 2000; https://www.giss.nasa.gov/tools/mars24/help/algorithm.html), '
                              'computed in scripts/ls_mars24.py from the MODRDR TIMESTAMP at LMST 12:00 of each sol'},
            'period_sols': [lo, hi],
            'filters': {'ground_temp': 'GTS_CONFIDENCE_LEVEL ends with "%s" and BRIGHTNESS_TEMP != -999' % SUFFIX,
                        'ambient_temp': 'AMBIENT_TEMP != -999 and last character of AMBIENT_TEMP_CONFIDENCE_LEVEL == "1"',
                        'pressure': 'PRESSURE != -999 (no confidence filter)',
                        'range_stats_only_sols_with_hours_covered_ge': MIN_H,
                        'hour': 'LMST hour of the row; sol taken from LMST field; hourly value = mean of valid rows in that sol-hour'},
            'units': {'T': 'K (hourly means)', 'p': 'Pa', 'uv': 'W/m2 (UV_ABC max of the sol, any row != -999)', 'unc': 'K (BRIGHTNESS_TEMP_LONG_TERM_UNCERTAINTY mean over valid rows)',
                      'dTmax': 'K/h (largest hour-to-hour change in hourly mean GTS; dTh = starting hour)'},
            'sol_row_cols': {'s': 'sol', 'ls': 'areocentric solar longitude (deg) at LMST 12:00 of the sol, Mars24 algorithm', 'rows': 'rows in file', 'hrs': 'LMST hours with valid GTS',
                             'tmin/tmax/rng/tmean': 'min/max/range/mean of hourly mean GTS (K)', 'p': 'mean pressure Pa', 'uv': 'UV_ABC max',
                             'unc': 'mean long-term uncertainty K', 'g40/g55': 'hours with hourly mean GTS < -40C / -55C',
                             'a40/a55': 'same for ambient air temp (hours with valid data: ahrs)', 'amin': 'min hourly mean ambient K'},
            'skipped_files': skipped, 'wind': 'no usable wind in period B (0 rows); do not display',
        }
        out = {'meta': meta, 'summary': summ, 'range_hist_5K': {'bins_start_K': [d[0] for d in dist], 'counts': [d[1] for d in dist]},
               'diurnal_by_ls30': curves, 'mean_rate_K_per_h_by_hour': rate,
               'max_rate_start_hour_hist': {str(k): v for k, v in sorted(mrh.items())}, 'sols': rows}
        allsum[pname] = (rows, summ)
        if pname == 'B':
            out['recent_year_4175_4843'] = recent_year(rows)
            out['r4_rad_pressure'] = r4(hourly_all)
        path = os.path.join(OUTDIR, 'rems_%s.json' % pname)
        with open(path, 'w') as f:
            json.dump(out, f, separators=(',', ':'))
        print('wrote %s %d bytes' % (path, os.path.getsize(path)))
        print(pname, json.dumps(summ))
        if pname == 'B':
            print('recent year', json.dumps(out['recent_year_4175_4843']))
            rr = out['r4_rad_pressure']
            print('R4', json.dumps({k: v for k, v in rr.items() if k != 'scatter'}))
    print('done %.0fs' % (time.time() - t0))


def recent_year(rows):
    sub = [x for x in rows if RECENT_YEAR[0] <= x['s'] <= RECENT_YEAR[1]]
    full = [x for x in sub if x['hrs'] >= MIN_H]
    rng = [x['rng'] for x in full]
    return {'n_sols_with_rows': len(sub), 'n_sols_full': len(full), 'range_mean_K': r(mean(rng), 1), 'range_max_K': r(max(rng), 1),
            'range_min_K': r(min(rng), 1), 'hourly_mean_T_min_K': r(min(x['tmin'] for x in full), 1),
            'hourly_mean_T_max_K': r(max(x['tmax'] for x in full), 1)}


if __name__ == '__main__':
    main()
