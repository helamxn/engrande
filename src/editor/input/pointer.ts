/** Ratón, táctil y lápiz sobre el lienzo: seleccionar, mover, escalar, girar, recortar, pintar y gestos. */
import {
  applyCrop, beginPixelEdit, cloneSelectedInPlace, currentScope, enterCrop, isSelected, markManual, paint, select, selected,
  selectedGroup, selectMany, selectUnit, setMode, toggleInSelection, unitOf, enterGroup,
} from '../actions';
import {
  applyCropDrag, applyScale, bboxMM, boxInside, stretchLayer, cropCenter, equalSpacing, inside, insideImage, measureBetween,
  mmToLocal, nearestBox, normDeg, onGrid, snapRotation, panInFrame, toGrid, rotateLayer, scaleLayer, snapBox, snapEdges, snapSize, solvePointer,
  startScale, unionBox, zoomInFrame, type Box, type Gap, type SnapTargets,
} from '../geometry';
import { membersOf, unitsInScope } from '../groups';
import { placeGuide, removeGuide } from '../ui/guides';
import { commitPending, historyRevision, setPending, snap, takeSnap } from '../history';
import { scheduleSave } from '../io/persist';
import { lastPointerType, setLastPointer } from '../platform';
import { boxHandles, dirty, settleDisplay, groupCorner, groupCursor, groupFrameMM, groupHandles, handleCursor, nearest } from '../render';
import { posterGeo, S, sheetsVisible, st, V } from '../state';
import { panBy, posterFrame, rulerAt, s2mm, zoomAt } from '../view';
import { clearHelpers, measureCtx, measureTo, setGuides, snapPx, stopMeasure, type MeasureCtx } from '../measure';
import { closeMenu, emptyMenu, groupMenu, layerMenu, openMenu, pickLayerMenu, unlockMenu } from '../ui/menu';
import { renderList, syncSel, syncSelSoon } from '../ui/panel';
import { addText, cancelTextPlacement, editText } from '../text/editor';
import { setBrush, setTol } from '../ui/contextbar';
import { clearWandSelection, wandPick, wandSelection } from '../wand';
import { dragWidth, fontFor, isText, setWidthMode, type TextLayer } from '../text/text';
import type { CropDrag, HandleId, Layer, LayerGeom, LayoutGuide, Pt, ScaleDrag } from '../types';

interface GuideDrag {
  t: 'guide'; axis: LayoutGuide['axis']; original: LayoutGuide | null; start: number;
}

type Drag =
  | { t: 'none' }
  | GuideDrag
  | { t: 'pan'; last: Pt }
  /** Mover la imagen o todas las seleccionadas: posición inicial de cada una. */
  | MoveDrag
  /** «Agregar texto»: dónde va. Un clic (sin mover) lo pone en a; un recuadro le da también un ancho fijo. */
  | { t: 'textbox'; a: Pt; moved: boolean; edit: TextLayer | null }
  /** Recuadro de selección (ratón o lápiz sobre el fondo). add: con Shift/Ctrl se suma a lo que ya había. */
  | { t: 'marquee'; a: Pt; add: boolean; base: Layer[]; scope: number | null; candidates?: { bounds: Box; layers: Layer[] }[]; moved: boolean }
  /** Escalar el grupo desde una esquina: corner (la que se arrastra), opp (la opuesta) y center, en mm. */
  | { t: 'gscale'; corner: Pt; opp: Pt; center: Pt; items: { l: Layer; g: LayerGeom }[] }
  /** Estirar el conjunto desde un lado (solo en su eje): box0, el marco al empezar. */
  | { t: 'gside'; id: 'n' | 'e' | 's' | 'w'; m0: Pt; box0: Box; items: { l: Layer; g: LayerGeom }[] }
  /** Girar el grupo alrededor del centro de su marco; frame0: el marco al empezar. */
  | { t: 'grot'; pivot: Pt; a0: number; frame0: Pt[]; items: { l: Layer; g: LayerGeom }[] }
  | { t: 'rot'; cc: Pt; a0: number; r0: number }
  /** Recortar: la imagen se arrastra bajo el marco de recorte, que queda fijo. */
  | { t: 'frame'; m0: Pt; start: LayerGeom }
  | { t: 'paint'; last: Pt; layer: Layer; started: boolean }
  | { t: 'tap'; x: number; y: number; moved: boolean }
  /** Alt + clic derecho y arrastrar: el pincel o la tolerancia, desde v0 según lo que se mueve en horizontal desde x0. */
  | { t: 'adjust'; x0: number; v0: number }
  | ScaleDrag
  | CropDrag;

/**
 * Mover la imagen o todas las seleccionadas: posición inicial de cada una. altAt: Alt + arrastrar, la copia aún no
 * existe; se crea al empezar a moverse (un Alt + clic sin arrastrar no debe dejar una copia encima de la original).
 * toggle: Shift o Ctrl sobre una ya seleccionada; si se suelta sin arrastrar, sale de la selección (ver endPtr).
 */
interface MoveDrag {
  t: 'move'; m0: Pt; items: { l: Layer; x: number; y: number }[]; box0: Box; targets: SnapTargets; others: Box[];
  dupOf: Layer[] | null; altAt?: Pt; toggle?: { l: Layer; at: Pt };
  /** Dónde se pulsó (px): si Alt llega antes de empezar a mover, también se arrastra una copia. */
  downAt?: Pt;
}

/** Pellizco con dos dedos: zoom de la vista, transformar la imagen o (al recortar) encuadrarla en el marco. */
interface Gesture { cx: number; cy: number; d: number; a: number; mode: 'view' | 'layer' | 'frame' | 'group' }

const geomOf = (l: Layer): LayerGeom => ({
  cx: l.cx, cy: l.cy, w: l.w, h: l.h, rot: l.rot, flipX: l.flipX, flipY: l.flipY, crop: { ...l.crop }, img: l.img,
});

const ptrs = new Map<number, Pt>();
let gest: Gesture | null = null;
let drag: Drag | null = null;
let lpTimer: ReturnType<typeof setTimeout> | null = null;
let lpStart: Pt | null = null;
let spaceDown = false;
/** Revisión del historial al empezar el gesto: si al soltar sigue igual, el gesto no cambió nada (ver endPtr). */
let gestureRev = 0;
/** El clic derecho fue para ajustar el pincel o la tolerancia: el menú contextual no se abre. */
let noMenu = false;

export const setSpaceDown = (v: boolean) => { spaceDown = v; };
/** Durante un gesto la barra contextual se oculta para no estorbar. */
export const isGesturing = () => !!gest || !!(drag && !['none', 'tap', 'pan'].includes(drag.t));
export function cancelSelectionGesture() {
  if (drag?.t === 'marquee') {
    const base = drag.base.filter((l) => st.layers.includes(l));
    if (base.length === 1) select(base[0]!); else selectMany(base);
  } else if (drag?.t !== 'guide' && drag?.t !== 'textbox') return;
  clearLP(); drag = null; st.guideDraft = null; st.marquee = null; dirty();
}

function onPoster(p: Pt) {
  const f = posterFrame();
  return p.x >= f.x && p.y >= f.y && p.x <= f.x + f.w && p.y <= f.y + f.h;
}

function guideAt(p: Pt, tolerance: number, event: MouseEvent) {
  if (!st.showGuides || !onPoster(p) || event.altKey || event.shiftKey || event.ctrlKey || event.metaKey || spaceDown) return null;
  const m = s2mm(p), g = posterGeo();
  let hit: LayoutGuide | null = null;
  for (const line of st.layoutGuides) {
    if (line.at < 0 || line.at > (line.axis === 'x' ? g.W : g.H)) continue;
    const distance = Math.abs(m[line.axis] - line.at) * V.k;
    if (distance <= tolerance) { tolerance = distance; hit = line; }
  }
  return hit;
}

function guidePosition(d: GuideDrag, p: Pt) {
  const m = s2mm(p)[d.axis], g = posterGeo();
  const at = d.original ? d.original.at + Math.round(m - d.start) : Math.round(m);
  return Math.max(0, Math.min(at, d.axis === 'x' ? g.W : g.H));
}

/** El punto (mm) cae en el margen sin imprimir: fuera del póster pero dentro del papel de las hojas de fuera. */
function inBand(m: Pt) {
  const g = posterGeo();
  if (!sheetsVisible() || g.m <= 0) return false;
  const out = m.x < 0 || m.y < 0 || m.x > g.W || m.y > g.H;
  return out && m.x >= -g.m && m.y >= -g.m && m.x <= g.W + g.m && m.y <= g.H + g.m;
}
/** Se puede tocar en el lienzo: ni oculta ni bloqueada. */
const touchable = (l: Layer) => !l.hidden && !l.locked;
/** Imagen bajo el punto. precise: ignora las zonas transparentes (salvo de la seleccionada). Salta las bloqueadas. */
function hitLayer(p: Pt, precise = true): Layer | null {
  const m = s2mm(p), L = st.layers;
  if (!precise) { for (let i = L.length - 1; i >= 0; i--) if (touchable(L[i]!) && inside(L[i]!, m)) return L[i]!; return null; }
  for (let i = L.length - 1; i >= 0; i--) { const l = L[i]!; if (touchable(l) && inside(l, m) && opaqueAt(l, m)) return l; }
  if (st.sel && touchable(st.sel) && inside(st.sel, m)) return st.sel;
  return hitLayer(p, false);
}
function opaqueAt(l: Layer, m: Pt) {
  const q = mmToLocal(l, m), x = Math.floor(q.u * l.img.width), y = Math.floor(q.v * l.img.height);
  if (x < 0 || y < 0 || x >= l.img.width || y >= l.img.height) return false;
  try { return l.img.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, 1, 1).data[3]! > 16; } catch { return true; }
}

function gInfo(mode: Gesture['mode']): Gesture {
  const [a, b] = [...ptrs.values()] as [Pt, Pt];
  return { cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2, d: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), a: Math.atan2(b.y - a.y, b.x - a.x), mode };
}
const clearLP = () => { if (lpTimer) clearTimeout(lpTimer); lpTimer = null; };
/** Vuelve a la posición del inicio del gesto (escalar o girar el grupo se calcula siempre desde ahí, sin acumular errores). */
const restoreGeom = (l: Layer, g: LayerGeom) => { l.cx = g.cx; l.cy = g.cy; l.w = g.w; l.h = g.h; l.rot = g.rot; };
const rotPt = (p: Pt, c: Pt, deg: number): Pt => {
  const a = (deg * Math.PI) / 180, cs = Math.cos(a), sn = Math.sin(a), dx = p.x - c.x, dy = p.y - c.y;
  return { x: c.x + dx * cs - dy * sn, y: c.y + dx * sn + dy * cs };
};
/** El punto (mm) está dentro del marco del grupo. */
function inGroupFrame(m: Pt) {
  if (st.group.length < 2) return false;
  const f = groupFrameMM(), xs = f.map((p) => p.x), ys = f.map((p) => p.y);
  return m.x >= Math.min(...xs) && m.x <= Math.max(...xs) && m.y >= Math.min(...ys) && m.y <= Math.max(...ys);
}
/**
 * Empieza a mover lo seleccionado. Para los imanes se guardan la caja de lo que se mueve y las líneas del póster y de
 * las demás imágenes visibles (se calculan una vez, no en cada movimiento).
 */
function startMove(m: Pt, dupOf: Layer[] | null = null, moving = selected()): MoveDrag {
  const sel = selected(), c = measureCtx(moving);
  return {
    t: 'move', m0: m, items: moving.map((l) => ({ l, x: l.cx, y: l.cy })),
    box0: unionBox(sel.map((l) => bboxMM(l))), targets: c.targets, others: c.others, dupOf,
  };
}
/** Imagen visible bajo el punto que no esté en exclude (al medir mientras se arrastra, el cursor está sobre lo que se mueve). */
function hitOther(p: Pt, exclude: Layer[]): Layer | null {
  const m = s2mm(p);
  for (let i = st.layers.length - 1; i >= 0; i--) {
    const l = st.layers[i]!;
    if (!exclude.includes(l) && !l.hidden && inside(l, m)) return l;
  }
  return null;
}
/**
 * Medir en vivo con Alt durante un gesto (como en Figma), desde lo que se mueve o se escala:
 * - al mover: hasta la original si se está duplicando; si no, la imagen bajo el cursor, la más cercana o el póster;
 * - al escalar (Alt también escala desde el centro): la imagen bajo el cursor o, si no hay, los bordes del póster,
 *   para ver si los márgenes quedan iguales.
 */
function measureDuring(d: Drag, p: Pt) {
  const moving = d.t === 'move' || d.t === 'gscale' || d.t === 'gside' ? d.items.map((it) => it.l) : st.sel ? [st.sel] : [];
  if (!moving.length) { st.measure = null; return; }
  const b = unionBox(moving.map((l) => bboxMM(l)));
  let t: Box | null = d.t === 'move' && d.dupOf?.length ? unionBox(d.dupOf.map((l) => bboxMM(l))) : null;
  if (!t) {
    const h = hitOther(p, moving);
    t = h ? bboxMM(h) : d.t === 'move' ? nearestBox(b, d.others) : null;
  }
  const g = posterGeo(), target = t ?? { x0: 0, y0: 0, x1: g.W, y1: g.H };
  st.measure = { ...measureBetween(b, target, !t), target };
}
/** Gestos en los que Alt mide en vivo. */
const measurable = (d: Drag | null): d is Drag => !!d && (d.t === 'move' || d.t === 'scale' || d.t === 'gscale' || d.t === 'gside');
/** Último punto del arrastre, para recalcular la medida si se pulsa o suelta Alt sin mover el ratón. */
let lastDragPt: Pt | null = null;
/** Alt cambió durante un arrastre: se mide (o se deja de medir) desde el estado actual, sin nada congelado. */
export function altChangedDuringDrag(on: boolean): boolean {
  if (!measurable(drag) || !lastDragPt) return false;
  if (on) measureDuring(drag, lastDragPt); else st.measure = null;
  dirty();
  return true;
}
/**
 * Escalar o recortar: caja al empezar y contexto del imán, para saber qué bordes se mueven y a qué pegarlos.
 * Solo con la imagen derecha (sin girar): girada, sus bordes ya no coinciden con los de su caja.
 */
let edgeCtx: { box0: Box; ctx: MeasureCtx } | null = null;
const upright = (l: Layer) => Math.abs(normDeg(l.rot)) < 0.01 || Math.abs(Math.abs(normDeg(l.rot)) - 180) < 0.01;
/** Bordes de b que se han movido respecto a b0. */
const movedEdges = (b: Box, b0: Box) => {
  const ch = (a: number, c: number) => Math.abs(a - c) > 1e-6;
  return { x0: ch(b.x0, b0.x0), x1: ch(b.x1, b0.x1), y0: ch(b.y0, b0.y0), y1: ch(b.y1, b0.y1) };
};
/**
 * Imán de los bordes que se mueven al escalar o recortar (sin medidas, como en Figma). apply(m) recalcula la forma
 * desde el puntero; si un borde queda cerca de una línea, se corrige el puntero lo justo y se vuelve a aplicar.
 */
function edgeHelpers(e: PointerEvent, l: Layer, m: Pt, apply: (m: Pt) => void, size?: { id: HandleId; alt: boolean }) {
  st.guides = null; st.gaps = null;
  // Ctrl/⌘ quita el imán, salvo en el recorte rápido, que se hace precisamente con Ctrl/⌘
  const quickCrop = drag?.t === 'crop' && !!drag.quick;
  if (!edgeCtx || (!quickCrop && (e.ctrlKey || e.metaKey)) || !upright(l)) return;
  const tol = snapPx(e.pointerType) / V.k;
  const b = bboxMM(l), mv = movedEdges(b, edgeCtx.box0);
  const s = snapEdges(b, mv, edgeCtx.ctx.targets, tol);
  // imán de tamaño (solo al escalar): igualar el ancho o el alto de otra imagen. Cuánto mover el puntero depende
  // de qué lado tira (izquierda o derecha, arriba o abajo) y de si con Alt crece por los dos lados.
  const z = size ? snapSize(b, mv, edgeCtx.ctx.others, tol) : { x: null, y: null };
  const half = size?.alt ? 0.5 : 1;
  type Snap = { axis: 'x' | 'y'; d: number; first: number; q: (b: Box) => number; goal: number; g: number | null; box: Box | null };
  const pick = (axis: 'x' | 'y'): Snap | null => {
    const e = s[axis], zz = z[axis], lo = axis === 'x' ? 'x0' : 'y0', hi = axis === 'x' ? 'x1' : 'y1';
    // tamaño igual: el primer intento depende del lado del que se tira y de si con Alt crece por los dos lados
    const zs = zz && size ? { d: zz.d, first: (size.id.includes(axis === 'x' ? 'w' : 'n') ? -1 : 1) * zz.d * half } : null;
    // en cada eje gana el ajuste más corto: borde o centro (guía) o tamaño igual (medidas)
    if (zs && zz && (!e || Math.abs(zs.d) < Math.abs(e.d))) {
      const o = zz.box;
      return { axis, d: zs.d, first: zs.first, q: (c) => c[hi] - c[lo], goal: o[hi] - o[lo], g: null, box: o };
    }
    if (!e) return null;
    const k = mv[hi] && Math.abs(b[hi] + e.d - e.g) < 1e-9 ? hi : lo; // qué borde se pega
    return { axis, d: e.d, first: e.d, q: (c) => c[k], goal: e.g, g: e.g, box: null };
  };
  const snaps = [pick('x'), pick('y')].filter((x): x is Snap => !!x).sort((p, q) => Math.abs(p.d) - Math.abs(q.d));
  // rejilla de 1 mm: en el eje que no se pegó a nada, el borde que se arrastra cae en un mm entero (primero el ancho;
  // desde una esquina sin deformar el alto sigue la proporción y puede quedar en décimas)
  for (const axis of ['x', 'y'] as const) {
    if (snaps.some((x) => x.axis === axis)) continue;
    const lo = axis === 'x' ? 'x0' : 'y0', hi = axis === 'x' ? 'x1' : 'y1', k = mv[hi] ? hi : mv[lo] ? lo : null;
    if (!k || Math.abs(toGrid(b[k])) < 1e-9) continue;
    const goal = onGrid(b[k]);
    snaps.push({ axis, d: goal - b[k], first: goal - b[k], q: (c) => c[k], goal, g: null, box: null });
  }
  if (!snaps.length) return;
  // se fija primero el ajuste más corto; el otro solo si no lo deshace (desde una esquina sin deformar, ancho y alto
  // van juntos y solo se puede cumplir uno, como en Figma)
  const read = (q: (b: Box) => number) => (mm: Pt) => { apply(mm); return q(bboxMM(l)); };
  const done: Snap[] = [];
  let cur = m;
  for (const sn of snaps) {
    const next = solvePointer(cur, sn.axis, read(sn.q), sn.goal, sn.first);
    if (!next) continue;
    apply(next);
    const nb = bboxMM(l);
    if (done.every((o) => Math.abs(o.q(nb) - o.goal) < 1e-6)) { cur = next; done.push(sn); }
  }
  apply(cur);
  if (!done.length) return;
  const nb = bboxMM(l), gx = done.find((x) => x.axis === 'x'), gy = done.find((x) => x.axis === 'y');
  setGuides(nb, edgeCtx.ctx, gx?.g ?? null, gy?.g ?? null);
  // tamaño igual: la misma medida sobre las dos imágenes (encima, para el ancho; a la izquierda, para el alto)
  const off = 8 / V.k, eq: Gap[] = [];
  if (gx?.box) { const o = gx.box; eq.push({ axis: 'x', from: nb.x0, to: nb.x1, at: nb.y0 - off }, { axis: 'x', from: o.x0, to: o.x1, at: o.y0 - off }); }
  if (gy?.box) { const o = gy.box; eq.push({ axis: 'y', from: nb.y0, to: nb.y1, at: nb.x0 - off }, { axis: 'y', from: o.y0, to: o.y1, at: o.x0 - off }); }
  if (eq.length) st.gaps = eq;
}

/** Alt al pasar el ratón: distancias de la selección a la imagen de debajo o al póster (no es una herramienta: se ve cuando toca). */
export function refreshMeasure(p: Pt | null = st.hover) {
  if (measurable(drag)) return; // durante el gesto mide measureDuring
  const sel = selected();
  if (!st.altDown || !sel.length || !p || S.mode !== 'move') { stopMeasure(); return; }
  const h = hitLayer(p); // la misma que resalta el ratón y elegiría el clic
  measureTo(sel, h && !sel.includes(h) ? h : null);
}

/** Imágenes visibles que caben enteras en el recuadro (como en Excalidraw: así un fondo grande no se cuela). */
function inMarquee(drag: Extract<Drag, { t: 'marquee' }>, b: Pt): Layer[] {
  const p = s2mm(drag.a), q = s2mm(b);
  const box = { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) };
  if (!drag.candidates) {
    const layers = drag.scope === null ? st.layers : membersOf(st.layers, drag.scope);
    drag.candidates = unitsInScope(layers.filter(touchable), drag.scope)
      .map((unit) => ({ layers: unit, bounds: unionBox(unit.map(bboxMM)) }));
  }
  return drag.candidates.filter((unit) => boxInside(unit.bounds, box)).flatMap((unit) => unit.layers);
}
/** Menú de una imagen: si forma parte de un grupo, el del grupo; si no, se selecciona sola. */
function menuFor(h: Layer) {
  if (st.group.length > 1 && st.group.includes(h)) return groupMenu();
  // imagen de un grupo sin haber entrado en él: el menú es el del grupo (el del nivel en el que se está)
  if (unitOf(h).length > 1) { selectUnit(h); if (st.group.length > 1) return groupMenu(); }
  // táctil: lo que estaba seleccionado se ofrece para «añadir a la selección» (no hay Shift ni Ctrl)
  const prev = selected().filter((l) => l !== h);
  if (h !== st.sel) select(h);
  return layerMenu(h, prev);
}

function canvasMenu(p: Pt) {
  const m = s2mm(p), h = hitLayer(p);
  const under = st.layers.filter(l => !l.hidden && inside(l, m)).reverse();
  if (!h && selected().length) select(null);
  const actions = h ? menuFor(h) : emptyMenu(m);
  return [...unlockMenu(under.filter(l => l.locked)), ...pickLayerMenu(under.filter(touchable)), ...actions];
}

export function initPointer(cv: HTMLCanvasElement) {
  /** Cambia el cursor solo si es distinto (asignar el mismo valor en cada movimiento también cuesta). */
  const setCursor = (c: string) => { if (cv.style.cursor !== c) cv.style.cursor = c; };
  const pos = (e: MouseEvent): Pt => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  cv.addEventListener('pointerdown', (e) => {
    closeMenu();
    setLastPointer(e.pointerType);
    // Alt + clic derecho y arrastrar a izquierda o derecha, como en Photoshop (en Mac, también Ctrl + Alt + clic):
    // el tamaño del pincel del borrador o la tolerancia de la varita
    const editing = S.mode === 'erase' || S.mode === 'wand';
    if (editing && e.pointerType === 'mouse' && e.altKey && (e.button === 2 || (e.button === 0 && e.ctrlKey)) && !ptrs.size) {
      e.preventDefault();
      cv.setPointerCapture(e.pointerId);
      const p = pos(e), brush = S.mode === 'erase';
      ptrs.set(e.pointerId, p);
      drag = { t: 'adjust', x0: p.x, v0: brush ? S.brush : S.tol };
      st.adjust = { at: p, what: brush ? 'brush' : 'tol' };
      st.hover = p;
      noMenu = e.button === 2;
      dirty();
      return;
    }
    if (e.button > 1 || ptrs.size >= 2) return;
    cv.setPointerCapture(e.pointerId);
    if (!ptrs.size) gestureRev = historyRevision();
    const p = pos(e);
    ptrs.set(e.pointerId, p);
    if (st.hoverBand) { st.hoverBand = false; dirty(); } // al pulsar, el aviso del margen estorba
    if (e.pointerType === 'mouse') st.hover = p;
    const R = e.pointerType === 'mouse' ? 11 : 22;
    clearLP();
    // colocando un texto: sobre un texto que ya existe, se edita ese; si no, aquí empieza el nuevo
    if (st.placingText && ptrs.size === 1) {
      // (se abre al soltar: al pulsar, el navegador aún movería el foco y cerraría el cuadro recién abierto)
      const t = hitLayer(p, false);
      drag = { t: 'textbox', a: p, moved: false, edit: isText(t) ? t : null };
      return;
    }
    if (ptrs.size === 2) {
      if (drag?.t === 'marquee' || drag?.t === 'guide' || drag?.t === 'textbox') cancelSelectionGesture();
      st.groupFrame = null;
      edgeCtx = null;
      clearHelpers();
      st.guideDraft = null;
      // pellizco: transforma la imagen solo si el centro del gesto cae sobre ella; si no, hace zoom de la vista.
      // Al recortar, pellizcar sobre la imagen la amplía o reduce dentro del marco.
      drag = null;
      const g0 = gInfo('view'), c0 = s2mm({ x: g0.cx, y: g0.cy }), sel = st.sel;
      const mode = S.mode === 'move' && inGroupFrame(c0) ? 'group'
        : !sel || !touchable(sel) ? 'view'
          : S.mode === 'move' && inside(sel, c0) ? 'layer'
            : S.mode === 'crop' && insideImage(sel, c0) ? 'frame' : 'view';
      gest = { ...g0, mode };
      setPending(mode === 'layer' || mode === 'group' ? takeSnap() : null);
      dirty();
      return;
    }
    const ruler = rulerAt(p);
    if (ruler && !spaceDown && e.button === 0) {
      drag = { t: 'guide', axis: ruler, original: null, start: s2mm(p)[ruler] };
      return;
    }
    lpStart = p;
    if (e.pointerType !== 'mouse') {
      // mantener pulsado = menú contextual
      lpTimer = setTimeout(() => {
        lpTimer = null;
        if (ptrs.size !== 1) return;
        drag = null; setPending(null);
        const items = canvasMenu(p);
        const r = cv.getBoundingClientRect();
        openMenu(r.left + p.x, r.top + p.y, items);
        dirty();
      }, 550);
    }
    const m = s2mm(p), sel = st.sel;
    if (e.button === 1 || spaceDown) { drag = { t: 'pan', last: p }; return; }

    if (S.mode === 'move') {
      if (st.group.length > 1) {
        // tiradores del grupo: esquinas para escalar todas a la vez, círculo para girarlas
        const h = nearest(groupHandles(), p, R);
        if (h) {
          setPending(takeSnap());
          const fr = groupFrameMM(), center = { x: (fr[0]!.x + fr[2]!.x) / 2, y: (fr[0]!.y + fr[2]!.y) / 2 };
          const items = st.group.map((l) => ({ l, g: geomOf(l) }));
          if (h.id === 'rot') drag = { t: 'grot', pivot: center, a0: Math.atan2(m.y - center.y, m.x - center.x), frame0: fr, items };
          else {
            const box0 = unionBox(st.group.map((l) => bboxMM(l)));
            const i = groupCorner(h.id);
            if (i < 0) drag = { t: 'gside', id: h.id as 'n' | 'e' | 's' | 'w', m0: m, box0, items };
            else drag = { t: 'gscale', corner: fr[i]!, opp: fr[(i + 2) % 4]!, center, items };
            edgeCtx = { box0, ctx: measureCtx(st.group) };
          }
          return;
        }
      }
      if (sel && touchable(sel)) {
        const h = nearest(boxHandles(sel, true), p, R);
        // Ctrl/⌘ + tirador (como en Figma): recorta ese lado sin entrar en el modo de recorte. Con Alt, desde el centro;
        // con Mayús en una esquina, con la proporción. El texto no se recorta: sus tiradores escalan como siempre
        if (h && h.id !== 'rot' && (e.ctrlKey || e.metaKey) && !isText(sel)) {
          setPending(takeSnap());
          drag = { t: 'crop', id: h.id, k0: { ...sel.crop }, ratio0: (sel.w * (sel.crop.x1 - sel.crop.x0)) / (sel.h * (sel.crop.y1 - sel.crop.y0)), quick: true };
          edgeCtx = { box0: bboxMM(sel), ctx: measureCtx([sel]) };
          return;
        }
        if (h) {
          setPending(takeSnap());
          const cc = cropCenter(sel);
          drag = h.id === 'rot' ? { t: 'rot', cc, a0: Math.atan2(m.y - cc.y, m.x - cc.x), r0: sel.rot } : startScale(sel, h.id);
          // el ancho de un texto se calcula con su fuente: que esté lista (o que avise si falta) antes de arrastrar
          if (isText(sel) && (h.id === 'e' || h.id === 'w')) void fontFor(sel, 'cambiar el ancho');
          edgeCtx = drag.t === 'scale' ? { box0: bboxMM(sel), ctx: measureCtx([sel]) } : null;
          return;
        }
      }
      const guide = guideAt(p, e.pointerType === 'touch' ? 10 : 5, e);
      if (guide && e.button === 0) {
        clearLP();
        drag = { t: 'guide', original: guide, axis: guide.axis, start: m[guide.axis] };
        st.hoverL = null;
        setCursor(guide.axis === 'x' ? 'ew-resize' : 'ns-resize');
        dirty(); return;
      }
      const hit = hitLayer(p), multi = e.shiftKey || e.ctrlKey || e.metaKey;
      if (hit && e.altKey) {
        // Alt + arrastrar: mueve una copia (y se mide contra la original mientras siga Alt pulsado), también con Mayús
        // (en horizontal o vertical) o Ctrl (sin imán), en cualquier orden. La copia se crea al empezar a arrastrar (ver
        // el caso 'move' de pointermove): un Alt + clic solo selecciona. Se copia lo que se coge: una que no estaba
        // seleccionada pasa a ser la selección (Mayús aquí es «en línea recta», no «sumar»).
        if (!isSelected(hit)) selectUnit(hit);
        drag = { ...startMove(m), altAt: p };
        cv.style.cursor = 'copy';
      } else if (hit && multi) {
        // Shift o Ctrl + clic: añade o quita. Una que no estaba se añade al pulsar y ya se puede arrastrar todo junto.
        // Una que ya estaba se quita al soltar, y solo si no se arrastró: así Shift o Ctrl + arrastrar mueve lo
        // seleccionado (en horizontal o vertical, o sin imán) en vez de deseleccionarla (como en Figma)
        setPending(takeSnap());
        if (isSelected(hit)) drag = { ...startMove(m), toggle: { l: hit, at: p }, downAt: p };
        else { toggleInSelection(hit); drag = isSelected(hit) ? { ...startMove(m), downAt: p } : { t: 'none' }; }
      } else if (hit) {
        if (!isSelected(hit)) selectUnit(hit); // de un grupo: el grupo entero
        setPending(takeSnap()); drag = { ...startMove(m), downAt: p };
        cv.style.cursor = 'grabbing';
      } else if (e.pointerType !== 'touch') {
        // ratón o lápiz sobre el fondo: recuadro de selección (la vista se mueve con Espacio, la rueda o el botón central)
        drag = { t: 'marquee', a: p, add: multi, base: selected(), scope: currentScope(), moved: false };
        if (!multi && selected().length) select(null);
      } else { if (selected().length) select(null); drag = { t: 'pan', last: p }; }
    } else if (S.mode === 'crop' && sel) {
      const h = nearest(boxHandles(sel, false), p, R);
      if (h && h.id !== 'rot') {
        drag = { t: 'crop', id: h.id, k0: { ...sel.crop }, ratio0: (sel.w * (sel.crop.x1 - sel.crop.x0)) / (sel.h * (sel.crop.y1 - sel.crop.y0)) };
        edgeCtx = { box0: bboxMM(sel), ctx: measureCtx([sel], true) }; // al recortar, el imán solo usa el póster
        return;
      }
      // dentro del marco o sobre la parte atenuada de la imagen: se arrastra la imagen, el marco queda fijo
      if (insideImage(sel, m)) { drag = { t: 'frame', m0: m, start: geomOf(sel) }; cv.style.cursor = 'grabbing'; return; }
      const hit = hitLayer(p);
      if (hit && hit !== sel) { select(hit); drag = { t: 'none' }; }
      else { if (!hit) applyCrop(); drag = { t: 'pan', last: p }; }
    } else if (S.mode === 'erase' && sel) {
      // con el borrador solo se pinta en la imagen que se edita: pulsar sobre otra no la selecciona
      // (se cambia de imagen con «Listo», Esc o desde Capas)
      if (!inside(sel, m)) return;
      drag = { t: 'paint', last: p, layer: sel, started: e.pointerType === 'mouse' };
      if (drag.started) { beginPixelEdit(sel); paint(sel, p, p); }
    } else if (S.mode === 'wand') {
      drag = { t: 'tap', x: p.x, y: p.y, moved: false };
    }
  });

  cv.addEventListener('pointermove', (e) => {
    const p = pos(e), sel = st.sel;
    // ajustando el pincel o la tolerancia: el círculo se queda donde se pulsó y su borde sigue al ratón
    if (drag?.t === 'adjust' && ptrs.has(e.pointerId) && st.adjust) {
      const dx = p.x - drag.x0;
      if (st.adjust.what === 'brush') setBrush(drag.v0 + dx); else setTol(drag.v0 + dx / 2);
      st.hover = st.adjust.at;
      dirty();
      return;
    }
    if (e.pointerType === 'mouse' || drag?.t === 'paint') st.hover = p;
    if (!ptrs.has(e.pointerId)) {
      if (ptrs.size) return;
      // solo pasar el ratón por encima: cursores y resaltado
      const prevHoverL = st.hoverL;
      if (e.pointerType === 'mouse') {
        if (st.placingText) { st.hoverL = null; setCursor('text'); if (prevHoverL) dirty(); return; }
        const ruler = rulerAt(p);
        if (ruler) { st.hoverL = null; setCursor(ruler === 'x' ? 'ew-resize' : 'ns-resize'); dirty(); return; }
        if (S.mode === 'move') {
          const gh = st.group.length > 1 ? nearest(groupHandles(), p, 11) : null;
          if (gh) { st.hoverL = null; setCursor(groupCursor(gh.id)); if (st.hoverL !== prevHoverL) dirty(); return; }
          const h = sel && touchable(sel) && nearest(boxHandles(sel, true), p, 11);
          const guide = !h && guideAt(p, 5, e);
          if (guide) { st.hoverL = null; setCursor(guide.axis === 'x' ? 'ew-resize' : 'ns-resize'); if (prevHoverL) dirty(); return; }
          // lo que se resalta es lo que seleccionaría el clic: sobre la zona transparente de una imagen, la de debajo
          st.hoverL = h ? null : hitLayer(p);
          setCursor(h && sel ? handleCursor(sel, h.id) : st.hoverL ? (e.altKey ? 'copy' : 'move') : 'default');
          // sobre el margen sin imprimir (la franja alrededor del póster), sin imagen encima: se explica qué es
          const band = !h && !st.hoverL && inBand(s2mm(p));
          if (band !== st.hoverBand) { st.hoverBand = band; dirty(); }
          else if (band) dirty(); // el aviso sigue al ratón
        } else if (S.mode === 'crop' && sel) {
          const h = nearest(boxHandles(sel, false), p, 11);
          setCursor(h ? handleCursor(sel, h.id) : insideImage(sel, s2mm(p)) ? 'grab' : 'default');
        }
      }
      if (st.altDown && e.pointerType === 'mouse') refreshMeasure(p);
      // solo se redibuja si cambia algo visible: el círculo del pincel o la imagen resaltada
      if (S.mode === 'erase' || st.hoverL !== prevHoverL) dirty();
      return;
    }
    ptrs.set(e.pointerId, p);
    // "mantener pulsado" se cancela en cuanto el dedo se aleja más de 8 px del punto donde empezó (no del último evento)
    if (lpTimer && lpStart && Math.hypot(p.x - lpStart.x, p.y - lpStart.y) > 8) clearLP();

    if (gest && ptrs.size === 2) {
      const n = gInfo(gest.mode);
      const pv = s2mm({ x: n.cx, y: n.cy }), pp = s2mm({ x: gest.cx, y: gest.cy });
      if (gest.mode === 'layer' && sel) {
        commitPending();
        markManual(sel);
        sel.cx += pv.x - pp.x; sel.cy += pv.y - pp.y;
        scaleLayer(sel, n.d / gest.d, pv);
        rotateLayer(sel, ((n.a - gest.a) * 180) / Math.PI, pv);
        syncSelSoon();
      } else if (gest.mode === 'group') {
        // pellizco sobre el grupo: mover, escalar y girar todas alrededor de los dedos
        commitPending();
        const d = ((n.a - gest.a) * 180) / Math.PI;
        for (const l of st.group) {
          l.cx += pv.x - pp.x; l.cy += pv.y - pp.y;
          scaleLayer(l, n.d / gest.d, pv); rotateLayer(l, d, pv); markManual(l);
        }
        syncSelSoon();
      } else if (gest.mode === 'frame' && sel) {
        // encuadre con dos dedos: desplazar y ampliar la imagen bajo el marco fijo (sin girar)
        panInFrame(sel, geomOf(sel), { x: pv.x - pp.x, y: pv.y - pp.y });
        zoomInFrame(sel, n.d / gest.d, pv);
      } else { V.ox += n.cx - gest.cx; V.oy += n.cy - gest.cy; zoomAt(n.cx, n.cy, n.d / gest.d); }
      gest = n;
      dirty();
      return;
    }
    if (!drag) return;
    const m = s2mm(p);
    switch (drag.t) {
      case 'guide':
        st.guideDraft = { original: drag.original, axis: drag.axis, at: onPoster(p) ? guidePosition(drag, p) : -1 };
        break;
      case 'textbox': {
        // el recuadro se ve mientras se arrastra (el mismo dibujo que el de selección)
        if (drag.edit) break;
        if (!drag.moved && Math.hypot(p.x - drag.a.x, p.y - drag.a.y) < 6) break;
        drag.moved = true;
        st.marquee = { a: drag.a, b: p };
        dirty(); break;
      }
      case 'pan': panBy(p.x - drag.last.x, p.y - drag.last.y); drag.last = p; break;
      case 'move': {
        let d = drag;
        if (d.downAt && historyRevision() === gestureRev && Math.hypot(p.x - d.downAt.x, p.y - d.downAt.y) < 3) break;
        // Alt pulsado después del clic, pero antes de mover nada: también es arrastrar una copia
        if (e.altKey && d.downAt && !d.altAt && !d.dupOf && historyRevision() === gestureRev) {
          setPending(null); d.toggle = undefined; d.altAt = d.downAt;
        }
        if (d.toggle) {
          if (Math.hypot(p.x - d.toggle.at.x, p.y - d.toggle.at.y) < 4) break; // aún es un clic
          d.toggle = undefined; // es un arrastre: se mueve y no se quita de la selección
        }
        if (d.altAt) {
          if (Math.hypot(p.x - d.altAt.x, p.y - d.altAt.y) < 4) break; // aún no es un arrastre
          const originals = selected();
          snap();
          d = drag = startMove(d.m0, originals, cloneSelectedInPlace());
        }
        commitPending();
        let dx = m.x - d.m0.x, dy = m.y - d.m0.y;
        const lockX = e.shiftKey && Math.abs(dx) <= Math.abs(dy), lockY = e.shiftKey && !lockX;
        if (lockX) dx = 0;
        if (lockY) dy = 0;
        // imanes: bordes y centros del póster y de las demás imágenes, o separación igual (lo más cercano en cada
        // eje). Sin distancias al arrastrar, como en Figma. Ctrl o ⌘: sin ayudas.
        st.guides = null; st.gaps = null;
        const g = posterGeo(), c: MeasureCtx = { others: d.others, targets: d.targets, W: g.W, H: g.H };
        const b0 = d.box0, at = (x: number, y: number) => ({ x0: b0.x0 + x, y0: b0.y0 + y, x1: b0.x1 + x, y1: b0.y1 + y });
        if (!(e.ctrlKey || e.metaKey)) {
          const tol = snapPx(e.pointerType) / V.k, s = snapBox(at(dx, dy), d.targets, tol);
          // con Alt se mide: no se mezclan los números de la separación igual
          const measuring = e.altKey || st.altDown;
          const ex = lockX || measuring ? null : equalSpacing(at(dx, dy), d.others, 'x', tol);
          const ey = lockY || measuring ? null : equalSpacing(at(dx, dy), d.others, 'y', tol);
          // en cada eje gana el ajuste más corto: borde o centro (guía) o separación igual (medidas)
          const useEx = !!ex && (s.gx === null || Math.abs(ex.d) < Math.abs(s.dx));
          const useEy = !!ey && (s.gy === null || Math.abs(ey.d) < Math.abs(s.dy));
          if (!lockX) dx += useEx ? ex!.d : s.dx;
          if (!lockY) dy += useEy ? ey!.d : s.dy;
          // rejilla de 1 mm en el eje que no se pegó a nada: la esquina de lo que se mueve, en mm enteros
          if (!lockX && !useEx && s.gx === null) dx += toGrid(b0.x0 + dx);
          if (!lockY && !useEy && s.gy === null) dy += toGrid(b0.y0 + dy);
          setGuides(at(dx, dy), c, lockX || useEx ? null : s.gx, lockY || useEy ? null : s.gy);
          const eq = [...(useEx ? ex!.gaps : []), ...(useEy ? ey!.gaps : [])];
          if (eq.length) st.gaps = eq;
        }
        for (const it of d.items) { it.l.cx = it.x + dx; it.l.cy = it.y + dy; markManual(it.l); }
        lastDragPt = p;
        if (e.altKey || st.altDown) measureDuring(d, p); else st.measure = null;
        syncSelSoon(); break;
      }
      case 'gscale': {
        commitPending();
        // Alt: desde el centro; si no, la esquina opuesta queda fija. Siempre sin deformar.
        const P = e.altKey ? drag.center : drag.opp;
        const vx = drag.corner.x - P.x, vy = drag.corner.y - P.y, L2 = vx * vx + vy * vy || 1;
        let f = Math.max(0.05, ((m.x - P.x) * vx + (m.y - P.y) * vy) / L2);
        // imán: la esquina que se arrastra se pega a bordes y centros (en x o en y, lo más cercano)
        st.guides = null; st.gaps = null;
        let gsnap: { gx: number | null; gy: number | null } | null = null;
        if (edgeCtx && !(e.ctrlKey || e.metaKey)) {
          const tol = snapPx(e.pointerType) / V.k;
          let best: { f: number; d: number; gx: number | null; gy: number | null } | null = null;
          const tryAxis = (c0: number, p: number, targets: number[], axis: 'x' | 'y') => {
            if (Math.abs(c0 - p) < 1e-9) return;
            for (const t of targets) {
              const ft = (t - p) / (c0 - p), d = Math.abs((ft - f) * (c0 - p));
              if (ft > 0.05 && d <= tol && (!best || d < best.d)) best = { f: ft, d, gx: axis === 'x' ? t : null, gy: axis === 'y' ? t : null };
            }
          };
          tryAxis(drag.corner.x, P.x, edgeCtx.ctx.targets.x, 'x');
          tryAxis(drag.corner.y, P.y, edgeCtx.ctx.targets.y, 'y');
          const b = best as { f: number; gx: number | null; gy: number | null } | null;
          if (b) { f = b.f; gsnap = { gx: b.gx, gy: b.gy }; }
          else {
            // rejilla de 1 mm: la esquina que se arrastra cae en un mm entero (en x; el alto sigue la proporción)
            const c0 = drag.corner.x;
            if (Math.abs(c0 - P.x) > 1e-9) { const ft = (onGrid(P.x + (c0 - P.x) * f) - P.x) / (c0 - P.x); if (ft > 0.05) f = ft; }
          }
        }
        for (const it of drag.items) { restoreGeom(it.l, it.g); scaleLayer(it.l, f, P); markManual(it.l); }
        if (edgeCtx && gsnap) setGuides(unionBox(drag.items.map((it) => bboxMM(it.l))), edgeCtx.ctx, gsnap.gx, gsnap.gy);
        lastDragPt = p;
        if (e.altKey || st.altDown) measureDuring(drag, p); else st.measure = null;
        syncSelSoon(); break;
      }
      case 'gside': {
        commitPending();
        // el lado se mueve lo que el puntero (sin saltar a él al cogerlo); queda fijo el opuesto (con Alt, el centro).
        // Mayús: sin deformar
        const d = drag, b = d.box0, horiz = d.id === 'e' || d.id === 'w';
        const lo = horiz ? b.x0 : b.y0, hi = horiz ? b.x1 : b.y1, far = d.id === 'e' || d.id === 's';
        const edge0 = far ? hi : lo, P = e.altKey ? (lo + hi) / 2 : far ? lo : hi;
        let edge = edge0 + (horiz ? m.x - d.m0.x : m.y - d.m0.y), line: number | null = null;
        st.guides = null; st.gaps = null;
        // imán: el lado se pega a bordes y centros (de las demás, del póster y de las guías); si no, a un mm entero
        if (edgeCtx && !(e.ctrlKey || e.metaKey)) {
          let best = snapPx(e.pointerType) / V.k;
          for (const t of horiz ? edgeCtx.ctx.targets.x : edgeCtx.ctx.targets.y) {
            const dd = Math.abs(t - edge);
            if (dd <= best) { best = dd; line = t; }
          }
          edge = line ?? onGrid(edge);
        }
        // nunca se da la vuelta ni se aplasta del todo
        const f = Math.max(0.02, (edge - P) / (edge0 - P));
        const pivot = horiz ? { x: P, y: (b.y0 + b.y1) / 2 } : { x: (b.x0 + b.x1) / 2, y: P };
        for (const it of d.items) {
          restoreGeom(it.l, it.g);
          if (e.shiftKey) scaleLayer(it.l, f, pivot); else stretchLayer(it.l, horiz ? f : 1, horiz ? 1 : f, pivot);
          markManual(it.l);
        }
        if (edgeCtx && line != null) setGuides(unionBox(d.items.map((it) => bboxMM(it.l))), edgeCtx.ctx, horiz ? line : null, horiz ? null : line);
        lastDragPt = p;
        if (e.altKey || st.altDown) measureDuring(drag, p); else st.measure = null;
        syncSelSoon(); break;
      }
      case 'grot': {
        commitPending();
        let d = ((Math.atan2(m.y - drag.pivot.y, m.x - drag.pivot.x) - drag.a0) * 180) / Math.PI;
        d = snapRotation(d, e.shiftKey);
        for (const it of drag.items) { restoreGeom(it.l, it.g); rotateLayer(it.l, d, drag.pivot); markManual(it.l); }
        const pivot = drag.pivot;
        st.groupFrame = drag.frame0.map((q) => rotPt(q, pivot, d));
        syncSelSoon(); break;
      }
      case 'marquee': {
        if (!drag.moved && Math.hypot(p.x - drag.a.x, p.y - drag.a.y) < 4) break;
        drag.moved = true;
        st.marquee = { a: drag.a, b: p };
        // la selección se actualiza en vivo, solo cuando cambia
        const next = [...new Set([...(drag.add ? drag.base : []), ...inMarquee(drag, p)])], cur = selected();
        if (next.length !== cur.length || next.some((l) => !cur.includes(l))) selectMany(next);
        break;
      }
      case 'scale': {
        if (!sel) break;
        commitPending(); markManual(sel);
        const d = drag;
        // un lado de un texto cambia su ancho (las líneas se parten), no lo estira
        if (isText(sel) && (d.id === 'e' || d.id === 'w')) { dragWidth(sel, d.L0, d.id, m); lastDragPt = p; syncSelSoon(); break; }
        const free = e.shiftKey && !isText(sel); // un texto siempre escala sin deformar
        applyScale(sel, d, m, free, e.altKey);
        edgeHelpers(e, sel, m, (mm) => applyScale(sel, d, mm, free, e.altKey), { id: d.id, alt: e.altKey });
        lastDragPt = p;
        if (e.altKey || st.altDown) measureDuring(d, p); else st.measure = null;
        syncSelSoon(); break;
      }
      case 'rot': {
        if (!sel) break;
        commitPending();
        markManual(sel);
        let r = drag.r0 + ((Math.atan2(m.y - drag.cc.y, m.x - drag.cc.x) - drag.a0) * 180) / Math.PI;
        r = snapRotation(r, e.shiftKey);
        rotateLayer(sel, normDeg(r - sel.rot), drag.cc);
        syncSelSoon(); break;
      }
      case 'crop': {
        if (!sel) break;
        const d = drag, ratio = d.quick ? null : S.cropRatio; // la proporción elegida es la del modo de recorte
        if (d.quick) { commitPending(); markManual(sel); }
        applyCropDrag(sel, d, m, e.shiftKey, e.altKey, ratio);
        edgeHelpers(e, sel, m, (mm) => applyCropDrag(sel, d, mm, e.shiftKey, e.altKey, ratio));
        lastDragPt = p;
        syncSelSoon();
        break;
      }
      case 'frame': {
        if (!sel) break;
        let dx = m.x - drag.m0.x, dy = m.y - drag.m0.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        panInFrame(sel, drag.start, { x: dx, y: dy });
        break;
      }
      case 'paint': {
        if (!sel || sel !== drag.layer || S.mode !== 'erase') break;
        if (!drag.started) {
          if (lpTimer) break;
          beginPixelEdit(sel); drag.started = true;
        }
        paint(sel, drag.last, p); drag.last = p; break;
      }
      case 'tap': if (Math.hypot(p.x - drag.x, p.y - drag.y) > 6) drag.moved = true; break;
    }
    dirty();
  });

  const endPtr = (e: PointerEvent) => {
    if (!ptrs.has(e.pointerId)) return;
    clearLP();
    if (e.type !== 'pointerup') cancelSelectionGesture();
    const p = pos(e), sel = st.sel;
    if (drag?.t === 'adjust') {
      st.adjust = null; ptrs.delete(e.pointerId); drag = null;
      if (e.pointerType === 'mouse') st.hover = p;
      dirty();
      return;
    }
    const wasGuide = drag?.t === 'guide';
    if (drag?.t === 'guide') {
      if (e.type === 'pointerup') {
        if (drag.original && rulerAt(p) === drag.axis) removeGuide(drag.original);
        else if (onPoster(p)) placeGuide(drag.axis, guidePosition(drag, p), drag.original);
      }
      st.guideDraft = null;
    }
    if (drag?.t === 'paint' && !drag.started && e.type === 'pointerup' && sel === drag.layer && S.mode === 'erase') {
      beginPixelEdit(sel); paint(sel, drag.last, p);
    }
    if (drag?.t === 'marquee') { st.marquee = null; if (drag.moved) cv.style.cursor = 'default'; }
    if (drag?.t === 'textbox') {
      st.marquee = null;
      if (e.type === 'pointerup') {
        const a = s2mm(drag.a), b = s2mm(p), t = drag.edit;
        if (t) { cancelTextPlacement(); select(t); editText(t); }
        // recuadro: su esquina de arriba a la izquierda y su ancho; clic: el punto, con ancho automático
        else if (drag.moved && Math.abs(b.x - a.x) > 2) addText({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) }, Math.abs(b.x - a.x));
        else addText(a);
      }
    }
    // Shift o Ctrl + clic (sin arrastrar) sobre una que ya estaba seleccionada: sale de la selección
    const toggleOnUp = drag?.t === 'move' && drag.toggle && e.type === 'pointerup' ? drag.toggle.l : null;
    if (drag?.t === 'tap' && !drag.moved && e.type === 'pointerup') {
      // elegir un color (Shift: sumar; Alt: restar; sin teclas, lo que diga la barra). Fuera de la imagen: si hay algo
      // elegido, se quita; si no, el fondo vacío deja la varita. Tocar otra imagen no la selecciona (como el borrador)
      if (sel && inside(sel, s2mm(p))) wandPick(p, e.shiftKey ? 'add' : e.altKey ? 'sub' : st.wandOp);
      else if (wandSelection()) clearWandSelection();
      else if (!hitLayer(p)) setMode('move');
    }
    // un clic sobre una imagen (mover sin llegar a moverla) no cambia nada: ni lista que rehacer ni nada que guardar
    const idleClick = drag?.t === 'move' && historyRevision() === gestureRev;
    if ((drag && ['paint', 'scale', 'crop', 'frame', 'move', 'rot', 'gscale', 'gside', 'grot'].includes(drag.t) && !idleClick) || gest?.mode === 'layer' || gest?.mode === 'group') {
      renderList(); syncSel(); scheduleSave();
    }
    if (drag?.t === 'paint') settleDisplay(drag.layer.img);
    // al soltar el giro, el marco vuelve a ser la caja común (alineada con la pantalla)
    if (drag?.t === 'grot') st.groupFrame = null;
    edgeCtx = null;
    clearHelpers(); // imanes y medidas solo durante el gesto
    if (measurable(drag)) { lastDragPt = null; stopMeasure(); if (st.altDown && e.pointerType === 'mouse') refreshMeasure(p); }
    if (drag?.t === 'frame' && e.pointerType === 'mouse') cv.style.cursor = 'grab';
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) { if (gest) renderList(); gest = null; }
    drag = null; setPending(null);
    if (toggleOnUp) toggleInSelection(toggleOnUp);
    if (ptrs.size === 0 && e.pointerType !== 'mouse') st.hover = null;
    if (S.mode === 'move' && e.pointerType === 'mouse') {
      const axis = wasGuide && (rulerAt(p) ?? guideAt(p, 5, e)?.axis);
      setCursor(axis ? (axis === 'x' ? 'ew-resize' : 'ns-resize') : st.sel && touchable(st.sel) && inside(st.sel, s2mm(p)) ? 'move' : 'default');
    }
    dirty();
  };
  cv.addEventListener('pointerup', endPtr);
  cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('lostpointercapture', endPtr);
  cv.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse' || ptrs.size) return;
    const had = !!st.hoverL || S.mode === 'erase' || st.hoverBand;
    st.hover = null; st.hoverL = null; st.hoverBand = false;
    stopMeasure();
    if (had) dirty();
  });

  /* rueda del ratón = zoom; dos dedos en el trackpad = mover la vista; pellizco en el trackpad (llega con ctrlKey) = zoom */
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (ptrs.size) return;
    clearHelpers(); // al hacer zoom o mover la vista, las ayudas se quitan hasta el siguiente movimiento
    closeMenu();
    const p = pos(e), m = s2mm(p), sel = st.sel;
    const zoom = e.ctrlKey || e.metaKey || e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    const dy = e.deltaY * (e.deltaMode === WheelEvent.DOM_DELTA_LINE ? 16 : e.deltaMode === WheelEvent.DOM_DELTA_PAGE ? cv.clientHeight : 1);
    const f = Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.0015));
    // al recortar, la rueda (o el pellizco del trackpad) sobre la imagen la amplía dentro del marco fijo
    if (zoom && S.mode === 'crop' && sel && insideImage(sel, m)) { zoomInFrame(sel, f, m); dirty(); return; }
    if (zoom) zoomAt(p.x, p.y, f);
    else panBy(-e.deltaX, -e.deltaY);
  }, { passive: false });

  cv.addEventListener('dblclick', (e) => {
    // doble clic en un lado de un texto: vuelve al ancho automático (cada línea ocupa todo lo que mide)
    const ts = st.sel;
    if (isText(ts) && S.mode === 'move') {
      const sh = nearest(boxHandles(ts, false), pos(e), 11);
      if (sh && (sh.id === 'e' || sh.id === 'w')) { void setWidthMode(ts, false); return; }
    }
    if (S.mode === 'move' && guideAt(pos(e), 5, e)) return;
    // pintando con el borrador o la varita, el doble clic no recorta ni cambia de imagen
    if (S.mode === 'erase' || S.mode === 'wand') return;
    const h = hitLayer(pos(e));
    if (!h) return;
    if (S.mode === 'crop') { applyCrop(); return; }
    // doble clic sobre un grupo seleccionado: un nivel más adentro (su subgrupo o la imagen); sobre una sola, recorta
    if (st.group.includes(h) && selectedGroup() != null) { enterGroup(h); return; }
    if (isText(h)) { editText(h); return; }
    select(h); enterCrop();
  });
  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (noMenu || drag?.t === 'adjust') { noMenu = false; return; } // fue Alt + clic derecho para ajustar el pincel
    if (lastPointerType() !== 'mouse') return; // en táctil el menú lo abre "mantener pulsado"
    if (S.mode === 'crop') applyCrop();
    openMenu(e.clientX, e.clientY, canvasMenu(pos(e)));
  });
}
