import { describe, expect, it } from 'vitest';
import { normalizeColor } from './values';
import { readDraft } from './spec';

describe('colores pegados', () => {
  it('acepta hexadecimal con espacios, mayúsculas, abreviado y sin almohadilla', () => {
    expect(normalizeColor(' #D81B60 ')).toBe('#d81b60');
    expect(normalizeColor('abc')).toBe('#aabbcc');
    expect(normalizeColor('112233')).toBe('#112233');
  });
  it('rechaza formatos incompletos y transparencia (se controla con opacidad)', () => {
    for (const value of ['', '#12', '#12345', '#12345678', 'red', '#zzzzzz']) expect(normalizeColor(value)).toBeNull();
  });
});

describe('borradores', () => {
  const draft = { target: null, text: 'Sin terminar', font: 'b:archivo-black', fontName: 'Archivo Black',
    style: { align: 'center', line: 1.15, track: 0, color: '#FFF', fit: false },
    origin: { x: 10, y: 20 }, cap: 30, rot: 0, flipX: false, flipY: false };
  it('recupera las palabras y normaliza el color sin necesitar contornos ni fuente', () => {
    expect(readDraft(draft)?.text).toBe('Sin terminar');
    expect(readDraft(draft)?.style.color).toBe('#ffffff');
  });
  it('rechaza referencias y medidas inválidas', () => {
    expect(readDraft({ ...draft, target: -1 })).toBeNull();
    expect(readDraft({ ...draft, cap: Infinity })).toBeNull();
    expect(readDraft({ ...draft, origin: { x: NaN, y: 0 } })).toBeNull();
  });
});
