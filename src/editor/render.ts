/** Dibujo del lienzo: póster, imágenes, franjas de solape, guías y medidas, y tiradores. */
import { findGroup, groupOf } from './groups';
import { cm, cmGap, TOUCH_MM } from './format';
import { isGesturing } from './input/pointer';
import {
  canStretch, gridLevels, HANDLES, bboxMM, boxInside, cropCenter, cropPtsMM, displaySide, handleLocal, localToMM, pppOf, qualityOf, rad,
  unionBox, visH, visW, type Quality,
} from './geometry';
import { canvasRevision } from './io/persist';
import { C, posterGeo, S, sheetsVisible, st, V, view } from './state';
import { mm2s, posterFrame, rulerFrame, RULER_WIDTH } from './view';
import { positionBar } from './ui/contextbar';
import { positionTextEditor } from './text/editor';
import { isText } from './text/text';
import { renderList } from './ui/panel';
import { drawScaleRef, syncScaleRefButton } from './scaleref';
import { overlapShown, syncOverlapButton } from './overlap';
import { wandOverlay, wandSelection } from './wand';
import { HI_AREA, isTouch } from './platform';
import type { HandleId, Layer, Pt } from './types';

let cv: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
/** Rayado del margen sin imprimir (papel que no se imprime). */
let hatch: CanvasPattern | null = null;
let dirtyFlag = false;

export function initRender(canvas: HTMLCanvasElement) {
  cv = canvas;
  const c = canvas.getContext('2d');
  if (!c) throw new Error('El navegador no soporta canvas 2D');
  ctx = c;
}

export function dirty() {
  if (dirtyFlag) return;
  dirtyFlag = true;
  requestAnimationFrame(render);
}

/** Lee los colores del tema (cambian con el modo oscuro) y rehace el rayado del margen. */
export function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['desk', 'grid', 'accent', 'mark', 'fg', 'muted', 'panel', 'chk1', 'chk2', 'line']) C[k] = cs.getPropertyValue('--' + k).trim();
  const h = document.createElement('canvas');
  h.width = h.height = 8;
  const y = h.getContext('2d')!;
  y.strokeStyle = 'rgba(110,120,135,.22)'; y.lineWidth = 1;
  y.beginPath(); y.moveTo(-1, 9); y.lineTo(9, -1); y.stroke();
  hatch = ctx.createPattern(h, 'repeat');
  dirty();
  renderList();
}

/* ---------- rejilla del fondo ---------- */
/**
 * Rejilla fija al póster (se mueve y escala con la vista, como en Figma) y alineada con su esquina, así que las
 * líneas marcan cm reales. Cada línea se dibuja una sola vez, con la opacidad del nivel más grueso al que pertenece
 * (una línea de 10 cm no se repinta como línea de 1 cm), en píxeles exactos del dispositivo para que no se vea borrosa.
 */
function drawGrid() {
  if (!C.grid) return;
  const levels = gridLevels(V.k);
  if (!levels.length) return;
  const { dpr } = view, W = cv.width, H = cv.height;
  const a = { x: -V.ox / V.k, y: -V.oy / V.k };
  const lw = Math.max(1, Math.floor(dpr)), off = lw % 2 ? 0.5 : 0;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = C.grid; ctx.lineWidth = lw;
  levels.forEach(({ step, alpha }, j) => {
    const next = levels[j + 1];
    const ratio = next ? Math.round(next.step / step) : 0; // las múltiplos del nivel siguiente las pinta ese nivel
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const firstX = Math.ceil(a.x / step), firstY = Math.ceil(a.y / step);
    const cols = Math.ceil(view.CW / (step * V.k)), rows = Math.ceil(view.CH / (step * V.k));
    for (let n = 0; n <= cols; n++) {
      const i = firstX + n;
      if (ratio && i % ratio === 0) continue;
      const X = Math.round((i * step * V.k + V.ox) * dpr) + off;
      ctx.moveTo(X, 0); ctx.lineTo(X, H);
    }
    for (let n = 0; n <= rows; n++) {
      const i = firstY + n;
      if (ratio && i % ratio === 0) continue;
      const Y = Math.round((i * step * V.k + V.oy) * dpr) + off;
      ctx.moveTo(0, Y); ctx.lineTo(W, Y);
    }
    ctx.stroke();
  });
  ctx.restore();
}

/* ---------- dibujo de una imagen (lo usa también la exportación) ---------- */
export function drawLayer(c: CanvasRenderingContext2D, l: Layer, clipIt = true, img: CanvasImageSource = l.img) {
  const w = l.w, h = l.h, k = l.crop;
  c.save();
  if (l.opacity < 1) c.globalAlpha *= l.opacity;
  c.translate(l.cx, l.cy); c.rotate(rad(l.rot)); c.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
  if (clipIt) { c.beginPath(); c.rect((k.x0 - 0.5) * w, (k.y0 - 0.5) * h, (k.x1 - k.x0) * w, (k.y1 - k.y0) * h); c.clip(); }
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(img, -w / 2, -h / 2, w, h);
  c.restore();
}
/** pick: qué versión de cada imagen se dibuja (copia reducida en pantalla, alta resolución al exportar). */
export const drawAll = (c: CanvasRenderingContext2D, pick: (l: Layer) => CanvasImageSource = (l) => l.img) =>
  st.layers.forEach((l) => { if (!l.hidden && l !== st.editingText) drawLayer(c, l, true, pick(l)); });

/* ---------- copias reducidas para la pantalla ---------- */
/**
 * Dibujar en cada fotograma las imágenes a resolución de trabajo (hasta 2400 px) es caro: con varias fotos
 * grandes el navegador no puede tenerlas todas en la tarjeta gráfica y las vuelve a subir en cada fotograma
 * (en la prueba, 4 fotos: unos 39 ms por fotograma frente a 1,7 ms con copias reducidas).
 * Por eso la pantalla usa una copia a la resolución que realmente se ve, en pasos fijos para no rehacerla
 * con cada zoom. Se rehace al editar la imagen o al acercar más de lo que cubre. La exportación no la usa.
 */
interface DisplayCopy {
  c: HTMLCanvasElement; rev: number; side: number;
  /** Lado mayor pedido en el fotograma actual y en el anterior (los duplicados comparten copia y se ven a otro tamaño). */
  frame: number; want: number; wantPrev: number;
  /** Puesta al día a trozos por el borrador (ver patchDisplay). */
  patched?: boolean;
}
const copies = new WeakMap<HTMLCanvasElement, DisplayCopy>(); // por lienzo: los duplicados la comparten
/**
 * Las copias se hacen en memoria, como la imagen de trabajo de la que salen. Reducirla en la tarjeta gráfica obligaba
 * a subirla entera primero: unos 13 ms por imagen, todos en el primer fotograma tras cargar o recuperar el póster
 * (16 fotos de 2400 × 1600: 211 ms de hilo principal, frente a 65 así). Dibujarlas luego en cada fotograma cuesta lo
 * mismo que antes (medido moviendo la vista y con zoom: ~6 µs por imagen).
 */
const COPY_CTX: CanvasRenderingContext2DSettings = { willReadFrequently: true };
/** Fotograma actual (lo cuenta render): para saber qué tamaño pidieron todas las capas que comparten una copia. */
let frameNo = 0;
/**
 * Copias que se hacen como mucho en un fotograma. Al recuperar el póster se piden todas de golpe: con 16 fotos y un
 * procesador lento (×4 en las herramientas del navegador) eran 270 ms con la página congelada. Las que no caben se
 * hacen en los fotogramas siguientes (ver displaySource).
 */
const COPIES_PER_FRAME = 4;
let copiesThisFrame = 0, copiesLeft = false;
/** Lo que se dibuja de l en pantalla: su copia reducida, la imagen de trabajo, o null si su copia llega en otro fotograma. */
export function displaySource(l: Layer): CanvasImageSource | null {
  if (st.textColorPreview?.layer === l) return st.textColorPreview.canvas;
  const img = l.img, long = Math.max(img.width, img.height);
  // con el borrador la imagen cambia en cada movimiento: la copia no se rehace, se pone al día solo lo pintado
  // (patchDisplay). Dibujar la imagen de trabajo entera la subía a la tarjeta gráfica en cada fotograma (~30 ms)
  const side = displaySide(Math.max(l.w, l.h) * V.k * view.dpr, long);
  if (!side) return img;
  const rev = canvasRevision(img);
  let d = copies.get(img);
  if (d && d.frame !== frameNo) { d.wantPrev = d.want; d.want = 0; d.frame = frameNo; }
  if (d) d.want = Math.max(d.want, side);
  // Al alejar, una copia que quedó grande (tras acercar mucho) se reduce: reducir cada fotograma una de 1536 px a unos
  // cientos, con suavizado de calidad, bajaba a 12-15 fotogramas por segundo. Solo si sobra el doble también para lo
  // que pidió en el fotograma anterior cualquier duplicado que la comparte, para no rehacerla una y otra vez.
  const shrink = !!d && d.side >= 2 * Math.max(side, d.wantPrev);
  if (!d || d.rev !== rev || d.side < side || shrink) {
    // sin sitio en este fotograma: si solo cambió el tamaño se ve la copia que había (algo menos nítida un momento); si
    // aún no tiene ninguna, aparece unos fotogramas después. Si cambió el contenido se rehace ya: no se ve lo de antes
    if (copiesThisFrame >= COPIES_PER_FRAME && (!d || d.rev === rev)) { copiesLeft = true; return d?.c ?? null; }
    copiesThisFrame++;
    // el lado que pidió la más grande de las que la comparten en este fotograma
    const size = Math.max(side, d && d.rev === rev ? d.want : 0);
    const c = d?.c ?? document.createElement('canvas'), s = size / long;
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    const x = c.getContext('2d', COPY_CTX)!;
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    d = { c, rev, side: size, frame: frameNo, want: size, wantPrev: d?.wantPrev ?? 0 };
    copies.set(img, d);
  }
  return d.c;
}

/**
 * El borrador cambió solo un rectángulo de img (px de img, ya pintado): la copia reducida se pone al día solo ahí, si
 * estaba al día justo antes (prevRev); si no, se rehará entera al dibujarla. Los bordes del parche se calculan sin
 * los píxeles vecinos: al acabar el trazo, settleDisplay la rehace entera.
 */
export function patchDisplay(img: HTMLCanvasElement, r: { x0: number; y0: number; x1: number; y1: number }, prevRev: number) {
  const d = copies.get(img);
  if (!d || d.rev !== prevRev) return;
  const sx = d.c.width / img.width, sy = d.c.height / img.height;
  const X0 = Math.max(0, Math.floor(r.x0 * sx) - 1), Y0 = Math.max(0, Math.floor(r.y0 * sy) - 1);
  const X1 = Math.min(d.c.width, Math.ceil(r.x1 * sx) + 1), Y1 = Math.min(d.c.height, Math.ceil(r.y1 * sy) + 1);
  d.rev = canvasRevision(img);
  if (X1 <= X0 || Y1 <= Y0) return;
  // la imagen de trabajo vive en memoria (se leen sus píxeles a menudo): dibujarla, aunque sea un trozo, la sube
  // entera a la tarjeta gráfica. Se leen solo los píxeles del trozo y se pasan por un lienzo pequeño
  const ix0 = Math.max(0, Math.floor(X0 / sx)), iy0 = Math.max(0, Math.floor(Y0 / sy));
  const ix1 = Math.min(img.width, Math.ceil(X1 / sx)), iy1 = Math.min(img.height, Math.ceil(Y1 / sy));
  const iw = ix1 - ix0, ih = iy1 - iy0;
  if (iw <= 0 || ih <= 0) return;
  const data = img.getContext('2d', { willReadFrequently: true })!.getImageData(ix0, iy0, iw, ih);
  if (!patchScratch) patchScratch = document.createElement('canvas');
  if (patchScratch.width < iw) patchScratch.width = iw;
  if (patchScratch.height < ih) patchScratch.height = ih;
  patchScratch.getContext('2d')!.putImageData(data, 0, 0);
  const x = d.c.getContext('2d', COPY_CTX)!;
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
  x.clearRect(X0, Y0, X1 - X0, Y1 - Y0);
  x.drawImage(patchScratch, X0 / sx - ix0, Y0 / sy - iy0, (X1 - X0) / sx, (Y1 - Y0) / sy, X0, Y0, X1 - X0, Y1 - Y0);
  d.patched = true;
}
/** Lienzo pequeño para pasar los píxeles de un parche (crece según haga falta). */
let patchScratch: HTMLCanvasElement | null = null;
/** Acabó un trazo: si la copia se puso al día a trozos, se rehace entera (sin las juntas de los parches). */
export function settleDisplay(img: HTMLCanvasElement) {
  const d = copies.get(img);
  if (d?.patched) { d.rev = -1; dirty(); }
}
/**
 * Un retoque empieza sobre una copia de la imagen (ver beginPixelEdit): la copia nueva parte de la reducida de la
 * anterior (es igual), en vez de rehacerla desde la imagen de trabajo. La anterior queda intacta para deshacer.
 */
export function inheritDisplay(from: HTMLCanvasElement, to: HTMLCanvasElement) {
  const d = copies.get(from);
  if (!d || d.rev !== canvasRevision(from) || copies.has(to)) return;
  const c = document.createElement('canvas');
  c.width = d.c.width; c.height = d.c.height;
  c.getContext('2d', COPY_CTX)!.drawImage(d.c, 0, 0);
  copies.set(to, { ...d, c, rev: canvasRevision(to), patched: false });
}

/* ---------- tiradores ---------- */
const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
export interface Handle extends Pt { id: HandleId | 'rot'; base?: Pt }
export const cropPts = (l: Layer) => cropPtsMM(l).map(mm2s);
export function boxHandles(l: Layer, withRot: boolean): Handle[] {
  // un texto no se estira: las esquinas escalan sin deformar y los lados cambian su ancho (las líneas se parten)
  const ids = l.src?.kind === 'text' ? HANDLES.filter((id) => id !== 'n' && id !== 's') : HANDLES;
  const hs: Handle[] = ids.map((id) => ({ id, ...mm2s(localToMM(l, ...handleLocal(l, id))) }));
  if (withRot) {
    const tm = l.src?.kind === 'text' ? mid(hs[0]!, hs[1]!) : hs[1]!, c = mm2s(cropCenter(l));
    const dx = tm.x - c.x, dy = tm.y - c.y, d = Math.hypot(dx, dy) || 1;
    hs.push({ id: 'rot', x: tm.x + (dx / d) * 28, y: tm.y + (dy / d) * 28, base: tm });
  }
  return hs;
}
/* ---------- marco y tiradores del grupo ---------- */
const GROUP_CORNERS = ['nw', 'ne', 'se', 'sw'] as const;
/** Esquinas del marco del grupo en mm: la caja común o, mientras se gira, esa caja girada. */
export function groupFrameMM(): Pt[] {
  if (st.groupFrame) return st.groupFrame;
  const u = unionBox(st.group.map((l) => bboxMM(l)));
  return [{ x: u.x0, y: u.y0 }, { x: u.x1, y: u.y0 }, { x: u.x1, y: u.y1 }, { x: u.x0, y: u.y1 }];
}
/**
 * Lados del marco que se pueden arrastrar para estirar el conjunto en un eje: con el marco derecho (no mientras se
 * gira), si todas se pueden estirar (ver canStretch) y si el marco no es tan pequeño que se amontonen.
 */
export function groupSides(): boolean {
  if (st.groupFrame || !canStretch(st.group)) return false;
  const f = groupFrameMM();
  return (f[1]!.x - f[0]!.x) * V.k >= 60 && (f[3]!.y - f[0]!.y) * V.k >= 60;
}
const GROUP_SIDES = [['n', 0, 1], ['e', 1, 2], ['s', 2, 3], ['w', 3, 0]] as const;
/**
 * Tiradores del grupo: cuatro esquinas (escalar sin deformar), los lados (estirar en un eje, ver groupSides) y el de
 * girar, sobre el lado de arriba. El de girar va siempre el último.
 */
export function groupHandles(): Handle[] {
  const f = groupFrameMM().map(mm2s);
  const hs: Handle[] = f.map((p, i) => ({ id: GROUP_CORNERS[i]!, x: p.x, y: p.y }));
  if (groupSides()) for (const [id, a, b] of GROUP_SIDES) hs.push({ id, ...mid(f[a]!, f[b]!) });
  const tm = { x: (f[0]!.x + f[1]!.x) / 2, y: (f[0]!.y + f[1]!.y) / 2 }, c = { x: (f[0]!.x + f[2]!.x) / 2, y: (f[0]!.y + f[2]!.y) / 2 };
  const dx = tm.x - c.x, dy = tm.y - c.y, d = Math.hypot(dx, dy) || 1;
  hs.push({ id: 'rot', x: tm.x + (dx / d) * 28, y: tm.y + (dy / d) * 28, base: tm });
  return hs;
}
export const groupCorner = (id: Handle['id']) => GROUP_CORNERS.indexOf(id as (typeof GROUP_CORNERS)[number]);
export const groupCursor = (id: Handle['id']) => (id === 'rot' ? 'grab' : id === 'n' || id === 's' ? 'ns-resize'
  : id === 'e' || id === 'w' ? 'ew-resize' : id === 'nw' || id === 'se' ? 'nwse-resize' : 'nesw-resize');

export function nearest(hs: Handle[], p: Pt, r: number) {
  let best: Handle | null = null, bd = r;
  for (const h of hs) { const d = Math.hypot(h.x - p.x, h.y - p.y); if (d <= bd) { bd = d; best = h; } }
  return best;
}
export function handleCursor(l: Layer, id: Handle['id']) {
  if (id === 'rot') return 'grab';
  const p = mm2s(localToMM(l, ...handleLocal(l, id))), c = mm2s(cropCenter(l));
  const a = ((Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 360 + 22.5) % 180;
  return (['ew-resize', 'nwse-resize', 'ns-resize', 'nesw-resize'] as const)[Math.floor(a / 45) % 4]!;
}

function poly(pts: Pt[]) {
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
}
function handleDot(h: Handle, s: number) {
  const side = h.id.length === 1;
  ctx.fillStyle = '#ffffff'; ctx.strokeStyle = C.accent!; ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (side) ctx.roundRect(h.x - s / 2, h.y - s / 2, s, s, s / 2); else ctx.rect(h.x - s / 2, h.y - s / 2, s, s);
  ctx.fill(); ctx.stroke();
}
/** Colores del punto de calidad sobre la etiqueta oscura (siempre los claros, para que se vean sobre el fondo oscuro). */
const Q_DOT: Record<Quality, string> = { good: '#5cc489', warn: '#e3a33d', bad: '#ef6b5b' };
/** Etiqueta oscura bajo la selección. ppp: añade la calidad de impresión con un punto de color al final. */
function sizeLabel(l: Layer | Pt[], txt: string, ppp?: number) {
  const pts = Array.isArray(l) ? l : cropPts(l), maxY = Math.max(...pts.map((p) => p.y));
  const cx = Array.isArray(l) ? (Math.min(...pts.map((p) => p.x)) + Math.max(...pts.map((p) => p.x))) / 2 : pts.reduce((a, p) => a + p.x, 0) / 4;
  if (ppp !== undefined) txt += ` · ${ppp} ppp`;
  ctx.font = '500 11.5px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  // dentro de la zona libre (no debajo de las islas flotantes)
  const dot = ppp !== undefined ? 14 : 0;
  const { ins } = view, w = ctx.measureText(txt).width + 16 + dot, y = Math.min(maxY + 20, view.CH - ins.b - 14);
  const x = Math.min(Math.max(cx, ins.l + w / 2 + 4), view.CW - ins.r - w / 2 - 4);
  sizeRect = { x: x - w / 2, y: y - 10, w, h: 20 };
  ctx.fillStyle = 'rgba(22,32,42,.9)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 10, w, 20, 10); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillText(txt, x - dot / 2, y + 0.5);
  if (ppp !== undefined) {
    ctx.fillStyle = Q_DOT[qualityOf(ppp)]; ctx.beginPath(); ctx.arc(x + w / 2 - 13, y, 4, 0, Math.PI * 2); ctx.fill();
  }
}
const dims = (l: Layer) => `${cm(visW(l))} × ${cm(visH(l))} cm` + (Math.round(l.rot) ? ` · ${Math.round(l.rot)}°` : '');
/** Calidad de impresión (ppp al tamaño impreso, con el archivo original). */
const pppAt = (l: Layer) => pppOf(l, HI_AREA);

/* ---------- imanes y medidas ---------- */
/** Etiqueta de tamaño de la selección dibujada en este fotograma: las medidas no la tapan. */
let sizeRect: { x: number; y: number; w: number; h: number } | null = null;
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function drawHelpers() {
  const { guides, gaps, measure } = st;
  if (!guides && !gaps && !measure) return;
  ctx.save();
  ctx.strokeStyle = C.mark!; ctx.fillStyle = C.mark!; ctx.lineWidth = 1;
  // guías del imán: tramos entre lo alineado, con una × en cada punto que coincide
  for (const g of guides ?? []) {
    const P = (v: number) => (g.axis === 'x' ? mm2s({ x: g.at, y: v }) : mm2s({ x: v, y: g.at }));
    const a = P(g.from), b = P(g.to), o = 0.5;
    ctx.beginPath();
    if (g.axis === 'x') { const X = Math.round(a.x) + o; ctx.moveTo(X, a.y); ctx.lineTo(X, b.y); }
    else { const Y = Math.round(a.y) + o; ctx.moveTo(a.x, Y); ctx.lineTo(b.x, Y); }
    for (const v of g.marks) { const q = P(v), r = 3; ctx.moveTo(q.x - r, q.y - r); ctx.lineTo(q.x + r, q.y + r); ctx.moveTo(q.x + r, q.y - r); ctx.lineTo(q.x - r, q.y + r); }
    ctx.stroke();
  }
  // medir: contorno de aquello con lo que se mide y líneas discontinuas de proyección
  if (measure) {
    const a = mm2s({ x: measure.target.x0, y: measure.target.y0 }), b = mm2s({ x: measure.target.x1, y: measure.target.y1 });
    ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(b.x - a.x), Math.round(b.y - a.y));
    ctx.setLineDash([4, 3]); ctx.beginPath();
    for (const d of measure.dashes) { const p0 = mm2s({ x: d.x0, y: d.y0 }), p1 = mm2s({ x: d.x1, y: d.y1 }); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); }
    ctx.stroke(); ctx.setLineDash([]);
  }
  // distancias (separación igual al mover, o medir): línea con remates y la medida en cm
  const list = [...(gaps ?? []), ...(measure?.gaps ?? [])];
  if (list.length) {
    const touch = isTouch(), fs = touch ? 12.5 : 11, lh = touch ? 20 : 18;
    ctx.font = `600 ${fs}px "IBM Plex Mono", ui-monospace, monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const g of list) {
      const a = g.axis === 'x' ? mm2s({ x: g.from, y: g.at }) : mm2s({ x: g.at, y: g.from });
      const b = g.axis === 'x' ? mm2s({ x: g.to, y: g.at }) : mm2s({ x: g.at, y: g.to });
      const len = g.axis === 'x' ? b.x - a.x : b.y - a.y;
      if (len < 2 || g.to - g.from < TOUCH_MM) continue; // se tocan: no hay distancia que mostrar
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      if (g.axis === 'x') { ctx.moveTo(a.x, a.y - 4); ctx.lineTo(a.x, a.y + 4); ctx.moveTo(b.x, b.y - 4); ctx.lineTo(b.x, b.y + 4); }
      else { ctx.moveTo(a.x - 4, a.y); ctx.lineTo(a.x + 4, a.y); ctx.moveTo(b.x - 4, b.y); ctx.lineTo(b.x + 4, b.y); }
      ctx.stroke();
      const txt = cmGap(g.to - g.from), w = ctx.measureText(txt).width + 10;
      // si el hueco es más corto que la etiqueta, o la etiqueta taparía la de tamaño, va al lado de la línea (lo
      // bastante lejos para no pisar el tirador del lado, que está justo ahí)
      let mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      if (len < (g.axis === 'x' ? w : lh) + 8) { if (g.axis === 'x') my -= lh / 2 + 10; else mx += w / 2 + 12; }
      if (sizeRect && overlaps({ x: mx - w / 2, y: my - lh / 2, w, h: lh }, sizeRect)) {
        if (g.axis === 'x') my = sizeRect.y - lh / 2 - 4; else mx = sizeRect.x + sizeRect.w + w / 2 + 6;
      }
      ctx.beginPath(); ctx.roundRect(mx - w / 2, my - lh / 2, w, lh, 4); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.fillText(txt, mx, my + 0.5); ctx.fillStyle = C.mark!;
    }
  }
  ctx.restore();
}

/** Referencias de pantalla. El PDF usa drawAll y conserva sus coordenadas físicas. */
function drawReferences() {
  if (!sheetsVisible()) return;
  ctx.save();
  ctx.strokeStyle = C.accent!;
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  const frame = posterFrame(), right = frame.x + frame.w, bottom = frame.y + frame.h;
  const guides = st.showGuides ? st.layoutGuides : [];
  const draft = st.guideDraft;
  for (const g of draft ? [...guides.filter(line => line !== draft.original), draft] : guides) {
    if (g.axis === 'x') {
      const x = V.ox + g.at * V.k;
      if (x < frame.x || x > right) continue;
      ctx.moveTo(x, frame.y); ctx.lineTo(x, bottom);
    } else {
      const y = V.oy + g.at * V.k;
      if (y < frame.y || y > bottom) continue;
      ctx.moveTo(frame.x, y); ctx.lineTo(right, y);
    }
  }
  ctx.stroke();
  if (st.rulers) {
    const strip = RULER_WIDTH, outer = rulerFrame(), { l, t } = outer;
    const w = outer.right - l, h = outer.bottom - t;
    ctx.beginPath(); ctx.rect(l, t, w, h); ctx.clip();
    const min = 60 / V.k, power = 10 ** Math.floor(Math.log10(min));
    const major = ([1, 2, 5, 10].find((n) => n * power >= min) ?? 10) * power;
    const step = major / 5;
    ctx.setLineDash([]);
    ctx.fillStyle = C.panel!;
    ctx.fillRect(l, t, w, strip); ctx.fillRect(l, t, strip, h);
    ctx.fillStyle = C.muted!; ctx.strokeStyle = C.line!;
    ctx.font = '10px "IBM Plex Mono", monospace'; ctx.textBaseline = 'top'; ctx.textAlign = 'left';
    ctx.beginPath();
    for (const axis of ['x', 'y'] as const) {
      const start = Math.max(0, axis === 'x' ? frame.x : frame.y);
      const end = Math.min(axis === 'x' ? view.CW : view.CH, axis === 'x' ? right : bottom);
      const origin = axis === 'x' ? V.ox : V.oy;
      const first = Math.ceil((start - origin) / (step * V.k));
      const count = Math.max(0, Math.ceil((end - start) / (step * V.k)));
      for (let n = 0; n < count; n++) {
        const i = first + n, p = origin + i * step * V.k;
        if (p >= end) break;
        const labeled = i % 5 === 0, tick = labeled ? 7 : 3;
        if (axis === 'x') {
          ctx.moveTo(p, t + strip); ctx.lineTo(p, t + strip - tick);
          if (labeled) ctx.fillText(String(Number((i * step).toFixed(3))), p + 2, t + 2);
        } else {
          ctx.moveTo(l + strip, p); ctx.lineTo(l + strip - tick, p);
          if (labeled) {
            ctx.save(); ctx.translate(l + 2, p - 2); ctx.rotate(-Math.PI / 2);
            ctx.fillText(String(Number((i * step).toFixed(3))), 0, 0); ctx.restore();
          }
        }
      }
    }
    ctx.stroke();
    ctx.fillText('mm', l + 2, t + 3);
  }
  ctx.restore();
}

export function render() {
  frameNo++;
  dirtyFlag = false;
  copiesThisFrame = 0; copiesLeft = false;
  sizeRect = null;
  const g = posterGeo(), { dpr } = view, sel = st.sel;
  const editing = S.mode === 'erase' || S.mode === 'wand', cropping = S.mode === 'crop' && !!sel;

  // mesa de trabajo y papel
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = C.desk!; ctx.fillRect(0, 0, cv.width, cv.height);
  drawGrid();
  // la persona de referencia, detrás del papel y de las imágenes
  drawScaleRef(ctx);
  syncScaleRefButton();
  syncOverlapButton();
  // el papel y las hojas solo cuando el usuario ya hizo algo (cargar una imagen o elegir la distribución):
  // antes, un tamaño que nadie eligió sobra; solo se ven la mesa de puntos y la pantalla de inicio
  if (sheetsVisible()) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const tl = mm2s({ x: 0, y: 0 }), pwS = g.W * V.k, phS = g.H * V.k;
    // el papel: el póster impreso y, alrededor, el margen sin imprimir de las hojas de fuera (rayado). Entre hojas
    // no hay margen a la vista: al pegar, cada hoja tapa el de su vecina
    const mS = g.m * V.k, pt = { x: tl.x - mS, y: tl.y - mS };
    ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(pt.x, pt.y, pwS + 2 * mS, phS + 2 * mS); ctx.restore();
    if (mS > 0 && hatch) {
      ctx.fillStyle = hatch; ctx.fillRect(pt.x, pt.y, pwS + 2 * mS, phS + 2 * mS);
      ctx.fillStyle = '#ffffff'; ctx.fillRect(tl.x, tl.y, pwS, phS);
    }
    // borrando no se pinta un cuadriculado de transparencia: el blanco es el papel, y lo borrado deja ver lo que se
    // imprimirá (lo de debajo o el papel). Lo elegido con la varita se ve teñido (ver wand.ts)

    // imágenes: atenuadas fuera del póster, completas dentro
    ctx.setTransform(dpr * V.k, 0, 0, dpr * V.k, dpr * V.ox, dpr * V.oy);
    const page = { x0: 0, y0: 0, x1: g.W, y1: g.H };
    const x0 = -V.ox / V.k, y0 = -V.oy / V.k, x1 = x0 + view.CW / V.k, y1 = y0 + view.CH / V.k;
    const visible: { layer: Layer; source: CanvasImageSource }[] = [];
    for (const layer of st.layers) {
      if (layer.hidden || layer === st.editingText) continue;
      const box = bboxMM(layer), preview = cropping && layer === sel;
      if (!preview && (box.x1 < x0 || box.x0 > x1 || box.y1 < y0 || box.y0 > y1)) continue;
      const source = displaySource(layer);
      if (!source) continue; // su copia reducida llega en otro fotograma
      if (!editing && !boxInside(box, page)) {
        ctx.globalAlpha = 0.25; drawLayer(ctx, layer, true, source);
      }
      if (preview || (box.x1 >= 0 && box.x0 <= g.W && box.y1 >= 0 && box.y0 <= g.H)) visible.push({ layer, source });
    }
    if (!editing) {
      const src = cropping && displaySource(sel);
      if (src) { ctx.globalAlpha = 0.35; drawLayer(ctx, sel, false, src); }
      ctx.globalAlpha = 1;
    }
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, g.W, g.H); ctx.clip();
    if (!editing) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, g.W, g.H); }
    for (const { layer: l, source: src } of visible) {
      if (cropping && l === sel) { ctx.globalAlpha = 0.35; drawLayer(ctx, l, false, src); ctx.globalAlpha = 1; }
      drawLayer(ctx, l, true, src);
    }
    // lo elegido con la varita, teñido encima de su imagen
    const ws = wandSelection();
    if (ws) drawLayer(ctx, ws.layer, true, wandOverlay(ws));
    ctx.restore();

    // franjas de solape y líneas discontinuas (se pueden ocultar; al ajustar el margen o el solape, siempre)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (overlapShown()) {
      ctx.fillStyle = C.mark!; ctx.globalAlpha = 0.13;
      for (let c = 1; c < g.cols; c++) { const a = mm2s({ x: c * (g.tw - g.ov), y: 0 }); ctx.fillRect(a.x, a.y, g.ov * V.k, phS); }
      for (let r = 1; r < g.rows; r++) { const a = mm2s({ x: 0, y: r * (g.th - g.ov) }); ctx.fillRect(a.x, a.y, pwS, g.ov * V.k); }
      ctx.globalAlpha = 1; ctx.strokeStyle = C.mark!; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.beginPath();
      for (let c = 1; c < g.cols; c++) for (const x of [c * (g.tw - g.ov), c * (g.tw - g.ov) + g.ov]) {
        const X = Math.round(mm2s({ x, y: 0 }).x) + 0.5; ctx.moveTo(X, tl.y); ctx.lineTo(X, tl.y + phS);
      }
      for (let r = 1; r < g.rows; r++) for (const y of [r * (g.th - g.ov), r * (g.th - g.ov) + g.ov]) {
        const Y = Math.round(mm2s({ x: 0, y }).y) + 0.5; ctx.moveTo(tl.x, Y); ctx.lineTo(tl.x + pwS, Y);
      }
      ctx.stroke(); ctx.setLineDash([]);
    }

    // al ajustar el margen o el solape: el papel entero de cada hoja, para ver cómo encajan y cuánto se pierde.
    // En gris, no en rosa: el rosa es la franja de solape (lo que se imprime dos veces); esto es el borde del papel.
    // Si a este zoom queda a menos de 3 px de lo impreso (margen pequeño o vista alejada), no se dibuja: solo
    // haría un rayado de líneas pegadas a los bordes de la franja
    if (st.showPaper && g.m * V.k >= 3) {
      ctx.strokeStyle = C.muted!; ctx.lineWidth = 1; ctx.globalAlpha = 0.55; ctx.setLineDash([2, 3]);
      for (let r = 0; r < g.rows; r++) for (let c = 0; c < g.cols; c++) {
        const a = mm2s({ x: c * (g.tw - g.ov) - g.m, y: r * (g.th - g.ov) - g.m });
        ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(g.pw * V.k), Math.round(g.ph * V.k));
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // selección y tiradores
  drawReferences();
  if (S.mode === 'move') {
    if (st.hoverL && st.hoverL !== sel && !st.group.includes(st.hoverL)) {
      ctx.strokeStyle = C.accent!; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; poly(cropPts(st.hoverL)); ctx.stroke(); ctx.globalAlpha = 1;
    }
    const busy = isGesturing(); // arrastrando, escalando, girando o con el recuadro de selección
    if (sel?.hidden || sel?.locked) {
      // oculta o bloqueada: solo un contorno discontinuo para saber dónde está (sin tiradores)
      ctx.strokeStyle = C.muted!; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); poly(cropPts(sel)); ctx.stroke(); ctx.setLineDash([]);
      if (sel.locked && !sel.hidden) sizeLabel(sel, 'Bloqueada · ' + dims(sel));
    } else if (sel) {
      ctx.strokeStyle = C.accent!; ctx.lineWidth = 1.5; poly(cropPts(sel)); ctx.stroke();
      // mientras se mueve, escala o gira, solo el contorno (como en Figma): los tiradores taparían guías y medidas
      if (!busy) {
        const hs = boxHandles(sel, true), rot = hs.pop()!;
        ctx.beginPath(); ctx.moveTo(rot.base!.x, rot.base!.y); ctx.lineTo(rot.x, rot.y); ctx.stroke();
        const small = visW(sel) * V.k < 60 || visH(sel) * V.k < 60;
        // en uno pequeño no caben los de los lados, salvo en un texto: son los de su ancho
        hs.forEach((h) => { if (!(small && h.id.length === 1) || isText(sel)) handleDot(h, 9); });
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(rot.x, rot.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      // un texto son contornos: se imprime nítido a cualquier tamaño, no tiene calidad que avisar
      sizeLabel(sel, dims(sel), sel.src?.kind === 'text' || sel.src?.kind === 'shape' ? undefined : pppAt(sel));
    } else if (st.group.length > 1) {
      // varias: el contorno de cada una, el marco común y sus tiradores (esquinas para escalar, círculo para girar)
      ctx.strokeStyle = C.accent!; ctx.lineWidth = 1.5;
      for (const l of st.group) { poly(cropPts(l)); ctx.stroke(); }
      const fr = groupFrameMM(), box = fr.map(mm2s);
      ctx.lineWidth = 1; ctx.setLineDash([5, 4]); poly(box); ctx.stroke(); ctx.setLineDash([]);
      if (!busy) {
        const hs = groupHandles(), rot = hs.pop()!;
        ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(rot.base!.x, rot.base!.y); ctx.lineTo(rot.x, rot.y); ctx.stroke();
        hs.forEach((h) => handleDot(h, 9));
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(rot.x, rot.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      const w = Math.hypot(fr[1]!.x - fr[0]!.x, fr[1]!.y - fr[0]!.y), h = Math.hypot(fr[3]!.x - fr[0]!.x, fr[3]!.y - fr[0]!.y);
      // con varias, la calidad de la peor (es la que se notará al imprimir)
      const gid = groupOf(st.layers, st.group, (l) => !l.hidden && !l.locked), gname = gid != null ? findGroup(st.layers, gid)?.name : null;
      sizeLabel(box, `${gname ? gname + ' · ' : ''}${st.group.length} imágenes · ${cm(w)} × ${cm(h)} cm`, Math.min(...st.group.map(pppAt)));
    }
    if (st.marquee) {
      const { a, b } = st.marquee, x = Math.min(a.x, b.x), y = Math.min(a.y, b.y), w = Math.abs(b.x - a.x), h = Math.abs(b.y - a.y);
      ctx.fillStyle = C.accent!; ctx.globalAlpha = 0.08; ctx.fillRect(x, y, w, h); ctx.globalAlpha = 1;
      ctx.strokeStyle = C.accent!; ctx.lineWidth = 1; ctx.strokeRect(Math.round(x) + 0.5, Math.round(y) + 0.5, Math.round(w), Math.round(h));
    }
  } else if (cropping) {
    const pts = cropPts(sel);
    const [p0, p1, p2, p3] = pts as [Pt, Pt, Pt, Pt];
    ctx.strokeStyle = 'rgba(255,255,255,.7)'; ctx.lineWidth = 1; ctx.beginPath();
    for (const t of [1 / 3, 2 / 3]) {
      ctx.moveTo(p0.x + (p1.x - p0.x) * t, p0.y + (p1.y - p0.y) * t); ctx.lineTo(p3.x + (p2.x - p3.x) * t, p3.y + (p2.y - p3.y) * t);
      ctx.moveTo(p0.x + (p3.x - p0.x) * t, p0.y + (p3.y - p0.y) * t); ctx.lineTo(p1.x + (p2.x - p1.x) * t, p1.y + (p2.y - p1.y) * t);
    }
    ctx.stroke(); ctx.strokeStyle = C.accent!; ctx.lineWidth = 2; poly(pts); ctx.stroke();
    boxHandles(sel, false).forEach((h) => handleDot(h, 11));
    sizeLabel(sel, `Recorte ${cm(visW(sel))} × ${cm(visH(sel))} cm`);
  } else if (sel) {
    ctx.strokeStyle = C.accent!; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); poly(cropPts(sel)); ctx.stroke(); ctx.setLineDash([]);
  }

  // guías del imán, separación igual y medir (ver measure.ts)
  drawHelpers();

  // círculo del pincel
  if (st.hover && S.mode === 'erase') {
    const h = st.hover;
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.arc(h.x, h.y, S.brush, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(h.x, h.y, S.brush, 0, Math.PI * 2); ctx.stroke();
  }
  drawBandTip();
  drawAdjustTip();
  positionBar();
  positionTextEditor();
  if (copiesLeft) dirty(); // quedan copias reducidas por hacer: en el siguiente fotograma
}

/**
 * Aviso al pasar por la franja del margen sin imprimir: lo último que se dibuja (encima de reglas, selección y medidas)
 * y con su propio estilo de texto, sin heredar el que dejó otro dibujo (la etiqueta de la selección lo centra). Si no
 * cabe debajo del puntero, va encima; nunca queda bajo el panel ni las islas.
 */
function drawBandTip() {
  if (!st.hoverBand || !st.hover || !sheetsVisible()) return;
  drawTip(`Margen · ${Math.round(posterGeo().m)} mm`, st.hover, 14);
}

/** Ajustando el pincel o la tolerancia (Alt + clic derecho y arrastrar): su valor, junto al punto (fuera del círculo). */
function drawAdjustTip() {
  const a = st.adjust;
  if (!a) return;
  if (a.what === 'brush') drawTip(`Pincel · ${S.brush} px`, a.at, S.brush + 10);
  else drawTip(`Tolerancia · ${S.tol}`, a.at, 14);
}

/** Etiqueta junto a un punto (px de pantalla), dx a su derecha y algo por debajo (o encima, si no cabe). */
function drawTip(t: string, at: Pt, dx: number) {
  ctx.save();
  ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
  ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.globalAlpha = 1; ctx.setLineDash([]);
  const w = ctx.measureText(t).width + 14, h = 22;
  // dentro de lo que se ve: sin meterse bajo el panel, la cabecera ni la isla de vista
  const { ins } = view, right = view.CW - ins.r - 6, bottom = view.CH - ins.b - 6;
  const x = Math.max(ins.l + 6, Math.min(at.x + dx, right - w));
  const below = at.y + 20, y = below + h <= bottom ? below : Math.max(ins.t + 6, at.y - 12 - h);
  ctx.fillStyle = C.panel!; ctx.beginPath(); ctx.roundRect(x, y, w, h, 6); ctx.fill();
  ctx.strokeStyle = C.line!; ctx.lineWidth = 1; ctx.stroke();
  ctx.fillStyle = C.fg!; ctx.fillText(t, x + 7, y + h / 2 + 0.5);
  ctx.restore();
}
