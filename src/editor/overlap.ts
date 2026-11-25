/**
 * Mostrar u ocultar el solape en el lienzo: las franjas rosadas y las líneas discontinuas entre hojas.
 * Solo cambia la vista (el PDF sigue igual: sus marcas van en «Marcas de corte y de solape») y se recuerda en este
 * navegador. Mientras se ajusta el margen o el solape, las franjas se ven aunque estén ocultas.
 */
import { getPref, setPref } from './prefs';
import { posterGeo, sheetsVisible, st } from './state';
import { dirty } from './render';

/** Hay solape que enseñar: más de una hoja y un solape mayor que cero. */
const hasOverlap = () => { const g = posterGeo(); return g.cols * g.rows > 1 && g.ov > 0; };

/** Se dibujan las franjas: encendido, o ajustando el margen o el solape. */
export const overlapShown = () => st.showOverlap || st.showPaper;

/** Botón de la isla de vista: marcado si se ve; desactivado sin póster a la vista o sin solape. */
let shownBtn: string | null = null;
export function syncOverlapButton() {
  const btn = document.querySelector<HTMLButtonElement>('#overlapToggle');
  if (!btn) return;
  const can = sheetsVisible() && hasOverlap(), key = `${st.showOverlap}|${can}`;
  if (key === shownBtn) return;
  shownBtn = key;
  btn.setAttribute('aria-pressed', String(st.showOverlap));
  btn.disabled = !can;
}

export function toggleOverlap(on = !st.showOverlap) {
  st.showOverlap = on;
  setPref('overlap', on ? '1' : '0');
  syncOverlapButton();
  dirty();
}

export const canToggleOverlap = () => sheetsVisible() && hasOverlap();

export const initOverlap = () => { st.showOverlap = getPref('overlap') !== '0'; syncOverlapButton(); };
