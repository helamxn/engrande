/**
 * Pestaña Selección: muestra solo los controles de lo seleccionado (texto, imagen o varias) y, sin nada, una nota.
 * Qué pestaña se abre al seleccionar o deseleccionar lo decide panel.ts (followSelection).
 */
import {
  alignSelected, compositionUnits, distributeSelected, duplicateSelected, flip, groupName, groupSelected, hideSelected,
  lockSelected, removeSelected, reorder, rotate90, select, selected, selectedGroup, setFigureFill, toggleHidden, toggleLocked,
  ungroupSelected,
} from '../actions';
import { stackPeers } from '../groups';
import { ICON } from './icons';
import type { AlignEdge } from '../geometry';
import { $ } from '../dom';
import { st } from '../state';
import { commitPending, setPending, takeSnap } from '../history';
import type { Layer } from '../types';
import { fitSelection } from '../view';
import { isText } from '../text/text';
import { normalizeColor } from '../text/values';

/** Repartir deja la misma separación entre los bordes, con los dos extremos en su sitio: hacen falta tres o más. */
function syncDistribution(count: number) {
  $('#gDistField').hidden = count < 3;
}

/** Lo que hay seleccionado (una capa, el primero de varios o nada): cambia cuando se elige otra cosa. */
export const selectionKey = () => st.sel ?? (st.group.length > 1 ? st.group[0]! : null);

/** Pone al día la pestaña. Devuelve si hay algo seleccionado. */
export function syncSelectionCard(): boolean {
  const sel = st.sel, n = st.group.length, key = selectionKey(), has = key != null;
  $('#selEmpty').hidden = has;
  $('#selectionHead').hidden = !has;
  $('#selectionActions').hidden = !has;
  $<HTMLButtonElement>('#zoomSelection').disabled = !has || !!sel?.hidden;
  syncLayerActions();
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
    const count = compositionUnits().length;
    $('#lblGAlign').textContent = count === 1 ? 'Alinear con el póster' : 'Alinear';
    $('#gAlignTargetField').hidden = count < 2;
    $<HTMLSelectElement>('#gAlignTarget').value = st.alignToPoster ? 'poster' : 'selection';
    syncDistribution(count);
  }
  return has;
}

/**
 * Lo que se ordena (la capa o el grupo entero seleccionado; con varias sueltas, nada) y dónde está en su nivel.
 * Subir = hacia el frente, como arriba en la lista de Capas.
 */
function orderTarget() {
  const item = st.sel ?? (st.group.length > 1 ? selectedGroup() : null);
  if (item == null) return null;
  const { peers, index } = stackPeers(st.layers, item);
  return index < 0 ? null : { item, top: index === peers.length - 1, bottom: index === 0 };
}
/**
 * La fila de acciones (orden, duplicar, agrupar, eliminar) y ocultar y bloquear de la cabecera: activos según lo
 * seleccionado; agrupar, solo con varias (con un grupo entero, desagrupar); ocultar y bloquear, con su estado.
 */
let groupWhole: boolean | null = null;
function syncLayerActions() {
  const o = orderTarget(), sel = st.sel, many = st.group.length > 1;
  $<HTMLButtonElement>('#selFront').disabled = $<HTMLButtonElement>('#selUp').disabled = !o || o.top;
  $<HTMLButtonElement>('#selBack').disabled = $<HTMLButtonElement>('#selDown').disabled = !o || o.bottom;
  const del = $<HTMLButtonElement>('#selDelete'), dup = $<HTMLButtonElement>('#selDup');
  dup.disabled = !sel && !many;
  del.disabled = !sel && !many;
  const grp = $<HTMLButtonElement>('#selGroup'), whole = many && selectedGroup() != null;
  grp.hidden = !many;
  if (many && whole !== groupWhole) {
    groupWhole = whole;
    grp.innerHTML = ICON[whole ? 'ungroup' : 'group'];
    grp.setAttribute('aria-label', whole ? 'Desagrupar' : 'Agrupar');
    grp.title = whole ? 'Desagrupar (Ctrl + Mayús + G)' : 'Agrupar (Ctrl + G)';
  }
  const lock = $<HTMLButtonElement>('#selLock'), locked = !!sel?.locked;
  if (lock.getAttribute('aria-pressed') === String(locked)) return; // el icono solo se rehace si cambia
  lock.innerHTML = ICON[locked ? 'lock' : 'lockOpen'];
  lock.setAttribute('aria-pressed', String(locked));
  lock.setAttribute('aria-label', locked ? 'Desbloquear' : 'Bloquear');
  lock.title = `${locked ? 'Desbloquear' : 'Bloquear'} (Ctrl + Mayús + L)`;
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
  const order = (to: 'front' | 'back' | number) => () => { const o = orderTarget(); if (o) reorder(o.item, to); };
  $('#selFront').addEventListener('click', order('front'));
  $('#selUp').addEventListener('click', order(1));
  $('#selDown').addEventListener('click', order(-1));
  $('#selBack').addEventListener('click', order('back'));
  $('#selDup').addEventListener('click', () => duplicateSelected());
  $('#selGroup').addEventListener('click', () => { if (selectedGroup() != null) ungroupSelected(); else groupSelected(); });
  $('#selDelete').addEventListener('click', () => { if (selected().length) removeSelected(); });
  // ocultar deselecciona (en el lienzo ya no habría nada que tocar); se vuelve a mostrar desde Capas
  $('#selHide').addEventListener('click', () => { if (st.sel) toggleHidden(st.sel); else hideSelected(); });
  $('#selLock').addEventListener('click', () => { if (st.sel) toggleLocked(st.sel); else lockSelected(); });
  const target = $<HTMLSelectElement>('#gAlignTarget');
  target.addEventListener('change', () => { st.alignToPoster = target.value === 'poster'; });
  for (const b of document.querySelectorAll<HTMLButtonElement>('#gAlign [data-e]')) b.addEventListener('click', () => alignSelected(b.dataset.e as AlignEdge));
  for (const b of document.querySelectorAll<HTMLButtonElement>('#gDist [data-a]')) b.addEventListener('click', () => distributeSelected(b.dataset.a === 'y' ? 'y' : 'x'));
  $('#pRot90').addEventListener('click', rotate90(1));
  $('#pFlipX').addEventListener('click', flip('x'));
  $('#selectionClose').addEventListener('click', () => {
    select(null); document.querySelector<HTMLCanvasElement>('#cv')?.focus();
  });
}
