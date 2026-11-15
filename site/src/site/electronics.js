// Electronics page (Plan/18 2-4, W6): two live charts reused from the map panels, built with the same
// charts.js calls, the same data files and the same en.json strings, so their values equal the map's:
//   #el-r1 = map Radiation tab R1 (rad.json periods.recent, sol-mean B and E)
//   #el-h2 = map Temperature tab H2 (rems_B.json range_hist_5K)
// The map panels' notes are not copied: they hold unlabelled general-background sentences.
// Numbers in the prose come from data/site_facts.json through site.js (data-fact).
import { initI18n, t } from '../i18n.js';
import { fmt } from '../format.js';
import { lineChart, barChart } from '../charts.js';
import { loadJSON } from '../data.js';

async function main() {
  const title = document.title;
  await initI18n(); // chart titles, captions and axis labels = the map's en.json strings
  document.title = title; // initI18n sets the map's title; keep this page's
  const [rad, remsB] = await Promise.all([loadJSON('data/rad.json'), loadJSON('data/rems_B.json')]);

  // ---- R1, exactly as site/src/panels/radiation.js (period 'recent', the map default)
  const P = rad.periods.recent;
  const [s0, s1] = P.sol_range_in_data;
  const per = t('rad.period_recent', { a: s0, b: s1 });
  const sp = P.spikes[0];
  const st = P.sol_table;
  const BC = 'var(--series-1)', EC = 'var(--series-2)';
  lineChart(document.getElementById('el-r1'), {
    title: t('rad.r1_title'), caption: t('rad.cap', { period: per, n: fmt(P.n_valid) }),
    xLabel: 'sol', yLabel: t('rad.axis_rate'), xName: 'sol', yUnit: 'µGy/h',
    series: [{ name: t('rad.B_short'), color: BC, points: st.map((r) => [r[0], r[3]]) },
      { name: t('rad.E_short'), color: EC, points: st.map((r) => [r[0], r[4]]) }],
    refLines: [{ value: P.spike_threshold.E, label: t('rad.thr_E'), extend: true }],
    marks: sp ? [{ x: sp.sol, y: sp.E_solmean, label: t('rad.spike_label', { sol: sp.sol }) }] : [],
    xFmt: (v) => fmt(v), yFmt: (v) => fmt(v, 1), tipY: (v) => fmt(v, 3),
    table: { summary: t('ui.table'), cols: ['sol', 'UTC', 'n', 'B', 'E'], rows: st.map((r) => [r[0], r[1], r[2], r[3], r[4]]) },
  });

  // ---- H2, exactly as site/src/panels/temperature.js (data set B, the map default for route B)
  const [p0, p1] = remsB.meta.period_sols;
  const rh = remsB.range_hist_5K;
  barChart(document.getElementById('el-h2'), {
    title: t('temp.h2_title'), caption: t('temp.cap_full', { a: p0, b: p1, n: rh.counts.reduce((x, y) => x + y, 0) }),
    categories: rh.bins_start_K.map((b) => String(b)), categoryTip: (i) => `${rh.bins_start_K[i]}–${rh.bins_start_K[i] + 5} K`,
    series: [{ name: 'sols', color: 'var(--series-2)', values: rh.counts }],
    xLabel: t('temp.axis_swing'), yLabel: t('temp.axis_sols'), xName: t('temp.axis_swing'), yFmt: (v) => fmt(v),
    table: { summary: t('ui.table'), cols: ['K', 'sols'], rows: rh.bins_start_K.map((b, i) => [`${b}–${b + 5}`, rh.counts[i]]) },
  });

  // glossary tooltips on [data-term] (same definitions as the map)
  document.querySelectorAll('[data-term]').forEach((e) => { e.title = t(`glossary.${e.dataset.term}.def`); });
  document.body.dataset.charts = 'ready';
}

main().catch((e) => {
  document.body.dataset.charts = 'error';
  document.querySelectorAll('.chart-slot').forEach((el) => { el.textContent = 'Chart could not be loaded. The same chart is in the map panel.'; });
  document.body.dataset.chartError = String(e && e.message || e);
});
