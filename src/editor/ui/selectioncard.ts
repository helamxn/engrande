/**
 * Pestaña Selección: muestra solo los controles de lo seleccionado (texto, imagen o varias) y, sin nada, una nota.
 * Qué pestaña se abre al seleccionar o deseleccionar lo decide panel.ts (followSelection).
 */
import { alignSelected, compositionUnits, distributeSelected, flip, groupName, rotate90, select, selectedGroup, setFigureFill } from '../actions';
import type { AlignEdge } from '../geometry';
import { $ } from '../dom';
import { st } from '../state';
import { commitPending, setPending, takeSnap } from '../history';
import type { Layer } from '../types';
import { fitSelection } from '../view';
import { isText } from '../text/text';
import { normalizeColor } from '../text/values';

/** Lo que hay seleccionado (una capa, el primero de varios o nada): cambia cuando se elige otra cosa. */
export const selectionKey = () => st.sel ?? (st.group.length > 1 ? st.group[0]! : null);

/** Pone al día la pestaña. Devuelve si hay algo seleccionado. */
export function syncSelectionCard(): boolean {
  const sel = st.sel, n = st.group.length, key = selectionKey(), has = key != null;
  $('#selEmpty').hidden = has;
  $('#selectionHead').hidden = !has;
  $<HTMLButtonElement>('#zoomSelection').disabled = !has || !!sel?.hidden;
  const gid = n > 1 ? selectedGroup() : null;
  $('#selectionTitle').textContent = n > 1 ? (gid != null ? `${groupName(gid)} · ${n} capas` : `${n} capas seleccionadas`)
    : isText(sel) ? 'Texto' : sel?.src?.kind === 'shape' ? 'Forma' : 'Imagen';
  $('#figureField').hidden = sel?.src?.kind !== 'shape';
  if (sel?.src?.kind === 'shape') {
    // con el selector abierto no se pisa lo que se está eligiendo
    if (fillSession?.layer !== sel) $<HTMLInputElement>('#figureFill').value = sel.src.spec.fill;
    const hex = $<HTMLInputElement>('#figureHex');
    if (document.activeElement !== hex) {
      hex.value = sel.src.spec.fill; hex.removeAttribute('aria-invalid'); $('#figureError').hidden = true;
    }
  }
  if (n > 1) {
    // con varias: repartir pide 3 o más
    const count = compositionUnits().length;
    $('#lblGAlign').textContent = count === 1 ? 'Alinear con el póster' : 'Alinear entre sí';
    for (const b of document.querySelectorAll<HTMLButtonElement>('#gDist button')) b.disabled = count < 3;
    $('#gDistNote').textContent = count < 3 ? '3 elementos o más' : '';
  }
  return has;
}

/**
 * Selector de color de una forma abierto: se aplica en vivo (vista previa en el lienzo) y todo cuenta como un solo paso
 * de deshacer. Va a la forma en la que se abrió aunque, al cerrarlo con un clic en el lienzo, se deseleccione.
 */
let fillSession: { layer: Layer } | null = null;

export function initSelectionCard() {
  const fill = $<HTMLInputElement>('#figureFill');
  fill.addEventListener('input', () => {
    const l = fillSession?.layer ?? st.sel;
    if (!l || l.src?.kind !== 'shape' || l.locked) return;
    if (!fillSession) { fillSession = { layer: l }; setPending(takeSnap()); }
    if (l.src.spec.fill === fill.value) return;
    commitPending(); // el paso de deshacer se guarda con el primer cambio, no al abrir
    setFigureFill(fill.value, l, false);
  });
  fill.addEventListener('change', () => {
    const l = fillSession?.layer ?? st.sel;
    if (fillSession) { commitPending(); setFigureFill(fill.value, l, false); fillSession = null; setPending(null); }
    else setFigureFill(fill.value, l);
    syncSelectionCard();
  });
  // al cerrar el selector sin «change» (Esc, o el navegador no lo manda): lo aplicado en vivo se queda y la sesión acaba,
  // para que el siguiente color no vaya a esta forma si luego se elige otra
  fill.addEventListener('blur', () => { if (fillSession) { fillSession = null; setPending(null); syncSelectionCard(); } });
  const hex = $<HTMLInputElement>('#figureHex');
  hex.addEventListener('change', () => {
    const color = normalizeColor(hex.value);
    $('#figureError').hidden = !!color;
    hex.setAttribute('aria-invalid', String(!color));
    if (color) { hex.value = color; setFigureFill(color); }
  });
  hex.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { hex.value = fill.value; $('#figureError').hidden = true; hex.removeAttribute('aria-invalid'); hex.blur(); }
    if (e.key === 'Enter') hex.blur();
  });
  $('#zoomSelection').addEventListener('click', fitSelection);
  for (const b of document.querySelectorAll<HTMLButtonElement>('#gAlign [data-e]')) b.addEventListener('click', () => alignSelected(b.dataset.e as AlignEdge));
  for (const b of document.querySelectorAll<HTMLButtonElement>('#gDist [data-a]')) b.addEventListener('click', () => distributeSelected(b.dataset.a === 'y' ? 'y' : 'x'));
  $('#pRot90').addEventListener('click', rotate90(1));
  $('#pFlipX').addEventListener('click', flip('x'));
  $('#selectionClose').addEventListener('click', () => {
    select(null); document.querySelector<HTMLCanvasElement>('#cv')?.focus();
  });
}
