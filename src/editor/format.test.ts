import { describe, expect, it } from 'vitest';
import { cm, fmt1, parseNum } from './format';

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
