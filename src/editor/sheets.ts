/**
 * Qué hojas se imprimen: las del póster menos, si está activado «Omitir hojas en blanco», las que no llevan nada (ver
 * blank.ts). La lectura en pantalla es al instante por geometría y se afina por píxeles con el póster quieto; la
 * exportación la confirma a la resolución del PDF.
 */
import { checkScale, isWhite, printedNumbers, tilePixels, untouched } from './blank';
import { adjustKey } from './pixels';
import { freeCanvas } from './dom';
import { cropPtsMM, tiles } from './geometry';
import { canvasRevision } from './io/persist';
import { drawAll } from './render';
import { posterGeo, S, st } from './state';
import type { Geo, Layer, Tile } from './types';

/** Lo que no deja nada en el papel aunque esté a la vista (opacidad casi cero). */
const invisible = (l: Layer) => l.hidden || l.opacity <= 0.002 || l === st.editingText;
const visibleLayers = () => st.layers.filter((l) => !invisible(l));

const ids = new WeakMap<object, number>();
let nextId = 1;
const idOf = (o: object) => { let i = ids.get(o); if (!i) { i = nextId++; ids.set(o, i); } return i; };

/** Clave de todo lo que cambia lo impreso: la distribución y, de cada imagen, su lienzo, su sitio y su recorte. */
function printKey(g: Geo): string {
  const parts: (string | number | boolean)[] = [g.W, g.H, g.cols, g.rows, g.tw, g.th, g.ov];
  for (const l of visibleLayers()) {
    const k = l.crop;
    parts.push(idOf(l.img), canvasRevision(l.img), l.cx, l.cy, l.w, l.h, l.rot, l.flipX, l.flipY, k.x0, k.y0, k.x1, k.y1, l.opacity, l.adjust ? adjustKey(l.adjust) : '');
  }
  return parts.join('|');
}

/** Las hojas que toca alguna imagen visible: las únicas que pueden llevar algo. */
function touched(ts: Tile[]): Set<number> {
  const free = untouched(ts, visibleLayers().map(cropPtsMM));
  return new Set(ts.map((_, i) => i).filter((i) => !free.has(i)));
}

/**
 * Hojas tocadas que, aun así, solo dejan blanco: se mira el póster entero dibujado a k px/mm sobre blanco.
 * El lienzo se libera enseguida (puede ser de varios megapíxeles).
 */
function whiteAmong(g: Geo, ts: Tile[], which: Iterable<number>, k: number): Set<number> {
  const out = new Set<number>(), list = [...which];
  if (!list.length) return out;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.ceil(g.W * k)); c.height = Math.max(1, Math.ceil(g.H * k));
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  x.setTransform(k, 0, 0, k, 0, 0);
  x.beginPath(); x.rect(0, 0, g.W, g.H); x.clip();
  drawAll(x);
  const data = x.getImageData(0, 0, c.width, c.height).data;
  for (const i of list) {
    const p = tilePixels(ts[i]!, k, c.width, c.height);
    if (isWhite(data, c.width, p.x0, p.y0, p.x1, p.y1)) out.add(i);
  }
  freeCanvas(c);
  return out;
}

/* ---------- lectura en pantalla ---------- */
let pixelKey = '', pixelWhite = new Set<number>(), timer: ReturnType<typeof setTimeout> | undefined, pendingKey = '';
const listeners: (() => void)[] = [];
/** Avisa cuando cambia la lectura por píxeles (el resumen y el botón cuentan las páginas). */
export const onBlankChange = (fn: () => void) => { listeners.push(fn); };

/** Espera a que el póster se quede quieto y entonces mira los píxeles de las hojas que toca alguna imagen. */
function scheduleCheck(key: string) {
  if (key === pixelKey || key === pendingKey) return;
  pendingKey = key;
  clearTimeout(timer);
  timer = setTimeout(() => {
    pendingKey = '';
    const g = posterGeo();
    if (printKey(g) !== key) return; // cambió mientras tanto: ya hay otra en camino
    const ts = tiles(g);
    try { pixelWhite = whiteAmong(g, ts, touched(ts), checkScale(g.W, g.H)); } catch { pixelWhite = new Set(); }
    pixelKey = key;
    listeners.forEach((fn) => fn());
  }, 350);
}

export interface SheetPlan {
  tiles: Tile[];
  /** Índices de las hojas que no se imprimen. */
  blank: Set<number>;
  /** Número de cada hoja en el PDF (null: no se imprime). */
  numbers: (number | null)[];
  /** Hojas que se imprimen. */
  printed: number;
  /** Nada de lo visible cae dentro del póster (tenga o no la opción): no hay nada que imprimir. */
  empty: boolean;
}
function plan(ts: Tile[], blank: Set<number>, empty = false): SheetPlan {
  return { tiles: ts, blank, numbers: printedNumbers(ts.length, blank), printed: ts.length - blank.size, empty };
}

/**
 * Las hojas tal como se imprimirían ahora. Sin la opción, o sin nada que imprimir, no se omite ninguna (con todo
 * oculto ya se avisa de otra forma). Se puede llamar en cada fotograma: la geometría es barata y los píxeles se
 * reutilizan mientras no cambie nada.
 */
export function sheetPlan(g: Geo = posterGeo()): SheetPlan {
  const ts = tiles(g);
  if (!visibleLayers().length) return plan(ts, new Set());
  const key = printKey(g), hit = touched(ts), blank = new Set<number>();
  ts.forEach((_, i) => { if (!hit.has(i) || (key === pixelKey && pixelWhite.has(i))) blank.add(i); });
  if (key !== pixelKey) scheduleCheck(key);
  const empty = blank.size === ts.length;
  // todo en blanco: no se omite nada (el panel avisa de que no hay nada que imprimir)
  return plan(ts, S.skipBlank && !empty ? blank : new Set(), empty);
}

/* ---------- al exportar ---------- */
/**
 * Hojas en blanco confirmadas para el PDF. Las que no toca nada, seguro; las tocadas que se ven blancas a baja
 * resolución se vuelven a mirar dibujadas como irán al PDF (render), por si llevan algo fino o muy claro que la
 * lectura rápida no ve. render devuelve el lienzo de la hoja a la resolución del PDF.
 */
export async function confirmPlan(render: (t: Tile) => HTMLCanvasElement, yieldTo: () => Promise<void>): Promise<SheetPlan> {
  const g = posterGeo(), ts = tiles(g);
  if (!S.skipBlank || !visibleLayers().length) return plan(ts, new Set());
  const hit = touched(ts), blank = new Set(ts.map((_, i) => i).filter((i) => !hit.has(i)));
  const maybe = whiteAmong(g, ts, hit, checkScale(g.W, g.H));
  for (const i of maybe) {
    await yieldTo();
    const c = render(ts[i]!), data = c.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, c.width, c.height).data;
    if (isWhite(data, c.width, 0, 0, c.width, c.height)) blank.add(i);
    freeCanvas(c);
  }
  // si todo saliera en blanco, no se omite nada: mejor un PDF que ninguno (el panel ya avisa de que no hay nada)
  return plan(ts, blank.size === ts.length ? new Set() : blank);
}
