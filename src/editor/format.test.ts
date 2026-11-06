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
  it('en mm enteros, un decimal como el resto de la app', () => {
    expect(cmGap(20)).toBe('2,0');
    expect(cmGap(13)).toBe('1,3');
    expect(cmGap(386)).toBe('38,6');
    expect(cmGap(9.98)).toBe('1,0'); // a menos de 0,05 mm: es el mismo mm
  });
  it('fuera de un mm entero, dos decimales: avisa de que no es redonda', () => {
    expect(cmGap(10.8)).toBe('1,08');
    expect(cmGap(13.9)).toBe('1,39');
    expect(cmGap(20.5)).toBe('2,05'); // no «2,1»: medio mm se ve
    expect(cmGap(386.4)).toBe('38,64');
  });
  it('un hueco pequeño nunca dice 0,0', () => {
    expect(cmGap(0.3)).toBe('0,03');
    expect(cmGap(3.5)).toBe('0,35');
  });
});
