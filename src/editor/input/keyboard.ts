/** Atajos de teclado. */
import {
  afterChange, applyCrop, cancelCrop, copyLayer, duplicateLayer, enterCrop, flip, removeLayer, reorder, rotate90, select, setMode,
} from '../actions';
import { redo, snap, undo } from '../history';
import { S, st } from '../state';
import { fitView, zoomCenter } from '../view';
import { isMenuOpen } from '../ui/menu';
import { setSpaceDown } from './pointer';

/** Una serie de pulsaciones de flecha seguidas cuenta como un solo paso de deshacer. */
let nudge: { l: unknown; t: number } = { l: null, t: 0 };

export function initKeyboard() {
  document.addEventListener('keydown', (e) => {
    if (isMenuOpen()) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase(), sel = st.sel;
    const typing = (e.target as Element).matches?.('input,textarea,select') ?? false;
    if (mod && k === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y' && !typing) { e.preventDefault(); redo(); return; }
    if (typing) return;
    if (mod && k === '0') { e.preventDefault(); fitView(); return; }
    if (mod && k === 'd' && sel) { e.preventDefault(); duplicateLayer(sel); return; }
    if (mod && k === 'c' && sel) { e.preventDefault(); copyLayer(sel); return; }
    if (mod && (e.key === ']' || e.code === 'BracketRight') && sel) { e.preventDefault(); reorder(sel, e.shiftKey ? 'front' : 1); return; }
    if (mod && (e.key === '[' || e.code === 'BracketLeft') && sel) { e.preventDefault(); reorder(sel, e.shiftKey ? 'back' : -1); return; }
    if (e.key === 'Enter' && S.mode === 'crop') { e.preventDefault(); applyCrop(); return; }
    if (e.key === 'Escape') {
      if (S.mode === 'crop') cancelCrop(); else if (S.mode !== 'move') setMode('move'); else select(null);
      return;
    }
    if (mod || e.altKey) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); removeLayer(sel); return; }
    if (sel && e.key.startsWith('Arrow') && S.mode === 'move') {
      e.preventDefault();
      const now = performance.now();
      if (!(e.repeat || (nudge.l === sel && now - nudge.t < 800))) snap();
      nudge = { l: sel, t: now };
      const d = e.shiftKey ? 10 : 1;
      if (e.key === 'ArrowLeft') sel.cx -= d;
      if (e.key === 'ArrowRight') sel.cx += d;
      if (e.key === 'ArrowUp') sel.cy -= d;
      if (e.key === 'ArrowDown') sel.cy += d;
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
