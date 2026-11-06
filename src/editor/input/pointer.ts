/** Ratón, táctil y lápiz sobre el lienzo: seleccionar, mover, escalar, girar, recortar, pintar y gestos. */
import {
  applyCrop, beginPixelEdit, cloneSelectedInPlace, enterCrop, isSelected, markManual, paint, select, selected,
  selectedGroup, selectMany, selectUnit, setMode, toggleInSelection, unitOf, wandAt, enterGroup,
} from '../actions';
import {
  applyCropDrag, applyScale, bboxMM, boxInside, cropCenter, equalSpacing, inside, insideImage, measureBetween,
  mmToLocal, nearestBox, normDeg, panInFrame, rotateLayer, scaleLayer, snapBox, snapEdges, snapSize, solvePointer,
  startScale, unionBox, zoomInFrame, type Box, type Gap, type SnapTargets,
} from '../geometry';
import { unitAt } from '../groups';
import { commitPending, setPending, snap, takeSnap, undo } from '../history';
import { scheduleSave } from '../io/persist';
import { lastPointerType, setLastPointer } from '../platform';
import { boxHandles, dirty, groupCorner, groupCursor, groupFrameMM, groupHandles, handleCursor, nearest } from '../render';
import { posterGeo, S, sheetsVisible, st, V } from '../state';
import { panBy, s2mm, zoomAt } from '../view';
import { clearHelpers, measureCtx, measureTo, setGuides, snapPx, stopMeasure, type MeasureCtx } from '../measure';
import { closeMenu, emptyMenu, groupMenu, layerMenu, openMenu } from '../ui/menu';
import { renderList, syncSel } from '../ui/panel';
import type { CropDrag, HandleId, Layer, LayerGeom, Pt, ScaleDrag } from '../types';

type Drag =
  | { t: 'none' }
  | { t: 'pan'; last: Pt }
  /** Mover la imagen o todas las seleccionadas: posición inicial de cada una. */
  | MoveDrag
  /** Recuadro de selección (ratón o lápiz sobre el fondo). add: con Shift/Ctrl se suma a lo que ya había. */
  | { t: 'marquee'; a: Pt; add: boolean; base: Layer[]; moved: boolean }
  /** Escalar el grupo desde una esquina: corner (la que se arrastra), opp (la opuesta) y center, en mm. */
  | { t: 'gscale'; corner: Pt; opp: Pt; center: Pt; items: { l: Layer; g: LayerGeom }[] }
  /** Girar el grupo alrededor del centro de su marco; frame0: el marco al empezar. */
  | { t: 'grot'; pivot: Pt; a0: number; frame0: Pt[]; items: { l: Layer; g: LayerGeom }[] }
  | { t: 'rot'; cc: Pt; a0: number; r0: number }
  /** Recortar: la imagen se arrastra bajo el marco de recorte, que queda fijo. */
  | { t: 'frame'; m0: Pt; start: LayerGeom }
  | { t: 'paint'; last: Pt }
  | { t: 'tap'; x: number; y: number; moved: boolean }
  | ScaleDrag
  | CropDrag;

/**
 * Mover la imagen o todas las seleccionadas: posición inicial de cada una. altAt: Alt + arrastrar, la copia aún no
 * existe; se crea al empezar a moverse (un Alt + clic sin arrastrar no debe dejar una copia encima de la original).
 */
interface MoveDrag {
  t: 'move'; m0: Pt; items: { l: Layer; x: number; y: number }[]; box0: Box; targets: SnapTargets; others: Box[];
  dupOf: Layer[] | null; altAt?: Pt;
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

export const setSpaceDown = (v: boolean) => { spaceDown = v; };
/** Durante un gesto la barra contextual se oculta para no estorbar. */
export const isGesturing = () => !!gest || !!(drag && !['none', 'tap', 'pan'].includes(drag.t));

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
function startMove(m: Pt, dupOf: Layer[] | null = null): MoveDrag {
  const sel = selected(), c = measureCtx(sel);
  return {
    t: 'move', m0: m, items: sel.map((l) => ({ l, x: l.cx, y: l.cy })),
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
  const moving = d.t === 'move' || d.t === 'gscale' ? d.items.map((it) => it.l) : st.sel ? [st.sel] : [];
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
const measurable = (d: Drag | null): d is Drag => !!d && (d.t === 'move' || d.t === 'scale' || d.t === 'gscale');
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
  if (!edgeCtx || e.ctrlKey || e.metaKey || !upright(l)) return;
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

/** Alt al pasar el ratón (o «Medir» en táctil): distancias de la selección a la imagen de debajo o al póster. */
export function refreshMeasure(p: Pt | null = st.hover) {
  if (measurable(drag)) return; // durante el gesto mide measureDuring
  const sel = selected();
  if (!(st.altDown || st.measureMode) || !sel.length || !p || S.mode !== 'move') { stopMeasure(); return; }
  const h = hitLayer(p, false);
  measureTo(sel, h && !sel.includes(h) ? h : null);
}

/** Imágenes visibles que caben enteras en el recuadro (como en Excalidraw: así un fondo grande no se cuela). */
function inMarquee(a: Pt, b: Pt): Layer[] {
  const p = s2mm(a), q = s2mm(b);
  const box = { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) };
  const ins = st.layers.filter((l) => touchable(l) && boxInside(bboxMM(l), box));
  // un grupo (el de más afuera) solo entra si caben todas sus imágenes (como en Figma)
  return ins.filter((l) => unitAt(st.layers, l, null).every((x) => !touchable(x) || ins.includes(x)));
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

export function initPointer(cv: HTMLCanvasElement) {
  /** Cambia el cursor solo si es distinto (asignar el mismo valor en cada movimiento también cuesta). */
  const setCursor = (c: string) => { if (cv.style.cursor !== c) cv.style.cursor = c; };
  const pos = (e: MouseEvent): Pt => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  cv.addEventListener('pointerdown', (e) => {
    closeMenu();
    setLastPointer(e.pointerType);
    if (e.button === 2) return;
    cv.setPointerCapture(e.pointerId);
    const p = pos(e);
    ptrs.set(e.pointerId, p);
    if (st.hoverBand) { st.hoverBand = false; dirty(); } // al pulsar, el aviso del margen estorba
    if (e.pointerType === 'mouse') st.hover = p;
    const R = e.pointerType === 'mouse' ? 11 : 22;
    clearLP();
    if (ptrs.size === 2) {
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
    if (ptrs.size > 2) return;
    if (st.measureMode && ptrs.size === 1) {
      const h = hitLayer(p, false), mm = s2mm(p), g = posterGeo();
      const onPoster = mm.x >= 0 && mm.y >= 0 && mm.x <= g.W && mm.y <= g.H;
      if ((h && !isSelected(h)) || onPoster) refreshMeasure(p);
      else { st.measureMode = false; stopMeasure(); } // tocar fuera del póster termina
      ptrs.delete(e.pointerId);
      return;
    }
    lpStart = p;
    if (e.pointerType !== 'mouse') {
      // mantener pulsado = menú contextual
      lpTimer = setTimeout(() => {
        lpTimer = null;
        if (ptrs.size !== 1) return;
        if (drag?.t === 'paint') undo();
        drag = null; setPending(null);
        const h = hitLayer(p);
        const items = h ? menuFor(h) : (select(null), emptyMenu());
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
            const i = groupCorner(h.id);
            drag = { t: 'gscale', corner: fr[i]!, opp: fr[(i + 2) % 4]!, center, items };
            edgeCtx = { box0: unionBox(st.group.map((l) => bboxMM(l))), ctx: measureCtx(st.group) };
          }
          return;
        }
      }
      if (sel && touchable(sel)) {
        const h = nearest(boxHandles(sel, true), p, R);
        if (h) {
          setPending(takeSnap());
          const cc = cropCenter(sel);
          drag = h.id === 'rot' ? { t: 'rot', cc, a0: Math.atan2(m.y - cc.y, m.x - cc.x), r0: sel.rot } : startScale(sel, h.id);
          edgeCtx = drag.t === 'scale' ? { box0: bboxMM(sel), ctx: measureCtx([sel]) } : null;
          return;
        }
      }
      const hit = hitLayer(p), multi = e.shiftKey || e.ctrlKey || e.metaKey;
      if (hit && multi) {
        // Shift o Ctrl + clic: añade o quita; si queda seleccionada, se puede arrastrar todo junto
        toggleInSelection(hit);
        if (isSelected(hit)) { setPending(takeSnap()); drag = startMove(m); } else drag = { t: 'none' };
      } else if (hit) {
        if (!isSelected(hit)) selectUnit(hit); // de un grupo: el grupo entero
        // Alt + arrastrar: mueve una copia (y se mide contra la original mientras siga Alt pulsado). La copia se
        // crea al empezar a arrastrar (ver el caso 'move' de pointermove): un Alt + clic solo selecciona.
        if (e.altKey) drag = { ...startMove(m), altAt: p };
        else { setPending(takeSnap()); drag = startMove(m); }
        cv.style.cursor = e.altKey ? 'copy' : 'grabbing';
      } else if (e.pointerType !== 'touch') {
        // ratón o lápiz sobre el fondo: recuadro de selección (la vista se mueve con Espacio, la rueda o el botón central)
        drag = { t: 'marquee', a: p, add: multi, base: multi ? selected() : [], moved: false };
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
      if (!inside(sel, m)) { const hit = hitLayer(p); if (hit && hit !== sel) { select(hit); drag = { t: 'none' }; return; } }
      beginPixelEdit(sel);
      drag = { t: 'paint', last: p };
      paint(sel, p, p);
    } else if (S.mode === 'wand') {
      drag = { t: 'tap', x: p.x, y: p.y, moved: false };
    }
  });

  cv.addEventListener('pointermove', (e) => {
    const p = pos(e), sel = st.sel;
    if (e.pointerType === 'mouse' || drag?.t === 'paint') st.hover = p;
    if (!ptrs.has(e.pointerId)) {
      // solo pasar el ratón por encima: cursores y resaltado
      const prevHoverL = st.hoverL;
      if (e.pointerType === 'mouse') {
        if (S.mode === 'move') {
          const gh = st.group.length > 1 ? nearest(groupHandles(), p, 11) : null;
          if (gh) { st.hoverL = null; setCursor(groupCursor(gh.id)); if (st.hoverL !== prevHoverL) dirty(); return; }
          const h = sel && touchable(sel) && nearest(boxHandles(sel, true), p, 11);
          st.hoverL = h ? null : hitLayer(p, false);
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
      if ((st.altDown || st.measureMode) && e.pointerType === 'mouse') refreshMeasure(p);
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
        syncSel();
      } else if (gest.mode === 'group') {
        // pellizco sobre el grupo: mover, escalar y girar todas alrededor de los dedos
        commitPending();
        const d = ((n.a - gest.a) * 180) / Math.PI;
        for (const l of st.group) {
          l.cx += pv.x - pp.x; l.cy += pv.y - pp.y;
          scaleLayer(l, n.d / gest.d, pv); rotateLayer(l, d, pv); markManual(l);
        }
        syncSel();
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
      case 'pan': panBy(p.x - drag.last.x, p.y - drag.last.y); drag.last = p; break;
      case 'move': {
        let d = drag;
        if (d.altAt) {
          if (Math.hypot(p.x - d.altAt.x, p.y - d.altAt.y) < 4) break; // aún no es un arrastre
          const originals = selected();
          snap(); cloneSelectedInPlace();
          d = drag = startMove(d.m0, originals); // ahora se mueven las copias y las originales son referencia del imán
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
          setGuides(at(dx, dy), c, lockX || useEx ? null : s.gx, lockY || useEy ? null : s.gy);
          const eq = [...(useEx ? ex!.gaps : []), ...(useEy ? ey!.gaps : [])];
          if (eq.length) st.gaps = eq;
        }
        for (const it of d.items) { it.l.cx = it.x + dx; it.l.cy = it.y + dy; markManual(it.l); }
        lastDragPt = p;
        if (e.altKey || st.altDown) measureDuring(d, p); else st.measure = null;
        syncSel(); break;
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
        }
        for (const it of drag.items) { restoreGeom(it.l, it.g); scaleLayer(it.l, f, P); markManual(it.l); }
        if (edgeCtx && gsnap) setGuides(unionBox(drag.items.map((it) => bboxMM(it.l))), edgeCtx.ctx, gsnap.gx, gsnap.gy);
        lastDragPt = p;
        if (e.altKey || st.altDown) measureDuring(drag, p); else st.measure = null;
        syncSel(); break;
      }
      case 'grot': {
        commitPending();
        let d = ((Math.atan2(m.y - drag.pivot.y, m.x - drag.pivot.x) - drag.a0) * 180) / Math.PI;
        if (e.shiftKey) d = Math.round(d / 15) * 15;
        for (const it of drag.items) { restoreGeom(it.l, it.g); rotateLayer(it.l, d, drag.pivot); markManual(it.l); }
        const pivot = drag.pivot;
        st.groupFrame = drag.frame0.map((q) => rotPt(q, pivot, d));
        syncSel(); break;
      }
      case 'marquee': {
        if (!drag.moved && Math.hypot(p.x - drag.a.x, p.y - drag.a.y) < 4) break;
        drag.moved = true;
        st.marquee = { a: drag.a, b: p };
        // la selección se actualiza en vivo, solo cuando cambia
        const next = [...new Set([...drag.base, ...inMarquee(drag.a, p)])], cur = selected();
        if (next.length !== cur.length || next.some((l) => !cur.includes(l))) selectMany(next);
        break;
      }
      case 'scale': {
        if (!sel) break;
        commitPending(); markManual(sel);
        const d = drag;
        applyScale(sel, d, m, e.shiftKey, e.altKey);
        edgeHelpers(e, sel, m, (mm) => applyScale(sel, d, mm, e.shiftKey, e.altKey), { id: d.id, alt: e.altKey });
        lastDragPt = p;
        if (e.altKey || st.altDown) measureDuring(d, p); else st.measure = null;
        syncSel(); break;
      }
      case 'rot': {
        if (!sel) break;
        commitPending();
        markManual(sel);
        let r = drag.r0 + ((Math.atan2(m.y - drag.cc.y, m.x - drag.cc.x) - drag.a0) * 180) / Math.PI;
        if (e.shiftKey) r = Math.round(r / 15) * 15;
        else { const q = Math.round(r / 90) * 90; if (Math.abs(r - q) < 3) r = q; } // imán a 0/90/180/270
        rotateLayer(sel, normDeg(r - sel.rot), drag.cc);
        syncSel(); break;
      }
      case 'crop': {
        if (!sel) break;
        const d = drag;
        applyCropDrag(sel, d, m, e.shiftKey, e.altKey, S.cropRatio);
        edgeHelpers(e, sel, m, (mm) => applyCropDrag(sel, d, mm, e.shiftKey, e.altKey, S.cropRatio));
        break;
      }
      case 'frame': {
        if (!sel) break;
        let dx = m.x - drag.m0.x, dy = m.y - drag.m0.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        panInFrame(sel, drag.start, { x: dx, y: dy });
        break;
      }
      case 'paint': if (sel) { paint(sel, drag.last, p); drag.last = p; } break;
      case 'tap': if (Math.hypot(p.x - drag.x, p.y - drag.y) > 6) drag.moved = true; break;
    }
    dirty();
  });

  const endPtr = (e: PointerEvent) => {
    clearLP();
    if (!ptrs.has(e.pointerId)) return;
    const p = pos(e), sel = st.sel;
    if (drag?.t === 'marquee') { st.marquee = null; if (drag.moved) cv.style.cursor = 'default'; }
    if (drag?.t === 'tap' && !drag.moved && e.type === 'pointerup') {
      if (sel && inside(sel, s2mm(p))) wandAt(p);
      else { const hit = hitLayer(p); if (hit) select(hit); else setMode('move'); }
    }
    if ((drag && ['paint', 'scale', 'crop', 'frame', 'move', 'rot', 'gscale', 'grot'].includes(drag.t)) || gest?.mode === 'layer' || gest?.mode === 'group') {
      renderList(); syncSel(); scheduleSave();
    }
    // al soltar el giro, el marco vuelve a ser la caja común (alineada con la pantalla)
    if (drag?.t === 'grot') st.groupFrame = null;
    edgeCtx = null;
    clearHelpers(); // imanes y medidas solo durante el gesto
    if (measurable(drag)) { lastDragPt = null; stopMeasure(); if (st.altDown && e.pointerType === 'mouse') refreshMeasure(p); }
    if (drag?.t === 'frame' && e.pointerType === 'mouse') cv.style.cursor = 'grab';
    ptrs.delete(e.pointerId);
    if (ptrs.size < 2) { if (gest) renderList(); gest = null; }
    drag = null; setPending(null);
    if (ptrs.size === 0 && e.pointerType !== 'mouse') st.hover = null;
    if (S.mode === 'move' && e.pointerType === 'mouse') cv.style.cursor = st.sel && inside(st.sel, s2mm(p)) ? 'move' : 'default';
    dirty();
  };
  cv.addEventListener('pointerup', endPtr);
  cv.addEventListener('pointercancel', endPtr);
  cv.addEventListener('pointerleave', (e) => {
    if (e.pointerType !== 'mouse' || ptrs.size) return;
    const had = !!st.hoverL || S.mode === 'erase' || st.hoverBand;
    st.hover = null; st.hoverL = null; st.hoverBand = false;
    if (had) dirty();
  });

  /* rueda del ratón = zoom; dos dedos en el trackpad = mover la vista; pellizco en el trackpad (llega con ctrlKey) = zoom */
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
    clearHelpers(); // al hacer zoom o mover la vista, las ayudas se quitan hasta el siguiente movimiento
    closeMenu();
    const p = pos(e), m = s2mm(p), sel = st.sel;
    const zoom = e.ctrlKey || e.metaKey || e.deltaMode !== 0 || (e.deltaX === 0 && Number.isInteger(e.deltaY) && Math.abs(e.deltaY) >= 50);
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015));
    // al recortar, la rueda (o el pellizco del trackpad) sobre la imagen la amplía dentro del marco fijo
    if (zoom && S.mode === 'crop' && sel && insideImage(sel, m)) { zoomInFrame(sel, f, m); dirty(); return; }
    if (zoom) zoomAt(p.x, p.y, f);
    else panBy(-e.deltaX, -e.deltaY);
  }, { passive: false });

  cv.addEventListener('dblclick', (e) => {
    const h = hitLayer(pos(e));
    if (!h) return;
    if (S.mode === 'crop') { applyCrop(); return; }
    // doble clic sobre un grupo seleccionado: un nivel más adentro (su subgrupo o la imagen); sobre una sola, recorta
    if (st.group.includes(h) && selectedGroup() != null) { enterGroup(h); return; }
    select(h); enterCrop();
  });
  cv.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (lastPointerType() !== 'mouse') return; // en táctil el menú lo abre "mantener pulsado"
    const h = hitLayer(pos(e));
    if (S.mode === 'crop') applyCrop();
    if (h) openMenu(e.clientX, e.clientY, menuFor(h));
    else { if (selected().length) select(null); openMenu(e.clientX, e.clientY, emptyMenu()); }
  });
}
