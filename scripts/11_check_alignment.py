#!/usr/bin/env python3
"""1단계 정렬 검증 (Plan/03 1단계 표). 표준 라이브러리 + GDAL 명령만 사용.

실행:  python3 -I scripts/11_check_alignment.py [검사이름 ...]
       검사이름 생략 시 전부. 이름: warp dem_wp ctx_dem hirise contact themis extra
결과:  work/checks/*.png  (확인 그림)
       work/checks/alignment_results.json  (측정값; 검사별로 덮어씀)

어긋남 측정 방법(공통): 같은 경위도 격자로 두 레이어를 뽑아 작은 창에서
정규화 상호상관(NCC)을 정수 화소 이동마다 계산하고, 최댓값 주변을 포물선으로
맞춰 소수 화소까지 구한다. 결과 (dx, dy)는 "두 번째 레이어를 동쪽 dx, 북쪽 dy
만큼 옮기면 첫 번째와 가장 잘 맞는다"는 뜻이다(미터).
"""
import json, math, os, subprocess, sys, struct, base64
from array import array
from operator import mul

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GDAL = '/Applications/Postgres.app/Contents/Versions/latest/bin'
ENV = dict(os.environ, PATH=GDAL + ':' + os.environ.get('PATH', ''), GDAL_CACHEMAX='512')
VRT = os.path.join(ROOT, 'work', 'vrt')
CHK = os.path.join(ROOT, 'work', 'checks')
TMP = os.path.join(ROOT, 'work', 'tmp')
RES = os.path.join(CHK, 'alignment_results.json')
R = 3396190.0
K = R * math.pi / 180.0          # 1도 = 59274.7 m
os.makedirs(CHK, exist_ok=True)
os.makedirs(TMP, exist_ok=True)


def v(name):
    return os.path.join(VRT, name + '.vrt')


def run(args, inp=None):
    p = subprocess.run(args, input=inp, capture_output=True, text=True, env=ENV)
    if p.returncode != 0 and 'gdallocationinfo' not in args[0]:
        raise RuntimeError(' '.join(args) + '\n' + p.stderr)
    return p.stdout


# ---------------------------------------------------------------- 격자 읽기
class Grid:
    """경위도 사각형 + 화소 수. 화소 (0,0)은 왼쪽 위."""
    def __init__(self, lon0, lat1, w, h, dlon, dlat):
        self.lon0, self.lat1, self.w, self.h, self.dlon, self.dlat = lon0, lat1, w, h, dlon, dlat

    @classmethod
    def around(cls, lon, lat, half_m, cell_m):
        n = int(round(2 * half_m / cell_m))
        dlat = cell_m / K
        dlon = cell_m / (K * math.cos(math.radians(lat)))
        return cls(lon - n / 2 * dlon, lat + n / 2 * dlat, n, n, dlon, dlat)

    @property
    def te(self):
        return ['%.10f' % self.lon0, '%.10f' % (self.lat1 - self.h * self.dlat),
                '%.10f' % (self.lon0 + self.w * self.dlon), '%.10f' % self.lat1]

    def px(self, lon, lat):
        return (lon - self.lon0) / self.dlon, (self.lat1 - lat) / self.dlat

    @property
    def cell_m(self):
        return self.dlat * K


def read(src, g, r='average', band=None, nodata=None):
    """src를 격자 g로 뽑아 float 목록(행 우선)으로 돌려준다. 여러 밴드면 목록의 목록."""
    out = os.path.join(TMP, 'grid.bin')
    args = ['gdalwarp', '-q', '-overwrite', '-of', 'ENVI', '-ot', 'Float32',
            '-te'] + g.te + ['-ts', str(g.w), str(g.h), '-r', r, '-dstnodata', '-9999']
    if band:
        args += ['-b', str(band)] if isinstance(band, int) else sum([['-b', str(b)] for b in band], [])
    if nodata is not None:
        args += ['-srcnodata', str(nodata)]
    run(args + [src, out])
    a = array('f')
    with open(out, 'rb') as f:
        a.frombytes(f.read())
    n = g.w * g.h
    bands = [a[i * n:(i + 1) * n] for i in range(len(a) // n)]
    return bands if len(bands) > 1 else bands[0]


def nanfill(a):
    vals = [x for x in a if x > -9998]
    m = sum(vals) / len(vals) if vals else 0.0
    return array('f', [x if x > -9998 else m for x in a]), len(vals) / len(a)


def hillshade(z, w, h, cell_m, az=315.0, alt=35.0):
    zr, ar = math.radians(90 - alt), math.radians(360 - az + 90)
    out = array('f', [0.0]) * (w * h)
    for y in range(1, h - 1):
        r0, r1, r2 = (y - 1) * w, y * w, (y + 1) * w
        for x in range(1, w - 1):
            dzdx = ((z[r0 + x + 1] + 2 * z[r1 + x + 1] + z[r2 + x + 1]) -
                    (z[r0 + x - 1] + 2 * z[r1 + x - 1] + z[r2 + x - 1])) / (8 * cell_m)
            dzdy = ((z[r2 + x - 1] + 2 * z[r2 + x] + z[r2 + x + 1]) -
                    (z[r0 + x - 1] + 2 * z[r0 + x] + z[r0 + x + 1])) / (8 * cell_m)
            slope = math.atan(math.hypot(dzdx, dzdy))
            aspect = math.atan2(dzdy, -dzdx)
            v_ = math.cos(zr) * math.cos(slope) + math.sin(zr) * math.sin(slope) * math.cos(ar - aspect)
            out[r1 + x] = max(0.0, v_)
    return out


def gradmag(z, w, h):
    out = array('f', [0.0]) * (w * h)
    for y in range(1, h - 1):
        for x in range(1, w - 1):
            i = y * w + x
            out[i] = math.hypot(z[i + 1] - z[i - 1], z[i + w] - z[i - w])
    return out


def highpass(a, w, h, r):
    """(2r+1)² 상자 평균을 빼서 큰 규모의 밝기 차(알베도, 음영 방향)를 없앤다."""
    I = array('d', [0.0]) * ((w + 1) * (h + 1))
    for y in range(h):
        acc = 0.0
        for x in range(w):
            acc += a[y * w + x]
            I[(y + 1) * (w + 1) + x + 1] = I[y * (w + 1) + x + 1] + acc
    out = array('f', [0.0]) * (w * h)
    for y in range(h):
        y0, y1 = max(0, y - r), min(h, y + r + 1)
        for x in range(w):
            x0, x1 = max(0, x - r), min(w, x + r + 1)
            s_ = I[y1 * (w + 1) + x1] - I[y0 * (w + 1) + x1] - I[y1 * (w + 1) + x0] + I[y0 * (w + 1) + x0]
            out[y * w + x] = a[y * w + x] - s_ / ((y1 - y0) * (x1 - x0))
    return out


def ncc2(a, b, w, h, S):
    """거친 탐색(2화소 간격, ±S) 뒤 최고점 주변 ±2를 1화소 간격으로 다시."""
    c = ncc(a, b, w, h, S, 2)
    cx, cy = int(round(c['dx_px'])), int(round(c['dy_px']))
    f = ncc(a, b, w, h, 3, 1, center=(cx, cy), margin=S + 1)
    f['zero'] = c['zero']
    f['at_edge'] = abs(cx) >= S or abs(cy) >= S
    return f


def ncc(a, b, w, h, S, step=1, center=(0, 0), margin=None):
    """a 고정, b를 (dx,dy) 화소만큼 옮겨(b[y+dy][x+dx]) 비교. 반환: dict."""
    m = margin if margin is not None else S + 1
    if center != (0, 0):
        m = max(m, S + 1 + max(abs(center[0]), abs(center[1])))
    rows = range(m, h - m)
    xs, xe = m, w - m
    n = (xe - xs) * len(rows)
    sa = sum(sum(a[y * w + xs:y * w + xe]) for y in rows) / n
    an = [array('f', [p - sa for p in a[y * w + xs:y * w + xe]]) for y in rows]
    na = math.sqrt(sum(sum(map(mul, r, r)) for r in an))
    surf = {}
    for dy in range(center[1] - S, center[1] + S + 1, step):
        for dx in range(center[0] - S, center[0] + S + 1, step):
            sab = sb = sbb = 0.0
            for k, y in enumerate(rows):
                o = (y + dy) * w + dx
                br = b[o + xs:o + xe]
                sab += sum(map(mul, an[k], br))
                sb += sum(br)
                sbb += sum(map(mul, br, br))
            var = sbb - sb * sb / n
            surf[(dx, dy)] = sab / (na * math.sqrt(var)) if var > 0 and na > 0 else 0.0
    (bx, by), peak = max(surf.items(), key=lambda kv: kv[1])

    def para(c_m, c0, c_p):
        d = c_m - 2 * c0 + c_p
        return 0.0 if d >= 0 else 0.5 * (c_m - c_p) / d
    fx = fy = 0.0
    if step == 1 and abs(bx - center[0]) < S and abs(by - center[1]) < S:
        fx = para(surf[(bx - 1, by)], peak, surf[(bx + 1, by)])
        fy = para(surf[(bx, by - 1)], peak, surf[(bx, by + 1)])
    return dict(dx_px=bx + fx, dy_px=by + fy, peak=peak, zero=surf.get((0, 0)),
                at_edge=(abs(bx - center[0]) == S or abs(by - center[1]) == S))


def shift_m(res, cell_m):
    # b[y+dy][x+dx] ~ a[y][x]: b의 지물이 a보다 동쪽 dx, 남쪽 dy 화소에 있다.
    # → b를 서쪽 dx, 북쪽 dy 로 옮겨야 맞는다. 여기서는 "b가 a에 비해 어긋난 양"(동,북 +)으로 보고한다.
    return dict(east_m=round(res['dx_px'] * cell_m, 1), north_m=round(-res['dy_px'] * cell_m, 1),
                total_m=round(math.hypot(res['dx_px'], res['dy_px']) * cell_m, 1),
                peak=round(res['peak'], 3), ncc_at_zero=None if res['zero'] is None else round(res['zero'], 3),
                at_search_edge=res['at_edge'])


# ---------------------------------------------------------------- 그림 쓰기
def stretch(a, lo_p=0.02, hi_p=0.98):
    vals = sorted(x for x in a[::max(1, len(a) // 20000)] if x > -9998)
    lo, hi = vals[int(lo_p * (len(vals) - 1))], vals[int(hi_p * (len(vals) - 1))]
    s = 255.0 / (hi - lo) if hi > lo else 1.0
    return bytes(0 if x <= -9998 else min(255, max(0, int((x - lo) * s))) for x in a)


def save_png(rgb, w, h, name):
    """rgb: 길이 3*w*h bytes/bytearray, 또는 길이 w*h (흑백)."""
    gray = len(rgb) == w * h
    ppm = os.path.join(TMP, name + ('.pgm' if gray else '.ppm'))
    with open(ppm, 'wb') as f:
        f.write(b'%s\n%d %d\n255\n' % (b'P5' if gray else b'P6', w, h))
        f.write(bytes(rgb))
    out = os.path.join(CHK, name + '.png')
    run(['gdal_translate', '-q', '-of', 'PNG', ppm, out])
    for ext in ('.aux.xml',):
        if os.path.exists(out + ext):
            os.remove(out + ext)
    os.remove(ppm)
    return out


def blend(g1, g2, w1=0.5):
    return bytearray(int(w1 * p + (1 - w1) * q) for p, q in zip(g1, g2))


def to_rgb(gray):
    out = bytearray(len(gray) * 3)
    out[0::3] = gray; out[1::3] = gray; out[2::3] = gray
    return out


def mg(g1, g2):
    """마젠타(첫째)·초록(둘째) 합성: 겹치면 회색, 어긋나면 색 테두리."""
    out = bytearray(len(g1) * 3)
    out[0::3] = g1; out[1::3] = g2; out[2::3] = g1
    return out


def draw_line(rgb, w, h, x0, y0, x1, y1, col, th=1):
    n = int(max(abs(x1 - x0), abs(y1 - y0))) + 1
    for i in range(n + 1):
        t = i / n
        x, y = int(round(x0 + (x1 - x0) * t)), int(round(y0 + (y1 - y0) * t))
        for ox in range(-(th // 2), th - th // 2):
            for oy in range(-(th // 2), th - th // 2):
                xx, yy = x + ox, y + oy
                if 0 <= xx < w and 0 <= yy < h:
                    j = 3 * (yy * w + xx)
                    rgb[j:j + 3] = bytes(col)


def draw_cross(rgb, w, h, x, y, col, r=4):
    draw_line(rgb, w, h, x - r, y, x + r, y, col)
    draw_line(rgb, w, h, x, y - r, x, y + r, col)


def upscale(rgb, w, h, f):
    out = bytearray(3 * w * f * h * f)
    for y in range(h * f):
        src = rgb[3 * (y // f) * w:3 * (y // f + 1) * w]
        row = bytearray()
        for x in range(w):
            row += src[3 * x:3 * x + 3] * f
        out[3 * y * w * f:3 * (y + 1) * w * f] = row
    return (out,)


def side(*imgs):
    """같은 높이 RGB 그림들을 가로로 붙인다(사이 4px 흰 띠). imgs: (rgb,w,h)"""
    h = imgs[0][2]
    W = sum(i[1] for i in imgs) + 4 * (len(imgs) - 1)
    out = bytearray([255]) * (3 * W * h)
    x0 = 0
    for rgb, w, _ in imgs:
        for y in range(h):
            out[3 * (y * W + x0):3 * (y * W + x0 + w)] = rgb[3 * y * w:3 * (y + 1) * w]
        x0 += w + 4
    return out, W, h


def load_results():
    try:
        return json.load(open(RES))
    except Exception:
        return {}


def save_results(key, val):
    d = load_results()
    d[key] = val
    json.dump(d, open(RES, 'w'), indent=1, ensure_ascii=False)
    print(json.dumps({key: val}, indent=1, ensure_ascii=False)[:4000])


# ---------------------------------------------------------------- 자료
def waypoints():
    d = json.load(open(os.path.join(ROOT, 'Vector/MSL_traverse/MSL_waypoints.json')))
    return [f['properties'] for f in d['features']]


def traverse_lines():
    d = json.load(open(os.path.join(ROOT, 'Vector/MSL_traverse/MSL_traverse.json')))
    out = []
    for f in d['features']:
        g = f['geometry']
        parts = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        out += [[(c[0], c[1]) for c in p] for p in parts]
    return out


def draw_traverse(rgb, g, col=(255, 40, 40), th=1):
    for line in traverse_lines():
        pts = [g.px(lo, la) for lo, la in line]
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            if -50 < x0 < g.w + 50 and -50 < y0 < g.h + 50:
                draw_line(rgb, g.w, g.h, x0, y0, x1, y1, col, th)


# ================================================================ 검사들
def check_warp_equivalence():
    """미터 원본: 10번에서 쓴 비례 변환(-a_ullr)과 gdalwarp 결과 격자가 같은지."""
    out = {}
    common = json.load(open(os.path.join(ROOT, 'scripts/config.json')))['crs']['common']
    for name in ['B2_hirise_color_25cm', 'T6_mola_463m', 'E1_themis_ti_100m',
                 'themis_day_ir_isis_100m', 'themis_vis_isis_18m']:
        src = os.path.join(VRT, '_eqc', name + '.vrt')
        dst = os.path.join(TMP, 'warp_' + name + '.vrt')
        run(['gdalwarp', '-q', '-overwrite', '-of', 'VRT', '-t_srs', common, src, dst])
        a = json.loads(run(['gdalinfo', '-json', v(name)]))
        b = json.loads(run(['gdalinfo', '-json', dst]))
        ga, gb = a['geoTransform'], b['geoTransform']
        # 같은 지점(원본 중앙 화소)의 경위도 비교
        wa, ha = a['size']
        ca = (ga[0] + ga[1] * wa / 2, ga[3] + ga[5] * ha / 2)
        wb, hb = b['size']
        cb = (gb[0] + gb[1] * wb / 2, gb[3] + gb[5] * hb / 2)
        out[name] = dict(relabel_gt=ga, warp_gt=gb, relabel_size=a['size'], warp_size=b['size'],
                         ul_diff_m=[round((gb[0] - ga[0]) * K, 3), round((gb[3] - ga[3]) * K, 3)],
                         pixel_ratio=round(gb[1] / ga[1], 6))
    save_results('warp_equivalence', out)


def check_dem_waypoints():
    wps = waypoints()
    lat_c = -4.7
    shifts = [(dx, dy) for dy in range(-200, 201, 50) for dx in range(-200, 201, 50)]
    fine = [(dx, dy) for dy in range(-30, 31, 5) for dx in range(-30, 31, 5)]
    allsh = sorted(set(shifts + fine))
    lines = []
    for p in wps:
        for dx, dy in allsh:
            lines.append('%.8f %.8f' % (p['lon'] + dx / (K * math.cos(math.radians(p['lat']))),
                                        p['lat'] + dy / K))
    outv = run(['gdallocationinfo', '-valonly', '-geoloc', v('dem_1m')], '\n'.join(lines) + '\n').split('\n')
    vals = {}
    i = 0
    for p_i, p in enumerate(wps):
        for s in allsh:
            t = outv[i].strip(); i += 1
            vals[(p_i, s)] = float(t) if t and float(t) > -1e30 else None

    def stats(idx, s):
        d = [vals[(j, s)] - wps[j]['elev_geoid'] for j in idx if vals[(j, s)] is not None]
        n = len(d); m = sum(d) / n
        sd = math.sqrt(sum((x - m) ** 2 for x in d) / (n - 1))
        return n, m, sd

    def detr(idx, s):
        # 고도에 따른 차이 추세(문제 9)를 1차식으로 빼고 남은 표준편차. 추세가 섞이면
        # "북쪽으로 밀기 = 내리막 쪽 값"이 추세를 일부 상쇄해 정렬과 무관하게 sd가 줄어든다.
        pts = [(wps[j]['elev_geoid'], vals[(j, s)] - wps[j]['elev_geoid']) for j in idx if vals[(j, s)] is not None]
        n = len(pts); mx = sum(e for e, _ in pts) / n; my = sum(d for _, d in pts) / n
        sxx = sum((e - mx) ** 2 for e, _ in pts); sxy = sum((e - mx) * (d - my) for e, d in pts)
        b = sxy / sxx
        return math.sqrt(sum((d - my - b * (e - mx)) ** 2 for e, d in pts) / (n - 2))

    subsets = {'all': list(range(len(wps))),
               'sol_le_400': [j for j, p in enumerate(wps) if p['sol'] <= 400],
               'sol_ge_1500': [j for j, p in enumerate(wps) if p['sol'] >= 1500]}
    res = {}
    for nm, idx in subsets.items():
        n0, m0, sd0 = stats(idx, (0, 0))
        coarse = sorted(((stats(idx, s)[2], s) for s in shifts))
        fines = sorted(((stats(idx, s)[2], s) for s in fine))
        res[nm] = dict(n=n0, mean_diff_m=round(m0, 2), sd_m=round(sd0, 2),
                       coarse_best_shift_EN_m=coarse[0][1], coarse_best_sd=round(coarse[0][0], 2),
                       coarse_rank_of_zero=[s for _, s in coarse].index((0, 0)) + 1,
                       coarse_2nd=[coarse[1][1], round(coarse[1][0], 2)],
                       fine_best_shift_EN_m=fines[0][1], fine_best_sd=round(fines[0][0], 2),
                       fine_sd_at_zero=round(stats(idx, (0, 0))[2], 2))
        dc = sorted(((detr(idx, s_), s_) for s_ in shifts))
        df = sorted(((detr(idx, s_), s_) for s_ in fine))
        res[nm].update(detrended_sd_at_zero=round(detr(idx, (0, 0)), 2),
                       detrended_coarse_best=[dc[0][1], round(dc[0][0], 2)],
                       detrended_coarse_rank_of_zero=[s_ for _, s_ in dc].index((0, 0)) + 1,
                       detrended_fine_best=[df[0][1], round(df[0][0], 2)])
    # 문제 9: 고도에 따른 차이 추세 (전체 점, 밀지 않음)
    pts = [(p['elev_geoid'], vals[(j, (0, 0))] - p['elev_geoid'], p['sol'])
           for j, p in enumerate(wps) if vals[(j, (0, 0))] is not None]
    n = len(pts)
    mx = sum(e for e, _, _ in pts) / n; my = sum(d for _, d, _ in pts) / n
    sxx = sum((e - mx) ** 2 for e, _, _ in pts); sxy = sum((e - mx) * (d - my) for e, d, _ in pts)
    slope = sxy / sxx; icpt = my - slope * mx
    syy = sum((d - my) ** 2 for _, d, _ in pts)
    r = sxy / math.sqrt(sxx * syy)
    bins = {}
    for e, d, _ in pts:
        b = int(math.floor(e / 100.0) * 100)
        bins.setdefault(b, []).append(d)
    binstat = {str(b): dict(n=len(ds), mean=round(sum(ds) / len(ds), 2),
                            min=round(min(ds), 1), max=round(max(ds), 1))
               for b, ds in sorted(bins.items())}
    resid = [d - (icpt + slope * e) for e, d, _ in pts]
    rsd = math.sqrt(sum(x * x for x in resid) / (n - 2))
    res['trend_vs_elev'] = dict(n=n, slope_m_per_100m=round(slope * 100, 3), intercept_at_minus4500=round(icpt + slope * -4500, 2),
                                r=round(r, 3), resid_sd_m=round(rsd, 2), bins_100m=binstat,
                                diff_min=round(min(d for _, d, _ in pts), 2), diff_max=round(max(d for _, d, _ in pts), 2))
    save_results('dem_waypoints', res)
    # 산점도 (SVG → PNG, macOS qlmanage)
    plot_trend(pts, slope, icpt)
    with open(os.path.join(CHK, 'dem_waypoints_diff.csv'), 'w') as f:
        f.write('sol,lon,lat,elev_geoid,dem,diff\n')
        for j, p in enumerate(wps):
            dv = vals[(j, (0, 0))]
            f.write('%d,%.6f,%.6f,%.3f,%s,%s\n' % (p['sol'], p['lon'], p['lat'], p['elev_geoid'],
                    '' if dv is None else '%.3f' % dv, '' if dv is None else '%.3f' % (dv - p['elev_geoid'])))


def svg_to_png(svg, name, size=1000):
    path = os.path.join(TMP, name + '.svg')
    open(path, 'w').write(svg)
    subprocess.run(['qlmanage', '-t', '-s', str(size), '-o', TMP, path], capture_output=True)
    src = path + '.png'
    if os.path.exists(src):
        os.replace(src, os.path.join(CHK, name + '.png'))
    os.replace(path, os.path.join(CHK, name + '.svg'))


def plot_trend(pts, slope, icpt):
    W = H = 1000
    x0, x1, y0, y1 = -4600, -3400, -15, 35
    L, Rr, T, B = 90, 30, 60, 90

    def X(e): return L + (e - x0) / (x1 - x0) * (W - L - Rr)

    def Y(d): return T + (y1 - d) / (y1 - y0) * (H - T - B)
    s = ['<svg xmlns="http://www.w3.org/2000/svg" width="%d" height="%d" font-family="Helvetica" font-size="18">' % (W, H),
         '<rect width="100%" height="100%" fill="white"/>']
    for e in range(x0, x1 + 1, 200):
        s.append('<line x1="%.1f" x2="%.1f" y1="%d" y2="%d" stroke="#ddd"/>' % (X(e), X(e), T, H - B))
        s.append('<text x="%.1f" y="%d" text-anchor="middle">%d</text>' % (X(e), H - B + 24, e))
    for d in range(y0, y1 + 1, 5):
        s.append('<line x1="%d" x2="%d" y1="%.1f" y2="%.1f" stroke="%s"/>' % (L, W - Rr, Y(d), Y(d), '#888' if d == 0 else '#ddd'))
        s.append('<text x="%d" y="%.1f" text-anchor="end">%d</text>' % (L - 8, Y(d) + 6, d))
    for e, d, sol in pts:
        c = '#1f77b4' if sol <= 400 else ('#ff7f0e' if sol < 1500 else '#d62728')
        s.append('<circle cx="%.1f" cy="%.1f" r="2.2" fill="%s" fill-opacity="0.6"/>' % (X(e), Y(d), c))
    s.append('<line x1="%.1f" y1="%.1f" x2="%.1f" y2="%.1f" stroke="black" stroke-width="2"/>' %
             (X(x0), Y(icpt + slope * x0), X(x1), Y(icpt + slope * x1)))
    s.append('<text x="%d" y="35" font-size="22">DEM − rover elev_geoid (m) vs rover elevation (m), %d waypoints</text>' % (L, len(pts)))
    s.append('<text x="%d" y="%d" text-anchor="middle">rover elev_geoid (m)</text>' % ((W + L) // 2, H - 30))
    s.append('<text x="%d" y="%d" fill="#1f77b4">● sol ≤ 400</text><text x="%d" y="%d" fill="#ff7f0e">● 400–1499</text><text x="%d" y="%d" fill="#d62728">● sol ≥ 1500</text>' % (L + 10, T + 25, L + 150, T + 25, L + 290, T + 25))
    s.append('<text x="%d" y="%d">fit: %.2f m per 100 m</text></svg>' % (L + 450, T + 25, slope * 100))
    svg_to_png('\n'.join(s), 'dem_waypoints_trend')


# ---- CTX ↔ DEM
CTX_PLACES = {
    'landing': (137.4416, -4.5895),
    'routeB': (137.38, -4.81),
    'dem_edge_S': (137.25, -4.905),
    'dem_edge_E': (137.712, -4.45),
    'dem_edge_NW': (137.145, -4.275),
    'crater_W': (137.194, -4.5906),
}


def bandpass(a, w, h, r):
    """highpass(r) 뒤 3×3 평균: 큰 규모 밝기 차와 화소 잡음을 함께 줄인다."""
    hp = highpass(a, w, h, r)
    lp = highpass(hp, w, h, 1)
    return array('f', [x - y for x, y in zip(hp, lp)])


def match_hillshade(img, dem, g, S):
    """img(광학)와 DEM 음영의 어긋남. 음영 방향은 상관이 가장 큰 것을 고른다.
    원값 NCC와 대역통과(bp, 400m 상자) NCC를 둘 다 계산해 서로 맞는지 본다."""
    best = None
    for az in range(0, 360, 30):  # 촬영 당시 태양 방향을 모르므로 바꿔 가며 가장 닮은 것
        hs = hillshade(dem, g.w, g.h, g.cell_m, az, 35)
        r = ncc(img, hs, g.w, g.h, 0)
        if best is None or r['peak'] > best[0]:
            best = (r['peak'], az, hs)
    _, az, hs = best
    raw = ncc2(img, hs, g.w, g.h, S)
    bp = ncc2(bandpass(img, g.w, g.h, 20), bandpass(hs, g.w, g.h, 20), g.w, g.h, S)
    return az, hs, raw, bp


def match_hier(layer, lon, lat, coarse_cell=40.0, coarse_half=6000, S_coarse=40,
               fine_cell=10.0, fine_half=1500, S_fine=6, band=1, ref='hillshade', sun_az=300,
               dem_layer='dem_1m', levels=('coarse', 'fine')):
    """2단계 정합: 거친 격자(40m, ±1.6km 탐색)로 대략의 어긋남을 찾고 10m 격자에서 다듬는다.
    ref='hillshade' 이면 DEM 음영과, 아니면 ref 레이어 이름(광학)과 비교."""
    out = {}
    est = (0.0, 0.0)  # 동, 북 (m)
    for lvl, cell, half, S in (('coarse', coarse_cell, coarse_half, S_coarse), ('fine', fine_cell, fine_half, S_fine)):
        if lvl not in levels:
            continue
        if lvl == 'fine':  # 비교 창이 어긋남만큼 줄어들지 않게 창을 키운다
            half = half + max(abs(est[0]), abs(est[1]))
        g = Grid.around(lon, lat, half, cell)
        img = read(v(layer), g, 'average', band=band)
        img, cov = nanfill(img)
        if ref == 'hillshade':
            dem, _ = nanfill(read(v(dem_layer), g, 'average' if dem_layer == 'dem_1m' else 'bilinear'))
            best = None
            # 거친 단계는 어긋남을 모르므로 음영 방향을 sun_az(서쪽 위 300°, 오후 촬영인 CTX에서
            # 상관이 가장 컸던 값)로 고정하고, 다듬는 단계에서만 방향을 고른다.
            for az in ([sun_az] if lvl == 'coarse' else range(0, 360, 30)):
                hs = hillshade(dem, g.w, g.h, cell, az, 35)
                c_ = (int(round(est[0] / cell)), int(round(-est[1] / cell)))
                r = ncc(img, hs, g.w, g.h, 0, 1, center=c_, margin=S + 1 + max(map(abs, c_)))
                if best is None or r['peak'] > best[0]:
                    best = (r['peak'], az, hs)
            other, az = best[2], best[1]
        else:
            other, _ = nanfill(read(v(ref), g, 'average', band=1))
            az = None
        c_ = (int(round(est[0] / cell)), int(round(-est[1] / cell)))
        # a = 비교 대상 레이어, b = 기준(음영/ref): b[y+dy][x+dx] ~ a[y][x]
        # → 기준의 지물이 대상보다 동쪽 dx. 대상 레이어의 어긋남 = -dx (동), +dy (북)
        if lvl == 'coarse':
            r = ncc(img, other, g.w, g.h, S, 2)
            cx, cy = int(round(r['dx_px'])), int(round(r['dy_px']))
            r = ncc(img, other, g.w, g.h, 2, 1, center=(cx, cy), margin=S + 1)
        else:
            r = ncc(img, other, g.w, g.h, S, 1, center=c_, margin=S + 1 + max(map(abs, c_)))
        sm = shift_m(r, cell)
        est = (sm['east_m'], sm['north_m'])
        out[lvl] = dict(cell_m=cell, window_m=2 * half, sun_az=az, cover=round(cov, 3), **sm)
    # 보고: "대상 레이어가 기준에 비해 어긋난 양" (동 +, 북 +)
    f = out[levels[-1]]
    out['layer_offset_east_m'] = round(-f['east_m'], 1)
    out['layer_offset_north_m'] = round(-f['north_m'], 1)
    out['layer_offset_total_m'] = f['total_m']
    out['peak'] = f['peak']
    return out


def ctx_dem_window(name, lon, lat, half=1500, cell=10.0, S=20, img=True, ctx_layer='B1_ctx_5m'):
    g = Grid.around(lon, lat, half, cell)
    ctx = read(v(ctx_layer), g, 'average')
    dem, cover = nanfill(read(v('dem_1m'), g, 'average'))
    az, hs, raw, bp = match_hillshade(ctx, dem, g, S)
    out = dict(center=[lon, lat], window_m=2 * half, cell_m=cell, sun_az_used=az, dem_cover=round(cover, 3))
    out.update(shift_m(raw, cell))
    out['bandpass'] = shift_m(bp, cell)
    out['shift_ctx_px'] = round(out['total_m'] / 5.0, 2)
    if img:
        c8, h8 = stretch(ctx), stretch(hs)
        a = to_rgb(blend(c8, h8))
        im, W, H = side((to_rgb(c8), g.w, g.h), (to_rgb(h8), g.w, g.h), (a, g.w, g.h))
        out['image'] = os.path.basename(save_png(im, W, H, 'ctx_dem_' + name + ('' if ctx_layer == 'B1_ctx_5m' else '_' + ctx_layer)))
        save_png(mg(c8, h8), g.w, g.h, 'ctx_dem_' + name + ('' if ctx_layer == 'B1_ctx_5m' else '_' + ctx_layer) + '_mg')
    return out


def overlay_image(layer, lon, lat, name, half=1500, cell=10.0, az=None):
    """layer 위에 DEM 음영을 50%로 겹친 확인 그림 (왼쪽: layer, 가운데: 음영, 오른쪽: 50% 합성)."""
    g = Grid.around(lon, lat, half, cell)
    img, _ = nanfill(read(v(layer), g, 'average', band=1))
    dem, _ = nanfill(read(v('dem_1m'), g, 'average'))
    if az is None:
        az = max(range(0, 360, 30), key=lambda a: ncc(img, hillshade(dem, g.w, g.h, cell, a, 35), g.w, g.h, 0)['peak'])
    hs = hillshade(dem, g.w, g.h, cell, az, 35)
    c8, h8 = stretch(img), stretch(hs)
    cx, cy = g.w // 2, g.h // 2
    a = to_rgb(blend(c8, h8))
    for im_ in (a,):
        draw_cross(im_, g.w, g.h, cx, cy, (255, 0, 0), 6)
    im, W, H = side((to_rgb(c8), g.w, g.h), (to_rgb(h8), g.w, g.h), (a, g.w, g.h))
    return os.path.basename(save_png(im, W, H, name))


def check_ctx_dem():
    """B1(CTX 5m)과 대체 후보 curiosity CTX 16m를 DEM 틀(음영·HiRISE)에 맞춰 본다."""
    res = {}
    in_hirise = ('landing', 'routeB')
    for nm, (lo, la) in CTX_PLACES.items():
        r = {}
        ref = 'B2_hirise_color_25cm' if nm in in_hirise else 'hillshade'
        for layer, fc in (('B1_ctx_5m', 10.0), ('ctx_curiosity_16m', 16.0)):
            # HiRISE 기준일 때 거친 창은 3km(착륙지는 HiRISE 북쪽 끝에서 3.8km라 넓으면 빈 곳이 섞임)
            m = match_hier(layer, lo, la, ref=ref, coarse_half=3000 if ref != 'hillshade' else 5000,
                           fine_cell=fc, fine_half=max(1500, 15 * fc))
            r[layer] = dict(ref=ref, offset_east_m=m['layer_offset_east_m'], offset_north_m=m['layer_offset_north_m'],
                            offset_total_m=m['layer_offset_total_m'], peak=m['peak'], coarse_peak=m['coarse']['peak'],
                            at_search_edge=m['fine']['at_search_edge'])
            if ref != 'hillshade' and layer != 'B1_ctx_5m':  # 음영과도 한 번 (다듬는 단계만, 거친 단계 결과 이어받기 없이 ±60m)
                mm = match_hier(layer, lo, la, ref='hillshade', fine_cell=fc, fine_half=1500, S_fine=6 if fc > 10 else 6,
                                levels=('fine',))
                r[layer]['vs_hillshade_local'] = dict(offset_east_m=mm['layer_offset_east_m'],
                                                      offset_north_m=mm['layer_offset_north_m'], peak=mm['peak'],
                                                      at_search_edge=mm['fine']['at_search_edge'])
            r[layer]['image'] = overlay_image(layer, lo, la, 'ctx_dem_%s_%s' % (nm, 'B1' if layer == 'B1_ctx_5m' else 'ctx16'))
        res[nm] = r
        print(nm, json.dumps(r, ensure_ascii=False), flush=True)
    save_results('ctx_dem', res)


# ---- HiRISE 컬러 ↔ 경로, CTX, DEM
HIRISE_PLACES = {
    'landing': (137.4416, -4.5895, 150, 0.5),
    'yellowknife': (137.4465, -4.5880, 250, 0.5),
    'routeB': (137.385, -4.815, 400, 1.0),
    'pahrump': (137.374, -4.665, 300, 0.5),
}


def check_hirise():
    res = {}
    for nm, (lo, la, half, cell) in HIRISE_PLACES.items():
        g = Grid.around(lo, la, half, cell)
        rgb = read(v('B2_hirise_color_25cm'), g, 'average', band=[1, 2, 3])
        planes = [stretch(b, 0.01, 0.99) for b in rgb]
        im = bytearray(3 * g.w * g.h)
        for k in range(3):
            im[k::3] = planes[k]
        raw = bytearray(im)
        draw_traverse(im, g, (255, 30, 30), 1)
        wp = [p for p in waypoints()]
        for p in wp:
            x, y = g.px(p['lon'], p['lat'])
            if 0 <= x < g.w and 0 <= y < g.h:
                draw_cross(im, g.w, g.h, int(x), int(y), (255, 255, 0), 3)
        both, W, H = side((raw, g.w, g.h), (im, g.w, g.h))
        res[nm] = dict(center=[lo, la], window_m=2 * half, cell_m=cell,
                       image=os.path.basename(save_png(both, W, H, 'hirise_traverse_' + nm)))
    # 수치: HiRISE(흑백) ↔ CTX (5m), HiRISE ↔ DEM 음영 (2m)
    for nm, (lo, la) in [('landing', (137.4416, -4.5895)), ('routeB', (137.38, -4.81)), ('pahrump', (137.372, -4.67))]:
        # (CTX ↔ HiRISE 는 check_ctx_dem 에서 2단계 정합으로 잰다)
        g2 = Grid.around(lo, la, 300, 2.0)
        hi2 = read(v('B2_hirise_color_25cm'), g2, 'average', band=1)
        dem, _ = nanfill(read(v('dem_1m'), g2, 'average'))
        best = None
        for az in range(0, 360, 30):
            hs = hillshade(dem, g2.w, g2.h, 2.0, az, 35)
            rr = ncc(hi2, hs, g2.w, g2.h, 2)
            if best is None or rr['peak'] > best[0]:
                best = (rr['peak'], az, hs)
        rr = ncc(hi2, best[2], g2.w, g2.h, 10)
        res['ncc_vs_dem_' + nm] = dict(center=[lo, la], window_m=600, cell_m=2.0, sun_az_used=best[1], **shift_m(rr, 2.0))
        c8, h8 = stretch(hi2), stretch(best[2])
        im, W, H = side((to_rgb(c8), g2.w, g2.h), (to_rgb(h8), g2.w, g2.h), (to_rgb(blend(c8, h8)), g2.w, g2.h))
        save_png(im, W, H, 'hirise_dem_' + nm)
        print(nm, res['ncc_vs_dem_' + nm])
    save_results('hirise', res)


# ---- 머레이–스팀슨 접촉선 ↔ 컬러 영상
def contact_lines():
    shp = os.path.join(ROOT, 'Geology/gale_local/murray_stimson_caltech/extracted/contact full.shp')
    gj = os.path.join(TMP, 'contact_raw.geojson')
    if os.path.exists(gj):
        os.remove(gj)
    run(['ogr2ogr', '-f', 'GeoJSON', gj, shp])
    d = json.load(open(gj))
    out = []
    for f in d['features']:
        g = f['geometry']
        parts = g['coordinates'] if g['type'] == 'MultiLineString' else [g['coordinates']]
        # 가정: 구(R=3396190) 단순 원통, 중앙 경도 0 → 경위도 = 미터 / K
        out += [[(c[0] / K, c[1] / K) for c in p] for p in parts]
    return out


def check_contact():
    lines = contact_lines()
    lons = [p[0] for l in lines for p in l]; lats = [p[1] for l in lines for p in l]
    ext = [min(lons), min(lats), max(lons), max(lats)]
    res = dict(n_lines=len(lines), extent_lonlat=[round(x, 5) for x in ext])
    views = {'overview': ((ext[0] + ext[2]) / 2, (ext[1] + ext[3]) / 2, 1100, 2.0)}
    # 확대 2곳: 선이 가장 촘촘한 곳 근처를 고정 좌표로
    views['zoom1'] = (137.3575, -4.6715, 200, 0.5)
    views['zoom2'] = (137.3745, -4.6625, 200, 0.5)
    for nm, (lo, la, half, cell) in views.items():
        g = Grid.around(lo, la, half, cell)
        rgb = read(v('B2_hirise_color_25cm'), g, 'average', band=[1, 2, 3])
        planes = [stretch(b, 0.01, 0.99) for b in rgb]
        im = bytearray(3 * g.w * g.h)
        for k in range(3):
            im[k::3] = planes[k]
        raw = bytearray(im)
        for l in lines:
            pts = [g.px(a, b) for a, b in l]
            for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
                draw_line(im, g.w, g.h, x0, y0, x1, y1, (0, 255, 255), 2 if cell < 1 else 1)
        draw_traverse(im, g, (255, 40, 40), 1)
        both, W, H = side((raw, g.w, g.h), (im, g.w, g.h))
        res[nm] = dict(center=[lo, la], window_m=2 * half, cell_m=cell,
                       image=os.path.basename(save_png(both, W, H, 'contact_' + nm)))
    save_results('contact', res)


# ---- THEMIS·열관성 ↔ CTX (큰 충돌구 3개)
CRATERS = {'C1_W': (136.830, -4.750), 'C2_NE': (138.090, -3.979), 'C3_S': (137.623, -5.857)}
THEMIS_LAYERS = [('B5_themis_day_ir_100m', 'raw'), ('themis_day_ir_isis_100m', 'raw'),
                 ('B4_themis_night_ir_100m', 'grad'), ('E1_themis_ti_100m', 'grad'),
                 ('themis_vis_isis_18m', 'raw')]


THEMIS_REF = 'ctx_curiosity_16m'   # B1(CTX 5m)은 블록별로 수백 m–1.7km 어긋나 있어(ctx_field) 기준으로 쓰지 않는다


def check_themis():
    res = {}
    for cn, (lo, la) in CRATERS.items():
        g = Grid.around(lo, la, 8000, 100.0)
        ctx = read(v(THEMIS_REF), g, 'average')
        cg = gradmag(ctx, g.w, g.h)
        res[cn] = {}
        tiles = [(to_rgb(stretch(ctx)), g.w, g.h)]
        for name, mode in THEMIS_LAYERS + [('B1_ctx_5m', 'raw')]:
            band = 1
            t, cov = nanfill(read(v(name), g, 'bilinear', band=band))
            if cov < 0.9:
                res[cn][name] = dict(cover=round(cov, 3), note='coverage too low')
                continue
            if mode == 'raw':
                r = ncc(ctx, t, g.w, g.h, 10)
            else:
                r = ncc(cg, gradmag(t, g.w, g.h), g.w, g.h, 10)
            res[cn][name] = dict(mode=mode, cover=round(cov, 3), **shift_m(r, 100.0))
            res[cn][name]['shift_px_100m'] = round(res[cn][name]['total_m'] / 100.0, 2)
            if name in ('B5_themis_day_ir_100m', 'E1_themis_ti_100m', 'B4_themis_night_ir_100m'):
                tiles.append((mg(stretch(ctx), stretch(t)), g.w, g.h))
        # 열관성 ↔ 야간 적외선 (같은 성질이라 원값 상관)
        ti, _ = nanfill(read(v('E1_themis_ti_100m'), g, 'bilinear'))
        ni, _ = nanfill(read(v('B4_themis_night_ir_100m'), g, 'bilinear', band=1))
        r = ncc(ni, ti, g.w, g.h, 10)
        res[cn]['TI_vs_nightIR'] = shift_m(r, 100.0)
        im, W, H = side(*[upscale(t_, w_, h_, 3) + (w_ * 3, h_ * 3) for t_, w_, h_ in tiles])
        res[cn]['image'] = os.path.basename(save_png(im, W, H, 'themis_ctx_' + cn))
        res[cn]['image_panels'] = ['기준(curiosity CTX 16m)'] + [n for n, _ in THEMIS_LAYERS if n in ('B5_themis_day_ir_100m', 'B4_themis_night_ir_100m', 'E1_themis_ti_100m')]
        # VIS 18m는 20m 격자에서 한 번 더
        g2 = Grid.around(lo, la, 6000, 20.0)
        c2 = read(v(THEMIS_REF), g2, 'average')
        t2, cov2 = nanfill(read(v('themis_vis_isis_18m'), g2, 'bilinear'))
        if cov2 > 0.9:
            r = ncc2(c2, t2, g2.w, g2.h, 30)
            res[cn]['themis_vis_isis_18m_at20m'] = shift_m(r, 20.0)
        print(cn, json.dumps(res[cn], ensure_ascii=False))
    save_results('themis', res)


# ---- 그 밖의 레이어 (기록용): MOLA ↔ DEM
def check_extra():
    res = {}
    # MOLA ↔ DEM: DEM을 약 100m 간격 최근접 표본으로(전체 읽기 피함) 뽑아 비교
    g = Grid(137.1225, -4.2490, 360, 400, 0.0016869, 0.0016869)
    dem_s = os.path.join(TMP, 'dem_100m_nearest.tif')
    run(['gdal_translate', '-q', '-r', 'nearest', '-projwin', g.te[0], g.te[3], g.te[2], g.te[1],
         '-outsize', str(g.w), str(g.h), v('dem_1m'), dem_s])
    dem, cov = nanfill(read(dem_s, g, 'near'))
    mola, _ = nanfill(read(v('T6_mola_463m'), g, 'bilinear'))
    hd, hm = hillshade(dem, g.w, g.h, 100.0, 315), hillshade(mola, g.w, g.h, 100.0, 315)
    r = ncc(hd, hm, g.w, g.h, 8)
    d = [x - y for x, y in zip(dem, mola)]
    m = sum(d) / len(d)
    res['mola_vs_dem'] = dict(cell_m=100, dem_cover=round(cov, 3), mean_dem_minus_mola_m=round(m, 2),
                              sd_m=round(math.sqrt(sum((x - m) ** 2 for x in d) / len(d)), 2), **shift_m(r, 100.0))
    save_png(mg(stretch(hd), stretch(hm)), g.w, g.h, 'mola_dem_hillshade_mg')
    save_results('extra', res)


# ---- CTX(B1) 어긋남 분포: 기준 = curiosity CTX 16m (HiRISE·DEM·로버 좌표와 맞는 것을 확인함)
def ctx_field(step=0.2, out_csv=None, bounds=(136.35, 139.15, -6.50, -3.65), ref='ctx_curiosity_16m',
              layer='B1_ctx_5m'):
    out_csv = out_csv or os.path.join(CHK, 'ctx_offset_field.csv')
    lo0, lo1, la0, la1 = bounds
    pts = []
    la = la1
    while la >= la0 - 1e-9:
        lo = lo0
        while lo <= lo1 + 1e-9:
            pts.append((round(lo, 4), round(la, 4)))
            lo += step
        la -= step
    with open(out_csv, 'w') as f:
        f.write('lon,lat,off_east_m,off_north_m,peak,coarse_peak,at_edge\n')
        for lo, la in pts:
            try:
                r = match_hier(layer, lo, la, ref=ref, coarse_cell=40.0, coarse_half=5000, S_coarse=40,
                               fine_cell=16.0, fine_half=2400, S_fine=4)
                f.write('%.4f,%.4f,%.1f,%.1f,%.3f,%.3f,%d\n' % (lo, la, r['layer_offset_east_m'], r['layer_offset_north_m'],
                        r['peak'], r['coarse']['peak'], r['fine']['at_search_edge'] or r['coarse']['at_search_edge']))
            except Exception as e:
                f.write('%.4f,%.4f,,,,,%s\n' % (lo, la, type(e).__name__))
            f.flush()
    return out_csv


def check_ctx_field():
    """B1 어긋남 분포를 0.2° 간격으로 재고 그림으로 남긴다(약 12분)."""
    csv_path = ctx_field(0.2)
    rows = [l.strip().split(',') for l in open(csv_path)][1:]
    g = Grid(136.2, -3.5, 760, 780, 0.004, 0.004)
    bg = to_rgb(stretch(read(v('ctx_curiosity_16m'), g, 'average')))
    bg = bytearray(int(x * 0.6) for x in bg)
    good = []
    for r in rows:
        if not r[2]:
            continue
        lo, la, e, n, pk, cpk, edge = float(r[0]), float(r[1]), float(r[2]), float(r[3]), float(r[4]), float(r[5]), r[6]
        x, y = g.px(lo, la)
        ok = pk >= 0.5 and edge == '0'
        mag = math.hypot(e, n)
        col = (80, 220, 80) if mag <= 50 else (240, 220, 40) if mag <= 300 else (255, 60, 60)
        if not ok:
            col = (150, 150, 150)
        else:
            good.append(mag)
        for dx in range(-3, 4):
            for dy in range(-3, 4):
                if 0 <= x + dx < g.w and 0 <= y + dy < g.h:
                    j = 3 * (int(y + dy) * g.w + int(x + dx)); bg[j:j + 3] = bytes(col)
        if ok:  # 화살표: 40m = 1px
            draw_line(bg, g.w, g.h, x, y, x + e / 40.0, y - n / 40.0, col, 2)
    save_png(bg, g.w, g.h, 'ctx_offset_field')
    good.sort()
    save_results('ctx_field', dict(n_points=len(rows), n_reliable=len(good),
                                   median_m=round(good[len(good) // 2], 1), max_m=round(good[-1], 1),
                                   n_le_10m=sum(1 for m in good if m <= 10), n_gt_300m=sum(1 for m in good if m > 300),
                                   image='ctx_offset_field.png', csv=os.path.basename(csv_path)))


CHECKS = dict(warp=check_warp_equivalence, dem_wp=check_dem_waypoints, ctx_dem=check_ctx_dem,
              hirise=check_hirise, contact=check_contact, themis=check_themis, extra=check_extra,
              ctx_field=check_ctx_field)

if __name__ == '__main__':
    names = sys.argv[1:] or list(CHECKS)
    for n in names:
        print('==', n, flush=True)
        CHECKS[n]()
