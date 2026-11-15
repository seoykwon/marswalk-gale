// Sources page renderer: reads data/sources.json (copy of sources/sources.json, scripts/65_sources_site.py).
const ROOT = new URL('../../', import.meta.url);
const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const NR = '<span class="nr">not recorded</span>';
const val = (v) => (!v || /^not (available|recorded)\.?$/i.test(String(v).trim())) ? NR : linkify(v);
function linkify(t) {
  return esc(t).replace(/https?:\/\/[^\s)&]+(?:&amp;[^\s)&]+)*/g, (u) => {
    const clean = u.replace(/[.,;]+$/, ''), tail = u.slice(clean.length);
    if (/[<>{}]|&lt;|&gt;/.test(clean) || !/^https?:\/\/[^/]+\.[a-z]+/i.test(clean)) return `<code>${clean}</code>${tail}`;
    return `<a href="${clean.replace(/&amp;/g, '&amp;')}" rel="noopener">${clean}</a>${tail}`;
  });
}
const SOFT = ['LEAFLET'];
function card(x) {
  const tmpl = /[<>{}]/.test(x.url);
  const url = !x.url ? NR : tmpl ? `<code>${esc(x.url)}</code> (request pattern, not a single link)` : `<a href="${esc(x.url)}" rel="noopener">${esc(x.url)}</a>`;
  const gaps = x.gap ? `<p class="gap"><strong>Not recorded:</strong> ${x.gap_items.map(esc).join('; ')}.</p>` : '';
  return `<article class="src" id="src-${esc(x.id)}"><h3>${esc(x.id)} · ${esc(x.title)}</h3>
<dl><dt>Used for</dt><dd>${val(x.used_for)}</dd><dt>URL</dt><dd>${url}</dd><dt>Credit</dt><dd>${val(x.credit)}</dd>
<dt>Licence / terms</dt><dd>${val(x.licence_or_terms)}</dd><dt>Citation</dt><dd>${val(x.citation)}</dd></dl>${gaps}
<details><summary>Notes (download dates, identification evidence)</summary><p>${val(x.notes)}</p></details></article>`;
}
async function main() {
  const r = await fetch(new URL('data/sources.json', ROOT)); if (!r.ok) throw new Error('sources.json ' + r.status);
  const d = await r.json();
  const data = d.datasets.filter((x) => !SOFT.includes(x.id)), soft = d.datasets.filter((x) => SOFT.includes(x.id));
  document.getElementById('src-summary').innerHTML = `<table><thead><tr><th>ID</th><th>Dataset</th><th>Status</th></tr></thead><tbody>${d.datasets.map((x) =>
    `<tr><td><a href="#src-${esc(x.id)}">${esc(x.id)}</a></td><td>${esc(x.title)}</td><td>${x.gap ? 'gaps: ' + x.gap_items.length + ' not recorded' : 'complete'}</td></tr>`).join('')}</tbody></table>`;
  document.getElementById('src-list').innerHTML = data.map(card).join('');
  document.getElementById('src-soft').innerHTML = soft.map(card).join('');
  document.getElementById('src-count').textContent = d.datasets.length;
  document.getElementById('src-gaps').textContent = d.datasets.filter((x) => x.gap).length;
  document.body.dataset.srcReady = '1';
}
main().catch((e) => { document.body.dataset.srcReady = 'error'; document.body.dataset.srcError = String(e.message || e); });
