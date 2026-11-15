import { describe, expect, it } from 'vitest';
import { capHeight, frameOf, layoutText, lineAdvances, minWidth, textName, wrapText, type FontLike, type GlyphLike } from './shape';
import { readSpec } from './spec';

/**
 * Fuente de mentira: upm 1000, cada letra es un rectángulo de 600 de ancho y 700 de alto sobre la línea base
 * (el espacio no tiene contorno), avance 700. Entre «A» y «V» hay un ajuste de −100.
 */
const chOf = (g: GlyphLike) => (g as unknown as { ch: string }).ch;
function fakeFont(opts: { cap?: number } = {}): FontLike & { calls: unknown[] } {
  const calls: unknown[] = [];
  const glyph = (ch: string): GlyphLike & { ch: string } => ({
    ch,
    advanceWidth: 700,
    getPath(x, y) {
      const empty = ch === ' ';
      return {
        toPathData(o) { calls.push(o); return empty ? '' : `M${x} ${y}L${x + 600} ${y}L${x + 600} ${y - 700}L${x} ${y - 700}Z`; },
        getBoundingBox: () => (empty ? { x1: 0, y1: 0, x2: 0, y2: 0, isEmpty: () => true } : { x1: x, y1: y - 700, x2: x + 600, y2: y, isEmpty: () => false }),
      };
    },
  });
  return {
    calls,
    unitsPerEm: 1000, ascender: 900, descender: -250,
    tables: { os2: opts.cap === undefined ? { sCapHeight: 700 } : { sCapHeight: opts.cap } },
    charToGlyph: glyph,
    stringToGlyphs: (s) => [...s].map(glyph),
    getKerningValue: (a, b) => (chOf(a) === 'A' && chOf(b) === 'V' ? -100 : 0),
  };
}

describe('layoutText', () => {
  it('coloca las letras con su avance y el ajuste entre letras', () => {
    const s = layoutText(fakeFont(), 'AVA', { align: 'left', line: 1.2, track: 0 })!;
    // A en 0, V en 700 − 100 = 600, A en 1300
    expect(s.box).toEqual({ x0: 0, y0: -700, x1: 1900, y1: 0 });
    expect(s.glyphs.map((g) => g.ch)).toEqual(['A', 'V', 'A']);
    expect(s.cap).toBe(700);
  });

  it('pide los trazados sin invertir la Y (opentype.js 2 la invierte por defecto)', () => {
    const f = fakeFont();
    layoutText(f, 'A', { align: 'left', line: 1, track: 0 });
    expect(f.calls[0]).toMatchObject({ flipY: false });
  });

  it('alinea cada línea respecto al punto de origen', () => {
    const f = fakeFont(), st = { line: 1, track: 0 };
    // «AB» mide 700 + 600 de tinta = 1300 de caja; su avance es 1400
    expect(layoutText(f, 'AB', { ...st, align: 'center' })!.box.x0).toBe(-700);
    expect(layoutText(f, 'AB', { ...st, align: 'right' })!.box.x0).toBe(-1400);
  });

  it('las líneas bajan con el interlineado y el espaciado separa las letras', () => {
    const s = layoutText(fakeFont(), 'A\nA', { align: 'left', line: 1.5, track: 0 })!;
    expect(s.box.y1).toBe(1500);
    const t = layoutText(fakeFont(), 'AB', { align: 'left', line: 1, track: 100 })!;
    expect(t.box.x1).toBe(700 + 100 + 600);
  });

  it('sin nada que ver (vacío o espacios) no hay contornos', () => {
    expect(layoutText(fakeFont(), '', { align: 'left', line: 1, track: 0 })).toBeNull();
    expect(layoutText(fakeFont(), '  \n ', { align: 'left', line: 1, track: 0 })).toBeNull();
    expect(layoutText(fakeFont(), 'A B', { align: 'left', line: 1, track: 0 })!.glyphs).toHaveLength(2);
  });

  it('sin altura de mayúsculas declarada, se mide la «H»', () => {
    expect(capHeight(fakeFont({ cap: 0 }))).toBe(700);
  });

  it('la caja de los renglones tiene el aire del interlineado; ajustada, solo las letras', () => {
    // upm 1000, ascendente 900, descendente −250 (1150 de letra): con interlineado 1,35 sobran 100 arriba y 100 abajo
    const s = layoutText(fakeFont(), ['AB', 'A'].join(String.fromCharCode(10)), { align: 'center', line: 1.35, track: 0 })!;
    expect(s.lineBox).toEqual({ x0: -700, y0: -1000, x1: 700, y1: -1000 + 2 * 1350 });
    expect(frameOf({ fit: false, shape: s })).toEqual(s.lineBox);
    expect(frameOf({ fit: true, shape: s })).toEqual(s.box);
    // si las letras salen del renglón (interlineado muy justo), la caja crece para no cortarlas
    const t = layoutText(fakeFont(), 'A', { align: 'left', line: 0.5, track: 0 })!;
    expect(frameOf({ fit: false, shape: t }).y0).toBe(-700);
    // sin caja de renglones (textos guardados antes), la de las letras
    expect(frameOf({ fit: false, shape: { ...s, lineBox: undefined } })).toEqual(s.box);
  });

  it('mide el ancho de cada línea', () => {
    expect(lineAdvances(fakeFont(), 'AV\nA', 0)).toEqual([1300, 700]);
  });

  it('con ancho fijo parte las líneas entre palabras, sin partir palabras', () => {
    const f = fakeFont();
    // cada letra avanza 700: «AA BB» mide 3500; con 2200 de ancho, «AA» y «BB» van en líneas distintas
    expect(wrapText(f, 'AA BB', 0, 2200)).toEqual(['AA', 'BB']);
    expect(wrapText(f, 'AA BB', 0, 4000)).toEqual(['AA BB']);
    // los saltos escritos se respetan; una palabra más ancha que el ancho queda sola, entera
    expect(wrapText(f, 'A\nBBBB C', 0, 1500)).toEqual(['A', 'BBBB', 'C']);
    expect(wrapText(f, 'AA BB', 0, null)).toEqual(['AA BB']);
    expect(minWidth(f, 'A BBBB', 0)).toBe(2800);
    // la caja mide el ancho fijo aunque las líneas sean más cortas
    const s = layoutText(f, 'AA BB', { align: 'left', line: 1, track: 0, width: 2200 })!;
    expect(s.lineBox!.x1 - s.lineBox!.x0).toBe(2200);
    expect(s.lineBox!.y1 - s.lineBox!.y0).toBe(2000);
  });
});

describe('textName', () => {
  it('usa la primera línea con texto, acortada', () => {
    expect(textName('\n  Feliz cumpleaños  \nAna')).toBe('Feliz cumpleaños');
    expect(textName('   ')).toBe('Texto');
    expect(textName('x'.repeat(40))).toHaveLength(32);
  });
});

describe('readSpec', () => {
  const ok = {
    text: 'Hola', font: 'b:archivo-black', fontName: 'Archivo Black', align: 'left', line: 1.2, track: 0, color: '#112233', fit: false, width: null,
    shape: {
      glyphs: [{ ch: 'H', d: 'M0 0L10 0L10 -7Z' }], box: { x0: 0, y0: -7, x1: 10, y1: 0 },
      lineBox: { x0: 0, y0: -10, x1: 12, y1: 2 }, cap: 7, asc: 9, desc: -2, upm: 10,
    },
  };
  it('acepta un texto guardado bien formado', () => {
    expect(readSpec(ok)).toEqual(ok);
  });
  it('conserva textos largos guardados por versiones anteriores', () => {
    const text = 'A' + ' '.repeat(10000);
    expect(readSpec({ ...ok, text })?.text).toBe(text);
  });
  it('los textos guardados sin caja de renglones quedan ajustados a las letras', () => {
    const { lineBox: _, ...shape } = ok.shape;
    expect(readSpec({ ...ok, shape })!.fit).toBe(true);
  });
  it('rechaza trazados con algo que no sean comandos y números', () => {
    expect(readSpec({ ...ok, shape: { ...ok.shape, glyphs: [{ ch: 'H', d: 'M0 0 <script>' }] } })).toBeNull();
  });
  it('rechaza cajas vacías y corrige valores fuera de rango', () => {
    expect(readSpec({ ...ok, shape: { ...ok.shape, box: { x0: 0, y0: 0, x1: 0, y1: 0 } } })).toBeNull();
    const r = readSpec({ ...ok, align: 'raro', color: 'red', line: 99, track: -9999 })!;
    expect([r.align, r.color, r.line, r.track]).toEqual(['center', '#111111', 4, -500]);
  });
});
