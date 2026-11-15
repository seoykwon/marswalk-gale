#!/usr/bin/env python3
"""Areocentric solar longitude (Ls) with the Mars24 algorithm (Allison and McEwen 2000).

Source: https://www.giss.nasa.gov/tools/mars24/help/algorithm.html (equations A-2..A-6, B-1..B-5),
which cites
  Allison, M., and M. McEwen (2000), A post-Pathfinder evaluation of areocentric solar coordinates with
  improved timing recipes for Mars seasonal/diurnal climate studies, Planet. Space Sci., 48, 215-235,
  doi:10.1016/S0032-0633(99)00092-6.
  Allison, M. (1997), Geophys. Res. Lett., 24, 1967-1970.

Used by scripts/21_parse_rems.py to replace Weather/weather.txt (CAB outreach file) as the sol -> Ls source.
The REMS MODRDR TIMESTAMP column is "Number of seconds since noon 1-Jan-2000" (MODRDR6.FMT), i.e. an offset
from J2000; it is taken here as TT seconds (difference to UTC ~1 min = ~0.0004 deg of Ls, negligible).

Self-check (run: python3 -I scripts/ls_mars24.py): reproduces the two worked examples printed on the Mars24
page and the published MSL landing value (Ls 150.7 at 2012-08-06 05:18 UTC; Washington University PDS
Geosciences Node Analyst's Notebook, "MSL mission" page, and HiRISE ESP_028256_9022).
"""
import math
from datetime import datetime, timezone

J2000_JD = 2451545.0
UNIX_EPOCH_JD = 2440587.5

# (A_i, tau_i, phi_i deg), Mars24 eq. B-3
PBS_TERMS = (
    (0.0071, 2.2353, 49.409),
    (0.0057, 2.7543, 168.173),
    (0.0039, 1.1177, 191.837),
    (0.0037, 15.7866, 21.736),
    (0.0021, 2.1354, 15.704),
    (0.0020, 2.4694, 95.528),
    (0.0018, 32.8493, 49.095),
)

# TAI-UTC (s) from these UTC dates on; TT-UTC = TAI-UTC + 32.184 s (Mars24 eq. A-4). Enough for 1999-2026.
LEAP = ((datetime(1999, 1, 1, tzinfo=timezone.utc), 32), (datetime(2006, 1, 1, tzinfo=timezone.utc), 33),
        (datetime(2009, 1, 1, tzinfo=timezone.utc), 34), (datetime(2012, 7, 1, tzinfo=timezone.utc), 35),
        (datetime(2015, 7, 1, tzinfo=timezone.utc), 36), (datetime(2017, 1, 1, tzinfo=timezone.utc), 37))


def _sin(d):
    return math.sin(math.radians(d))


def ls_from_dt_j2000(d):
    """Ls in degrees [0, 360) for d = JD_TT - 2451545.0 (days). Mars24 eq. B-1..B-5."""
    M = 19.3871 + 0.52402073 * d
    a_fms = 270.3871 + 0.524038496 * d
    pbs = sum(A * math.cos(math.radians(0.985626 * d / tau + phi)) for A, tau, phi in PBS_TERMS)
    nu_m = ((10.691 + 3.0e-7 * d) * _sin(M) + 0.623 * _sin(2 * M) + 0.050 * _sin(3 * M)
            + 0.005 * _sin(4 * M) + 0.0005 * _sin(5 * M) + pbs)
    return (a_fms + nu_m) % 360.0


def ls_from_timestamp(ts):
    """Ls for a REMS MODRDR TIMESTAMP (seconds since 2000-01-01 12:00, taken as TT)."""
    return ls_from_dt_j2000(ts / 86400.0)


def tt_minus_utc(dt):
    tai = 32
    for start, v in LEAP:
        if dt >= start:
            tai = v
    return tai + 32.184


def ls_from_utc(dt):
    """Ls for an aware UTC datetime (1999-2026 leap-second table)."""
    jd_ut = UNIX_EPOCH_JD + dt.timestamp() / 86400.0
    return ls_from_dt_j2000(jd_ut + tt_minus_utc(dt) / 86400.0 - J2000_JD)


ANCHORS = (
    # (label, UTC datetime, published Ls, tolerance deg, source)
    ('Mars24 worked example A', datetime(2000, 1, 6, 0, 0, 0, tzinfo=timezone.utc), 277.18758, 0.0005,
     'giss.nasa.gov/tools/mars24/help/algorithm.html, Example A'),
    ('Mars24 worked example B (Spirit)', datetime(2004, 1, 3, 13, 46, 31, tzinfo=timezone.utc), 327.32416, 0.0005,
     'giss.nasa.gov/tools/mars24/help/algorithm.html, Example B'),
    ('MSL landing', datetime(2012, 8, 6, 5, 18, 0, tzinfo=timezone.utc), 150.7, 0.05,
     'an.rsl.wustl.edu Analyst\'s Notebook "MSL mission" page; HiRISE ESP_028256_9022 (one decimal)'),
)


def self_check(verbose=True):
    ok = True
    rows = []
    for label, dt, pub, tol, src in ANCHORS:
        v = ls_from_utc(dt)
        good = abs(v - pub) <= tol
        ok &= good
        rows.append({'label': label, 'utc': dt.strftime('%Y-%m-%d %H:%M:%S'), 'computed': round(v, 5), 'published': pub,
                     'diff': round(v - pub, 5), 'tol': tol, 'ok': good, 'source': src})
        if verbose:
            print('%-34s %s UTC  computed %.5f  published %s  diff %+.5f  %s' % (
                label, dt.strftime('%Y-%m-%d %H:%M:%S'), v, pub, v - pub, 'OK' if good else 'FAIL'))
    return ok, rows


if __name__ == '__main__':
    ok, _ = self_check()
    raise SystemExit(0 if ok else 1)
