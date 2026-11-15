/**
 * Fuentes del texto. Hay dos clases:
 * - incluidas con la app (licencia SIL Open Font License): siempre disponibles, se descargan al usarlas;
 * - del usuario (un archivo .ttf, .otf o .woff que elige o suelta): se leen en este navegador y solo duran lo que
 *   dure la pestaña. No se guardan ni se envían a ningún sitio. Los textos guardan sus contornos (ver shape.ts),
 *   así que se siguen viendo e imprimiendo; para cambiarles las palabras hay que volver a cargar la fuente.
 * opentype.js (para leer los contornos) se carga solo al usar texto, como pdf.js con los PDF.
 */
import type { Font } from 'opentype.js';
import { GOOGLE_FONTS } from './catalog';
import { prepareFont } from './prepare';
import { localFace, localFaces, localReady, localState } from './local';

export interface FontEntry {
  id: string;
  name: string;
  builtin: boolean;
  font: Font;
  /** Familia CSS registrada con la misma fuente (para el cuadro de escritura y la lista). */
  css: string;
}

export const BUILTIN = GOOGLE_FONTS;
export const DEFAULT_FONT = 'b:archivo-black';

const loaded = new Map<string, FontEntry>();
const pendingLoads = new Map<string, Promise<FontEntry>>();
let ot: Promise<typeof import('opentype.js')> | null = null;
const opentype = () => (ot ??= import('opentype.js'));

/** Formatos que se pueden leer. WOFF2 necesitaría un descompresor aparte. */
export const FONT_ACCEPT = '.ttf,.otf,.woff,font/ttf,font/otf,font/woff';
export const isFontFile = (f: File) => /\.(ttf|otf|woff2?)$/i.test(f.name) || /^font\/|application\/(x-)?font/.test(f.type);

let seq = 0;
async function register(id: string, name: string, builtin: boolean, buf: ArrayBuffer): Promise<FontEntry> {
  const { parse } = await opentype();
  const font = prepareFont(parse(buf));
  const css = `engrande-font-${++seq}`;
  try {
    const face = new FontFace(css, buf);
    await face.load();
    document.fonts.add(face);
  } catch (err) {
    console.warn('El navegador no pudo usar la fuente para escribir; se escribe con otra', err); // los contornos sí valen
  }
  const e: FontEntry = { id, name, builtin, font, css };
  loaded.set(id, e);
  return e;
}

export const getFont = (id: string) => id.startsWith('l:') && localState() !== 'ready' ? null : loaded.get(id) ?? null;
/** Fuentes que se pueden elegir ahora: las incluidas y las del usuario que ya están cargadas. */
export interface FontChoice { id: string; name: string; family: string; style: string; weight: number; italic: boolean; builtin: boolean; provider: 'google' | 'local' | 'file' }
export function fontChoices(): FontChoice[] {
  return [...BUILTIN.map((b) => ({ ...b, builtin: true })),
    ...localFaces().map(([id, face]) => ({ id, name: face.family, family: face.family, style: face.style || 'Regular',
      weight: /bold|negrita|black|heavy/i.test(face.style) ? 700 : 400, italic: /italic|oblique|cursiva/i.test(face.style), builtin: false, provider: 'local' as const })),
    ...[...loaded.values()].filter(e => e.id.startsWith('u:'))
      .map(e => ({ id: e.id, name: e.name, family: e.name, style: 'Original', weight: 400, italic: false, builtin: false, provider: 'file' as const }))];
}

/** La fuente lista para usar: las incluidas se descargan la primera vez; las del usuario, solo si siguen cargadas. */
export async function ensureFont(id: string): Promise<FontEntry | null> {
  const have = getFont(id);
  if (have) return have;
  if (id.startsWith('l:')) {
    await localReady();
    const face = localFace(id);
    if (!face || localState() !== 'ready') return null;
    let pending = pendingLoads.get(id);
    if (!pending) {
      pending = face.blob().then(blob => blob.arrayBuffer()).then(buf => register(id, face.family, false, buf))
        .finally(() => pendingLoads.delete(id));
      pendingLoads.set(id, pending);
    }
    return pending;
  }
  const b = BUILTIN.find((x) => x.id === id);
  if (!b) return null;
  let p = pendingLoads.get(id);
  if (!p) {
    p = fetch(b.url).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.arrayBuffer(); })
      .then((buf) => register(b.id, b.name, true, buf))
      .finally(() => pendingLoads.delete(id));
    pendingLoads.set(id, p);
  }
  return p;
}

export class FontError extends Error {}

/** Lee una fuente que eligió el usuario. Si ya estaba cargada (la misma fuente), se reemplaza. */
export async function loadFontFile(f: File): Promise<FontEntry> {
  if (/\.woff2$/i.test(f.name) || f.type === 'font/woff2') {
    throw new FontError(`«${f.name}» es WOFF2 y todavía no se puede usar. Prueba con la versión TTF, OTF o WOFF.`);
  }
  const buf = await f.arrayBuffer();
  let font: Font;
  try { font = (await opentype()).parse(buf.slice(0)); } catch { throw new FontError(`No pude leer «${f.name}» como fuente. Prueba con un archivo TTF, OTF o WOFF.`); }
  const family = font.getEnglishName('fontFamily') ?? f.name.replace(/\.[^.]+$/, '');
  const sub = font.getEnglishName('fontSubfamily');
  const name = sub && !/^(regular|normal)$/i.test(sub) ? `${family} ${sub}` : family;
  const id = 'u:' + (font.getEnglishName('postScriptName') ?? font.getEnglishName('fullName') ?? name);
  return register(id, name, false, buf);
}
