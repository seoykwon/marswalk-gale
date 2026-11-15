#!/usr/bin/env python3
"""Stage 4 step 1: build EVA routes A and B from the Curiosity traverse (Plan/02 sec.2, Plan/03 stage 4).

  python3 -I scripts/40_route_build.py            # print summary only
  python3 -I scripts/40_route_build.py --write    # also write scripts/config.json "routes" (other keys untouched)

Method (all parameters are in ROUTE_DEF below and are copied into config.json "routes"):
 1. The traverse drive tracks (Vector/MSL_traverse/MSL_traverse.json, 1,317 features in mission order) are
    concatenated into one vertex list. Each feature ends exactly on a drive-end waypoint
    (MSL_waypoints.json), so vertices are tagged with the waypoint sol they lead to.
 2. "Cut backtracks": a graph is made from the vertices between the base and the destination waypoint
    (edges = the drive tracks themselves + short connectors between any two vertices closer than
    CONNECT_M, i.e. places where the rover crossed or revisited its own track). The shortest path
    base -> via stops -> destination on this graph drops loops, out-and-back spurs and revisits, but
    otherwise keeps only ground the rover actually drove.
 3. Simplify with Douglas-Peucker, tolerance SIMPLIFY_M (5 m, Plan/02), keeping the named stops.
Distances: local equirectangular metres on the sphere R = 3,396,190 m (error << 0.1% over 2 km).
"""
import heapq
import re
import json
import math
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG_PATH = os.path.join(ROOT, 'scripts', 'config.json')
TRAV = os.path.join(ROOT, 'Vector', 'MSL_traverse', 'MSL_traverse.json')
WAYP = os.path.join(ROOT, 'Vector', 'MSL_traverse', 'MSL_waypoints.json')
R_MARS = 3396190.0
CONNECT_M = 8.0          # max connector length between two track vertices (crossing / revisit)
CONNECT_PENALTY = 1.25   # connectors cost a bit more than driven track, so real tracks are preferred
SIMPLIFY_M = 5.0         # Plan/02 sec.2: simplify the rover track with a 5 m tolerance

# Stops: (sol, kind, name_en, name_ko, basis). Names only where Plan/02 confirms them; others by sol.
ROUTE_DEF = {
    'A': dict(
        name_en='Route A - Bradbury Landing to Yellowknife Bay (flat reference)',
        name_ko='경로 A — 브래드버리 착륙지 → 옐로나이프 만 (평탄 기준 경로)',
        stops=[(3, 'base', 'Bradbury Landing', '브래드버리 착륙지',
                'Plan/02 sec.2 base (assumed): rover waypoint sol 3, site 2 drive 0'),
               (50, 'via', 'Sol 50 (toward Glenelg)', 'sol 50 (글레넬그 방향)',
                'Plan/02 sec.2 via point: rover waypoint sol 50, site 4 drive 2956'),
               (125, 'dest', 'Yellowknife Bay', '옐로나이프 만',
                'Plan/02 sec.2 destination (137.4493E 4.5896S, -4,521 m): rover waypoint sol 125, site 5 drive 1398')],
    ),
    'B': dict(
        name_en='Route B - Mount Sharp slope, sol 4614 to sol 4996',
        name_ko='경로 B — 샤프산 사면, sol 4614 → sol 4996 (경사 경로, 주 경로)',
        stops=[(4614, 'base', 'Base B (sol 4614)', '기지 B (sol 4614)',
                'Plan/02 sec.2 base (assumed): rover waypoint sol 4614, site 118 drive 0'),
               (4841, 'via', 'Sol 4841 (latest RAD/REMS site)', 'sol 4841 (RAD·REMS 최신 측정 지점)',
                'Plan/02 sec.2 via point: rover waypoint sol 4841, site 121 drive 762'),
               (4996, 'dest', 'Sol 4996', 'sol 4996',
                'Plan/02 sec.2 destination: rover waypoint sol 4996, site 124 drive 1872')],
    ),
}


def lonlat_m(lat0):
    k = math.pi / 180 * R_MARS
    return k * math.cos(math.radians(lat0)), k


def dist(a, b):
    kx, ky = lonlat_m((a[1] + b[1]) / 2)
    return math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * ky)


def load():
    wp = [f['properties'] for f in json.load(open(WAYP))['features']]
    feats = json.load(open(TRAV))['features']
    V, tag = [], []   # vertices, and for each vertex the index of the feature it belongs to
    for k, f in enumerate(feats):
        g = f['geometry']
        parts = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        for part in parts:
            for c in part:
                p = (c[0], c[1])
                if V and abs(V[-1][0] - p[0]) < 1e-9 and abs(V[-1][1] - p[1]) < 1e-9:
                    continue
                V.append(p)
                tag.append(k)
    return wp, V


def find_vertex(V, p, start=0, tol=1.0):
    """first vertex index >= start within tol metres of p"""
    for i in range(start, len(V)):
        if dist(V[i], p) <= tol:
            return i
    raise SystemExit('no traverse vertex within %.1f m of %s after %d' % (tol, p, start))


def shortest(V, i0, i1, lo, hi):
    """Dijkstra over vertices lo..hi (track edges + connectors), from i0 to i1. Returns index path."""
    idx = list(range(lo, hi + 1))
    # grid hash for connectors
    cell = CONNECT_M / 59274.7
    grid = {}
    for i in idx:
        grid.setdefault((int(V[i][0] / cell), int(V[i][1] / cell)), []).append(i)
    adj = {i: [] for i in idx}
    for i in idx:
        if i + 1 <= hi:
            d = dist(V[i], V[i + 1])
            adj[i].append((i + 1, d))
            adj[i + 1].append((i, d))
        gx, gy = int(V[i][0] / cell), int(V[i][1] / cell)
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for j in grid.get((gx + dx, gy + dy), ()):
                    if j > i + 1:
                        d = dist(V[i], V[j])
                        if d <= CONNECT_M:
                            adj[i].append((j, d * CONNECT_PENALTY))
                            adj[j].append((i, d * CONNECT_PENALTY))
    best = {i0: 0.0}
    prev = {}
    pq = [(0.0, i0)]
    while pq:
        c, u = heapq.heappop(pq)
        if u == i1:
            break
        if c > best.get(u, 1e18):
            continue
        for v, w in adj[u]:
            nc = c + w
            if nc < best.get(v, 1e18):
                best[v] = nc
                prev[v] = u
                heapq.heappush(pq, (nc, v))
    path = [i1]
    while path[-1] != i0:
        path.append(prev[path[-1]])
    return path[::-1]


def dp(pts, tol):
    if len(pts) < 3:
        return list(pts)
    a, b = pts[0], pts[-1]
    kx, ky = lonlat_m((a[1] + b[1]) / 2)
    ax, ay, bx, by = 0.0, 0.0, (b[0] - a[0]) * kx, (b[1] - a[1]) * ky
    L = math.hypot(bx, by)
    dmax, imax = -1, 0
    for i in range(1, len(pts) - 1):
        px, py = (pts[i][0] - a[0]) * kx, (pts[i][1] - a[1]) * ky
        if L == 0:
            d = math.hypot(px, py)
        else:
            t = max(0, min(1, (px * bx + py * by) / L ** 2))
            d = math.hypot(px - t * bx, py - t * by)
        if d > dmax:
            dmax, imax = d, i
    if dmax <= tol:
        return [a, b]
    left = dp(pts[:imax + 1], tol)
    return left[:-1] + dp(pts[imax:], tol)


def length(pts):
    return sum(dist(pts[i], pts[i + 1]) for i in range(len(pts) - 1))


def build(rid, wp, V):
    d = ROUTE_DEF[rid]
    stops = []
    for sol, kind, ne, nk, basis in d['stops']:
        p = [q for q in wp if q['sol'] == sol][0]
        stops.append(dict(sol=sol, site=p['site'], drive=p['drive'], kind=kind, name_en=ne, name_ko=nk,
                          lon=p['lon'], lat=p['lat'], rover_elev_m=p['elev_geoid'],
                          rover_odometry_m=p['dist_total_m'], basis=basis))
    # vertex indices of the stops, in mission order
    vi, s = [], 0
    for st in stops:
        s = find_vertex(V, (st['lon'], st['lat']), s)
        vi.append(s)
    lo, hi = vi[0], vi[-1]
    rover_len = length(V[lo:hi + 1])
    path = []
    for a, b in zip(vi[:-1], vi[1:]):
        seg = shortest(V, a, b, lo, hi)
        path += seg if not path else seg[1:]
    pts = [V[i] for i in path]
    n_conn = sum(1 for a, b in zip(path[:-1], path[1:]) if abs(a - b) != 1)
    # simplify each stop-to-stop piece separately so stops stay vertices
    line, stop_vertex = [], []
    cut = [path.index(i) for i in vi]
    for k in range(len(cut) - 1):
        piece = dp(pts[cut[k]:cut[k + 1] + 1], SIMPLIFY_M)
        if not line:
            stop_vertex.append(0)
            line += piece
        else:
            line += piece[1:]
        stop_vertex.append(len(line) - 1)
    for st, k in zip(stops, stop_vertex):
        st['line_vertex'] = k
    info = dict(rover_track_m=round(rover_len, 1), shortest_path_m=round(length(pts), 1),
                simplified_m=round(length(line), 1), n_track_vertices=hi - lo + 1, n_path_vertices=len(pts),
                n_connectors_used=n_conn, n_line_vertices=len(line),
                straight_base_dest_m=round(dist(line[0], line[-1]), 1))
    route = dict(name_en=d['name_en'], name_ko=d['name_ko'], stops=stops,
                 line=[[round(p[0], 7), round(p[1], 7)] for p in line], build=info)
    return route


def main(argv):
    wp, V = load()
    routes = {}
    for rid in ('A', 'B'):
        r = build(rid, wp, V)
        routes[rid] = r
        print(rid, json.dumps(r['build']), [(s['sol'], s['line_vertex']) for s in r['stops']])
    if '--write' in argv:
        cfg = json.load(open(CFG_PATH))
        out = {'_comment': 'Fixed in stage 4 (Plan/11). Built by scripts/40_route_build.py from the rover drive '
                           'tracks: shortest path on the track graph (drops loops/backtracks), Douglas-Peucker '
                           'simplification. line = [lon, lat] vertices (deg, east-positive, sphere R 3396190). '
                           'Read by scripts/40_route_profile.py.',
               'method': dict(source='Vector/MSL_traverse/MSL_traverse.json + MSL_waypoints.json',
                              connector_max_m=CONNECT_M, connector_cost_factor=CONNECT_PENALTY,
                              simplify_tolerance_m=SIMPLIFY_M, sample_spacing_m=2.0,
                              return_rule='same path back (assumption, Plan/09 4-2)')}
        out.update(routes)
        cfg['routes'] = out
        if 'eva' not in cfg:
            cfg['eva'] = {
                'max_duration_h': 6.0, 'reserve_min': 30, 'default_start_lmst_h': 10.0,
                'daylight_end_lmst_h': 17.5, 'min_ground_temp_C': -40, 'dose_budget_uGy_E': 50,
                'dest_stay_min': 30, 'turn_soon_margin_min': 15, 'slope_lookahead_m': 50,
                'comms_lookahead_m': 100, 'station_max_spacing_m': 250, 'equipment_surface_sols': 30,
                'offline_tile_buffer_m': 300, 'offline_max_zoom': 16, 'replay_speeds': [1, 30, 120, 600],
                'sol_seconds': 88775.244,
                '_source': 'assumption (Plan/09 2-3, decisions 2026-11-15), except sol_seconds '
                           '(mean Mars solar day, 1 LMST hour = 3698.97 s). dose_budget is a planning budget, '
                           'not a health limit.'}
        txt = json.dumps(cfg, indent=2, ensure_ascii=False)
        # keep short number lists (coordinates, replay_speeds) on one line
        txt = re.sub(r'\[\s*(-?[\d.]+(?:,\s*-?[\d.]+)*)\s*\]',
                     lambda m: '[' + ', '.join(x.strip() for x in m.group(1).split(',')) + ']', txt)
        open(CFG_PATH, 'w').write(txt + '\n')
        print('wrote', CFG_PATH)


if __name__ == '__main__':
    main(sys.argv[1:])
