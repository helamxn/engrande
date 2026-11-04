/**
 * Disposición en escritorio: el lienzo es el fondo de la app y la cabecera, las herramientas, la lectura y el panel
 * flotan encima. Aquí se mide cuánto tapan esas islas (la vista encaja el póster en lo que queda libre)
 * y se pliega o despliega el panel.
 */
import { $ } from '../dom';
import { deskMQ } from '../platform';
import { setInsets } from '../view';

const KEY = 'pliego.panel';
let free: HTMLElement;

/** Márgenes que tapan las islas, en px desde cada borde del lienzo. En móvil no hay islas: todo libre. */
function measure() {
  if (!deskMQ?.matches) return { t: 0, r: 0, b: 0, l: 0 };
  const s = $('#stage').getBoundingClientRect();
  const head = $('header').getBoundingClientRect();
  const foot = Math.min($('#tools').getBoundingClientRect().top, $('#readout').getBoundingClientRect().top);
  const panel = $('#panel').getBoundingClientRect();
  return {
    t: Math.round(head.bottom - s.top),
    // plegado, el panel mide 0: solo queda el botón para mostrarlo, que va en la franja de la cabecera
    r: panel.width ? Math.round(s.right - panel.left) : 0,
    b: Math.round(s.bottom - foot),
    l: 0,
  };
}

function update() {
  const ins = measure();
  free.style.inset = `${ins.t}px ${ins.r}px ${ins.b}px ${ins.l}px`;
  setInsets(ins);
}

export const isPanelOff = () => document.body.classList.contains('panel-off');

/** Pliega o despliega el panel (solo en escritorio). Se recuerda en este navegador. */
export function togglePanel(on = isPanelOff()) {
  if (!deskMQ?.matches) return;
  const active = document.activeElement;
  document.body.classList.toggle('panel-off', !on);
  $('#panelHide').setAttribute('aria-expanded', String(on));
  $('#panelShow').setAttribute('aria-expanded', String(on));
  try { localStorage.setItem(KEY, on ? 'on' : 'off'); } catch { /* sin almacenamiento: no se recuerda */ }
  // el foco no se pierde con el botón que desaparece: pasa al que lo sustituye
  if (active === $('#panelHide') || active === $('#panelShow') || (!on && $('#panel').contains(active))) {
    $<HTMLButtonElement>(on ? '#panelHide' : '#panelShow').focus();
  }
  update();
}

export function initLayout() {
  free = $('#free');
  let off = false;
  try { off = localStorage.getItem(KEY) === 'off'; } catch { /* sin almacenamiento */ }
  document.body.classList.toggle('panel-off', off);
  $('#panelHide').setAttribute('aria-expanded', String(!off));
  $('#panelShow').setAttribute('aria-expanded', String(!off));
  $('#panelHide').addEventListener('click', () => togglePanel(false));
  $('#panelShow').addEventListener('click', () => togglePanel(true));

  // las islas cambian de tamaño con la ventana, al plegar el panel o cuando la lectura ocupa otra línea
  const ro = new ResizeObserver(update);
  for (const sel of ['#stage', 'header', '#tools', '#readout', '#panel']) ro.observe($(sel));
  deskMQ?.addEventListener('change', update);
  update();
}
