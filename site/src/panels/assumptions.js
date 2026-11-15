// "Assumptions" disclosure: every value of site/data/config.json (exported from scripts/config.json by
// scripts/50_export_config.py) plus the speed rule recorded in routes.json meta. Shared with EVA mode.
import { t, escapeHtml as esc } from '../i18n.js';

const SECTIONS = ['walk', 'comms', 'eva', 'route_method', 'rad', 'rems', 'crs'];

function label(sec, key) {
  const k = `assume.keys.${sec}.${key}`;
  const s = t(k);
  return s === k ? key : s;
}
function val(v) {
  if (Array.isArray(v)) return v.join(', ');
  if (v && typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

export function assumptionsHtml(ctx) {
  const cfg = ctx.core.config;
  const rule = ctx.core.routes.meta.speed_rule;
  let h = `<p class="small">${esc(t('assume.intro'))}</p>`;
  h += `<h4>${esc(t('assume.sec.speed_rule'))}</h4><table class="tbl"><tbody>
    <tr><td>${esc(t('assume.flat_speed'))}</td><td class="r num">${rule.flat_speed_kmh} km/h</td></tr>
    ${rule.classes.map((c) => `<tr><td>${c.slope_deg[0]}–${c.slope_deg[1]}°</td><td class="r num">${c.factor === 0 ? esc(t('route.impassable')) : '×' + c.factor}</td></tr>`).join('')}
    <tr><td colspan="2" class="small">${esc(rule.segment_rule)} · ${esc(rule.source)}</td></tr></tbody></table>`;
  for (const sec of SECTIONS) {
    const o = cfg[sec];
    if (!o) continue;
    const rows = Object.entries(o).filter(([k]) => !k.startsWith('_'));
    const src = o._source || o._speed_rule || '';
    h += `<h4>${esc(t('assume.sec.' + sec))}</h4><table class="tbl" data-assume="${sec}"><tbody>
      ${rows.map(([k, v]) => `<tr><td>${esc(label(sec, k))}</td><td class="r num">${esc(val(v))}</td></tr>`).join('')}
      </tbody></table>${src ? `<p class="src">${esc(src)}</p>` : ''}`;
  }
  h += `<p class="src">${esc(t('assume.footer'))}</p>`;
  return h;
}
