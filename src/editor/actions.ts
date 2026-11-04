/** Acciones del editor: selección, capas, modos de herramienta, recorte y edición de píxeles. */
import { MAX_SIDE } from './constants';
import { $, hideToast, toast } from './dom';
import {
  applyFit, conformCrop, cropCenter, keepCenter, mmToLocal, natRatio, rotateLayer, unstretch,
} from './geometry';
import { pushUndo, snap, takeSnap, restoreSnap, undo } from './history';
import { canvasRevision, markCanvasChanged, scheduleSave } from './io/persist';
import { runJob } from './pixeljobs';
import type { PixelJob, PixelResult } from './pixels';
import { MOD } from './platform';
import { dirty } from './render';
import { sampleCanvas } from './sample';
import { DEFAULT_EXPORT, DEFAULT_LAYOUT, posterGeo, S, st, V } from './state';
import { s2mm } from './view';
import { renderBar } from './ui/contextbar';
import { layoutChanged, layoutRestored, renderList, syncExportUI, syncSel } from './ui/panel';
import type { FitMode, Layer, LayerProps, Mode, Pt, Snapshot, Source } from './types';

/* ---------- lienzos ---------- */
export function cloneCanvas(src: HTMLCanvasElement) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d', { willReadFrequently: true })!.drawImage(src, 0, 0);
  return c;
}
/** Lienzo de trabajo (máx. MAX_SIDE). upscale: para SVG, que se puede rasterizar más grande que su tamaño nominal. */
export function makeCanvas(src: CanvasImageSource, sw: number, sh: number, upscale = false) {
  const sc = upscale ? MAX_SIDE / Math.max(sw, sh) : Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * sc)); c.height = Math.max(1, Math.round(sh * sc));
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/* ---------- capas ---------- */
export function newLayer(img: HTMLCanvasElement, name: string, extra: Partial<Layer> = {}): Layer {
  const g = posterGeo();
  return {
    id: st.nextId++, name, img, orig: img, cx: g.W / 2, cy: g.H / 2, w: g.W, h: (g.W * img.height) / img.width,
    rot: 0, flipX: false, flipY: false, crop: { x0: 0, y0: 0, x1: 1, y1: 1 },
    pdf: null, page: 1, pages: 1, isSample: false, src: null as Source | null, fit: null, hidden: false, ...extra,
  };
}
/** Coloca una imagen nueva ajustada al póster. Si va desplazada (varias a la vez), queda como colocada a mano. */
export function addLayer(l: Layer, { factor = 1, offset = 0 } = {}) {
  st.layers.push(l);
  const fit = { mode: 'contain' as const, scale: factor };
  applyFit(l, fit, posterGeo());
  if (offset) { l.cx += offset; l.cy += offset; l.fit = null; } else l.fit = fit;
  select(l);
}
export const cloneLayer = (l: Layer, extra: Partial<Layer> = {}): Layer =>
  ({ ...l, id: st.nextId++, crop: { ...l.crop }, isSample: false, fit: l.fit && { ...l.fit }, ...extra });
/** La imagen se movió o cambió de tamaño a mano: ya no se reajusta al cambiar la hoja. */
export const markManual = (l: Layer) => { l.fit = null; };

/**
 * Oculta o muestra una imagen: oculta no se dibuja, no se exporta y no se puede tocar en el lienzo.
 * Al ocultar la seleccionada se deselecciona, porque en el lienzo ya no habría nada que tocar.
 */
export function toggleHidden(l: Layer) {
  if (S.mode === 'crop') applyCrop();
  if (S.mode !== 'move') setMode('move');
  snap();
  l.hidden = !l.hidden;
  if (l.hidden && st.sel === l) select(null);
  afterChange();
  toast(l.hidden ? `“${l.name}” oculta: no se imprimirá` : `“${l.name}” visible de nuevo`);
}

export function select(l: Layer | null) {
  if (S.mode === 'crop' && l !== st.sel) applyCrop();
  st.sel = l;
  st.hoverL = null;
  if (!l && S.mode !== 'move') setMode('move');
  renderList(); syncSel(); renderBar(); dirty();
}
export function afterChange() { renderList(); syncSel(); dirty(); scheduleSave(); }

/** Imagen de ejemplo, para que el lienzo no arranque vacío (no se guarda). */
export function addSample() {
  addLayer(newLayer(sampleCanvas(), 'Vuela alto', { isSample: true }), { factor: 0.94 });
  select(null);
}
/**
 * Empieza un póster nuevo: quita las imágenes, vuelve a los ajustes iniciales y borra el trabajo guardado
 * (útil en un ordenador compartido). Se puede deshacer mientras la pestaña siga abierta.
 */
export function newPoster() {
  if (S.mode === 'crop') cancelCrop();
  if (S.mode !== 'move') setMode('move');
  snap();
  st.layers = [];
  st.sel = null;
  Object.assign(S, DEFAULT_LAYOUT, DEFAULT_EXPORT);
  syncExportUI();
  layoutChanged();
  addSample();
  scheduleSave(); // solo queda la imagen de ejemplo: el guardado borra lo almacenado
  toast('Póster nuevo. Se borró el trabajo guardado en este navegador.', 7000, { label: 'Deshacer', fn: undo });
}
export function afterHistory() {
  if (!st.sel && S.mode !== 'move') setMode('move');
  layoutRestored();
  syncExportUI();
  renderList(); syncSel(); renderBar(); dirty();
  scheduleSave();
}

export function removeLayer(l: Layer) {
  if (S.mode === 'crop') applyCrop();
  snap();
  st.layers = st.layers.filter((x) => x !== l);
  if (st.sel === l) select(null); else afterChange();
  toast(`“${l.name}” quitada · ${MOD}Z para deshacer`);
}
export function reorder(l: Layer, to: 'front' | 'back' | number) {
  const i = st.layers.indexOf(l);
  let j = to === 'front' ? st.layers.length - 1 : to === 'back' ? 0 : i + to;
  j = Math.min(Math.max(j, 0), st.layers.length - 1);
  if (i === j) return;
  snap();
  st.layers.splice(i, 1); st.layers.splice(j, 0, l);
  afterChange();
}
export function duplicateLayer(l: Layer) {
  snap();
  const d = cloneLayer(l, { name: l.name + ' (copia)', fit: null });
  d.cx += 10; d.cy += 10;
  st.layers.splice(st.layers.indexOf(l) + 1, 0, d);
  select(d);
}
export function copyLayer(l: Layer) { st.clip = { ...cloneLayer(l), pasteN: 0 }; toast('Imagen copiada'); }
export function pasteLayer() {
  const clip = st.clip;
  if (!clip) return false;
  snap();
  clip.pasteN = (clip.pasteN ?? 0) + 1;
  const d = cloneLayer(clip, { name: clip.name, fit: null });
  delete d.pasteN;
  d.cx += 10 * clip.pasteN; d.cy += 10 * clip.pasteN;
  st.layers.push(d);
  select(d);
  return true;
}
/** Envuelve una transformación de la imagen seleccionada con su paso de deshacer. */
export const tx = (fn: (l: Layer) => void) => () => {
  const l = st.sel;
  if (!l) return;
  snap(); fn(l); afterChange();
};
export const rotate90 = (dir: 1 | -1) => tx((l) => { rotateLayer(l, 90 * dir, cropCenter(l)); markManual(l); });
export const flip = (axis: 'x' | 'y') => tx((l) => keepCenter(l, (x) => { if (axis === 'x') x.flipX = !x.flipX; else x.flipY = !x.flipY; }));
export const fitSel = (mode: FitMode) => tx((l) => { l.fit = { mode, scale: 1 }; applyFit(l, l.fit, posterGeo()); });
export const centerSel = tx((l) => { const g = posterGeo(), c = cropCenter(l); l.cx += g.W / 2 - c.x; l.cy += g.H / 2 - c.y; });
export const unstretchSel = tx((l) => { unstretch(l); markManual(l); });

/* ---------- modos ---------- */
let cropSession: Snapshot | null = null;
const cursorFor = (m: Mode) => (m === 'wand' ? 'crosshair' : m === 'erase' ? 'none' : 'default');

export function setMode(m: Mode) {
  if (S.mode === 'crop' && m !== 'crop') applyCrop();
  if (m === 'crop') { enterCrop(); return; }
  if (m !== 'move' && !st.sel) { toast('Primero toca una imagen'); return; }
  if (m !== 'move' && st.sel?.hidden) { toast('La imagen está oculta. Muéstrala para editarla.'); return; }
  S.mode = m;
  $('#cv').style.cursor = cursorFor(m);
  st.hoverL = null;
  renderBar(); dirty();
}
export function enterCrop() {
  if (!st.sel || S.mode === 'crop') return;
  if (st.sel.hidden) { toast('La imagen está oculta. Muéstrala para recortarla.'); return; }
  S.cropRatio = null; S.cropRatioKey = 'null';
  cropSession = takeSnap();
  S.mode = 'crop';
  $('#cv').style.cursor = 'default';
  renderBar(); dirty();
}
export function applyCrop() {
  if (S.mode !== 'crop') return;
  const s = cropSession, sel = st.sel;
  cropSession = null; S.mode = 'move';
  const p = s && sel && s.props.find((q) => q.l === sel);
  // al encuadrar se mueve o amplía la imagen, no solo el recorte: se comparan las dos cosas
  const key = (o: Layer | LayerProps) => JSON.stringify([o.crop, o.cx, o.cy, o.w, o.h]);
  if (s && p && sel && key(p) !== key(sel)) { pushUndo(s); markManual(sel); }
  renderBar(); afterChange();
}
export function cancelCrop() {
  if (S.mode !== 'crop') return;
  if (cropSession) restoreSnap(cropSession);
  cropSession = null; S.mode = 'move';
  renderBar(); afterChange();
}
export function setCropRatio(key: string) {
  const sel = st.sel;
  if (!sel) return;
  S.cropRatioKey = key;
  S.cropRatio = key === 'null' ? null : key === 'orig' ? sel.w / sel.h : +key;
  conformCrop(sel, S.cropRatio);
  renderBar(); afterChange();
}

/* ---------- edición de píxeles ---------- */
const mmToPx = (l: Layer, m: Pt) => {
  const q = mmToLocal(l, m);
  return { x: q.u * l.img.width, y: q.v * l.img.height };
};
/** Guarda el paso de deshacer y trabaja sobre una copia del lienzo (el anterior queda en el historial). */
export function beginPixelEdit(l: Layer) { snap(); l.img = cloneCanvas(l.img); }

export function paint(l: Layer, a: Pt, b: Pt) {
  const r = S.brush / (V.k * Math.sqrt((l.w / l.img.width) * (l.h / l.img.height)));
  const pa = mmToPx(l, s2mm(a)), pb = mmToPx(l, s2mm(b)), c = l.img.getContext('2d')!;
  if (S.brushMode === 'erase') {
    c.save(); c.globalCompositeOperation = 'destination-out'; c.lineCap = 'round'; c.lineWidth = 2 * r; c.strokeStyle = '#000'; c.fillStyle = '#000';
    c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
    c.beginPath(); c.arc(pb.x, pb.y, r, 0, Math.PI * 2); c.fill(); c.restore();
  } else {
    const d = Math.hypot(pb.x - pa.x, pb.y - pa.y), n = Math.max(1, Math.ceil(d / (r * 0.4)));
    c.save(); c.beginPath();
    for (let i = 0; i <= n; i++) { const x = pa.x + ((pb.x - pa.x) * i) / n, y = pa.y + ((pb.y - pa.y) * i) / n; c.moveTo(x + r, y); c.arc(x, y, r, 0, Math.PI * 2); }
    c.clip(); c.clearRect(0, 0, l.img.width, l.img.height); c.drawImage(l.orig, 0, 0); c.restore();
  }
  markCanvasChanged(l.img);
  dirty();
}

/* ---------- quitar fondo y varita (en un worker) ---------- */
let pixelBusy = false;
/**
 * Ejecuta la tarea en el worker y, si borró algo, la aplica como un paso de deshacer sobre un lienzo nuevo
 * (el anterior queda en el historial). Si mientras tanto la imagen cambió, el resultado se descarta.
 */
async function applyPixelJob(l: Layer, job: PixelJob, busyMsg: string): Promise<PixelResult | null> {
  if (pixelBusy) { toast('Espera a que termine el proceso anterior…'); return null; }
  pixelBusy = true;
  const src = l.img, rev = canvasRevision(src), cv = $('#cv');
  // el aviso solo aparece si tarda (en tareas rápidas evita un parpadeo)
  const slow = setTimeout(() => toast(busyMsg, 0), 150);
  document.body.classList.add('busy');
  cv.setAttribute('aria-busy', 'true');
  try {
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    const r = await runJob(() => ctx.getImageData(0, 0, src.width, src.height), job);
    if (l.img !== src || canvasRevision(src) !== rev || !st.layers.includes(l)) {
      toast('La imagen cambió mientras se procesaba. Vuelve a intentarlo.');
      return null;
    }
    if (r.removed) {
      const s0 = takeSnap();
      const out = document.createElement('canvas');
      out.width = r.w; out.height = r.h;
      out.getContext('2d', { willReadFrequently: true })!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
      l.img = out;
      pushUndo(s0); // solo se guarda el paso si borró algo (así no se pierde "rehacer")
      afterChange();
    }
    return r;
  } catch (err) {
    console.error(err);
    toast('No se pudo procesar la imagen.');
    return null;
  } finally {
    clearTimeout(slow);
    pixelBusy = false;
    document.body.classList.remove('busy');
    cv.removeAttribute('aria-busy');
  }
}
export async function wandAt(p: Pt) {
  const l = st.sel;
  if (!l) return;
  const q = mmToPx(l, s2mm(p)), x = Math.floor(q.x), y = Math.floor(q.y), w = l.img.width;
  if (x < 0 || y < 0 || x >= w || y >= l.img.height) { toast('Toca dentro de la imagen seleccionada'); return; }
  const px = l.img.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, 1, 1).data;
  if (px[3] === 0) { toast('Esa zona ya está vacía'); return; }
  const r = await applyPixelJob(l, { kind: 'wand', seeds: [y * w + x], ref: [px[0]!, px[1]!, px[2]!], tol: S.tol, contig: S.contig }, 'Borrando color…');
  if (r && !r.removed) toast('Nada que borrar con esta tolerancia. Súbela un poco.');
  else if (r) hideToast();
}
/** Quita el fondo uniforme tomando como referencia el color mediano de las cuatro esquinas. */
export async function autoBackground() {
  const l = st.sel;
  if (!l) return;
  const r = await applyPixelJob(l, { kind: 'auto', tol: S.tol }, 'Quitando el fondo…');
  if (!r) return;
  if (r.error === 'transparent') toast('Los bordes ya están transparentes');
  else if (r.error === 'nouniform') toast('No encontré un fondo uniforme. Prueba con la varita.');
  else toast(r.removed ? 'Fondo quitado. Retoca con la Varita o el Borrador si hace falta.' : 'No se borró nada. Sube la tolerancia en la Varita.');
}
export function resetOriginal(l: Layer) {
  beginPixelEdit(l);
  const c = l.img.getContext('2d')!;
  c.clearRect(0, 0, l.img.width, l.img.height); c.drawImage(l.orig, 0, 0);
  markCanvasChanged(l.img);
  keepCenter(l, (x) => { x.crop = { x0: 0, y0: 0, x1: 1, y1: 1 }; x.h = x.w * natRatio(x); x.flipX = false; x.flipY = false; });
  markManual(l);
  afterChange();
  toast('Imagen original restaurada');
}
