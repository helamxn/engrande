/**
 * Tarjeta de lo seleccionado: con algo seleccionado ocupa el panel en lugar de las pestañas (clase «inspecting» en el
 * body) y muestra solo los controles de eso. Al deseleccionar (✕, Esc o clic en el fondo) vuelven las pestañas, en la
 * que estaba abierta.
 */
import {
  alignSelected, distributeSelected, duplicateSelected, groupName, groupSelected, removeSelected, select, selectedGroup,
  ungroupSelected,
} from '../actions';
import type { AlignEdge } from '../geometry';
import { MOD, SHIFT } from '../platform';
import { $ } from '../dom';
import { st } from '../state';
import { isText } from '../text/text';
import { refreshSheet } from './layout';

let previous: unknown;

export function syncSelectionCard() {
  const sel = st.sel, n = st.group.length, has = !!sel || n > 1, key = sel ?? (n > 1 ? st.group[0] : null);
  if (key !== previous) {
    // en un texto, lo suyo (fuente, tamaño…) va primero y la posición queda plegada; en una imagen, abierta
    $<HTMLDetailsElement>('#selectionGeometry').open = !isText(sel);
    previous = key;
  }
  const was = document.body.classList.contains('inspecting');
  $('#selectionCard').hidden = !has;
  document.body.classList.toggle('inspecting', has);
  const gid = n > 1 ? selectedGroup() : null;
  $('#selectionTitle').textContent = n > 1 ? (gid != null ? `${groupName(gid)} · ${n} capas` : `${n} capas seleccionadas`)
    : isText(sel) ? 'Texto' : 'Imagen';
  if (n > 1) {
    // con varias: agrupar o, si son un grupo entero, desagrupar; repartir pide 3 o más
    const g = $<HTMLButtonElement>('#gGroup');
    g.querySelector('span')!.textContent = gid != null ? 'Desagrupar' : 'Agrupar';
    g.title = gid != null ? `Desagrupar (${MOD}${SHIFT}G)` : `Agrupar (${MOD}G)`;
    for (const b of document.querySelectorAll<HTMLButtonElement>('#gDist button')) b.disabled = n < 3;
    $('#gDistNote').textContent = n < 3 ? '3 o más' : '';
  }
  if (was !== has) refreshSheet(); // en el móvil, la hoja plegada deja ver la cabecera que toque
}

export function initSelectionCard() {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#gAlign [data-e]')) b.addEventListener('click', () => alignSelected(b.dataset.e as AlignEdge));
  for (const b of document.querySelectorAll<HTMLButtonElement>('#gDist [data-a]')) b.addEventListener('click', () => distributeSelected(b.dataset.a === 'y' ? 'y' : 'x'));
  $('#gGroup').addEventListener('click', () => { if (selectedGroup() != null) ungroupSelected(); else groupSelected(); });
  $('#gDup').addEventListener('click', duplicateSelected);
  $('#gRemove').addEventListener('click', removeSelected);
  $('#selectionClose').addEventListener('click', () => {
    select(null); document.querySelector<HTMLCanvasElement>('#cv')?.focus();
  });
}
