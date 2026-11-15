// P3 panel: results of the user-drawn line (stage 5-3). The line itself is edited with the map toolbar
// (#drawbar) or the keyboard; this panel shows instructions and the numbers. Everything is "approximation
// on the 10 m grid"; parts outside the grid are reported as such, never filled in.
import { t, escapeHtml as esc } from '../i18n.js';
import { fmt, dur } from '../format.js';
import { lineChart } from '../charts.js';

const ck = (key, text) => `<span class="num" data-check="${key}">${text}</span>`;

export function renderDrawPanel(el, ctx) {
  const tool = ctx.draw;
  const st = tool.state;
  const walk = ctx.core.config.walk;
  const R = st.result;
  const classes = [
    [`0–${walk.slope_moderate_deg}°`, 1.0],
    [`${walk.slope_moderate_deg}–${walk.slope_caution_deg}°`, walk.speed_factor_moderate],
    [`${walk.slope_caution_deg}–${walk.slope_danger_deg}°`, walk.speed_factor_caution],
    [`≥ ${walk.slope_danger_deg}°`, walk.speed_factor_danger],
  ];

  let body = '', chartOk = false;
  if (st.pts.length < 2) {
    body = `<p class="note">${esc(t(st.pts.length ? 'draw.need_two' : 'draw.empty'))}</p>`;
  } else if (st.status === 'loading' || (!R && st.status !== 'error')) {
    body = `<p class="note" role="status">${esc(t('draw.loading'))}</p>`;
  } else if (st.status === 'error' || !R) {
    body = `<p class="warn" role="alert">${esc(t('draw.error'))}</p>`;
  } else {
    const hasIn = R.in_m > 0;
    chartOk = hasIn;
    body = `
    <p class="note"><b>${esc(t('draw.approx'))}</b> ${esc(t('draw.approx_detail'))}</p>
    ${R.out_m > 0 ? `<p class="warn" role="status">${esc(t(hasIn ? 'draw.outside_warn' : 'draw.all_outside', { len: fmt(R.out_m), pct: fmt(R.out_m / R.total_m * 100) }))}</p>` : ''}
    ${R.impassable_m > 0 ? `<p class="warn" role="status">${esc(t('draw.impassable_warn', { len: fmt(R.impassable_m), deg: walk.slope_danger_deg }))}</p>` : ''}
    <table class="kv">
      <tr><th>${esc(t('draw.points'))}</th><td>${ck('draw.n_points', String(R.n_points))}</td></tr>
      <tr><th>${esc(t('draw.length'))}</th><td>${ck('draw.total_m', fmt(R.total_m, 1) + ' m')}</td></tr>
      <tr><th>${esc(t('draw.length_in'))}</th><td>${ck('draw.in_m', fmt(R.in_m, 1) + ' m')}${R.out_m > 0 ? ` <span class="small">(${esc(t('draw.length_out'))} ${ck('draw.out_m', fmt(R.out_m, 1) + ' m')})</span>` : ''}</td></tr>
      ${hasIn ? `
      <tr><th>${esc(t('route.climb_descent'))}</th><td>${ck('draw.climb_m', '+' + fmt(R.climb_m, 1))} / ${ck('draw.descent_m', '−' + fmt(R.descent_m, 1))} m</td></tr>
      <tr><th>${esc(t('draw.elev_range'))}</th><td>${fmt(R.elev_min, 1)} … ${fmt(R.elev_max, 1)} m</td></tr>
      <tr><th>${esc(t('route.max_slope'))}</th><td>${ck('draw.slope_max', fmt(R.slope_max, 1) + '°')} <span class="small">(${esc(t('readout.grid'))})</span></td></tr>
      <tr><th>${esc(t('draw.walk_one'))}</th><td><b>${ck('draw.time_s', esc(dur(R.time_s)))}</b> <span class="small">(${fmt(R.time_s)} s${R.impassable_m > 0 || R.out_m > 0 ? '; ' + esc(t('draw.time_partial')) : ''})</span></td></tr>
      <tr><th>${esc(t('draw.walk_rt'))}</th><td>${esc(dur(R.time_s * 2))} <span class="small">(${esc(t('draw.rt_note'))})</span></td></tr>` : ''}
    </table>
    ${hasIn ? `
    <h4>${esc(t('route.h_speed'))}</h4>
    <table class="tbl"><thead><tr><th>${esc(t('route.slope_class'))}</th><th class="r">${esc(t('route.factor'))}</th><th class="r">${esc(t('route.length'))}</th><th class="r">${esc(t('route.time'))}</th></tr></thead><tbody>
      ${classes.map(([lab, f], i) => `<tr><td>${lab}</td><td class="r">${f === 0 ? esc(t('route.impassable')) : '×' + fmt(f, 1)}</td><td class="r">${fmt(R.classes[i].len_m, 1)} m</td><td class="r">${f === 0 ? '—' : fmt(R.classes[i].time_s) + ' s'}</td></tr>`).join('')}
      ${R.out_m > 0 ? `<tr><td>${esc(t('draw.outside_row'))}</td><td class="r">—</td><td class="r">${fmt(R.out_m, 1)} m</td><td class="r">—</td></tr>` : ''}
    </tbody></table>
    <p class="src">${esc(t('route.src_speed', { kmh: walk.flat_speed_kmh }))}</p>
    <div class="chart" id="dr-profile"></div>` : ''}`;
  }

  el.innerHTML = `
  <h2>${esc(t('draw.title'))}</h2>
  <p class="small">${esc(t('draw.intro'))}</p>
  <details ${st.pts.length ? '' : 'open'}><summary>${esc(t('draw.how'))}</summary>
    <ul class="how">
      <li>${esc(t('draw.how_mouse'))}</li>
      <li>${esc(t('draw.how_touch'))}</li>
      <li>${esc(t('draw.how_key'))}</li>
    </ul></details>
  <div id="dr-body" aria-live="polite">${body}</div>
  <p class="src">${esc(t('draw.src'))}</p>`;

  if (chartOk) {
    const S = R.samples;
    lineChart(el.querySelector('#dr-profile'), {
      title: t('draw.profile_title'),
      caption: t('draw.profile_cap'),
      xLabel: t('route.axis_d'), yLabel: t('route.axis_elev'), xName: t('route.axis_d_short'), yUnit: 'm',
      series: [{ name: t('draw.elev_grid'), color: 'var(--series-1)', points: S.map((s) => [s.d, s.ok ? s.elev : null]) }],
      bands: [
        ...R.outside_runs.map((r) => ({ x0: r.x0, x1: r.x1, label: t('draw.outside_row'), fill: 'var(--series-4)', opacity: 0.12 })),
        ...R.hazard_runs.map((r) => ({ x0: r.x0, x1: r.x1, label: t('route.hazard'), fill: '#fd8d3c', opacity: 0.8 })),
      ],
      xFmt: (v) => fmt(v), yFmt: (v) => fmt(v), tipY: (v) => fmt(v, 1),
      table: { summary: t('ui.table'), cols: [t('route.axis_d'), t('route.axis_elev'), t('route.slope5')],
        rows: S.map((s) => [s.d, s.ok ? s.elev : null, s.ok ? s.slope : null]), thinned: t('ui.thinned') },
    });
  }
}

/** Short text for the map toolbar status line (length + walk time). */
export function drawStatusText(st) {
  if (!st.pts.length) return t('draw.status_empty');
  const R = st.result;
  if (st.pts.length < 2 || !R) return t('draw.status_pts', { n: st.pts.length });
  const timeTxt = R.in_m > 0 ? ` · ${dur(R.time_s)}` : '';
  return `${fmt(R.total_m)} m${timeTxt}${R.out_m > 0 ? ' *' : ''}`;
}
