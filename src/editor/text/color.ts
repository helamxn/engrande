/** Vista previa de color: un buffer pequeño por gesto y un solo cambio de historial al confirmar. */
import { afterChange } from '../actions';
import { $ } from '../dom';
import { pushUndo, takeSnap } from '../history';
import { dirty } from '../render';
import { st, V, view } from '../state';
import { isText, recolor, specOf, type TextLayer } from './text';
import { DEFAULT_TEXT_COLOR, normalizeColor } from './values';

let gesture: { l: TextLayer; color: string; canvas: HTMLCanvasElement } | null = null;
let frame = 0;
let timer: ReturnType<typeof setTimeout> | undefined;

function fields(color: string) {
  $<HTMLInputElement>('#tColor').value = color;
  const hex = $<HTMLInputElement>('#tColorHex');
  if (document.activeElement !== hex) hex.value = color;
}

export function syncTextColor() {
  if (gesture && gesture.l !== st.sel) finishColor();
  if (isText(st.sel)) fields(gesture?.color ?? specOf(st.sel).color);
}

function preview() {
  frame = 0;
  const g = gesture;
  if (!g) return;
  const x = g.canvas.getContext('2d')!;
  x.clearRect(0, 0, g.canvas.width, g.canvas.height);
  x.drawImage(g.l.img, 0, 0, g.canvas.width, g.canvas.height);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = g.color; x.fillRect(0, 0, g.canvas.width, g.canvas.height);
  x.globalCompositeOperation = 'source-over';
  st.textColorPreview = { layer: g.l, canvas: g.canvas };
  dirty();
}

function queueColor(color: string) {
  const l = st.sel;
  if (!isText(l) || l.locked) return;
  if (gesture && gesture.l !== l) finishColor();
  if (!gesture) {
    const c = document.createElement('canvas');
    const side = Math.min(1200, Math.max(128, Math.ceil(Math.max(l.w, l.h) * V.k * view.dpr)));
    const k = Math.min(1, side / Math.max(l.img.width, l.img.height));
    c.width = Math.max(1, Math.round(l.img.width * k)); c.height = Math.max(1, Math.round(l.img.height * k));
    gesture = { l, color, canvas: c };
  }
  gesture.color = color;
  fields(color);
  if (!frame) frame = requestAnimationFrame(preview);
  clearTimeout(timer);
  // Los controles nativos confirman con change. También admite actualizaciones programáticas sin foco.
  if (document.activeElement !== $('#tColor')) timer = setTimeout(finishColor, 250);
}

export function finishColor() {
  clearTimeout(timer); cancelAnimationFrame(frame); frame = 0;
  const g = gesture;
  if (!g) return;
  gesture = null; st.textColorPreview = null;
  if (st.layers.includes(g.l) && !g.l.locked && specOf(g.l).color !== g.color) {
    const before = takeSnap();
    recolor(g.l, g.color); pushUndo(before); afterChange();
  }
  g.canvas.width = 0; g.canvas.height = 0;
  dirty();
}

export function initTextColor() {
  const color = $<HTMLInputElement>('#tColor'), hex = $<HTMLInputElement>('#tColorHex');
  color.addEventListener('input', () => queueColor(color.value));
  color.addEventListener('change', finishColor);
  color.addEventListener('blur', finishColor);
  const applyHex = () => {
    const value = normalizeColor(hex.value), error = $('#tColorError');
    error.hidden = !!value; hex.setAttribute('aria-invalid', String(!value));
    if (!value) return;
    queueColor(value); finishColor(); hex.value = value;
  };
  hex.addEventListener('change', applyHex);
  hex.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); applyHex(); hex.select(); }
    if (e.key === 'Escape' && isText(st.sel)) {
      hex.value = specOf(st.sel).color; $('#tColorError').hidden = true; hex.removeAttribute('aria-invalid');
    }
  });
  $('#tColorReset').addEventListener('click', () => {
    hex.value = DEFAULT_TEXT_COLOR; $('#tColorError').hidden = true; hex.removeAttribute('aria-invalid');
    queueColor(DEFAULT_TEXT_COLOR); finishColor();
  });
  document.addEventListener('pointerdown', e => {
    if (!(e.target as Element).closest('.text-color-field')) finishColor();
  }, true);
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) finishColor();
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') finishColor(); });
  addEventListener('beforeunload', finishColor);
}
