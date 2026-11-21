import { describe, expect, it } from 'vitest';
import { checkScale, isWhite, pieces, printedNumbers, tilePixels, touchesTile, untouched, WHITE } from './blank';
import { geo, tiles } from './geometry';
import type { Settings } from './types';

const rect = (x0: number, y0: number, x1: number, y1: number) => [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
const tile = { x0: 0, y0: 0, w: 100, h: 100 };

describe('touchesTile', () => {
  it('dentro, fuera y solapando', () => {
    expect(touchesTile(rect(10, 10, 20, 20), tile)).toBe(true);
    expect(touchesTile(rect(150, 10, 200, 20), tile)).toBe(false);
    expect(touchesTile(rect(90, 90, 200, 200), tile)).toBe(true);
    expect(touchesTile(rect(-50, -50, 300, 300), tile)).toBe(true); // la hoja entera dentro de la imagen
  });
  it('rozar el borde no cuenta', () => {
    expect(touchesTile(rect(100, 0, 200, 100), tile)).toBe(false);
    expect(touchesTile(rect(100.02, 0, 200, 100), tile)).toBe(false);
  });
  it('un rombo cuya caja toca la esquina, pero él no', () => {
    // rombo centrado en (130, 130) con radio 40: su caja entra en la hoja, el rombo no
    const d = [{ x: 130, y: 90 }, { x: 170, y: 130 }, { x: 130, y: 170 }, { x: 90, y: 130 }];
    expect(touchesTile(d, tile)).toBe(false);
    const d2 = d.map((p) => ({ x: p.x - 25, y: p.y - 25 }));
    expect(touchesTile(d2, tile)).toBe(true);
  });
});

describe('hojas que no toca ninguna imagen', () => {
  const g = geo({ paper: 'A4', orient: 'portrait', cols: 3, rows: 2, size: null, margin: 6, overlap: 10 } as Settings);
  const ts = tiles(g);
  it('una imagen en la esquina deja en blanco las demás', () => {
    expect([...untouched(ts, [rect(10, 10, 100, 100)])]).toEqual([1, 2, 3, 4, 5]);
  });
  it('lo que cae en el solape cuenta para las dos hojas', () => {
    // franja compartida entre la hoja 1 y la 2: x de 188 a 198
    expect([...untouched(ts, [rect(190, 10, 195, 20)])]).toEqual([2, 3, 4, 5]);
  });
  it('sin imágenes, todas en blanco', () => {
    expect(untouched(ts, []).size).toBe(6);
  });
});

describe('píxeles', () => {
  const img = (w: number, h: number, fill = 255) => new Uint8ClampedArray(w * h * 4).fill(fill);
  it('blanco, casi blanco y un punto oscuro', () => {
    const d = img(10, 10);
    expect(isWhite(d, 10, 0, 0, 10, 10)).toBe(true);
    d.fill(WHITE, 0, 4 * 10); // primera fila casi blanca: sigue en blanco
    expect(isWhite(d, 10, 0, 0, 10, 10)).toBe(true);
    const i = (5 * 10 + 7) * 4; d[i + 2] = 200; // un píxel algo amarillo
    expect(isWhite(d, 10, 0, 0, 10, 10)).toBe(false);
    expect(isWhite(d, 10, 0, 0, 7, 10)).toBe(true); // fuera del rectángulo no cuenta
    expect(isWhite(d, 10, 0, 6, 10, 10)).toBe(true);
  });
  it('los píxeles de la hoja se redondean hacia fuera y no se salen de la imagen', () => {
    expect(tilePixels({ x0: 10.4, y0: 0, w: 10, h: 5 }, 1, 100, 100)).toEqual({ x0: 10, y0: 0, x1: 21, y1: 5 });
    expect(tilePixels({ x0: 90, y0: 90, w: 50, h: 50 }, 1, 100, 100)).toEqual({ x0: 90, y0: 90, x1: 100, y1: 100 });
  });
  it('la resolución de la comprobación se limita en pósters grandes', () => {
    expect(checkScale(400, 300)).toBe(2);
    expect(checkScale(2000, 3000) ** 2 * 2000 * 3000).toBeCloseTo(4e6);
  });
});

describe('numeración y piezas', () => {
  it('las impresas van seguidas', () => {
    expect(printedNumbers(5, new Set([1, 3]))).toEqual([1, null, 2, null, 3]);
    expect(printedNumbers(3, new Set())).toEqual([1, 2, 3]);
  });
  it('cuenta las piezas que quedan sueltas', () => {
    const g = geo({ paper: 'A4', orient: 'portrait', cols: 3, rows: 2, size: null, margin: 6, overlap: 10 } as Settings), ts = tiles(g);
    expect(pieces(ts, new Set(), 3)).toBe(1);
    expect(pieces(ts, new Set([1, 4]), 3)).toBe(2); // la columna del medio vacía
    expect(pieces(ts, new Set([1, 3]), 3)).toBe(2); // 0 queda sola (solo toca por esquina con la 4)
    expect(pieces(ts, new Set([0, 1, 2, 3, 4, 5]), 3)).toBe(0);
  });
});
