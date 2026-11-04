/**
 * Algoritmos de píxeles puros (sin DOM): se ejecutan en un worker para no congelar la página y,
 * si el worker no está disponible, en la propia página. Trabajan sobre los datos RGBA del lienzo.
 */

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

/** Ejecuta una tarea sobre los datos (en el worker o, de respaldo, en la página). Modifica d. */
export function runPixelJob(d: Uint8ClampedArray, w: number, h: number, job: PixelJob): PixelResult {
  if (job.kind === 'wand') return { removed: removeColorData(d, w, h, job.seeds, job.ref, job.tol, job.contig) };
  const p = autoBackgroundParams(d, w, h, job.tol);
  if ('error' in p) return { removed: 0, error: p.error };
  return { removed: removeColorData(d, w, h, p.seeds, p.ref, job.tol, true) };
}
