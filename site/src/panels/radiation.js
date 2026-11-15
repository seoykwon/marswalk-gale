// Radiation panel R1-R6 (Plan/02 sec.3). Time variation only - no spatial map, no altitude dependence,
// no SEE rate, no equivalent dose (Plan/05 D3). Sol 4716 = transient event, cause not determined.
import { t, term, escapeHtml as esc } from '../i18n.js';
import { fmt } from '../format.js';
import { lineChart, scatterChart } from '../charts.js';

const ck = (key, text) => `<span class="num" data-check="${key}">${text}</span>`;

export function renderRadPanel(el, ctx, state) {
  const { rad, rems, config } = ctx.core;
  const pk = state.radPeriod;
  const P = rad.periods[pk];
  const [s0, s1] = P.sol_range_in_data;
  const per = t('rad.period_' + pk, { a: s0, b: s1 });
  const cap = (extra = '') => t('rad.cap', { period: per, n: fmt(P.n_valid) }) + extra;
  const sp = P.spikes[0];
  const conv = P.conversion;
  const r4 = rems.B.r4_rad_pressure;
  const bins = P.let; // centre_keV_um / width_keV_um per period, from scripts/20_parse_rad.py (NUM_COLS per file)
  const ratioPeak = sp ? sp.E_obs_max / P.E_mean : null;

  el.innerHTML = `
  <div class="row"><span>${esc(t('rad.period'))}</span><div class="seg" role="group" aria-label="${esc(t('rad.period'))}">
    ${['recent', 'early'].map((k) => `<button type="button" data-period="${k}" aria-pressed="${k === pk}">${esc(t('rad.period_btn_' + k))}</button>`).join('')}</div></div>
  <h2>${esc(t('rad.title'))}</h2>
  <p class="small">${esc(per)} · ${esc(t('rad.n_valid', { n: fmt(P.n_valid), s: P.n_sols }))} · ${esc(t('rad.filter', { qc: config.rad.qc_required, s: config.rad.min_obs_duration_s }))}</p>
  <table class="tbl"><thead><tr><th></th><th class="r">${esc(t('rad.mean'))}</th><th class="r">${esc(t('rad.sd'))}</th></tr></thead><tbody>
    <tr><td>${term('B', t('rad.equip_B'))}</td><td class="r">${ck(`rad.${pk}.B_mean`, fmt(P.B_mean, 3))} µGy/h</td><td class="r">${fmt(P.B_sd, 3)}</td></tr>
    <tr><td>${term('E', t('rad.body_E'))}</td><td class="r">${ck(`rad.${pk}.E_mean`, fmt(P.E_mean, 3))} µGy/h</td><td class="r">${fmt(P.E_sd, 3)}</td></tr>
  </tbody></table>

  <h3>R1 · ${esc(t('rad.r1'))}</h3>
  <div id="r1"></div>
  <p class="small">${esc(t('rad.r1_note'))}</p>

  <h3>R2 · ${esc(t('rad.r2'))}</h3>
  ${sp ? `<p>${esc(t('rad.r2_text', { sol: sp.sol, utc: sp.utc, e: fmt(sp.E_solmean, 2), pct: fmt((sp.E_ratio_to_period_mean - 1) * 100), max: fmt(sp.E_obs_max, 2), ratio: fmt(ratioPeak, 1) }))}</p>
    <p class="small">${ck(`rad.${pk}.spike_E_solmean`, fmt(sp.E_solmean, 3))} µGy/h (E, sol ${sp.sol}) · ${esc(t('rad.threshold', { e: fmt(P.spike_threshold.E, 3), b: fmt(P.spike_threshold.B, 3) }))}</p>
    <div id="r2"></div>
    <p class="warn">${esc(t('rad.r2_cause'))}</p>`
    : `<p>${esc(t('rad.no_spike_period'))} ${esc(t('rad.threshold', { e: fmt(P.spike_threshold.E, 3), b: fmt(P.spike_threshold.B, 3) }))}</p>`}

  <h3>R3 · ${esc(t('rad.r3'))}</h3>
  <div id="r3"></div>
  <p class="small">${esc(t('rad.r3_note', { d: fmt(diurnalPct(P), 1) }))}</p>

  <h3>R4 · ${esc(t('rad.r4'))}</h3>
  ${pk === 'recent' ? `<div id="r4"></div>
    <table class="tbl"><thead><tr><th>${esc(t('rad.r4_level'))}</th><th class="r">n</th><th class="r">r (E)</th><th class="r">r (B)</th></tr></thead><tbody>
    ${['obs_level', 'solhour_level', 'solmean_level', 'within_sol_level'].map((k) => `<tr><td>${esc(t('rad.r4_' + k))}</td><td class="r">${fmt(r4[k].n)}</td><td class="r" ${k === 'obs_level' ? 'data-check="rad.r4.r_E_obs"' : ''}>${fmt(r4[k].r_E_P, 3)}</td><td class="r">${fmt(r4[k].r_B_P, 3)}</td></tr>`).join('')}
    </tbody></table>
    <p class="note">${esc(t('rad.r4_note', { slope: fmt(r4.obs_level.slope_E_pct_per_Pa * 100, 1) }))}</p>
    <p class="src">${esc(t('rad.r4_src', { n: fmt(r4.n_rad_valid_obs), m: fmt(r4.n_matched) }))}</p>`
    : `<p>${esc(t('rad.r4_recent_only'))}</p>`}

  <h3>R5 · ${term('LET', t('rad.r5'))}</h3>
  <div id="r5"></div>
  <p class="small">${esc(t('rad.r5_note'))}</p>

  <h3>R6 · ${esc(t('rad.r6'))}</h3>
  <table class="tbl"><thead><tr><th></th><th class="r">${esc(t('rad.value'))}</th></tr></thead><tbody>
    <tr><td>${esc(t('rad.c_equip6'))}</td><td class="r">${ck(`rad.${pk}.c_equip6`, fmt(P.B_mean * 6, 1))} µGy(Si)</td></tr>
    <tr><td>${esc(t('rad.c_equip_year'))}</td><td class="r">${ck(`rad.${pk}.c_year_mGy`, fmt(P.B_mean * 8766 / 1000, 2))} mGy(Si) = ${fmt(P.B_mean * 8766 / 1e4, 2)} rad(Si)</td></tr>
    <tr><td>${esc(t('rad.c_human6'))}</td><td class="r">${ck(`rad.${pk}.c_human6`, fmt(P.E_mean * 6, 1))} µGy</td></tr>
    ${sp ? `<tr><td>${esc(t('rad.c_spike6', { sol: sp.sol }))}</td><td class="r">${ck(`rad.${pk}.c_spike6`, fmt(sp.E_solmean * 6, 1))} µGy</td></tr>` : ''}
  </tbody></table>
  <p class="src">${esc(t('rad.c_src', { e6: conv.human_6h_uGy_E, b6: conv.equipment_6h_uGy_Si, y: conv.equipment_earth_year_mGy_Si }))}</p>

  <h3>${esc(t('rad.lens_title'))}</h3>
  <h4>${term('TID')}</h4>
  <p>${esc(t('rad.lens_tid', { y: fmt(P.B_mean * 8766 / 1e4, 2), mgy: fmt(P.B_mean * 8766 / 1000, 1) }))}</p>
  <h4>${term('SEE')}</h4>
  <p>${esc(t('rad.lens_see'))}</p>
  <h4>${esc(t('rad.lens_transient'))}</h4>
  <p>${esc(sp ? t('rad.lens_transient_text', { ratio: fmt(ratioPeak, 1), sol: sp.sol }) : t('rad.lens_transient_none'))}</p>

  <h3>${esc(t('rad.limits_title'))}</h3>
  <ul>${t('rad.limits').map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
  `;

  const BC = 'var(--series-1)', EC = 'var(--series-2)';
  const st = P.sol_table; // [sol, utc, n_valid, B, E, n_all]
  lineChart(el.querySelector('#r1'), {
    title: t('rad.r1_title'), caption: cap(),
    xLabel: 'sol', yLabel: t('rad.axis_rate'), xName: 'sol', yUnit: 'µGy/h',
    series: [{ name: t('rad.B_short'), color: BC, points: st.map((r) => [r[0], r[3]]) },
      { name: t('rad.E_short'), color: EC, points: st.map((r) => [r[0], r[4]]) }],
    refLines: [{ value: P.spike_threshold.E, label: t('rad.thr_E'), extend: true }],
    marks: sp ? [{ x: sp.sol, y: sp.E_solmean, label: t('rad.spike_label', { sol: sp.sol }) }] : [],
    xFmt: (v) => fmt(v), yFmt: (v) => fmt(v, 1), tipY: (v) => fmt(v, 3),
    table: { summary: t('ui.table'), cols: ['sol', 'UTC', 'n', 'B', 'E'], rows: st.map((r) => [r[0], r[1], r[2], r[3], r[4]]) },
  });
  if (sp) {
    lineChart(el.querySelector('#r2'), {
      title: t('rad.r2_title', { sol: sp.sol }), caption: t('rad.r2_cap', { sol: sp.sol, utc: sp.utc, n: sp.series.length }),
      xLabel: t('temp.axis_lmst'), yLabel: t('rad.axis_rate'), xName: 'LMST', yUnit: 'µGy/h', xDomain: [0, 24], xTicks: [0, 6, 12, 18, 24],
      series: [{ name: t('rad.B_short'), color: BC, points: sp.series.map((r) => [r[0], r[1]]) },
        { name: t('rad.E_short'), color: EC, points: sp.series.map((r) => [r[0], r[2]]) }],
      refLines: [{ value: P.E_mean, label: t('rad.period_mean_E') }],
      xFmt: (v) => fmt(v), yFmt: (v) => fmt(v), tipY: (v) => fmt(v, 2), tipX: (v) => fmt(v, 2) + ' h',
      table: { summary: t('ui.table'), cols: ['LMST h', 'B', 'E'], rows: sp.series },
    });
  }
  const lh = P.lmst_hourly; // [h, B, E, n]
  lineChart(el.querySelector('#r3'), {
    title: t('rad.r3_title'), caption: cap(),
    xLabel: t('temp.axis_lmst'), yLabel: t('rad.axis_rate'), xName: 'LMST', yUnit: 'µGy/h', xDomain: [0, 24], xTicks: [0, 6, 12, 18, 24],
    series: [{ name: t('rad.B_short'), color: BC, points: lh.map((r) => [r[0] + 0.5, r[1]]), markers: true },
      { name: t('rad.E_short'), color: EC, points: lh.map((r) => [r[0] + 0.5, r[2]]), markers: true }],
    xFmt: (v) => fmt(v), yFmt: (v) => fmt(v, 2), tipY: (v) => fmt(v, 3), tipX: (v) => `${fmt(v - 0.5)}–${fmt(v + 0.5)} h`,
    table: { summary: t('ui.table'), cols: ['LMST h', 'B', 'E', 'n'], rows: lh },
  });
  if (pk === 'recent') {
    const sc = r4.scatter; // [sol, h, P, B, E]
    scatterChart(el.querySelector('#r4'), {
      title: t('rad.r4_title'), caption: t('rad.r4_cap', { n: fmt(sc.length) }),
      xLabel: t('rad.axis_p'), yLabel: t('rad.axis_rate'), xName: t('rad.axis_p_short'), yName: 'E',
      series: [{ name: t('rad.E_short'), color: EC, points: sc.map((r) => [r[2], r[4], `sol ${r[0]}, ${r[1]} h`]) }],
      xFmt: (v) => fmt(v), yFmt: (v) => fmt(v, 1), r: 1.6, opacity: 0.35,
    });
  }
  const A1 = P.let.A1_counts_sum, A2 = P.let.A2_counts_sum;
  const dens = (arr) => { const tot = arr.reduce((a, b) => a + b, 0); return arr.map((v, i) => [bins.centre_keV_um[i], v > 0 ? v / tot / bins.width_keV_um[i] : null]); };
  lineChart(el.querySelector('#r5'), {
    title: t('rad.r5_title'), caption: cap(t('rad.r5_cap', { nb: bins.centre_keV_um.length })),
    xLabel: t('rad.axis_let'), yLabel: t('rad.axis_let_y'), xName: 'LET', xLog: true, yLog: true,
    xDomain: [bins.centre_keV_um[0] * 0.9, bins.centre_keV_um[bins.centre_keV_um.length - 1] * 1.1],
    series: [{ name: t('rad.let_A1'), color: BC, points: dens(A1), markers: true },
      { name: t('rad.let_A2'), color: 'var(--series-3)', points: dens(A2), markers: true, dash: '5 3' }],
    yDomain: (() => { const v = [...dens(A1), ...dens(A2)].map((p) => p[1]).filter((x) => x); return [Math.min(...v) * 0.7, Math.max(...v) * 1.5]; })(),
    xFmt: (v) => (v >= 1 ? fmt(v) : String(v)), yFmt: pow10, tipY: (v) => v.toExponential(2), tipX: (v) => fmt(v, 3) + ' keV/µm',
    table: { summary: t('ui.table'), cols: [t('rad.axis_let'), 'A1', 'A2'], rows: A1.map((v, i) => [bins.centre_keV_um[i], v, A2[i]]) },
  });

  el.querySelectorAll('[data-period]').forEach((b) => b.addEventListener('click', () => { state.radPeriod = b.dataset.period; ctx.rerender('rad'); }));
}

function diurnalPct(P) {
  const e = P.lmst_hourly.map((r) => r[2]);
  return (Math.max(...e) / Math.min(...e) - 1) * 100;
}

const SUP = { '-': '⁻', 0: '⁰', 1: '¹', 2: '²', 3: '³', 4: '⁴', 5: '⁵', 6: '⁶', 7: '⁷', 8: '⁸', 9: '⁹' };
function pow10(v) {
  const e = Math.round(Math.log10(v));
  return e === 0 ? '1' : '10' + String(e).split('').map((c) => SUP[c]).join('');
}
