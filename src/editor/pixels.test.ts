import { describe, expect, it } from 'vitest';
import { autoBackgroundParams, colorMask, combineMasks, editMaskData, eraseByMask, invertMask, maskHasAny, removeColorData, runPixelJob } from './pixels';

/** Imagen w×h de un color, con un cuadrado de otro color en (x0..x1, y0..y1). */
function img(w: number, h: number, bg: [number, number, number], fg?: { c: [number, number, number]; x0: number; y0: number; x1: number; y1: number }) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4, inFg = fg && x >= fg.x0 && x < fg.x1 && y >= fg.y0 && y < fg.y1;
    const c = inFg ? fg!.c : bg;
    d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = 255;
  }
  return d;
}
const alpha = (d: Uint8ClampedArray, w: number, x: number, y: number) => d[(y * w + x) * 4 + 3];

describe('removeColorData', () => {
  it('relleno contiguo: borra el fondo conectado y respeta el objeto', () => {
    const w = 20, h = 20, d = img(w, h, [255, 255, 255], { c: [200, 30, 30], x0: 5, y0: 5, x1: 15, y1: 15 });
    const n = removeColorData(d, w, h, [0], [255, 255, 255], 40, true);
    expect(n).toBe(w * h - 100);
    expect(alpha(d, w, 0, 0)).toBe(0);
    expect(alpha(d, w, 10, 10)).toBe(255);
  });
  it('contiguo no atraviesa un objeto: el blanco encerrado se conserva', () => {
    // anillo rojo con blanco dentro: el blanco interior no está conectado con la semilla del borde
    const w = 20, h = 20, d = img(w, h, [255, 255, 255], { c: [200, 30, 30], x0: 4, y0: 4, x1: 16, y1: 16 });
    for (let y = 8; y < 12; y++) for (let x = 8; x < 12; x++) { const o = (y * w + x) * 4; d[o] = d[o + 1] = d[o + 2] = 255; }
    removeColorData(d, w, h, [0], [255, 255, 255], 40, true);
    expect(alpha(d, w, 10, 10)).toBe(255);
    // sin "solo zona tocada" sí se borra
    removeColorData(d, w, h, [0], [255, 255, 255], 40, false);
    expect(alpha(d, w, 10, 10)).toBe(0);
  });
  it('los colores cercanos al límite quedan semitransparentes (borde suave)', () => {
    const w = 3, h = 1, d = new Uint8ClampedArray([255, 255, 255, 255, 215, 255, 255, 255, 100, 100, 100, 255]);
    removeColorData(d, w, h, [0], [255, 255, 255], 30, false);
    expect(d[3]).toBe(0);                       // igual a la referencia
    expect(d[7]).toBeGreaterThan(0);            // distancia 40: dentro de la zona suave (30–40,5)
    expect(d[7]).toBeLessThan(255);
    expect(d[11]).toBe(255);                    // muy distinto
  });
});

describe('autoBackgroundParams y runPixelJob', () => {
  it('detecta un fondo uniforme y lo quita', () => {
    const w = 30, h = 30, d = img(w, h, [240, 240, 240], { c: [20, 90, 160], x0: 10, y0: 10, x1: 20, y1: 20 });
    const p = autoBackgroundParams(d, w, h, 40);
    expect('ref' in p && p.ref).toEqual([240, 240, 240]);
    const r = runPixelJob(d, w, h, { kind: 'auto', tol: 40 });
    expect(r.removed).toBe(w * h - 100);
    expect(alpha(d, w, 15, 15)).toBe(255);
  });
  it('avisa si los bordes ya son transparentes', () => {
    const w = 10, h = 10, d = new Uint8ClampedArray(w * h * 4); // todo transparente
    expect(runPixelJob(d, w, h, { kind: 'auto', tol: 40 })).toEqual({ removed: 0, error: 'transparent' });
  });
  it('varita: borra solo el color tocado dentro de la tolerancia', () => {
    const w = 20, h = 10, d = img(w, h, [255, 255, 255], { c: [30, 160, 60], x0: 0, y0: 0, x1: 10, y1: 10 });
    const r = runPixelJob(d, w, h, { kind: 'wand', seeds: [5], ref: [30, 160, 60], tol: 20, contig: true });
    expect(r.removed).toBe(100);
    expect(alpha(d, w, 5, 5)).toBe(0);
    expect(alpha(d, w, 15, 5)).toBe(255);
  });
});

describe('editMaskData: lo retocado a mano, sin la transparencia que la imagen ya tenía', () => {
  /** Un píxel por valor de alfa (el color no cuenta). */
  const alphas = (...a: number[]) => { const d = new Uint8ClampedArray(a.length * 4); a.forEach((v, i) => { d[i * 4 + 3] = v; }); return d; };
  const mask = (img: number[], orig: number[]) => [...editMaskData(alphas(...img), alphas(...orig))].filter((_, i) => i % 4 === 3);

  it('sin retocar, la máscara es opaca: una sombra al 50 % sigue al 50 % (no al 25 %)', () => {
    expect(mask([128, 255, 10], [128, 255, 10])).toEqual([255, 255, 255]);
  });
  it('lo borrado del todo queda en 0 y lo borrado a medias, en su proporción', () => {
    expect(mask([0, 64, 128], [128, 128, 255])).toEqual([0, 128, 128]);
  });
  it('donde el original es transparente no hay nada que quitar, y nunca pasa de opaco', () => {
    expect(mask([0, 200], [0, 100])).toEqual([255, 255]);
  });
});

describe('varita que elige (colorMask, combineMasks, invertMask, eraseByMask)', () => {
  const W = 20, H = 20, red: [number, number, number] = [200, 30, 30];
  /** Fondo blanco con un cuadrado rojo en 5..15. */
  const scene = () => img(W, H, [255, 255, 255], { c: red, x0: 5, y0: 5, x1: 15, y1: 15 });
  const at = (m: Uint8ClampedArray, x: number, y: number) => m[y * W + x];

  it('elegir no borra nada: solo marca la zona del color tocado', () => {
    const d = scene(), before = d.slice();
    const m = colorMask(d, W, H, [0], [255, 255, 255], 40, true);
    expect(d).toEqual(before);
    expect(at(m, 0, 0)).toBe(255);
    expect(at(m, 10, 10)).toBe(0);
    expect(m.filter((v) => v === 255).length).toBe(W * H - 100);
  });
  it('lo ya transparente no se elige (no queda nada que borrar), pero la zona lo atraviesa', () => {
    const d = scene();
    for (let x = 0; x < W; x++) d[(2 * W + x) * 4 + 3] = 0; // una fila vacía cruzando el fondo
    const m = colorMask(d, W, H, [0], [255, 255, 255], 40, true);
    expect(at(m, 3, 2)).toBe(0);
    expect(at(m, 0, 19)).toBe(255); // del otro lado de la fila vacía, también
  });
  it('sumar junta dos zonas y restar quita una de lo elegido', () => {
    const d = scene();
    const white = colorMask(d, W, H, [0], [255, 255, 255], 40, true);
    const square = colorMask(d, W, H, [10 * W + 10], red, 40, true);
    const both = combineMasks(white, square, 'add');
    expect(at(both, 0, 0)).toBe(255);
    expect(at(both, 10, 10)).toBe(255);
    const onlyWhite = combineMasks(both, square, 'sub');
    expect(at(onlyWhite, 10, 10)).toBe(0);
    expect(at(onlyWhite, 0, 0)).toBe(255);
    // nueva: solo la última zona; restar sin nada elegido no elige nada
    expect(combineMasks(white, square, 'new')).toEqual(square);
    expect(maskHasAny(combineMasks(null, square, 'sub'))).toBe(false);
  });
  it('invertir elige todo lo demás, salvo lo ya transparente', () => {
    const d = scene();
    d[3] = 0; // el píxel (0, 0), vacío
    const inv = invertMask(colorMask(d, W, H, [W - 1], [255, 255, 255], 40, true), d);
    expect(at(inv, 10, 10)).toBe(255);
    expect(at(inv, 1, 0)).toBe(0);
    expect(at(inv, 0, 0)).toBe(0);
  });
  it('borrar lo elegido quita exactamente lo mismo que la varita de antes (incluido el borde suave)', () => {
    const a = img(W, H, [255, 255, 255], { c: [200, 200, 200], x0: 5, y0: 5, x1: 15, y1: 15 }), b = a.slice();
    const m = colorMask(a, W, H, [0], [255, 255, 255], 40, false);
    const n = eraseByMask(a, m);
    removeColorData(b, W, H, [0], [255, 255, 255], 40, false);
    expect(n).toBeGreaterThan(0);
    for (let o = 3; o < a.length; o += 4) expect(Math.abs(a[o]! - b[o]!)).toBeLessThanOrEqual(1);
  });
  it('el trabajo «mask» del worker borra con la máscara', () => {
    const d = scene(), m = colorMask(d, W, H, [0], [255, 255, 255], 40, true);
    const r = runPixelJob(d, W, H, { kind: 'mask', mask: m });
    expect(r.removed).toBe(W * H - 100);
    expect(d[3]).toBe(0);
    expect(d[(10 * W + 10) * 4 + 3]).toBe(255);
  });
});
