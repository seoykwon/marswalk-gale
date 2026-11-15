// Temperature panel H1-H7 (Plan/02 sec.4). REMS ground temperature (hourly means) as the environment of an
// exposed surface - not suit or equipment-internal temperature (Plan/05 D16). Minima use ground temperature
// (the air-temperature series contains an outlier, Plan/07 open issue 4).
import { t, term, escapeHtml as esc } from '../i18n.js';
import { fmt, tempCK } from '../format.js';
import { lineChart, barChart, scatterChart } from '../charts.js';
import { DEFAULT_LS, lsBins, curve, curveStats, K_MINUS40, K_MINUS55 } from '../env.js';

const ck = (key, text) => `<span class="num" data-check="${key}">${text}</span>`;
const C = (k) => (k === null ? null : k - 273.15);

export function renderTempPanel(el, ctx, state) {
  const { rems, routes } = ctx.core;
  const set = state.tempSet;
  const RM = rems[set];
  const ls = state.tempLs[set] || DEFAULT_LS[set];
  const [p0, p1] = RM.meta.period_sols;
  const per = t('temp.period', { a: p0, b: p1 });
  const S = RM.summary;
  const g = curve(RM, ls, 'gts'), a = curve(RM, ls, 'amb');
  const cs = curveStats(g);
  const full = RM.sols.filter((s) => s.hrs >= 20);
  const rate = RM.mean_rate_K_per_h_by_hour;
  const rmax = Math.max(...rate.filter((x) => x !== null)), rmin = Math.min(...rate.filter((x) => x !== null));
  const amin = Math.min(...RM.sols.filter((s) => s.amin !== null && s.amin !== undefined).map((s) => s.amin));

  el.innerHTML = `
  <div class="row"><span>${esc(t('temp.dataset'))}</span><div class="seg" role="group" aria-label="${esc(t('temp.dataset'))}">
    ${['A', 'B'].map((k) => `<button type="button" data-set="${k}" aria-pressed="${k === set}">${esc(t('temp.set_' + k))}</button>`).join('')}</div></div>
  <h2>${esc(t('temp.title'))}</h2>
  <p class="small">${esc(per)} · ${esc(t('temp.n_sols', { n: S.n_sols_with_rows, f: S.n_sols_hours_ge_20, rows: fmt(S.rows_total) }))}</p>
  <table class="kv">
    <tr><th>${esc(t('temp.period_swing'))}</th><td>${ck(`temp.${set}.range_mean_K`, fmt(S.range_mean_K, 1) + ' K')} <span class="small">(${esc(t('temp.minmax_K', { min: fmt(S.range_min_K, 1), max: fmt(S.range_max_K, 1) }))})</span></td></tr>
    <tr><th>${esc(t('temp.hourly_range'))}</th><td>${tempCK(S.hourly_mean_T_min_K, 1)} – ${tempCK(S.hourly_mean_T_max_K, 1)}</td></tr>
    <tr><th>${esc(t('temp.mean_below40'))}</th><td>${ck(`temp.${set}.h40`, fmt(S['mean_h_below_-40C_gts_full_sols'], 1) + ' h')} / ${esc(t('temp.mean_below55'))} ${fmt(S['mean_h_below_-55C_gts_full_sols'], 1)} h</td></tr>
    <tr><th>${esc(t('temp.uncertainty'))}</th><td>± ${fmt(S.mean_long_term_uncertainty_K, 2)} K</td></tr>
  </table>
  <p class="note">${esc(t('temp.surface_note'))}</p>

  <h3>H1 · ${esc(t('temp.h1'))}</h3>
  <div class="row"><label for="tp-ls">${term('Ls', t('temp.season'))}</label>
    <select id="tp-ls">${lsBins(RM).map((b) => `<option value="${b}" ${b === ls ? 'selected' : ''}>Ls ${b}–${Number(b) + 30}° (${RM.diurnal_by_ls30[b].sols} sols)</option>`).join('')}</select></div>
  <div id="h1"></div>
  <p class="small">${esc(t('temp.h1_note', { min: tempCK(cs.min, 1), max: tempCK(cs.max, 1), r: fmt(cs.range, 1), n40: cs.hBelow40, n55: cs.hBelow55, nv: cs.nValid }))}${cs.nMissing ? ' ' + esc(t('temp.missing_h', { n: cs.nMissing })) : ''}</p>
  <p class="small">${esc(t('temp.air_note', { amin: fmt(amin, 1) }))}</p>

  <h3>H2 · ${esc(t('temp.h2'))}</h3>
  <div id="h2"></div>
  <p class="small">${esc(t('temp.h2_note'))}</p>

  <h3>H3 · ${esc(t('temp.h3'))}</h3>
  <div id="h3"></div>
  <p class="small">${esc(t('temp.h3_note', { up: fmt(rmax, 1), hu: rate.indexOf(rmax), down: fmt(rmin, 1), hd: rate.indexOf(rmin) }))}</p>

  <h3>H4 · ${esc(t('temp.h4'))}</h3>
  <div id="h4"></div>
  <p class="small">${esc(t('temp.h4_note'))}</p>

  <h3>H5 · ${esc(t('temp.h5'))}</h3>
  <div id="h5"></div>

  <h3>H6 · ${esc(t('temp.h6'))}</h3>
  <div id="h6"></div>
  <p class="note">${esc(t('temp.h6_note'))}</p>

  <h3>H7 · ${term('TI', t('temp.h7'))}</h3>
  <div id="h7"></div>
  <p class="small">${esc(t('temp.h7_note', { a: fmt(routes.routes.A.summary.thermal_inertia_tiu.mean), b: fmt(routes.routes.B.summary.thermal_inertia_tiu.mean), ra: fmt(rems.A.summary.range_mean_K, 1), rb: fmt(rems.B.summary.range_mean_K, 1) }))}</p>

  <h3>${esc(t('temp.lens_title'))}</h3>
  <p>${term('cycle', t('temp.lens_cycle_term'))}: ${esc(t('temp.lens_cycle', { r: fmt(S.range_mean_K, 1), rmax: fmt(S.range_max_K, 1), up: fmt(rmax, 1), down: fmt(rmin, 1) }))}</p>
  <p>${esc(t('temp.lens_cold', { h: fmt(S['mean_h_below_-40C_gts_full_sols'], 1) }))}</p>
  <p class="small">${esc(t('temp.lens_ref_lines'))}</p>
  <h3>${esc(t('temp.limits_title'))}</h3>
  <ul>${t('temp.limits').map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
  `;

  const GC = 'var(--series-2)', AC = 'var(--series-1)';
  const capP = (x = '') => t('temp.cap', { a: p0, b: p1, n: RM.diurnal_by_ls30[ls].sols }) + x;
  lineChart(el.querySelector('#h1'), {
    title: t('temp.h1_title', { ls, ls2: Number(ls) + 30 }), caption: capP(),
    xLabel: t('temp.axis_lmst'), yLabel: t('temp.axis_c'), xName: 'LMST', yUnit: '°C', xDomain: [0, 24], xTicks: [0, 6, 12, 18, 24],
    series: [{ name: t('temp.ground'), color: GC, points: g.map((k, h) => [h + 0.5, C(k)]), markers: true },
      { name: t('temp.air_ref'), color: AC, points: a.map((k, h) => [h + 0.5, C(k)]), dash: '5 3' }],
    refLines: [{ value: K_MINUS40 - 273.15, label: '−40 °C' }, { value: K_MINUS55 - 273.15, label: '−55 °C', dash: '1 3' }],
    xFmt: (v) => fmt(v), yFmt: (v) => fmt(v), tipY: (v) => fmt(v, 1), tipX: (v) => `${fmt(v - 0.5)}–${fmt(v + 0.5)} h`,
    table: { summary: t('ui.table'), cols: ['LMST h', t('temp.ground') + ' K', t('temp.air_ref') + ' K'], rows: g.map((k, h) => [h, k, a[h]]) },
  });
  const rh = RM.range_hist_5K;
  barChart(el.querySelector('#h2'), {
    title: t('temp.h2_title'), caption: t('temp.cap_full', { a: p0, b: p1, n: rh.counts.reduce((x, y) => x + y, 0) }),
    categories: rh.bins_start_K.map((b) => String(b)), categoryTip: (i) => `${rh.bins_start_K[i]}–${rh.bins_start_K[i] + 5} K`,
    series: [{ name: 'sols', color: GC, values: rh.counts }],
    xLabel: t('temp.axis_swing'), yLabel: t('temp.axis_sols'), xName: t('temp.axis_swing'), yFmt: (v) => fmt(v),
    table: { summary: t('ui.table'), cols: ['K', 'sols'], rows: rh.bins_start_K.map((b, i) => [`${b}–${b + 5}`, rh.counts[i]]) },
  });
  barChart(el.querySelector('#h3'), {
    title: t('temp.h3_title'), caption: t('temp.cap_all', { a: p0, b: p1 }),
    categories: rate.map((_, h) => String(h)), categoryTip: (h) => `${h}→${h + 1} h`, maxLabels: 12,
    series: [{ name: t('temp.rate'), color: GC, values: rate }],
    xLabel: t('temp.axis_lmst_start'), yLabel: t('temp.axis_rate'), xName: 'LMST', yUnit: 'K/h', yFmt: (v) => fmt(v, 1),
    table: { summary: t('ui.table'), cols: ['LMST h', 'K/h'], rows: rate.map((v, h) => [h, v]) },
  });
  scatterChart(el.querySelector('#h4'), {
    title: t('temp.h4_title'), caption: t('temp.cap_full', { a: p0, b: p1, n: full.length }),
    xLabel: 'sol', yLabel: t('temp.axis_hours'), xName: 'sol', yName: t('temp.axis_hours'), yDomain: [0, 24.5],
    series: [{ name: t('temp.below40_s'), color: 'var(--series-1)', points: full.map((s) => [s.s, s.g40]) },
      { name: t('temp.below55_s'), color: 'var(--series-2)', points: full.map((s) => [s.s, s.g55]) }],
    xFmt: (v) => fmt(v), yFmt: (v) => fmt(v), r: 2,
  });
  const lsFull = full.filter((s) => s.ls !== null);
  scatterChart(el.querySelector('#h5'), {
    title: t('temp.h5_title'), caption: t('temp.cap_full', { a: p0, b: p1, n: lsFull.length }),
    xLabel: t('temp.axis_ls'), yLabel: t('temp.axis_c'), xName: 'Ls', yName: '°C', xDomain: [0, 360], xTicks: [0, 90, 180, 270, 360],
    series: [{ name: t('temp.sol_min'), color: 'var(--series-1)', points: lsFull.map((s) => [s.ls, C(s.tmin), `sol ${s.s}`]) },
      { name: t('temp.sol_max'), color: 'var(--series-2)', points: lsFull.map((s) => [s.ls, C(s.tmax), `sol ${s.s}`]) }],
    refLines: [{ value: K_MINUS40 - 273.15, label: '−40 °C' }],
    xFmt: (v) => fmt(v), yFmt: (v) => fmt(v), r: 2,
  });
  // H6: A vs B daily swing distribution, share of full sols per 5 K bin
  const bins = [];
  for (let b = 55; b <= 110; b += 5) bins.push(b);
  const share = (R) => { const tot = R.range_hist_5K.counts.reduce((x, y) => x + y, 0); return bins.map((b) => { const i = R.range_hist_5K.bins_start_K.indexOf(b); return i < 0 ? 0 : R.range_hist_5K.counts[i] / tot * 100; }); };
  barChart(el.querySelector('#h6'), {
    title: t('temp.h6_title'), caption: t('temp.h6_cap', { na: fmt(rems.A.summary.n_sols_hours_ge_20), nb: fmt(rems.B.summary.n_sols_hours_ge_20) }),
    categories: bins.map(String), categoryTip: (i) => `${bins[i]}–${bins[i] + 5} K`,
    series: [{ name: t('temp.set_A'), color: 'var(--series-1)', values: share(rems.A) }, { name: t('temp.set_B'), color: 'var(--series-2)', values: share(rems.B) }],
    xLabel: t('temp.axis_swing'), yLabel: t('temp.axis_share'), xName: t('temp.axis_swing'), yUnit: '%', yFmt: (v) => fmt(v, 1),
  });
  const RA = routes.routes.A.samples, RB = routes.routes.B.samples;
  lineChart(el.querySelector('#h7'), {
    title: t('temp.h7_title'), caption: t('temp.h7_cap'),
    xLabel: t('route.axis_d'), yLabel: 'TIU', xName: t('route.axis_d_short'), yUnit: 'TIU',
    series: [{ name: t('layers.route', { id: 'A' }), color: 'var(--series-1)', points: RA.d_m.map((d, i) => [d, RA.ti[i]]) },
      { name: t('layers.route', { id: 'B' }), color: 'var(--series-2)', points: RB.d_m.map((d, i) => [d, RB.ti[i]]) }],
    xFmt: (v) => fmt(v), yFmt: (v) => fmt(v),
  });

  el.querySelectorAll('[data-set]').forEach((b) => b.addEventListener('click', () => { state.tempSet = b.dataset.set; ctx.rerender('temp'); }));
  el.querySelector('#tp-ls').addEventListener('change', (e) => { state.tempLs[set] = e.target.value; ctx.rerender('temp'); });
}
