/**
 * Geometría pura (sin DOM): conversiones mm ↔ coordenadas locales de la imagen, recorte, escalado y ajuste.
 * Todo está en milímetros del póster; las coordenadas locales (u, v) van de 0 a 1 sobre la imagen completa.
 */
import { PAPERS } from './constants';
import type { Crop, CropDrag, Fit, FitMode, Geo, HandleId, LayerGeom, Pt, ScaleDrag, Settings, Source, Transform, UV } from './types';

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const rad = (d: number) => (d * Math.PI) / 180;
/** Normaliza un ángulo a (-180, 180]. */
export const normDeg = (d: number) => {
  const n = (((d + 180) % 360) + 360) % 360 - 180;
  return n === -180 ? 180 : n;
};
/**
 * Número de la hoja de la fila r y la columna c (desde 0): 1, 2, 3… de izquierda a derecha y de arriba abajo, el
 * mismo orden en que salen del PDF. Antes eran A1, B2…, que se confundían con los tamaños de papel (A1, A2) y se
 * leían al revés que una celda de Excel (B4 = columna B).
 */
export const sheetNo = (r: number, c: number, cols: number) => r * cols + c + 1;

export function geo(s: Pick<Settings, 'paper' | 'orient' | 'cols' | 'rows' | 'margin' | 'overlap'>): Geo {
  let [pw, ph] = PAPERS[s.paper];
  if (s.orient === 'landscape') [pw, ph] = [ph, pw];
  const m = Math.min(s.margin, pw / 4);
  const tw = pw - 2 * m, th = ph - 2 * m;
  const ov = Math.min(s.overlap, tw / 3, th / 3);
  return { pw, ph, m, tw, th, ov, W: s.cols * tw - (s.cols - 1) * ov, H: s.rows * th - (s.rows - 1) * ov };
}

/* ---------- coordenadas locales ---------- */
export function localToMM(l: Transform, u: number, v: number): Pt {
  let x = (u - 0.5) * l.w, y = (v - 0.5) * l.h;
  if (l.flipX) x = -x;
  if (l.flipY) y = -y;
  const a = rad(l.rot), c = Math.cos(a), s = Math.sin(a);
  return { x: l.cx + x * c - y * s, y: l.cy + x * s + y * c };
}
/** Pasa un vector del póster a los ejes de la imagen (deshace giro y espejo). */
export function toAxes(l: Transform, d: Pt): Pt {
  const a = rad(l.rot), c = Math.cos(a), s = Math.sin(a);
  let x = d.x * c + d.y * s, y = -d.x * s + d.y * c;
  if (l.flipX) x = -x;
  if (l.flipY) y = -y;
  return { x, y };
}
export function mmToLocal(l: Transform, p: Pt): UV {
  const q = toAxes(l, { x: p.x - l.cx, y: p.y - l.cy });
  return { u: q.x / l.w + 0.5, v: q.y / l.h + 0.5 };
}
/** Mueve la imagen para que su punto local (u, v) quede en P. */
export function placeLocal(l: Transform, u: number, v: number, P: Pt) {
  l.cx = 0; l.cy = 0;
  const q = localToMM(l, u, v);
  l.cx = P.x - q.x; l.cy = P.y - q.y;
}

export const cropMid = (l: LayerGeom): [number, number] => [(l.crop.x0 + l.crop.x1) / 2, (l.crop.y0 + l.crop.y1) / 2];
export const cropCenter = (l: LayerGeom) => localToMM(l, ...cropMid(l));
export const visW = (l: LayerGeom) => l.w * (l.crop.x1 - l.crop.x0);
export const visH = (l: LayerGeom) => l.h * (l.crop.y1 - l.crop.y0);
export const natRatio = (l: LayerGeom) => l.img.height / l.img.width;

export function scaleLayer(l: Transform, f: number, p: Pt) {
  l.cx = p.x + (l.cx - p.x) * f; l.cy = p.y + (l.cy - p.y) * f; l.w *= f; l.h *= f;
}
export function rotateLayer(l: Transform, d: number, p: Pt) {
  const a = rad(d), c = Math.cos(a), s = Math.sin(a), dx = l.cx - p.x, dy = l.cy - p.y;
  l.cx = p.x + dx * c - dy * s; l.cy = p.y + dx * s + dy * c; l.rot = normDeg(l.rot + d);
}
/** Ejecuta fn y vuelve a dejar el centro de la zona visible donde estaba. */
export function keepCenter<L extends LayerGeom>(l: L, fn: (l: L) => void) {
  const P = cropCenter(l);
  fn(l);
  placeLocal(l, ...cropMid(l), P);
}
export function cropPtsMM(l: LayerGeom): Pt[] {
  const k = l.crop;
  return ([[k.x0, k.y0], [k.x1, k.y0], [k.x1, k.y1], [k.x0, k.y1]] as const).map(([u, v]) => localToMM(l, u, v));
}
export function bboxMM(l: LayerGeom): Box {
  const p = cropPtsMM(l), xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}

/* ---------- rejilla del fondo ---------- */
/** Separaciones de la rejilla en mm: 1 cm, 5 cm, 10 cm, 50 cm, 1 m, 5 m, 10 m (cada una divide a la siguiente). */
export const GRID_STEPS = [10, 50, 100, 500, 1000, 5000, 10000];
const GRID_FADE: readonly [number, number] = [6, 36];
/**
 * Niveles de la rejilla visibles con la escala k (px por mm) y su opacidad 0..1. Cada nivel aparece poco a poco
 * según crece su separación en pantalla (de 6 a 36 px), así que al hacer zoom las líneas finas se desvanecen
 * o aparecen sin saltos, y las de 5 y 10 cm quedan más marcadas que las de 1 cm.
 */
export function gridLevels(k: number): { step: number; alpha: number }[] {
  const [a, b] = GRID_FADE;
  return GRID_STEPS.map((step) => {
    const t = Math.min(1, Math.max(0, (step * k - a) / (b - a)));
    return { step, alpha: t * t * (3 - 2 * t) };
  }).filter((g) => g.alpha > 0.01);
}

/* ---------- imanes al mover ---------- */
/** Líneas a las que se pega lo que se mueve: bordes y centros (mm), en x y en y; px y py, solo las del póster. */
export interface SnapTargets { x: number[]; y: number[]; px: number[]; py: number[] }
/** Bordes y centro de una caja. */
const lines = (a: number, b: number) => [a, (a + b) / 2, b];
/** Dos medidas en mm son la misma (por debajo de esto solo hay ruido de decimales). */
const EPS = 1e-6;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;
/** Bordes y centro del póster y de cada caja (las demás imágenes). */
export function snapTargets(W: number, H: number, boxes: Box[]): SnapTargets {
  const px = lines(0, W), py = lines(0, H), x = [...px], y = [...py];
  for (const b of boxes) { x.push(...lines(b.x0, b.x1)); y.push(...lines(b.y0, b.y1)); }
  return { x, y, px, py };
}
/**
 * El ajuste de un eje al mover: el más corto que deja algún borde o el centro (own) sobre una línea. Si hay
 * empate (p. ej. dos imágenes del mismo ancho: izquierda, centro y derecha quedan a la misma distancia), gana, en
 * este orden: el que alinea más líneas, el que pega a una imagen antes que al póster y un borde antes que el centro.
 * Así el resultado no depende de los decimales ni del orden de las imágenes.
 */
function bestShift(own: number[], all: number[], poster: number[], tol: number) {
  type C = { d: number; g: number; n: number; img: boolean; edge: boolean };
  let best: C | null = null;
  const better = (a: C, b: C) =>
    !same(Math.abs(a.d), Math.abs(b.d)) ? Math.abs(a.d) < Math.abs(b.d)
      : a.n !== b.n ? a.n > b.n : a.img !== b.img ? a.img : a.edge !== b.edge ? a.edge : false;
  const count = (arr: number[], v: number) => arr.filter((w) => same(w, v)).length;
  own.forEach((o, i) => {
    for (const v of all) {
      const d = v - o;
      if (Math.abs(d) > tol) continue;
      // img: la línea es de alguna imagen (no solo del póster)
      const c: C = { d, g: v, n: own.filter((q) => all.some((w) => same(q + d, w))).length, img: count(all, v) > count(poster, v), edge: i !== 1 };
      if (!best || better(c, best)) best = c;
    }
  });
  return best as C | null;
}
/**
 * Imán: si algún borde o el centro de la caja que se mueve queda a menos de tol (mm) de una línea, devuelve cuánto
 * desplazarla para que coincida (en cada eje por separado) y la línea; las guías salen luego de todo lo que coincide.
 */
export function snapBox(b: Box, t: SnapTargets, tol: number): { dx: number; dy: number; gx: number | null; gy: number | null } {
  const sx = bestShift(lines(b.x0, b.x1), t.x, t.px, tol), sy = bestShift(lines(b.y0, b.y1), t.y, t.py, tol);
  return { dx: sx?.d ?? 0, dy: sy?.d ?? 0, gx: sx?.g ?? null, gy: sy?.g ?? null };
}
/**
 * Flechas: un paso d (mm) en un eje que no se salta ninguna línea del imán. Si por el camino un borde o el centro de
 * b cruzaría una (borde o centro del póster o de otra imagen), se para justo en ella; la siguiente pulsación sigue.
 * Así se puede alinear con exactitud aunque la posición tenga décimas y el paso sea de 1 mm.
 */
export function stepToLines(b: Box, t: SnapTargets, axis: 'x' | 'y', d: number): number {
  if (!d) return 0;
  const own = axis === 'x' ? lines(b.x0, b.x1) : lines(b.y0, b.y1), all = axis === 'x' ? t.x : t.y;
  let best = d;
  for (const o of own) for (const v of all) {
    const k = v - o;
    if (Math.sign(k) === Math.sign(d) && Math.abs(k) > EPS && Math.abs(k) < Math.abs(best) - EPS) best = k;
  }
  return best;
}
/* ---------- rejilla de 1 mm ---------- */
/**
 * Las posiciones se colocan en milímetros enteros (como la rejilla de píxeles de Figma): al mover, al escalar o
 * recortar (el borde que se arrastra) y con las flechas. Así las medidas salen redondas y coinciden con lo que dicen
 * los campos del panel. Alinearse con otra imagen o con el póster tiene prioridad (puede caer en décimas, p. ej. el
 * centro de un póster Carta), y Ctrl o ⌘ la quitan junto con el imán. «Ajustar» y «Llenar» siguen siendo exactos.
 */
export const GRID_MM = 1;
/** v en la rejilla: el mm entero más cercano. */
export const onGrid = (v: number) => Math.round(v / GRID_MM) * GRID_MM;
/** Lo que hay que sumar a v para que quede en la rejilla. */
export const toGrid = (v: number) => onGrid(v) - v;
/**
 * Flechas: el paso d (±1 o ±10 mm) desde v que acaba en la rejilla. Fuera de ella, el primer paso solo llega al mm
 * entero siguiente en esa dirección (desde 13,8, ↑ lleva a 13, no a 12,8); en ella, avanza d entero.
 */
export function gridStep(v: number, d: number): number {
  if (!d) return 0;
  const r = onGrid(v), base = Math.abs(v - r) < EPS ? r : v, q = (base + d) / GRID_MM;
  return (d > 0 ? Math.floor(q + EPS) : Math.ceil(q - EPS)) * GRID_MM - v;
}
/** Bordes y centro de moving (en un eje) que coinciden con el borde o el centro de alguna de las cajas. */
export function alignedLines(moving: Box, boxes: Box[], axis: 'x' | 'y'): number[] {
  const f = (b: Box) => (axis === 'x' ? lines(b.x0, b.x1) : lines(b.y0, b.y1));
  return f(moving).filter((v) => boxes.some((b) => f(b).some((w) => same(v, w))));
}

/* ---------- medidas ---------- */
/**
 * Separación en una dirección: segmento de from a to (mm) a lo largo de su eje, dibujado a la altura at del otro eje.
 * axis 'x': horizontal (izquierda o derecha); 'y': vertical (arriba o abajo).
 */
export interface Gap { axis: 'x' | 'y'; from: number; to: number; at: number }

/**
 * Imán de bordes sueltos (al escalar o recortar): el borde que se mueve más cerca de una línea, en cada eje.
 * Devuelve el desplazamiento a aplicar a ese borde y la línea, o null si no hay ninguno a menos de tol.
 */
/**
 * Imán de tamaño (al escalar): si el ancho o el alto de b queda a menos de tol del de otra imagen, devuelve cuánto
 * cambiarlo (dw o dh) para igualarlo y con qué caja coincide. Solo en los ejes en que se mueve algún borde.
 */
export function snapSize(b: Box, moving: { x0: boolean; x1: boolean; y0: boolean; y1: boolean }, others: Box[], tol: number) {
  const best = (size: number, sizes: [number, Box][]) => {
    let d = Infinity, box: Box | null = null;
    for (const [s, o] of sizes) { const k = s - size; if (Math.abs(k) <= tol && Math.abs(k) < Math.abs(d)) { d = k; box = o; } }
    return box ? { d, box } : null;
  };
  return {
    x: moving.x0 || moving.x1 ? best(b.x1 - b.x0, others.map((o) => [o.x1 - o.x0, o])) : null,
    y: moving.y0 || moving.y1 ? best(b.y1 - b.y0, others.map((o) => [o.y1 - o.y0, o])) : null,
  };
}
/**
 * Mueve el puntero en un eje hasta que read(m) (un borde o un tamaño tras aplicar el gesto) valga goal. Al escalar
 * desde una esquina sin deformar, mover el puntero en x no mueve el borde lo mismo (la escala sigue la diagonal), así
 * que se corrige con lo que de verdad responde (secante): en un gesto lineal, dos pasos. first: primer intento.
 * null si no se alcanza (tamaño mínimo, tope del recorte…).
 */
export function solvePointer(m: Pt, axis: 'x' | 'y', read: (m: Pt) => number, goal: number, first: number): Pt | null {
  const at = (q: Pt, k: number): Pt => (axis === 'x' ? { x: k, y: q.y } : { x: q.x, y: k });
  let a = m[axis], va = read(m), b = a + first;
  for (let i = 0; i < 6; i++) {
    const vb = read(at(m, b));
    if (Math.abs(goal - vb) < 1e-6) return at(m, b);
    const r = (vb - va) / (b - a);
    if (!Number.isFinite(r) || Math.abs(r) < 1e-9) return null;
    a = b; va = vb; b += (goal - vb) / r;
  }
  return null;
}

export function snapEdges(b: Box, moving: { x0: boolean; x1: boolean; y0: boolean; y1: boolean }, t: SnapTargets, tol: number) {
  const best = (edges: number[], targets: number[]) => {
    let d = Infinity, g: number | null = null;
    for (const e of edges) for (const v of targets) { const k = v - e; if (Math.abs(k) <= tol && Math.abs(k) < Math.abs(d)) { d = k; g = v; } }
    return g === null ? null : { d, g };
  };
  return {
    x: best([...(moving.x0 ? [b.x0] : []), ...(moving.x1 ? [b.x1] : [])], t.x),
    y: best([...(moving.y0 ? [b.y0] : []), ...(moving.y1 ? [b.y1] : [])], t.y),
  };
}

/* ---------- guías, medir y separación igual (como en Figma) ---------- */
/**
 * Tramo de guía: línea en at (x si axis 'x' = vertical; y si 'y' = horizontal) de from a to, con una × en cada
 * punto de marks (los extremos de cada caja alineada). No cruza todo el lienzo: une solo lo que está alineado.
 */
export interface GuideSeg { axis: 'x' | 'y'; at: number; from: number; to: number; marks: number[] }
const feat3 = (a: number, b: number) => [a, (a + b) / 2, b];
/**
 * Tramos de las guías en x = gx y en y = gy (una o varias líneas por eje, como en Figma: con dos imágenes del mismo
 * ancho, izquierda, centro y derecha). Cada tramo abarca todas las cajas (la que se mueve incluida) con ese borde o centro.
 */
export function guideSegments(moving: Box, boxes: Box[], gx: number | number[] | null, gy: number | number[] | null): GuideSeg[] {
  const out: GuideSeg[] = [], all = [moving, ...boxes];
  const list = (g: number | number[] | null) => (g === null ? [] : Array.isArray(g) ? g : [g]);
  for (const at of list(gx)) {
    const inv = all.filter((b) => feat3(b.x0, b.x1).some((v) => same(v, at)));
    out.push({ axis: 'x', at, from: Math.min(...inv.map((b) => b.y0)), to: Math.max(...inv.map((b) => b.y1)), marks: inv.flatMap((b) => [b.y0, b.y1]) });
  }
  for (const at of list(gy)) {
    const inv = all.filter((b) => feat3(b.y0, b.y1).some((v) => same(v, at)));
    out.push({ axis: 'y', at, from: Math.min(...inv.map((b) => b.x0)), to: Math.max(...inv.map((b) => b.x1)), marks: inv.flatMap((b) => [b.x0, b.x1]) });
  }
  return out;
}

/**
 * La caja más cercana a b (distancia entre bordes), dando preferencia a las que quedan enfrente (se solapan en
 * algún eje). Para medir mientras se arrastra cuando el cursor no está sobre otra imagen.
 */
export function nearestBox(b: Box, others: Box[]): Box | null {
  const dist = (o: Box) => Math.hypot(Math.max(0, o.x0 - b.x1, b.x0 - o.x1), Math.max(0, o.y0 - b.y1, b.y0 - o.y1));
  const facing = others.filter((o) => (o.x0 < b.x1 && b.x0 < o.x1) || (o.y0 < b.y1 && b.y0 < o.y1));
  const pool = facing.length ? facing : others;
  return pool.reduce<Box | null>((a, o) => (!a || dist(o) < dist(a) ? o : a), null);
}

/** Línea discontinua de proyección (mm). */
export interface Dash { x0: number; y0: number; x1: number; y1: number }
/**
 * Medir (Alt al pasar el ratón): distancias entre la selección s y la caja t.
 * - Si no se solapan en un eje, la separación entre ellas en ese eje; si tampoco se solapan en el otro, la medida va
 *   a la altura del centro de s y una línea discontinua prolonga el borde de t hasta ella (como en Figma).
 * - Si se solapan (p. ej. t es el póster que contiene a s), la distancia entre los bordes del mismo lado.
 * container: t es el póster (contiene a lo seleccionado): se mide a sus cuatro bordes aunque se salga.
 */
export function measureBetween(s: Box, t: Box, container = false): { gaps: Gap[]; dashes: Dash[] } {
  const gaps: Gap[] = [], dashes: Dash[] = [];
  const axis = (sa0: number, sa1: number, ta0: number, ta1: number, sb0: number, sb1: number, tb0: number, tb1: number,
    mk: (from: number, to: number, at: number) => Gap, dash: (a: number, b0: number, b1: number) => Dash) => {
    const overlapB = sb0 < tb1 && tb0 < sb1, at = overlapB ? (Math.max(sb0, tb0) + Math.min(sb1, tb1)) / 2 : (sb0 + sb1) / 2;
    const proj = (edge: number) => { if (!overlapB) dashes.push(dash(edge, tb0 > at ? tb0 : tb1, at)); };
    if (ta1 <= sa0) { gaps.push(mk(ta1, sa0, at)); proj(ta1); }
    else if (ta0 >= sa1) { gaps.push(mk(sa1, ta0, at)); proj(ta0); }
    else {
      // se solapan en este eje. Si una abarca a la otra (o t es el póster), la distancia de cada lado; si se cruzan,
      // como en Figma, solo el lado en el que el borde de lo seleccionado queda dentro de t (al cruzarse, salta)
      const nested = container || (ta0 <= sa0 && sa1 <= ta1) || (sa0 <= ta0 && ta1 <= sa1);
      if (Math.abs(ta0 - sa0) > 1e-6 && (nested || sa0 > ta0)) gaps.push(mk(Math.min(ta0, sa0), Math.max(ta0, sa0), at));
      if (Math.abs(ta1 - sa1) > 1e-6 && (nested || sa1 < ta1)) gaps.push(mk(Math.min(ta1, sa1), Math.max(ta1, sa1), at));
    }
  };
  axis(s.x0, s.x1, t.x0, t.x1, s.y0, s.y1, t.y0, t.y1,
    (from, to, at) => ({ axis: 'x', from, to, at }), (a, b0, b1) => ({ x0: a, y0: b0, x1: a, y1: b1 }));
  axis(s.y0, s.y1, t.y0, t.y1, s.x0, s.x1, t.x0, t.x1,
    (from, to, at) => ({ axis: 'y', from, to, at }), (a, b0, b1) => ({ x0: b0, y0: a, x1: b1, y1: a }));
  return { gaps, dashes };
}

/**
 * Separación igual en x (al mover la caja b): si el hueco con su vecina de la izquierda o de la derecha puede igualar
 * otro hueco entre imágenes de la misma fila, o quedar centrada entre ambas vecinas, devuelve cuánto moverla (d, a
 * menos de tol) y las medidas iguales para mostrarlas. Para y se usa con las cajas traspuestas (equalSpacing).
 */
function equalSpacingX(b: Box, others: Box[], tol: number): { d: number; gaps: Gap[] } | null {
  const rowOf = (o: Box) => others.filter((x) => x !== o && x.y0 < o.y1 && o.y0 < x.y1);
  const midY = (p: Box, q: Box) => (Math.max(p.y0, q.y0) + Math.min(p.y1, q.y1)) / 2;
  // huecos de referencia: cada imagen con su vecina inmediata a la derecha en su fila
  const refs: { g: number; a: Box; n: Box }[] = [];
  for (const o of others) {
    const n = rowOf(o).filter((x) => x.x0 >= o.x1).sort((p, q) => p.x0 - q.x0)[0];
    if (n && n.x0 - o.x1 > 1e-6) refs.push({ g: n.x0 - o.x1, a: o, n });
  }
  const facing = others.filter((o) => o.y0 < b.y1 && b.y0 < o.y1);
  const L = facing.filter((o) => o.x1 <= b.x0 + tol).sort((p, q) => q.x1 - p.x1)[0];
  const R = facing.filter((o) => o.x0 >= b.x1 - tol).sort((p, q) => p.x0 - q.x0)[0];
  let best: { d: number; gaps: (d: number) => Gap[] } | null = null;
  const consider = (d: number, gaps: (d: number) => Gap[]) => { if (Math.abs(d) <= tol && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, gaps }; };
  const refGap = (r: { g: number; a: Box; n: Box }): Gap => ({ axis: 'x', from: r.a.x1, to: r.n.x0, at: midY(r.a, r.n) });
  for (const r of refs) {
    if (L && r.a !== L) consider(L.x1 + r.g - b.x0, (d) => [{ axis: 'x', from: L.x1, to: b.x0 + d, at: midY(L, b) }, refGap(r)]);
    if (R && r.n !== R) consider(R.x0 - r.g - b.x1, (d) => [{ axis: 'x', from: b.x1 + d, to: R.x0, at: midY(R, b) }, refGap(r)]);
  }
  if (L && R && R.x0 - L.x1 > b.x1 - b.x0) {
    consider((L.x1 + R.x0) / 2 - (b.x0 + b.x1) / 2, (d) => [
      { axis: 'x', from: L.x1, to: b.x0 + d, at: midY(L, b) }, { axis: 'x', from: b.x1 + d, to: R.x0, at: midY(R, b) }]);
  }
  const res = best as { d: number; gaps: (d: number) => Gap[] } | null;
  return res ? { d: res.d, gaps: res.gaps(res.d) } : null;
}
const flip = (b: Box): Box => ({ x0: b.y0, y0: b.x0, x1: b.y1, y1: b.x1 });
/** Separación igual en el eje pedido (ver equalSpacingX). */
export function equalSpacing(b: Box, others: Box[], axis: 'x' | 'y', tol: number): { d: number; gaps: Gap[] } | null {
  if (axis === 'x') return equalSpacingX(b, others, tol);
  const r = equalSpacingX(flip(b), others.map(flip), tol);
  return r && { d: r.d, gaps: r.gaps.map((g) => ({ ...g, axis: 'y' as const })) };
}

/* ---------- varias imágenes: caja común, alinear y distribuir ---------- */
export interface Box { x0: number; y0: number; x1: number; y1: number }
export type AlignEdge = 'left' | 'hcenter' | 'right' | 'top' | 'vcenter' | 'bottom';

export function unionBox(bs: Box[]): Box {
  return {
    x0: Math.min(...bs.map((b) => b.x0)), y0: Math.min(...bs.map((b) => b.y0)),
    x1: Math.max(...bs.map((b) => b.x1)), y1: Math.max(...bs.map((b) => b.y1)),
  };
}
/** La caja a está entera dentro de b (selección con recuadro). */
export const boxInside = (a: Box, b: Box) => a.x0 >= b.x0 && a.y0 >= b.y0 && a.x1 <= b.x1 && a.y1 <= b.y1;

/**
 * Desplazamiento de cada caja para alinearla con un borde o el centro de la caja de referencia
 * (por defecto, la caja común de todas, como en Figma: la que ya está en ese borde no se mueve).
 */
export function alignShifts(bs: Box[], edge: AlignEdge, to: Box = unionBox(bs)): Pt[] {
  return bs.map((b) => {
    switch (edge) {
      case 'left': return { x: to.x0 - b.x0, y: 0 };
      case 'right': return { x: to.x1 - b.x1, y: 0 };
      case 'hcenter': return { x: (to.x0 + to.x1) / 2 - (b.x0 + b.x1) / 2, y: 0 };
      case 'top': return { x: 0, y: to.y0 - b.y0 };
      case 'bottom': return { x: 0, y: to.y1 - b.y1 };
      case 'vcenter': return { x: 0, y: (to.y0 + to.y1) / 2 - (b.y0 + b.y1) / 2 };
    }
  });
}

/**
 * Reparte las cajas con el mismo espacio entre una y la siguiente (en x o en y). La primera y la última no se mueven;
 * el orden es el de su posición. Con menos de tres no hay nada que repartir.
 */
export function distributeShifts(bs: Box[], axis: 'x' | 'y'): Pt[] {
  const out = bs.map(() => ({ x: 0, y: 0 }));
  if (bs.length < 3) return out;
  const a0 = axis === 'x' ? 'x0' : 'y0', a1 = axis === 'x' ? 'x1' : 'y1';
  const order = bs.map((_, i) => i).sort((i, j) => bs[i]![a0] - bs[j]![a0] || bs[i]![a1] - bs[j]![a1]);
  const first = bs[order[0]!]!, span = Math.max(...bs.map((b) => b[a1])) - first[a0];
  const sizes = bs.reduce((s, b) => s + (b[a1] - b[a0]), 0);
  const gap = (span - sizes) / (bs.length - 1);
  let pos = first[a0];
  for (const i of order) {
    const b = bs[i]!, d = pos - b[a0];
    out[i] = axis === 'x' ? { x: d, y: 0 } : { x: 0, y: d };
    pos += b[a1] - b[a0] + gap;
  }
  return out;
}
export function inside(l: LayerGeom, m: Pt) {
  const q = mmToLocal(l, m), k = l.crop;
  return q.u >= k.x0 && q.u <= k.x1 && q.v >= k.y0 && q.v <= k.y1;
}

export function centerLayer(l: LayerGeom, g: Geo) {
  const c = cropCenter(l);
  l.cx += g.W / 2 - c.x; l.cy += g.H / 2 - c.y;
}
/** Ajusta (contain) o llena (cover) el póster con la zona visible, considerando el giro. */
export function fitLayer(l: LayerGeom, mode: FitMode, g: Geo) {
  const a = rad(l.rot), vw = visW(l), vh = visH(l);
  const bw = Math.abs(Math.cos(a)) * vw + Math.abs(Math.sin(a)) * vh;
  const bh = Math.abs(Math.sin(a)) * vw + Math.abs(Math.cos(a)) * vh;
  const f = mode === 'cover' ? Math.max(g.W / bw, g.H / bh) : Math.min(g.W / bw, g.H / bh);
  scaleLayer(l, f, cropCenter(l));
  centerLayer(l, g);
}
export const isStretched = (l: LayerGeom) => Math.abs(l.h / l.w / natRatio(l) - 1) > 0.005;
export const unstretch = (l: LayerGeom) => keepCenter(l, (x) => { x.h = x.w * natRatio(x); });

/* ---------- tiradores ---------- */
export const HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export function handleLocal(l: LayerGeom, id: HandleId): [number, number] {
  const k = l.crop, mx = (k.x0 + k.x1) / 2, my = (k.y0 + k.y1) / 2;
  return [id.includes('w') ? k.x0 : id.includes('e') ? k.x1 : mx, id.includes('n') ? k.y0 : id.includes('s') ? k.y1 : my];
}

export function startScale(l: LayerGeom, id: HandleId): ScaleDrag {
  return { t: 'scale', id, L0: { cx: l.cx, cy: l.cy, w: l.w, h: l.h, rot: l.rot, flipX: l.flipX, flipY: l.flipY }, k0: { ...l.crop } };
}
/** Escalar desde un tirador: esquinas proporcional (Shift = libre), lados estiran; Alt = desde el centro. */
export function applyScale(l: LayerGeom, d: ScaleDrag, m: Pt, shift: boolean, alt: boolean) {
  const k = d.k0, id = d.id, cu = (k.x0 + k.x1) / 2, cv = (k.y0 + k.y1) / 2;
  const ua = alt ? cu : id.includes('w') ? k.x1 : id.includes('e') ? k.x0 : cu;
  const va = alt ? cv : id.includes('n') ? k.y1 : id.includes('s') ? k.y0 : cv;
  const uh = id.includes('w') ? k.x0 : id.includes('e') ? k.x1 : cu;
  const vh = id.includes('n') ? k.y0 : id.includes('s') ? k.y1 : cv;
  const A = localToMM(d.L0, ua, va), v = toAxes(d.L0, { x: m.x - A.x, y: m.y - A.y });
  const hx = (uh - ua) * d.L0.w, hy = (vh - va) * d.L0.h;
  let sx = 1, sy = 1;
  if (id.length === 2) {
    if (shift) { sx = v.x / hx; sy = v.y / hy; } else sx = sy = (v.x * hx + v.y * hy) / (hx * hx + hy * hy);
  } else if (hx) sx = v.x / hx;
  else sy = v.y / hy;
  const vw0 = d.L0.w * (k.x1 - k.x0), vh0 = d.L0.h * (k.y1 - k.y0), mn = 3; // tamaño mínimo visible: 3 mm
  if (id.length === 2 && !shift) { const s = Math.max(sx, mn / vw0, mn / vh0); sx = sy = s; }
  else { sx = Math.max(sx, mn / vw0); sy = Math.max(sy, mn / vh0); }
  Object.assign(l, { rot: d.L0.rot, flipX: d.L0.flipX, flipY: d.L0.flipY, w: d.L0.w * sx, h: d.L0.h * sy });
  placeLocal(l, ua, va, A);
}

/** Recorte con un tirador: Shift mantiene la proporción, Alt es simétrico desde el centro, fixedRatio fija la proporción (w/h en mm). */
export function applyCropDrag(l: LayerGeom, d: CropDrag, m: Pt, shift: boolean, alt: boolean, fixedRatio: number | null) {
  const q = mmToLocal(l, m), u = clamp(q.u, 0, 1), v = clamp(q.v, 0, 1), k: Crop = { ...d.k0 }, id = d.id, M = 0.02;
  const cu = (k.x0 + k.x1) / 2, cv = (k.y0 + k.y1) / 2;
  if (/[we]/.test(id)) {
    if (alt) { const hw = Math.max(M / 2, Math.min(Math.abs(u - cu), cu, 1 - cu)); k.x0 = cu - hw; k.x1 = cu + hw; }
    else if (id.includes('w')) k.x0 = Math.min(u, k.x1 - M);
    else k.x1 = Math.max(u, k.x0 + M);
  }
  if (/[ns]/.test(id)) {
    if (alt) { const hh = Math.max(M / 2, Math.min(Math.abs(v - cv), cv, 1 - cv)); k.y0 = cv - hh; k.y1 = cv + hh; }
    else if (id.includes('n')) k.y0 = Math.min(v, k.y1 - M);
    else k.y1 = Math.max(v, k.y0 + M);
  }
  const ratio = fixedRatio || (shift && id.length === 2 ? d.ratio0 : null);
  if (ratio) {
    let cw = (k.x1 - k.x0) * l.w, ch = (k.y1 - k.y0) * l.h;
    if (id.length === 2) { if (cw / ch > ratio) ch = cw / ratio; else cw = ch * ratio; }
    else if (/[ns]/.test(id)) cw = ch * ratio;
    else ch = cw / ratio;
    let fw = cw / l.w, fh = ch / l.h;
    const hA = alt || /^[ns]$/.test(id) ? 'c' : id.includes('w') ? 'r' : 'l';
    const vA = alt || /^[we]$/.test(id) ? 'c' : id.includes('n') ? 'b' : 't';
    const ocu = (d.k0.x0 + d.k0.x1) / 2, ocv = (d.k0.y0 + d.k0.y1) / 2;
    const maxW = hA === 'c' ? 2 * Math.min(ocu, 1 - ocu) : hA === 'r' ? d.k0.x1 : 1 - d.k0.x0;
    const maxH = vA === 'c' ? 2 * Math.min(ocv, 1 - ocv) : vA === 'b' ? d.k0.y1 : 1 - d.k0.y0;
    const t = Math.min(1, maxW / fw, maxH / fh); fw *= t; fh *= t;
    if (hA === 'c') { k.x0 = ocu - fw / 2; k.x1 = ocu + fw / 2; } else if (hA === 'r') { k.x1 = d.k0.x1; k.x0 = k.x1 - fw; } else { k.x0 = d.k0.x0; k.x1 = k.x0 + fw; }
    if (vA === 'c') { k.y0 = ocv - fh / 2; k.y1 = ocv + fh / 2; } else if (vA === 'b') { k.y1 = d.k0.y1; k.y0 = k.y1 - fh; } else { k.y0 = d.k0.y0; k.y1 = k.y0 + fh; }
  }
  l.crop = k;
}
/** Encoge el recorte actual (centrado) hasta la proporción pedida. */
/**
 * Da al recorte la proporción ratio: el mayor marco con esa proporción que cabe en ref (tamaño en mm del marco de
 * referencia; por defecto, el actual), centrado donde está el recorte. ratio null: vuelve al marco de referencia.
 * Partir siempre de la misma referencia hace que ir y venir entre proporciones no encoja el recorte (antes cada
 * proporción se encajaba dentro de la anterior). Si el marco se saldría de la imagen, se desplaza para caber y solo
 * se reduce si no cabe ni así. Devuelve el tamaño final en mm.
 */
export function conformCrop(l: LayerGeom, ratio: number | null, ref = { w: visW(l), h: visH(l) }) {
  let cw = ref.w, ch = ref.h;
  if (ratio) { if (cw / ch > ratio) cw = ch * ratio; else ch = cw / ratio; }
  let fw = cw / l.w, fh = ch / l.h;
  const t = Math.min(1, 1 / fw, 1 / fh); fw *= t; fh *= t;
  const [mu, mv] = cropMid(l);
  const cu = clamp(mu, fw / 2, 1 - fw / 2), cv = clamp(mv, fh / 2, 1 - fh / 2);
  l.crop = { x0: cu - fw / 2, x1: cu + fw / 2, y0: cv - fh / 2, y1: cv + fh / 2 };
  return { w: visW(l), h: visH(l) };
}

/** Ajusta o llena el póster y, si scale < 1, lo reduce desde el centro (p. ej. la imagen de ejemplo al 94 %). */
export function applyFit(l: LayerGeom, fit: NonNullable<Fit>, g: Geo) {
  fitLayer(l, fit.mode, g);
  if (fit.scale !== 1) scaleLayer(l, fit.scale, cropCenter(l));
}

/**
 * Qué hacer con las imágenes colocadas a mano al cambiar papel, orientación, margen, solape u hojas:
 * - 'scale': escalar el diseño (como redimensionar en Canva). Todo crece o se encoge con el póster, sin deformarse
 *   y centrado; si cambia la proporción quedan márgenes a los lados o arriba y abajo.
 * - 'keep': mantener el tamaño en cm y la posición desde la esquina superior izquierda (como Figma con «izquierda y
 *   arriba»): al quitar hojas lo que sobra queda fuera; al añadirlas aparece espacio libre a la derecha o abajo.
 * Las imágenes ajustadas o llenadas (Ajustar / Llenar) se vuelven a ajustar al nuevo póster en los dos modos.
 */
export type RelayoutMode = 'scale' | 'keep';

/**
 * Espacio de diseño fijo (al escalar). El diseño vive en una medida que no cambia: la del póster en el que se empezó
 * (design.W × design.H). Cada distribución es solo una vista de ese diseño, escalada para caber y centrada.
 * Lo que el usuario mueve, escala o agrega en cualquier distribución se traduce de vuelta a esa medida, así que los
 * márgenes que deja un cambio de proporción nunca pasan a formar parte del diseño ni se acumulan reducciones.
 * applied: cómo dejó cada imagen el último cambio de hojas; si alguna ya no está así, el usuario la editó.
 * Se reinicia cuando no queda ninguna imagen colocada a mano (p. ej. con «Nuevo») o al pasar a «Mantener tamaño».
 */
export interface LayoutMemory {
  design: { W: number; H: number; geo: Map<object, Transform> } | null;
  applied: Map<object, Transform>;
}
export const newLayoutMemory = (): LayoutMemory => ({ design: null, applied: new Map() });

const tfOf = (l: Transform): Transform => ({ cx: l.cx, cy: l.cy, w: l.w, h: l.h, rot: l.rot, flipX: l.flipX, flipY: l.flipY });
const sameTf = (a: Transform, b: Transform) =>
  Math.abs(a.cx - b.cx) < 1e-6 && Math.abs(a.cy - b.cy) < 1e-6 && Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.h - b.h) < 1e-6
  && Math.abs(a.rot - b.rot) < 1e-6 && a.flipX === b.flipX && a.flipY === b.flipY;
/** Cómo se ve el diseño en un póster de W × H: escala para caber y desplazamiento para quedar centrado. */
const viewOf = (d: { W: number; H: number }, g: { W: number; H: number }) => {
  const k = Math.min(g.W / d.W, g.H / d.H);
  return { k, ox: (g.W - d.W * k) / 2, oy: (g.H - d.H * k) / 2 };
};

export function relayout(
  layers: (LayerGeom & { fit: Fit })[], prev: Geo, next: Geo, mode: RelayoutMode = 'scale', mem: LayoutMemory = newLayoutMemory(),
) {
  if (prev.W === next.W && prev.H === next.H) return;
  for (const l of layers) if (l.fit) applyFit(l, l.fit, next);
  const manual = layers.filter((l) => !l.fit);
  if (mode === 'keep' || !manual.length) { mem.design = null; mem.applied.clear(); return; } // keep: misma posición y tamaño en mm

  // 1) pasar al diseño lo que el usuario cambió (o agregó) en la distribución actual
  const d = mem.design ?? { W: prev.W, H: prev.H, geo: new Map<object, Transform>() };
  mem.design = d;
  const v0 = viewOf(d, prev);
  const geo = new Map<object, Transform>();
  for (const l of manual) {
    const was = mem.applied.get(l), kept = d.geo.get(l);
    if (was && kept && sameTf(tfOf(l), was)) { geo.set(l, kept); continue; }
    geo.set(l, { ...tfOf(l), cx: (l.cx - v0.ox) / v0.k, cy: (l.cy - v0.oy) / v0.k, w: l.w / v0.k, h: l.h / v0.k });
  }
  d.geo = geo; // las imágenes quitadas salen del diseño

  // 2) mostrar el diseño en el nuevo póster
  const v = viewOf(d, next);
  mem.applied.clear();
  for (const l of manual) {
    const g = geo.get(l)!;
    l.cx = v.ox + g.cx * v.k; l.cy = v.oy + g.cy * v.k; l.w = g.w * v.k; l.h = g.h * v.k;
    l.rot = g.rot; l.flipX = g.flipX; l.flipY = g.flipY;
    mem.applied.set(l, tfOf(l));
  }
}

/* ---------- recorte con marco fijo ---------- */
/** El punto cae sobre la imagen completa (también la parte recortada, que se ve atenuada al recortar). */
export function insideImage(l: Transform, m: Pt) {
  const q = mmToLocal(l, m);
  return q.u >= 0 && q.u <= 1 && q.v >= 0 && q.v <= 1;
}

/**
 * Deja el recorte como un marco fijo en el póster (centro C, tamaño vw × vh mm) sobre la imagen en su posición
 * actual. Si la imagen ya no cubre el marco, la desplaza lo justo para que lo cubra: nunca quedan huecos.
 */
export function frameCrop(l: LayerGeom, C: Pt, vw: number, vh: number) {
  const fw = Math.min(1, vw / l.w), fh = Math.min(1, vh / l.h);
  const q = mmToLocal(l, C);
  const u = clamp(q.u, fw / 2, 1 - fw / 2), v = clamp(q.v, fh / 2, 1 - fh / 2);
  l.crop = { x0: u - fw / 2, x1: u + fw / 2, y0: v - fh / 2, y1: v + fh / 2 };
  placeLocal(l, u, v, C);
}

/** Desplaza la imagen d mm bajo el marco de recorte, que no se mueve. */
export function panInFrame(l: LayerGeom, start: LayerGeom, d: Pt) {
  const C = cropCenter(start), vw = visW(start), vh = visH(start);
  Object.assign(l, { cx: start.cx + d.x, cy: start.cy + d.y, w: start.w, h: start.h });
  frameCrop(l, C, vw, vh);
}

/**
 * Amplía (f > 1) o reduce la imagen dentro del marco de recorte, alrededor del punto P del póster.
 * El marco no cambia; la imagen nunca se reduce tanto que deje huecos, ni se amplía por debajo de un 2 % visible.
 */
export function zoomInFrame(l: LayerGeom, f: number, P: Pt) {
  const C = cropCenter(l), vw = visW(l), vh = visH(l);
  const cw = l.crop.x1 - l.crop.x0, ch = l.crop.y1 - l.crop.y0;
  const s = clamp(f, Math.max(cw, ch), Math.min(cw, ch) / 0.02);
  scaleLayer(l, s, P);
  frameCrop(l, C, vw, vh);
}

/* ---------- resolución ---------- */
/**
 * Resolución disponible para exportar: la del archivo original (no la del lienzo de trabajo), limitada a hiArea px.
 * SVG y PDF son vectoriales: se pueden rasterizar hasta hiArea.
 */
export function srcDims(l: LayerGeom & { src: Source | null }, hiArea: number) {
  const s = l.src, iw = l.img.width, ih = l.img.height;
  let w = iw, h = ih;
  if (s?.kind === 'svg' || s?.kind === 'pdf') { const a = iw / ih; w = Math.sqrt(hiArea * a); h = w / a; }
  else if (s?.kind === 'img' && s.w && s.h) { const f = Math.min(1, Math.sqrt(hiArea / (s.w * s.h))); w = s.w * f; h = s.h * f; }
  return { w: Math.max(w, iw), h: Math.max(h, ih) };
}
/** Puntos por pulgada de la imagen tal como está colocada. */
export function pppOf(l: LayerGeom & { src: Source | null }, hiArea: number) {
  const d = srcDims(l, hiArea);
  return Math.round(Math.min(d.w / (l.w / 25.4), d.h / (l.h / 25.4)));
}
export type Quality = 'good' | 'warn' | 'bad';
export const qualityOf = (ppp: number): Quality => (ppp >= 150 ? 'good' : ppp >= 100 ? 'warn' : 'bad');

/* ---------- impresión ---------- */
/** Largo de las marcas de corte: van en el margen pero terminan a 3 mm del borde del papel. */
export const markLen = (g: Geo) => Math.min(5, g.m - 0.8 - 3);
export const hasCutMarks = (g: Geo, marks: boolean) => marks && markLen(g) >= 1.2;

/* ---------- copias reducidas para la pantalla ---------- */
/** Tamaños fijos de la copia de pantalla: así no se rehace con cada paso de zoom. */
export const DISPLAY_STEPS = [256, 512, 768, 1024, 1536, 2048] as const;
/**
 * Lado largo (px) de la copia reducida con la que se dibuja una imagen en pantalla, o null si conviene usar
 * el lienzo de trabajo tal cual (la copia casi no ahorraría nada o haría falta más resolución de la que hay).
 * needPx: px que ocupa en pantalla el lado largo de la imagen completa; longPx: lado largo del lienzo de trabajo.
 */
export function displaySide(needPx: number, longPx: number): number | null {
  const side = DISPLAY_STEPS.find((s) => s >= needPx * 1.1);
  if (!side || side >= longPx * 0.85) return null;
  return side;
}

/* ---------- espejo ---------- */
/**
 * Espejo respecto a la PANTALLA (lo que ve el usuario), no a los ejes propios de la imagen.
 * Voltear en pantalla una imagen girada θ equivale a voltearla en sus ejes y cambiar el giro a −θ
 * (M·R(θ) = R(−θ)·M). Antes solo se volteaba en sus ejes: con un giro de ±90° el espejo horizontal
 * se veía vertical, y con otros ángulos salía en diagonal. El centro de la zona visible no se mueve.
 */
export function flipOnScreen(l: LayerGeom, axis: 'x' | 'y') {
  keepCenter(l, (x) => {
    if (axis === 'x') x.flipX = !x.flipX; else x.flipY = !x.flipY;
    x.rot = normDeg(-x.rot);
  });
}
