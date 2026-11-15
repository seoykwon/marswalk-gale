// About pane: purpose, data sources by mission, what the map does not do, glossary (Plan/00 terms).
import { t, escapeHtml as esc } from '../i18n.js';

export function renderAboutPanel(el) {
  const g = t('glossary');
  el.innerHTML = `
  <h2>${esc(t('about.title'))}</h2>
  <p>${esc(t('about.intro'))}</p>
  <h3>${esc(t('about.sources'))}</h3>
  <ul>${t('about.source_list').map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
  <h3>${esc(t('about.not_done'))}</h3>
  <ul>${t('about.not_done_list').map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
  <h3>${esc(t('about.keys'))}</h3>
  <ul>${t('about.key_list').map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
  <h3>${esc(t('about.glossary'))}</h3>
  <dl>${Object.values(g).map((x) => `<dt><b>${esc(x.term)}</b></dt><dd style="margin:0 0 6px 12px">${esc(x.def)}</dd>`).join('')}</dl>
  <p class="about-more"><a id="about-home" href="index.html">${esc(t('about.home_link'))}</a></p>
  `;
}
