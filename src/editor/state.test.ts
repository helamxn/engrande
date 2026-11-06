import { describe, expect, it } from 'vitest';
import { DEFAULT_EXPORT, freshLayout, isFreshPoster, S, st } from './state';

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
