/** Ratón, táctil y lápiz sobre el lienzo: seleccionar, mover, escalar, girar, recortar, pintar y gestos. */
import {
  applyCrop, beginPixelEdit, cloneLayer, enterCrop, markManual, paint, select, setMode, wandAt,
} from '../actions';
import {
  applyCropDrag, applyScale, cropCenter, inside, insideImage, mmToLocal, normDeg, panInFrame, rotateLayer, scaleLayer,
  startScale, zoomInFrame,
} from '../geometry';
import { commitPending, setPending, snap, takeSnap, undo } from '../history';
import { lastPointerType, setLastPointer } from '../platform';
import { boxHandles, dirty, handleCursor, nearest } from '../render';
import { S, st, V } from '../state';
import { panBy, s2mm, zoomAt } from '../view';
import { closeMenu, emptyMenu, layerMenu, openMenu } from '../ui/menu';
import { renderList, syncSel } from '../ui/panel';
import type { CropDrag, Layer, LayerGeom, Pt, ScaleDrag } from '../types';

type Drag =
  | { t: 'none' }
  | { t: 'pan'; last: Pt }
  | { t: 'move'; m0: Pt; c0: Pt }
  | { t: 'rot'; cc: Pt; a0: number; r0: number }
  /** Recortar: la imagen se arrastra bajo el marco de recorte, que queda fijo. */
  | { t: 'frame'; m0: Pt; start: LayerGeom }
  | { t: 'paint'; last: Pt }
  | { t: 'tap'; x: number; y: number; moved: boolean }
  | ScaleDrag
  | CropDrag;

/** Pellizco con dos dedos: zoom de la vista, transformar la imagen o (al recortar) encuadrarla en el marco. */
interface Gesture { cx: number; cy: number; d: number; a: number; mode: 'view' | 'layer' | 'frame' }

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

/** Imagen bajo el punto. precise: ignora las zonas transparentes (salvo de la seleccionada). */
function hitLayer(p: Pt, precise = true): Layer | null {
  const m = s2mm(p), L = st.layers;
  if (!precise) { for (let i = L.length - 1; i >= 0; i--) if (inside(L[i]!, m)) return L[i]!; return null; }
  for (let i = L.length - 1; i >= 0; i--) { const l = L[i]!; if (inside(l, m) && opaqueAt(l, m)) return l; }
  if (st.sel && inside(st.sel, m)) return st.sel;
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

export function initPointer(cv: HTMLCanvasElement) {
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
      const mode = !sel ? 'view'
        : S.mode === 'move' && inside(sel, c0) ? 'layer'
          : S.mode === 'crop' && insideImage(sel, c0) ? 'frame' : 'view';
      gest = { ...g0, mode };
      setPending(mode === 'layer' ? takeSnap() : null);
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
        if (h && h !== st.sel) select(h);
        if (!h && st.sel) select(null);
        const r = cv.getBoundingClientRect();
        openMenu(r.left + p.x, r.top + p.y, h ? layerMenu(h) : emptyMenu());
        dirty();
      }, 550);
    }
    const m = s2mm(p), sel = st.sel;
    if (e.button === 1 || spaceDown) { drag = { t: 'pan', last: p }; return; }

    if (S.mode === 'move') {
      if (sel) {
        const h = nearest(boxHandles(sel, true), p, R);
        if (h) {
          setPending(takeSnap());
          const cc = cropCenter(sel);
          drag = h.id === 'rot' ? { t: 'rot', cc, a0: Math.atan2(m.y - cc.y, m.x - cc.x), r0: sel.rot } : startScale(sel, h.id);
          return;
        }
      }
      const hit = hitLayer(p);
      if (hit) {
        let target = hit;
        if (e.altKey) {
          snap();
          target = cloneLayer(hit, { name: hit.name + ' (copia)' });
          st.layers.splice(st.layers.indexOf(hit) + 1, 0, target);
          select(target);
        } else { if (hit !== sel) select(hit); setPending(takeSnap()); }
        drag = { t: 'move', m0: m, c0: { x: target.cx, y: target.cy } };
        cv.style.cursor = 'grabbing';
      } else { if (sel) select(null); drag = { t: 'pan', last: p }; }
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
      if (e.pointerType === 'mouse') {
        if (S.mode === 'move') {
          const h = sel && nearest(boxHandles(sel, true), p, 11);
          st.hoverL = h ? null : hitLayer(p, false);
          cv.style.cursor = h && sel ? handleCursor(sel, h.id) : st.hoverL ? (e.altKey ? 'copy' : 'move') : 'default';
        } else if (S.mode === 'crop' && sel) {
          const h = nearest(boxHandles(sel, false), p, 11);
          cv.style.cursor = h ? handleCursor(sel, h.id) : insideImage(sel, s2mm(p)) ? 'grab' : 'default';
        }
      }
      dirty();
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
        if (!sel) break;
        commitPending();
        markManual(sel);
        let dx = m.x - drag.m0.x, dy = m.y - drag.m0.y;
        if (e.shiftKey) { if (Math.abs(dx) > Math.abs(dy)) dy = 0; else dx = 0; }
        sel.cx = drag.c0.x + dx; sel.cy = drag.c0.y + dy;
        syncSel(); break;
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
    if (drag?.t === 'tap' && !drag.moved && e.type === 'pointerup') {
      if (sel && inside(sel, s2mm(p))) wandAt(p);
      else { const hit = hitLayer(p); if (hit) select(hit); else setMode('move'); }
    }
    if (drag && ['paint', 'scale', 'crop', 'frame', 'move', 'rot'].includes(drag.t)) { renderList(); syncSel(); }
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
  cv.addEventListener('pointerleave', (e) => { if (e.pointerType === 'mouse' && !ptrs.size) { st.hover = null; st.hoverL = null; dirty(); } });

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
    if (h) { if (h !== st.sel) select(h); openMenu(e.clientX, e.clientY, layerMenu(h)); }
    else { if (st.sel) select(null); openMenu(e.clientX, e.clientY, emptyMenu()); }
  });
}
