import { describe, expect, it } from 'vitest';
import { cm, cmGap, fmt1, parseNum } from './format';

describe('formato de números (coma decimal)', () => {
  it('muestra cm y campos con coma', () => {
    expect(cm(386)).toBe('38,6');
    expect(fmt1(14.26)).toBe('14,3');
    expect(fmt1(-2)).toBe('-2');
  });
  it('lee coma o punto decimal', () => {
    expect(parseNum('14,3')).toBe(14.3);
    expect(parseNum(' 14.3 ')).toBe(14.3);
    expect(parseNum('abc')).toBeNaN();
  });
});

describe('distancias medidas', () => {
  it('un hueco pequeño nunca dice 0,0', () => {
    expect(cmGap(0.3)).toBe('0,03');
    expect(cmGap(3.5)).toBe('0,35');
  });
  it('la misma precisión a cualquier tamaño: cada mm se ve (1,08 → 0,98)', () => {
    expect(cmGap(10.8)).toBe('1,08');
    expect(cmGap(9.8)).toBe('0,98');
    expect(cmGap(386.4)).toBe('38,64');
  });
  it('sin ceros de más, pero con al menos un decimal', () => {
    expect(cmGap(20)).toBe('2,0');
    expect(cmGap(386)).toBe('38,6');
  });
});
