/** Dibujo del lienzo: póster, imágenes, franjas de solape, nombres de hoja y tiradores. */
import { findGroup, groupOf } from './groups';
import { cm, cmGap, TOUCH_MM } from './format';
import { isGesturing } from './input/pointer';
import {
  gridLevels, HANDLES, bboxMM, cropCenter, cropPtsMM, displaySide, handleLocal, localToMM, pppOf, qualityOf, rad, rowName,
  unionBox, visH, visW, type Quality,
} from './geometry';
import { canvasRevision } from './io/persist';
import { C, posterGeo, S, sheetsVisible, st, V, view } from './state';
import { mm2s } from './view';
import { positionBar } from './ui/contextbar';
import { renderList } from './ui/panel';
import { HI_AREA, isTouch } from './platform';
import type { HandleId, Layer, Pt } from './types';

let cv: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let checker: CanvasPattern | null = null;
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

/** Lee los colores del tema (cambian con el modo oscuro) y rehace el patrón de transparencia. */
export function readColors() {
  const cs = getComputedStyle(document.documentElement);
  for (const k of ['desk', 'grid', 'accent', 'mark', 'fg', 'muted', 'panel', 'chk1', 'chk2', 'line']) C[k] = cs.getPropertyValue('--' + k).trim();
  const p = document.createElement('canvas');
  p.width = p.height = 16;
  const x = p.getContext('2d')!;
  x.fillStyle = C.chk1!; x.fillRect(0, 0, 16, 16);
  x.fillStyle = C.chk2!; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
  checker = ctx.createPattern(p, 'repeat');
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
  const a = { x: -V.ox / V.k, y: -V.oy / V.k }, b = { x: (view.CW - V.ox) / V.k, y: (view.CH - V.oy) / V.k };
  const lw = Math.max(1, Math.floor(dpr)), off = lw % 2 ? 0.5 : 0;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.strokeStyle = C.grid; ctx.lineWidth = lw;
  levels.forEach(({ step, alpha }, j) => {
    const next = levels[j + 1];
    const ratio = next ? Math.round(next.step / step) : 0; // las múltiplos del nivel siguiente las pinta ese nivel
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    for (let i = Math.ceil(a.x / step), e = Math.floor(b.x / step); i <= e; i++) {
      if (ratio && i % ratio === 0) continue;
      const X = Math.round((i * step * V.k + V.ox) * dpr) + off;
      ctx.moveTo(X, 0); ctx.lineTo(X, H);
    }
    for (let i = Math.ceil(a.y / step), e = Math.floor(b.y / step); i <= e; i++) {
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
  st.layers.forEach((l) => { if (!l.hidden) drawLayer(c, l, true, pick(l)); });

/* ---------- copias reducidas para la pantalla ---------- */
/**
 * Dibujar en cada fotograma las imágenes a resolución de trabajo (hasta 2400 px) es caro: con varias fotos
 * grandes el navegador no puede tenerlas todas en la tarjeta gráfica y las vuelve a subir en cada fotograma
 * (en la prueba, 4 fotos: unos 39 ms por fotograma frente a 1,7 ms con copias reducidas).
 * Por eso la pantalla usa una copia a la resolución que realmente se ve, en pasos fijos para no rehacerla
 * con cada zoom. Se rehace al editar la imagen o al acercar más de lo que cubre. La exportación no la usa.
 */
interface DisplayCopy { c: HTMLCanvasElement; rev: number; side: number }
const copies = new WeakMap<HTMLCanvasElement, DisplayCopy>(); // por lienzo: los duplicados la comparten
export function displaySource(l: Layer): CanvasImageSource {
  const img = l.img, long = Math.max(img.width, img.height);
  // con el borrador la imagen cambia en cada movimiento: se dibuja directamente para no rehacer la copia cada vez
  if (S.mode === 'erase' && l === st.sel) return img;
  const side = displaySide(Math.max(l.w, l.h) * V.k * view.dpr, long);
  if (!side) return img;
  const rev = canvasRevision(img);
  let d = copies.get(img);
  if (!d || d.rev !== rev || d.side < side) {
    const c = d?.c ?? document.createElement('canvas'), s = side / long;
    c.width = Math.max(1, Math.round(img.width * s));
    c.height = Math.max(1, Math.round(img.height * s));
    const x = c.getContext('2d')!;
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(img, 0, 0, c.width, c.height);
    d = { c, rev, side };
    copies.set(img, d);
  }
  return d.c;
}

/* ---------- tiradores ---------- */
export interface Handle extends Pt { id: HandleId | 'rot'; base?: Pt }
export const cropPts = (l: Layer) => cropPtsMM(l).map(mm2s);
export function boxHandles(l: Layer, withRot: boolean): Handle[] {
  const hs: Handle[] = HANDLES.map((id) => ({ id, ...mm2s(localToMM(l, ...handleLocal(l, id))) }));
  if (withRot) {
    const tm = hs[1]!, c = mm2s(cropCenter(l));
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
/** Tiradores del grupo: cuatro esquinas (escalar sin deformar) y el de girar, sobre el lado de arriba. */
export function groupHandles(): Handle[] {
  const f = groupFrameMM().map(mm2s);
  const hs: Handle[] = f.map((p, i) => ({ id: GROUP_CORNERS[i]!, x: p.x, y: p.y }));
  const tm = { x: (f[0]!.x + f[1]!.x) / 2, y: (f[0]!.y + f[1]!.y) / 2 }, c = { x: (f[0]!.x + f[2]!.x) / 2, y: (f[0]!.y + f[2]!.y) / 2 };
  const dx = tm.x - c.x, dy = tm.y - c.y, d = Math.hypot(dx, dy) || 1;
  hs.push({ id: 'rot', x: tm.x + (dx / d) * 28, y: tm.y + (dy / d) * 28, base: tm });
  return hs;
}
export const groupCorner = (id: Handle['id']) => GROUP_CORNERS.indexOf(id as (typeof GROUP_CORNERS)[number]);
export const groupCursor = (id: Handle['id']) => (id === 'rot' ? 'grab' : id === 'nw' || id === 'se' ? 'nwse-resize' : 'nesw-resize');

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

export function render() {
  dirtyFlag = false;
  sizeRect = null;
  const g = posterGeo(), { dpr } = view, sel = st.sel;
  const editing = S.mode === 'erase' || S.mode === 'wand', cropping = S.mode === 'crop' && !!sel;

  // mesa de trabajo y papel
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = C.desk!; ctx.fillRect(0, 0, cv.width, cv.height);
  drawGrid();
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
    if (editing && checker) { ctx.save(); ctx.translate(tl.x, tl.y); ctx.fillStyle = checker; ctx.fillRect(0, 0, pwS, phS); ctx.restore(); }

    // imágenes: atenuadas fuera del póster, completas dentro
    ctx.setTransform(dpr * V.k, 0, 0, dpr * V.k, dpr * V.ox, dpr * V.oy);
    if (!editing) {
      ctx.globalAlpha = 0.25; drawAll(ctx, displaySource);
      if (cropping) { ctx.globalAlpha = 0.35; drawLayer(ctx, sel, false, displaySource(sel)); }
      ctx.globalAlpha = 1;
    }
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, g.W, g.H); ctx.clip();
    if (!editing) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, g.W, g.H); }
    for (const l of st.layers) {
      if (l.hidden) continue;
      const src = displaySource(l);
      if (cropping && l === sel) { ctx.globalAlpha = 0.35; drawLayer(ctx, l, false, src); ctx.globalAlpha = 1; }
      drawLayer(ctx, l, true, src);
    }
    ctx.restore();

    // franjas de solape y líneas discontinuas
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.mark!; ctx.globalAlpha = 0.13;
    for (let c = 1; c < S.cols; c++) { const a = mm2s({ x: c * (g.tw - g.ov), y: 0 }); ctx.fillRect(a.x, a.y, g.ov * V.k, phS); }
    for (let r = 1; r < S.rows; r++) { const a = mm2s({ x: 0, y: r * (g.th - g.ov) }); ctx.fillRect(a.x, a.y, pwS, g.ov * V.k); }
    ctx.globalAlpha = 1; ctx.strokeStyle = C.mark!; ctx.lineWidth = 1; ctx.setLineDash([5, 4]); ctx.beginPath();
    for (let c = 1; c < S.cols; c++) for (const x of [c * (g.tw - g.ov), c * (g.tw - g.ov) + g.ov]) {
      const X = Math.round(mm2s({ x, y: 0 }).x) + 0.5; ctx.moveTo(X, tl.y); ctx.lineTo(X, tl.y + phS);
    }
    for (let r = 1; r < S.rows; r++) for (const y of [r * (g.th - g.ov), r * (g.th - g.ov) + g.ov]) {
      const Y = Math.round(mm2s({ x: 0, y }).y) + 0.5; ctx.moveTo(tl.x, Y); ctx.lineTo(tl.x + pwS, Y);
    }
    ctx.stroke(); ctx.setLineDash([]);

    // al ajustar el margen o el solape: el papel entero de cada hoja, para ver cómo encajan y cuánto se pierde
    if (st.showPaper) {
      ctx.strokeStyle = C.mark!; ctx.lineWidth = 1; ctx.globalAlpha = 0.75; ctx.setLineDash([3, 3]);
      for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) {
        const a = mm2s({ x: c * (g.tw - g.ov) - g.m, y: r * (g.th - g.ov) - g.m });
        ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, Math.round(g.pw * V.k), Math.round(g.ph * V.k));
      }
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    // nombre de cada hoja (A1, A2…)
    if (g.tw * V.k > 44 && g.th * V.k > 30) {
      ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) {
        const p = mm2s({ x: c * (g.tw - g.ov) + g.tw / 2, y: r * (g.th - g.ov) }), y = p.y + 16;
        ctx.fillStyle = 'rgba(255,255,255,.86)'; ctx.beginPath(); ctx.roundRect(p.x - 17, y - 9, 34, 18, 9); ctx.fill();
        ctx.fillStyle = C.mark!; ctx.fillText(rowName(r) + (c + 1), p.x, y + 0.5);
      }
    }

    // tamaño del póster y hojas, encima de su esquina (como el nombre de un marco en Figma); si no cabe, solo el tamaño
    const n = S.cols * S.rows, size = `${cm(g.W)} × ${cm(g.H)} cm`;
    const full = `Póster ${size} · ${n} ${n === 1 ? 'hoja' : 'hojas'} ${S.paper}` + (g.m > 0 ? ` · margen ${Math.round(g.m)} mm` : '');
    ctx.font = '500 11.5px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    const paperW = pwS + 2 * mS, txt = ctx.measureText(full).width <= paperW ? full : size, ly = pt.y - 8;
    if (ly > view.ins.t + 12 && ctx.measureText(txt).width <= paperW + 40) { ctx.fillStyle = C.muted!; ctx.fillText(txt, pt.x, ly); }
    // sobre la franja: qué es
    if (st.hoverBand && st.hover) {
      const t = `Margen sin imprimir · ${Math.round(g.m)} mm · se recorta`;
      ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace';
      const w = ctx.measureText(t).width + 14, x = Math.min(st.hover.x + 14, view.CW - w - 6), yy = st.hover.y + 20;
      ctx.fillStyle = C.panel!; ctx.beginPath(); ctx.roundRect(x, yy, w, 22, 6); ctx.fill();
      ctx.strokeStyle = C.line!; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = C.fg!; ctx.textBaseline = 'middle'; ctx.fillText(t, x + 7, yy + 11.5);
    }
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // selección y tiradores
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
        hs.forEach((h) => { if (!(small && h.id.length === 1)) handleDot(h, 9); });
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(rot.x, rot.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      }
      sizeLabel(sel, dims(sel), pppAt(sel));
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
  positionBar();
}
