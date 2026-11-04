/** Dibujo del lienzo: póster, imágenes, franjas de solape, nombres de hoja y tiradores. */
import { cm } from './format';
import {
  HANDLES, cropCenter, cropPtsMM, displaySide, handleLocal, localToMM, rad, rowName, visH, visW,
} from './geometry';
import { canvasRevision } from './io/persist';
import { C, posterGeo, S, st, V, view } from './state';
import { mm2s } from './view';
import { positionBar } from './ui/contextbar';
import { renderList } from './ui/panel';
import type { HandleId, Layer, Pt } from './types';

let cv: HTMLCanvasElement;
let ctx: CanvasRenderingContext2D;
let checker: CanvasPattern | null = null;
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
  for (const k of ['desk', 'accent', 'mark', 'fg', 'muted', 'panel', 'chk1', 'chk2', 'line']) C[k] = cs.getPropertyValue('--' + k).trim();
  const p = document.createElement('canvas');
  p.width = p.height = 16;
  const x = p.getContext('2d')!;
  x.fillStyle = C.chk1!; x.fillRect(0, 0, 16, 16);
  x.fillStyle = C.chk2!; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
  checker = ctx.createPattern(p, 'repeat');
  dirty();
  renderList();
}

/* ---------- dibujo de una imagen (lo usa también la exportación) ---------- */
export function drawLayer(c: CanvasRenderingContext2D, l: Layer, clipIt = true, img: CanvasImageSource = l.img) {
  const w = l.w, h = l.h, k = l.crop;
  c.save();
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
function sizeLabel(l: Layer, txt: string) {
  const pts = cropPts(l), maxY = Math.max(...pts.map((p) => p.y)), cx = pts.reduce((a, p) => a + p.x, 0) / 4;
  ctx.font = '500 11.5px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  const w = ctx.measureText(txt).width + 16, y = Math.min(maxY + 20, view.CH - 14);
  const x = Math.min(Math.max(cx, w / 2 + 4), view.CW - w / 2 - 4);
  ctx.fillStyle = 'rgba(22,32,42,.9)'; ctx.beginPath(); ctx.roundRect(x - w / 2, y - 10, w, 20, 10); ctx.fill();
  ctx.fillStyle = '#ffffff'; ctx.fillText(txt, x, y + 0.5);
}
const dims = (l: Layer) => `${cm(visW(l))} × ${cm(visH(l))} cm` + (Math.round(l.rot) ? ` · ${Math.round(l.rot)}°` : '');

export function render() {
  dirtyFlag = false;
  const g = posterGeo(), { dpr } = view, sel = st.sel;
  const editing = S.mode === 'erase' || S.mode === 'wand', cropping = S.mode === 'crop' && !!sel;

  // mesa de trabajo y papel
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = C.desk!; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const tl = mm2s({ x: 0, y: 0 }), pwS = g.W * V.k, phS = g.H * V.k;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.22)'; ctx.shadowBlur = 14; ctx.shadowOffsetY = 3;
  ctx.fillStyle = '#ffffff'; ctx.fillRect(tl.x, tl.y, pwS, phS); ctx.restore();
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

  // nombre de cada hoja (A1, A2…)
  if (g.tw * V.k > 44 && g.th * V.k > 30) {
    ctx.font = '500 11px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let r = 0; r < S.rows; r++) for (let c = 0; c < S.cols; c++) {
      const p = mm2s({ x: c * (g.tw - g.ov) + g.tw / 2, y: r * (g.th - g.ov) }), y = p.y + 16;
      ctx.fillStyle = 'rgba(255,255,255,.86)'; ctx.beginPath(); ctx.roundRect(p.x - 17, y - 9, 34, 18, 9); ctx.fill();
      ctx.fillStyle = C.mark!; ctx.fillText(rowName(r) + (c + 1), p.x, y + 0.5);
    }
  }

  // selección y tiradores
  if (S.mode === 'move') {
    if (st.hoverL && st.hoverL !== sel) {
      ctx.strokeStyle = C.accent!; ctx.globalAlpha = 0.55; ctx.lineWidth = 1; poly(cropPts(st.hoverL)); ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (sel?.hidden) {
      // oculta: solo un contorno discontinuo para saber dónde está
      ctx.strokeStyle = C.muted!; ctx.lineWidth = 1; ctx.setLineDash([4, 4]); poly(cropPts(sel)); ctx.stroke(); ctx.setLineDash([]);
    } else if (sel) {
      ctx.strokeStyle = C.accent!; ctx.lineWidth = 1.5; poly(cropPts(sel)); ctx.stroke();
      const hs = boxHandles(sel, true), rot = hs.pop()!;
      ctx.beginPath(); ctx.moveTo(rot.base!.x, rot.base!.y); ctx.lineTo(rot.x, rot.y); ctx.stroke();
      const small = visW(sel) * V.k < 60 || visH(sel) * V.k < 60;
      hs.forEach((h) => { if (!(small && h.id.length === 1)) handleDot(h, 9); });
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(rot.x, rot.y, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      sizeLabel(sel, dims(sel));
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

  // círculo del pincel
  if (st.hover && S.mode === 'erase') {
    const h = st.hover;
    ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.beginPath(); ctx.arc(h.x, h.y, S.brush, 0, Math.PI * 2); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#fff'; ctx.beginPath(); ctx.arc(h.x, h.y, S.brush, 0, Math.PI * 2); ctx.stroke();
  }
  positionBar();
}
