/** Exportación a PDF: por hojas (con guía de armado, marcas y solapes) o en una sola hoja grande. */
import type { jsPDF as JsPDF } from 'jspdf';
import { $, tick, toast } from '../dom';
import { cm } from '../format';
import { hasCutMarks, markLen, rowName, srcDims } from '../geometry';
import { markExported } from '../history';
import { HI_AREA, SINGLE_AREA } from '../platform';
import { drawAll } from '../render';
import { posterGeo, S, st } from '../state';
import { loadImg } from './load';
import { renderPdfPage } from './pdf';
import type { Geo } from '../types';

type HiMap = Map<HTMLCanvasElement, HTMLCanvasElement>;

/** jsPDF se descarga solo al exportar. */
let lib: Promise<typeof import('jspdf')> | null = null;
const jspdf = () => (lib ??= import('jspdf'));

/* ---------- estado de la interfaz ---------- */
const setStatus = (t: string) => { $('#status').textContent = t; if (t) toast(t, 5000); };
/** Progreso visible aunque la pestaña Exportar esté cerrada. */
const progress = (t: string) => { $('#status').textContent = t; toast(t, 0); };
function setBusy(b: boolean) {
  for (const s of ['#exportTiles', '#exportSingle', '#quickExport']) $<HTMLButtonElement>(s).disabled = b;
  $('#qeLabel').textContent = b ? 'Generando…' : 'Descargar PDF';
}
function canExport() {
  if (!st.layers.length) { setStatus('El póster está vacío. Agrega al menos una imagen.'); return false; }
  return true;
}

/* ---------- render ---------- */
function renderRegion(x0: number, y0: number, wmm: number, hmm: number, dpi: number, hi?: HiMap) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((wmm / 25.4) * dpi));
  c.height = Math.max(1, Math.round((hmm / 25.4) * dpi));
  const x = c.getContext('2d')!;
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  const s = c.width / wmm;
  x.setTransform(s, 0, 0, s, -x0 * s, -y0 * s);
  drawAll(x, hi);
  return c;
}
const jpg = (c: HTMLCanvasElement) => c.toDataURL('image/jpeg', 0.92);

/**
 * Prepara, solo para exportar, una versión de cada imagen a la resolución que pide el PDF (sin pasar del
 * original ni de HI_AREA). Las ediciones de píxeles solo cambian la transparencia, así que se reaplican
 * escalando el canal alfa del lienzo de trabajo sobre la imagen grande.
 */
async function hiSources(dpi: number): Promise<HiMap> {
  const need = new Map<HTMLCanvasElement, { l: (typeof st.layers)[number]; w: number }>();
  for (const l of st.layers) {
    if (!l.src) continue;
    const w = (l.w / 25.4) * dpi, cur = need.get(l.img);
    if (!cur || w > cur.w) need.set(l.img, { l, w });
  }
  const out: HiMap = new Map();
  for (const [img, { l, w }] of need) {
    try {
      const d = srcDims(l, HI_AREA), tw = Math.round(Math.min(d.w, w));
      if (tw <= img.width * 1.05) continue; // el lienzo de trabajo ya basta
      const th = Math.round((tw * img.height) / img.width);
      let base: CanvasImageSource, url: string | null = null;
      if (l.src!.kind === 'pdf') base = await renderPdfPage(l.pdf!, l.page, Math.max(tw, th), Infinity);
      else { url = URL.createObjectURL(l.src!.blob); base = await loadImg(url); }
      const c = document.createElement('canvas');
      c.width = tw; c.height = th;
      const x = c.getContext('2d')!;
      x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
      x.drawImage(base, 0, 0, tw, th);
      if (url) URL.revokeObjectURL(url);
      if (img !== l.orig) { x.globalCompositeOperation = 'destination-in'; x.drawImage(img, 0, 0, tw, th); }
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

function guidePage(pdf: JsPDF, g: Geo) {
  const m = Math.max(12, g.m), aw = g.pw - 2 * m;
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(18); pdf.setTextColor(20, 30, 40);
  pdf.text('Guía de armado', m, m + 5);
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(80, 90, 100);
  pdf.text(`Póster de ${cm(g.W)} × ${cm(g.H)} cm · ${S.cols} × ${S.rows} hojas ${S.paper} · solape ${Math.round(g.ov)} mm`, m, m + 11);
  // si no hay marcas de corte (desactivadas o margen pequeño), se corta por el borde de la imagen impresa
  const by = hasCutMarks(g, S.marks) ? 'por las marcas de corte' : 'por el borde de la imagen impresa';
  const dashed = S.marks ? 'sobre la línea discontinua' : `a ${Math.round(g.ov)} mm del borde de la vecina`;
  const steps = g.ov > 0
    ? [
      '1. Imprime al 100 % (tamaño real). Desactiva "Ajustar a la página".',
      `2. En cada hoja, recorta el borde izquierdo y el superior ${by}`,
      '    (excepto la columna 1 y la fila A, que se quedan con su margen o lo recortas al final).',
      `3. Pon cada hoja encima de su vecina, con el borde recortado ${dashed}, y pega.`,
      '4. Arma fila por fila: A1, A2, A3... y luego une las filas entre sí.',
    ]
    : [
      '1. Imprime al 100 % (tamaño real). Desactiva "Ajustar a la página".',
      `2. Recorta los cuatro bordes de cada hoja ${by}.`,
      '3. Une las hojas borde con borde y pégalas con cinta por detrás, siguiendo las letras y números.',
    ];
  const stepsH = steps.length * 5 + 6, top = m + 18, ah = g.ph - top - m - stepsH;
  const s = Math.min(aw / g.W, ah / g.H), w = g.W * s, h = g.H * s, x = (g.pw - w) / 2, y = top;
  pdf.addImage(jpg(renderRegion(0, 0, g.W, g.H, Math.min(150, (1500 * 25.4) / g.W))), 'JPEG', x, y, w, h);
  pdf.setDrawColor(194, 26, 90); pdf.setLineWidth(0.35); pdf.rect(x, y, w, h);
  pdf.setLineDashPattern([1.2, 1], 0);
  for (let c = 1; c < S.cols; c++) for (const xx of [c * (g.tw - g.ov), c * (g.tw - g.ov) + g.ov]) pdf.line(x + xx * s, y, x + xx * s, y + h);
  for (let r = 1; r < S.rows; r++) for (const yy of [r * (g.th - g.ov), r * (g.th - g.ov) + g.ov]) pdf.line(x, y + yy * s, x + w, y + yy * s);
  pdf.setLineDashPattern([], 0); pdf.setFontSize(9); pdf.setFont('helvetica', 'bold');
  for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) {
    const cx = x + (c * (g.tw - g.ov) + g.tw / 2) * s, cy = y + (r * (g.th - g.ov) + g.th / 2) * s;
    pdf.setFillColor(255, 255, 255); pdf.roundedRect(cx - 5, cy - 3, 10, 6, 1.5, 1.5, 'F'); pdf.setTextColor(194, 26, 90);
    pdf.text(rowName(r) + (c + 1), cx, cy, { align: 'center', baseline: 'middle' });
  }
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9.5); pdf.setTextColor(40, 50, 60);
  steps.forEach((t, i) => pdf.text(t, m, y + h + 9 + i * 5));
}

/**
 * Nombre de la hoja. Siempre que se pueda va dentro de la franja de solape que la hoja vecina tapará al pegar
 * (se imprime seguro y no se ve en el póster armado); si no hay franja, en el margen, pegado a la imagen.
 */
function sheetLabel(pdf: JsPDF, g: Geo, r: number, c: number, i: number, N: number) {
  const txt = `${rowName(r)}${c + 1} · fila ${rowName(r)}, columna ${c + 1} · hoja ${i} de ${N}`;
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(6.5);
  const tw = pdf.getTextWidth(txt) + 3, th = 3.6;
  if (g.ov >= th + 1 && r < S.rows - 1) {
    const x = g.m + 3, y = g.m + g.th - g.ov / 2;
    pdf.setFillColor(255, 255, 255); pdf.roundedRect(x, y - th / 2, tw, th, 1, 1, 'F'); pdf.setTextColor(90, 90, 90);
    pdf.text(txt, x + 1.5, y, { baseline: 'middle' });
  } else if (g.ov >= th + 1 && c < S.cols - 1) {
    const x = g.m + g.tw - g.ov / 2, y = g.m + g.th - 3;
    pdf.setFillColor(255, 255, 255); pdf.roundedRect(x - th / 2, y - tw, th, tw, 1, 1, 'F'); pdf.setTextColor(90, 90, 90);
    pdf.text(txt, x, y - 1.5, { baseline: 'middle', angle: 90 });
  } else if (g.m >= 5.5) {
    pdf.setTextColor(110, 110, 110);
    pdf.text(txt, g.m + 6, g.ph - g.m + 0.8, { baseline: 'top' });
  }
}

/* ---------- descarga ---------- */
function saveFile(blob: Blob, filename: string, note = '') {
  try {
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = filename; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    markExported();
    setStatus('PDF descargado: ' + filename + note);
  } catch (err) {
    console.error(err);
    setStatus('El navegador bloqueó la descarga. Revisa los permisos de descarga.');
  }
}

export async function exportTiles() {
  if (!canExport()) return;
  setBusy(true);
  try {
    const g = posterGeo(), N = S.cols * S.rows, o = g.pw > g.ph ? 'landscape' : 'portrait';
    progress('Preparando el generador de PDF…');
    const { jsPDF } = await jspdf();
    const pdf = new jsPDF({ unit: 'mm', format: [g.pw, g.ph], orientation: o, compress: true });
    progress('Preparando imágenes en alta resolución…'); await tick();
    const hi = await hiSources(S.dpi);
    let first = true;
    if (S.guide) { guidePage(pdf, g); first = false; }
    let i = 0;
    for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) {
      i++; progress(`Preparando hoja ${i} de ${N}…`); await tick();
      if (!first) pdf.addPage([g.pw, g.ph], o);
      first = false;
      pdf.addImage(jpg(renderRegion(c * (g.tw - g.ov), r * (g.th - g.ov), g.tw, g.th, S.dpi, hi)), 'JPEG', g.m, g.m, g.tw, g.th, undefined, 'FAST');
      if (S.marks) {
        cutMarks(pdf, g);
        pdf.setDrawColor(194, 26, 90); pdf.setLineWidth(0.25); pdf.setLineDashPattern([2, 1.5], 0);
        if (g.ov > 0 && c < S.cols - 1) pdf.line(g.m + g.tw - g.ov, g.m, g.m + g.tw - g.ov, g.m + g.th);
        if (g.ov > 0 && r < S.rows - 1) pdf.line(g.m, g.m + g.th - g.ov, g.m + g.tw, g.m + g.th - g.ov);
        pdf.setLineDashPattern([], 0);
      }
      sheetLabel(pdf, g, r, c, i, N);
    }
    progress('Generando archivo…'); await tick();
    saveFile(pdf.output('blob'), `pliego-${S.cols}x${S.rows}-${S.paper}.pdf`);
  } catch (err) {
    console.error(err);
    setStatus('Algo falló al crear el PDF. Prueba con menos calidad.');
  } finally { setBusy(false); }
}

export async function exportSingle() {
  if (!canExport()) return;
  setBusy(true);
  try {
    const g = posterGeo(), maxDpi = 25.4 * Math.sqrt(SINGLE_AREA / (g.W * g.H)), dpi = Math.min(S.dpi, maxDpi);
    progress('Preparando el generador de PDF…');
    const { jsPDF } = await jspdf();
    progress('Preparando póster completo…'); await tick();
    const hi = await hiSources(dpi);
    const pdf = new jsPDF({ unit: 'mm', format: [g.W, g.H], orientation: g.W > g.H ? 'landscape' : 'portrait', compress: true });
    pdf.addImage(jpg(renderRegion(0, 0, g.W, g.H, dpi, hi)), 'JPEG', 0, 0, g.W, g.H, undefined, 'FAST');
    progress('Generando archivo…'); await tick();
    // si el tamaño del póster obligó a bajar la calidad, se avisa en vez de hacerlo en silencio
    const note = dpi < S.dpi - 0.5 ? ` · calidad limitada a ${Math.floor(dpi)} ppp por el tamaño del póster (la imprenta puede preferir el PDF por hojas)` : '';
    saveFile(pdf.output('blob'), `pliego-${Math.round(g.W / 10)}x${Math.round(g.H / 10)}cm.pdf`, note);
  } catch (err) {
    console.error(err);
    setStatus('Algo falló al crear el PDF.');
  } finally { setBusy(false); }
}
