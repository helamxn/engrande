/**
 * Ayudas al mover y transformar, como en Figma:
 * - Imán (snap) a bordes y centros del póster y de las demás imágenes; las guías son tramos que unen solo lo
 *   alineado, con una × en cada punto que coincide.
 * - Separación igual: al mover, si el hueco con una vecina iguala otro de la misma fila o columna (o queda centrada
 *   entre dos), se pega y se ven las medidas iguales. Es lo único que muestra números al arrastrar.
 * - Medir: con algo seleccionado, Alt al pasar el ratón por otra imagen (o por el póster) muestra las distancias.
 *   En táctil, «Medir» en el menú y luego tocar con qué medir.
 * - Ctrl o ⌘ al arrastrar: sin ayudas. Las flechas no tienen imán ni medidas (son para precisión).
 */
import { alignedLines, bboxMM, guideSegments, measureBetween, snapTargets, unionBox, type Box, type SnapTargets } from './geometry';
import { dirty } from './render';
import { posterGeo, st } from './state';
import type { Layer } from './types';

/** Lo que no cambia durante un gesto: cajas de las demás imágenes visibles y líneas del imán. */
export interface MeasureCtx { others: Box[]; targets: SnapTargets; W: number; H: number }

/** Contexto para mover o transformar `moving`. posterOnly: el imán solo usa el póster (p. ej. al recortar). */
export function measureCtx(moving: Layer[], posterOnly = false): MeasureCtx {
  const g = posterGeo();
  const others = st.layers.filter((l) => !l.hidden && !moving.includes(l)).map((l) => bboxMM(l));
  return { others: posterOnly ? [] : others, targets: snapTargets(g.W, g.H, posterOnly ? [] : others), W: g.W, H: g.H };
}
/** Caja del póster (también es referencia para el imán y para medir). */
export const posterBox = (c: { W: number; H: number }): Box => ({ x0: 0, y0: 0, x1: c.W, y1: c.H });
/**
 * Guías del imán para la caja que se mueve. gx o gy dicen que ese eje se ha pegado; entonces se dibujan todas las
 * líneas suyas que coinciden con algo, no solo la que ganó (con anchos iguales: izquierda, centro y derecha).
 */
export function setGuides(moving: Box, c: MeasureCtx, gx: number | null, gy: number | null) {
  if (gx === null && gy === null) { st.guides = null; return; }
  const boxes = [...c.others, posterBox(c)];
  const xs = gx === null ? [] : alignedLines(moving, boxes, 'x'), ys = gy === null ? [] : alignedLines(moving, boxes, 'y');
  st.guides = guideSegments(moving, boxes, xs.length ? xs : gx, ys.length ? ys : gy);
}
/** Distancia del imán en px de pantalla: más amplia con el dedo. */
export const snapPx = (pointerType: string) => (pointerType === 'touch' ? 10 : 6);

/** Quita las guías y la separación igual (al soltar, al hacer zoom o mover la vista durante el gesto). */
export function clearHelpers() {
  if (!st.gaps && !st.guides) return;
  st.gaps = null; st.guides = null;
  dirty();
}

/** Medir desde la selección hasta target (otra imagen) o, si es null, hasta los bordes del póster. */
export function measureTo(sel: Layer[], target: Layer | null) {
  if (!sel.length) { stopMeasure(); return; }
  const s = unionBox(sel.map((l) => bboxMM(l))), g = posterGeo();
  const t = target ? bboxMM(target) : posterBox(g);
  st.measure = { ...measureBetween(s, t), target: t };
  dirty();
}
export function stopMeasure() {
  if (!st.measure) return;
  st.measure = null;
  dirty();
}
