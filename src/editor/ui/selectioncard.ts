/**
 * Pestaña Selección: muestra solo los controles de lo seleccionado (texto, imagen o varias) y, sin nada, una nota.
 * Qué pestaña se abre al seleccionar o deseleccionar lo decide panel.ts (followSelection).
 */
import { alignSelected, distributeSelected, flip, groupName, rotate90, select, selectedGroup } from '../actions';
import type { AlignEdge } from '../geometry';
import { $ } from '../dom';
import { st } from '../state';
import { isText } from '../text/text';

/** Lo que hay seleccionado (una capa, el primero de varios o nada): cambia cuando se elige otra cosa. */
export const selectionKey = () => st.sel ?? (st.group.length > 1 ? st.group[0]! : null);

/** Pone al día la pestaña. Devuelve si hay algo seleccionado. */
export function syncSelectionCard(): boolean {
  const sel = st.sel, n = st.group.length, key = selectionKey(), has = key != null;
  $('#selEmpty').hidden = has;
  $('#selectionHead').hidden = !has;
  const gid = n > 1 ? selectedGroup() : null;
  $('#selectionTitle').textContent = n > 1 ? (gid != null ? `${groupName(gid)} · ${n} capas` : `${n} capas seleccionadas`)
    : isText(sel) ? 'Texto' : 'Imagen';
  if (n > 1) {
    // con varias: repartir pide 3 o más
    for (const b of document.querySelectorAll<HTMLButtonElement>('#gDist button')) b.disabled = n < 3;
    $('#gDistNote').textContent = n < 3 ? '3 o más' : '';
  }
  return has;
}

export function initSelectionCard() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#gAlign [data-e]')) b.addEventListener('click', () => alignSelected(b.dataset.e as AlignEdge));
  for (const b of document.querySelectorAll<HTMLButtonElement>('#gDist [data-a]')) b.addEventListener('click', () => distributeSelected(b.dataset.a === 'y' ? 'y' : 'x'));
  $('#pRot90').addEventListener('click', rotate90(1));
  $('#pFlipX').addEventListener('click', flip('x'));
  $('#selectionClose').addEventListener('click', () => {
    select(null); document.querySelector<HTMLCanvasElement>('#cv')?.focus();
  });
}
