import { describe, expect, it } from 'vitest';
import { ptToMm, svgLength, svgSizeMM } from './realsize';

describe('tamaño real', () => {
  it('lee longitudes absolutas de SVG en mm', () => {
    expect(svgLength('210mm')).toBe(210);
    expect(svgLength(' 29.7 cm ')).toBeCloseTo(297);
    expect(svgLength('8.5in')).toBeCloseTo(215.9);
    expect(svgLength('72pt')).toBeCloseTo(25.4);
    expect(svgLength('6pc')).toBeCloseTo(25.4);
  });
  it('no adivina px, porcentajes ni sin unidad', () => {
    for (const v of ['800', '800px', '100%', '', null, 'auto', '-5mm', '0mm']) expect(svgLength(v)).toBeNull();
  });
  it('toma el ancho y el alto de la etiqueta raíz', () => {
    expect(svgSizeMM('<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="841mm" height=\'1189mm\' viewBox="0 0 841 1189"><rect width="5mm"/></svg>'))
      .toEqual({ w: 841, h: 1189 });
    expect(svgSizeMM('<svg width="800" height="600"></svg>')).toBeNull();
    expect(svgSizeMM('<svg viewBox="0 0 10 10"></svg>')).toBeNull();
    expect(svgSizeMM('no es un svg')).toBeNull();
    // no confunde stroke-width con width
    expect(svgSizeMM('<svg stroke-width="2mm" height="10mm" width="20mm">')).toEqual({ w: 20, h: 10 });
  });
  it('convierte puntos de PDF a mm (A4 = 595,28 × 841,89 pt)', () => {
    expect(ptToMm(595.28)).toBeCloseTo(210, 1);
    expect(ptToMm(841.89)).toBeCloseTo(297, 1);
  });
});
