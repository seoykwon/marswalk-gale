// Small shared SVG chart module: line, scatter, bar. No external library (Plan/03 5-2).
// Every chart gets: title, caption (data period / source), axis labels with units, legend for >= 2 series,
// hover tooltip, and a data table in a <details> for keyboard / screen-reader access.
// Colours are CSS variables (src/app.css) so light/dark steps come from one place.
import { escapeHtml as esc } from './i18n.js';

const W = 400, H = 220;
const M = { l: 50, r: 14, t: 12, b: 40 };
let uid = 0;

function niceStep(span, n) {
  const raw = span / n;
  const p = 10 ** Math.floor(Math.log10(raw));
  const e = raw / p;
  return (e >= 5 ? 10 : e >= 2 ? 5 : e >= 1 ? 2 : 1) * p;
}
function linTicks(lo, hi, n = 5) {
  const s = niceStep(hi - lo || 1, n);
  const out = [];
  for (let v = Math.ceil(lo / s - 1e-9) * s; v <= hi + s * 1e-6; v += s) out.push(+v.toPrecision(12));
  return out;
}
function logTicks(lo, hi) {
  const out = [];
  for (let e = Math.floor(Math.log10(lo)); e <= Math.ceil(Math.log10(hi)); e++) {
    const v = 10 ** e;
    if (v >= lo * 0.999 && v <= hi * 1.001) out.push(v);
  }
  return out;
}
function extent(vals) {
  let lo = Infinity, hi = -Infinity;
  for (const v of vals) if (v !== null && Number.isFinite(v)) { if (v < lo) lo = v; if (v > hi) hi = v; }
  return [lo, hi];
}
function makeScale(domain, range, log) {
  let [d0, d1] = domain;
  if (log) { d0 = Math.log10(d0); d1 = Math.log10(d1); }
  const k = (range[1] - range[0]) / ((d1 - d0) || 1);
  const f = (v) => range[0] + ((log ? Math.log10(v) : v) - d0) * k;
  f.inv = (p) => { const v = d0 + (p - range[0]) / k; return log ? 10 ** v : v; };
  return f;
}
function padDomain([lo, hi], log, pad = 0.05, zero = false) {
  if (log) return [lo, hi];
  if (zero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  const s = (hi - lo) || Math.abs(hi) || 1;
  return [zero && lo === 0 ? 0 : lo - s * pad, hi + s * pad];
}
const defFmt = (v) => {
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 1e5)) return v.toExponential(0);
  return (+v.toPrecision(6)).toLocaleString('en-US', { maximumFractionDigits: 3 });
};

function frame(el, o, svgInner, legendItems) {
  const id = `ch${++uid}`;
  const legend = legendItems && legendItems.length >= 2
    ? `<div class="lgd">${legendItems.map((s) =>
      `<span><i class="${s.dot ? 'dot' : ''} ${s.dash ? 'dash' : ''}" style="${s.dot ? 'background' : 'border-top-color'}:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`
    : '';
  el.innerHTML = `<figure class="chart" style="margin:0">
    ${o.title ? `<p class="ttl" id="${id}-t">${esc(o.title)}</p>` : ''}
    ${o.caption ? `<p class="cap">${esc(o.caption)}</p>` : ''}
    ${legend}
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-labelledby="${id}-t" preserveAspectRatio="xMidYMid meet">${svgInner}
      <rect class="hit" x="${M.l}" y="${M.t}" width="${W - M.l - M.r}" height="${H - M.t - M.b}" fill="transparent"/>
      <g class="hover"></g></svg>
    <div class="tip" hidden></div>
    ${o.table ? tableHtml(o.table) : ''}
  </figure>`;
  return el.querySelector('figure');
}

function tableHtml(tb) {
  const rows = tb.rows.length > 400 ? tb.rows.filter((_, i) => i % Math.ceil(tb.rows.length / 400) === 0) : tb.rows;
  return `<details><summary class="small">${esc(tb.summary || 'Data table')}</summary>
    <div style="max-height:220px;overflow:auto"><table class="tbl"><thead><tr>${tb.cols.map((c) => `<th class="r">${esc(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => `<tr>${r.map((v) => `<td class="r">${v === null || v === undefined ? '—' : esc(typeof v === 'number' ? defFmt(v) : v)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    ${rows.length < tb.rows.length ? `<p class="small">${esc(tb.thinned || '')}</p>` : ''}</details>`;
}

function axesSvg(o, sx, sy, xd, yd) {
  const x0 = M.l, x1 = W - M.r, y0 = H - M.b, y1 = M.t;
  const xt = o.xTicks || (o.xLog ? logTicks(...xd) : linTicks(...xd, 6));
  const yt = o.yTicks || (o.yLog ? logTicks(...yd) : linTicks(...yd, 5));
  const xf = o.xFmt || defFmt, yf = o.yFmt || defFmt;
  let s = '<g class="axis">';
  for (const v of yt) {
    const y = sy(v);
    if (y < y1 - 0.5 || y > y0 + 0.5) continue;
    s += `<line class="gridl" x1="${x0}" x2="${x1}" y1="${y}" y2="${y}"/>`;
    s += `<text x="${x0 - 5}" y="${y + 3.5}" text-anchor="end">${esc(yf(v))}</text>`;
  }
  for (const v of xt) {
    const x = sx(v);
    if (x < x0 - 0.5 || x > x1 + 0.5) continue;
    s += `<line x1="${x}" x2="${x}" y1="${y0}" y2="${y0 + 4}"/>`;
    s += `<text x="${x}" y="${y0 + 15}" text-anchor="middle">${esc(xf(v))}</text>`;
  }
  s += `<line x1="${x0}" x2="${x1}" y1="${y0}" y2="${y0}"/>`;
  s += `<text x="${(x0 + x1) / 2}" y="${H - 6}" text-anchor="middle">${esc(o.xLabel || '')}</text>`;
  s += `<text transform="translate(12 ${(y0 + y1) / 2}) rotate(-90)" text-anchor="middle">${esc(o.yLabel || '')}</text>`;
  return s + '</g>';
}

function refSvg(o, sx, sy, xd, yd) {
  let s = '';
  const x0 = M.l, x1 = W - M.r, y0 = H - M.b, y1 = M.t;
  for (const b of o.bands || []) {
    const a = Math.max(x0, sx(b.x0)), c = Math.min(x1, sx(b.x1));
    if (c <= a) continue;
    s += `<rect x="${a}" y="${y1}" width="${Math.max(1.5, c - a)}" height="${y0 - y1}" fill="${b.fill || 'var(--warn-border)'}" opacity="${b.opacity ?? 0.25}"><title>${esc(b.label || '')}</title></rect>`;
  }
  for (const r of o.refLines || []) {
    if (r.axis === 'x') {
      const x = sx(r.value);
      if (x < x0 || x > x1) continue;
      s += `<line x1="${x}" x2="${x}" y1="${y1}" y2="${y0}" stroke="var(--ref-line)" stroke-width="1" stroke-dasharray="${r.dash || '4 3'}"/>`;
      if (r.label) s += `<text class="reflab" x="${x + 3}" y="${y1 + 9}">${esc(r.label)}</text>`;
    } else {
      const y = sy(r.value);
      if (y < y1 || y > y0) continue;
      s += `<line x1="${x0}" x2="${x1}" y1="${y}" y2="${y}" stroke="var(--ref-line)" stroke-width="1" stroke-dasharray="${r.dash || '4 3'}"/>`;
      if (r.label) s += `<text class="reflab" x="${x1 - 2}" y="${y - 3}" text-anchor="end">${esc(r.label)}</text>`;
    }
  }
  return s;
}

function attachHover(fig, handler) {
  const svg = fig.querySelector('svg');
  const tip = fig.querySelector('.tip');
  const hover = svg.querySelector('.hover');
  const toLocal = (ev) => {
    const r = svg.getBoundingClientRect();
    return [(ev.clientX - r.left) * W / r.width, (ev.clientY - r.top) * H / r.height, r];
  };
  svg.addEventListener('pointermove', (ev) => {
    const [px, py, r] = toLocal(ev);
    const res = handler(px, py);
    if (!res) { tip.hidden = true; hover.innerHTML = ''; return; }
    hover.innerHTML = res.svg || '';
    tip.innerHTML = res.html;
    tip.hidden = false;
    const fr = fig.getBoundingClientRect();
    let left = ev.clientX - fr.left + 12;
    if (left + tip.offsetWidth > fr.width) left = ev.clientX - fr.left - tip.offsetWidth - 12;
    tip.style.left = Math.max(0, left) + 'px';
    tip.style.top = (ev.clientY - fr.top + 12) + 'px';
  });
  svg.addEventListener('pointerleave', () => { tip.hidden = true; hover.innerHTML = ''; });
}

function domains(o, allPts, zeroY = false) {
  let xd = o.xDomain || extent(allPts.map((p) => p[0]));
  let yd = o.yDomain || padDomain(extent(allPts.map((p) => p[1])), o.yLog, 0.06, zeroY);
  for (const r of o.refLines || []) {
    if (!o.yDomain && r.axis !== 'x' && r.extend !== false) yd = [Math.min(yd[0], r.value), Math.max(yd[1], r.value)];
  }
  if (o.yDomain === undefined && !o.yLog) yd = padDomain(yd, false, 0.02);
  return [xd, yd];
}

/** Line chart. series: [{name, color, points:[[x,y]...], dash, width}] (y null = gap). */
export function lineChart(el, o) {
  const all = o.series.flatMap((s) => s.points.filter((p) => p[1] !== null));
  const [xd, yd] = domains(o, all, o.zeroY);
  const sx = makeScale(xd, [M.l, W - M.r], o.xLog);
  const sy = makeScale(yd, [H - M.b, M.t], o.yLog);
  let body = axesSvg(o, sx, sy, xd, yd) + refSvg(o, sx, sy, xd, yd);
  for (const s of o.series) {
    let d = '', pen = false;
    for (const [x, y] of s.points) {
      if (y === null || !Number.isFinite(y)) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${sx(x).toFixed(1)},${sy(y).toFixed(1)}`;
      pen = true;
    }
    body += `<path d="${d}" fill="none" stroke="${s.color}" stroke-width="${s.width || 2}" stroke-linejoin="round" stroke-linecap="round" ${s.dash ? `stroke-dasharray="${s.dash}"` : ''}/>`;
    if (s.markers) for (const [x, y] of s.points) if (y !== null) body += `<circle cx="${sx(x)}" cy="${sy(y)}" r="2.6" fill="${s.color}"/>`;
  }
  for (const m of o.marks || []) {
    const x = sx(m.x), y = m.y !== undefined ? sy(m.y) : M.t + 8;
    body += `<g><circle cx="${x}" cy="${y}" r="5" fill="none" stroke="var(--text)" stroke-width="1.5"/>
      <text class="reflab" x="${x + (m.anchor === 'end' ? -8 : 8)}" y="${y + 3.5}" text-anchor="${m.anchor || 'start'}" style="font-weight:600">${esc(m.label)}</text></g>`;
  }
  const fig = frame(el, o, body, o.series.map((s) => ({ name: s.name, color: s.color, dash: s.dash })));
  const xf = o.tipX || o.xFmt || defFmt;
  attachHover(fig, (px) => {
    if (px < M.l || px > W - M.r) return null;
    const xv = sx.inv(px);
    const rows = [];
    let snapX = null;
    for (const s of o.series) {
      let best = null;
      for (const p of s.points) if (p[1] !== null && (!best || Math.abs(p[0] - xv) < Math.abs(best[0] - xv))) best = p;
      if (!best) continue;
      if (snapX === null) snapX = best[0];
      rows.push({ s, p: best });
    }
    if (snapX === null) return null;
    const cx = sx(snapX);
    return {
      svg: `<line x1="${cx}" x2="${cx}" y1="${M.t}" y2="${H - M.b}" stroke="var(--axis)" stroke-width="1"/>` +
        rows.map(({ s, p }) => `<circle cx="${sx(p[0])}" cy="${sy(p[1])}" r="4" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`).join(''),
      html: `<b>${esc(o.xName || o.xLabel || '')}: ${esc(xf(snapX))}</b><br>` +
        rows.map(({ s, p }) => `${esc(s.name)}: ${esc((o.tipY || o.yFmt || defFmt)(p[1]))}${o.yUnit ? ' ' + esc(o.yUnit) : ''}`).join('<br>'),
    };
  });
  return fig;
}

/** Scatter chart. series: [{name, color, points:[[x,y,label?]...]}]. */
export function scatterChart(el, o) {
  const all = o.series.flatMap((s) => s.points);
  const [xd0, yd] = domains(o, all);
  const xd = o.xDomain || padDomain(xd0, o.xLog, 0.03);
  const sx = makeScale(xd, [M.l, W - M.r], o.xLog);
  const sy = makeScale(yd, [H - M.b, M.t], o.yLog);
  let body = axesSvg(o, sx, sy, xd, yd) + refSvg(o, sx, sy, xd, yd);
  const r = o.r || 2.2;
  for (const s of o.series) {
    body += `<g fill="${s.color}" fill-opacity="${o.opacity ?? 0.55}">` +
      s.points.map((p) => `<circle cx="${sx(p[0]).toFixed(1)}" cy="${sy(p[1]).toFixed(1)}" r="${r}"/>`).join('') + '</g>';
  }
  const fig = frame(el, o, body, o.series.map((s) => ({ name: s.name, color: s.color, dot: true })));
  attachHover(fig, (px, py) => {
    let best = null, bd = 144;
    for (const s of o.series) for (const p of s.points) {
      const d = (sx(p[0]) - px) ** 2 + (sy(p[1]) - py) ** 2;
      if (d < bd) { bd = d; best = { s, p }; }
    }
    if (!best) return null;
    const { s, p } = best;
    return {
      svg: `<circle cx="${sx(p[0])}" cy="${sy(p[1])}" r="5" fill="${s.color}" stroke="var(--surface)" stroke-width="2"/>`,
      html: `${esc(s.name)}<br>${esc(o.xName || o.xLabel)}: ${esc((o.xFmt || defFmt)(p[0]))}<br>${esc(o.yName || o.yLabel)}: ${esc((o.yFmt || defFmt)(p[1]))}${p[2] ? '<br>' + esc(p[2]) : ''}`,
    };
  });
  return fig;
}

/** Bar chart. categories: [label], series: [{name, color, values:[]}] (grouped if >1). Values may be negative. */
export function barChart(el, o) {
  const n = o.categories.length;
  const vals = o.series.flatMap((s) => s.values).filter((v) => v !== null);
  const yd = o.yDomain || padDomain(extent(vals), false, 0.06, true);
  const sy = makeScale(yd, [H - M.b, M.t], false);
  const bw = (W - M.l - M.r) / n;
  const gap = Math.min(2, bw * 0.15);
  const inner = (bw - gap * 2) / o.series.length;
  const sx = (i) => M.l + bw * (i + 0.5);
  const every = Math.ceil(n / (o.maxLabels || 12));
  const ax = {
    ...o,
    xTicks: [],
  };
  let body = axesSvg(ax, (v) => v, sy, [0, 1], yd);
  body += '<g class="axis">' + o.categories.map((c, i) => (i % every === 0
    ? `<text x="${sx(i)}" y="${H - M.b + 14}" text-anchor="middle">${esc(c)}</text>` : '')).join('') + '</g>';
  const zero = sy(Math.max(yd[0], Math.min(0, yd[1])));
  o.series.forEach((s, k) => {
    s.values.forEach((v, i) => {
      if (v === null) return;
      const x = M.l + bw * i + gap + inner * k;
      const y = sy(v);
      const top = Math.min(y, zero), h = Math.max(0.5, Math.abs(zero - y));
      body += `<rect x="${(x + 1).toFixed(1)}" y="${top.toFixed(1)}" width="${Math.max(1, inner - 2).toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(3, inner / 4)}" fill="${s.color}"/>`;
    });
  });
  body += refSvg(o, (v) => v, sy, [0, 1], yd);
  const fig = frame(el, o, body, o.series.map((s) => ({ name: s.name, color: s.color, dot: true })));
  attachHover(fig, (px) => {
    const i = Math.floor((px - M.l) / bw);
    if (i < 0 || i >= n) return null;
    return {
      svg: `<rect x="${M.l + bw * i}" y="${M.t}" width="${bw}" height="${H - M.t - M.b}" fill="var(--axis)" opacity="0.12"/>`,
      html: `<b>${esc(o.xName || o.xLabel || '')}: ${esc(o.categoryTip ? o.categoryTip(i) : o.categories[i])}</b><br>` +
        o.series.map((s) => `${esc(s.name)}: ${s.values[i] === null ? '—' : esc((o.yFmt || defFmt)(s.values[i]))}${o.yUnit ? ' ' + esc(o.yUnit) : ''}`).join('<br>'),
    };
  });
  return fig;
}
