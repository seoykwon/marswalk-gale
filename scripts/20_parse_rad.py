#!/usr/bin/env python3
"""Stage 2-1: MSL RAD RDR text files -> site/data/rad.json   (run: python3 -I scripts/20_parse_rad.py)

Streams every Radiation/pds/DATA/SOL_*/RAD_RDR_*.TXT line by line.  Per-file results are cached in
work/stage2/rad_cache/ (keyed by size, mtime, filter thresholds) so re-runs only read new files.
Files whose line count != LBL FILE_RECORDS, or whose LBL is missing / lacks END, are skipped and logged.

Format notes (Radiation/pds/DOCUMENT/RAD_RDR_SIS.HTM section 4.2 and the data files themselves):
  [OBSERVATION: NN] header: START_OBS_MARS="<sol> H:MM:SS" (LMST of observation start), START_OBS_UTC,
  OBS_DURATION (s), QC.  [DOSIMETRY_TOTAL_DOSE_B/E] value in microGray/hour.
  [DOSIMETRY_LET_B_A1/A2]: 3 rows = bin centre, bin width (keV/um), counts. The number of bins is read per file:
  NUM_COLS where the block has it (recent format, 52), otherwise the length of the centre row (early format, 44).
  Bins are stored per period in rad.json periods.<p>.let (centre_keV_um, width_keV_um, n_bins).
"""
import glob, json, math, os, time
from multiprocessing import Pool

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, 'scripts/config.json')))
QC_REQ = CFG['rad']['qc_required']
MIN_DUR = CFG['rad']['min_obs_duration_s']
DATA = os.path.join(ROOT, 'Radiation/pds/DATA')
CACHE = os.path.join(ROOT, 'work/stage2/rad_cache')
OUT = os.path.join(ROOT, 'site/data/rad.json')
PERIODS = {'early': (0, 359), 'recent': (4613, 4843)}   # inclusive sol ranges
VALID_SUB = (4710, 4843)   # sub-range of the plan's reference values


def lbl_ok(lbl):
    try:
        txt = open(lbl, 'rb').read().decode('latin1')
    except OSError:
        return None, False
    fr = None
    for ln in txt.splitlines():
        if ln.startswith('FILE_RECORDS'):
            fr = int(ln.split('=')[1].split()[0])
            break
    return fr, txt.rstrip().endswith('END')


def _ends_with_blank_line(path):
    with open(path, 'rb') as fh:
        fh.seek(0, 2)
        fh.seek(max(0, fh.tell() - 4))
        return fh.read().endswith(b'\r\n\r\n')


def parse_file(txt):
    try:
        return _parse_file(txt)
    except Exception as e:
        return {'file': os.path.basename(txt), 'skip': 'parse error: %r' % (e,)}


def _parse_file(txt):
    lbl = txt[:-4] + '.LBL'
    fr, has_end = lbl_ok(lbl)
    if fr is None or not has_end:
        return {'file': os.path.basename(txt), 'skip': 'LBL missing/no END/no FILE_RECORDS'}
    st = os.stat(txt)
    key = [st.st_size, int(st.st_mtime), QC_REQ, MIN_DUR, 'let_num_cols_v2']
    cpath = os.path.join(CACHE, os.path.basename(txt)[:-4] + '.json')
    if os.path.exists(cpath):
        try:
            c = json.load(open(cpath))
            if c.get('key') == key:
                return c
        except Exception:
            pass
    nlines = 0
    num_cols = set()
    obs = []
    cur = None
    mode = None
    pend = None
    with open(txt, 'rb') as f:
        for raw in f:
            nlines += 1
            c0 = raw[:1]
            if c0 == b'[':
                s = raw.decode('latin1').strip()
                mode = None
                pend = None
                if s.startswith('[OBSERVATION:'):
                    cur = {'dose': False, 'B': None, 'E': None, 'let': {}}
                    obs.append(cur)
                elif s.startswith('[COUNTER_L1'):
                    mode = 'L1'
                elif s.startswith('[DOSIMETRY_TOTAL_DOSE_B'):
                    mode = 'B'
                elif s.startswith('[DOSIMETRY_TOTAL_DOSE_E'):
                    mode = 'E'
                elif s.startswith('[DOSIMETRY_LET_B_A1'):
                    mode = 'A1'; pend = []
                elif s.startswith('[DOSIMETRY_LET_B_A2'):
                    mode = 'A2'; pend = []
                continue
            if mode in ('A1', 'A2') and raw.startswith(b'NUM_COLS'):
                num_cols.add(int(raw.split(b'=')[1]))
                continue
            if cur is None:
                continue
            if mode == 'L1':
                # row: ch "name" fast slow duration alive% ...; live seconds / alive fraction ~ OBS_DURATION
                if 'dur_l1' not in cur and raw.count(b'"') == 2:
                    p = raw.decode('latin1').split('"')[2].split()
                    try:
                        if float(p[2]) > 0 and float(p[3]) > 0:
                            cur['dur_l1'] = int(round(float(p[2]) / (float(p[3]) / 100.0)))
                    except (ValueError, IndexError):
                        pass
                continue
            if mode is None:
                if c0 in (b'S', b'O', b'Q') and b'=' in raw:
                    k, _, v = raw.decode('latin1').strip().partition('=')
                    if k == 'START_OBS_MARS':
                        cur['mars'] = v.strip('"')
                    elif k == 'START_OBS_UTC':
                        cur['utc'] = v.strip('"')
                    elif k == 'OBS_DURATION':
                        cur['dur'] = int(float(v))
                    elif k == 'QC':
                        cur['qc'] = v.strip('"')
                continue
            if mode in ('B', 'E'):
                t = raw.strip()
                if t:
                    try:
                        cur[mode] = float(t)
                        cur['dose'] = True
                    except ValueError:
                        pass
                    mode = None
            else:
                t = raw.strip()
                if not t or t.startswith(b'NUM_') or t.startswith(b'---'):
                    continue
                pend.append(t.decode('latin1'))
                if len(pend) == 3:
                    cur['let'][mode] = pend
                    mode = None
    res = {'file': os.path.basename(txt), 'key': key, 'lines': nlines, 'file_records': fr}
    if nlines == fr - 1 and _ends_with_blank_line(txt):
        # Early-mission products (sols 0-359): 123 files are exactly one line short of
        # FILE_RECORDS yet end cleanly with a blank CRLF line and match the server's byte
        # size (Radiation/pds/SOURCES_early_sols.md). Treated as an upstream label quirk.
        res['note'] = 'FILE_RECORDS off by one (label quirk); file ends cleanly, accepted'
    elif nlines != fr:
        res['skip'] = 'line count %d != FILE_RECORDS %d' % (nlines, fr)
        return res
    recs = []
    letsum = {'A1': None, 'A2': None, 'n': 0}
    centres = widths = None
    bins_seen = set()
    n_dose = n_qc_bad = n_qc_bad_dose = dur_derived = 0
    for o in obs:
        qc = o.get('qc', '?')
        if qc != QC_REQ:
            n_qc_bad += 1
        if not o['dose']:
            continue
        n_dose += 1
        if qc != QC_REQ:
            n_qc_bad_dose += 1
        sol_s, _, hms = o['mars'].partition(' ')
        h, m, s = (int(x) for x in hms.split(':'))
        if 'dur' not in o:      # early-mission format has no OBS_DURATION: derive from L1 counter live time
            o['dur'] = o.get('dur_l1', 0)
            dur_derived += 1
        passed = (qc == QC_REQ and o['dur'] >= MIN_DUR)
        recs.append([int(sol_s), h * 3600 + m * 60 + s, o['dur'], qc, o['B'], o['E'], o['utc'][:8], 1 if passed else 0])
        if passed and 'A1' in o['let'] and 'A2' in o['let']:
            for a in ('A1', 'A2'):
                rows = o['let'][a]
                centres = [float(x) for x in rows[0].split()]
                widths = [float(x) for x in rows[1].split()]
                cnt = [float(x) for x in rows[2].split()]
                if not (len(centres) == len(widths) == len(cnt)):
                    raise ValueError('LET row lengths differ: %d/%d/%d' % (len(centres), len(widths), len(cnt)))
                bins_seen.add(len(cnt))
                if letsum[a] is None:
                    letsum[a] = [0.0] * len(cnt)
                for i, v in enumerate(cnt):
                    letsum[a][i] += v
            letsum['n'] += 1
    res.update({'n_obs': len(obs), 'n_dose': n_dose, 'n_qc_bad': n_qc_bad, 'n_qc_bad_dose': n_qc_bad_dose, 'dur_derived': dur_derived,
                'recs': recs, 'let': letsum, 'let_centres': centres, 'let_widths': widths,
                'let_num_cols_header': sorted(num_cols), 'let_n_bins': sorted(bins_seen)})
    if num_cols and bins_seen and num_cols != bins_seen:
        raise ValueError('LET NUM_COLS %s != row length %s' % (sorted(num_cols), sorted(bins_seen)))
    if len(bins_seen) > 1:
        raise ValueError('LET bin count changes within the file: %s' % sorted(bins_seen))
    os.makedirs(CACHE, exist_ok=True)
    json.dump(res, open(cpath + '.tmp', 'w'), separators=(',', ':'))
    os.replace(cpath + '.tmp', cpath)
    return res


def mean_sd(vals):
    n = len(vals)
    if n == 0:
        return None, None
    m = sum(vals) / n
    return m, (math.sqrt(sum((v - m) ** 2 for v in vals) / n) if n > 1 else 0.0)  # population SD


def r(x, d=3):
    return None if x is None else round(x, d)


def period_of(sol):
    for name, (a, b) in PERIODS.items():
        if a <= sol <= b:
            return name
    return 'other'


def stats_block(recs):
    B = [x[4] for x in recs]; E = [x[5] for x in recs]
    mb, sb = mean_sd(B); me, se = mean_sd(E)
    ps = {}
    for x in recs:
        d = ps.setdefault(x[0], [[], []])
        d[0].append(x[4]); d[1].append(x[5])
    solE = {s: sum(v[1]) / len(v[1]) for s, v in ps.items()}
    solB = {s: sum(v[0]) / len(v[0]) for s, v in ps.items()}
    out = {'n_valid': len(recs), 'B_mean': r(mb), 'B_sd': r(sb), 'E_mean': r(me), 'E_sd': r(se), 'n_sols': len(ps)}
    if solE:
        a = max(solE, key=solE.get); b = min(solE, key=solE.get)
        out['E_solmean_max'] = [a, r(solE[a])]; out['E_solmean_min'] = [b, r(solE[b])]
        a = max(solB, key=solB.get); b = min(solB, key=solB.get)
        out['B_solmean_max'] = [a, r(solB[a])]; out['B_solmean_min'] = [b, r(solB[b])]
    return out


def hourly(recs):
    h = [[0.0, 0.0, 0] for _ in range(24)]
    for x in recs:
        k = min(23, x[1] // 3600)
        h[k][0] += x[4]; h[k][1] += x[5]; h[k][2] += 1
    return [[k, r(a[0] / a[2]) if a[2] else None, r(a[1] / a[2]) if a[2] else None, a[2]] for k, a in enumerate(h)]


def main():
    t0 = time.time()
    txts = sorted(glob.glob(os.path.join(DATA, 'SOL_*', 'RAD_RDR_*.TXT')))
    print('found %d RAD_RDR TXT files' % len(txts))
    os.makedirs(CACHE, exist_ok=True)
    results = []
    with Pool(2) as pool:
        for i, res in enumerate(pool.imap_unordered(parse_file, txts, chunksize=1)):
            results.append(res)
            if res.get('skip'):
                print('  SKIP %s: %s' % (res['file'], res['skip']), flush=True)
            if (i + 1) % 25 == 0:
                print('  ... %d/%d files (%.0fs)' % (i + 1, len(txts), time.time() - t0), flush=True)
    results.sort(key=lambda x: x['file'])
    skipped = [{'file': x['file'], 'reason': x['skip']} for x in results if x.get('skip')]
    good = [x for x in results if not x.get('skip')]

    folder_of = {os.path.basename(t): os.path.basename(os.path.dirname(t)) for t in txts}
    folder_rep = {}
    for x in results:
        d = folder_rep.setdefault(folder_of[x['file']], {'txt_files': 0, 'used': 0, 'skipped': 0, 'obs': 0,
                                  'obs_with_dose': 0, 'qc_nonzero_obs': 0, 'qc_nonzero_with_dose': 0})
        d['txt_files'] += 1
        if x.get('skip'):
            d['skipped'] += 1
            continue
        d['used'] += 1
        d['obs'] += x['n_obs']; d['obs_with_dose'] += x['n_dose']
        d['qc_nonzero_obs'] += x['n_qc_bad']; d['qc_nonzero_with_dose'] += x['n_qc_bad_dose']
    for fd, d in sorted(folder_rep.items()):
        print('folder', fd, d)

    allrecs = [rec for x in good for rec in x['recs']]
    sols_present = sorted({x[0] for x in allrecs})
    excl = {'qc_nonzero': sum(1 for x in allrecs if x[3] != QC_REQ),
            'qc_zero_but_duration_lt_%d' % MIN_DUR: sum(1 for x in allrecs if x[3] == QC_REQ and x[2] < MIN_DUR)}
    print('dose obs %d, excluded %s' % (len(allrecs), excl))

    out_periods = {}
    for pname in list(PERIODS) + ['other']:
        sel_all = [x for x in allrecs if period_of(x[0]) == pname]
        if not sel_all:
            continue
        sel = [x for x in sel_all if x[7]]
        let = {'A1': None, 'A2': None, 'n_obs': 0}
        pbins = None
        pfiles = 0
        hdr_cols = set()
        for x in good:
            if not x['recs'] or period_of(x['recs'][0][0]) != pname or x['let']['n'] == 0:
                continue
            fb = (x['let_centres'], x['let_widths'])
            if pbins is None:
                pbins = fb
            elif [round(v, 3) for v in fb[0]] != [round(v, 3) for v in pbins[0]] or \
                    [round(v, 3) for v in fb[1]] != [round(v, 3) for v in pbins[1]]:
                raise SystemExit('LET bins differ within period %s (file %s)' % (pname, x['file']))
            pfiles += 1
            hdr_cols.update(x.get('let_num_cols_header') or [])
            for a in ('A1', 'A2'):
                if x['let'][a] is None:
                    continue
                if let[a] is None:
                    let[a] = [0.0] * len(x['let'][a])
                for i, v in enumerate(x['let'][a]):
                    let[a][i] += v
            let['n_obs'] += x['let']['n']
        solsel = sorted({x[0] for x in sel_all})
        sols_valid = sorted({x[0] for x in sel})
        mb, sb = mean_sd([x[4] for x in sel]); me, se = mean_sd([x[5] for x in sel])
        ps = {}
        for x in sel_all:
            d = ps.setdefault(x[0], {'B': [], 'E': [], 'utc': x[6], 'nall': 0})
            d['nall'] += 1
            if x[7]:
                d['B'].append(x[4]); d['E'].append(x[5])
        rows = []
        for s in sorted(ps):
            d = ps[s]; n = len(d['B'])
            rows.append([s, d['utc'], n, r(sum(d['B']) / n) if n else None, r(sum(d['E']) / n) if n else None, d['nall']])
        spikes = []
        for row in rows:
            if row[2] == 0:
                continue
            eb = row[3] > mb + 3 * sb; ee = row[4] > me + 3 * se
            if eb or ee:
                obs_s = sorted([x for x in sel if x[0] == row[0]], key=lambda x: x[1])
                spikes.append({'sol': row[0], 'utc': row[1], 'B_solmean': row[3], 'E_solmean': row[4],
                               'E_ratio_to_period_mean': r(row[4] / me), 'B_ratio_to_period_mean': r(row[3] / mb),
                               'E_obs_max': r(max(x[5] for x in obs_s)), 'B_obs_max': r(max(x[4] for x in obs_s)),
                               'flag': ('B' if eb else '') + ('E' if ee else ''),
                               'series_cols': ['lmst_h', 'B', 'E'],
                               'series': [[r(x[1] / 3600, 2), x[4], x[5]] for x in obs_s]})
        blk = {
            'sol_range_in_data': [solsel[0], solsel[-1]],
            'n_sols': len(sols_valid), 'n_sols_note': 'sols with at least one valid observation (n_valid > 0)',
            'n_sols_with_dose_obs': len(solsel),
            'n_dose_obs_all': len(sel_all), 'n_valid': len(sel),
            'excluded': {'qc_nonzero': sum(1 for x in sel_all if x[3] != QC_REQ),
                         'duration_lt_%d_with_qc_zero' % MIN_DUR: sum(1 for x in sel_all if x[3] == QC_REQ and x[2] < MIN_DUR)},
            'B_mean': r(mb), 'B_sd': r(sb), 'E_mean': r(me), 'E_sd': r(se),
            'sol_table_cols': ['sol', 'utc_year_doy', 'n_valid', 'B_mean_uGy_h', 'E_mean_uGy_h', 'n_dose_obs_all'],
            'sol_table': rows,
            'lmst_hourly_cols': ['lmst_hour', 'B_mean', 'E_mean', 'n'],
            'lmst_hourly': hourly(sel),
            'spike_threshold': {'rule': 'sol mean > period mean + 3*SD(observation level)', 'B': r(mb + 3 * sb), 'E': r(me + 3 * se)},
            'spikes': spikes, 'let': None,
        }
        if let['A1'] is not None:
            blk['let'] = {'n_obs_summed': let['n_obs'], 'n_files': pfiles, 'n_bins': len(pbins[0]),
                          'n_bins_from': ('NUM_COLS in each LET block header (%s)' % ', '.join(map(str, sorted(hdr_cols)))) if hdr_cols
                          else 'length of the bin-centre row (this format has no NUM_COLS)',
                          'centre_keV_um': pbins[0], 'width_keV_um': pbins[1],
                          'A1_counts_sum': [r(v, 1) for v in let['A1']],
                          'A2_counts_sum': [r(v, 1) for v in let['A2']] if let['A2'] else None}
            assert len(blk['let']['A1_counts_sum']) == blk['let']['n_bins']
        mx = max([s['E_solmean'] for s in spikes], default=me)
        blk['conversion'] = {
            'equipment_6h_uGy_Si': r(mb * 6, 1),
            'equipment_earth_year_mGy_Si': r(mb * 8766 / 1000, 2),
            'equipment_earth_year_rad_Si': r(mb * 8766 / 1000 / 10, 2),
            'human_6h_uGy_E': r(me * 6, 1),
            'human_6h_uGy_E_at_max_spike_sol_mean': r(mx * 6, 1),
            'note': '1 Gy = 100 rad. Earth year = 8766 h. B = silicon detector, E = plastic detector; deck-mounted RAD.'}
        out_periods[pname] = blk

    lo, hi = VALID_SUB
    sub_all = [x for x in allrecs if lo <= x[0] <= hi]
    sub_pass = [x for x in sub_all if x[7]]
    fsub = [x for x in good if x['recs'] and lo <= x['recs'][0][0] <= hi]
    h = hourly(sub_pass)
    d843 = [x for x in sub_all if x[0] == 4843 and x[3] == QC_REQ]
    shorts = [x for x in sub_all if x[3] == QC_REQ and x[2] < MIN_DUR]
    val = {'range': [lo, hi], 'files': len(fsub), 'obs': sum(x['n_obs'] for x in fsub),
           'obs_with_dose': sum(x['n_dose'] for x in fsub),
           'qc_nonzero_obs': sum(x['n_qc_bad'] for x in fsub), 'qc_nonzero_with_dose': sum(x['n_qc_bad_dose'] for x in fsub),
           'valid_obs': len(sub_pass), 'stats': stats_block(sub_pass),
           'E_lmst_hour_means': [x[2] for x in h],
           'sol4843_qc_only': {'n': len(d843), 'B_mean': r(mean_sd([x[4] for x in d843])[0]), 'E_mean': r(mean_sd([x[5] for x in d843])[0])},
           'short_obs_qc0': {'n': len(shorts), 'B_mean': r(mean_sd([x[4] for x in shorts])[0], 2), 'B_max': r(max((x[4] for x in shorts), default=0), 1)}}

    meta = {
        'generated_by': 'scripts/20_parse_rad.py',
        'sources': {
            'data': 'Radiation/pds/DATA/SOL_*/RAD_RDR_*.TXT (MSL RAD RDR, data set MSL-M-RAD-3-RDR-V1.0)',
            'format_doc': 'Radiation/pds/DOCUMENT/RAD_RDR_SIS.HTM (section 4.2 observation header, 4.2.1.6 dosimetry) and per-file .LBL'},
        'units': {'dose_rate': 'microGray/hour (uGy/h), absorbed dose rate',
                  'B': 'B detector, silicon (300 um)', 'E': 'E detector, plastic scintillator; used here as the body-side reading',
                  'LET': 'keV/um (energy deposited in B normalised by detector thickness)'},
        'filter': {'qc_required': QC_REQ, 'min_obs_duration_s': MIN_DUR,
                   'note': 'Observations whose QC flag is not 00000000 are excluded. RAD_RDR_SIS 4.2.1.2 defines 00000001 as '
                           '"unknown quality control issues may exist". Only "00000000" and "00000001" occur in the data.'},
        'lmst': 'START_OBS_MARS="<sol> H:MM:SS" is local mean solar time at observation start; observations last ~15 min and are assigned to their start hour.',
        'let_normalisation': 'LET arrays hold 3 rows: bin centre, bin width, counts. RAD_RDR_SIS 4.2.1.6: "a 1-D (vector) array of E(B), '
                             'containing counts in bins of energy deposited in B", normalised by the detector thickness (keV/um). '
                             'The SIS gives no time or dead-time normalisation for the LET arrays (4.2.1.4 gives one only for the particle '
                             'histograms). The values match counts divided by the live-time fraction (e.g. 2.062 = 2/0.9697, alive 96.97%): '
                             'per observation, not per hour, not per unit LET. Summed over valid observations here; use as a relative '
                             'distribution (divide by width for dN/dLET). Bins per period: periods.<p>.let.',
        'rover_position': 'ROVER_LAT/LON/ELEV are placeholders (0) in every observation per SIS; no spatial analysis.',
        'periods': {k: list(v) for k, v in PERIODS.items()},
        'std': 'population SD over observation-level values',
        'folders': folder_rep, 'skipped_files': skipped, 'n_files_used': len(good),
        'sols_present_range': [sols_present[0], sols_present[-1]] if sols_present else None,
        'exclusion_totals_all_periods': excl}
    out = {'meta': meta, 'periods': out_periods, 'validation_4710_4843': val}
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w') as f:
        json.dump(out, f, separators=(',', ':'))
    print('wrote %s (%d bytes) in %.0fs' % (OUT, os.path.getsize(OUT), time.time() - t0))
    print('validation:', json.dumps({k: v for k, v in val.items() if k != 'E_lmst_hour_means'}))
    print('E hour means:', val['E_lmst_hour_means'])


if __name__ == '__main__':
    main()
