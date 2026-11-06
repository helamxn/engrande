/** Deshacer / rehacer con instantáneas de las capas y límite de memoria. */
import { UNDO_MAX } from './constants';
import { PIX_BUDGET } from './platform';
import { clonePath } from './groups';
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
export const hasUnexported = () => changes !== exportedAt && (st.layers.length > 0 || undoStack.length > 0);

/** Lo que tiene que pasar después de deshacer o rehacer; lo registra main.ts para evitar dependencias circulares. */
const hooks = {
  afterHistory: () => {}, syncUndo: (_canUndo: boolean, _canRedo: boolean) => {}, cancelCrop: () => {},
  /** Hubo un cambio que se puede deshacer: el póster cambió y hay que guardarlo (ver persist.ts). */
  changed: () => {},
};
export const setHistoryHooks = (h: Partial<typeof hooks>) => Object.assign(hooks, h);

export function takeSnap(): Snapshot {
  return {
    layers: st.layers.slice(),
    sel: st.sel,
    group: st.group.slice(),
    props: st.layers.map((l) => ({
      l, cx: l.cx, cy: l.cy, w: l.w, h: l.h, rot: l.rot, flipX: l.flipX, flipY: l.flipY,
      crop: { ...l.crop }, img: l.img, orig: l.orig, page: l.page, fit: l.fit && { ...l.fit }, hidden: l.hidden,
      name: l.name, locked: l.locked, opacity: l.opacity, gpath: clonePath(l.gpath),
    })),
    // la distribución de hojas también se deshace (cambiarla mueve y reajusta las imágenes)
    layout: { paper: S.paper, orient: S.orient, cols: S.cols, rows: S.rows, margin: S.margin, overlap: S.overlap },
    // resolución, marcas y guía: «Nuevo póster» los restablece y deshacerlo debe devolverlos
    exp: { dpi: S.dpi, marks: S.marks, guide: S.guide },
  };
}
export function restoreSnap(s: Snapshot) {
  st.layers = s.layers.slice();
  for (const p of s.props) {
    Object.assign(p.l, {
      cx: p.cx, cy: p.cy, w: p.w, h: p.h, rot: p.rot, flipX: p.flipX, flipY: p.flipY,
      crop: { ...p.crop }, img: p.img, orig: p.orig, page: p.page, fit: p.fit && { ...p.fit }, hidden: p.hidden,
      name: p.name, locked: p.locked, opacity: p.opacity, gpath: clonePath(p.gpath),
    });
  }
  Object.assign(S, s.layout, s.exp);
  st.sel = s.sel && st.layers.includes(s.sel) ? s.sel : null;
  const g = (s.group ?? []).filter((l) => st.layers.includes(l));
  st.group = g.length > 1 ? g : [];
}

const sync = () => hooks.syncUndo(undoStack.length > 0, redoStack.length > 0);

export function pushUndo(s: Snapshot) {
  changes++;
  undoStack.push(s);
  const dropped: Snapshot[] = [];
  if (undoStack.length > UNDO_MAX) dropped.push(undoStack.shift()!);
  dropped.push(...redoStack.splice(0)); // un cambio nuevo invalida lo que se podía rehacer
  const live = new Set<object>(st.layers.flatMap((l) => [l.img, l.orig]));
  dropped.push(...trimStack(undoStack, live, PIX_BUDGET));
  releaseUnused(dropped, liveRefs());
  sync();
  // todo cambio del póster pasa por aquí (snap, commitPending, pixel jobs): así ninguno se queda sin guardar
  hooks.changed();
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
export function trimStack<T extends { props: { img: { width: number; height: number }; orig: { width: number; height: number } }[] }>(
  stack: T[],
  live: Set<object>,
  budget: number,
): T[] {
  const dropped: T[] = [];
  while (stack.length > 1) {
    const seen = new Set<object>();
    let bytes = 0;
    for (const s of stack) for (const p of s.props) for (const c of [p.img, p.orig]) {
      if (!live.has(c) && !seen.has(c)) { seen.add(c); bytes += c.width * c.height * 4; }
    }
    if (bytes <= budget) break;
    dropped.push(stack.shift()!);
  }
  return dropped;
}

/* ---------- liberar memoria ---------- */
interface CanvasLike { width: number; height: number }
/** Documento de pdf.js: se cierra con loadingTask.destroy(). */
interface DocLike { loadingTask: { destroy(): unknown } }
interface LayerRefs { img: CanvasLike; orig: CanvasLike; pdf: DocLike | null }
interface SnapRefs { layers: LayerRefs[]; props: { l: LayerRefs; img: CanvasLike; orig: CanvasLike }[] }
export interface LiveRefs { canvases: Set<object>; docs: Set<object> }

/** Lienzos y documentos PDF que siguen en uso: los del póster, los de la imagen copiada y los del historial. */
function liveRefs(): LiveRefs {
  const canvases = new Set<object>(), docs = new Set<object>();
  const add = (l: LayerRefs) => { canvases.add(l.img); canvases.add(l.orig); if (l.pdf) docs.add(l.pdf); };
  st.layers.forEach(add);
  st.clip?.forEach(add);
  for (const s of [...undoStack, ...redoStack, ...(pending ? [pending] : [])]) {
    for (const p of s.props) { canvases.add(p.img); canvases.add(p.orig); if (p.l.pdf) docs.add(p.l.pdf); }
    for (const l of s.layers) if (l.pdf) docs.add(l.pdf);
  }
  return { canvases, docs };
}

const released = new WeakSet<object>();
/**
 * Libera lo que solo usaban los pasos de historial descartados:
 * - lienzos: se dejan a tamaño 0, que devuelve su memoria al momento (Safari la retiene hasta que pasa el
 *   recolector de basura y puede llegar a su límite de memoria de canvas);
 * - documentos PDF: se cierran (loadingTask.destroy), porque pdf.js los mantiene cargados en su worker.
 * Nunca toca nada que siga en el póster, en el historial o en la imagen copiada.
 */
export function releaseUnused(dropped: SnapRefs[], live: LiveRefs) {
  let canvases = 0, docs = 0;
  for (const s of dropped) {
    for (const p of s.props) {
      for (const c of [p.img, p.orig]) {
        if (live.canvases.has(c) || released.has(c)) continue;
        released.add(c); c.width = 0; c.height = 0; canvases++;
      }
    }
    for (const l of [...s.layers, ...s.props.map((p) => p.l)]) {
      const doc = l.pdf;
      if (!doc || live.docs.has(doc) || released.has(doc)) continue;
      released.add(doc); docs++;
      void Promise.resolve(doc.loadingTask.destroy()).catch(() => {});
    }
  }
  return { canvases, docs };
}
