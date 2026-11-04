/** Deshacer / rehacer con instantáneas de las capas y límite de memoria. */
import { UNDO_MAX } from './constants';
import { PIX_BUDGET } from './platform';
import { S, st } from './state';
import type { Snapshot } from './types';

const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];

/** Instantánea tomada al empezar un gesto; solo se guarda si el gesto llega a cambiar algo. */
let pending: Snapshot | null = null;

/** Contador de cambios, para avisar al cerrar la pestaña si hay trabajo sin exportar. */
let changes = 0;
let exportedAt = 0;
export const markExported = () => { exportedAt = changes; };
export const hasUnexported = () => changes !== exportedAt && (st.layers.some((l) => !l.isSample) || undoStack.length > 0);

/** Lo que tiene que pasar después de deshacer o rehacer; lo registra main.ts para evitar dependencias circulares. */
const hooks = { afterHistory: () => {}, syncUndo: (_canUndo: boolean, _canRedo: boolean) => {}, cancelCrop: () => {} };
export const setHistoryHooks = (h: Partial<typeof hooks>) => Object.assign(hooks, h);

export function takeSnap(): Snapshot {
  return {
    layers: st.layers.slice(),
    sel: st.sel,
    props: st.layers.map((l) => ({
      l, cx: l.cx, cy: l.cy, w: l.w, h: l.h, rot: l.rot, flipX: l.flipX, flipY: l.flipY,
      crop: { ...l.crop }, img: l.img, orig: l.orig, page: l.page,
    })),
  };
}
export function restoreSnap(s: Snapshot) {
  st.layers = s.layers.slice();
  for (const p of s.props) {
    Object.assign(p.l, { cx: p.cx, cy: p.cy, w: p.w, h: p.h, rot: p.rot, flipX: p.flipX, flipY: p.flipY, crop: { ...p.crop }, img: p.img, orig: p.orig, page: p.page });
  }
  st.sel = s.sel && st.layers.includes(s.sel) ? s.sel : null;
}

const sync = () => hooks.syncUndo(undoStack.length > 0, redoStack.length > 0);

export function pushUndo(s: Snapshot) {
  changes++;
  undoStack.push(s);
  if (undoStack.length > UNDO_MAX) undoStack.shift();
  redoStack.length = 0;
  const live = new Set<object>(st.layers.flatMap((l) => [l.img, l.orig]));
  trimStack(undoStack, live, PIX_BUDGET);
  sync();
}
export const snap = () => pushUndo(takeSnap());

export const setPending = (s: Snapshot | null) => { pending = s; };
export function commitPending() { if (pending) { pushUndo(pending); pending = null; } }

export function undo() {
  if (S.mode === 'crop') { hooks.cancelCrop(); return; }
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push(takeSnap());
  restoreSnap(s);
  changes++;
  sync();
  hooks.afterHistory();
}
export function redo() {
  if (S.mode === 'crop') return;
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push(takeSnap());
  restoreSnap(s);
  changes++;
  sync();
  hooks.afterHistory();
}

/**
 * Cada edición de píxeles guarda un lienzo completo. Si los lienzos que solo retiene el historial superan
 * el presupuesto, se descartan los pasos más viejos (siempre queda al menos uno).
 */
export function trimStack(
  stack: { props: { img: { width: number; height: number }; orig: { width: number; height: number } }[] }[],
  live: Set<object>,
  budget: number,
) {
  while (stack.length > 1) {
    const seen = new Set<object>();
    let bytes = 0;
    for (const s of stack) for (const p of s.props) for (const c of [p.img, p.orig]) {
      if (!live.has(c) && !seen.has(c)) { seen.add(c); bytes += c.width * c.height * 4; }
    }
    if (bytes <= budget) break;
    stack.shift();
  }
}
