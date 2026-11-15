/**
 * Barra de acciones fija arriba a la izquierda, bajo la cabecera, solo con iconos (su nombre, en el título). Siempre
 * empieza con «＋ Agregar ▾» en el mismo punto (imagen o PDF, texto, pegar); a su lado, las órdenes de lo seleccionado
 * (una capa o varias) o los controles de la herramienta activa (recorte, borrador, varita, colocar un texto).
 * Las propiedades (tamaño, giro, opacidad, alinear…) están en la pestaña Selección del panel.
 * Nada se desplaza escondido: en pantallas estrechas, lo que no cabe va al menú «Más».
 */
import {
  applyCrop, autoBackground, cancelCrop, duplicateSelected, enterCrop, groupSelected, removeLayer, removeSelected,
  selectedGroup, setCropRatio, setMode, toggleLocked, ungroupSelected,
} from '../actions';
import { RATIOS } from '../constants';
import { $ } from '../dom';
import { DELK, deskMQ, dockMQ, isTouch, MOD, SHIFT } from '../platform';
import { dirty } from '../render';
import { S, st, view } from '../state';
import { ICON, type IconName } from './icons';
import { addMenu, groupMenu, layerMenu, openMenu, ratioMenu } from './menu';
import { updateHint } from './panel';
import { cancelTextPlacement, editText } from '../text/editor';
import { isText } from '../text/text';

let bar: HTMLElement;

/** Botón de la barra. opt: la etiqueta solo se ve en la barra acoplada (móvil). cls «dw»: solo si la barra acoplada tiene sitio. */
function tb(icon: IconName | null, label: string, act: string, title = label, cls = '', opt = false) {
  const lab = label ? `<span${opt ? ' class="opt"' : ''}>${label}</span>` : '';
  return `<button type="button" class="tb ${cls}" data-act="${act}" title="${title}" aria-label="${title}">${icon ? ICON[icon] : ''}${lab}</button>`;
}
const SEP = '<span class="sep"></span>';
/** Separador que solo se ve junto a botones «dw» (barra acoplada con sitio). */
const SEP_DW = '<span class="sep dw"></span>';

/**
 * «＋ Agregar ▾»: siempre el primero, en el mismo punto. Con una herramienta activa se apaga (no se mueve); mientras
 * se elige dónde poner un texto, se ve marcado.
 */
const addBtn = () =>
  `<button type="button" class="tb" data-act="add" aria-haspopup="menu" title="Agregar imagen o PDF, texto o pegar" aria-label="Agregar"`
  + `${st.placingText ? ' aria-pressed="true"' : ''}${S.mode !== 'move' ? ' disabled' : ''}>`
  + `${ICON.plus}<span>Agregar</span>${ICON.chevronDown.replace('class="', 'class="chev ')}</button>`;

/** Eligiendo dónde va un texto: en el móvil (sin pista) lo dice la barra; Cancelar en los dos. */
const placingBar = (docked: boolean) =>
  (docked ? `<span class="mini">${isTouch() ? 'Toca' : 'Haz clic'} donde quieras el texto</span>` : '')
  + tb('x', 'Cancelar', 'cancelText', 'Cancelar (Esc)');

/** Varias capas: las órdenes (agrupar, duplicar, quitar); alinear, repartir, ocultar y bloquear son propiedades del panel. */
function groupBar(docked: boolean) {
  const whole = selectedGroup() != null;
  return tb(whole ? 'ungroup' : 'group', whole ? 'Desagrupar' : 'Agrupar', 'groupToggle', whole ? `Desagrupar (${MOD}${SHIFT}G)` : `Agrupar (${MOD}G)`)
    + tb('dup', 'Duplicar', 'dupSel', `Duplicar (${MOD}D)`)
    + SEP + tb('more', 'Más', 'moreGroup', docked ? 'Más opciones: alinear, quitar…' : 'Más opciones (clic derecho)', '', true)
    + (docked ? '' : tb('del', 'Quitar', 'delSel', `Quitar del póster (${DELK})`, 'danger', true));
}

/**
 * Barra acoplada abajo (móvil o táctil): no cabe todo en un teléfono. Se queda lo principal a la vista y el resto
 * pasa al menú «Más» (que incluye Quitar, lejos del pulgar); la Varita, solo si hay sitio (clase dw, ver global.css;
 * si no, está en Más › Borrar zonas).
 */
function dockBar(): string {
  if (st.sel?.locked) return `<span class="mini">${ICON.lock} Bloqueada</span>${SEP}` + tb('lockOpen', 'Desbloquear', 'unlock') + tb('more', 'Más', 'more', 'Más opciones');
  switch (S.mode) {
    case 'move':
      return (isText(st.sel) ? tb('text', 'Editar texto', 'editText')
        : tb('crop', 'Recortar', 'crop') + tb('bg', 'Quitar fondo', 'autobg') + tb('erase', 'Borrador', 'erase') + tb('wand', 'Varita', 'wand', 'Varita', 'dw'))
        + SEP + tb('more', 'Más', 'more', 'Más opciones: girar, voltear, duplicar, quitar…');
    case 'crop': {
      const cur = RATIOS.find(([, r]) => String(r) === S.cropRatioKey)?.[0] ?? 'Libre';
      return tb('crop', cur, 'ratioMenu', 'Proporción del recorte') + SEP
        + tb('x', 'Cancelar', 'cancelCrop') + tb('check', 'Aplicar', 'applyCrop', 'Aplicar', 'primary');
    }
    case 'erase':
      return `<button type="button" class="tb" data-act="bm" data-m="erase" aria-pressed="${S.brushMode === 'erase'}">${ICON.erase}<span>Borrar</span></button>`
        + `<button type="button" class="tb" data-act="bm" data-m="restore" aria-pressed="${S.brushMode === 'restore'}">${ICON.restore}<span>Restaurar</span></button>`
        + `${SEP}<label class="mini"><input type="range" id="bBrush" aria-label="Tamaño del pincel" min="4" max="90" value="${S.brush}"><output id="bBrushOut">${S.brush} px</output></label>`
        + SEP + tb('check', 'Listo', 'done', 'Listo', 'primary');
    case 'wand':
      return `<label class="mini"><input type="range" id="bTol" aria-label="Tolerancia" min="5" max="140" value="${S.tol}"><output id="bTolOut">${S.tol}</output></label>`
        + `<label class="mini"><input type="checkbox" id="bContig" ${S.contig ? 'checked' : ''}> Solo zona</label>`
        + SEP_DW + tb('bg', 'Quitar fondo', 'autobg', 'Quitar el fondo', 'dw') + SEP + tb('check', 'Listo', 'done', 'Listo', 'primary');
  }
}

/** Escritorio: una capa seleccionada (o su herramienta activa). */
function deskBar(): string {
  // bloqueada: nada se puede editar; solo desbloquear o el menú
  if (st.sel?.locked) {
    return `<span class="mini">${ICON.lock} Bloqueada</span>` + SEP + tb('lockOpen', 'Desbloquear', 'unlock')
      + tb('more', 'Más', 'more', 'Más opciones (clic derecho)', '', true);
  }
  switch (S.mode) {
    case 'move':
      // girar y voltear están junto a la rotación, en la pestaña Selección (y en Más, R y H)
      return (isText(st.sel) ? tb('text', 'Editar texto', 'editText', 'Editar el texto (doble clic o Enter)')
        : tb('crop', 'Recortar', 'crop', 'Recortar (doble clic)') + tb('bg', 'Quitar fondo', 'autobg', 'Quitar el fondo (si es de un color)')
        + tb('erase', 'Borrador', 'erase', 'Borrador: borra o recupera a mano (E)') + tb('wand', 'Varita', 'wand', 'Varita: borra un color (W)'))
        + SEP + tb('more', 'Más', 'more', 'Más opciones (clic derecho)', '', true) + tb('del', 'Quitar', 'delete', `Quitar del póster (${DELK})`, 'danger', true);
    case 'crop':
      return RATIOS.map(([t, r]) => `<button type="button" class="tb ratio" data-act="ratio" data-r="${String(r)}" aria-pressed="${S.cropRatioKey === String(r)}">${t}</button>`).join('')
        + SEP + tb('x', 'Cancelar', 'cancelCrop', 'Cancelar (Esc)') + tb('check', 'Aplicar', 'applyCrop', 'Aplicar (Enter)', 'primary');
    case 'erase':
      return `<button type="button" class="tb" data-act="bm" data-m="erase" aria-pressed="${S.brushMode === 'erase'}">${ICON.erase}<span>Borrar</span></button>`
        + `<button type="button" class="tb" data-act="bm" data-m="restore" aria-pressed="${S.brushMode === 'restore'}">${ICON.restore}<span>Restaurar</span></button>`
        + `${SEP}<label class="mini">Pincel <input type="range" id="bBrush" min="4" max="90" value="${S.brush}"><output id="bBrushOut">${S.brush} px</output></label>`
        + SEP + tb('check', 'Listo', 'done', 'Listo (Esc)', 'primary');
    case 'wand':
      return `<label class="mini">Tolerancia <input type="range" id="bTol" min="5" max="140" value="${S.tol}"><output id="bTolOut">${S.tol}</output></label>`
        + `<label class="mini"><input type="checkbox" id="bContig" ${S.contig ? 'checked' : ''}> Solo zona tocada</label>`
        + SEP + tb('bg', 'Quitar fondo', 'autobg', 'Quitar el fondo (si es de un color)') + tb('check', 'Listo', 'done', 'Listo (Esc)', 'primary');
  }
}

export function renderBar() {
  const docked = !!dockMQ?.matches;
  const group = st.group.length > 1 && S.mode === 'move';
  const one = !group && !!st.sel && !st.sel.hidden;
  const ctx = st.placingText ? placingBar(docked) : group ? groupBar(docked) : one ? (docked ? dockBar() : deskBar()) : '';
  bar.innerHTML = addBtn() + (ctx ? SEP + ctx : ''); // solo constantes y números: sin datos del usuario
  bar.hidden = false;
  bar.querySelector<HTMLInputElement>('#bBrush')?.addEventListener('input', (e) => {
    S.brush = +(e.target as HTMLInputElement).value;
    $('#bBrushOut').textContent = S.brush + ' px';
    st.hover = { x: view.CW / 2, y: view.CH / 2 };
    dirty();
  });
  bar.querySelector<HTMLInputElement>('#bTol')?.addEventListener('input', (e) => {
    S.tol = +(e.target as HTMLInputElement).value;
    $('#bTolOut').textContent = String(S.tol);
  });
  bar.querySelector<HTMLInputElement>('#bContig')?.addEventListener('change', (e) => { S.contig = (e.target as HTMLInputElement).checked; });
  updateHint();
  fitKey = ''; // contenido nuevo: se vuelve a medir
  positionBar();
}

/** Lo que decide cómo encaja la fila de abajo: si cambia, se vuelve a medir (ver fitBar). */
let fitKey = '';
/** Coloca la barra (corre en cada fotograma: solo mide si cambió el sitio o el contenido). */
export function positionBar() {
  if (!bar || bar.hidden) return;
  const docked = !!dockMQ?.matches;
  if (bar.classList.contains('dock') !== docked) bar.classList.toggle('dock', docked);
  // el ancho del lienzo y del panel
  const key = `${view.CW}|${view.ins.r}|${docked}`;
  if (key !== fitKey) { fitKey = key; fitBar(); }
  // la línea de estado: solo con ratón y con la isla de vista abajo (escritorio)
  $('#hint').hidden = docked || !deskMQ?.matches;
  // fija arriba a la izquierda, bajo la cabecera y alineada con ella, siempre en el mismo punto
  bar.style.left = `${Math.round($('#topbar').getBoundingClientRect().left)}px`;
  bar.style.top = `${barTop()}px`;
  bar.style.bottom = '';
}
/** La barra va 8 px por debajo de la cabecera (en coordenadas del lienzo). */
export const barTop = () => Math.round($('#topbar').getBoundingClientRect().bottom - $('#stage').getBoundingClientRect().top + 8);

/** Que la barra no pase bajo el panel de la selección (se mide al cambiar la ventana o el panel). */
export function fitBar() {
  if (!bar || bar.hidden || !view.CW) return;
  bar.style.maxWidth = `${Math.max(120, view.CW - view.ins.r - 2 * EDGE)}px`;
}
/** Margen de la barra con el borde de la ventana, el mismo que el de la cabecera (left-3). */
const EDGE = 12;

export function initContextBar() {
  bar = $('#ctxbar');
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());
  bar.addEventListener('contextmenu', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-act]');
    const sel = st.sel;
    if (!b) return;
    const r = b.getBoundingClientRect();
    // los menús se abren hacia el lienzo: debajo con la barra arriba (escritorio), encima con la barra abajo
    // (el menú se pone encima solo si debajo no cabe)
    const br = bar.getBoundingClientRect(), y = br.top < innerHeight / 2 ? br.bottom + 4 : br.top - 4;
    // lo que no depende de una capa: agregar, colocar un texto y varias seleccionadas
    switch (b.dataset.act) {
      case 'add': openMenu(r.left, y, addMenu()); return;
      case 'cancelText': cancelTextPlacement(); return;
      case 'groupToggle': if (selectedGroup() != null) ungroupSelected(); else groupSelected(); return;
      case 'dupSel': duplicateSelected(); return;
      case 'moreGroup': openMenu(r.left, y, groupMenu()); return;
      case 'delSel': removeSelected(); return;
    }
    if (!sel) return;
    switch (b.dataset.act) {
      case 'unlock': toggleLocked(sel); break;
      case 'crop': enterCrop(); break;
      case 'editText': if (isText(sel)) editText(sel); break;
      case 'autobg': autoBackground(); break;
      case 'erase': setMode('erase'); break;
      case 'wand': setMode('wand'); break;
      case 'more': openMenu(r.left, y, layerMenu(sel)); break;
      case 'delete': removeLayer(sel); break;
      case 'ratio': setCropRatio(b.dataset.r ?? 'null'); break;
      case 'ratioMenu': openMenu(r.left, y, ratioMenu(RATIOS, S.cropRatioKey, setCropRatio)); break;
      case 'cancelCrop': cancelCrop(); break;
      case 'applyCrop': applyCrop(); break;
      case 'bm': S.brushMode = b.dataset.m === 'restore' ? 'restore' : 'erase'; renderBar(); break;
      case 'done': setMode('move'); break;
    }
  });
  dockMQ?.addEventListener('change', () => renderBar());

}
