/** Vista del lienzo: conversión pantalla ↔ mm, zoom, encuadre y tamaño. */
import { clamp } from './geometry';
import { dockMQ } from './platform';
import { posterGeo, V, view } from './state';
import { dirty } from './render';
import type { Pt } from './types';

export const s2mm = (p: Pt): Pt => ({ x: (p.x - V.ox) / V.k, y: (p.y - V.oy) / V.k });
export const mm2s = (p: Pt): Pt => ({ x: p.x * V.k + V.ox, y: p.y * V.k + V.oy });

/** Encaja el póster entero. Deja sitio abajo para la barra acoplada (móvil). */
export function fitView() {
  const g = posterGeo(), { CW, CH } = view, pad = CW < 500 ? 18 : 40;
  const bottom = dockMQ?.matches ? 64 : 0;
  V.k = Math.min((CW - 2 * pad) / g.W, (CH - 2 * pad - bottom) / g.H);
  V.ox = (CW - g.W * V.k) / 2;
  V.oy = (CH - bottom - g.H * V.k) / 2;
  V.fitted = true;
  syncZoomLabel();
  dirty();
}

export function zoomAt(sx: number, sy: number, f: number) {
  const g = posterGeo(), base = Math.min((view.CW - 36) / g.W, (view.CH - 36) / g.H);
  const nk = clamp(V.k * f, base * 0.3, base * 25);
  const r = nk / V.k;
  V.ox = sx - (sx - V.ox) * r; V.oy = sy - (sy - V.oy) * r; V.k = nk; V.fitted = false;
  syncZoomLabel();
  dirty();
}
export const zoomCenter = (f: number) => zoomAt(view.CW / 2, view.CH / 2, f);

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

export function resize(stage: HTMLElement, cv: HTMLCanvasElement) {
  const r = stage.getBoundingClientRect();
  view.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
  view.CW = r.width; view.CH = r.height;
  cv.width = Math.round(view.CW * view.dpr); cv.height = Math.round(view.CH * view.dpr);
  if (V.fitted) fitView(); else dirty();
}
