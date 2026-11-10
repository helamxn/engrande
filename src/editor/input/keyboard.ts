/** Atajos de teclado. */
import {
  afterChange, applyCrop, cancelCrop, copySelected, cutSelected, duplicateSelected, enterCrop, exitGroup, flip, groupSelected,
  removeSelected, reorder, rotate90, selectAll, selected, setMode, shiftSelected, ungroupSelected,
} from '../actions';
import { redo, snap, undo } from '../history';
import { S, st } from '../state';
import { fitView, zoomCenter } from '../view';
import { isMenuOpen } from '../ui/menu';
import { togglePanel } from '../ui/layout';
import { isShortcutsOpen, openShortcuts } from '../ui/shortcuts';
import { setSpaceDown } from './pointer';
import { measureCtx, stopMeasure } from '../measure';
import { bboxMM, gridStep, stepToLines, unionBox } from '../geometry';
import { altChangedDuringDrag, refreshMeasure } from './pointer';

/**
 * Botón que tiene el foco porque se pulsó con el ratón o el dedo (no con el teclado). No sirve :focus-visible: el
 * navegador lo activa en cuanto se pulsa una tecla, también Espacio.
 */
let pointerFocused: Element | null = null;
/** Espacio sirve para mover la vista: sin foco, o con el foco en un botón al que se llegó con el ratón. */
function spaceTarget(t: EventTarget | null) {
  if (t === document.body) return true;
  return t instanceof HTMLButtonElement && t === pointerFocused && !t.closest('#menu, .menu, dialog');
}

/** Una serie de pulsaciones de flecha seguidas cuenta como un solo paso de deshacer. */
let nudge: { l: unknown; t: number } = { l: null, t: 0 };

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
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), sel = st.sel;
    const typing = (e.target as Element).matches?.('input,textarea,select') ?? false;
    if (mod && k === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (typing) return;
    if (e.key === '?') { e.preventDefault(); openShortcuts(); return; }
    // Ctrl+O: elegir imágenes o PDF (en vez de abrir un archivo en el navegador), como en Excalidraw
    if (mod && k === 'o') { e.preventDefault(); document.querySelector<HTMLInputElement>('#file')?.click(); return; }
    if (mod && k === '0') { e.preventDefault(); fitView(); return; }
    // Ctrl+\ como en Figma (en teclado español, la tecla ç ocupa esa posición)
    if (mod && (e.code === 'Backslash' || e.key === '\\')) { e.preventDefault(); togglePanel(); return; }
    const any = selected().length > 0;
    if (mod && k === 'g') { e.preventDefault(); if (e.shiftKey) ungroupSelected(); else groupSelected(); return; }
    if (mod && k === 'a') { e.preventDefault(); if (S.mode === 'crop') applyCrop(); selectAll(); return; }
    if (mod && k === 'd' && any) { e.preventDefault(); duplicateSelected(); return; }
    if (mod && k === 'c' && any) { e.preventDefault(); copySelected(); return; }
    if (mod && k === 'x' && any) { e.preventDefault(); cutSelected(); return; }
    if (mod && (e.key === ']' || e.code === 'BracketRight') && sel) { e.preventDefault(); reorder(sel, e.shiftKey ? 'front' : 1); return; }
    if (mod && (e.key === '[' || e.code === 'BracketLeft') && sel) { e.preventDefault(); reorder(sel, e.shiftKey ? 'back' : -1); return; }
    if (e.key === 'Enter' && S.mode === 'crop') { e.preventDefault(); applyCrop(); return; }
    if (e.key === 'Escape' && st.measureMode) { st.measureMode = false; stopMeasure(); return; }
    if (e.key === 'Escape') {
      // en un grupo abierto, Esc sale un nivel (selecciona el grupo); en el póster, deselecciona
      if (S.mode === 'crop') cancelCrop(); else if (S.mode !== 'move') setMode('move'); else exitGroup();
      return;
    }
    const arrow = e.key.startsWith('Arrow');
    // Alt + ← → es «atrás / adelante» en el navegador: sobre el lienzo nunca se sale de la app.
    // La lista ya usa Alt + ↑ ↓ para el orden (y lo marca como atendido).
    if (e.altKey && arrow && !mod) { if (e.defaultPrevented) return; e.preventDefault(); }
    if (mod || (e.altKey && !arrow)) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && any) { e.preventDefault(); removeSelected(); return; }
    if (any && !sel?.locked && arrow && S.mode === 'move') {
      e.preventDefault();
      // la misma selección (una imagen o el grupo) cuenta como una serie
      const key = sel ?? st.group[0], now = performance.now();
      if (!(e.repeat || (nudge.l === key && now - nudge.t < 800))) snap();
      nudge = { l: key, t: now };
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
