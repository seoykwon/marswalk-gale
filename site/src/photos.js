// Rover photo thumbnails and the large-view dialog (M5). Position = rover waypoint at that time,
// not a photo geotag; the sol gap between photo and waypoint is shown (Plan/07 sec.3).
import { t, escapeHtml as esc } from './i18n.js';

let photosById = new Map();
let lastFocus = null;

export function registerPhotos(list) {
  photosById = new Map(list.map((p) => [p.id, p]));
}

export function thumbsHtml(list, max = 60) {
  return `<div class="thumbs">${list.slice(0, max).map((p) =>
    `<button type="button" data-photo="${esc(p.id)}" aria-label="${esc(t('photo.open', { title: p.title }))}">
      <img src="${esc(p.thumb)}" alt="" loading="lazy" width="90" height="90">
      <span class="cap">sol ${p.sol} · ${esc(p.camera)}</span></button>`).join('')}</div>`;
}

export function positionNote(p) {
  const gap = p.sol - p.wp_sol;
  return t('photo.position', { wp_sol: p.wp_sol, sol: p.sol, gap: gap === 0 ? t('photo.same_sol') : t('photo.gap', { n: Math.abs(gap), dir: gap > 0 ? t('photo.after') : t('photo.before') }) });
}

export function openPhoto(id) {
  const p = photosById.get(id);
  if (!p) return;
  const lb = document.getElementById('lightbox');
  lastFocus = document.activeElement;
  document.getElementById('lb-title').textContent = p.title;
  const img = document.getElementById('lb-img');
  img.src = p.full;
  img.alt = p.title;
  document.getElementById('lb-meta').innerHTML =
    `${esc(positionNote(p))}<br>${esc(p.date_utc.slice(0, 10))} UTC · ${esc(p.instrument)} · ${esc(p.id)}<br>` +
    `${esc(t('photo.credit'))}: ${esc(p.credit)} · <a href="${esc(p.source_url)}" target="_blank" rel="noopener">${esc(t('photo.source'))}</a>` +
    ` · ${esc(t('photo.raw_note'))}`;
  lb.hidden = false;
  lb.querySelector('.lb-close').focus();
}

export function setupLightbox() {
  const lb = document.getElementById('lightbox');
  const close = () => { lb.hidden = true; document.getElementById('lb-img').src = ''; if (lastFocus) lastFocus.focus(); };
  lb.querySelector('.lb-close').addEventListener('click', close);
  lb.addEventListener('click', (e) => { if (e.target === lb) close(); });
  document.addEventListener('keydown', (e) => {
    if (!lb.hidden && e.key === 'Escape') close();
    if (!lb.hidden && e.key === 'Tab') { // keep focus inside the dialog
      const f = [...lb.querySelectorAll('button, a[href]')];
      const i = f.indexOf(document.activeElement);
      e.preventDefault();
      f[(i + (e.shiftKey ? -1 : 1) + f.length) % f.length].focus();
    }
  });
  // delegated: any [data-photo] button anywhere (panels, popups)
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-photo]');
    if (b) openPhoto(b.dataset.photo);
  });
}
