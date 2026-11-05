import { describe, expect, it } from 'vitest';
import { memoryLimits } from './platform';

describe('límites de memoria según la RAM (memoryLimits)', () => {
  it('con poca RAM baja todos los límites', () => {
    const low = memoryLimits(2, false), high = memoryLimits(8, false);
    for (const k of ['hiArea', 'singleArea', 'pixBudget', 'maxImagePixels', 'pdfImageSize'] as const) {
      expect(low[k]).toBeLessThan(high[k]);
    }
  });
  it('con 4 GB queda en el medio', () => {
    const mid = memoryLimits(4, false);
    expect(mid.hiArea).toBeGreaterThan(memoryLimits(1, false).hiArea);
    expect(mid.hiArea).toBeLessThan(memoryLimits(8, false).hiArea);
  });
  it('sin dato de RAM decide por el tipo de pantalla', () => {
    expect(memoryLimits(undefined, true)).toEqual(memoryLimits(4, false));
    expect(memoryLimits(undefined, false)).toEqual(memoryLimits(8, false));
  });
  it('con 8 GB, aunque sea táctil, usa los límites de escritorio', () => {
    expect(memoryLimits(8, true)).toEqual(memoryLimits(8, false));
  });
});
