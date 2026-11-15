// Route summary panel (P2, Plan/02 sec.5). Reads routes.json summaries/arrays, rad.json period chosen by
// routes.json env.rad_period, rems_<A|B>.json. Displayed key numbers carry data-check="..." so that
// scripts/58_browser_check.mjs + scripts/59_check_panels.py can compare them with the JSON.
import { t, pick, term, escapeHtml as esc } from '../i18n.js';
import { fmt, dur, signed, tempCK } from '../format.js';
import { routeDose, hazardRows, photosNearRoute, evaTimeS } from '../routecalc.js';
import { DEFAULT_LS, lsBins, curve, curveStats, K_MINUS40, K_MINUS55 } from '../env.js';
import { lineChart } from '../charts.js';
import { thumbsHtml } from '../photos.js';
import { assumptionsHtml } from './assumptions.js';

const ck = (key, text) => `<span class="num" data-check="${key}">${text}</span>`;

export function renderRoutePanel(el, ctx, state) {
  const { routes, rad, rems, config } = ctx.core;
  const rid = state.route;
  const R = routes.routes[rid];
  const S = R.summary;
  const remsR = rems[R.env.rems];
  const ls = state.ls[rid] || DEFAULT_LS[rid];
  const startH = state.startH ?? 10;
  const dose = routeDose(R, rad);
  const evaS = evaTimeS(R);
  const P = `route.${rid}`;
  const walk = config.walk;

  const hz = hazardRows(R);
  const classes = [
    ['0-5', `0–${walk.slope_moderate_deg}°`, 1.0],
    ['5-15', `${walk.slope_moderate_deg}–${walk.slope_caution_deg}°`, walk.speed_factor_moderate],
    ['15-25', `${walk.slope_caution_deg}–${walk.slope_danger_deg}°`, walk.speed_factor_caution],
    ['25+', `≥ ${walk.slope_danger_deg}°`, walk.speed_factor_danger],
  ];
  const cv = curve(remsR, ls, 'gts');
  const cs = curveStats(cv);
  const near = photosNearRoute(R, ctx.photos, 30);
  const periodLabel = t('rad.period_' + dose.period, { a: dose.sols[0], b: dose.sols[1] });

  el.innerHTML = `
  <div class="row"><div class="seg" role="group" aria-label="${esc(t('route.choose'))}">
    ${['A', 'B'].map((r) => `<button type="button" data-route="${r}" aria-pressed="${r === rid}">${esc(t('layers.route', { id: r }))}</button>`).join('')}
  </div></div>
  <h2>${esc(pick(R, 'name'))}</h2>
  <p class="small">${esc(pick(R.env, 'note'))}</p>

  <h3>${esc(t('route.h_distance'))}</h3>
  <table class="kv">
    <tr><th>${esc(t('route.one_way'))}</th><td>${ck(`${P}.dist_m`, fmt(S.dist_m, 1) + ' m')} <span class="small">(${esc(t('route.dist3d'))} ${fmt(S.dist_3d_m, 1)} m)</span></td></tr>
    <tr><th>${esc(t('route.round_trip'))}</th><td>${ck(`${P}.round_trip_m`, fmt(S.round_trip_m, 1) + ' m')} <span class="small">(${esc(t('route.limit_rt', { km: walk.max_round_trip_km }))})</span></td></tr>
    <tr><th>${esc(t('route.walk_one_way'))}</th><td>${ck(`${P}.one_way_time_s`, esc(dur(S.one_way_time_s)))} <span class="small">(${fmt(S.one_way_time_s)} s)</span></td></tr>
    <tr><th>${esc(t('route.walk_rt'))}</th><td>${esc(dur(S.round_trip_walk_s))} <span class="small">(${fmt(S.round_trip_walk_s)} s)</span></td></tr>
    <tr><th>${esc(t('route.stay'))}</th><td>${esc(dur(S.dest_stay_s))} <span class="small">(${esc(t('ui.assumption'))})</span></td></tr>
    <tr><th>${esc(t('route.eva_total'))}</th><td><b>${ck(`${P}.eva_s`, esc(dur(evaS)))}</b> <span class="small">(${fmt(evaS)} s)</span></td></tr>
    <tr><th>${esc(t('route.climb_descent'))}</th><td>${ck(`${P}.climb_m`, '+' + fmt(S.climb_m, 1))} / ${ck(`${P}.descent_m`, '−' + fmt(S.descent_m, 1))} m <span class="small">(${esc(t('route.net'))} ${signed(S.net_elev_m, 1)} m)</span></td></tr>
    <tr><th>${esc(t('route.elev_range'))}</th><td>${fmt(S.elev_base_m, 1)} → ${fmt(S.elev_dest_m, 1)} m <span class="small">(${esc(t('route.dem_datum'))})</span></td></tr>
    <tr><th>${esc(t('route.max_slope'))}</th><td>${ck(`${P}.max_slope_deg`, fmt(S.max_slope_deg, 1) + '°')} <span class="small">(5 m)</span> · ${fmt(S.max_slope_2m_deg, 1)}° <span class="small">(2 m)</span></td></tr>
  </table>
  <p class="src">${esc(t('route.src_distance'))}</p>

  <h4>${esc(t('route.h_speed'))}</h4>
  <table class="tbl"><thead><tr><th>${esc(t('route.slope_class'))}</th><th class="r">${esc(t('route.factor'))}</th><th class="r">${esc(t('route.length'))}</th><th class="r">${esc(t('route.time'))}</th></tr></thead><tbody>
    ${classes.map(([k, lab, f]) => { const c = S.by_slope_class[k]; return `<tr><td>${lab}</td><td class="r">${f === 0 ? esc(t('route.impassable')) : '×' + fmt(f, 1)}</td><td class="r">${fmt(c.len_m, 1)} m</td><td class="r">${fmt(c.time_s)} s</td></tr>`; }).join('')}
  </tbody></table>
  <p class="src">${esc(t('route.src_speed', { kmh: walk.flat_speed_kmh }))}</p>

  <div class="chart" id="rt-profile"></div>

  <h3>${esc(t('route.h_hazard'))}</h3>
  <p>${ck(`${P}.hazards_5m`, esc(t('route.hz_count_5m', { n: S.n_hazards_15, len: fmt(S.len_over15_m, 1) })))};
     ${esc(t('route.hz_count_2m', { n: S.n_hazards_15_2m, len: fmt(S.len_over15_2m_m, 1) }))};
     ${esc(t('route.hz_count_25', { len5: fmt(S.len_over25_m, 1), len2: fmt(S.len_over25_2m_m, 1) }))}</p>
  ${hz.length ? `<table class="tbl"><thead><tr><th>#</th><th>${esc(t('route.at'))}</th><th>${esc(t('route.res_5m'))}</th><th>${esc(t('route.res_2m'))}</th><th>${esc(t('route.rover_tilt'))}</th></tr></thead><tbody>
    ${hz.map((h, i) => `<tr><td>${i + 1}</td><td class="num">${fmt(h.from_m)}–${fmt(h.to_m)} m</td>
      <td class="num">${h['5m'] ? `${fmt(h['5m'].from_m)}–${fmt(h['5m'].to_m)} m, ${fmt(h['5m'].len_m)} m, ${esc(t('route.max'))} ${fmt(h['5m'].max_slope_deg, 1)}°` : esc(t('route.not_found'))}</td>
      <td class="num">${h['2m'] ? `${fmt(h['2m'].from_m)}–${fmt(h['2m'].to_m)} m, ${fmt(h['2m'].len_m)} m, ${esc(t('route.max'))} ${fmt(h['2m'].max_slope_deg, 1)}°` : esc(t('route.not_found'))}</td>
      <td class="num" ${h.tilt ? `data-check="${P}.hz${i + 1}.tilt"` : ''}>${h.tilt ? `${fmt(h.tilt.tilt, 1)}° <span class="small">(sol ${h.tilt.sol}, ${fmt(h.tilt.d)} m)</span>` : '—'}</td></tr>`).join('')}
  </tbody></table>` : `<p>${esc(t('route.no_hazard'))}</p>`}
  <p class="note">${esc(t('route.hz_note', { win: 15 }))}</p>
  <p class="src">${esc(t('route.rover_tilt_summary', { n: S.rover_tilt.n, med: fmt(S.rover_tilt.median, 1), max: fmt(S.rover_tilt.max, 1), n15: S.rover_tilt.n_over15 }))}</p>

  <h3>${esc(t('route.h_dose'))}</h3>
  <p class="small">${esc(periodLabel)} · ${esc(t('rad.n_valid', { n: fmt(dose.nValid), s: dose.nSols }))} · ${esc(t('route.dose_time', { dur: dur(evaS) }))}</p>
  <table class="tbl"><thead><tr><th></th><th class="r">${esc(t('rad.rate'))}</th><th class="r">${esc(t('route.dose_eva'))}</th></tr></thead><tbody>
    <tr><td>${term('E', t('rad.body_E'))}</td><td class="r">${ck(`${P}.E_rate`, fmt(dose.E_rate, 3))} µGy/h</td><td class="r"><b>${ck(`${P}.dose_E`, fmt(dose.E, 1))} µGy</b></td></tr>
    <tr><td>${term('B', t('rad.equip_B'))}</td><td class="r">${ck(`${P}.B_rate`, fmt(dose.B_rate, 3))} µGy/h</td><td class="r"><b>${ck(`${P}.dose_B`, fmt(dose.B, 1))} µGy(Si)</b></td></tr>
    ${dose.spike ? `
    <tr><td>${esc(t('rad.spike_day_E', { sol: dose.spike.sol }))}</td><td class="r">${fmt(dose.spike.E_rate, 3)} µGy/h</td><td class="r">${ck(`${P}.dose_E_spike`, fmt(dose.spike.E, 1))} µGy</td></tr>
    <tr><td>${esc(t('rad.spike_day_B', { sol: dose.spike.sol }))}</td><td class="r">${fmt(dose.spike.B_rate, 3)} µGy/h</td><td class="r">${ck(`${P}.dose_B_spike`, fmt(dose.spike.B, 1))} µGy(Si)</td></tr>` : ''}
  </tbody></table>
  ${dose.spike ? `<p class="small">${esc(t('rad.spike_route_note', { sol: dose.spike.sol }))}</p>` : `<p class="small">${esc(t('rad.no_spike_period'))}</p>`}
  <table class="kv"><tr><th>${esc(t('rad.year_equip'))}</th><td>${ck(`${P}.B_year_mGy`, fmt(dose.B_year_mGy, 1))} mGy(Si) = ${fmt(dose.B_year_mGy / 10, 2)} rad(Si)</td></tr></table>
  <p class="src">${esc(t('rad.src_route'))}</p>
  <p class="note">${esc(t('rad.limits_short'))}</p>

  <h3>${esc(t('route.h_thermal'))}</h3>
  <div class="row"><label for="rt-ls">${term('Ls', t('temp.season'))}</label>
    <select id="rt-ls">${lsBins(remsR).map((b) => `<option value="${b}" ${b === ls ? 'selected' : ''}>Ls ${b}–${Number(b) + 30}° (${remsR.diurnal_by_ls30[b].sols} sols)</option>`).join('')}</select></div>
  <table class="kv">
    <tr><th>${esc(t('temp.gts_min'))}</th><td>${ck(`${P}.gts_min`, tempCK(cs.min, 1))}</td></tr>
    <tr><th>${esc(t('temp.gts_max'))}</th><td>${tempCK(cs.max, 1)}</td></tr>
    <tr><th>${esc(t('temp.swing'))}</th><td>${ck(`${P}.gts_range`, fmt(cs.range, 1) + ' K')}</td></tr>
    <tr><th>${esc(t('temp.h_below40'))}</th><td>${ck(`${P}.h_below40`, String(cs.hBelow40))} / ${cs.nValid} h${cs.nMissing ? ` <span class="small">(${esc(t('temp.missing_h', { n: cs.nMissing }))})</span>` : ''}</td></tr>
    <tr><th>${esc(t('temp.h_below55'))}</th><td>${cs.hBelow55} / ${cs.nValid} h</td></tr>
    <tr><th>${esc(t('temp.period_swing'))}</th><td>${ck(`${P}.range_mean_K`, fmt(remsR.summary.range_mean_K, 1) + ' K')} <span class="small">(${esc(t('temp.n_full_sols', { n: remsR.summary.n_sols_hours_ge_20 }))})</span></td></tr>
    <tr><th>${esc(t('temp.uncertainty'))}</th><td>± ${fmt(remsR.summary.mean_long_term_uncertainty_K, 2)} K</td></tr>
  </table>
  <div class="chart" id="rt-diurnal"></div>
  <p class="note">${esc(t('temp.surface_note'))}</p>

  <h3>${esc(t('route.h_surface'))}</h3>
  <table class="kv">
    <tr><th>${term('TI')}</th><td>${ck(`${P}.ti_mean`, fmt(S.thermal_inertia_tiu.mean, 1))} TIU <span class="small">(${esc(t('route.minmax', { min: fmt(S.thermal_inertia_tiu.min), max: fmt(S.thermal_inertia_tiu.max) }))})</span></td></tr>
    <tr><th>${esc(t('route.nir'))}</th><td>${fmt(S.night_ir_dn.mean, 1)} DN <span class="small">(${esc(t('route.minmax', { min: S.night_ir_dn.min, max: S.night_ir_dn.max }))}; ${esc(t('route.nir_note'))})</span></td></tr>
  </table>
  <p class="src">${esc(t('route.src_surface'))}</p>

  <h3>${esc(t('route.h_comms'))}</h3>
  <p>${ck(`${P}.comms_out_m`, fmt(S.comms_out_m, 1) + ' m')} ${esc(t('route.comms_out', { pct: fmt(S.comms_out_share * 100, 1), n: S.n_comms_gaps }))}</p>
  <ul>${R.comms_gaps.map((g) => `<li class="num">${fmt(g.from_m)}–${fmt(g.to_m)} m (${fmt(g.len_m)} m)</li>`).join('')}</ul>
  <p class="src">${esc(t('route.src_comms', { h: config.comms.antenna_height_m }))}</p>

  <h3>${esc(t('route.h_photos'))}</h3>
  ${near.length ? `<p class="small">${esc(t('route.photos_near', { n: near.length, m: 30 }))}</p>${thumbsHtml(near.map((x) => x.photo), 24)}` : `<p>${esc(t('route.no_photos'))}</p>`}

  <h3>${esc(t('route.h_eva_links'))}</h3>
  <div class="row"><label for="rt-start">${esc(t('route.start_lmst'))}</label>
    <select id="rt-start">${Array.from({ length: 24 }, (_, h) => `<option value="${h}" ${h === startH ? 'selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('')}</select>
    <span class="small">${esc(t('route.start_note'))}</span></div>
  <div class="btnrow">
    <a class="btn" id="btn-eva" role="button">${esc(t('route.open_eva'))}</a>
    <a class="btn" id="btn-cuff" role="button">${esc(t('route.print_cuff'))}</a>
  </div>
  <p class="small" id="eva-note" hidden>${esc(t('route.eva_later'))}</p>

  <details id="assumptions"><summary>${esc(t('assume.title'))}</summary>${assumptionsHtml(ctx)}</details>
  `;

  // elevation profile with hazard (5 m) and line-of-sight gap bands
  const Sm = R.samples;
  lineChart(el.querySelector('#rt-profile'), {
    title: t('route.profile_title'),
    caption: t('route.profile_cap'),
    xLabel: t('route.axis_d'), yLabel: t('route.axis_elev'), xName: t('route.axis_d_short'), yUnit: 'm',
    series: [{ name: t('route.elev_dem'), color: 'var(--series-1)', points: Sm.d_m.map((d, i) => [d, Sm.elev_m[i]]) }],
    bands: [
      ...R.comms_gaps.map((g) => ({ x0: g.from_m, x1: g.to_m, label: t('legend.no_los'), fill: 'var(--series-4)', opacity: 0.12 })),
      ...R.hazards.map((h) => ({ x0: h.from_m, x1: h.to_m, label: t('route.hazard'), fill: '#fd8d3c', opacity: 0.8 })),
    ],
    marks: R.stations.filter((s) => s.reason === 'stop').map((s) => ({ x: s.d_m, y: s.elev_m, label: s.id, anchor: s.kind === 'dest' ? 'end' : 'start' })),
    xFmt: (v) => fmt(v), yFmt: (v) => fmt(v), tipY: (v) => fmt(v, 1),
    table: { summary: t('ui.table'), cols: [t('route.axis_d'), t('route.axis_elev'), t('route.slope5'), t('route.vis')],
      rows: Sm.d_m.map((d, i) => [d, Sm.elev_m[i], Sm.slope_deg[i], Sm.vis[i]]), thinned: t('ui.thinned') },
  });
  lineChart(el.querySelector('#rt-diurnal'), {
    title: t('temp.diurnal_title_route', { ls, ls2: Number(ls) + 30 }),
    caption: t('temp.cap', { a: remsR.meta.period_sols[0], b: remsR.meta.period_sols[1], n: remsR.diurnal_by_ls30[ls].sols }),
    xLabel: t('temp.axis_lmst'), yLabel: t('temp.axis_c'), xName: 'LMST', yUnit: '°C',
    xDomain: [0, 24], xTicks: [0, 6, 12, 18, 24],
    series: [{ name: t('temp.ground'), color: 'var(--series-2)', points: cv.map((k, h) => [h + 0.5, k === null ? null : k - 273.15]), markers: true }],
    refLines: [{ value: K_MINUS40 - 273.15, label: '−40 °C' }, { value: K_MINUS55 - 273.15, label: '−55 °C', dash: '1 3' }],
    yFmt: (v) => fmt(v), tipY: (v) => fmt(v, 1), xFmt: (v) => fmt(v), tipX: (v) => `${fmt(v - 0.5)}–${fmt(v + 0.5)} h`,
  });

  // buttons and events
  el.querySelectorAll('[data-route]').forEach((b) => b.addEventListener('click', () => ctx.selectRoute(b.dataset.route)));
  el.querySelector('#rt-ls').addEventListener('change', (e) => { state.ls[rid] = e.target.value; ctx.rerender('route'); });
  // Links to EVA mode and the cuff checklist (contract: Plan/13 sec.2). Same season key as the temperature selector.
  const evaHref = `eva.html?route=${rid}&start=${state.startH ?? 10}&season=${ls}&scenario=normal`;
  const cuffHref = `cuff.html?route=${rid}&start=${state.startH ?? 10}&season=${ls}`;
  const links = [[el.querySelector('#btn-eva'), evaHref, 'eva'], [el.querySelector('#btn-cuff'), cuffHref, 'cuff']];
  for (const [a, href] of links) { a.href = href; a.classList.add('primary'); }
  el.querySelector('#rt-start').addEventListener('change', (e) => {
    state.startH = Number(e.target.value);
    links[0][0].href = `eva.html?route=${rid}&start=${state.startH}&season=${ls}&scenario=normal`;
    links[1][0].href = `cuff.html?route=${rid}&start=${state.startH}&season=${ls}`;
  });
  // a link to a page that is not deployed yet is shown as unavailable instead of leading to a 404
  ctx.pages.then((pages) => {
    let missing = false;
    for (const [a, , key] of links) {
      if (!pages[key]) {
        missing = true;
        a.classList.remove('primary');
        a.setAttribute('aria-disabled', 'true');
        a.addEventListener('click', (e) => e.preventDefault());
      }
    }
    if (missing) el.querySelector('#eva-note').hidden = false;
  });
}
