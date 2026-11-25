/**
 * Las dos barras de abajo, solo con iconos (su nombre, en el título):
 * - la de herramientas (#toolbar, en Workspace.astro), abajo en el centro y siempre en el mismo sitio: Mover,
 *   Texto y Forma; Recortar, Borrador, Varita y Quitar fondo, que se apagan sin una imagen seleccionada; y al final
 *   «Opciones del póster» (⋮), las de la página, haya algo seleccionado o no;
 * - la de opciones (#ctxbar), justo encima y solo cuando hace falta: los controles de la herramienta activa
 *   (recorte, borrador, varita, colocar un texto) o «Editar texto».
 * Las propiedades (tamaño, giro, opacidad, alinear…) y las órdenes de lo seleccionado (orden de capas, duplicar,
 * agrupar, eliminar) están en el panel de la selección.
 * Nada se desplaza escondido: en pantallas estrechas, lo que no cabe va al menú de la imagen.
 */
import { applyCrop, autoBackground, cancelCrop, setBrushMode, setCropRatio, setMode, toggleLocked } from '../actions';
import { RATIOS } from '../constants';
import { $, $$ } from '../dom';
import { deskMQ, dockMQ, isTouch } from '../platform';
import { dirty } from '../render';
import { S, st, view } from '../state';
import { ICON, type IconName } from './icons';
import { emptyMenu, openMenu, ratioMenu, shapeMenu } from './menu';
import { placeStatusRow, sheetPeek } from './layout';
import { updateHint } from './panel';
import { cancelTextPlacement, editText, startTextPlacement } from '../text/editor';
import { isText } from '../text/text';
import type { Mode } from '../types';
import type { MaskOp } from '../pixels';
import { invertWandSelection, retuneWand, wandSelection } from '../wand';

let bar: HTMLElement;
let tools: HTMLElement;

/** Botón de la barra. opt: la etiqueta solo se ve en la barra acoplada (móvil). */
function tb(icon: IconName | null, label: string, act: string, title = label, cls = '', opt = false) {
  const lab = label ? `<span${opt ? ' class="opt"' : ''}>${label}</span>` : '';
  return `<button type="button" class="tb ${cls}" data-act="${act}" title="${title}" aria-label="${title}">${icon ? ICON[icon] : ''}${lab}</button>`;
}
const SEP = '<span class="sep"></span>';

/* ---------- barra de herramientas ---------- */

/** Las herramientas de píxeles (recortar, borrador, varita) necesitan una sola imagen a la vista, sin bloquear. */
const editable = () => !!st.sel && st.group.length < 2 && !st.sel.hidden && !st.sel.locked && !isText(st.sel);

/** Marca la herramienta activa y apaga las que no se pueden usar ahora. */
function syncToolbar() {
  const can = editable();
  for (const b of $$<HTMLButtonElement>('#toolbar [data-tool]')) {
    const t = b.dataset.tool!;
    if (t === 'bg') { b.disabled = !can || S.mode === 'crop'; continue; }
    if (t === 'shape' || t === 'more') continue;
    const on = t === 'move' ? S.mode === 'move' && !st.placingText : t === 'text' ? st.placingText : S.mode === t;
    b.setAttribute('aria-pressed', String(on));
    if (t === 'crop' || t === 'erase' || t === 'wand') b.disabled = !can && !on;
  }
}

/** Pulsar una herramienta: la activa; pulsar la que ya está activa vuelve a Mover (como «Listo»). */
function pickTool(b: HTMLButtonElement) {
  const t = b.dataset.tool!;
  const y = tools.getBoundingClientRect().top - 6, x = b.getBoundingClientRect().left; // los menús, hacia arriba
  // «Opciones del póster»: las de la página (las del clic derecho en el fondo), no las de lo seleccionado
  if (t === 'more') {
    if (S.mode === 'crop') applyCrop();
    openMenu(x, y, emptyMenu());
    return;
  }
  if (t === 'shape') {
    if (S.mode !== 'move') setMode('move');
    cancelTextPlacement();
    openMenu(x, y, shapeMenu());
    return;
  }
  if (t === 'text') { startTextPlacement(); return; } // si ya se estaba colocando, lo cancela
  if (t === 'bg') { cancelTextPlacement(); void autoBackground(); return; }
  cancelTextPlacement();
  setMode(t === 'move' || S.mode === t ? 'move' : (t as Mode));
}

/* ---------- barra de opciones ---------- */

/**
 * Eligiendo dónde va un texto: en el móvil (sin pista) lo dice la barra; en escritorio, la línea de estado. Sin
 * Cancelar: Texto queda marcado en la barra de herramientas y pulsarlo otra vez (o Esc) lo cancela.
 */
const placingBar = (docked: boolean) =>
  docked ? `<span class="mini">${isTouch() ? 'Toca' : 'Haz clic'} donde quieras el texto</span>` : '';

/** Botones Borrar y Restaurar del borrador (X cambia entre los dos). */
const brushModes = () =>
  `<button type="button" class="tb" data-act="bm" data-m="erase" title="Borrar (X: cambiar a Restaurar)" aria-pressed="${S.brushMode === 'erase'}">${ICON.erase}<span>Borrar</span></button>`
  + `<button type="button" class="tb" data-act="bm" data-m="restore" title="Restaurar lo borrado (X: cambiar a Borrar)" aria-pressed="${S.brushMode === 'restore'}">${ICON.restore}<span>Restaurar</span></button>`;

/**
 * Una capa seleccionada (o su herramienta activa); lo demás, en su menú (clic derecho, pulsación larga o «Más
 * opciones» de su fila en Capas). Acoplada (móvil o táctil): los deslizadores llevan su nombre solo para lectores de
 * pantalla.
 */
function layerBar(docked: boolean): string {
  // bloqueada: nada se puede editar; solo desbloquear o el menú
  if (st.sel?.locked) {
    return `<span class="mini">${ICON.lock} Bloqueada</span>` + SEP + tb('lockOpen', 'Desbloquear', 'unlock');
  }
  const done = tb('check', 'Listo', 'done', docked ? 'Listo' : 'Listo (Esc)', 'primary');
  switch (S.mode) {
    case 'move':
      // las herramientas están en la barra de abajo; girar y voltear, junto a la rotación (pestaña Selección, Más, R y H)
      // Quitar fondo está en la barra de herramientas, con las otras herramientas de la imagen
      // duplicar, agrupar, eliminar y el orden están en la fila de acciones del panel de la selección
      return isText(st.sel) ? tb('text', 'Editar texto', 'editText', docked ? 'Editar texto' : 'Editar el texto (doble clic o Enter)') : '';
    case 'crop': {
      if (docked) {
        const cur = RATIOS.find(([, r]) => String(r) === S.cropRatioKey)?.[0] ?? 'Libre';
        return tb('crop', cur, 'ratioMenu', 'Proporción del recorte') + SEP
          + tb('x', 'Cancelar', 'cancelCrop') + tb('check', 'Aplicar', 'applyCrop', 'Aplicar', 'primary');
      }
      return RATIOS.map(([t, r]) => `<button type="button" class="tb ratio" data-act="ratio" data-r="${String(r)}" aria-pressed="${S.cropRatioKey === String(r)}">${t}</button>`).join('')
        + SEP + tb('x', 'Cancelar', 'cancelCrop', 'Cancelar (Esc)') + tb('check', 'Aplicar', 'applyCrop', 'Aplicar (Enter)', 'primary');
    }
    case 'erase':
      return brushModes()
        + `${SEP}<label class="mini" title="Tamaño del pincel: Alt + arrastrar con clic derecho, o [ ] , .">${docked ? '' : 'Pincel '}<input type="range" id="bBrush" aria-label="Tamaño del pincel" min="${BRUSH_MIN}" max="${BRUSH_MAX}" value="${S.brush}"><output id="bBrushOut">${S.brush} px</output></label>`
        + SEP + done;
    case 'wand': {
      // cómo se junta cada clic con lo elegido (en escritorio también con Shift y Alt) y, con algo elegido, qué hacer
      const op = (m: MaskOp, icon: IconName, label: string, keys: string) =>
        `<button type="button" class="tb" data-act="wop" data-op="${m}" title="${label}${docked ? '' : ` (${keys})`}" aria-label="${label}" aria-pressed="${st.wandOp === m}">${ICON[icon]}<span>${label}</span></button>`;
      const has = !!wandSelection();
      return `<label class="mini" title="Tolerancia: Alt + arrastrar con clic derecho, o [ ] , .">${docked ? '' : 'Tolerancia '}<input type="range" id="bTol" aria-label="Tolerancia" min="${TOL_MIN}" max="${TOL_MAX}" value="${S.tol}"><output id="bTolOut">${S.tol}</output></label>`
        + `<label class="mini"><input type="checkbox" id="bContig" ${S.contig ? 'checked' : ''}> ${docked ? 'Solo zona' : 'Solo zona tocada'}</label>`
        + SEP + op('new', 'selNew', 'Nueva zona', 'clic') + op('add', 'selAdd', 'Sumar zona', 'Shift + clic') + op('sub', 'selSub', 'Restar zona', 'Alt + clic')
        + (has ? SEP + tb('invert', 'Invertir', 'wInvert', 'Invertir lo elegido') : '')
        + SEP + done;
    }
  }
}

export function renderBar() {
  const docked = !!dockMQ?.matches;
  // varias seleccionadas: sus órdenes están en el panel de la selección (sin barra)
  const one = st.group.length < 2 && !!st.sel && !st.sel.hidden;
  const ctx = st.placingText ? placingBar(docked) : one ? layerBar(docked) : '';
  bar.innerHTML = ctx; // solo constantes y números: sin datos del usuario
  bar.hidden = !ctx;
  bar.querySelector<HTMLInputElement>('#bBrush')?.addEventListener('input', (e) => {
    setBrush(+(e.target as HTMLInputElement).value);
    st.hover = { x: view.CW / 2, y: view.CH / 2 };
  });
  bar.querySelector<HTMLInputElement>('#bTol')?.addEventListener('input', (e) => setTol(+(e.target as HTMLInputElement).value));
  bar.querySelector<HTMLInputElement>('#bContig')?.addEventListener('change', (e) => { S.contig = (e.target as HTMLInputElement).checked; retuneWand(); });
  syncToolbar();
  updateHint();
  posKey = ''; // contenido nuevo: se vuelve a medir
  positionBar();
}

/* ---------- posición ---------- */

/** Margen de las barras con el borde de la ventana, el mismo que el de la cabecera (left-3). */
const EDGE = 12;
/** Lo que decide dónde van las barras: si cambia, se vuelve a medir. */
let posKey = '';

/**
 * Coloca las dos barras (corre en cada fotograma: solo mide si cambió el sitio o el contenido).
 * - Herramientas: centrada abajo, a la altura de la isla de vista (escritorio) o sobre el panel inferior (móvil):
 *   sube con él cuando se abre a media altura; abierto del todo, las tapa. En escritorio no pisa el tamaño del póster
 *   (a la izquierda) ni la isla de vista (a la derecha): si centrada los tocaría, se corre hacia el hueco libre.
 * - Opciones: centrada encima, sin pasar bajo el panel de la selección.
 */
export function positionBar() {
  if (!bar || !tools) return;
  const docked = !!dockMQ?.matches, desk = !!deskMQ?.matches;
  if (bar.classList.contains('dock') !== docked) bar.classList.toggle('dock', docked);
  // la línea de estado: solo con ratón y con la isla de vista abajo (escritorio)
  $('#hint').hidden = docked || !desk;
  // alto del panel inferior (móvil): el que va a tener, para que las barras suban a la vez que él
  const sheetH = desk ? 0 : parseFloat(document.documentElement.style.getPropertyValue('--sheet-h')) || 0;
  const size = $('#posterSize');
  const key = `${view.CW}|${view.CH}|${view.ins.r}|${docked}|${desk}|${bar.hidden}|${sheetH}|${size.hidden}|${size.textContent}`;
  if (key === posKey) return;
  posKey = key;
  const s = $('#stage').getBoundingClientRect(), tw = tools.offsetWidth, th = tools.offsetHeight;
  let bottom = EDGE, left = Math.round((s.width - tw) / 2);
  if (desk) {
    const max = Math.round($('#tools').getBoundingClientRect().left - s.left - 8 - tw);
    const sr = size.getBoundingClientRect(), min = sr.width ? Math.round(sr.right - s.left + 8) : EDGE;
    left = Math.min(Math.max(left, min), max);
  } else {
    const peek = sheetPeek(), above = Math.max(peek, sheetH) + 8;
    // si encima del panel no caben las dos barras bajo la cabecera, se quedan sobre sus pestañas (el panel las tapa)
    const need = th + (bar.hidden ? 0 : 8 + bar.offsetHeight);
    bottom = above + need <= s.height - view.fit.t - 8 ? above : peek + 8;
  }
  left = tw <= s.width - 2 * EDGE ? Math.max(EDGE, left) : Math.max(0, Math.round((s.width - tw) / 2));
  tools.style.left = `${left}px`;
  tools.style.bottom = `${bottom}px`;
  placeStatusRow(); // el tamaño del póster y la línea de estado, a la izquierda de la barra
  // los avisos (toast) salen encima de las barras, sin taparlas
  const above = (h: number) => document.documentElement.style.setProperty('--above-bars', `${h + 10}px`);
  if (bar.hidden) { above(bottom + th); return; }
  const room = s.width - view.ins.r - 2 * EDGE;
  bar.style.maxWidth = `${Math.max(120, room)}px`;
  // se mide desde el borde izquierdo: en su sitio anterior (más a la derecha) se encogería para caber y mediría de menos
  bar.style.left = `${EDGE}px`;
  const bw = bar.offsetWidth, center = left + tw / 2;
  bar.style.left = `${Math.round(Math.max(EDGE, Math.min(center - bw / 2, EDGE + room - bw)))}px`;
  bar.style.bottom = `${bottom + th + 8}px`;
  above(bottom + th + 8 + bar.offsetHeight);
}

export function initContextBar() {
  bar = $('#ctxbar');
  tools = $('#toolbar');
  for (const el of [bar, tools]) {
    el.addEventListener('pointerdown', (e) => e.stopPropagation());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }
  tools.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLButtonElement>('[data-tool]');
    if (b && !b.disabled) pickTool(b);
  });
  bar.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-act]');
    const sel = st.sel;
    if (!b) return;
    // los menús se abren hacia arriba, sobre el lienzo (si arriba no cabe, debajo)
    const r = b.getBoundingClientRect(), y = bar.getBoundingClientRect().top - 6;
    if (!sel) return;
    switch (b.dataset.act) {
      case 'unlock': toggleLocked(sel); break;
      case 'editText': if (isText(sel)) editText(sel); break;
      case 'autobg': autoBackground(); break;
      case 'ratio': setCropRatio(b.dataset.r ?? 'null'); break;
      case 'ratioMenu': openMenu(r.left, y, ratioMenu(RATIOS, S.cropRatioKey, setCropRatio)); break;
      case 'cancelCrop': cancelCrop(); break;
      case 'applyCrop': applyCrop(); break;
      case 'bm': setBrushMode(b.dataset.m === 'restore' ? 'restore' : 'erase'); break;
      case 'wop': st.wandOp = (b.dataset.op as MaskOp) ?? 'new'; renderBar(); break;
      case 'wInvert': invertWandSelection(); break;
      case 'done': setMode('move'); break;
    }
  });
  dockMQ?.addEventListener('change', () => renderBar());
}

/** Límites de la tolerancia de la varita, los de su deslizador. */
export const TOL_MIN = 5, TOL_MAX = 140;
/** Cambia la tolerancia de la varita (deslizador, o [ ] y , .) y la refleja en la barra. */
export function setTol(v: number) {
  S.tol = Math.round(Math.min(TOL_MAX, Math.max(TOL_MIN, v)));
  const input = document.querySelector<HTMLInputElement>('#bTol'), out = document.querySelector('#bTolOut');
  if (input) input.value = String(S.tol);
  if (out) out.textContent = String(S.tol);
  retuneWand(); // lo elegido con la varita se rehace con la tolerancia nueva
}

/** Límites del pincel (px de pantalla), los del deslizador de la barra. */
export const BRUSH_MIN = 4, BRUSH_MAX = 90;
/** Cambia el tamaño del pincel (deslizador, o [ y ] como en Photoshop) y lo refleja en la barra y en el círculo. */
export function setBrush(px: number) {
  S.brush = Math.round(Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, px)));
  const input = document.querySelector<HTMLInputElement>('#bBrush'), out = document.querySelector('#bBrushOut');
  if (input) input.value = String(S.brush);
  if (out) out.textContent = S.brush + ' px';
  dirty();
}
