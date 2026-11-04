/** Vista del lienzo: conversión pantalla ↔ mm, zoom, encuadre y tamaño. */
import { clamp } from './geometry';
import { dockMQ } from './platform';
import { posterGeo, V, view } from './state';
import { dirty } from './render';
import type { Pt } from './types';

export const s2mm = (p: Pt): Pt => ({ x: (p.x - V.ox) / V.k, y: (p.y - V.oy) / V.k });
export const mm2s = (p: Pt): Pt => ({ x: p.x * V.k + V.ox, y: p.y * V.k + V.oy });

/** Zona libre del lienzo (px): lo que no tapan las islas ni la barra acoplada (móvil). */
export function freeArea() {
  const { CW, CH, ins } = view, bottom = ins.b + (dockMQ?.matches ? 64 : 0);
  return { x: ins.l, y: ins.t, w: Math.max(1, CW - ins.l - ins.r), h: Math.max(1, CH - ins.t - bottom) };
}

/** Encaja el póster entero en la zona libre. */
export function fitView() {
  const g = posterGeo(), f = freeArea(), framed = view.ins.t > 0;
  // con islas alrededor el margen ya lo dan ellas: basta un respiro menor
  const pad = f.w < 500 ? 18 : framed ? 28 : 40;
  // abajo, además, el hueco de la pista (#hint) para que no tape la etiqueta de tamaño; acoplada no se muestra
  const padB = pad + (dockMQ?.matches ? 0 : 26);
  V.k = Math.max(0.01, Math.min((f.w - 2 * pad) / g.W, (f.h - pad - padB) / g.H));
  V.ox = f.x + (f.w - g.W * V.k) / 2;
  V.oy = f.y + pad + (f.h - pad - padB - g.H * V.k) / 2;
  V.fitted = true;
  syncZoomLabel();
  dirty();
}

export function zoomAt(sx: number, sy: number, f: number) {
  const g = posterGeo(), a = freeArea(), base = Math.min((a.w - 36) / g.W, (a.h - 36) / g.H);
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

/** Cambian las islas (tamaño de ventana, panel plegado…): si el póster estaba encajado, se vuelve a encajar. */
export function setInsets(ins: typeof view.ins) {
  const o = view.ins;
  if (o.t === ins.t && o.r === ins.r && o.b === ins.b && o.l === ins.l) return;
  view.ins = ins;
  if (V.fitted) fitView(); else dirty();
}

export function resize(stage: HTMLElement, cv: HTMLCanvasElement) {
  const r = stage.getBoundingClientRect();
  view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  view.CW = r.width; view.CH = r.height;
  cv.width = Math.round(view.CW * view.dpr); cv.height = Math.round(view.CH * view.dpr);
  if (V.fitted) fitView(); else dirty();
}
