/**
 * Algoritmos de píxeles puros (sin DOM): se ejecutan en un worker para no congelar la página y,
 * si el worker no está disponible, en la propia página. Trabajan sobre los datos RGBA del lienzo.
 */

import type { Adjust } from './types';

export type RGB = readonly [number, number, number];

/** Tarea que se manda al worker. */
export type PixelJob =
  | { kind: 'wand'; seeds: number[]; ref: RGB; tol: number; contig: boolean }
  | { kind: 'auto'; tol: number };

export interface PixelResult {
  /** Píxeles que pasaron a ser transparentes. */
  removed: number;
  /** Solo en 'auto': por qué no se pudo quitar el fondo. */
  error?: 'transparent' | 'nouniform';
}

/**
 * Vuelve transparentes los píxeles parecidos a ref (distancia RGB ≤ tol), con un borde suave hasta 1,35 × tol.
 * contig: solo la zona conectada a las semillas (relleno por inundación); si no, en toda la imagen.
 */
export function removeColorData(d: Uint8ClampedArray, w: number, h: number, seeds: ArrayLike<number>, ref: RGB, tol: number, contig: boolean) {
  const t2 = tol * tol, softT = tol * 1.35, soft2 = softT * softT;
  let removed = 0;
  const handle = (i: number) => {
    const o = i * 4;
    if (d[o + 3] === 0) return true;
    const dr = d[o]! - ref[0], dg = d[o + 1]! - ref[1], db = d[o + 2]! - ref[2], q = dr * dr + dg * dg + db * db;
    if (q <= t2) { d[o + 3] = 0; removed++; return true; }
    if (q < soft2) d[o + 3] = Math.round((d[o + 3]! * (Math.sqrt(q) - tol)) / (softT - tol));
    return false;
  };
  if (!contig) { for (let i = 0, n = w * h; i < n; i++) handle(i); return removed; }
  const vis = new Uint8Array(w * h), stack = new Int32Array(w * h);
  let sp = 0;
  for (let k = 0; k < seeds.length; k++) { const s = seeds[k]!; if (!vis[s]) { vis[s] = 1; stack[sp++] = s; } }
  while (sp) {
    const i = stack[--sp]!;
    if (!handle(i)) continue;
    const x = i % w;
    if (x > 0 && !vis[i - 1]) { vis[i - 1] = 1; stack[sp++] = i - 1; }
    if (x < w - 1 && !vis[i + 1]) { vis[i + 1] = 1; stack[sp++] = i + 1; }
    if (i >= w && !vis[i - w]) { vis[i - w] = 1; stack[sp++] = i - w; }
    if (i < w * h - w && !vis[i + w]) { vis[i + w] = 1; stack[sp++] = i + w; }
  }
  return removed;
}

/**
 * Fondo automático: toma como referencia el color mediano de las cuatro esquinas y siembra el relleno
 * en todos los píxeles del borde que se le parecen.
 */
export function autoBackgroundParams(d: Uint8ClampedArray, w: number, h: number, tol: number):
  { ref: RGB; seeds: number[] } | { error: 'transparent' | 'nouniform' } {
  const samples: [number[], number[], number[]] = [[], [], []];
  const patch = Math.max(3, Math.round(Math.min(w, h) * 0.01));
  for (const [cx, cy] of [[0, 0], [w - patch, 0], [0, h - patch], [w - patch, h - patch]] as const) {
    for (let y = cy; y < cy + patch; y++) for (let x = cx; x < cx + patch; x++) {
      const o = (y * w + x) * 4;
      if (d[o + 3]! > 200) { samples[0].push(d[o]!); samples[1].push(d[o + 1]!); samples[2].push(d[o + 2]!); }
    }
  }
  if (!samples[0].length) return { error: 'transparent' };
  const med = (a: number[]) => { a.sort((p, q) => p - q); return a[a.length >> 1]!; };
  const ref = [med(samples[0]), med(samples[1]), med(samples[2])] as const;
  const t2 = tol * tol, seeds: number[] = [];
  const near = (i: number) => {
    const o = i * 4;
    if (d[o + 3] === 0) return true;
    const a = d[o]! - ref[0], b = d[o + 1]! - ref[1], e = d[o + 2]! - ref[2];
    return a * a + b * b + e * e <= t2;
  };
  for (let x = 0; x < w; x++) { if (near(x)) seeds.push(x); if (near((h - 1) * w + x)) seeds.push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { if (near(y * w)) seeds.push(y * w); if (near(y * w + w - 1)) seeds.push(y * w + w - 1); }
  if (!seeds.length) return { error: 'nouniform' };
  return { ref, seeds };
}

/**
 * Máscara de lo retocado a mano (borrador, varita, quitar fondo): en cada píxel, alfa del lienzo editado ÷ alfa del
 * original (0..255, en el canal alfa; el color no cuenta). Al exportar se multiplica por la imagen en alta
 * resolución, que ya trae su propia transparencia: si se usara el alfa del lienzo editado tal cual, una sombra al
 * 50 % quedaría al 25 % (su transparencia, aplicada dos veces). Donde el original es transparente no hay nada que quitar.
 */
export function editMaskData(img: Uint8ClampedArray, orig: Uint8ClampedArray) {
  const m = new Uint8ClampedArray(img.length);
  for (let o = 3; o < img.length; o += 4) {
    const a = orig[o]!;
    m[o] = a ? Math.min(255, Math.round((img[o]! * 255) / a)) : 255;
  }
  return m;
}

/** Ejecuta una tarea sobre los datos (en el worker o, de respaldo, en la página). Modifica d. */
export function runPixelJob(d: Uint8ClampedArray, w: number, h: number, job: PixelJob): PixelResult {
  if (job.kind === 'wand') return { removed: removeColorData(d, w, h, job.seeds, job.ref, job.tol, job.contig) };
  const p = autoBackgroundParams(d, w, h, job.tol);
  if ('error' in p) return { removed: 0, error: p.error };
  return { removed: removeColorData(d, w, h, p.seeds, p.ref, job.tol, true) };
}

/* ---------- ajustes de color ---------- */
/** ¿No cambia nada? (entonces se dibuja la imagen tal cual). */
export const isNeutral = (a: Adjust | null | undefined) => !a || (!a.bright && !a.contrast && !a.sat && !a.gray);
/** Clave de unos ajustes (para la caché de imágenes ajustadas). */
export const adjustKey = (a: Adjust) => `${a.bright}|${a.contrast}|${a.sat}|${a.gray ? 1 : 0}`;

/**
 * Aplica brillo, contraste y saturación (en ese orden, como brightness() contrast() saturate() de CSS) a datos RGBA
 * sin premultiplicar. El alfa no cambia. Brillo y contraste van en una tabla de 256 valores; la saturación es la
 * matriz de feColorMatrix (luminancia 0,213 · 0,715 · 0,072). Blanco y negro = saturación 0.
 */
export function adjustData(d: Uint8ClampedArray, a: Adjust) {
  const b = 1 + a.bright / 100, c = 1 + a.contrast / 100, s = a.gray ? 0 : 1 + a.sat / 100;
  const lut = new Float32Array(256);
  for (let v = 0; v < 256; v++) lut[v] = (v * b - 127.5) * c + 127.5;
  const satOn = s !== 1;
  const r0 = 0.213 + 0.787 * s, r1 = 0.715 - 0.715 * s, r2 = 0.072 - 0.072 * s;
  const g0 = 0.213 - 0.213 * s, g1 = 0.715 + 0.285 * s, g2 = 0.072 - 0.072 * s;
  const b0 = 0.213 - 0.213 * s, b1 = 0.715 - 0.715 * s, b2 = 0.072 + 0.928 * s;
  // la tabla se aplica sin recortar: CSS recorta al final de cada filtro, así que se recorta aquí también
  const cl = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let o = 0; o < d.length; o += 4) {
    if (d[o + 3] === 0) continue;
    const R = cl(lut[d[o]!]!), G = cl(lut[d[o + 1]!]!), B = cl(lut[d[o + 2]!]!);
    if (satOn) {
      d[o] = R * r0 + G * r1 + B * r2; d[o + 1] = R * g0 + G * g1 + B * g2; d[o + 2] = R * b0 + G * b1 + B * b2;
    } else { d[o] = R; d[o + 1] = G; d[o + 2] = B; }
  }
}

/** Ajustes leídos de lo guardado: cada valor entero entre −100 y 100; null si no cambian nada. */
export function readAdjust(v: unknown): Adjust | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? Math.round(Math.min(100, Math.max(-100, x))) : 0);
  const a: Adjust = { bright: n(r.bright), contrast: n(r.contrast), sat: n(r.sat), gray: r.gray === true };
  return isNeutral(a) ? null : a;
}
