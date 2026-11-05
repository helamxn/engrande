/** Ratón, táctil y lápiz sobre el lienzo: seleccionar, mover, escalar, girar, recortar, pintar y gestos. */
import {
  applyCrop, beginPixelEdit, cloneSelectedInPlace, enterCrop, isSelected, markManual, paint, select, selected, selectMany,
  setMode, toggleInSelection, wandAt,
} from '../actions';
import {
  applyCropDrag, applyScale, bboxMM, boxInside, cropCenter, inside, insideImage, mmToLocal, normDeg, panInFrame,
  rotateLayer, scaleLayer, startScale, zoomInFrame,
} from '../geometry';
import { commitPending, setPending, snap, takeSnap, undo } from '../history';
import { scheduleSave } from '../io/persist';
import { lastPointerType, setLastPointer } from '../platform';
import { boxHandles, dirty, groupCorner, groupCursor, groupFrameMM, groupHandles, handleCursor, nearest } from '../render';
import { S, st, V } from '../state';
import { panBy, s2mm, zoomAt } from '../view';
import { closeMenu, emptyMenu, groupMenu, layerMenu, openMenu } from '../ui/menu';
import { renderList, syncSel } from '../ui/panel';
import type { CropDrag, Layer, LayerGeom, Pt, ScaleDrag } from '../types';

type Drag =
  | { t: 'none' }
  | { t: 'pan'; last: Pt }
  /** Mover la imagen o todas las seleccionadas: posición inicial de cada una. */
  | { t: 'move'; m0: Pt; items: { l: Layer; x: number; y: number }[] }
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
const startMove = (m: Pt): Drag => ({ t: 'move', m0: m, items: selected().map((l) => ({ l, x: l.cx, y: l.cy })) });

/** Imágenes visibles que caben enteras en el recuadro (como en Excalidraw: así un fondo grande no se cuela). */
function inMarquee(a: Pt, b: Pt): Layer[] {
  const p = s2mm(a), q = s2mm(b);
  const box = { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) };
  return st.layers.filter((l) => touchable(l) && boxInside(bboxMM(l), box));
}
/** Menú de una imagen: si forma parte de un grupo, el del grupo; si no, se selecciona sola. */
function menuFor(h: Layer) {
  if (st.group.length > 1 && st.group.includes(h)) return groupMenu();
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
          else { const i = groupCorner(h.id); drag = { t: 'gscale', corner: fr[i]!, opp: fr[(i + 2) % 4]!, center, items }; }
          return;
        }
      }
      if (sel && touchable(sel)) {
        const h = nearest(boxHandles(sel, true), p, R);
        if (h) {
          setPending(takeSnap());
          const cc = cropCenter(sel);
          drag = h.id === 'rot' ? { t: 'rot', cc, a0: Math.atan2(m.y - cc.y, m.x - cc.x), r0: sel.rot } : startScale(sel, h.id);
          return;
        }
      }
      const hit = hitLayer(p), multi = e.shiftKey || e.ctrlKey || e.metaKey;
      if (hit && multi) {
        // Shift o Ctrl + clic: añade o quita; si queda seleccionada, se puede arrastrar todo junto
        toggleInSelection(hit);
        if (isSelected(hit)) { setPending(takeSnap()); drag = startMove(m); } else drag = { t: 'none' };
      } else if (hit) {
        if (!isSelected(hit)) select(hit);
        if (e.altKey) { snap(); cloneSelectedInPlace(); } // Alt + arrastrar: mueve una copia
        else setPending(takeSnap());
        drag = startMove(m);
        cv.style.cursor = 'grabbing';
      } else if (e.pointerType !== 'touch') {
        // ratón o lápiz sobre el fondo: recuadro de selección (la vista se mueve con Espacio, la rueda o el botón central)
        drag = { t: 'marquee', a: p, add: multi, base: multi ? selected() : [], moved: false };
        if (!multi && selected().length) select(null);
      } else { if (selected().length) select(null); drag = { t: 'pan', last: p }; }
    } else if (S.mode === 'crop' && sel) {
      const h = nearest(boxHandles(sel, false), p, R);
      if (h && h.id !== 'rot') { drag = { t: 'crop', id: h.id, k0: { ...sel.crop }, ratio0: (sel.w * (sel.crop.x1 - sel.crop.x0)) / (sel.h * (sel.crop.y1 - sel.crop.y0)) }; return; }
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
        } else if (S.mode === 'crop' && sel) {
          const h = nearest(boxHandles(sel, false), p, 11);
          setCursor(h ? handleCursor(sel, h.id) : insideImage(sel, s2mm(p)) ? 'grab' : 'default');
        }
      }
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
        commitPending();
        let dx = m.x - drag.m0.x, dy = m.y - drag.m0.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        for (const it of drag.items) { it.l.cx = it.x + dx; it.l.cy = it.y + dy; markManual(it.l); }
        syncSel(); break;
      }
      case 'gscale': {
        commitPending();
        // Alt: desde el centro; si no, la esquina opuesta queda fija. Siempre sin deformar.
        const P = e.altKey ? drag.center : drag.opp;
        const vx = drag.corner.x - P.x, vy = drag.corner.y - P.y, L2 = vx * vx + vy * vy || 1;
        const f = Math.max(0.05, ((m.x - P.x) * vx + (m.y - P.y) * vy) / L2);
        for (const it of drag.items) { restoreGeom(it.l, it.g); scaleLayer(it.l, f, P); markManual(it.l); }
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
      case 'scale': if (sel) { commitPending(); markManual(sel); applyScale(sel, drag, m, e.shiftKey, e.altKey); syncSel(); } break;
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
      case 'crop': if (sel) applyCropDrag(sel, drag, m, e.shiftKey, e.altKey, S.cropRatio); break;
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
    const had = !!st.hoverL || S.mode === 'erase';
    st.hover = null; st.hoverL = null;
    if (had) dirty();
  });

  /* rueda del ratón = zoom; dos dedos en el trackpad = mover la vista; pellizco en el trackpad (llega con ctrlKey) = zoom */
  cv.addEventListener('wheel', (e) => {
    e.preventDefault();
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
