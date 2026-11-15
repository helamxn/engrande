/** Lectura de un texto guardado: se comprueba cada campo, y lo que no cuadra se descarta en vez de romper el póster. */
import type { TextAlign, TextSpec, TextDraft } from '../types';
import { normalizeColor } from './values';

const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const str = (v: unknown, max: number): v is string => typeof v === 'string' && v.length <= max;
/** Solo datos de trazado SVG: letras de comando y números. */
const PATH_RE = /^[MLHVCSQTAZmlhvcsqtaz0-9eE.,\s+-]*$/;

export function readSpec(v: unknown): TextSpec | null {
  if (!v || typeof v !== 'object') return null;
  const s = v as Record<string, unknown>, sh = s.shape as Record<string, unknown> | undefined;
  // El límite se aplica al escribir. No se descartan textos largos creados por versiones anteriores.
  if (typeof s.text !== 'string' || typeof s.font !== 'string' || typeof s.fontName !== 'string' || !sh || typeof sh !== 'object') return null;
  const align: TextAlign = s.align === 'left' || s.align === 'right' ? s.align : 'center';
  const color = typeof s.color === 'string' ? normalizeColor(s.color) ?? '#111111' : '#111111';
  const b = sh.box as Record<string, unknown> | undefined;
  if (!b || ![b.x0, b.y0, b.x1, b.y1].every(num) || !((b.x1 as number) > (b.x0 as number)) || !((b.y1 as number) > (b.y0 as number))) return null;
  if (![sh.cap, sh.asc, sh.desc, sh.upm].every(num) || !((sh.cap as number) > 0) || !((sh.upm as number) > 0)) return null;
  if (!Array.isArray(sh.glyphs) || !sh.glyphs.length) return null;
  const l = sh.lineBox as Record<string, unknown> | undefined;
  const lb = l && [l.x0, l.y0, l.x1, l.y1].every(num) && (l.x1 as number) >= (l.x0 as number) && (l.y1 as number) > (l.y0 as number)
    ? { x0: l.x0 as number, y0: l.y0 as number, x1: l.x1 as number, y1: l.y1 as number } : null;
  const glyphs: TextSpec['shape']['glyphs'] = [];
  for (const g of sh.glyphs as unknown[]) {
    const x = g as Record<string, unknown> | null;
    if (!x || !str(x.d, 200000) || !PATH_RE.test(x.d)) return null;
    glyphs.push({ ch: str(x.ch, 16) ? x.ch : '', d: x.d });
  }
  return {
    text: s.text, font: s.font, fontName: s.fontName, align, color,
    line: num(s.line) ? Math.min(4, Math.max(0.5, s.line)) : 1.15,
    // los primeros textos guardados no tenían caja de renglones: se quedan ajustados a las letras
    fit: lb ? s.fit === true : true,
    track: num(s.track) ? Math.min(1000, Math.max(-500, s.track)) : 0,
    width: num(s.width) && s.width > 0 ? s.width : null,
    shape: {
      glyphs, cap: sh.cap as number, asc: sh.asc as number, desc: sh.desc as number, upm: sh.upm as number,
      box: { x0: b.x0 as number, y0: b.y0 as number, x1: b.x1 as number, y1: b.y1 as number },
      ...(lb ? { lineBox: lb } : {}),
    },
  };
}

export function readDraft(v: unknown): TextDraft | null {
  if (!v || typeof v !== 'object') return null;
  const d = v as TextDraft;
  if (typeof d.text !== 'string' || typeof d.font !== 'string' || typeof d.fontName !== 'string'
    || !d.style || !['left', 'center', 'right'].includes(d.style.align)
    || !num(d.style.line) || d.style.line < 0.5 || d.style.line > 4
    || !num(d.style.track) || Math.abs(d.style.track) > 1000
    || typeof d.style.color !== 'string' || !normalizeColor(d.style.color)
    || !d.origin || !num(d.origin.x) || !num(d.origin.y)
    || !num(d.cap) || d.cap <= 0 || !num(d.rot)
    || !(d.target === null || (Number.isInteger(d.target) && d.target >= 0))) return null;
  return { ...d, style: { ...d.style, color: normalizeColor(d.style.color)!, fit: !!d.style.fit }, origin: { ...d.origin }, flipX: !!d.flipX, flipY: !!d.flipY };
}
