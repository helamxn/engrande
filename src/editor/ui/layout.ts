/**
 * Disposición: el lienzo es el fondo de la app y la cabecera, las herramientas, la lectura y el panel flotan encima.
 * Aquí se mide cuánto tapan esas islas (la vista encaja el póster en lo que queda libre), se pliega el panel en
 * escritorio y, en móvil, se maneja el panel inferior deslizable.
 */
import { $ } from '../dom';
import { deskMQ } from '../platform';
import { getPref, setPref } from '../prefs';
import { setInsets } from '../view';

let free: HTMLElement;
let panel: HTMLElement;

/** Márgenes que tapan las islas, en px desde cada borde del lienzo. */
function measure() {
  const s = $('#stage').getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  if (!deskMQ?.matches) {
    // móvil: arriba la cabecera y las herramientas; abajo, el panel inferior a la altura que tenga
    return { t: Math.round($('#tools').getBoundingClientRect().bottom - s.top), r: 0, b: Math.round(s.bottom - p.top), l: 0 };
  }
  const head = $('header').getBoundingClientRect();
  const foot = $('#tools').getBoundingClientRect().top;
  return {
    t: Math.round(head.bottom - s.top),
    // plegado, el panel mide 0: solo queda el botón para mostrarlo, que va en la franja de la cabecera
    r: p.width ? Math.round(s.right - p.left) : 0,
    b: Math.round(s.bottom - foot),
    l: 0,
  };
}

function update() {
  const ins = measure();
  free.style.inset = `${ins.t}px ${ins.r}px ${ins.b}px ${ins.l}px`;
  setInsets(ins);
}

/* ---------- escritorio: plegar el panel ---------- */
export const isPanelOff = () => document.body.classList.contains('panel-off');

/** Pliega o despliega el panel (solo en escritorio). Se recuerda en este navegador. */
export function togglePanel(on = isPanelOff()) {
  if (!deskMQ?.matches) return;
  const active = document.activeElement;
  document.body.classList.toggle('panel-off', !on);
  $('#panelHide').setAttribute('aria-expanded', String(on));
  $('#panelShow').setAttribute('aria-expanded', String(on));
  setPref('panel', on ? 'on' : 'off');
  // el foco no se pierde con el botón que desaparece: pasa al que lo sustituye
  if (active === $('#panelHide') || active === $('#panelShow') || (!on && panel.contains(active))) {
    $<HTMLButtonElement>(on ? '#panelHide' : '#panelShow').focus();
  }
  update();
}

/* ---------- móvil: panel inferior con tres alturas ---------- */
export type SheetState = 'peek' | 'half' | 'full';
let sheet: SheetState = 'peek';
/** El panel inferior (móvil) está abierto a media altura o completo. */
export const isSheetOpen = () => sheet !== 'peek';

/** Alturas (px): solo asa y pestañas; media pantalla; hasta debajo de las herramientas. */
function sheetHeights() {
  const tabs = $('#sheetTabs');
  const peek = Math.round(tabs.offsetTop + tabs.offsetHeight);
  const top = $('#tools').getBoundingClientRect().bottom + 8;
  const full = Math.max(peek, Math.round(innerHeight - top));
  const half = Math.min(full, Math.max(peek + 160, Math.round(innerHeight * 0.5)));
  return { peek, half, full };
}
/**
 * La altura va en una variable CSS que solo usa el panel en móvil (global.css), no en style.height: así, al pasar a
 * escritorio (p. ej. al quitar el zoom del navegador) la altura de la hoja no se queda pegada a la tarjeta lateral,
 * pase lo que pase con el orden de los eventos resize y change.
 */
function applySheetHeight(h: number) {
  document.documentElement.style.setProperty('--sheet-h', `${h}px`);
}

/** Abre el panel inferior a una altura (en escritorio no hace nada). */
export function openSheet(state: SheetState) {
  if (deskMQ?.matches) return;
  sheet = state;
  applySheetHeight(sheetHeights()[state]);
  $('#sheetHandle').setAttribute('aria-expanded', String(state !== 'peek'));
  update(); // y otra vez al terminar la transición (transitionend)
}

/** Arrastrar el asa cambia la altura; al soltar se queda en la más cercana. Un toque alterna. */
function initSheetDrag() {
  let start: { y: number; h: number; id: number } | null = null;
  let moved = false;
  const down = (e: PointerEvent) => {
    if (deskMQ?.matches) return;
    start = { y: e.clientY, h: panel.getBoundingClientRect().height, id: e.pointerId };
    moved = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    const dy = e.clientY - start.y;
    if (!moved && Math.abs(dy) < 6) return;
    moved = true;
    panel.classList.add('sheet-drag');
    const { peek, full } = sheetHeights();
    applySheetHeight(Math.min(full, Math.max(peek, start.h - dy)));
  };
  const up = (e: PointerEvent) => {
    if (!start || e.pointerId !== start.id) return;
    panel.classList.remove('sheet-drag');
    start = null;
    if (!moved) { openSheet(sheet === 'peek' ? 'half' : 'peek'); return; }
    const h = panel.getBoundingClientRect().height, hs = sheetHeights();
    const near = (['peek', 'half', 'full'] as const).reduce((a, k) => (Math.abs(hs[k] - h) < Math.abs(hs[a] - h) ? k : a));
    openSheet(near);
  };
  for (const el of [$('#sheetHandle')]) {
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }
  // con el teclado, el asa es un botón: Enter o espacio alternan (el clic sintético no trae puntero)
  $('#sheetHandle').addEventListener('click', (e) => { if (e.detail === 0) openSheet(sheet === 'peek' ? 'half' : 'peek'); });
  // tocar una pestaña con el panel recogido lo abre
  for (const t of document.querySelectorAll('[role=tab]')) t.addEventListener('click', () => { if (sheet === 'peek') openSheet('half'); });
}

/** Al pasar a móvil se recalcula la altura de la hoja (en escritorio la variable no se usa). */
function syncSheetMode() {
  if (!deskMQ?.matches) openSheet(sheet);
}

export function initLayout() {
  free = $('#free');
  panel = $('#panel');
  const off = getPref('panel') === 'off';
  document.body.classList.toggle('panel-off', off);
  $('#panelHide').setAttribute('aria-expanded', String(!off));
  $('#panelShow').setAttribute('aria-expanded', String(!off));
  $('#panelHide').addEventListener('click', () => togglePanel(false));
  $('#panelShow').addEventListener('click', () => togglePanel(true));
  initSheetDrag();
  panel.addEventListener('transitionend', (e) => { if (e.target === panel) update(); });
  syncSheetMode();

  // las islas cambian de tamaño con la ventana, al plegar o deslizar el panel o cuando la lectura ocupa otra línea
  const ro = new ResizeObserver(update);
  for (const sel of ['#stage', 'header', '#tools', '#panel']) ro.observe($(sel));
  deskMQ?.addEventListener('change', () => { syncSheetMode(); update(); });
  addEventListener('resize', () => { if (!deskMQ?.matches) openSheet(sheet); });
  update();
}
