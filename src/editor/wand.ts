/**
 * Varita mágica, como en Photoshop: elige zonas de un color sin borrarlas.
 * - Clic: zona nueva; Shift + clic: la suma; Alt + clic: la resta. En táctil, sin teclas, con los botones Nueva,
 *   Sumar y Restar de la barra de opciones (st.wandOp).
 * - Lo elegido se ve teñido sobre la imagen. Se borra con «Borrar selección» o Supr, en un solo paso que se puede
 *   deshacer; Esc lo quita sin borrar e «Invertir» elige todo lo demás.
 * - Cambiar la tolerancia o «Solo zona» rehace la última zona, para ver el efecto antes de borrar.
 * Lo elegido es de la imagen seleccionada y de su lienzo actual: si cambian (otra imagen, otra herramienta, otro
 * retoque), deja de valer.
 * Cada cambio de lo elegido es un paso del historial (Ctrl+Z, Ctrl+Y): deshacer un borrado devuelve también lo que
 * estaba elegido. Por eso un WandSelection no se modifica nunca: cada cambio crea uno nuevo (el historial guarda los
 * anteriores).
 */
import { applyPixelJob, mmToPx } from './actions';
import { snap } from './history';
import { hideToast, toast } from './dom';
import { canvasRevision } from './io/persist';
import { colorMask, combineMasks, invertMask, maskHasAny, type MaskOp, type RGB } from './pixels';
import { dirty } from './render';
import { C, S, st } from './state';
import { renderBar } from './ui/contextbar';
import { s2mm } from './view';
import type { Layer, Pt } from './types';

export interface WandSelection {
  layer: Layer;
  /** El lienzo sobre el que se eligió (si la imagen cambia de lienzo, lo elegido ya no vale). */
  img: HTMLCanvasElement;
  w: number; h: number;
  /** Por píxel, cuánto se borraría (0 … 255; ver colorMask). */
  mask: Uint8ClampedArray;
  /** La última zona: se rehace al cambiar la tolerancia o «Solo zona». base: lo elegido antes de ella. */
  last: { seed: number; ref: RGB; op: MaskOp; base: Uint8ClampedArray | null } | null;
  /** Tinte de lo elegido, a la resolución del lienzo (se rehace al cambiar la máscara). */
  overlay: HTMLCanvasElement | null;
}

/** Datos RGBA del lienzo, guardados mientras no cambie (leerlos de nuevo en cada clic es lo más caro). */
let cache: { img: HTMLCanvasElement; rev: number; d: Uint8ClampedArray } | null = null;
function pixels(img: HTMLCanvasElement) {
  const rev = canvasRevision(img);
  if (!cache || cache.img !== img || cache.rev !== rev) {
    cache = { img, rev, d: img.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, img.width, img.height).data };
  }
  return cache.d;
}

/** Lo elegido, si sigue valiendo: de la imagen seleccionada, con la varita activa y sin que su lienzo haya cambiado. */
export function wandSelection(): WandSelection | null {
  const s = st.wandSel;
  return s && S.mode === 'wand' && s.layer === st.sel && s.layer.img === s.img ? s : null;
}

function changed() { renderBar(); dirty(); }

/** Clic de la varita en p (px de pantalla): elige la zona de ese color y la junta con lo elegido según op. */
export function wandPick(p: Pt, op: MaskOp) {
  const l = st.sel;
  if (!l) return;
  const q = mmToPx(l, s2mm(p)), x = Math.floor(q.x), y = Math.floor(q.y), w = l.img.width, h = l.img.height;
  if (x < 0 || y < 0 || x >= w || y >= h) { toast('Elige un punto dentro de la imagen seleccionada'); return; }
  const d = pixels(l.img), seed = y * w + x, o = seed * 4;
  if (d[o + 3] === 0) { toast('Esa zona ya está vacía'); return; }
  const base = wandSelection()?.mask ?? null;
  // sin nada elegido, sumar es elegir y restar no tiene de dónde
  if (!base && op === 'sub') { toast('No hay nada elegido que restar'); return; }
  const ref: RGB = [d[o]!, d[o + 1]!, d[o + 2]!];
  const mask = combineMasks(base, colorMask(d, w, h, [seed], ref, S.tol, S.contig), base ? op : 'new');
  snap();
  st.wandSel = { layer: l, img: l.img, w, h, mask, last: { seed, ref, op: base ? op : 'new', base }, overlay: null };
  if (!maskHasAny(mask)) { st.wandSel = null; toast(op === 'sub' ? 'Ya no queda nada elegido' : 'Nada que elegir con esta tolerancia. Súbela un poco.'); }
  else hideToast();
  changed();
}

/** La tolerancia o «Solo zona» cambiaron: se rehace la última zona (una vez por fotograma, al arrastrar). */
let retunePending = false;
export function retuneWand() {
  if (retunePending || !wandSelection()?.last) return;
  retunePending = true;
  requestAnimationFrame(() => {
    retunePending = false;
    const s = wandSelection(), last = s?.last;
    if (!s || !last) return;
    // la última zona se rehace sin un paso nuevo (sustituye a la de este paso)
    const m = colorMask(pixels(s.img), s.w, s.h, [last.seed], last.ref, S.tol, S.contig);
    st.wandSel = { ...s, mask: combineMasks(last.base, m, last.op), overlay: null };
    changed();
  });
}

/** Elige todo lo demás (lo ya transparente no cuenta). */
export function invertWandSelection() {
  const s = wandSelection();
  if (!s) return;
  const mask = invertMask(s.mask, pixels(s.img));
  if (!maskHasAny(mask)) { toast('No queda nada más que elegir'); return; }
  snap();
  st.wandSel = { ...s, mask, last: null, overlay: null };
  changed();
}

/** Quita lo elegido sin borrar nada. */
export function clearWandSelection() {
  if (!st.wandSel) return;
  snap();
  st.wandSel = null;
  changed();
}

/** Borra lo elegido, en un solo paso que se puede deshacer. */
export async function deleteWandSelection() {
  const s = wandSelection();
  if (!s) return;
  const r = await applyPixelJob(s.layer, { kind: 'mask', mask: s.mask }, 'Borrando lo elegido…');
  if (!r) return;
  if (st.wandSel === s) st.wandSel = null;
  if (!r.removed) toast('No había nada que borrar');
  changed();
}

/**
 * Color del tinte: el rosa de las marcas del póster (como la máscara rápida roja de Photoshop). El de acento es azul
 * y no se distinguía sobre cielos o fondos azules, justo lo que más se suele quitar.
 */
function tint(): [number, number, number] {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(C.mark ?? '');
  return m ? [parseInt(m[1]!, 16), parseInt(m[2]!, 16), parseInt(m[3]!, 16)] : [250, 101, 153];
}

/** Tinte de lo elegido: semitransparente por dentro y opaco en su borde, para que se vea dónde acaba. */
export function wandOverlay(s: WandSelection): HTMLCanvasElement {
  if (s.overlay) return s.overlay;
  const { w, h, mask } = s, [r, g, b] = tint();
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const id = new ImageData(w, h), out = id.data;
  for (let i = 0; i < mask.length; i++) {
    const v = mask[i]!;
    if (!v) continue;
    const x = i % w, y = (i - x) / w;
    const edge = v >= 128 && (x === 0 || y === 0 || x === w - 1 || y === h - 1
      || mask[i - 1]! < 128 || mask[i + 1]! < 128 || mask[i - w]! < 128 || mask[i + w]! < 128);
    const o = i * 4;
    out[o] = r; out[o + 1] = g; out[o + 2] = b; out[o + 3] = edge ? 255 : Math.round(v * 0.5);
  }
  c.getContext('2d')!.putImageData(id, 0, 0);
  return (s.overlay = c);
}
