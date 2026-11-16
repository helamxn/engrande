/** Vista del lienzo: conversión pantalla ↔ mm, zoom, encuadre y tamaño. */
import { clamp, contentBox } from './geometry';
import { dockMQ } from './platform';
import { posterGeo, sheetsVisible, st, V, view } from './state';
import { dirty } from './render';
import type { Pt } from './types';

export const s2mm = (p: Pt): Pt => ({ x: (p.x - V.ox) / V.k, y: (p.y - V.oy) / V.k });
export const mm2s = (p: Pt): Pt => ({ x: p.x * V.k + V.ox, y: p.y * V.k + V.oy });

/** Zona del lienzo (px) dentro de unos márgenes. */
function area(ins: typeof view.ins) {
  const { CW, CH } = view;
  return { x: ins.l, y: ins.t, w: Math.max(1, CW - ins.l - ins.r), h: Math.max(1, CH - ins.t - ins.b) };
}
/** Lo que se ve ahora del lienzo (sin lo que tapan islas y paneles): p. ej., dónde aparece un texto nuevo. */
export const freeArea = () => area(view.ins);

/** Lo que se encaja al ver todo (mm): el papel y, si se muestra, la persona de referencia. */
const content = () => contentBox(posterGeo(), st.scaleRef && sheetsVisible());

/**
 * Encaja el póster entero en la zona libre de lo fijo (view.fit): el panel de la selección y el panel inferior
 * abierto van encima, así que abrirlos o cerrarlos no cambia el encuadre.
 */
export function fitView() {
  const f = area(view.fit), framed = view.fit.t > 0;
  // con islas alrededor el margen ya lo dan ellas: basta un respiro menor
  const pad = f.w < 500 ? 18 : framed ? 28 : 40;
  // abajo, el hueco para la etiqueta de tamaño de la selección, que va bajo ella
  const padB = pad + 8;
  // se encaja el papel entero (el póster y su margen sin imprimir alrededor) y la persona de referencia, si está
  const b = content(), PW = b.x1 - b.x0, PH = b.y1 - b.y0;
  V.k = Math.max(0.01, Math.min((f.w - 2 * pad) / PW, (f.h - pad - padB) / PH));
  V.ox = f.x + (f.w - PW * V.k) / 2 - b.x0 * V.k;
  V.oy = f.y + pad + (f.h - pad - padB - PH * V.k) / 2 - b.y0 * V.k;
  V.fitted = true;
  syncZoomLabel();
  dirty();
}

export function zoomAt(sx: number, sy: number, f: number) {
  const b = content(), a = freeArea(), base = Math.min((a.w - 36) / (b.x1 - b.x0), (a.h - 36) / (b.y1 - b.y0));
  const nk = clamp(V.k * f, base * 0.3, base * 25);
  const r = nk / V.k;
  V.ox = sx - (sx - V.ox) * r; V.oy = sy - (sy - V.oy) * r; V.k = nk; V.fitted = false;
  syncZoomLabel();
  dirty();
}
/** Zoom desde el centro de la zona libre (botones + y −, teclado). */
export const zoomCenter = (k: number) => { const f = freeArea(); zoomAt(f.x + f.w / 2, f.y + f.h / 2, k); };

/** Zoom en porcentaje: 100 % = tamaño real aproximado en pantalla (96 px CSS por pulgada, el estándar web). */
export const zoomPercent = () => Math.round(((V.k * 25.4) / 96) * 100);
let shownPct = -1;
/** Actualiza el porcentaje de la barra, solo si cambió (al encajar y al hacer zoom). */
export function syncZoomLabel() {
  const p = zoomPercent();
  if (p === shownPct) return;
  shownPct = p;
  const el = document.querySelector('#zoomPct');
  if (el) el.textContent = p + '%';
}

export function panBy(dx: number, dy: number) {
  V.ox += dx; V.oy += dy; V.fitted = false;
  dirty();
}

const same = (a: typeof view.ins, b: typeof view.ins) => a.t === b.t && a.r === b.r && a.b === b.b && a.l === b.l;
/**
 * Márgenes nuevos. El lienzo solo se reencaja si cambió lo fijo (fit: la ventana, la cabecera, la barra…) y el
 * póster estaba encajado; si solo se abrió o cerró un panel (ins), el póster no se mueve.
 */
export function setInsets(ins: typeof view.ins, fit: typeof view.fit) {
  const fitChanged = !same(view.fit, fit);
  if (!fitChanged && same(view.ins, ins)) return;
  view.ins = ins; view.fit = fit;
  if (fitChanged && V.fitted) fitView(); else dirty();
}

export function resize(stage: HTMLElement, cv: HTMLCanvasElement) {
  const r = stage.getBoundingClientRect();
  view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  view.CW = r.width; view.CH = r.height;
  cv.width = Math.round(view.CW * view.dpr); cv.height = Math.round(view.CH * view.dpr);
  if (V.fitted) fitView(); else dirty();
}
