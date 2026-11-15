#!/usr/bin/env python3
"""Site facts (Plan/18 sec.2-1, Plan/21 W2): every number the home, method and electronics pages show.

  python3 -I scripts/61_site_facts.py            writes site/data/site_facts.json and work/site/site_facts_audit.json

For each fact the script
  1. reads the value from the JSON field the site already uses (source file + field are recorded),
  2. recomputes it independently, where possible from raw arrays (per-sol tables, 2 m route samples,
     CSV point lists) or from a second file (scripts/config.json vs site/data/config.json, the rendered map
     panel in work/stage5/browser_check.json), and requires the two to agree at display precision,
  3. compares it with the number written in Plan/18 sec.2-2 / 2-3 / 2-4.
A Plan/18 difference that a later result document explains (Plan/19, Plan/20, this step) is listed as a known
change. Any other difference is NOT resolved here: the fact goes to "pending" (pages cannot show it), it is
printed, and the script exits with code 3 so the difference is reported instead of silently picking a value.
Exit 1 = a recomputation disagrees. Standard library only. Rounding mirrors site/src/format.js
(half away from zero, thousands separator ",", minus sign U+2212 for display).
"""
import csv
import json
import math
import os
import re
import statistics as stats
import sys
from datetime import datetime, timezone

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, 'scripts'))
from ls_mars24 import ls_from_utc  # noqa: E402

D = os.path.join(ROOT, 'site', 'data')
OUT = os.path.join(D, 'site_facts.json')
AUDIT = os.path.join(ROOT, 'work', 'site', 'site_facts_audit.json')


def J(*p):
    return json.load(open(os.path.join(ROOT, *p), encoding='utf-8'))


routes, rad, config = J('site/data/routes.json'), J('site/data/rad.json'), J('site/data/config.json')
remsB, layers = J('site/data/rems_B.json'), J('site/data/layers.json')
cfg_src = J('scripts/config.json')
browser = J('work/stage5/browser_check.json')
shown = browser['checks']  # text of the map page's [data-check] elements (rendered in headless Chrome by 58)

EARTH_YEAR_H = 8766.0  # 365.25 d x 24 h, as rad.json periods.*.conversion.note


def fmt(x, d=0):
    m = 10 ** d
    r = math.copysign(math.floor(abs(x) * m + 0.5 + 1e-9) / m, x)
    s = '{:,.{d}f}'.format(abs(r), d=d)
    return ('−' if r < 0 else '') + s


def dur(sec):
    m = int(math.floor(sec / 60 + 0.5))
    h, mm = divmod(m, 60)
    return '%d h %02d min' % (h, mm) if h else '%d min' % mm


def get(doc, path):
    o = doc
    for part in path.split('.'):
        o = o[int(part)] if isinstance(o, list) else o[part]
    return o


facts, audit, fails, pending, known = {}, [], [], {}, []


def fact(key, value, text, unit, src, field, recomputed, how, plan18=None, section=None, known_change=None,
         pages=('home',), same=None):
    """value: number (or string) read from src/field. text: display without unit. recomputed: independent value
    (None = no second source; listed in the audit). same(a, b) decides agreement (default: equal display text)."""
    if recomputed is None:
        agree = None
    elif same:
        agree = bool(same(value, recomputed))
    elif isinstance(value, str):
        agree = value == recomputed
    else:
        agree = text == fmt_like(text, recomputed)  # equal at display precision
    t = text + (unit if unit == '\u00b0' else ('\u00a0' + unit) if unit else '')  # 17.4°, but 2.5 km/h and −40 °C
    rec = {'key': key, 'value': value, 'text': t, 'src': src, 'field': field, 'recomputed': recomputed, 'how': how, 'agree': agree,
           'plan18': plan18, 'plan18_section': section, 'pages': list(pages)}
    if agree is False:
        fails.append(rec)
    p18_ok = None
    if plan18 is not None:
        p18_ok = plan18_equal(plan18, text)
        rec['plan18_equal'] = p18_ok
        if not p18_ok:
            if known_change:
                rec['known_change'] = known_change
                known.append(rec)
            else:
                pending[key] = {'plan18': plan18, 'data': t, 'src': src, 'field': field, 'section': section}
    audit.append(rec)
    if key not in pending:
        f = {'v': value, 'n': text, 'u': unit or '', 't': t, 'src': src + '#' + field}
        facts[key] = f


def fmt_like(text, x):
    """Format x with the same number of decimals as text (for recompute comparisons)."""
    body = text.replace('−', '-').replace('+', '').replace(',', '')
    d = len(body.split('.')[1]) if '.' in body else 0
    s = fmt(x, d)
    return ('+' + s) if text.startswith('+') and not s.startswith('−') else s


def plan18_equal(plan, text):
    """Plan/18 writes numbers with fewer decimals sometimes ("28m" for 28.0): equal if the plan value equals the
    data value rounded to the plan's decimals."""
    pn = plan.replace('−', '-').replace(',', '').replace('+', '')
    tn = text.replace('−', '-').replace(',', '').replace('+', '')
    try:
        pv, tv = float(pn), float(tn)
    except ValueError:
        return plan == text
    d = len(pn.split('.')[1]) if '.' in pn else 0
    return fmt(tv, d).replace('−', '-').replace(',', '') == fmt(pv, d).replace('−', '-').replace(',', '')


def tol(t):
    return lambda a, b: abs(a - b) <= t


# =========================================================== layers (home "what it does")
own_ids = [l['id'] for l in layers['layers']]
ext_ids = [l['id'] for l in layers['external']]
tile_dirs = sorted(x for x in os.listdir(os.path.join(ROOT, 'site', 'tiles')) if os.path.isdir(os.path.join(ROOT, 'site', 'tiles', x)))
fact('layers_own_tiles', len(own_ids), fmt(len(own_ids)), '', 'layers.json', 'layers (count)',
     len(set(tile_dirs) & set(own_ids)), 'tile folders under site/tiles/ with a layers.json id', plan18='11', section='2-2')
fact('layers_external', len(ext_ids), fmt(len(ext_ids)), '', 'layers.json', 'external (count)',
     sum(1 for l in layers['external'] if '://' in json.dumps(l)), 'external entries with a remote tile URL', plan18='2', section='2-2')
vec_rendered = [i for i in browser['layer_ids'] if i not in own_ids and i not in ext_ids]
vsrc = open(os.path.join(ROOT, 'site', 'src', 'vectors.js'), encoding='utf-8').read()
vec_src = len(re.findall(r"\bid: '[A-Za-z0-9]+',", vsrc)) + (len(routes['routes']) if "id: 'P1' + rid" in vsrc else 0)
fact('layers_vector', len(vec_rendered), fmt(len(vec_rendered)), '', '../work/stage5/browser_check.json',
     'layer_ids minus layers.json ids (rendered map layer list)', vec_src,
     "id: entries in site/src/vectors.js ('P1' + rid counted once per route)", plan18='14', section='2-2')  # lead decision 2026-11-15: count rendered layers (Plan/18 addendum)

# =========================================================== route B (home key numbers)
RB, RA = routes['routes']['B'], routes['routes']['A']
SB = RB['samples']
dB, eB, slB, visB = SB['d_m'], SB['elev_m'], SB['slope_deg'], SB['vis']
fact('routeB_one_way_m', RB['summary']['dist_m'], fmt(RB['summary']['dist_m'], 1), 'm', 'routes.json', 'routes.B.summary.dist_m',
     dB[-1], 'last 2 m sample distance', plan18='1,824.5', section='2-2')
fact('routeB_round_trip_m', RB['summary']['round_trip_m'], fmt(RB['summary']['round_trip_m'], 1), 'm', 'routes.json', 'routes.B.summary.round_trip_m',
     2 * dB[-1], '2 x last sample distance', same=tol(0.15), pages=('home', 'about'))
climb = sum(max(0.0, eB[i + 1] - eB[i]) for i in range(len(eB) - 1))
fact('routeB_climb_m', RB['summary']['climb_m'], '+' + fmt(RB['summary']['climb_m'], 1), 'm', 'routes.json', 'routes.B.summary.climb_m',
     climb, 'sum of rising 2 m sample steps (samples stored at 0.1 m: tolerance 0.5 m, Plan/12 3-3)', plan18='+158.6', section='2-2', same=tol(0.5))
evas = RB['summary']['round_trip_with_stay_s']
fact('routeB_eva_total', evas, dur(evas), '', 'routes.json', 'routes.B.summary.round_trip_with_stay_s',
     2 * SB['t_out_s'][-1] + RB['summary']['dest_stay_s'], '2 x outbound time of the last sample + dest_stay_s, same minute',
     plan18='2 h 34 min', section='2-2', same=lambda a, b: dur(a) == dur(b))
haz_n, haz_m, run = 0, 0.0, False
for i in range(len(dB) - 1):
    if max(slB[i], slB[i + 1]) >= 15:
        haz_m += dB[i + 1] - dB[i]
        haz_n += 0 if run else 1
        run = True
    else:
        run = False
fact('routeB_hazards_15_n', RB['summary']['n_hazards_15'], fmt(RB['summary']['n_hazards_15']), '', 'routes.json', 'routes.B.summary.n_hazards_15',
     haz_n, 'runs of 2 m segments whose larger end slope (5 m grid) is >= 15 deg', plan18='3', section='2-2')
fact('routeB_hazards_15_m', RB['summary']['len_over15_m'], fmt(RB['summary']['len_over15_m'], 1), 'm', 'routes.json', 'routes.B.summary.len_over15_m',
     haz_m, 'length of those segments', plan18='28', section='2-2')
comms = sum(dB[i + 1] - dB[i] for i in range(len(dB) - 1) if not (visB[i] and visB[i + 1]))
fact('routeB_comms_out_m', RB['summary']['comms_out_m'], fmt(RB['summary']['comms_out_m'], 1), 'm', 'routes.json', 'routes.B.summary.comms_out_m',
     comms, '2 m segments with either end out of line of sight (vis 0)', plan18='856', section='2-2')
fact('routeB_max_slope_deg', RB['summary']['max_slope_deg'], fmt(RB['summary']['max_slope_deg'], 1), '°', 'routes.json', 'routes.B.summary.max_slope_deg',
     max(slB), 'max of samples.slope_deg (5 m grid)', pages=('about',))
tilt = max(RB['rover_tilt'], key=lambda r: r[1])
fact('routeB_max_tilt_deg', RB['summary']['rover_tilt']['max'], fmt(RB['summary']['rover_tilt']['max'], 1), '°', 'routes.json', 'routes.B.summary.rover_tilt.max',
     tilt[1], 'max of routes.B.rover_tilt[] (recorded rover tilt within 5 m of the route)', pages=('about',))
fact('routeB_max_tilt_sol', tilt[2], str(tilt[2]), '', 'routes.json', 'routes.B.rover_tilt[argmax tilt][2]',
     int(shown['route.B.hz4.tilt'].split('sol ')[1].split(',')[0].split(')')[0]) if 'sol ' in shown.get('route.B.hz4.tilt', '') else None,
     'sol in the map panel hazard row 4 (browser_check route.B.hz4.tilt)', pages=('about',), same=lambda a, b: a == b)

# =========================================================== radiation
PR, PE = rad['periods']['recent'], rad['periods']['early']


def wmean(P, col):
    c = P['sol_table_cols']
    i, n = c.index(col), c.index('n_valid')
    rows = [r for r in P['sol_table'] if r[n] and r[i] is not None]
    return sum(r[i] * r[n] for r in rows) / sum(r[n] for r in rows)


Bm_rec = wmean(PR, 'B_mean_uGy_h')
fact('rad_recent_B_mean', PR['B_mean'], fmt(PR['B_mean'], 3), 'µGy/h', 'rad.json', 'periods.recent.B_mean',
     Bm_rec, 'n_valid-weighted mean of the per-sol table (sol means stored to 3 decimals: tolerance 0.002)', plan18='6.898', section='2-2', same=tol(0.002),
     pages=('home', 'electronics'))
fact('rad_recent_E_mean', PR['E_mean'], fmt(PR['E_mean'], 3), 'µGy/h', 'rad.json', 'periods.recent.E_mean',
     wmean(PR, 'E_mean_uGy_h'), 'same, E column', same=tol(0.002), pages=('electronics',))
sr = [r[0] for r in PR['sol_table']]
fact('rad_recent_sols', '%d–%d' % tuple(PR['sol_range_in_data']), '%d–%d' % tuple(PR['sol_range_in_data']), '', 'rad.json', 'periods.recent.sol_range_in_data',
     '%d–%d' % (min(sr), max(sr)), 'first and last sol of the per-sol table', plan18='4613–4843', section='2-2', pages=('home', 'electronics'))
fact('rad_recent_n_valid', PR['n_valid'], fmt(PR['n_valid']), '', 'rad.json', 'periods.recent.n_valid',
     sum(r[2] for r in PR['sol_table']), 'sum of per-sol n_valid', pages=('about', 'electronics'))
fact('rad_recent_n_sols', PR['n_sols'], fmt(PR['n_sols']), '', 'rad.json', 'periods.recent.n_sols',
     sum(1 for r in PR['sol_table'] if r[2] > 0), 'per-sol rows with n_valid > 0', pages=('about', 'electronics'))
yr = PR['B_mean'] * EARTH_YEAR_H / 1000
fact('rad_recent_B_year_mGy', yr, fmt(yr, 1), 'mGy', 'rad.json', 'periods.recent.B_mean x 8,766 h',
     PR['conversion']['equipment_earth_year_mGy_Si'], 'periods.recent.conversion.equipment_earth_year_mGy_Si (2 decimals) and the map panel route.B.B_year_mGy',
     plan18='60.5', section='2-2', same=lambda a, b: fmt(b, 1) == fmt(a, 1) == shown['route.B.B_year_mGy'], pages=('home', 'electronics'))
fact('rad_recent_B_year_rad', yr / 10, fmt(yr / 10, 2), 'rad', 'rad.json', 'periods.recent.B_mean x 8,766 h / 10',
     PR['conversion']['equipment_earth_year_rad_Si'], 'periods.recent.conversion.equipment_earth_year_rad_Si', plan18='6.05', section='2-4',
     pages=('electronics',))
yrA = PE['B_mean'] * EARTH_YEAR_H / 1000
fact('rad_early_B_year_mGy', yrA, fmt(yrA, 1), 'mGy', 'rad.json', 'periods.early.B_mean x 8,766 h',
     wmean(PE, 'B_mean_uGy_h') * EARTH_YEAR_H / 1000, 'per-sol weighted mean x 8,766 h; also equals the map panel route.A.B_year_mGy',
     plan18='79.1', section='2-4', same=lambda a, b: fmt(a, 1) == fmt(b, 1) == shown['route.A.B_year_mGy'], pages=('electronics',))
fact('rad_early_sols', '%d–%d' % tuple(PE['sol_range_in_data']), '%d–%d' % tuple(PE['sol_range_in_data']), '', 'rad.json', 'periods.early.sol_range_in_data',
     '%d–%d' % (PE['sol_table'][0][0], PE['sol_table'][-1][0]), 'first and last sol of the per-sol table', plan18='1–359', section='2-4',
     pages=('electronics',))
# --- W5 (method page): the two RAD periods and how far apart they were measured (Plan/19 P1-3 sentence)
fact('rad_early_B_mean', PE['B_mean'], fmt(PE['B_mean'], 3), 'µGy/h', 'rad.json', 'periods.early.B_mean',
     wmean(PE, 'B_mean_uGy_h'), 'n_valid-weighted mean of the per-sol table', pages=('about',))
fact('rad_early_n_valid', PE['n_valid'], fmt(PE['n_valid']), '', 'rad.json', 'periods.early.n_valid',
     sum(r[2] for r in PE['sol_table']), 'sum of per-sol n_valid', pages=('about',))
fact('rad_early_n_sols', PE['n_sols'], fmt(PE['n_sols']), '', 'rad.json', 'periods.early.n_sols',
     sum(1 for r in PE['sol_table'] if r[2] > 0), 'per-sol rows with n_valid > 0', pages=('about',))
LAND = datetime(2012, 8, 6, 5, 18)  # MSL landing UTC; one sol = 1.0274912517 days


def sol_year(sol):
    from datetime import timedelta
    return (LAND + timedelta(days=sol * 1.0274912517)).year


def years(P):
    a, b = (int(P['sol_table'][i][1].split('-')[0]) for i in (0, -1))
    return a, b


ya, yr_ = years(PE), years(PR)
for key, (a, b), P in (('rad_early_years', ya, PE), ('rad_recent_years', yr_, PR)):
    s0, s1 = P['sol_table'][0][0], P['sol_table'][-1][0]
    txt = '%d–%d' % (a, b) if a != b else '%d' % a
    fact(key, txt, txt, '', 'rad.json', 'year of periods.%s.sol_table[0] and [-1] (utc_year_doy)' % ('early' if P is PE else 'recent'),
         '%d–%d' % (sol_year(s0), sol_year(s1)) if sol_year(s0) != sol_year(s1) else '%d' % sol_year(s0),
         'calendar year of landing (2012-08-06 05:18 UTC) + sol x 1.0274912517 d for the first and last sol', pages=('about',))
fact('rad_epoch_gap_years', yr_[0] - ya[0], fmt(yr_[0] - ya[0]), 'years', 'rad.json', 'first year of the recent period minus first year of the early period',
     sol_year(PR['sol_table'][0][0]) - sol_year(PE['sol_table'][0][0]), 'same difference from the sol-to-date rule', pages=('about',))

hB = evas / 3600
fact('routeB_dose_B', PR['B_mean'] * hB, fmt(PR['B_mean'] * hB, 1), 'µGy', 'rad.json + routes.json', 'periods.recent.B_mean x routes.B.summary.round_trip_with_stay_s',
     Bm_rec * hB, 'per-sol weighted mean x EVA hours; also equals the map panel route.B.dose_B', plan18='17.7', section='2-4',
     same=lambda a, b: fmt(a, 1) == fmt(b, 1) == shown['route.B.dose_B'], pages=('electronics',))
fact('routeB_dose_E', PR['E_mean'] * hB, fmt(PR['E_mean'] * hB, 1), 'µGy', 'rad.json + routes.json', 'periods.recent.E_mean x routes.B.summary.round_trip_with_stay_s',
     wmean(PR, 'E_mean_uGy_h') * hB, 'per-sol weighted mean x EVA hours; also equals the map panel route.B.dose_E',
     same=lambda a, b: fmt(a, 1) == fmt(b, 1) == shown['route.B.dose_E'], pages=('electronics',))
SP = PR['spikes'][0]
c = PR['sol_table_cols']
row4716 = next(r for r in PR['sol_table'] if r[0] == SP['sol'])
fact('spike_sol', SP['sol'], str(SP['sol']), '', 'rad.json', 'periods.recent.spikes[0].sol',
     max(PR['sol_table'], key=lambda r: r[c.index('E_mean_uGy_h')] or 0)[0], 'sol with the highest E sol mean in the per-sol table',
     plan18='4716', section='2-2', pages=('home', 'electronics'), same=lambda a, b: a == b)
ser = SP['series']
fact('spike_E_max', SP['E_obs_max'], fmt(SP['E_obs_max'], 2), 'µGy/h', 'rad.json', 'periods.recent.spikes[0].E_obs_max',
     max(x[2] for x in ser), 'max E of spikes[0].series (observation level)', plan18='11.95', section='2-2', pages=('home', 'electronics'))
fact('spike_E_solmean', SP['E_solmean'], fmt(SP['E_solmean'], 2), 'µGy/h', 'rad.json', 'periods.recent.spikes[0].E_solmean',
     row4716[c.index('E_mean_uGy_h')], 'E of sol 4716 in the per-sol table', plan18='7.86', section='2-4', pages=('electronics',))
# rise time: onset = first observation above the night baseline (LMST < 6 h) mean + 3 SD; peak = E max
base = [x[2] for x in ser if x[0] < 6]
thr = stats.mean(base) + 3 * stats.pstdev(base)
onset = next(x[0] for x in ser if x[0] >= 6 and x[2] > thr)
peak = max(ser, key=lambda x: x[2])[0]
fact('spike_rise_h', peak - onset, fmt(peak - onset, 0), 'h', 'rad.json', 'periods.recent.spikes[0].series (onset -> peak)',
     None, 'one rule only: onset = first obs after 06:00 above night mean + 3 SD (%.2f uGy/h) at LMST %.2f h, peak at %.2f h' % (thr, onset, peak),
     plan18='7', section='2-4', pages=('electronics',))
LET = PR['let']
dens1 = [cnt / w for cnt, w in zip(LET['A1_counts_sum'], LET['width_keV_um'])]
dens2 = [cnt / w for cnt, w in zip(LET['A2_counts_sum'], LET['width_keV_um'])]
i1 = max(range(len(dens1)), key=dens1.__getitem__)
i_raw = max(range(len(dens1)), key=LET['A1_counts_sum'].__getitem__)
i2 = max(range(len(dens2)), key=dens2.__getitem__)
fact('let_peak_keV_um', LET['centre_keV_um'][i1], fmt(LET['centre_keV_um'][i1], 3), 'keV/µm', 'rad.json', 'periods.recent.let.centre_keV_um[argmax A1 counts / width]',
     LET['centre_keV_um'][i_raw] if i_raw == i2 else None, 'argmax of raw A1 counts and of A2 density give the same bin',
     plan18='0.283', section='2-4', pages=('electronics',))
fact('let_recent_bins', LET['n_bins'], fmt(LET['n_bins']), '', 'rad.json', 'periods.recent.let.n_bins',
     len(LET['centre_keV_um']), 'length of the bin-centre array', pages=('electronics',))

# =========================================================== ground temperature (REMS, route B site)
S = remsB['sols']
full = [x for x in S if x['hrs'] >= remsB['meta']['filters']['range_stats_only_sols_with_hours_covered_ge']]
RY = remsB['recent_year_4175_4843']
ry = [x for x in full if 4175 <= x['s'] <= 4843]
fact('gts_recent_range_mean', RY['range_mean_K'], fmt(RY['range_mean_K'], 1), 'K', 'rems_B.json', 'recent_year_4175_4843.range_mean_K',
     stats.mean(x['rng'] for x in ry), 'mean of sols[].rng, sols 4175-4843 with >= 20 h', plan18='83.1', section='2-2', pages=('home', 'electronics'))
fact('gts_recent_range_max', RY['range_max_K'], fmt(RY['range_max_K'], 1), 'K', 'rems_B.json', 'recent_year_4175_4843.range_max_K',
     max(x['rng'] for x in ry), 'max of the same', plan18='111.0', section='2-2', pages=('home', 'electronics'))
fact('gts_recent_range_min', RY['range_min_K'], fmt(RY['range_min_K'], 1), 'K', 'rems_B.json', 'recent_year_4175_4843.range_min_K',
     min(x['rng'] for x in ry), 'min of the same', plan18='59.8', section='2-4', pages=('electronics',))
fact('gts_recent_n_full', RY['n_sols_full'], fmt(RY['n_sols_full']), '', 'rems_B.json', 'recent_year_4175_4843.n_sols_full',
     len(ry), 'count of the same sols', plan18='561', section='2-2', pages=('home', 'electronics'))
fact('mars_year_sols', RY['n_sols_with_rows'], fmt(RY['n_sols_with_rows']), '', 'rems_B.json', 'recent_year_4175_4843.n_sols_with_rows',
     4843 - 4175 + 1, 'sols 4175-4843 inclusive (one Mars year = one thermal cycle per sol)', plan18='669', section='2-4', pages=('electronics',))
rate = remsB['mean_rate_K_per_h_by_hour']
hh = max((r, h) for h, r in enumerate(rate) if r is not None)
hc = min((r, h) for h, r in enumerate(rate) if r is not None)
fact('gts_heat_rate_max', hh[0], '+' + fmt(hh[0], 1), 'K/h', 'rems_B.json', 'max(mean_rate_K_per_h_by_hour)',
     None, 'no second source: hourly rows are not in site/data', plan18='+17.4', section='2-4', pages=('electronics',))
fact('gts_heat_rate_hour', hh[1], '%02d:00' % hh[1], '', 'rems_B.json', 'argmax(mean_rate_K_per_h_by_hour) (start hour LMST)',
     None, 'no second source', plan18='08:00', section='2-4', pages=('electronics',))
fact('gts_cool_rate_max', hc[0], fmt(hc[0], 1), 'K/h', 'rems_B.json', 'min(mean_rate_K_per_h_by_hour)',
     None, 'no second source', plan18='−14', section='2-4', pages=('electronics',))
fact('gts_cool_rate_hour', hc[1], '%02d:00' % hc[1], '', 'rems_B.json', 'argmin(mean_rate_K_per_h_by_hour) (start hour LMST)',
     None, 'no second source; Plan/18 writes "16-17 h": hour 16 is %.1f K/h, hour 17 is %.1f K/h' % (rate[16], rate[17]), pages=('electronics',))
fact('gts_h_below_m40', remsB['summary']['mean_h_below_-40C_gts_full_sols'], fmt(remsB['summary']['mean_h_below_-40C_gts_full_sols'], 1), 'h',
     'rems_B.json', 'summary.mean_h_below_-40C_gts_full_sols', stats.mean(x['g40'] for x in full), 'mean of sols[].g40 over sols with >= 20 h',
     plan18='14.3', section='2-4', pages=('electronics',))
fact('gts_h_below_m55', remsB['summary']['mean_h_below_-55C_gts_full_sols'], fmt(remsB['summary']['mean_h_below_-55C_gts_full_sols'], 1), 'h',
     'rems_B.json', 'summary.mean_h_below_-55C_gts_full_sols', stats.mean(x['g55'] for x in full), 'mean of sols[].g55 over sols with >= 20 h',
     plan18='12.0', section='2-4', pages=('electronics',))
fact('rems_B_sols', '%d–%d' % tuple(remsB['meta']['period_sols']), '%d–%d' % tuple(remsB['meta']['period_sols']), '', 'rems_B.json', 'meta.period_sols',
     '%d–%d' % (S[0]['s'], S[-1]['s']), 'first and last sol of sols[]', plan18='4134–4843', section='2-4', pages=('electronics',))
fact('gts_unc_mean', remsB['summary']['mean_long_term_uncertainty_K'], fmt(remsB['summary']['mean_long_term_uncertainty_K'], 2), 'K',
     'rems_B.json', 'summary.mean_long_term_uncertainty_K', stats.mean(x['unc'] for x in S if x.get('unc') is not None), 'mean of sols[].unc (all sols)',
     plan18='9.07', section='2-4', pages=('electronics',))
fact('rems_ls_method', remsB['meta']['sources']['ls'], 'Mars24 (Allison & McEwen 2000)', '', 'rems_B.json', 'meta.sources.ls',
     'Mars24' if 'Mars24' in remsB['meta']['sources']['ls'] and 'Allison' in J('site/data/rems_A.json')['meta']['sources']['ls'] else None,
     'rems_A.json meta.sources.ls names the same method', pages=('about',), same=lambda a, b: b == 'Mars24' and 'Allison and McEwen 2000' in a)
ls_land = ls_from_utc(datetime(2012, 8, 6, 5, 18, tzinfo=timezone.utc))
fact('ls_landing_deg', ls_land, fmt(ls_land, 1), '°', 'scripts/ls_mars24.py', 'ls_from_utc(2012-08-06 05:18 UTC), MSL landing',
     150.7, 'published value (Washington Univ. Analyst\'s Notebook; HiRISE ESP_028256_9022: "Solar longitude 150.7"), Plan/20 P2-9',
     same=lambda a, b: fmt(a, 1) == fmt(b, 1), pages=('about',))

# =========================================================== assumptions (method page): site/data/config.json vs scripts/config.json
for key, path, d, unit, p18 in (
        ('walk_speed_kmh', 'walk.flat_speed_kmh', 1, 'km/h', '2.5'), ('slope_caution_deg', 'walk.slope_caution_deg', 0, '°', '15'),
        ('slope_danger_deg', 'walk.slope_danger_deg', 0, '°', '25'), ('eva_max_h', 'eva.max_duration_h', 0, 'h', '6'),
        ('eva_reserve_min', 'eva.reserve_min', 0, 'min', '30'), ('eva_daylight_end_h', 'eva.daylight_end_lmst_h', 1, 'h LMST', '17.5'),
        ('eva_min_ground_C', 'eva.min_ground_temp_C', 0, '°C', '-40'), ('eva_dose_budget_uGy', 'eva.dose_budget_uGy_E', 0, 'µGy', '50'),
        ('antenna_m', 'comms.antenna_height_m', 0, 'm', '2'), ('eva_stay_min', 'eva.dest_stay_min', 0, 'min', None)):
    v = get(config, path)
    fact(key, v, fmt(v, d), unit, 'config.json', path, get(cfg_src, path), 'scripts/config.json (the source 50_export_config.py copies)',
         plan18=p18, section='2-3' if p18 else None, pages=('about',))
fact('rad_min_obs_s', rad['meta']['filter']['min_obs_duration_s'], fmt(rad['meta']['filter']['min_obs_duration_s']), 's', 'rad.json', 'meta.filter.min_obs_duration_s',
     config['rad']['min_obs_duration_s'], 'config.json rad.min_obs_duration_s', plan18='600', section='2-3', pages=('about',))
fact('rad_qc_required', rad['meta']['filter']['qc_required'], rad['meta']['filter']['qc_required'], '', 'rad.json', 'meta.filter.qc_required',
     config['rad']['qc_required'], 'config.json rad.qc_required', pages=('about',))
fact('rems_gts_conf', config['rems']['gts_confidence_suffix'], config['rems']['gts_confidence_suffix'], '', 'config.json', 'rems.gts_confidence_suffix',
     cfg_src['rems']['gts_confidence_suffix'], 'scripts/config.json', plan18='111', section='2-3', pages=('about',))

# =========================================================== validation (method page): stored results vs their raw point lists
AL = J('work/checks/alignment_results.json')
dw = [float(r['diff']) for r in csv.DictReader(open(os.path.join(ROOT, 'work', 'checks', 'dem_waypoints_diff.csv'))) if int(r['sol']) <= 400]
fact('dem_wp_mean_diff_m', AL['dem_waypoints']['sol_le_400']['mean_diff_m'], fmt(AL['dem_waypoints']['sol_le_400']['mean_diff_m'], 2), 'm',
     '../work/checks/alignment_results.json', 'dem_waypoints.sol_le_400.mean_diff_m', stats.mean(dw), 'mean of diff in work/checks/dem_waypoints_diff.csv, sol <= 400',
     plan18='-1.32', section='2-3', pages=('about',))
fact('dem_wp_n', AL['dem_waypoints']['sol_le_400']['n'], fmt(AL['dem_waypoints']['sol_le_400']['n']), '', '../work/checks/alignment_results.json',
     'dem_waypoints.sol_le_400.n', len(dw), 'rows of the same CSV with sol <= 400', plan18='94', section='2-3', pages=('about',))
sc = list(csv.DictReader(open(os.path.join(ROOT, 'work', 'stage3', 'slope_check.csv'))))
a5, tl = [float(r['slope5m']) for r in sc], [float(r['tilt']) for r in sc]
ma, mt = stats.mean(a5), stats.mean(tl)
r5 = sum((p - ma) * (q - mt) for p, q in zip(a5, tl)) / math.sqrt(sum((p - ma) ** 2 for p in a5) * sum((q - mt) ** 2 for q in tl))
SC = J('work/stage3/slope_check.json')['slope_5m']['all']
fact('slope5_tilt_median_diff', SC['median_signed'], fmt(SC['median_signed'], 2), '°', '../work/stage3/slope_check.json', 'slope_5m.all.median_signed',
     stats.median(p - q for p, q in zip(a5, tl)), 'median of slope5m - tilt in work/stage3/slope_check.csv', plan18='-0.81', section='2-3', pages=('about',))
fact('slope5_tilt_r', SC['r'], fmt(SC['r'], 2), '', '../work/stage3/slope_check.json', 'slope_5m.all.r', r5, 'Pearson r of the same CSV columns',
     plan18='0.78', section='2-3', pages=('about',))
VR = J('work/stage3/verify_results.json')
shifts = [math.hypot(*e['shift_px']) for k, L in VR.items() if k != 'trek_address_check' for e in L]
fact('tile_shift_max_px', max(shifts), fmt(max(shifts), 2), 'px', '../work/stage3/verify_results.json', 'max |shift_px| over the 33 sample tiles',
     None if not all(e['pass_1px'] for k, L in VR.items() if k != 'trek_address_check' for e in L) else max(shifts),
     'same list; all 33 pass_1px flags true', plan18='0.13', section='2-3', pages=('about',))
fact('ctx5_offset_max_m', AL['ctx_field']['max_m'], fmt(AL['ctx_field']['max_m'], 0), 'm', '../work/checks/alignment_results.json', 'ctx_field.max_m',
     None, 'no second source in a JSON: work/checks/ctx_offset_field.csv has east offsets -1,648 to +1,744 m over all 225 points incl. unreliable ones',
     plan18='1,550', section='2-3', pages=('about',))  # lead decision 2026-11-15: reliable points only (Plan/18 addendum)
fact('ctx5_offset_landing_m', AL['ctx_dem']['landing']['B1_ctx_5m']['offset_total_m'], fmt(AL['ctx_dem']['landing']['B1_ctx_5m']['offset_total_m'], 0), 'm',
     '../work/checks/alignment_results.json', 'ctx_dem.landing.B1_ctx_5m.offset_total_m',
     math.hypot(AL['ctx_dem']['landing']['B1_ctx_5m']['offset_east_m'], AL['ctx_dem']['landing']['B1_ctx_5m']['offset_north_m']),
     'hypot of the east and north offsets', pages=('about',), same=tol(0.1))

# =========================================================== checks passed (home "can you trust it")
def passed(lst, k='pass'):
    return sum(1 for x in lst if x[k]), len(lst)


chk = {
    'checks_panel': (J('work/stage5/panel_check.json')['rows'], 'ok', '../work/stage5/panel_check.json', 'rows[].ok (59_check_panels.py)', '123/123',
                     'Plan/19: + en_only.index_lang_ko (124); Plan/21 W1: + 5 site rows'),
    'checks_eva': (J('work/stage5/eva_check.json')['checks'], 'pass', '../work/stage5/eva_check.json', 'checks[].pass (57_eva_browser_check.mjs)', None, None),
    'checks_cuff': (J('work/stage5/cuff_check.json')['checks'], 'pass', '../work/stage5/cuff_check.json', 'checks[].pass (56_cuff_check.mjs)', '75/75',
                    'Plan/19: Korean combos removed (51); Plan/21 W1: + Home link check'),
    'checks_offline': (J('work/stage5/offline_check.json')['checks'], 'pass', '../work/stage5/offline_check.json', 'checks[].pass (54_offline_check.mjs)', '64/64',
                       'Plan/19: Korean page removed (53); Plan/21 W1: + home page and redirect, root and sub-path'),
    'checks_route': (J('work/stage4/validate.json')['checks'], 'ok', '../work/stage4/validate.json', 'checks[].ok (44_route_validate.py)', '34/34', None),
}
for key, (lst, k, src, field, p18, why) in chk.items():
    p, n = passed(lst, k)
    fact(key, p, '%d/%d' % (p, n), '', src, field, sum(1 for x in lst if x.get(k) is True), 'count of entries whose flag is exactly true',
         plan18=p18, section='2-2' if p18 else None, known_change=why, same=lambda a, b: a == b)
st = J('work/stage5/eva_check.json')['selftest']
fact('checks_selftest', st['nPass'], '%d/%d' % (st['nPass'], st['n']), '', '../work/stage5/eva_check.json', 'selftest.nPass / selftest.n (eva.html?selftest=1)',
     sum(1 for x in st['cases'] if x['pass']), 'passing entries of selftest.cases', plan18='77/77', section='2-2', same=lambda a, b: a == b)

# =========================================================== output
gen = {
    '_comment': 'Generated by scripts/61_site_facts.py (do not edit). Every number the site pages show. n = number as shown, u = unit, '
                't = text as shown, v = unrounded value, src = file#field it was read from (paths relative to site/data/). '
                'Each value was recomputed independently; see work/site/site_facts_audit.json.',
    'generated_by': 'scripts/61_site_facts.py',
    'facts': facts,
}
if pending:
    gen['pending'] = pending
os.makedirs(os.path.dirname(AUDIT), exist_ok=True)
with open(OUT, 'w', encoding='utf-8') as f:
    json.dump(gen, f, ensure_ascii=False, separators=(',', ':'))
    f.write('\n')
json.dump({'facts': audit, 'recompute_failed': [a['key'] for a in fails], 'pending': pending,
           'known_changes': [{'key': k['key'], 'plan18': k['plan18'], 'data': k['text'], 'why': k['known_change']} for k in known]},
          open(AUDIT, 'w', encoding='utf-8'), ensure_ascii=False, indent=1)

w = max(len(a['key']) for a in audit)
for a in audit:
    flag = 'FAIL' if a['agree'] is False else ('ok  ' if a['agree'] else 'n/a ')
    p = '' if a['plan18'] is None else ('= Plan/18' if a.get('plan18_equal') else ('KNOWN CHANGE (Plan/18 %s)' % a['plan18'] if a.get('known_change') else 'MISMATCH (Plan/18 %s)' % a['plan18']))
    print('%s %-*s %-22s %s' % (flag, w, a['key'], a['text'], p))
print('\n%d facts written to site/data/site_facts.json (%d B); %d recomputed independently, %d without a second source, %d recompute failures.'
      % (len(facts), os.path.getsize(OUT), sum(1 for a in audit if a['agree']), sum(1 for a in audit if a['agree'] is None), len(fails)))
print('Plan/18 comparisons: %d equal, %d known changes, %d unresolved mismatches.'
      % (sum(1 for a in audit if a.get('plan18_equal')), len(known), len(pending)))
if fails:
    sys.exit(1)
if pending:
    print('UNRESOLVED (held back in "pending", not shown on pages; user decision needed):')
    for k, v in pending.items():
        print('  %s: Plan/18 %s %s vs data %s (%s#%s)' % (k, v['section'], v['plan18'], v['data'], v['src'], v['field']))
    sys.exit(3)
