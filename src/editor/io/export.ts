/** Exportación a PDF: por hojas (con guía de armado, marcas y solapes) o en una sola hoja grande. */
import { BRAND } from '../../brand';
import type { jsPDF as JsPDF } from 'jspdf';
import { $, freeCanvas, tick, toast } from '../dom';
import { cmGap } from '../format';
import { bboxMM, chooseSheets, hasCutMarks, markLen, sheetCells, sheetNo, srcDims, tileRegion, type SheetCell } from '../geometry';
import { markExported } from '../history';
import { editMaskData } from '../pixels';
import { HI_AREA, SINGLE_AREA } from '../platform';
import { drawAll } from '../render';
import { canvasRevision } from './persist';
import { syncExportButtons } from '../ui/panel';
import { PAPERS } from '../constants';
import { posterGeo, S, st } from '../state';
import { bitmapAt, loadImg } from './load';
import { renderPdfPage } from './pdf';
import { textCanvas } from '../text/raster';
import { figureCanvas } from '../figures';
import type { Geo } from '../types';

type HiMap = Map<HTMLCanvasElement, HTMLCanvasElement>;

/** jsPDF se descarga solo al exportar. */
let lib: Promise<typeof import('jspdf')> | null = null;
const jspdf = () => (lib ??= import('jspdf'));

/* ---------- estado de la interfaz ---------- */
const setStatus = (t: string) => { if (t) toast(t, 5000); };
/** Progreso en el aviso de abajo: se ve esté donde esté el usuario. */
const progress = (t: string) => { toast(t, 0); };
function setBusy(b: boolean) {
  document.body.classList.toggle('exporting', b); // mientras dura, la lista no vuelve a activar los botones
  for (const s of ['#quickExport', '#exportMore', '#exportTiles', '#printTiles', '#exportSingle', '#marginTest']) $<HTMLButtonElement>(s).disabled = b;
  // al terminar, las salidas del póster solo se activan si hay algo que imprimir (la flecha y la hoja de prueba, siempre)
  if (!b) { syncExportButtons(); $<HTMLButtonElement>('#exportMore').disabled = false; $<HTMLButtonElement>('#marginTest').disabled = false; }
  $('#qeLabel').textContent = b ? 'Generando…' : 'Descargar PDF';
}
function canExport() {
  if (!st.layers.length) { setStatus('El póster está vacío. Agrega al menos una imagen.'); return false; }
  if (st.layers.every((l) => l.hidden)) { setStatus('Todas las imágenes están ocultas. Muestra al menos una para exportar.'); return false; }
  return true;
}

/* ---------- render ---------- */
function renderRegion(x0: number, y0: number, wmm: number, hmm: number, dpi: number, hi?: HiMap) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((wmm / 25.4) * dpi));
  c.height = Math.max(1, Math.round((hmm / 25.4) * dpi));
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  const sx = c.width / wmm, sy = c.height / hmm;
  x.setTransform(sx, 0, 0, sy, -x0 * sx, -y0 * sy);
  drawAll(x, (l) => hi?.get(l.img) ?? l.img);
  return c;
}
/* ---------- «Omitir hojas en blanco»: qué hojas hacen falta ---------- */
/** Hay tinta (algo que no es blanco puro) en el rectángulo [x0, x1) × [y0, y1) del lienzo, en px. Lee por bandas. */
function inkIn(ctx: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) {
  const w = x1 - x0;
  if (w <= 0 || y1 <= y0) return false;
  for (let y = y0; y < y1; y += 128) {
    const { data } = ctx.getImageData(x0, y, w, Math.min(128, y1 - y));
    const pixels = new Uint32Array(data.buffer, data.byteOffset, data.length / 4);
    for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 0xffffffff) return true;
  }
  return false;
}
type InkCell = SheetCell & { ink: boolean };
/**
 * Marca las zonas de la hoja (ver sheetCells) en las que hay tinta, examinando el papel antes del JPEG y de las
 * anotaciones. Cada píxel cuenta para la zona en la que cae su centro. Devuelve si la hoja tiene tinta.
 */
function markInk(canvas: HTMLCanvasElement, t: { x: number; y: number; w: number; h: number }, cells: InkCell[]) {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!, sx = canvas.width / t.w, sy = canvas.height / t.h;
  const px = (v: number, s: number, max: number) => Math.min(max, Math.max(0, Math.round(v * s)));
  let any = false;
  for (const c of cells) {
    if (c.x1 <= t.x || c.x0 >= t.x + t.w || c.y1 <= t.y || c.y0 >= t.y + t.h) continue;
    const ink = inkIn(ctx, px(c.x0 - t.x, sx, canvas.width), px(c.y0 - t.y, sy, canvas.height),
      px(c.x1 - t.x, sx, canvas.width), px(c.y1 - t.y, sy, canvas.height));
    if (ink) { c.ink = true; any = true; }
  }
  return any;
}
/** Algo visible toca esta zona del póster. Si nada la toca, está en blanco y no hace falta dibujarla para saberlo. */
const touched = (t: { x: number; y: number; w: number; h: number }) => st.layers.some((l) => {
  if (l.hidden || l === st.editingText) return false;
  const b = bboxMM(l);
  return b.x1 > t.x + 1e-6 && b.x0 < t.x + t.w - 1e-6 && b.y1 > t.y + 1e-6 && b.y0 < t.y + t.h - 1e-6;
});

/**
 * Resultado de la última comprobación, con lo que la decide: las hojas, la resolución y cada capa (posición, recorte,
 * opacidad, lienzo y su contenido). Mientras no cambie nada, abrir la tarjeta del PDF o descargar no vuelve a dibujar
 * todas las hojas a la resolución final (con 3 × 3 hojas a 300 ppp eran casi 2 s cada vez).
 */
let plan: { key: string; sheets: number[] } | null = null;
const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object | null) => { if (!o) return 0; let i = ids.get(o); if (!i) { i = nextId++; ids.set(o, i); } return i; };
function printKey() {
  return JSON.stringify([posterGeo(), S.dpi, idOf(st.editingText), st.layers.map((l) => [
    idOf(l), l.hidden, l.cx, l.cy, l.w, l.h, l.rot, l.flipX, l.flipY, l.crop, l.opacity, idOf(l.img), canvasRevision(l.img), idOf(l.orig), idOf(l.src),
  ])]);
}
/**
 * Hojas que se imprimirán con «Omitir hojas en blanco» (números del mosaico), o null si se canceló (current() dejó de
 * valer). Solo se dibujan las hojas que toca alguna capa; en cada una se mira qué zonas tienen tinta y chooseSheets
 * decide (lo de una franja de solape basta con imprimirlo una vez). onTile recibe cada hoja con tinta ya dibujada,
 * para que la descarga la aproveche sin dibujarla otra vez.
 */
async function findSheets(current: () => boolean, hi: HiMap, onTile?: (n: number, canvas: HTMLCanvasElement) => void, progressOf?: (n: number, N: number) => void) {
  const key = printKey();
  if (plan?.key === key) return plan.sheets;
  const g = posterGeo(), cells: InkCell[] = sheetCells(g).map((c) => ({ ...c, ink: false }));
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    if (!current()) return null;
    const n = sheetNo(r, c, g.cols), t = tileRegion(g, r, c);
    if (!touched(t)) continue;
    progressOf?.(n, g.cols * g.rows); await tick();
    const canvas = renderRegion(t.x, t.y, t.w, t.h, S.dpi, hi);
    const mine = cells.filter((cell) => cell.sheets.includes(n));
    if (markInk(canvas, t, mine) && onTile) onTile(n, canvas); else freeCanvas(canvas);
  }
  const sheets = chooseSheets(cells);
  plan = { key, sheets };
  return sheets;
}
/** Para el resumen de la tarjeta del PDF: qué hojas se imprimirán (null si se canceló). */
export async function sheetsToPrint(current: () => boolean): Promise<number[] | null> {
  if (plan?.key === printKey()) return plan.sheets;
  const hi = await hiSources(S.dpi);
  try { return await findSheets(current, hi); } finally { hi.forEach(freeCanvas); }
}
/** Codifica en JPEG y libera el lienzo enseguida (con tamaño 0 Safari devuelve la memoria sin esperar). */
const jpg = (c: HTMLCanvasElement) => { const d = c.toDataURL('image/jpeg', 0.92); freeCanvas(c); return d; };

/**
 * Lo que se retocó a mano en el lienzo de trabajo, como máscara (ver editMaskData): solo lo borrado, sin la
 * transparencia que la imagen ya tenía. Si los lienzos no coinciden (no debería pasar), se usa el editado tal cual.
 */
function editMask(img: HTMLCanvasElement, orig: HTMLCanvasElement): HTMLCanvasElement {
  const w = img.width, h = img.height;
  if (orig.width !== w || orig.height !== h) return img;
  const data = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const m = document.createElement('canvas');
  m.width = w; m.height = h;
  m.getContext('2d')!.putImageData(new ImageData(editMaskData(data(img), data(orig)), w, h), 0, 0);
  return m;
}

/**
 * Prepara, solo para exportar, una versión de cada imagen a la resolución que pide el PDF (sin pasar del
 * original ni de HI_AREA). Las ediciones de píxeles solo cambian la transparencia, así que se reaplican
 * escalando sobre la imagen grande la máscara de lo que se borró.
 */
async function hiSources(dpi: number): Promise<HiMap> {
  const need = new Map<HTMLCanvasElement, { l: (typeof st.layers)[number]; w: number }>();
  for (const l of st.layers) {
    if (!l.src || l.hidden) continue;
    const w = Math.max(l.w, l.h * l.img.width / l.img.height) * dpi / 25.4, cur = need.get(l.img);
    if (!cur || w > cur.w) need.set(l.img, { l, w });
  }
  const out: HiMap = new Map();
  for (const [img, { l, w }] of need) {
    try {
      const d = srcDims(l, HI_AREA), tw = Math.round(Math.min(d.w, w));
      if (tw <= img.width * 1.05) continue; // el lienzo de trabajo ya basta
      const th = Math.round((tw * img.height) / img.width);
      let base: CanvasImageSource, url: string | null = null;
      const src = l.src!;
      if (src.kind === 'text') base = textCanvas(src.spec, tw, th); // contornos: nítidos a cualquier tamaño
      else if (src.kind === 'shape') base = figureCanvas(src.spec, tw, th);
      else if (src.kind === 'pdf') base = await renderPdfPage(l.pdf!, l.page, Math.max(tw, th), Infinity, false);
      else {
        url = URL.createObjectURL(src.blob);
        const im = await loadImg(url);
        // decodificada y reducida fuera del hilo principal si se puede (ver bitmapAt)
        base = (src.kind === 'img' && await bitmapAt(src.blob, im, tw, Math.round((tw * im.naturalHeight) / im.naturalWidth))) || im;
      }
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      const x = c.getContext('2d')!;
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(base, 0, 0, tw, th);
      if (base instanceof HTMLCanvasElement) freeCanvas(base); // la página del PDF a alta resolución ya no hace falta
      else if (typeof ImageBitmap !== 'undefined' && base instanceof ImageBitmap) base.close();
      if (url) URL.revokeObjectURL(url);
      if (img !== l.orig) {
        const mask = editMask(img, l.orig);
        x.globalCompositeOperation = 'destination-in'; x.drawImage(mask, 0, 0, tw, th);
        if (mask !== img) freeCanvas(mask);
      }
      out.set(img, c);
    } catch (err) { console.warn('Sin alta resolución para', l.name, err); }
  }
  return out;
}

/* ---------- marcas, guía y nombres de hoja ---------- */
function cutMarks(pdf: JsPDF, g: Geo) {
  const L = markLen(g);
  if (L < 1.2) return;
  pdf.setDrawColor(40, 40, 40); pdf.setLineWidth(0.15); pdf.setLineDashPattern([], 0);
  for (const [x, y, sx, sy] of [[g.m, g.m, -1, -1], [g.m + g.tw, g.m, 1, -1], [g.m, g.m + g.th, -1, 1], [g.m + g.tw, g.m + g.th, 1, 1]] as const) {
    pdf.line(x + sx * 0.8, y, x + sx * (0.8 + L), y);
    pdf.line(x, y + sy * 0.8, x, y + sy * (0.8 + L));
  }
}

/** Nombre de una opción del navegador en una sola línea (espacios que no se parten al ajustar el texto). */
const nb = (t: string) => t.replace(/ /g, '\u00a0');
function guidePage(pdf: JsPDF, g: Geo, included: Set<number>) {
  const m = Math.max(12, g.m), aw = g.pw - 2 * m;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.setTextColor(20, 30, 40);
  pdf.text('Guía de armado', m, m + 5);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(80, 90, 100);
  pdf.text(`Póster de ${cmGap(g.W)} × ${cmGap(g.H)} cm · ${g.cols} × ${g.rows} hojas ${S.paper} · solape ${Math.round(g.ov)} mm`, m, m + 11);
  // si no hay marcas de corte (desactivadas o margen pequeño), se corta por el borde de la imagen impresa
  const by = hasCutMarks(g, S.marks) ? 'por las marcas de corte' : 'por el borde de la imagen impresa';
  const dashed = S.marks ? 'sobre la línea discontinua' : `a ${Math.round(g.ov)} mm del borde de la vecina`;
  const steps = g.ov > 0
    ? [
      `1. Imprime en papel ${S.paper}. En Escala deja «Predeterminado» o ${nb('«Ajustar al tamaño del papel»')}, no ${nb('«Ajustar al área de impresión»')}. La regla de abajo debe medir 10 cm.`,
      `2. En cada hoja, recorta el borde izquierdo y el superior ${by}`,
      '    (excepto las de la primera columna y la primera fila, que se quedan con su margen o lo recortas al final).',
      `3. Pon cada hoja encima de su vecina, con el borde recortado ${dashed}, y pega.`,
      '4. Arma fila por fila, en orden: 1, 2, 3... (cada hoja lleva su número en el borde y en el mapa), y luego une las filas entre sí.',
    ]
    : [
      `1. Imprime en papel ${S.paper}. En Escala deja «Predeterminado» o ${nb('«Ajustar al tamaño del papel»')}, no ${nb('«Ajustar al área de impresión»')}. La regla de abajo debe medir 10 cm.`,
      `2. Recorta los cuatro bordes de cada hoja ${by}.`,
      '3. Une las hojas borde con borde y pégalas con cinta por detrás, siguiendo los números del mapa.',
    ];
  if (included.size < g.rows * g.cols) steps.push('Las posiciones con un guion se dejaron en blanco. Respeta su espacio al montar.');
  if (S.posterSize) steps.push(`Recorta el contorno final a ${cmGap(g.W)} × ${cmGap(g.H)} cm.`);
  // pasos en líneas que caben en el ancho (las que siguen a la primera de un paso, sangradas)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5);
  const lines = steps.flatMap((t) => (pdf.splitTextToSize(t, aw - 5) as string[]).map((ln, i) => (i ? '    ' + ln : ln)));
  const stepsH = lines.length * 5 + 6 + RULER_H, top = m + 18, ah = g.ph - top - m - stepsH;
  const s = Math.min(aw / g.W, ah / g.H), w = g.W * s, h = g.H * s, x = (g.pw - w) / 2, y = top;
  const previewDpi = Math.min(150, (1500 * 25.4) / Math.max(g.W, g.H));
  pdf.addImage(jpg(renderRegion(0, 0, g.W, g.H, previewDpi)), 'JPEG', x, y, w, h);
  pdf.setDrawColor(194, 26, 90); pdf.setLineWidth(0.35); pdf.rect(x, y, w, h);
  pdf.setLineDashPattern([1.2, 1], 0);
  for (let c = 1; c < g.cols; c++) for (const xx of [c * (g.tw - g.ov), c * (g.tw - g.ov) + g.ov]) pdf.line(x + xx * s, y, x + xx * s, y + h);
  for (let r = 1; r < g.rows; r++) for (const yy of [r * (g.th - g.ov), r * (g.th - g.ov) + g.ov]) pdf.line(x, y + yy * s, x + w, y + yy * s);
  pdf.setLineDashPattern([], 0); pdf.setFontSize(9); pdf.setFont('helvetica', 'bold');
  for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
    const t = tileRegion(g, r, c), number = sheetNo(r, c, g.cols);
    const cx = x + (t.x + t.w / 2) * s, cy = y + (t.y + t.h / 2) * s;
    pdf.setFillColor(255, 255, 255); pdf.roundedRect(cx - 5, cy - 3, 10, 6, 1.5, 1.5, 'F'); pdf.setTextColor(194, 26, 90);
    pdf.text(included.has(number) ? String(number) : '–', cx, cy, { align: 'center', baseline: 'middle' });
  }
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(40, 50, 60);
  lines.forEach((t, i) => pdf.text(t, m, y + h + 9 + i * 5));
  ruler(pdf, m, y + h + 9 + lines.length * 5 + 6, true);
}

/* ---------- calibración ---------- */
/** Espacio que se reserva en la guía para la regla con su texto (mm), para que no invada el margen inferior. */
const RULER_H = 21;
/**
 * Regla de 10 cm con marcas cada milímetro. Si al imprimir no mide 10 cm, la impresora reescaló la página
 * (el fallo más común al imprimir pósters por hojas: las hojas ya no encajan). y es la línea de la regla.
 */
function ruler(pdf: JsPDF, x: number, y: number, withText: boolean) {
  pdf.setDrawColor(25, 25, 25); pdf.setLineWidth(0.2); pdf.setLineDashPattern([], 0);
  pdf.line(x, y, x + 100, y);
  for (let i = 0; i <= 100; i++) pdf.line(x + i, y, x + i, y + (i % 10 === 0 ? 3 : i % 5 === 0 ? 2 : 1.2));
  pdf.setFont('helvetica', 'normal'); pdf.setTextColor(25, 25, 25); pdf.setFontSize(6);
  for (let c = 0; c <= 10; c++) pdf.text(String(c), x + c * 10, y + 3.6, { align: 'center', baseline: 'top' });
  pdf.text('cm', x + 103, y + 3.6, { baseline: 'top' });
  if (withText) {
    pdf.setFontSize(7.5);
    pdf.text('Esta regla debe medir 10 cm. Si mide menos, revisa el papel y la escala.', x, y - 2.2);
  }
}
/**
 * Regla en la hoja 1, dentro de la franja de solape que tapará la hoja de abajo (se imprime seguro y no se
 * ve en el póster armado). Solo si la franja cabe; la guía de armado la lleva siempre.
 */
function sheetRuler(pdf: JsPDF, g: Geo) {
  if (g.rows < 2 || g.ov < 9 || g.tw < 180) return;
  const x = g.m + g.tw - 108, y = g.m + g.th - g.ov + 1;
  pdf.setFillColor(255, 255, 255); pdf.roundedRect(x - 2, y - 0.5, 110, 8, 1, 1, 'F');
  ruler(pdf, x, y + 1, false);
}

/**
 * Nombre de la hoja. Siempre que se pueda va dentro de la franja de solape que la hoja vecina tapará al pegar
 * (se imprime seguro y no se ve en el póster armado); si no hay franja, en el margen, pegado a la imagen.
 */
function sheetLabel(pdf: JsPDF, g: Geo, r: number, c: number, i: number, N: number, included: Set<number>) {
  const txt = `Hoja ${i} de ${N} · fila ${r + 1}, columna ${c + 1}`;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5);
  const tw = pdf.getTextWidth(txt) + 3, th = 3.6;
  if (g.ov >= th + 1 && r < g.rows - 1 && included.has(i + g.cols)) {
    const x = g.m + 3, y = g.m + g.th - g.ov / 2;
    pdf.setFillColor(255, 255, 255); pdf.roundedRect(x, y - th / 2, tw, th, 1, 1, 'F'); pdf.setTextColor(90, 90, 90);
    pdf.text(txt, x + 1.5, y, { baseline: 'middle' });
  } else if (g.ov >= th + 1 && c < g.cols - 1 && included.has(i + 1)) {
    const x = g.m + g.tw - g.ov / 2, y = g.m + g.th - 3;
    pdf.setFillColor(255, 255, 255); pdf.roundedRect(x - th / 2, y - tw, th, tw, 1, 1, 'F'); pdf.setTextColor(90, 90, 90);
    pdf.text(txt, x, y - 1.5, { baseline: 'middle', angle: 90 });
  } else if (g.m >= 5.5) {
    pdf.setTextColor(110, 110, 110);
    pdf.text(txt, g.m + 6, g.ph - g.m + 0.8, { baseline: 'top' });
  }
}

/* ---------- descarga ---------- */
function saveFile(blob: Blob, filename: string, note = '', poster = true) {
  try {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    if (poster) markExported();
    setStatus('PDF descargado: ' + filename + note);
  } catch (err) {
    console.error(err);
    setStatus('El navegador bloqueó la descarga. Revisa los permisos de descarga.');
  }
}

/**
 * Imprimir sin descargar: el mismo PDF por hojas, abierto en un marco oculto con el visor de PDF del navegador y su
 * cuadro de impresión. Si el navegador no deja imprimir el marco (algunos móviles), el PDF se abre en otra pestaña,
 * desde donde se imprime o se comparte.
 */
function printFile(blob: Blob) {
  const url = URL.createObjectURL(blob), frame = document.createElement('iframe');
  frame.className = 'print-frame';
  frame.title = 'PDF para imprimir';
  frame.src = url;
  const fallback = () => { window.open(url, '_blank', 'noopener'); };
  frame.addEventListener('load', () => {
    // el visor de PDF termina de cargar un poco después del evento load
    setTimeout(() => {
      try { frame.contentWindow!.focus(); frame.contentWindow!.print(); } catch { fallback(); }
    }, 400);
  }, { once: true });
  document.body.appendChild(frame);
  // el marco se queda mientras dura el cuadro de impresión; se limpia más tarde
  setTimeout(() => { frame.remove(); URL.revokeObjectURL(url); }, 10 * 60_000);
  markExported();
  setStatus('Se abrió el cuadro de impresión. Elige el papel del póster y escala 100 % (tamaño real).');
}

export const exportTiles = () => buildTiles('download');
export const printTiles = () => buildTiles('print');

async function buildTiles(to: 'download' | 'print') {
  if (!canExport()) return;
  setBusy(true);
  let hi: HiMap | undefined;
  try {
    const g = posterGeo(), N = g.cols * g.rows, o = g.pw > g.ph ? 'landscape' : 'portrait';
    progress('Preparando el generador de PDF…');
    const { jsPDF } = await jspdf();
    const pdf = new jsPDF({ unit: 'mm', format: [g.pw, g.ph], orientation: o, compress: true });
    progress('Preparando imágenes en alta resolución…'); await tick();
    hi = await hiSources(S.dpi);
    // con «Omitir hojas en blanco», primero qué hojas hacen falta (las que ya se dibujaron para saberlo se aprovechan)
    const ready = new Map<number, string>();
    let wanted: number[] | null = null;
    if (S.skipBlank) {
      wanted = await findSheets(() => true, hi, (n, canvas) => { ready.set(n, jpg(canvas)); },
        (n) => progress(`Buscando hojas en blanco… ${n} de ${N}`));
    }
    const included = new Set<number>();
    for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
      const number = sheetNo(r, c, g.cols), t = tileRegion(g, r, c);
      if (wanted && !wanted.includes(number)) continue;
      let image = ready.get(number);
      if (!image) {
        progress(`Preparando hoja ${number} de ${N}…`); await tick();
        image = jpg(renderRegion(t.x, t.y, t.w, t.h, S.dpi, hi));
      }
      ready.delete(number);
      if (included.size) pdf.addPage([g.pw, g.ph], o);
      included.add(number);
      pdf.addImage(image, 'JPEG', g.m, g.m, t.w, t.h, undefined, 'FAST');
    }
    ready.clear();
    if (!included.size) { setStatus('Todas las hojas están en blanco. Desactiva «Omitir hojas en blanco» para incluirlas.'); return; }
    let page = 0;
    for (const i of included) {
      pdf.setPage(++page);
      const r = Math.floor((i - 1) / g.cols), c = (i - 1) % g.cols;
      const { w, h } = tileRegion(g, r, c);
      const tile = { ...g, tw: w, th: h };
      if (S.marks) {
        cutMarks(pdf, tile);
        pdf.setDrawColor(90); pdf.setLineWidth(0.12);
        if (w < g.tw - 0.001) pdf.line(g.m + w, g.m, g.m + w, g.m + h);
        if (h < g.th - 0.001) pdf.line(g.m, g.m + h, g.m + w, g.m + h);
        pdf.setDrawColor(194, 26, 90); pdf.setLineWidth(0.25); pdf.setLineDashPattern([2, 1.5], 0);
        if (g.ov > 0 && c < g.cols - 1 && included.has(i + 1)) pdf.line(g.m + w - g.ov, g.m, g.m + w - g.ov, g.m + h);
        if (g.ov > 0 && r < g.rows - 1 && included.has(i + g.cols)) pdf.line(g.m, g.m + h - g.ov, g.m + w, g.m + h - g.ov);
        pdf.setLineDashPattern([], 0);
      }
      sheetLabel(pdf, tile, r, c, i, N, included);
      if (i === 1 && included.has(i + g.cols)) sheetRuler(pdf, tile);
    }
    if (S.guide) {
      pdf.addPage([g.pw, g.ph], o);
      guidePage(pdf, g, included);
      pdf.movePage(included.size + 1, 1);
    }
    progress('Generando archivo…'); await tick();
    if (to === 'print') printFile(pdf.output('blob'));
    else saveFile(pdf.output('blob'), `${BRAND.name}-${g.cols}x${g.rows}-${S.paper}.pdf`);
  } catch (err) {
    console.error(err);
    setStatus('Algo falló al crear el PDF. Prueba con menos calidad.');
  } finally { hi?.forEach(freeCanvas); setBusy(false); }
}

export async function exportSingle() {
  if (!canExport()) return;
  setBusy(true);
  let hi: HiMap | undefined;
  try {
    const g = posterGeo(), maxDpi = 25.4 * Math.sqrt(SINGLE_AREA / (g.W * g.H)), dpi = Math.min(S.dpi, maxDpi);
    progress('Preparando el generador de PDF…');
    const { jsPDF } = await jspdf();
    progress('Preparando póster completo…'); await tick();
    hi = await hiSources(dpi);
    const pdf = new jsPDF({ unit: 'mm', format: [g.W, g.H], orientation: g.W > g.H ? 'landscape' : 'portrait', compress: true });
    pdf.addImage(jpg(renderRegion(0, 0, g.W, g.H, dpi, hi)), 'JPEG', 0, 0, g.W, g.H, undefined, 'FAST');
    progress('Generando archivo…'); await tick();
    // si el tamaño del póster obligó a bajar la calidad, se avisa en vez de hacerlo en silencio
    const note = dpi < S.dpi - 0.5 ? ` · calidad limitada a ${Math.floor(dpi)} ppp por el tamaño del póster (la imprenta puede preferir el PDF por hojas)` : '';
    const nameSize = (mm: number) => S.posterSize ? Number((mm / 10).toFixed(2)) : Math.round(mm / 10);
    saveFile(pdf.output('blob'), `${BRAND.name}-${nameSize(g.W)}x${nameSize(g.H)}cm.pdf`, note);
  } catch (err) {
    console.error(err);
    setStatus('Algo falló al crear el PDF.');
  } finally { hi?.forEach(freeCanvas); setBusy(false); }
}

/**
 * Hoja de prueba de márgenes: en cada borde, una escalera de rayas a 1–15 mm del borde del papel.
 * El usuario la imprime, mira cuál es la primera raya que salió completa en cada borde y pone el mayor
 * de esos números como «Margen sin imprimir». Así el margen se ajusta a SU impresora, no a una media.
 */
export async function exportMarginTest() {
  setBusy(true);
  try {
    progress('Preparando la hoja de prueba…');
    const { jsPDF } = await jspdf();
    let [pw, ph] = PAPERS[S.paper];
    if (S.orient === 'landscape') [pw, ph] = [ph, pw];
    const pdf = new jsPDF({ unit: 'mm', format: [pw, ph], orientation: pw > ph ? 'landscape' : 'portrait', compress: true });
    const steps = [1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 15];
    const seg = 7, gap = 5, span = steps.length * (seg + gap) - gap, lab = 19;
    pdf.setDrawColor(20, 20, 20); pdf.setLineWidth(0.35); pdf.setLineDashPattern([], 0);
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(7); pdf.setTextColor(20, 20, 20);
    const x0 = (pw - span) / 2, y0 = (ph - span) / 2;
    steps.forEach((d, i) => {
      const x = x0 + i * (seg + gap), y = y0 + i * (seg + gap), n = String(d);
      pdf.line(x, d, x + seg, d); pdf.text(n, x + seg / 2, lab, { align: 'center', baseline: 'middle' });                 // arriba
      pdf.line(x, ph - d, x + seg, ph - d); pdf.text(n, x + seg / 2, ph - lab, { align: 'center', baseline: 'middle' }); // abajo
      pdf.line(d, y, d, y + seg); pdf.text(n, lab, y + seg / 2, { align: 'center', baseline: 'middle' });                 // izquierda
      pdf.line(pw - d, y, pw - d, y + seg); pdf.text(n, pw - lab, y + seg / 2, { align: 'center', baseline: 'middle' }); // derecha
    });
    // instrucciones y regla en el centro
    const cx = 30, w = pw - 60;
    let y = ph / 2 - 34;
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(16); pdf.text('Hoja de prueba de márgenes', pw / 2, y, { align: 'center' });
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(60, 60, 60);
    y += 6;
    pdf.text(`Papel ${S.paper} ${S.orient === 'portrait' ? 'vertical' : 'horizontal'} · los números indican milímetros desde el borde del papel`, pw / 2, y, { align: 'center' });
    pdf.setTextColor(20, 20, 20); pdf.setFontSize(9.5);
    y += 9;
    for (const t of [
      `1. Imprime esta hoja en papel ${S.paper}. En Escala deja «Predeterminado» o ${nb('«Ajustar al tamaño del papel»')}, no ${nb('«Ajustar al área de impresión»')}.`,
      '2. Mide la regla de abajo: debe medir exactamente 10 cm.',
      '3. En cada uno de los cuatro bordes, busca la primera raya que se imprimió completa y anota su número.',
      `4. En ${BRAND.name}, pon el número más alto de los cuatro como «Margen sin imprimir» (pestaña Hojas).`,
    ]) {
      const lines = pdf.splitTextToSize(t, w) as string[];
      pdf.text(lines, cx, y);
      y += lines.length * 4.6 + 1.4;
    }
    ruler(pdf, pw / 2 - 50, y + 8, true);
    progress('Generando archivo…'); await tick();
    saveFile(pdf.output('blob'), `${BRAND.name}-prueba-margenes-${S.paper}-${S.orient === 'portrait' ? 'vertical' : 'horizontal'}.pdf`, '', false);
  } catch (err) {
    console.error(err);
    setStatus('No se pudo crear la hoja de prueba.');
  } finally { setBusy(false); }
}
