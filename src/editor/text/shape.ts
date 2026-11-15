/**
 * Texto → contornos. Cada letra pasa a ser su trazado (como «convertir en contornos» en un programa de diseño):
 * desde entonces se dibuja, se imprime y se guarda sin la fuente. Sin DOM: se prueba con una fuente de mentira.
 */
import type { TextAlign, TextShape } from '../types';

/** Lo que se usa de una fuente de opentype.js. */
export interface GlyphLike { advanceWidth?: number; getPath(x: number, y: number, size: number): PathLike }
export interface PathLike {
  toPathData(o?: number | { decimalPlaces?: number; flipY?: boolean }): string;
  getBoundingBox(): { x1: number; y1: number; x2: number; y2: number; isEmpty?(): boolean };
}
export interface FontLike {
  unitsPerEm: number; ascender: number; descender: number;
  tables: { os2?: { sCapHeight?: number } };
  charToGlyph(c: string): GlyphLike;
  stringToGlyphs(s: string): GlyphLike[];
  getKerningValue(a: GlyphLike, b: GlyphLike): number;
}

/** width: ancho fijo en unidades de la fuente (las líneas se parten en palabras); null o ausente = automático. */
export interface TextStyle { align: TextAlign; line: number; track: number; width?: number | null }

/** Altura de las mayúsculas: la de la fuente o, si no la declara, la de la «H». */
export function capHeight(f: FontLike) {
  const c = f.tables.os2?.sCapHeight;
  if (c && c > 0) return c;
  const b = f.charToGlyph('H').getPath(0, 0, f.unitsPerEm).getBoundingBox();
  const h = -b.y1;
  return h > 0 ? h : f.unitsPerEm * 0.7;
}

/** Letras de una línea (las tildes compuestas y los emojis cuentan como una). */
const graphemes = (s: string): string[] =>
  typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? [...new Intl.Segmenter('es', { granularity: 'grapheme' }).segment(s)].map((x) => x.segment)
    : [...s];

/**
 * Coloca las líneas y devuelve los contornos, o null si no hay nada que ver (vacío o solo espacios).
 * Las ligaduras de la fuente (fi, fl…) se aplican: entonces una «letra» puede llevar dos caracteres.
 */
export function layoutText(f: FontLike, text: string, st: TextStyle): TextShape | null {
  const upm = f.unitsPerEm, lh = st.line * upm, tr = (st.track / 1000) * upm;
  const glyphs: TextShape['glyphs'] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, maxW = 0;
  const lines = wrapText(f, text, st.track, st.width);
  lines.forEach((line, i) => {
    const gs = f.stringToGlyphs(line);
    // reparto de los caracteres entre los glifos: con ligaduras hay menos glifos que letras
    const chars = graphemes(line), per = gs.length === chars.length;
    const xs: number[] = [];
    let x = 0;
    gs.forEach((g, j) => {
      xs.push(x);
      x += (g.advanceWidth ?? 0) + (j < gs.length - 1 ? f.getKerningValue(g, gs[j + 1]!) + tr : 0);
    });
    maxW = Math.max(maxW, x);
    const off = st.align === 'center' ? -x / 2 : st.align === 'right' ? -x : 0, y = i * lh;
    gs.forEach((g, j) => {
      const p = g.getPath(xs[j]! + off, y, upm), b = p.getBoundingBox();
      if (b.isEmpty?.() || !(b.x2 > b.x1 || b.y2 > b.y1)) return; // espacio
      x0 = Math.min(x0, b.x1); y0 = Math.min(y0, b.y1); x1 = Math.max(x1, b.x2); y1 = Math.max(y1, b.y2);
      // flipY: false, porque opentype.js 2 invierte la Y por defecto (para SVG sueltos)
      glyphs.push({ ch: per ? chars[j]! : '', d: p.toPathData({ decimalPlaces: 1, flipY: false }) });
    });
  });
  if (!glyphs.length || !(x1 > x0) || !(y1 > y0)) return null;
  return {
    glyphs, box: { x0, y0, x1, y1 },
    // con ancho fijo, la caja mide ese ancho (o lo que ocupe la palabra más larga, que no se parte)
    lineBox: lineBox(Math.max(maxW, st.width ?? 0), lines.length, st, f.ascender, f.descender, upm),
    cap: capHeight(f), asc: f.ascender, desc: f.descender, upm,
  };
}

/**
 * Caja de los renglones (la del cuadro de escritura): de ancho, la línea más larga; de alto, las líneas por el
 * interlineado, con la letra centrada en su renglón como la coloca el navegador.
 */
export function lineBox(maxW: number, n: number, st: TextStyle, asc: number, desc: number, upm: number) {
  const lh = st.line * upm, top = -((lh - (asc - desc)) / 2 + asc);
  const x0 = st.align === 'center' ? -maxW / 2 : st.align === 'right' ? -maxW : 0;
  return { x0, y0: top, x1: x0 + maxW, y1: top + n * lh };
}

type Box = TextShape['box'];
/**
 * Caja del texto en el póster: la de los renglones (con su aire arriba y abajo, como al escribir) o, con «Ajustar
 * la caja a las letras», solo lo que se ve. Si alguna letra sale del renglón (interlineado muy justo, tildes), la
 * caja crece para no cortarla. Los textos guardados antes de existir la caja de renglones usan la de las letras.
 */
export function frameOf(s: { fit: boolean; shape: TextShape }): Box {
  const b = s.shape.box, l = s.shape.lineBox;
  if (s.fit || !l) return b;
  return { x0: Math.min(b.x0, l.x0), y0: Math.min(b.y0, l.y0), x1: Math.max(b.x1, l.x1), y1: Math.max(b.y1, l.y1) };
}

/** Ancho de una línea (unidades de la fuente), con el ajuste entre letras y el espaciado. */
function advance(f: FontLike, line: string, tr: number) {
  const gs = f.stringToGlyphs(line);
  return gs.reduce((x, g, j) => x + (g.advanceWidth ?? 0) + (j < gs.length - 1 ? f.getKerningValue(g, gs[j + 1]!) + tr : 0), 0);
}

/**
 * Las líneas tal como se ven: los saltos que escribió el usuario y, con ancho fijo, los que hacen falta para no pasarse
 * de ese ancho, entre palabras (una palabra más larga que el ancho no se parte: queda sola en su línea).
 */
export function wrapText(f: FontLike, text: string, track: number, width?: number | null): string[] {
  const paras = text.normalize('NFC').replace(/\r/g, '').split('\n');
  if (!width || !(width > 0)) return paras;
  const tr = (track / 1000) * f.unitsPerEm, out: string[] = [];
  for (const para of paras) {
    const words = para.split(/ +/);
    let line = '';
    for (const w of words) {
      const next = line ? line + ' ' + w : w;
      if (line && advance(f, next, tr) > width) { out.push(line); line = w; } else line = next;
    }
    out.push(line);
  }
  return out;
}

/** Ancho de cada línea tal como se ve (con el ancho fijo, si lo hay). */
export function lineAdvances(f: FontLike, text: string, track: number, width?: number | null): number[] {
  const tr = (track / 1000) * f.unitsPerEm;
  return wrapText(f, text, track, width).map((line) => advance(f, line, tr));
}

/** Lo mínimo que puede medir un ancho fijo: la palabra más larga (no se parten). */
export function minWidth(f: FontLike, text: string, track: number) {
  const tr = (track / 1000) * f.unitsPerEm;
  return Math.max(0, ...text.normalize('NFC').split(/[ \n]+/).filter(Boolean).map((w) => advance(f, w, tr)));
}

/** Nombre de la capa: la primera línea con texto, acortada. */
export function textName(text: string) {
  const first = text.split('\n').map((s) => s.trim()).find(Boolean) ?? 'Texto';
  return first.length > 32 ? first.slice(0, 31).trimEnd() + '…' : first;
}
