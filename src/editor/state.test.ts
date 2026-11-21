import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT, DEFAULT_LAYOUT, freshLayout, isFreshPoster, readLayout, S, st } from './state';
import { MIN_SIZE } from './constants';

/** Póster recién empezado: sin imágenes, sin hojas elegidas y con los ajustes iniciales. */
const reset = () => {
  st.layers = []; st.sheetsOn = false;
  Object.assign(S, freshLayout(), DEFAULT_EXPORT);
};

describe('isFreshPoster («Nuevo póster» no tiene nada que hacer)', () => {
  it('un póster recién empezado es nuevo', () => {
    reset();
    expect(isFreshPoster()).toBe(true);
  });
  it('con imágenes, no', () => {
    reset();
    st.layers = [{}] as never;
    expect(isFreshPoster()).toBe(false);
    st.layers = [];
  });
  it('con las hojas ya elegidas, no (aunque no haya imágenes)', () => {
    reset();
    st.sheetsOn = true;
    expect(isFreshPoster()).toBe(false);
  });
  it('con otra distribución o ajustes de descarga, no', () => {
    reset(); S.cols = 3;
    expect(isFreshPoster()).toBe(false);
    reset(); S.dpi = 300;
    expect(isFreshPoster()).toBe(false);
    reset();
  });
});

describe('readLayout (distribución leída de lo guardado)', () => {
  it('un póster de antes, sin medida, se abre igual', () => {
    expect(readLayout({ paper: 'A3', orient: 'landscape', cols: 3, rows: 2, margin: 5, overlap: 12 }))
      .toEqual({ paper: 'A3', orient: 'landscape', cols: 3, rows: 2, size: null, margin: 5, overlap: 12 });
  });
  it('conserva la medida, en mm enteros y dentro de lo que caben 12 × 12 hojas', () => {
    const l = readLayout({ paper: 'A4', orient: 'portrait', cols: 2, rows: 1, margin: 6, overlap: 10, size: { w: 1000.4, h: 99999 } });
    expect(l.size).toEqual({ w: 1000, h: Math.floor(12 * 285 - 11 * 10) });
  });
  it('lo dañado o fuera de rango vuelve al valor de siempre', () => {
    const l = readLayout({ paper: 'B5', orient: 'x', cols: 0, rows: 99, margin: -3, overlap: 'mucho', size: { w: 'a', h: 3 } });
    expect(l).toEqual({ ...DEFAULT_LAYOUT });
    expect(readLayout(null)).toEqual({ ...DEFAULT_LAYOUT });
    expect(readLayout({ paper: 'constructor' }).paper).toBe('A4'); // nombres del prototipo, no papeles
    expect(readLayout({ size: { w: 10, h: 10 } }).size).toEqual({ w: MIN_SIZE, h: MIN_SIZE });
  });
  it('un póster con otra medida o sin omitir hojas en blanco ya no es nuevo', () => {
    reset(); S.size = { w: 1000, h: 700 };
    expect(isFreshPoster()).toBe(false);
    reset(); S.skipBlank = false;
    expect(isFreshPoster()).toBe(false);
    reset();
  });
});
