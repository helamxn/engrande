/** Atajos de teclado. */
import {
  afterChange, alignSelected, applyCrop, hideSelected, lockSelected, pasteLayer, toggleHidden, toggleLocked, cancelCrop, copySelected, cutSelected, duplicateSelected, enterCrop, exitGroup, flip, groupSelected,
  removeSelected, reorder, rotate90, selectAll, selected, selectedGroup, setMode, shiftSelected, ungroupSelected,
} from '../actions';
import { redo, snapSeries, undo } from '../history';
import { S, st } from '../state';
import { fitSelection, fitView, zoomCenter, zoomReal } from '../view';
import { setBrush } from '../ui/contextbar';
import type { AlignEdge } from '../geometry';
import { isMenuOpen } from '../ui/menu';
import { toggleLayersCard } from '../ui/panel';
import { isShortcutsOpen, openShortcuts } from '../ui/shortcuts';
import { cancelGuideDrag, isGesturing, setSpaceDown } from './pointer';
import { measureCtx, stopMeasure } from '../measure';
import { bboxMM, gridStep, stepToLines, unionBox } from '../geometry';
import { altChangedDuringDrag, refreshMeasure } from './pointer';
import { cancelTextPlacement, editText, startTextPlacement } from '../text/editor';
import { isText } from '../text/text';

/**
 * Botón que tiene el foco porque se pulsó con el ratón o el dedo (no con el teclado). No sirve :focus-visible: el
 * navegador lo activa en cuanto se pulsa una tecla, también Espacio.
 */
let pointerFocused: Element | null = null;
/** Espacio sirve para mover la vista: sin foco, o con el foco en un botón al que se llegó con el ratón. */
function spaceTarget(t: EventTarget | null) {
  if (t === document.body || t instanceof HTMLCanvasElement) return true;
  return t instanceof HTMLButtonElement && t === pointerFocused && !t.closest('#menu, .menu, dialog');
}

/** Alt + tecla para alinear (por posición física: igual en cualquier distribución de teclado). */
const ALIGN_KEYS: Record<string, AlignEdge> = {
  KeyA: 'left', KeyD: 'right', KeyW: 'top', KeyS: 'bottom', KeyH: 'hcenter', KeyV: 'vcenter',
};

export function initKeyboard() {
  document.addEventListener('pointerdown', (e) => { pointerFocused = (e.target as Element).closest?.('button') ?? null; }, true);
  // el foco llegó a otro sitio (Tab, o lo movió el editor): ese ya no se pulsó con el ratón
  document.addEventListener('focusin', (e) => { if (e.target !== pointerFocused) pointerFocused = null; });
  // Alt: medir al pasar el ratón (con algo seleccionado). Se evita que el navegador active su menú al soltarlo.
  const altOn = (on: boolean) => {
    if (st.altDown === on) return;
    st.altDown = on;
    if (altChangedDuringDrag(on)) return; // arrastrando: se mide desde el estado actual
    if (on) refreshMeasure(); else stopMeasure();
  };
  document.addEventListener('keydown', (e) => { if (e.key === 'Alt') { e.preventDefault(); altOn(true); } });
  document.addEventListener('keyup', (e) => { if (e.key === 'Alt') { e.preventDefault(); altOn(false); } });
  addEventListener('blur', () => altOn(false));
  document.addEventListener('keydown', (e) => {
    if (isMenuOpen() || isShortcutsOpen()) return;
    if (isGesturing() && e.target instanceof HTMLCanvasElement) {
      if (e.key === 'Escape') cancelGuideDrag();
      if (e.key !== 'Tab') e.preventDefault();
      return;
    }
    // con una ventana abierta (PDF, Póster, Capas), Esc solo la cierra (lo hace el navegador): no deselecciona
    if (e.key === 'Escape' && document.querySelector(':popover-open')) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), sel = st.sel;
    const typing = (e.target as Element).matches?.('input,textarea,select') ?? false;
    if (mod && k === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (typing) return;
    if (e.key === '?') { e.preventDefault(); openShortcuts(); return; }
    // Ctrl+O: elegir imágenes o PDF (en vez de abrir un archivo en el navegador), como en Excalidraw
    if (mod && k === 'o') { e.preventDefault(); document.querySelector<HTMLInputElement>('#file')?.click(); return; }
    if (mod && k === '0') { e.preventDefault(); fitView(); return; }
    // Mayús + 1 / 2 / 0 como en Figma: todo el póster, la selección y el 100 % (tamaño real aproximado)
    if (!mod && !e.altKey && e.shiftKey && e.code === 'Digit1') { e.preventDefault(); fitView(); return; }
    if (!mod && !e.altKey && e.shiftKey && e.code === 'Digit2') { e.preventDefault(); fitSelection(); return; }
    if (!mod && !e.altKey && e.shiftKey && e.code === 'Digit0') { e.preventDefault(); zoomReal(); return; }
    // [ y ] cambian el pincel, como en Photoshop (en teclado español se escriben con AltGr, que llega como Ctrl + Alt)
    if ((e.key === '[' || e.key === ']') && S.mode === 'erase' && (!mod || e.getModifierState('AltGraph'))) {
      e.preventDefault();
      setBrush(e.key === ']' ? Math.max(S.brush + 1, S.brush * 1.2) : Math.min(S.brush - 1, S.brush / 1.2));
      return;
    }
    // Ctrl+\ como en Figma (en teclado español, la tecla ç ocupa esa posición)
    if (mod && (e.code === 'Backslash' || e.key === '\\')) { e.preventDefault(); toggleLayersCard(); return; }
    const any = selected().length > 0;
    // Ctrl/⌘ + Mayús + V: pegar lo copiado en engrande en el mismo sitio (sin desplazar). Sin nada copiado aquí, sigue
    // el pegado normal del navegador (una imagen del portapapeles del sistema)
    if (mod && e.shiftKey && k === 'v' && st.clip?.length) { e.preventDefault(); pasteLayer(true); return; }
    // Ctrl/⌘ + Mayús + H / L, como en Figma: ocultar o bloquear lo seleccionado (si ya lo está, al revés)
    if (mod && e.shiftKey && (k === 'h' || k === 'l') && any) {
      e.preventDefault();
      const flag = k === 'h' ? 'hidden' : 'locked', ls = selected();
      if (ls.length === 1 && ls[0]![flag]) (flag === 'hidden' ? toggleHidden : toggleLocked)(ls[0]!);
      else if (flag === 'hidden') hideSelected(); else lockSelected();
      return;
    }
    if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSelected(); else groupSelected(); return; }
    if (mod && k === 'a') { e.preventDefault(); if (S.mode === 'crop') applyCrop(); selectAll(); return; }
    if (mod && k === 'd' && any) { e.preventDefault(); duplicateSelected(); return; }
    if (mod && k === 'c' && any) { e.preventDefault(); copySelected(); return; }
    if (mod && k === 'x' && any) { e.preventDefault(); cutSelected(); return; }
    if (mod && (e.code === 'BracketRight' || e.code === 'BracketLeft' || e.key === ']' || e.key === '[')) {
      const item = sel ?? selectedGroup();
      if (item != null) {
        e.preventDefault();
        const up = e.code === 'BracketRight' || e.key === ']';
        reorder(item, up ? (e.shiftKey ? 'front' : 1) : (e.shiftKey ? 'back' : -1));
      }
      return;
    }
    if (e.key === 'Enter' && S.mode === 'crop') { e.preventDefault(); applyCrop(); return; }
    // Enter con un texto seleccionado: escribir (si el foco está en un botón, Enter es pulsarlo)
    if (e.key === 'Enter' && !mod && isText(sel) && !(e.target instanceof HTMLButtonElement)) { e.preventDefault(); editText(sel); return; }
    if (e.key === 'Escape' && st.placingText) { cancelTextPlacement(); return; }
    if (e.key === 'Escape') {
      // en un grupo abierto, Esc sale un nivel (selecciona el grupo); en el póster, deselecciona
      if (S.mode === 'crop') cancelCrop(); else if (S.mode !== 'move') setMode('move'); else exitGroup();
      return;
    }
    const arrow = e.key.startsWith('Arrow');
    // Alt + ← → es «atrás / adelante» en el navegador: sobre el lienzo nunca se sale de la app.
    // La lista ya usa Alt + ↑ ↓ para el orden (y lo marca como atendido).
    if (e.altKey && arrow && !mod) { if (e.defaultPrevented) return; e.preventDefault(); }
    // Alt + A D W S H V, como en Figma: alinear (una sola cosa, con el póster; varias, entre sí)
    const edge = e.altKey && !mod && !e.shiftKey ? ALIGN_KEYS[e.code] : undefined;
    if (edge) { e.preventDefault(); if (any) alignSelected(edge); return; }
    if (mod || (e.altKey && !arrow)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && any) { e.preventDefault(); removeSelected(); return; }
    if (any && !sel?.locked && arrow && S.mode === 'move') {
      e.preventDefault();
      // la misma selección (una imagen o el grupo) cuenta como una serie
      snapSeries('move-' + selected().map((l) => l.id).join(','), 800);
      const d = e.shiftKey ? 10 : 1;
      let dx = e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, dy = e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0;
      // el paso acaba en un mm entero (la esquina de lo seleccionado, en la rejilla de 1 mm) y se para antes en los
      // bordes y centros (del póster y de las demás) que cruzaría: así se alinea con exactitud
      const mv = selected().filter((l) => !l.locked);
      if (mv.length) {
        const c = measureCtx(mv), b = unionBox(mv.map((l) => bboxMM(l)));
        dx = stepToLines(b, c.targets, 'x', gridStep(b.x0, dx)); dy = stepToLines(b, c.targets, 'y', gridStep(b.y0, dy));
      }
      shiftSelected(dx, dy);
      afterChange();
      // con Alt (como en Figma): se mueve midiendo y las distancias siguen a la imagen
      if (e.altKey || st.altDown) refreshMeasure();
      return;
    }
    if (arrow && e.altKey) return; // sin nada que mover: Alt + flecha no hace nada más
    if (k === '+' || k === '=') { zoomCenter(1.25); return; }
    if (k === '-') { zoomCenter(1 / 1.25); return; }
    // Espacio + arrastrar mueve la vista. También con el foco en un botón pulsado con el ratón:
    // si no, Espacio lo volvería a pulsar (p. ej. «Acercar»). Con el foco puesto con el teclado, Espacio pulsa el botón.
    if (e.code === 'Space' && spaceTarget(e.target)) { if (!e.repeat) setSpaceDown(true); e.preventDefault(); return; }
    if (k === 't' && !e.shiftKey) { e.preventDefault(); startTextPlacement(); return; }
    if (!sel) return;
    if (k === 'c') enterCrop();
    else if (k === 'e') setMode('erase');
    else if (k === 'w') setMode('wand');
    else if (k === 'v') setMode('move');
    else if (k === 'r') rotate90(e.shiftKey ? -1 : 1)();
    else if (k === 'h') flip(e.shiftKey ? 'y' : 'x')();
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space') { if (spaceTarget(e.target)) e.preventDefault(); setSpaceDown(false); } });
  addEventListener('blur', () => setSpaceDown(false));
}
