/** Dibujo de los contornos de un texto en un lienzo, a la resolución que haga falta (pantalla o PDF). */
import { MAX_SIDE } from '../constants';
import type { TextSpec } from '../types';
import { frameOf } from './shape';

const paths = new WeakMap<TextSpec['shape'], Path2D>();
function pathOf(shape: TextSpec['shape']) {
  let p = paths.get(shape);
  if (!p) { p = new Path2D(shape.glyphs.map((g) => g.d).join(' ')); paths.set(shape, p); }
  return p;
}

/** Color de contorno de siempre. */
export const DEFAULT_OUTLINE = '#111111';
/** Grosor del contorno en unidades de la fuente (0: sin contorno). Unas letras huecas siempre llevan alguno. */
export function strokeOf(spec: TextSpec): number {
  const o = spec.outline ?? 0;
  return ((o > 0 ? o : spec.hollow ? HOLLOW_DEFAULT : 0) / 1000) * spec.shape.upm;
}
/** Grosor de las letras huecas si no se eligió otro (milésimas del tamaño de la fuente). */
export const HOLLOW_DEFAULT = 25;

/** Lienzo con el texto: el lado largo mide `side` px (por defecto el del lienzo de trabajo de las imágenes). */
export function textCanvas(spec: TextSpec, side = MAX_SIDE, h?: number): HTMLCanvasElement {
  const b = frameOf(spec), bw = b.x1 - b.x0, bh = b.y1 - b.y0;
  const c = document.createElement('canvas');
  if (h) { c.width = Math.max(1, Math.round(side)); c.height = Math.max(1, Math.round(h)); }
  else {
    const s = side / Math.max(bw, bh);
    c.width = Math.max(1, Math.round(bw * s)); c.height = Math.max(1, Math.round(bh * s));
  }
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.setTransform(c.width / bw, 0, 0, c.height / bh, -b.x0 * (c.width / bw), -b.y0 * (c.height / bh));
  const p = pathOf(spec.shape), line = strokeOf(spec);
  if (!line || !spec.hollow) { x.fillStyle = spec.color; x.fill(p); }
  if (line) {
    // por dentro: el doble de grueso y recortado a la propia letra (las letras de una fuente se rellenan con nonzero)
    x.save(); x.clip(p);
    x.lineWidth = 2 * line; x.lineJoin = 'round'; x.strokeStyle = spec.outlineColor ?? DEFAULT_OUTLINE;
    x.stroke(p);
    x.restore();
  }
  return c;
}
