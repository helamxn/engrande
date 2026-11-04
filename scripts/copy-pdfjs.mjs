// Copia los recursos que pdf.js descarga en tiempo de ejecución (mapas de caracteres, fuentes estándar,
// decodificadores WASM y perfiles de color) a public/pdfjs, para servirlos desde el propio dominio.
// Se ejecuta antes de `dev` y `build`; la carpeta generada no se versiona.
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = dirname(require.resolve('pdfjs-dist/package.json'));
const out = join(root, 'public', 'pdfjs');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const dir of ['cmaps', 'standard_fonts', 'iccs']) cpSync(join(pkg, dir), join(out, dir), { recursive: true });

// Solo los decodificadores de imagen; el intérprete de JavaScript de PDF (quickjs) no se usa ni se publica.
mkdirSync(join(out, 'wasm'));
for (const f of ['jbig2.wasm', 'openjpeg.wasm', 'qcms_bg.wasm', 'jbig2_nowasm_fallback.js', 'openjpeg_nowasm_fallback.js']) {
  const src = join(pkg, 'wasm', f);
  if (existsSync(src)) cpSync(src, join(out, 'wasm', f));
}
console.log('pdf.js: recursos copiados a public/pdfjs');
