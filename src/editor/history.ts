/** Deshacer / rehacer con instantáneas de las capas y límite de memoria. */
import { UNDO_MAX } from './constants';
import { PIX_BUDGET } from './platform';
import { clonePath } from './groups';
import { committedFrame, S, st } from './state';
import type { Snapshot } from './types';

const undoStack: Snapshot[] = [];
const redoStack: Snapshot[] = [];

/** Instantánea tomada al empezar un gesto; solo se guarda si el gesto llega a cambiar algo. */
let pending: Snapshot | null = null;

/** Contador de cambios, para avisar al cerrar la pestaña si hay trabajo sin exportar. */
let changes = 0;
let exportedAt = 0;
export const markExported = () => { exportedAt = changes; };
/** Cambia con cada paso guardado, deshecho o rehecho: sirve para saber si un gesto llegó a cambiar algo. */
export const historyRevision = () => changes;
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
    layoutGuides: st.layoutGuides.slice(),
    layers: st.layers.slice(),
    sel: st.sel,
    group: st.group.slice(),
    props: st.layers.map((l) => {
      const f = committedFrame(l);
      return {
        l, cx: f.cx, cy: f.cy, w: f.w, h: f.h, rot: l.rot, flipX: l.flipX, flipY: l.flipY,
        crop: { ...f.crop }, img: l.img, orig: l.orig, page: l.page, fit: f.fit && { ...f.fit }, hidden: l.hidden,
        name: l.name, locked: l.locked, opacity: l.opacity, gpath: clonePath(l.gpath), src: l.src,
      };
    }),
    // la distribución de hojas también se deshace (cambiarla mueve y reajusta las imágenes)
    layout: { paper: S.paper, orient: S.orient, cols: S.cols, rows: S.rows, margin: S.margin, overlap: S.overlap, posterSize: S.posterSize },
    // resolución, marcas, guía y omitir en blanco: «Nuevo póster» los restablece y deshacerlo debe devolverlos (solo ese
    // paso: ver restoreExport)
    exp: { dpi: S.dpi, marks: S.marks, guide: S.guide, skipBlank: S.skipBlank },
    sheetsOn: st.sheetsOn,
    wandSel: st.wandSel,
  };
}
export function restoreSnap(s: Snapshot) {
  st.layoutGuides = s.layoutGuides?.slice() ?? [];
  st.layers = s.layers.slice();
  for (const p of s.props) {
    Object.assign(p.l, {
      cx: p.cx, cy: p.cy, w: p.w, h: p.h, rot: p.rot, flipX: p.flipX, flipY: p.flipY,
      crop: { ...p.crop }, img: p.img, orig: p.orig, page: p.page, fit: p.fit && { ...p.fit }, hidden: p.hidden,
      name: p.name, locked: p.locked, opacity: p.opacity, gpath: clonePath(p.gpath), src: p.src,
    });
  }
  Object.assign(S, s.layout);
  if (s.restoreExport) Object.assign(S, s.exp);
  if (s.sheetsOn !== undefined) st.sheetsOn = s.sheetsOn;
  st.wandSel = s.wandSel ?? null;
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
  if (dropped.length) releaseUnused(dropped, liveRefs());
  sync();
  // todo cambio del póster pasa por aquí (snap, commitPending, pixel jobs): así ninguno se queda sin guardar
  hooks.changed();
}
export const snap = () => pushUndo(takeSnap());
/** Paso que al deshacerse devuelve también los ajustes de descarga (ver restoreExport): el de «Nuevo póster». */
export const snapWithExport = () => pushUndo({ ...takeSnap(), restoreExport: true });
let series: { key: string; time: number; revision: number } | null = null;
/** Repeticiones consecutivas de la misma orden. Deshacer o cualquier otra edición interrumpe la serie. */
export function snapSeries(key: string, interval = 1000) {
  const time = performance.now();
  if (!series || series.key !== key || series.revision !== changes || time - series.time >= interval) snap();
  series = { key, time, revision: changes };
}
/**
 * Vacía el historial. Al terminar de recuperar el póster guardado: un paso tomado mientras se recuperaba no conoce
 * las imágenes que llegaron después, y deshacerlo las quitaría todas.
 */
export function clearHistory() {
  series = null;
  const dropped = [...undoStack.splice(0), ...redoStack.splice(0)];
  pending = null;
  releaseUnused(dropped, liveRefs());
  sync();
}

export const setPending = (s: Snapshot | null) => { pending = s; };
export function commitPending() { if (pending) { pushUndo(pending); pending = null; } }

export function undo() {
  if (S.mode === 'crop') { hooks.cancelCrop(); return; }
  const s = undoStack.pop();
  if (!s) return;
  redoStack.push({ ...takeSnap(), restoreExport: s.restoreExport });
  restoreSnap(s);
  changes++;
  sync();
  hooks.afterHistory();
}
export function redo() {
  if (S.mode === 'crop') return;
  const s = redoStack.pop();
  if (!s) return;
  undoStack.push({ ...takeSnap(), restoreExport: s.restoreExport });
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
  const seen = new Set<object>();
  let bytes = 0;
  // El sufijo más reciente que cabe. Un lienzo compartido por varios pasos solo se cuenta una vez.
  for (let i = stack.length - 1; i >= 0; i--) {
    for (const p of stack[i]!.props) for (const c of [p.img, p.orig]) {
      if (!live.has(c) && !seen.has(c)) { seen.add(c); bytes += c.width * c.height * 4; }
    }
    if (bytes > budget) return stack.splice(0, Math.min(i + 1, stack.length - 1));
  }
  return [];
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
