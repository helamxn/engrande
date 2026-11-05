/** Barra de herramientas que flota junto a la imagen seleccionada (o acoplada abajo en móvil). */
import {
  alignSelected, applyCrop, autoBackground, cancelCrop, distributeSelected, duplicateSelected, enterCrop, flip,
  removeLayer, removeSelected, rotate90, setCropRatio, setMode, toggleLocked,
} from '../actions';
import type { AlignEdge } from '../geometry';
import { RATIOS } from '../constants';
import { $ } from '../dom';
import { DELK, dockMQ, MOD } from '../platform';
import { cropPts, dirty } from '../render';
import { S, st, view } from '../state';
import { isGesturing } from '../input/pointer';
import { ICON, type IconName } from './icons';
import { alignMenu, distributeMenu, groupMenu, layerMenu, openMenu, ratioMenu } from './menu';
import { updateHint } from './panel';

let bar: HTMLElement;
/**
 * Tamaño de la barra, medido solo cuando cambia su contenido o se acopla/desacopla. positionBar() corre en cada
 * fotograma y leer offsetWidth ahí obligaba al navegador a recalcular el diseño de la página cada vez.
 */
let barSize: { w: number; h: number } | null = null;

/** Botón de la barra. opt: la etiqueta solo se ve en la barra acoplada (móvil). cls «dw»: solo si la barra acoplada tiene sitio. */
function tb(icon: IconName | null, label: string, act: string, title = label, cls = '', opt = false) {
  const lab = label ? `<span${opt ? ' class="opt"' : ''}>${label}</span>` : '';
  return `<button type="button" class="tb ${cls}" data-act="${act}" title="${title}" aria-label="${title}">${icon ? ICON[icon] : ''}${lab}</button>`;
}
const SEP = '<span class="sep"></span>';
/** Separador que solo se ve junto a botones «dw» (barra acoplada con sitio). */
const SEP_DW = '<span class="sep dw"></span>';

/**
 * Barra acoplada abajo (móvil o táctil): no cabe todo en un teléfono y antes hacía scroll sin avisar.
 * Se queda lo principal a la vista y el resto pasa al menú «Más» (que incluye Quitar, lejos del pulgar);
 * Girar y Voltear aparecen solo si hay sitio (clase dw, ver global.css).
 */
function dockBar(): string {
  const n = st.group.length;
  if (n > 1 && S.mode === 'move') {
    return `<span class="mini"><b class="text-fg">${n}</b> imágenes</span>${SEP}`
      + tb('alignLeft', 'Alinear', 'alignMenu', 'Alinear')
      + `<button type="button" class="tb" data-act="distMenu" title="Repartir" aria-label="Repartir"${n < 3 ? ' disabled' : ''}>${ICON.distributeH}<span>Repartir</span></button>`
      + tb('dup', 'Duplicar', 'dupGroup', 'Duplicar') + tb('more', 'Más', 'more', 'Más opciones');
  }
  if (st.sel?.locked) return `<span class="mini">${ICON.lock} Bloqueada</span>${SEP}` + tb('lockOpen', 'Desbloquear', 'unlock') + tb('more', 'Más', 'more', 'Más opciones');
  switch (S.mode) {
    case 'move':
      return tb('crop', 'Recortar', 'crop') + tb('bg', 'Quitar fondo', 'autobg') + tb('erase', 'Borrador', 'erase') + tb('wand', 'Varita', 'wand')
        + SEP_DW + tb('rot', 'Girar', 'rotR', 'Girar 90°', 'dw') + tb('flip', 'Voltear', 'flipX', 'Voltear en horizontal', 'dw')
        + SEP + tb('more', 'Más', 'more', 'Más opciones: girar, voltear, duplicar, quitar…');
    case 'crop': {
      const cur = RATIOS.find(([, r]) => String(r) === S.cropRatioKey)?.[0] ?? 'Libre';
      return tb('crop', cur, 'ratioMenu', 'Proporción del recorte') + SEP
        + tb('x', 'Cancelar', 'cancelCrop') + tb('check', 'Aplicar', 'applyCrop', 'Aplicar', 'primary');
    }
    case 'erase':
      return `<button type="button" class="tb" data-act="bm" data-m="erase" aria-pressed="${S.brushMode === 'erase'}">${ICON.erase}<span>Borrar</span></button>`
        + `<button type="button" class="tb" data-act="bm" data-m="restore" aria-pressed="${S.brushMode === 'restore'}">${ICON.restore}<span>Restaurar</span></button>`
        + `${SEP}<label class="mini" aria-label="Tamaño del pincel"><input type="range" id="bBrush" min="4" max="90" value="${S.brush}"><output id="bBrushOut">${S.brush} px</output></label>`
        + SEP + tb('check', 'Listo', 'done', 'Listo', 'primary');
    case 'wand':
      return `<label class="mini" aria-label="Tolerancia"><input type="range" id="bTol" min="5" max="140" value="${S.tol}"><output id="bTolOut">${S.tol}</output></label>`
        + `<label class="mini"><input type="checkbox" id="bContig" ${S.contig ? 'checked' : ''}> Solo zona</label>`
        + SEP_DW + tb('bg', 'Quitar fondo', 'autobg', 'Quitar el fondo', 'dw') + SEP + tb('check', 'Listo', 'done', 'Listo', 'primary');
  }
}

/** Barra de varias imágenes: alinear entre sí, repartir (3 o más), duplicar y quitar. */
function groupBar() {
  const n = st.group.length, dis = n < 3 ? ' disabled' : '';
  const al = (icon: IconName, edge: AlignEdge, t: string) =>
    `<button type="button" class="tb" data-act="align" data-e="${edge}" title="${t}" aria-label="${t}">${ICON[icon]}</button>`;
  const ds = (icon: IconName, axis: 'x' | 'y', t: string) =>
    `<button type="button" class="tb" data-act="dist" data-a="${axis}" title="${t}" aria-label="${t}"${dis}>${ICON[icon]}</button>`;
  return `<span class="mini"><b class="text-fg">${n}</b> imágenes</span>${SEP}`
    + al('alignLeft', 'left', 'Alinear a la izquierda') + al('alignHCenter', 'hcenter', 'Alinear al centro (horizontal)')
    + al('alignRight', 'right', 'Alinear a la derecha') + al('alignTop', 'top', 'Alinear arriba')
    + al('alignVCenter', 'vcenter', 'Alinear al centro (vertical)') + al('alignBottom', 'bottom', 'Alinear abajo')
    + SEP + ds('distributeH', 'x', n < 3 ? 'Repartir en horizontal (3 o más imágenes)' : 'Repartir en horizontal')
    + ds('distributeV', 'y', n < 3 ? 'Repartir en vertical (3 o más imágenes)' : 'Repartir en vertical')
    + SEP + tb('dup', 'Duplicar', 'dupGroup', `Duplicar (${MOD}D)`, '', true)
    + tb('more', 'Más', 'more', 'Más opciones (clic derecho)', '', true)
    + tb('del', 'Quitar', 'delGroup', `Quitar del póster (${DELK})`, 'danger', true);
}

export function renderBar() {
  const group = st.group.length > 1 && S.mode === 'move';
  if (!group && (!st.sel || st.sel.hidden)) { bar.hidden = true; $('#hint').hidden = false; updateHint(); return; }
  let h = '';
  if (dockMQ?.matches) {
    h = dockBar();
  } else if (group) {
    h = groupBar();
  } else if (st.sel?.locked) {
    // bloqueada: nada se puede editar; solo desbloquear o el menú
    h = `<span class="mini">${ICON.lock} Bloqueada</span>` + SEP + tb('lockOpen', 'Desbloquear', 'unlock')
      + tb('more', 'Más', 'more', 'Más opciones (clic derecho)', '', true);
  } else if (S.mode === 'move') {
    h = tb('crop', 'Recortar', 'crop', 'Recortar (doble clic)') + tb('bg', 'Quitar fondo', 'autobg', 'Quitar el fondo (si es de un color)')
      + tb('erase', 'Borrador', 'erase', 'Borrador: borra o recupera a mano (E)') + tb('wand', 'Varita', 'wand', 'Varita: borra un color (W)')
      + SEP + tb('rot', 'Girar', 'rotR', 'Girar 90° (R)', '', true) + tb('flip', 'Voltear', 'flipX', 'Voltear en horizontal (H)', '', true)
      + SEP + tb('more', 'Más', 'more', 'Más opciones (clic derecho)', '', true) + tb('del', 'Quitar', 'delete', `Quitar del póster (${DELK})`, 'danger', true);
  } else if (S.mode === 'crop') {
    h = RATIOS.map(([t, r]) => `<button type="button" class="tb ratio" data-act="ratio" data-r="${String(r)}" aria-pressed="${S.cropRatioKey === String(r)}">${t}</button>`).join('')
      + SEP + tb('x', 'Cancelar', 'cancelCrop', 'Cancelar (Esc)') + tb('check', 'Aplicar', 'applyCrop', 'Aplicar (Enter)', 'primary');
  } else if (S.mode === 'erase') {
    h = `<button type="button" class="tb" data-act="bm" data-m="erase" aria-pressed="${S.brushMode === 'erase'}">${ICON.erase}<span>Borrar</span></button>`
      + `<button type="button" class="tb" data-act="bm" data-m="restore" aria-pressed="${S.brushMode === 'restore'}">${ICON.restore}<span>Restaurar</span></button>`
      + `${SEP}<label class="mini">Pincel <input type="range" id="bBrush" min="4" max="90" value="${S.brush}"><output id="bBrushOut">${S.brush} px</output></label>`
      + SEP + tb('check', 'Listo', 'done', 'Listo (Esc)', 'primary');
  } else if (S.mode === 'wand') {
    h = `<label class="mini">Tolerancia <input type="range" id="bTol" min="5" max="140" value="${S.tol}"><output id="bTolOut">${S.tol}</output></label>`
      + `<label class="mini"><input type="checkbox" id="bContig" ${S.contig ? 'checked' : ''}> Solo zona tocada</label>`
      + SEP + tb('bg', 'Quitar fondo', 'autobg', 'Quitar el fondo (si es de un color)') + tb('check', 'Listo', 'done', 'Listo (Esc)', 'primary');
  }
  bar.innerHTML = h; // solo constantes y números: sin datos del usuario
  bar.hidden = false;
  barSize = null;
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
  positionBar();
}

export function positionBar() {
  const sel = st.sel;
  if (!bar || bar.hidden || (!sel && st.group.length < 2)) return;
  const docked = !!dockMQ?.matches;
  if (bar.classList.contains('dock') !== docked) { bar.classList.toggle('dock', docked); barSize = null; }
  bar.classList.toggle('ghost', isGesturing());
  $('#hint').hidden = docked;
  // acoplada: encima del panel inferior (móvil), que puede estar más o menos abierto
  if (docked) { bar.style.left = ''; bar.style.top = ''; bar.style.bottom = `${view.ins.b + 8}px`; bar.style.maxWidth = ''; return; }
  bar.style.bottom = '';
  // nunca más ancha que la zona libre (no se mete bajo el panel); si no cupiera, se desplaza por dentro
  bar.style.maxWidth = `${Math.max(120, view.CW - view.ins.l - view.ins.r - 16)}px`;
  const pts = sel ? cropPts(sel) : st.group.flatMap(cropPts), xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  barSize ??= { w: bar.offsetWidth, h: bar.offsetHeight };
  const bw = barSize.w, bh = barSize.h;
  // dentro de la zona libre: que no quede debajo de las islas flotantes (escritorio)
  const { ins } = view, top = ins.t + 8, left = ins.l + 8;
  const x = Math.min(Math.max((minX + maxX) / 2 - bw / 2, left), Math.max(left, view.CW - ins.r - bw - 8));
  let y = minY - bh - (S.mode === 'move' ? 46 : 16);
  if (y < top) { y = maxY + 40; if (y + bh > view.CH - ins.b - 8) y = top; }
  bar.style.left = Math.round(x) + 'px';
  bar.style.top = Math.round(y) + 'px';
}

export function initContextBar() {
  bar = $('#ctxbar');
  bar.addEventListener('pointerdown', (e) => e.stopPropagation());
  bar.addEventListener('contextmenu', (e) => e.preventDefault());
  bar.addEventListener('click', (e) => {
    const b = (e.target as Element).closest<HTMLElement>('[data-act]');
    const sel = st.sel;
    if (!b) return;
    if (!sel) {
      // barra del grupo
      switch (b.dataset.act) {
        case 'align': alignSelected(b.dataset.e as AlignEdge); break;
        case 'dist': distributeSelected(b.dataset.a === 'y' ? 'y' : 'x'); break;
        case 'dupGroup': duplicateSelected(); break;
        case 'delGroup': removeSelected(); break;
        case 'more': { const r = b.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, groupMenu()); break; }
        case 'alignMenu': { const r = b.getBoundingClientRect(); openMenu(r.left, r.top, alignMenu()); break; }
        case 'distMenu': { const r = b.getBoundingClientRect(); openMenu(r.left, r.top, distributeMenu()); break; }
      }
      return;
    }
    switch (b.dataset.act) {
      case 'unlock': toggleLocked(sel); break;
      case 'crop': enterCrop(); break;
      case 'autobg': autoBackground(); break;
      case 'erase': setMode('erase'); break;
      case 'wand': setMode('wand'); break;
      case 'rotR': rotate90(1)(); break;
      case 'flipX': flip('x')(); break;
      case 'more': { const r = b.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, layerMenu(sel)); break; }
      case 'delete': removeLayer(sel); break;
      case 'ratio': setCropRatio(b.dataset.r ?? 'null'); break;
      case 'ratioMenu': { const r = b.getBoundingClientRect(); openMenu(r.left, r.top, ratioMenu(RATIOS, S.cropRatioKey, setCropRatio)); break; }
      case 'cancelCrop': cancelCrop(); break;
      case 'applyCrop': applyCrop(); break;
      case 'bm': S.brushMode = b.dataset.m === 'restore' ? 'restore' : 'erase'; renderBar(); break;
      case 'done': setMode('move'); break;
    }
  });
  dockMQ?.addEventListener('change', () => renderBar());
}
