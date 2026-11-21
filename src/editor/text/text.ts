/**
 * Textos del póster. Un texto es una capa más (se mueve, gira, agrupa, oculta y se imprime igual que una imagen),
 * pero su origen no es un archivo sino sus contornos (TextSpec): el lienzo de trabajo se vuelve a dibujar desde
 * ellos al cambiarlo, y al descargar se dibujan a la resolución del PDF, nítidos a cualquier tamaño.
 * Por ahora no se recorta ni se borra con el borrador o la varita: cambiar las palabras movería lo borrado.
 */
import { newLayer, select, afterChange, markManual } from '../actions';
import { toast } from '../dom';
import { cropCenter, localToMM, placeLocal, scaleLayer } from '../geometry';
import { snap } from '../history';
import { st } from '../state';
import type { Layer, Pt, TextAlign, TextSpec, Transform } from '../types';
import { ensureFont, getFont, type FontEntry } from './fonts';
import { requestLocalFonts } from './local';
import { textCanvas } from './raster';
import { frameOf, layoutText, minWidth, textName } from './shape';
import { DEFAULT_TEXT_COLOR, MM_PER_PT } from './values';

export type TextLayer = Layer & { src: { kind: 'text'; spec: TextSpec } };
export const isText = (l: Layer | null | undefined): l is TextLayer => l?.src?.kind === 'text';
export const specOf = (l: TextLayer) => l.src.spec;

export const TEXT_DEFAULTS = { align: 'left' as TextAlign, line: 1.15, track: 0, color: DEFAULT_TEXT_COLOR, fit: false };
export const NO_PIXEL_TOOLS = 'Por ahora el texto no se puede recortar ni borrar. Puedes moverlo, girarlo y cambiar su tamaño.';

const boxW = (s: TextSpec) => { const b = frameOf(s); return b.x1 - b.x0; };
const boxH = (s: TextSpec) => { const b = frameOf(s); return b.y1 - b.y0; };
/** mm por unidad de la fuente. */
export const unitMM = (l: TextLayer) => l.w / boxW(specOf(l));
/** Alto de las mayúsculas en mm («Alto de mayúsculas» en el panel). */
export const capMM = (l: TextLayer) => unitMM(l) * specOf(l).shape.cap;
/** Cuerpo tipográfico (em) en puntos, independiente de la altura de las mayúsculas. */
export const fontSizePT = (l: TextLayer) => unitMM(l) * specOf(l).shape.upm / MM_PER_PT;
export function setFontSizePT(l: TextLayer, pt: number) {
  scaleLayer(l, Math.max(1, pt) / fontSizePT(l), cropCenter(l));
  markManual(l);
}
/** Punto de alineación del texto (u, v) dentro de su caja: la línea base de la primera línea. */
const originUV = (s: TextSpec): [number, number] => { const b = frameOf(s); return [-b.x0 / boxW(s), -b.y0 / boxH(s)]; };
/** Punto de alineación en el póster (mm). */
export const originMM = (l: TextLayer): Pt => localToMM(l, ...originUV(specOf(l)));

/** Coloca un spec nuevo (otras palabras, otra fuente…) con k mm por unidad, sin mover el punto fijo. */
function placeSpec(l: TextLayer, spec: TextSpec, k: number, anchor: 'origin' | 'center') {
  const P = anchor === 'origin' ? originMM(l) : cropCenter(l);
  const img = textCanvas(spec);
  Object.assign(l, { src: { kind: 'text', spec }, img, orig: img, w: boxW(spec) * k, h: boxH(spec) * k, crop: { x0: 0, y0: 0, x1: 1, y1: 1 } });
  placeLocal(l, ...(anchor === 'origin' ? originUV(spec) : [0.5, 0.5] as [number, number]), P);
}

/** Pide la fuente de un texto. Si es del usuario y ya no está cargada, avisa (con un botón para cargarla). */
export async function fontFor(l: TextLayer, what = 'cambiar las palabras'): Promise<FontEntry | null> {
  const s = specOf(l), f = getFont(s.font) ?? await ensureFont(s.font).catch(() => null);
  if (!f) {
    const local = s.font.startsWith('l:');
    toast(`Para ${what}, ${local ? 'activa las fuentes del equipo para usar' : 'vuelve a cargar la fuente'} «${s.fontName}» (o elige otra en el panel).`, 7000,
      { label: local ? 'Permitir fuentes' : 'Cargar fuente', fn: local ? () => void requestLocalFonts() : pickFontFile });
  }
  return f;
}

/** Abre el selector de fuentes (el input está en el panel; ver textpanel.ts). */
export function pickFontFile() { document.querySelector<HTMLInputElement>('#fontFile')?.click(); }

/** Rehace los contornos con otra fuente o estilo. Devuelve false si no queda nada que ver. */
export function relayout(l: TextLayer, f: FontEntry, change: Partial<Pick<TextSpec, 'text' | 'align' | 'line' | 'track' | 'fit' | 'width'>>, anchor: 'origin' | 'center' = 'origin') {
  const old = specOf(l), next = { ...old, ...change, font: f.id, fontName: f.name };
  // el ancho fijo va en unidades de la fuente: con otra fuente se pasa a las suyas (el mismo ancho en el papel)
  if (next.width && !('width' in change)) next.width = next.width * f.font.unitsPerEm / old.shape.upm;
  const shape = layoutText(f.font, next.text, next);
  if (!shape) return false;
  // Cambiar de familia conserva el cuerpo en puntos; las formas pueden tener otra altura de mayúsculas.
  const k = unitMM(l) * old.shape.upm / shape.upm;
  const wasAuto = l.name === textName(old.text);
  placeSpec(l, { ...next, shape }, k, anchor);
  if (wasAuto) l.name = textName(next.text);
  markManual(l);
  return true;
}

/**
 * Ancho fijo desde un tirador lateral: el lado opuesto y el borde de arriba se quedan quietos, las letras no cambian de
 * tamaño y las líneas se parten entre palabras. L0: la colocación al empezar el gesto. Devuelve false sin la fuente.
 */
export function dragWidth(l: TextLayer, L0: Transform, side: 'e' | 'w', m: Pt) {
  const f = getFont(specOf(l).font);
  if (!f) return false;
  const k = unitMM(l), uOpp = side === 'e' ? 0 : 1, A = localToMM(L0, uOpp, 0);
  const a = (L0.rot * Math.PI) / 180, dir = (L0.flipX ? -1 : 1) * (side === 'e' ? 1 : -1);
  const along = ((m.x - A.x) * Math.cos(a) + (m.y - A.y) * Math.sin(a)) * dir;
  const s = specOf(l), min = minWidth(f.font, s.text, s.track);
  const width = Math.max(min, along / k);
  if (s.width && Math.abs(width - s.width) < 0.5) return true;
  if (!relayout(l, f, { width })) return false;
  placeLocal(l, uOpp, 0, A);
  return true;
}

/** Ancho automático (cada línea mide lo que ocupa) o fijo al ancho de ahora. Hace falta la fuente. */
export async function setWidthMode(l: TextLayer, fixed: boolean) {
  const s = specOf(l);
  if (!!s.width === fixed) return;
  const f = await fontFor(l, 'cambiar el ancho');
  if (!f || !st.layers.includes(l)) return;
  const b = s.shape.lineBox ?? s.shape.box;
  snap();
  relayout(l, f, { width: fixed ? b.x1 - b.x0 : null });
  afterChange();
}

/** Ajustar la caja a las letras o a los renglones: no hace falta la fuente, y las letras no se mueven. */
export function setFit(l: TextLayer, fit: boolean) {
  if (specOf(l).fit === fit) return;
  placeSpec(l, { ...specOf(l), fit }, unitMM(l), 'origin');
  markManual(l);
}

/** Cambia el color: no hace falta la fuente (los contornos son los mismos). */
export function recolor(l: TextLayer, color: string) {
  const s = specOf(l);
  if (s.color === color) return;
  const img = textCanvas({ ...s, color });
  Object.assign(l, { src: { kind: 'text', spec: { ...s, color } }, img, orig: img });
}

/** Cambia el contorno o las letras huecas: como el color, no hace falta la fuente. */
export function restroke(l: TextLayer, change: Partial<Pick<TextSpec, 'outline' | 'outlineColor' | 'hollow'>>) {
  const s = specOf(l), next = { ...s, ...change };
  if (next.outline === s.outline && next.outlineColor === s.outlineColor && next.hollow === s.hollow) return false;
  const img = textCanvas(next);
  Object.assign(l, { src: { kind: 'text', spec: next }, img, orig: img });
  return true;
}

/** Alto de letra en mm, desde el centro. */
export function setCapMM(l: TextLayer, mm: number) {
  scaleLayer(l, Math.max(1, mm) / capMM(l), cropCenter(l));
  markManual(l);
}

/**
 * Crea un texto con el punto de alineación en P (mm) y lo selecciona (un paso de deshacer).
 * Devuelve null si el texto no tiene nada que ver.
 */
export function createText(f: FontEntry, text: string, P: Pt, cap: number, style = TEXT_DEFAULTS, rot = 0): TextLayer | null {
  const shape = layoutText(f.font, text, style);
  if (!shape) return null;
  const spec: TextSpec = { text, font: f.id, fontName: f.name, ...style, shape };
  // el tamaño es el elegido: no se reduce aunque el texto salga más ancho que el póster (se ve y se ajusta a mano)
  const k = cap / shape.cap;
  const img = textCanvas(spec);
  const l = newLayer(img, textName(text), { src: { kind: 'text', spec }, fit: null }) as TextLayer;
  Object.assign(l, { w: boxW(spec) * k, h: boxH(spec) * k, rot });
  placeLocal(l, ...originUV(spec), P);
  snap();
  st.layers.push(l);
  st.sheetsOn = true;
  select(l);
  afterChange();
  return l;
}
