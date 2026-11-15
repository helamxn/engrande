import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, it } from 'vitest';
import { parse } from 'opentype.js';
import { prepareFont } from './prepare';
import { layoutText } from './shape';

const require = createRequire(import.meta.url);
// Lee las mismas rutas declaradas por el catálogo: verifica los archivos reales de cada variante.
const catalog = readFileSync(new URL('./catalog.ts', import.meta.url), 'utf8');
const files = [...catalog.matchAll(/from '(@fontsource\/[^']+)\?url'/g)].map(match => match[1]!);

it.each(files)('compone texto y acentos en %s', file => {
  const bytes = readFileSync(require.resolve(file));
  const font = prepareFont(parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
  for (const c of 'HñÑáéíóúü¿¡') expect(font.charToGlyph(c).index).toBeGreaterThan(0);
  const shape = layoutText(font, '¡Feliz cumpleaños!\nÑandu\u0301 · fi fl', { align: 'center', line: 1.15, track: 0 });
  expect(shape?.glyphs.length).toBeGreaterThan(10);
  expect(shape?.box.x1).toBeGreaterThan(shape!.box.x0);
  expect(shape?.glyphs.some(g => /NaN|Infinity/.test(g.d))).toBe(false);
});
