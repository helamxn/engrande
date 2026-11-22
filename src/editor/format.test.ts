import { describe, expect, it } from 'vitest';
import { cm, cmGap, fmt1, numberList, parseNum } from './format';

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
  it('acepta la unidad al final y operaciones, como en Figma', () => {
    expect(parseNum('14 cm')).toBe(14);
    expect(parseNum('30°')).toBe(30);
    expect(parseNum('21/2')).toBe(10.5);
    expect(parseNum('14,3+2')).toBeCloseTo(16.3);
    expect(parseNum('(10+5)*2')).toBe(30);
    expect(parseNum('2 × 3')).toBe(6);
    expect(parseNum('-3')).toBe(-3);
    expect(parseNum('10-2-3')).toBe(5);
    expect(parseNum('8/2/2')).toBe(2);
    expect(parseNum('1+2*3')).toBe(7);
  });
  it('lo incompleto o lo que no es un número no vale', () => {
    for (const s of ['', '5+', '(2', '2)', '5/0', '1,2,3', '3 manzanas', '1e5']) expect(parseNum(s)).toBeNaN();
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

describe('lista de hojas', () => {
  it('junta los seguidos y termina con «y»', () => {
    expect(numberList([4])).toBe('4');
    expect(numberList([1, 2])).toBe('1 y 2');
    expect(numberList([1, 2, 3, 5])).toBe('1–3 y 5');
    expect(numberList([1, 3, 4, 5, 9, 10])).toBe('1, 3–5, 9 y 10');
    expect(numberList([])).toBe('');
  });
});
