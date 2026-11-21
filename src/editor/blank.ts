/**
 * Hojas en blanco: las que no dejarían tinta en el papel. Se omiten del PDF por hojas (opción «Omitir hojas en blanco»)
 * para no imprimir papel vacío, p. ej. alrededor de una imagen alargada, en forma de L o con el fondo quitado.
 *
 * Se decide en dos pasos, de lo barato a lo seguro:
 * 1. Geometría: si ninguna imagen visible toca la hoja, está en blanco (al instante, en cada fotograma).
 * 2. Píxeles: si alguna la toca, se mira si lo que deja en la hoja es todo blanco o transparente (zonas borradas,
 *    transparencia de un PNG, caja de un texto, fondo blanco de una foto). En pantalla se hace a baja resolución y
 *    con el póster quieto; al exportar se confirma a la resolución del PDF. Ante la duda, la hoja se imprime.
 *
 * Este módulo es puro (sin DOM): la geometría y la lectura de píxeles se prueban sin navegador.
 */
import type { Pt, Tile } from './types';

/** Un píxel es «blanco» si sus tres canales llegan a esto: un tono tan claro no se nota en papel y así el ruido de un escaneo no cuenta. */
export const WHITE = 248;
/** Lo que tiene que entrar una imagen en una hoja para contar (mm): un borde que solo la roza no la ensucia. */
const EPS = 0.05;

/** ¿El polígono convexo p (las esquinas de una imagen, en mm) entra en el rectángulo de la hoja? Separación de ejes. */
export function touchesTile(p: readonly Pt[], t: Pick<Tile, 'x0' | 'y0' | 'w' | 'h'>): boolean {
  const x0 = t.x0 + EPS, y0 = t.y0 + EPS, x1 = t.x0 + t.w - EPS, y1 = t.y0 + t.h - EPS;
  // ejes del rectángulo
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const q of p) { minX = Math.min(minX, q.x); maxX = Math.max(maxX, q.x); minY = Math.min(minY, q.y); maxY = Math.max(maxY, q.y); }
  if (maxX <= x0 || minX >= x1 || maxY <= y0 || minY >= y1) return false;
  // ejes del polígono (normales de sus lados)
  const corners: Pt[] = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  for (let i = 0; i < p.length; i++) {
    const a = p[i]!, b = p[(i + 1) % p.length]!, nx = a.y - b.y, ny = b.x - a.x;
    if (!nx && !ny) continue;
    let pMin = Infinity, pMax = -Infinity, rMin = Infinity, rMax = -Infinity;
    for (const q of p) { const d = q.x * nx + q.y * ny; pMin = Math.min(pMin, d); pMax = Math.max(pMax, d); }
    for (const q of corners) { const d = q.x * nx + q.y * ny; rMin = Math.min(rMin, d); rMax = Math.max(rMax, d); }
    if (pMax <= rMin || pMin >= rMax) return false;
  }
  return true;
}

/** Hojas que no toca ninguna imagen (índices en el orden de tiles()). polys: las esquinas de cada imagen visible. */
export function untouched(ts: readonly Tile[], polys: readonly (readonly Pt[])[]): Set<number> {
  const out = new Set<number>();
  ts.forEach((t, i) => { if (!polys.some((p) => touchesTile(p, t))) out.add(i); });
  return out;
}

/**
 * ¿Es blanco todo el rectángulo [x0, x1) × [y0, y1) de una imagen RGBA de ancho w? Se lee sobre fondo blanco, así que
 * lo transparente ya es blanco.
 */
export function isWhite(data: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number, thr = WHITE): boolean {
  for (let y = y0; y < y1; y++) {
    for (let i = (y * w + x0) * 4, end = (y * w + x1) * 4; i < end; i += 4) {
      if (data[i]! < thr || data[i + 1]! < thr || data[i + 2]! < thr) return false;
    }
  }
  return true;
}

/**
 * Píxeles de una hoja en una imagen del póster entero a k px/mm, redondeando hacia fuera: una imagen que entra un poco
 * en la hoja nunca se pierde entre dos píxeles (la duda se resuelve imprimiendo).
 */
export function tilePixels(t: Pick<Tile, 'x0' | 'y0' | 'w' | 'h'>, k: number, w: number, h: number) {
  return {
    x0: Math.max(0, Math.floor(t.x0 * k)), y0: Math.max(0, Math.floor(t.y0 * k)),
    x1: Math.min(w, Math.ceil((t.x0 + t.w) * k)), y1: Math.min(h, Math.ceil((t.y0 + t.h) * k)),
  };
}

/** Resolución de la comprobación en pantalla: hasta 2 px/mm y sin pasar de unos 4 MP para el póster entero. */
export const checkScale = (W: number, H: number) => Math.min(2, Math.sqrt(4e6 / (W * H)));

/**
 * Numeración de lo que se imprime: 1, 2, 3… seguidas, saltando las hojas en blanco (así el número sigue siendo la
 * página del PDF y se ve si falta alguna). null para las que no se imprimen.
 */
export function printedNumbers(n: number, blank: ReadonlySet<number>): (number | null)[] {
  let k = 0;
  return Array.from({ length: n }, (_, i) => (blank.has(i) ? null : ++k));
}

/**
 * ¿Quedan las hojas impresas en varias piezas sueltas? (vecinas por un lado, no por una esquina). Entonces la guía
 * avisa: cada pieza se coloca mirando el mapa, porque no hay hoja que las una.
 */
export function pieces(ts: readonly Tile[], blank: ReadonlySet<number>, cols: number): number {
  const seen = new Set<number>();
  let n = 0;
  ts.forEach((_, i) => {
    if (blank.has(i) || seen.has(i)) return;
    n++;
    const stack = [i];
    seen.add(i);
    while (stack.length) {
      const j = stack.pop()!, t = ts[j]!;
      for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const r = t.r + dr, c = t.c + dc, k = r * cols + c;
        if (r < 0 || c < 0 || c >= cols || k >= ts.length || blank.has(k) || seen.has(k)) continue;
        seen.add(k); stack.push(k);
      }
    }
  });
  return n;
}
