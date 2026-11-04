import { describe, expect, it } from 'vitest';
import { autoBackgroundParams, removeColorData, runPixelJob } from './pixels';

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
