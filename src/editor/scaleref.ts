/**
 * Escala de referencia: una persona de 1,70 m de pie junto al póster, para hacerse una idea de su tamaño real.
 * Solo se ve en el lienzo (no sale en el PDF) y se recuerda en este navegador.
 */
import { PERSON_H, personBox } from './geometry';
import { getPref, setPref } from './prefs';
import { C, posterGeo, sheetsVisible, st, V, view } from './state';
import { fitView } from './view';
import { dirty } from './render';

/**
 * Mitad derecha de la silueta (mm), de la nuca a la entrepierna, con los pies en y = 0 y el centro en x = 0.
 * Dibujo propio, con proporciones de una persona adulta de 1,70 m (la cabeza va aparte).
 */
const HALF: [number, number][] = [
  [0, -1478], [52, -1470], [58, -1425], [120, -1405], [185, -1385], [212, -1350], [222, -1270], [228, -1120],
  [236, -980], [238, -860], [240, -800], [222, -755], [200, -770], [196, -860], [192, -980], [180, -1120],
  [168, -1245], [160, -1150], [148, -1020], [160, -920], [172, -850], [165, -700], [148, -520], [138, -430],
  [128, -250], [112, -80], [120, -35], [135, -12], [132, 0], [30, 0], [32, -60], [36, -250], [40, -430],
  [32, -600], [16, -770], [0, -790],
];
/** Cabeza: elipse cuyo punto más alto queda a 1,70 m. */
const HEAD = { cy: -1590, rx: 90, ry: 110 };

let path: Path2D | null = null;
/** Contorno cerrado de la silueta, suavizado (curvas por los puntos medios). */
function personPath() {
  if (path) return path;
  const right = HALF, left = HALF.slice(1, -1).reverse().map(([x, y]) => [-x, y] as [number, number]);
  const pts = [...right, ...left];
  const mid = (a: [number, number], b: [number, number]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] as const;
  const p = new Path2D();
  const start = mid(pts[pts.length - 1]!, pts[0]!);
  p.moveTo(start[0], start[1]);
  pts.forEach((q, i) => { const m = mid(q, pts[(i + 1) % pts.length]!); p.quadraticCurveTo(q[0], q[1], m[0], m[1]); });
  p.closePath();
  p.ellipse(0, HEAD.cy, HEAD.rx, HEAD.ry, 0, 0, Math.PI * 2);
  return (path = p);
}

export const scaleRefShown = () => st.scaleRef && sheetsVisible();

/** Dibuja la persona en el lienzo (detrás del papel y de las imágenes) y su altura encima. */
export function drawScaleRef(ctx: CanvasRenderingContext2D) {
  if (!scaleRefShown()) return;
  const b = personBox(posterGeo()), { dpr } = view, cx = (b.x0 + b.x1) / 2;
  ctx.save();
  ctx.setTransform(dpr * V.k, 0, 0, dpr * V.k, dpr * (V.ox + cx * V.k), dpr * (V.oy + b.y1 * V.k));
  ctx.fillStyle = C.muted!; ctx.globalAlpha = 0.26;
  ctx.fill(personPath());
  ctx.restore();
  ctx.save();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const x = V.ox + cx * V.k, top = V.oy + (b.y1 - PERSON_H) * V.k;
  ctx.font = '500 11.5px "IBM Plex Mono", ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = C.muted!;
  ctx.fillText('1,70 m', x, top - 8);
  ctx.restore();
}

/** Botón de la isla de vista: marcado si se muestra, desactivado mientras no hay póster a la vista. */
let shownBtn: string | null = null;
export function syncScaleRefButton() {
  const btn = document.querySelector<HTMLButtonElement>('#scaleRef');
  if (!btn) return;
  const key = `${st.scaleRef}|${sheetsVisible()}`;
  if (key === shownBtn) return;
  shownBtn = key;
  btn.setAttribute('aria-pressed', String(st.scaleRef));
  btn.disabled = !sheetsVisible();
}

export function toggleScaleRef(on = !st.scaleRef) {
  st.scaleRef = on;
  setPref('scaleRef', on ? '1' : '0');
  syncScaleRefButton();
  // al mostrarla se encuadra todo, para que se vea entera junto al póster; al quitarla, solo si ya estaba encajado
  if (on || V.fitted) fitView(); else dirty();
}

export const initScaleRef = () => { st.scaleRef = getPref('scaleRef') === '1'; syncScaleRefButton(); };
