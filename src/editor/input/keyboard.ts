/** Atajos de teclado. */
import {
  afterChange, applyCrop, cancelCrop, copySelected, cutSelected, duplicateSelected, enterCrop, flip, groupSelected,
  removeSelected, reorder, rotate90, select, selectAll, selected, setMode, shiftSelected, ungroupSelected,
} from '../actions';
import { redo, snap, undo } from '../history';
import { S, st } from '../state';
import { fitView, zoomCenter } from '../view';
import { isMenuOpen } from '../ui/menu';
import { togglePanel } from '../ui/layout';
import { isShortcutsOpen, openShortcuts } from '../ui/shortcuts';
import { setSpaceDown } from './pointer';

/** Una serie de pulsaciones de flecha seguidas cuenta como un solo paso de deshacer. */
let nudge: { l: unknown; t: number } = { l: null, t: 0 };

export function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (isMenuOpen() || isShortcutsOpen()) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), sel = st.sel;
    const typing = (e.target as Element).matches?.('input,textarea,select') ?? false;
    if (mod && k === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (typing) return;
    if (e.key === '?') { e.preventDefault(); openShortcuts(); return; }
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
    if (e.key === 'Escape') {
      if (S.mode === 'crop') cancelCrop(); else if (S.mode !== 'move') setMode('move'); else select(null);
      return;
    }
    if (mod || e.altKey) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && any) { e.preventDefault(); removeSelected(); return; }
    if (any && !sel?.locked && e.key.startsWith('Arrow') && S.mode === 'move') {
      e.preventDefault();
      // la misma selección (una imagen o el grupo) cuenta como una serie
      const key = sel ?? st.group[0], now = performance.now();
      if (!(e.repeat || (nudge.l === key && now - nudge.t < 800))) snap();
      nudge = { l: key, t: now };
      const d = e.shiftKey ? 10 : 1;
      shiftSelected(e.key === 'ArrowLeft' ? -d : e.key === 'ArrowRight' ? d : 0, e.key === 'ArrowUp' ? -d : e.key === 'ArrowDown' ? d : 0);
      afterChange();
      return;
    }
    if (k === '+' || k === '=') { zoomCenter(1.25); return; }
    if (k === '-') { zoomCenter(1 / 1.25); return; }
    if (e.code === 'Space' && !e.repeat && e.target === document.body) { setSpaceDown(true); e.preventDefault(); return; }
    if (!sel) return;
    if (k === 'c') enterCrop();
    else if (k === 'e') setMode('erase');
    else if (k === 'w') setMode('wand');
    else if (k === 'v') setMode('move');
    else if (k === 'r') rotate90(e.shiftKey ? -1 : 1)();
    else if (k === 'h') flip(e.shiftKey ? 'y' : 'x')();
  });
  document.addEventListener('keyup', (e) => { if (e.code === 'Space') setSpaceDown(false); });
  addEventListener('blur', () => setSpaceDown(false));
}
