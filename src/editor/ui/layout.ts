/**
 * Disposición: el lienzo es el fondo de la app y la cabecera, las herramientas, la lectura y el panel flotan encima.
 * Aquí se mide cuánto tapan esas islas (la vista encaja el póster en lo que queda libre), se pliega el panel en
 * escritorio y, en móvil, se maneja el panel inferior deslizable.
 */
import { $ } from '../dom';
import { deskMQ, dockMQ } from '../platform';
import { setInsets } from '../view';

let free: HTMLElement;
let panel: HTMLElement;
let controls: HTMLElement[] = [];


/**
 * Márgenes en px desde cada borde del lienzo:
 * - ins: lo que tapan ahora las islas y los paneles (la pista, la etiqueta de tamaño y la barra se quedan a la vista);
 * - fit: solo lo fijo, con lo que se encaja el póster. El panel de la selección (escritorio) y el panel inferior
 *   abierto (móvil) van encima del lienzo: aparecer o irse no lo mueve.
 */
function measure() {
  const s = $('#stage').getBoundingClientRect();
  const p = panel.getBoundingClientRect();
  // arriba: la fila de la cabecera (en móvil, también la vista) y la barra de acciones, fija bajo ella
  const bar = $('#ctxbar');
  const t = Math.round((bar.hidden ? $('#topbar').getBoundingClientRect().bottom : bar.getBoundingClientRect().bottom) - s.top);
  // móvil: abajo, el panel inferior a la altura que tenga; para encajar, solo sus pestañas (lo que siempre se ve)
  if (!deskMQ?.matches) {
    return { ins: { t, r: 0, b: Math.round(s.bottom - p.top), l: 0 }, fit: { t, r: 0, b: sheetHeights().peek, l: 0 } };
  }
  // abajo: la isla de vista (12 px de margen + su alto)
  const b = Math.round(s.bottom - $('#tools').getBoundingClientRect().top);
  return { ins: { t, r: p.width ? Math.round(s.right - p.left) : 0, b, l: 0 }, fit: { t, r: 0, b, l: 0 } };
}

function update() {
  // dónde termina la fila de arriba (la cabecera): las tarjetas de Póster y Capas se abren 8 px por debajo
  document.documentElement.style.setProperty('--top-row', `${Math.round($('header').getBoundingClientRect().bottom)}px`);
  const { ins, fit } = measure();
  free.style.inset = `${ins.t}px ${ins.r}px ${ins.b}px ${ins.l}px`;
  setInsets(ins, fit);
  // la línea de estado (una caja de una línea), en la fila de la isla de vista: centrada con ella y sin llegar a ella
  const hint = $('#hint'), tools = $('#tools').getBoundingClientRect(), s = $('#stage').getBoundingClientRect();
  // el tamaño del póster va delante (a la izquierda), en la misma fila; la línea de estado, a su derecha
  const size = $('#posterSize'), bottom = `${Math.round(s.bottom - tools.bottom + (tools.height - 30) / 2)}px`;
  size.style.bottom = bottom;
  const sr = size.getBoundingClientRect(), left = sr.width ? Math.round(sr.right - s.left + 8) : 12;
  hint.style.left = `${left}px`;
  hint.style.maxWidth = `${Math.max(0, Math.round(tools.left - s.left - left - 24))}px`;
  hint.style.bottom = bottom;
}

/* ---------- escritorio: plegar el panel ---------- */
export const isPanelOff = () => document.body.classList.contains('panel-off');

/**
 * Muestra u oculta el panel (solo en escritorio). Empieza oculto: aparece al seleccionar algo o al pedirlo (ver
 * followSelection en panel.ts); no se recuerda entre visitas.
 */
export function togglePanel(on = isPanelOff()) {
  if (!deskMQ?.matches) return;
  const active = document.activeElement;
  document.body.classList.toggle('panel-off', !on);
  $('#panelHide').setAttribute('aria-expanded', String(on));
  for (const b of document.querySelectorAll('#panelOpeners button')) b.setAttribute('aria-expanded', String(on));
  // el foco no se pierde con el botón que desaparece: pasa al que lo sustituye
  if (active === $('#panelHide') || $('#panelOpeners').contains(active) || (!on && panel.contains(active))) {
    $<HTMLButtonElement>(on ? '#panelHide' : '#panelOpeners button').focus();
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
  // completo, llega hasta debajo de la barra de acciones (o de la cabecera, si aún no está)
  const bar = $('#ctxbar'), top = (bar.hidden ? $('#topbar') : bar).getBoundingClientRect().bottom + 8;
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
  controls = ['header', '#ctxbar', '#panelOpeners', '#tools', '#panel', '#posterCard', '#layersCard', '#pdfCard', '#hint', '#posterSize'].map(sel => $(sel));
  // el panel empieza oculto: aparece cuando hace falta (al seleccionar o al pedirlo)
  document.body.classList.add('panel-off');
  $('#panelHide').setAttribute('aria-expanded', 'false'); // su clic lo atiende panel.ts (deja de ser automático)
  initSheetDrag();
  panel.addEventListener('transitionend', (e) => { if (e.target === panel) update(); });
  syncSheetMode();

  // las islas cambian de tamaño con la ventana, al plegar o deslizar el panel o cuando la lectura ocupa otra línea
  const ro = new ResizeObserver(update);
  for (const el of [$('#stage'), $('#topbar'), ...controls]) ro.observe(el);
  deskMQ?.addEventListener('change', () => { syncSheetMode(); update(); });
  dockMQ?.addEventListener('change', update); // la franja de la barra cambia de alto
  addEventListener('resize', () => { if (!deskMQ?.matches) openSheet(sheet); });
  update();
}
