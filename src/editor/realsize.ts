/**
 * Tamaño real (escala 1:1) de un PDF o un SVG: lo que mide su página impresa al 100 %. Para moldes de costura,
 * planos y plantillas, donde la medida importa más que encajar en el póster.
 *
 * - PDF: la página dice su tamaño en puntos (1/72 de pulgada), con su giro y su UserUnit: es exacto.
 * - SVG: solo con ancho y alto en unidades absolutas (mm, cm, in, pt, pc). Sin unidad o en px no se sabe: Illustrator
 *   los exporta a 72 por pulgada y el navegador cuenta 96, así que no se adivina.
 * - Fotos (JPG, PNG…): sus «ppp» casi nunca son de fiar (72 o 96 por defecto): no tienen tamaño real.
 */
import type { Layer, Size } from './types';

const MM: Record<string, number> = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6 };

/** Medida de un atributo de longitud de SVG en mm («210mm», «8.5in»); null si no es absoluta o no tiene sentido. */
export function svgLength(v: string | null | undefined): number | null {
  const m = /^\s*([0-9]*\.?[0-9]+(?:e[+-]?\d+)?)\s*(mm|cm|in|pt|pc)\s*$/i.exec(v ?? '');
  if (!m) return null;
  const mm = parseFloat(m[1]!) * MM[m[2]!.toLowerCase()]!;
  return mm >= 1 && mm <= 100_000 ? mm : null;
}

/** Tamaño real de un SVG a partir de su texto: el ancho y el alto de la etiqueta raíz. */
export function svgSizeMM(text: string): Size | null {
  // solo la etiqueta <svg …> de arriba: no hace falta interpretar el documento (ni ejecutar nada)
  const tag = /<svg\b[^>]*>/i.exec(text.slice(0, 64 * 1024))?.[0];
  if (!tag) return null;
  const attr = (n: string) => new RegExp(`\\s${n}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2];
  const w = svgLength(attr('width')), h = svgLength(attr('height'));
  return w && h ? { w, h } : null;
}

/** Puntos de PDF (1/72 de pulgada) a mm. */
export const ptToMm = (pt: number) => (pt * 25.4) / 72;

/* ---------- en caché por archivo y página ---------- */
const cache = new WeakMap<object, Map<number, Promise<Size | null>>>();

/** Tamaño real de lo que muestra la imagen (la página del PDF o el SVG entero); null si no tiene. */
export function realSize(l: Layer): Promise<Size | null> {
  const src = l.src;
  if (!src || (src.kind !== 'pdf' && src.kind !== 'svg')) return Promise.resolve(null);
  let m = cache.get(src.blob);
  if (!m) { m = new Map(); cache.set(src.blob, m); }
  const page = src.kind === 'pdf' ? l.page : 1;
  let p = m.get(page);
  if (!p) {
    p = (async () => {
      try {
        if (src.kind === 'svg') return svgSizeMM(await src.blob.text());
        if (!l.pdf) return null;
        const pg = await l.pdf.getPage(page), vp = pg.getViewport({ scale: 1 }), unit = pg.userUnit || 1;
        return { w: ptToMm(vp.width * unit), h: ptToMm(vp.height * unit) };
      } catch { return null; }
    })();
    m.set(page, p);
  }
  return p;
}

/** Lo último que se sabe del tamaño real, sin esperar (para habilitar botones); undefined si aún no se sabe. */
const known = new WeakMap<Layer, { page: number; size: Size | null }>();
export function knownRealSize(l: Layer): Size | null | undefined {
  const k = known.get(l);
  return k && k.page === l.page ? k.size : undefined;
}
/** Averigua el tamaño real (si no se sabe ya) y llama a done cuando lo sabe. */
export function learnRealSize(l: Layer, done: () => void) {
  if (knownRealSize(l) !== undefined) return;
  const page = l.page;
  void realSize(l).then((size) => { known.set(l, { page, size }); done(); });
}
