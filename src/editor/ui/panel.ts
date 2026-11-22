/** Panel lateral: pestañas, ajustes de hojas, propiedades de la imagen, lista de imágenes, exportación y lectura. */
import { listRange, type GroupRef } from '../groups';
import {
  afterChange, applyCrop, canStretch, centerSel, commonRotation, setGroupFrame, fitSel, groupMembers, groupName, hideSelected, lockSelected, markManual, renameGroup, renameLayer,
  reorder, select, selected, selectedGroup, selectMany, setOpacity, toggleGroupFlag, toggleHidden,
  toggleLocked, unstretchSel,
} from '../actions';
import { MAX_COLS_ROWS, PRESETS } from '../constants';
import { $, $$, freeCanvas, toast } from '../dom';
import { cm, cmGap, fmtMeasure, numberList, parseNum } from '../format';
import {
  applyFit, bboxMM, cropCenter, geo, isStretched, keepCenter, natRatio, newLayoutMemory, normDeg, pppOf, qualityOf, relayout,
  rotateLayer, scaleLayer, unionBox, visH, visW,
} from '../geometry';
import { commitPending, setPending, snap, snapSeries, takeSnap } from '../history';
import { initGuides } from './guides';
import { deskMQ, HI_AREA, isTouch } from '../platform';
import { rich } from './keys';
import { C, isFreshPoster, posterGeo, S, sheetsVisible, st } from '../state';
import { dirty } from '../render';
import { fitView } from '../view';
import { renderPdfPage } from '../io/pdf';
import { sheetsToPrint } from '../io/export';
import { canvasRevision, scheduleSave } from '../io/persist';
import { ICON } from './icons';
import { isPanelOff, openSheet, togglePanel } from './layout';
import { initListDrag } from './listdrag';
import { groupMenu, groupRowMenu, layerMenu, openMenu } from './menu';
import type { Quality, RelayoutMode } from '../geometry';
import { getPref, setPref } from '../prefs';
import type { Geo, Layer, LayoutSettings, Orient, Paper } from '../types';
import { syncTextPanel } from '../text/textpanel';
import { initSelectionCard, selectionKey, syncSelectionCard } from './selectioncard';
import { renderBar } from './contextbar';

/* ---------- pestañas (patrón ARIA tabs) ---------- */
/**
 * Cada sección aparece cuando hace falta.
 * - Escritorio y tableta: Póster y Capas son tarjetas propias (se abren con sus botones); el panel lateral es solo de
 *   la selección: aparece al elegir algo y se va al deseleccionar.
 * - Móvil: el panel inferior tiene las tres pestañas; al elegir algo pasa a Selección (salvo desde Capas: se sigue
 *   trabajando con la lista) y al deseleccionar vuelve a la de antes, si el cambio fue automático.
 */
const currentTab = () => $$<HTMLButtonElement>('[role=tab]').find((b) => b.getAttribute('aria-selected') === 'true')?.dataset.tab ?? 'sheets';
/** Móvil: pestaña a la que volver al deseleccionar (null: la actual la eligió el usuario). */
let autoFrom: string | null = null;
let lastKey: unknown = null;
function followSelection() {
  const key = selectionKey();
  if (key === lastKey) return;
  lastKey = key;
  if (deskMQ?.matches) { togglePanel(!!key); return; }
  const cur = currentTab();
  if (key) {
    if (cur !== 'image' && cur !== 'sel') { autoFrom = cur; showTab('sel'); }
  } else if (autoFrom && cur === 'sel') {
    showTab(autoFrom); autoFrom = null;
  }
}
/** Ctrl+\: muestra u oculta la tarjeta de Capas (escritorio). */
export function toggleLayersCard() { if (deskMQ?.matches) $('#layersCard').togglePopover(); }

/**
 * Lleva Póster y Capas a sus tarjetas (escritorio) o de vuelta al panel inferior (móvil). Son los mismos elementos:
 * sus controles y sus ids no cambian.
 */
function placePanes() {
  const desk = !!deskMQ?.matches, card = $('#selectionCard');
  for (const id of ['sheets', 'image'] as const) {
    const pane = $(`#pane-${id}`);
    if (desk) $(`[data-slot="${id}"]`).appendChild(pane);
    else card.before(pane);
  }
  if (desk) {
    for (const c of ['#posterCard', '#layersCard']) if ($(c).matches(':popover-open')) $(c).hidePopover();
    document.body.classList.toggle('panel-off', selectionKey() == null);
  }
  showTab(desk ? 'sel' : currentTab());
}

export function showTab(t: string) {
  for (const b of $$<HTMLButtonElement>('[role=tab]')) {
    const on = b.dataset.tab === t;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  // en escritorio cada sección está en su sitio (tarjeta o panel): todas a la vista
  const desk = !!deskMQ?.matches;
  for (const p of $$('[role=tabpanel]')) p.hidden = desk ? false : p.dataset.pane !== t;
}
/** Elegida a mano: se respeta (deja de ser un cambio automático). */
function pickTab(t: string) { autoFrom = null; showTab(t); }
/** Renombrar un grupo: lo selecciona entero y lleva al campo «Nombre del grupo». */
export function focusGroupName(gid: number) {
  selectMany(groupMembers(gid));
  if (isPanelOff()) togglePanel(true);
  openSheet('half');
  pickTab('sel');
  const el = $<HTMLInputElement>('#gName');
  el.focus(); el.select();
}
/** Renombrar: lleva al campo «Nombre» de la imagen seleccionada (abre la pestaña y, si estaba plegado, el panel). */
export function focusName() {
  if (!st.sel) return;
  if (isPanelOff()) togglePanel(true);
  openSheet('half');
  pickTab('sel');
  const el = $<HTMLInputElement>('#pName');
  el.focus(); el.select();
}

/* ---------- distribución de hojas ---------- */
let prevG: Geo | null = null;
/** Al cambiar las hojas: escalar el diseño (por defecto) o mantener el tamaño en cm. Se recuerda en este navegador. */
let relayoutMode: RelayoutMode = getPref('relayout') === 'keep' ? 'keep' : 'scale';
/** Diseño de referencia para que ir y volver entre distribuciones deje todo exactamente igual (ver relayout). */
const layoutMem = newLayoutMemory();
const RELAYOUT_NOTE: Record<RelayoutMode, string> = {
  scale: 'Las imágenes crecen o se encogen con el póster, sin deformarse.',
  keep: 'Las imágenes conservan sus cm y su posición desde la esquina superior izquierda.',
};
function syncRelayoutUI() {
  for (const b of $$('[data-relayout]')) b.setAttribute('aria-pressed', String(b.dataset.relayout === relayoutMode));
  $('#relayoutNote').textContent = RELAYOUT_NOTE[relayoutMode];
}
export function layoutChanged() {
  const g = posterGeo();
  if (prevG) relayout(st.layers, prevG, g, relayoutMode, layoutMem);
  prevG = g;
  syncLayoutUI(); syncSel(); renderList(); fitView();
  scheduleSave();
}
/** Calidad, marcas y guía (se guardan con el póster). */
export function syncExportUI() {
  for (const x of $$('[data-dpi]')) x.setAttribute('aria-pressed', String(Number(x.dataset.dpi) === S.dpi));
  $<HTMLInputElement>('#marks').checked = S.marks;
  $<HTMLInputElement>('#guide').checked = S.guide;
  $<HTMLInputElement>('#skipBlank').checked = !!S.skipBlank;
  syncLayoutUI();
  syncNewPoster();
}
/** Tras deshacer o rehacer: la distribución ya viene restaurada junto con las imágenes, solo se sincroniza la interfaz. */
export function layoutRestored() {
  const g = posterGeo(), changed = !prevG || prevG.W !== g.W || prevG.H !== g.H;
  prevG = g;
  syncLayoutUI();
  if (changed) fitView();
}

/**
 * Cambia un ajuste de la hoja guardando el paso de deshacer. Un arrastre continuo del mismo deslizador
 * cuenta como un solo paso; si el valor no cambia, no se guarda nada.
 */
function editLayout<K extends keyof LayoutSettings>(key: K, value: LayoutSettings[K], coalesce = false) {
  if (S[key] === value) return;
  const next = geo({ ...S, [key]: value });
  if (next.cols > MAX_COLS_ROWS || next.rows > MAX_COLS_ROWS) {
    if (key === 'margin' || key === 'overlap') $<HTMLInputElement>('#' + key).value = String(S[key]);
    toast(`Este tamaño necesita ${next.cols} × ${next.rows} hojas. El máximo es ${MAX_COLS_ROWS} por lado.`);
    syncLayoutUI();
    return;
  }
  applyCrop();
  if (coalesce) snapSeries('layout-' + key); else snap();
  (S as LayoutSettings)[key] = value;
  st.sheetsOn = true; // el usuario eligió la hoja: desde ahora se ven aunque el póster esté vacío
  layoutChanged();
}
export function syncLayoutUI() {
  const g = posterGeo(), exact = !!S.posterSize;
  $('#bySize').setAttribute('aria-pressed', String(exact));
  $('#bySheets').setAttribute('aria-pressed', String(!exact));
  $('#sizeFields').hidden = !exact;
  $('#sheetFields').hidden = exact;
  setField('#posterWidth', fmtMeasure(g.W / 10)); setField('#posterHeight', fmtMeasure(g.H / 10));
  if (exact) {
    const excessX = g.cols * (g.tw - g.ov) + g.ov - g.W;
    const excessY = g.rows * (g.th - g.ov) + g.ov - g.H;
    const trim = [excessX > 0.001 && `${fmtMeasure(excessX / 10)} cm a la derecha`,
      excessY > 0.001 && `${fmtMeasure(excessY / 10)} cm abajo`].filter(Boolean);
    const total = g.cols * g.rows;
    $('#tileSummary').textContent = `${g.cols} ${g.cols === 1 ? 'columna' : 'columnas'} × ${g.rows} ${g.rows === 1 ? 'fila' : 'filas'} · ${total} ${total === 1 ? 'hoja' : 'hojas'} ${S.paper}.`
      + (trim.length ? ` Tras quitar los márgenes, recorta ${trim.join(' y ')}.` : '');
  }
  $('#colsOut').textContent = String(S.cols);
  $('#rowsOut').textContent = String(S.rows);
  for (const b of $$('#presets [data-c]')) b.setAttribute('aria-pressed', String(+b.dataset.c! === S.cols && +b.dataset.r! === S.rows));
  syncPresetIcons();  for (const b of $$('[data-paper]')) b.setAttribute('aria-pressed', String(b.dataset.paper === S.paper));
  for (const b of $$('[data-orient]')) b.setAttribute('aria-pressed', String(b.dataset.orient === S.orient));
  $('#marginOut').textContent = S.margin + ' mm';
  $('#overlapOut').textContent = S.overlap + ' mm';
  // los deslizadores también (al recuperar el póster, deshacer o empezar uno nuevo); no mientras se arrastran
  for (const [id, v] of [['#margin', S.margin], ['#overlap', S.overlap]] as const) {
    const el = $<HTMLInputElement>(id);
    if (document.activeElement !== el) el.value = String(v);
  }
  syncExportButtons(); // su título dice cuántas páginas y a qué resolución
  updateStats(); // el resumen bajo la pestaña Póster y en el panel plegado
  syncWelcome();
}
/** Lado (px) del recuadro en el que cabe el icono de cada distribución (mismo valor que .sheet-box en global.css). */
const PRESET_BOX = 26;
/**
 * Icono de cada distribución: una miniatura del póster con la proporción que tendría con el papel, la orientación,
 * el margen y el solape actuales (1×3 en A4 vertical sale alto y estrecho), escalada para caber en el recuadro.
 */
function syncPresetIcons() {
  for (const b of $$('#presets [data-c]')) {
    const g = geo({ ...S, posterSize: null, cols: +b.dataset.c!, rows: +b.dataset.r! }), k = PRESET_BOX / Math.max(g.W, g.H);
    const grid = b.querySelector<HTMLElement>('.sheet-grid')!;
    grid.style.width = `${Math.max(4, Math.round(g.W * k))}px`;
    grid.style.height = `${Math.max(4, Math.round(g.H * k))}px`;
  }
}
/**
 * Bienvenida: solo con el lienzo sin tocar. En cuanto el usuario hace algo que muestra el papel (una imagen, o
 * elegir hojas, papel, orientación, margen o solape) se quita: encima del papel blanco se vería mal. Vuelve con
 * «Nuevo» y al deshacer hasta el principio.
 */
function syncWelcome() {
  const was = $('#empty').hidden;
  $('#empty').hidden = sheetsVisible();
  if (was !== $('#empty').hidden) renderBar(); // la barra fija aparece cuando se va la bienvenida
}

/* ---------- propiedades de la imagen seleccionada ---------- */
/** Campo que acaba de aplicar lo escrito: aunque tenga el foco, muestra el resultado («21/2» pasa a «10,5»). */
let appliedField: HTMLInputElement | null = null;
function setField(id: string, v: string | number) {
  const el = $<HTMLInputElement>(id);
  if (document.activeElement !== el || el === appliedField) el.value = String(v);
}
/** Aplica lo escrito en un campo y lo deja con el valor resultante, ya formateado. */
function showResult(el: HTMLInputElement, apply: () => void) {
  appliedField = el;
  try { apply(); } finally { appliedField = null; }
}
export function syncSel() {
  const sel = st.sel;
  document.body.classList.toggle('no-sel', !sel);
  document.body.classList.toggle('sel-locked', !!sel?.locked);
  document.body.classList.toggle('has-group', st.group.length > 1);
  const gsel = selectedGroup();
  $('#gNameField').hidden = gsel == null;
  if (gsel != null) setField('#gName', groupName(gsel));
  if (st.group.length > 1) {
    // opacidad común; si son distintas se muestra «varias» y el deslizador en la mayor
    const ops = st.group.map((l) => Math.round(l.opacity * 100)), same = ops.every((o) => o === ops[0]);
    setField('#gOpacity', Math.max(...ops));
    $('#gOpacityOut').textContent = same ? `${ops[0]} %` : 'varias';
    const b = unionBox(st.group.map((l) => bboxMM(l))), r = commonRotation(st.group);
    setField('#gW', fmtMeasure((b.x1 - b.x0) / 10)); setField('#gH', fmtMeasure((b.y1 - b.y0) / 10));
    setField('#gX', fmtMeasure(b.x0 / 10)); setField('#gY', fmtMeasure(b.y0 / 10));
    setField('#gR', r == null ? '' : fmtMeasure(r));
    syncRatioButtons();
  }
  $('#lockNote').hidden = !sel?.locked;
  if (sel) {
    setField('#pName', sel.name);
    const op = Math.round(sel.opacity * 100);
    setField('#pOpacity', op); $('#pOpacityOut').textContent = `${op} %`;
    const b = bboxMM(sel);
    setField('#pW', fmtMeasure(visW(sel) / 10)); setField('#pH', fmtMeasure(visH(sel) / 10));
    setField('#pX', fmtMeasure(b.x0 / 10)); setField('#pY', fmtMeasure(b.y0 / 10)); setField('#pR', fmtMeasure(sel.rot));
    $('#unstretch').hidden = !isStretched(sel);
    $('#pdfField').hidden = !(sel.pdf && sel.pages > 1);
    if (sel.pdf) { $<HTMLInputElement>('#pdfPage').max = String(sel.pages); setField('#pdfPage', sel.page); $('#pdfPages').textContent = 'de ' + sel.pages; }
  }
  syncTextPanel();
  syncSelectionCard();
  followSelection();
  updateStats(); updateHint();
}
/** Botones de «Mantener proporción» (imagen y conjunto). El del conjunto, fijo si no se puede estirar. */
function syncRatioButtons() {
  const forced = st.group.length > 1 && !canStretch(st.group);
  for (const [id, on] of [['#pLock', S.lock], ['#gRatio', S.lock || forced]] as const) {
    const b = $<HTMLButtonElement>(id);
    b.setAttribute('aria-pressed', String(on));
    b.innerHTML = ICON[on ? 'ratioOn' : 'ratioOff']; // constante del código
  }
  const g = $<HTMLButtonElement>('#gRatio');
  g.disabled = forced;
  g.title = forced ? 'Con textos o imágenes giradas en ángulo, el conjunto escala sin deformar' : 'Mantener proporción';
}
/** Lo que hace un campo numérico: si ahora se puede cambiar, cómo se aplica un valor y el paso de ↑ ↓ y del arrastre. */
interface NumTarget { ok: () => boolean; apply: (v: number) => void; step?: number }
/**
 * Campo numérico (texto con coma decimal, no type=number, que mostraría «14.3» según el navegador), como en Figma:
 * - Enter o salir del campo aplica; admite operaciones («21/2», «14,3+2»; ver parseNum);
 * - ↑ ↓ suman o restan el paso (con Mayús, 10 veces más);
 * - arrastrar su etiqueta en horizontal cambia el valor (un paso por píxel; con Mayús, 10): un solo paso de deshacer.
 */
function numInput(id: string, t: NumTarget) {
  const el = $<HTMLInputElement>(id), step = t.step ?? 0.1;
  // texto que ya se aplicó: Enter aplica y, al salir del campo, el navegador lanza otro «change» con el mismo
  // texto, que no debe dejar un segundo paso de deshacer (vacío)
  let applied: string | null = null;
  const run = () => {
    if (el.value === applied) return;
    const v = parseNum(el.value);
    if (!Number.isFinite(v) || !t.ok()) { showResult(el, syncSel); return; } // no vale: vuelve al que había
    showResult(el, () => { snap(); t.apply(v); afterChange(); });
    applied = el.value; // el resultado: al salir del campo no se vuelve a aplicar
  };
  el.addEventListener('focus', () => { applied = null; });
  el.addEventListener('change', run);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); run(); el.select(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const v = parseNum(el.value);
      if (!Number.isFinite(v)) return;
      e.preventDefault();
      const d = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
      el.value = fmtMeasure(v + d);
      run(); el.select();
    }
  });
  scrubLabel(el, t, step);
}
/** Arrastrar la etiqueta de un campo (ratón o lápiz; en táctil el gesto es desplazar el panel). */
function scrubLabel(el: HTMLInputElement, t: NumTarget, step: number) {
  const label = el.closest('label')?.querySelector<HTMLElement>(':scope > span:first-child');
  if (!label) return;
  label.classList.add('scrub');
  let drag: { id: number; x: number; v0: number; moved: boolean } | null = null, swallowClick = false;
  label.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || e.pointerType === 'touch' || !t.ok()) return;
    const v0 = parseNum(el.value);
    if (!Number.isFinite(v0)) return;
    e.preventDefault(); // sin seleccionar texto ni enfocar todavía
    // con el campo enfocado, lo escrito se aplica antes y el campo deja de tapar el valor que va cambiando
    if (document.activeElement === el) el.blur();
    label.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, v0, moved: false };
    setPending(takeSnap()); // el paso de deshacer se guarda solo si el valor llega a cambiar
  });
  label.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = Math.round(e.clientX - drag.x);
    if (!drag.moved && Math.abs(dx) < 3) return;
    if (!drag.moved) { drag.moved = true; document.body.classList.add('scrubbing'); }
    const v = Math.round(Math.round((drag.v0 + dx * step * (e.shiftKey ? 10 : 1)) / step) * step * 1e6) / 1e6;
    if (!t.ok()) return;
    commitPending(); t.apply(v); afterChange();
  });
  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const moved = drag.moved;
    drag = null; setPending(null);
    document.body.classList.remove('scrubbing');
    // un clic sin arrastrar es el de siempre: va al campo; después de arrastrar, el clic que sigue no lo enfoca
    if (moved) swallowClick = true; else { el.focus(); el.select(); }
  };
  label.addEventListener('pointerup', end);
  label.addEventListener('pointercancel', end);
  label.addEventListener('click', (e) => { if (swallowClick) { swallowClick = false; e.preventDefault(); } });
  label.addEventListener('pointerdown', () => { swallowClick = false; }, true);
}
/** Campo de la imagen seleccionada (no bloqueada). */
const numField = (id: string, apply: (l: Layer, v: number) => void, step = 0.1) =>
  numInput(id, { ok: () => !!st.sel && !st.sel.locked, apply: (v) => apply(st.sel!, v), step });

/* ---------- lista de imágenes ---------- */
/**
 * Ancla de Mayús + clic en la lista: lo último pulsado sin Mayús (una capa o los miembros de un grupo). Si ya no está
 * seleccionado (se cambió la selección en el lienzo), el rango parte de lo seleccionado, como en Figma.
 */
let listAnchor: Layer[] = [];
/**
 * Clic en una fila (capa o grupo), como en Figma, Photoshop e Illustrator: solo, selecciona; con Ctrl/⌘, suma o
 * quita; con Mayús, todo lo que hay entre el ancla y la fila. Ocultas y bloqueadas no entran (como en el lienzo).
 */
function clickRow(e: MouseEvent, items: Layer[], plain: () => void) {
  // una oculta o bloqueada no se puede sumar: el clic la selecciona sola (para mostrarla o desbloquearla)
  if (items.every((l) => l.hidden || l.locked)) { listAnchor = items; plain(); return; }
  if (e.shiftKey && !e.ctrlKey && !e.metaKey) {
    const cur = selected(), from = listAnchor.some((l) => cur.includes(l)) ? listAnchor : cur;
    if (from.length) { selectMany(listRange(st.layers, from, items)); return; }
  }
  listAnchor = items;
  if (e.ctrlKey || e.metaKey) {
    const cur = selected(), on = items.every((l) => cur.includes(l));
    selectMany(on ? cur.filter((l) => !items.includes(l)) : [...cur, ...items]);
    return;
  }
  plain();
}
/**
 * Miniaturas reutilizadas: cada imagen conserva su canvas de 88 × 88 y solo se vuelve a dibujar si cambió
 * lo que muestra (lienzo, su contenido, el recorte, la proporción o los colores del tema).
 * La lista se reconstruye muy a menudo (al soltar cada arrastre, al seleccionar…).
 */
const thumbs = new WeakMap<Layer, { c: HTMLCanvasElement; key: string }>();
const canvasIds = new WeakMap<HTMLCanvasElement, number>();
let nextCanvasId = 1;
const canvasId = (c: HTMLCanvasElement) => {
  let id = canvasIds.get(c);
  if (!id) { id = nextCanvasId++; canvasIds.set(c, id); }
  return id;
};
function thumbFor(l: Layer) {
  const k = l.crop;
  const key = [canvasId(l.img), canvasRevision(l.img), k.x0, k.y0, k.x1, k.y1, l.w, l.h, l.rot, l.flipX, l.flipY, C.chk1, C.chk2].join('|');
  let t = thumbs.get(l);
  if (!t) {
    const c = document.createElement('canvas');
    c.width = c.height = 88;
    t = { c, key: '' };
    thumbs.set(l, t);
  }
  if (t.key !== key) {
    const x = t.c.getContext('2d')!;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? C.chk2! : C.chk1!; x.fillRect(i * 11, j * 11, 11, 11); }
    // la miniatura muestra la zona visible tal como se ve en el póster: con su giro y su espejo, encajada en 84 px
    const sw = (k.x1 - k.x0) * l.img.width, sh = (k.y1 - k.y0) * l.img.height, dw = visW(l), dh = visH(l);
    const a = (l.rot * Math.PI) / 180, cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
    const s = Math.min(84 / (cos * dw + sin * dh), 84 / (sin * dw + cos * dh));
    x.save();
    x.translate(44, 44); x.rotate(a); x.scale(l.flipX ? -1 : 1, l.flipY ? -1 : 1);
    x.imageSmoothingQuality = 'high';
    x.drawImage(l.img, k.x0 * l.img.width, k.y0 * l.img.height, sw, sh, (-dw * s) / 2, (-dh * s) / 2, dw * s, dh * s);
    x.restore();
    t.key = key;
  }
  return t.c;
}

/** Fila de la lista → su imagen (para arrastrar y para devolver el foco tras reordenar con el teclado). */
const rowLayer = new WeakMap<Element, Layer>();
/**
 * Botón «Más» de la fila de una imagen (o de un grupo, por su número) tras volver a dibujar la lista: seleccionar
 * reconstruye la lista, y el menú tiene que devolver el foco a este botón nuevo, no al que se quitó.
 */
const moreButton = (match: (li: HTMLElement) => boolean) =>
  [...document.querySelectorAll<HTMLElement>('#layers li')].find(match)?.querySelector<HTMLElement>('[data-ic=more]') ?? null;
const moreOfLayer = (l: Layer) => moreButton((li) => rowLayer.get(li) === l);
const moreOfGroup = (gid: number) => moreButton((li) => li.dataset.gid === String(gid));
function focusRow(l: Layer) {
  for (const li of document.querySelectorAll('#layers li')) if (rowLayer.get(li) === l) li.querySelector<HTMLElement>('.layer-main')?.focus();
}

/** Grupos plegados en la lista (solo afecta a la vista; no se guarda). */
const collapsed = new Set<number>();

/**
 * Fila de un grupo: plegar, seleccionar el grupo entero, verlo u ocultarlo, bloquearlo y su menú. depth: nivel
 * (sangría); hidden: está dentro de un grupo plegado.
 */
function groupRow(gid: number, depth: number, hidden: boolean): HTMLLIElement {
  const members = groupMembers(gid);
  const li = document.createElement('li');
  li.style.setProperty('--depth', String(depth));
  li.hidden = hidden;
  const allHidden = members.every((l) => l.hidden), allLocked = members.every((l) => l.locked);
  li.className = 'group-row' + (selectedGroup() === gid ? ' on' : '') + (allHidden ? ' off' : '');
  li.dataset.gid = String(gid);
  const pick = () => selectMany(members);
  const chev = document.createElement('button');
  chev.type = 'button'; chev.className = 'act chev' + (collapsed.has(gid) ? ' closed' : '');
  chev.setAttribute('aria-expanded', String(!collapsed.has(gid)));
  chev.setAttribute('aria-label', collapsed.has(gid) ? 'Desplegar el grupo' : 'Plegar el grupo');
  chev.innerHTML = ICON.chevronDown; // constante del código
  chev.addEventListener('click', () => { if (collapsed.has(gid)) collapsed.delete(gid); else collapsed.add(gid); renderList(); });
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'layer-main';
  b.setAttribute('aria-pressed', String(selectedGroup() === gid));
  b.insertAdjacentHTML('afterbegin', ICON.group.replace('class="', 'class="gicon ')); // constante del código
  const nm = document.createElement('span'); nm.textContent = groupName(gid); // dato del usuario: textContent
  const sm = document.createElement('small'); sm.textContent = `${members.length} imágenes` + (allHidden ? ' · oculto' : allLocked ? ' · bloqueado' : '');
  nm.appendChild(sm); b.appendChild(nm);
  b.addEventListener('click', (e) => clickRow(e, members, pick));
  b.addEventListener('dblclick', () => focusGroupName(gid)); // doble clic: renombrar, como con las imágenes
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); pick(); openMenu(e.clientX, e.clientY, groupRowMenu(gid)); });
  li.append(chev, b);
  const acts: [keyof typeof ICON, string, (e: MouseEvent) => void][] = [
    [allHidden ? 'eyeOff' : 'eye', allHidden ? 'Mostrar el grupo' : 'Ocultar el grupo', () => toggleGroupFlag(gid, 'hidden')],
    [allLocked ? 'lock' : 'lockOpen', allLocked ? 'Desbloquear el grupo' : 'Bloquear el grupo', () => toggleGroupFlag(gid, 'locked')],
    ['more', 'Más opciones del grupo', (e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      pick(); openMenu(r.left, r.bottom + 4, groupRowMenu(gid), () => moreOfGroup(gid));
    }],
  ];
  for (const [ic, t, fn] of acts) {
    const a = document.createElement('button');
    a.type = 'button'; a.className = 'act'; a.title = t; a.setAttribute('aria-label', t); a.dataset.ic = ic;
    a.innerHTML = ICON[ic]; // constante del código
    if (ic === 'lock') a.classList.add('text-accent');
    a.addEventListener('click', fn);
    li.appendChild(a);
  }
  return li;
}

/**
 * Lo que dibujan las filas, salvo la selección: si no cambia (lo más frecuente: seleccionar, o soltar un clic), basta
 * con marcar la selección y, si hace falta, redibujar las miniaturas en su sitio; no se reconstruye la lista. Con 16
 * imágenes, reconstruirla eran ~4 ms por clic, y obligaba al navegador a recalcular la página entera.
 */
let listKey = '';
// las filas guardan su objeto (rowLayer y los clics): cuenta el objeto, no solo su número
const layerTokens = new WeakMap<Layer, number>();
let nextToken = 1;
const layerToken = (l: Layer) => { let t = layerTokens.get(l); if (!t) { t = nextToken++; layerTokens.set(l, t); } return t; };
const listStructure = () => JSON.stringify([[...collapsed], st.layers.map((l) => [
  layerToken(l), l.name, l.hidden, l.locked, l.opacity, cm(visW(l)), cm(visH(l)), l.pdf ? l.page : 0, l.gpath.map((g) => [g.id, g.name]),
])]);
/** Marca en la lista lo seleccionado (filas de imagen y de grupo). */
function syncListSelection(ol: Element) {
  const gsel = selectedGroup();
  for (const li of ol.querySelectorAll<HTMLElement>(':scope > li')) {
    const l = rowLayer.get(li);
    const on = l ? l === st.sel || st.group.includes(l) : gsel != null && li.dataset.gid === String(gsel);
    li.classList.toggle('on', on);
    li.querySelector(':scope > .layer-main')?.setAttribute('aria-pressed', String(on));
  }
}

export function renderList() {
  const ol = document.querySelector('#layers');
  if (!ol || !C.chk1) return;
  const key = listStructure();
  if (key === listKey && ol.childElementCount) {
    syncListSelection(ol);
    for (const l of st.layers) thumbFor(l); // misma miniatura (el mismo canvas): se redibuja en su sitio si cambió
    afterList();
    return;
  }
  listKey = key;
  const active = document.activeElement;
  const oldRow = active instanceof HTMLButtonElement && active.matches(':focus-visible') && ol.contains(active) ? active.closest('li') : null;
  const focusedLayer = oldRow && rowLayer.get(oldRow);
  const focusedGroup = oldRow?.dataset.gid;
  const buttonIndex = oldRow ? [...oldRow.querySelectorAll('button')].indexOf(active as HTMLButtonElement) : -1;
  ol.textContent = '';
  const n = st.layers.length;
  let prev: GroupRef[] = [];
  [...st.layers].reverse().forEach((l) => {
    // las imágenes de un grupo van seguidas: donde empieza un grupo (o un subgrupo), antes, su fila
    const p = l.gpath;
    let k = 0;
    while (k < p.length && prev[k]?.id === p[k]!.id) k++;
    for (let d = k; d < p.length; d++) ol.appendChild(groupRow(p[d]!.id, d, p.slice(0, d).some((g) => collapsed.has(g.id))));
    prev = p;
    const li = document.createElement('li');
    const on = l === st.sel || st.group.includes(l);
    li.className = 'layer' + (on ? ' on' : '') + (l.hidden ? ' off' : '') + (p.length ? ' in-group' : '');
    li.style.setProperty('--depth', String(p.length));
    if (p.some((g) => collapsed.has(g.id))) li.hidden = true;
    rowLayer.set(li, l);
    // asa para arrastrar (en táctil es la única zona que arrastra; con ratón vale toda la fila)
    if (n > 1) {
      const grip = document.createElement('span');
      grip.className = 'grip'; grip.title = 'Arrastra para cambiar el orden';
      grip.innerHTML = ICON.grip; // constante del código
      li.appendChild(grip);
    }
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'layer-main';
    b.setAttribute('aria-pressed', String(on));
    b.addEventListener('click', (e) => clickRow(e, [l], () => select(l)));
    // teclado: Alt + ↑ ↓ cambia el orden (arriba = al frente) y el foco sigue a la imagen
    b.addEventListener('keydown', (e) => {
      if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      reorder(l, e.key === 'ArrowUp' ? 1 : -1);
      focusRow(l);
    });
    // doble clic en la lista: renombrar
    b.addEventListener('dblclick', () => { select(l); focusName(); });
    b.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (st.group.length > 1 && st.group.includes(l)) { openMenu(e.clientX, e.clientY, groupMenu()); return; }
      select(l); openMenu(e.clientX, e.clientY, layerMenu(l));
    });
    const tc = thumbFor(l);
    // el nombre del archivo es dato del usuario: siempre con textContent
    const nm = document.createElement('span'); nm.textContent = l.name;
    const sm = document.createElement('small');
    sm.textContent = (l.hidden ? 'Oculta · ' : '') + `${cm(visW(l))} × ${cm(visH(l))} cm`
      + (l.opacity < 1 ? ` · ${Math.round(l.opacity * 100)} %` : '') + (l.pdf ? ` · PDF pág. ${l.page}` : '');
    nm.appendChild(sm);
    b.append(tc, nm); li.appendChild(b);
    // a la vista solo lo que se cambia a menudo (ver y bloquear); orden, duplicar y quitar van en el menú «Más»
    const more = (e: MouseEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      if (st.group.length > 1 && st.group.includes(l)) { openMenu(r.left, r.bottom + 4, groupMenu(), () => moreOfLayer(l)); return; }
      select(l); openMenu(r.left, r.bottom + 4, layerMenu(l), () => moreOfLayer(l));
    };
    const acts: [keyof typeof ICON, string, (e: MouseEvent) => void, boolean][] = [
      // ojo abierto = visible, como en Figma o Photoshop; al pulsarlo se oculta
      [l.hidden ? 'eyeOff' : 'eye', l.hidden ? 'Mostrar' : 'Ocultar', () => toggleHidden(l), false],
      // candado cerrado = bloqueada (no se toca en el lienzo, pero se imprime)
      [l.locked ? 'lock' : 'lockOpen', l.locked ? 'Desbloquear' : 'Bloquear', () => toggleLocked(l), false],
      ['more', 'Más opciones: orden, duplicar, quitar…', more, false],
    ];
    for (const [ic, t, fn, dis] of acts) {
      const a = document.createElement('button');
      a.type = 'button'; a.className = 'act'; a.title = t; a.setAttribute('aria-label', t); a.dataset.ic = ic;
      a.innerHTML = ICON[ic]; a.disabled = dis;
      // bloqueada: el candado se resalta para que se distinga del abierto de un vistazo
      if (ic === 'lock') { a.classList.add('text-accent'); a.setAttribute('aria-pressed', 'true'); }
      a.addEventListener('click', fn);
      li.appendChild(a);
    }
    ol.appendChild(li);
  });
  $('#layerCount').textContent = String(n);
  if (buttonIndex >= 0) {
    const row = [...ol.querySelectorAll('li:not([hidden])')].find((li) =>
      focusedLayer ? rowLayer.get(li) === focusedLayer : (li as HTMLElement).dataset.gid === focusedGroup);
    row?.querySelectorAll('button')[buttonIndex]?.focus({ preventScroll: true });
  }
  afterList();
}
/** Lo que depende de las imágenes, fuera de la lista: bienvenida, descarga, «Nuevo póster» y la pista. */
function afterList() {
  syncWelcome();
  syncExportButtons();
  syncNewPoster();
  updateHint();
}
/** «Nuevo póster» se desactiva cuando ya es uno nuevo: no hay nada que reiniciar. */
let newTitle: string | null = null;
export function syncNewPoster() {
  const b = $<HTMLButtonElement>('#newPoster'), fresh = isFreshPoster();
  newTitle ??= b.title;
  b.disabled = fresh;
  b.title = fresh ? 'Ya es un póster nuevo' : newTitle;
}
/** Páginas del PDF por hojas (una por hoja y, si se pide, la guía). */
export const pdfPages = () => { const g = posterGeo(); return g.cols * g.rows + Number(S.guide); };
/** Hay algo que imprimir (las ocultas no se imprimen). */
export const isPrintable = () => st.layers.some((l) => !l.hidden);
/**
 * Sin nada que imprimir no se puede descargar ni imprimir el póster (la hoja de prueba sí: no necesita imágenes).
 * También al terminar una descarga.
 */
export function syncExportButtons() {
  const n = pdfPages(), printable = isPrintable(), busy = document.body.classList.contains('exporting');
  const why = st.layers.length ? 'Todas las imágenes están ocultas' : 'Agrega una imagen primero';
  for (const id of ['#quickExport', '#exportTiles', '#printTiles', '#exportSingle']) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = !printable || busy;
    b.title = printable ? '' : why;
  }
  const pages = `${n} ${n === 1 ? 'página' : 'páginas'}`;
  if (printable) $('#quickExport').title = `PDF por hojas · ${S.skipBlank ? 'omitir hojas en blanco' : pages} · ${S.dpi} ppp`;
  $<HTMLButtonElement>('#newPosterAlt').disabled = isFreshPoster();
}

/* ---------- resumen para descargar ---------- */
/**
 * La lectura ya no flota en el lienzo: el tamaño del póster se dibuja junto a él y la calidad, en la etiqueta de la
 * imagen seleccionada. Arriba de la tarjeta del PDF se dice qué se va a descargar y, solo si alguna imagen no tiene buena
 * calidad, un aviso estándar (icono, título y texto).
 */
/**
 * Tamaño del póster abajo a la izquierda, junto a la línea de estado: «19,8 × 28,5 cm · 1 hoja A4». El margen va en el título (la
 * descripción completa). Antes se dibujaba sobre el papel, encima de la regla: se montaba con sus números, se movía con
 * la vista y se ocultaba al chocar con la barra o las ventanas.
 */
function syncPosterSize(g: Geo) {
  $('#posterSize').hidden = !sheetsVisible();
  const n = g.cols * g.rows, short = `${cmGap(g.W)} × ${cmGap(g.H)} cm · ${n} ${n === 1 ? 'hoja' : 'hojas'} ${S.paper}`;
  const b = $('#posterSize'), full = `Póster ${short}` + (g.m > 0 ? ` · margen ${Math.round(g.m)} mm` : '');
  if (b.textContent !== short) b.textContent = short;
  b.title = `${full}. Pulsa para cambiar hojas, papel, margen y solape`;
  b.setAttribute('aria-label', `${full}. Abrir Póster`);
}
let countTimer = 0;
export function updateStats() {
  clearTimeout(countTimer);
  const g = posterGeo(), n = g.cols * g.rows;
  syncPosterSize(g);
  // las ocultas no se imprimen: no cuentan
  const rows = st.layers.filter((l) => !l.hidden).map((l) => { const ppp = pppOf(l, HI_AREA); return { l, ppp, q: qualityOf(ppp) }; });
  const bad = rows.filter((r) => r.q === 'bad'), warn = rows.filter((r) => r.q === 'warn');


  const box = $('#exportSummary');
  box.textContent = '';
  const info = document.createElement('p');
  info.className = 'm-0 text-[.88rem] font-semibold';
  const orient = S.orient === 'portrait' ? (n === 1 ? 'vertical' : 'verticales') : (n === 1 ? 'horizontal' : 'horizontales');
  info.textContent = `Póster ${cmGap(g.W)} × ${cmGap(g.H)} cm · ${n} ${n === 1 ? 'hoja' : 'hojas'} ${S.paper} ${orient}`;
  // y el PDF por hojas: cuántas páginas (con la guía) y a qué resolución
  const pages = pdfPages(), sub = document.createElement('p');
  sub.className = 'm-0 text-[.84rem] text-muted';
  sub.textContent = `PDF por hojas: ${pages} ${pages === 1 ? 'página' : 'páginas'}${S.guide ? ' (con la guía)' : ''} · ${S.dpi} ppp`;
  box.append(info, sub);
  if (S.skipBlank) {
    sub.textContent = 'Se omitirán las hojas en blanco.';
    const current = () => sub.isConnected && $('#pdfCard').matches(':popover-open') && !document.body.classList.contains('exporting');
    if (rows.length && current()) {
      sub.textContent = 'Contando hojas con contenido…';
      countTimer = window.setTimeout(async () => {
        try {
          const sheets = await sheetsToPrint(current), k = sheets?.length ?? 0;
          // cuáles: si una línea finísima obliga a imprimir otra hoja, se ve cuál es
          if (sheets && current()) sub.textContent = k
            ? `Se imprimirán ${k} de ${n} hojas del póster (${k === 1 ? 'la' : 'las'} ${numberList(sheets)})${S.guide ? ' + 1 guía de armado' : ''} · ${S.dpi} ppp`
            : 'Todas las hojas están en blanco. Desactiva la omisión para imprimirlas.';
        } catch { if (current()) sub.textContent = 'Las hojas en blanco se comprobarán al generar el PDF.'; }
      }, 120);
    }
  }
  if (!rows.length) {
    const p = document.createElement('p');
    p.className = 'm-0 text-[.86rem] text-muted';
    p.textContent = st.layers.length ? 'Todas las imágenes están ocultas.' : 'Agrega una imagen para descargar.';
    box.appendChild(p);
    return;
  }
  if (!bad.length && !warn.length) return; // todo bien: sin aviso

  const worst: Quality = bad.length ? 'bad' : 'warn', count = (k: number) => (k === 1 ? '1 imagen' : `${k} imágenes`);
  const alert = document.createElement('div');
  alert.className = `alert alert-${worst}`;
  alert.insertAdjacentHTML('afterbegin', ICON.warning); // constante del código
  const body = document.createElement('div');
  body.className = 'flex min-w-0 flex-1 flex-col gap-1.5';
  const title = document.createElement('p');
  title.className = 'alert-title';
  title.textContent = bad.length ? `${count(bad.length)} con calidad baja` : `${count(warn.length)} con calidad aceptable`;
  const text = document.createElement('p');
  text.className = 'text-muted';
  // sin listado: la calidad de cada imagen se ve en su etiqueta al seleccionarla
  text.textContent = (bad.length
    ? 'Se verá pixelada al imprimir. Hazla más pequeña en el póster o usa un archivo con más resolución.'
    : 'Se nota de cerca, no a un metro. Para mejorarla, hazla algo más pequeña o usa un archivo con más resolución.')
    + ' Al seleccionar una imagen, su calidad aparece junto a su tamaño.';
  body.append(title, text);
  alert.appendChild(body);
  box.appendChild(alert);
}

/* ---------- pista inferior ---------- */
export function updateHint() {
  const hint = document.querySelector('#hint');
  if (!hint) return;
  const t = isTouch(), sel = st.sel;
  // solo lo que no es evidente; el resto está en la ayuda («?»)
  const H: Record<string, string> = {
    move: st.placingText ? (t ? 'Toca donde quieras el texto' : 'Clic: poner el texto · arrastrar: con ancho fijo · {esc}: cancelar')
      : !st.layers.length ? 'Agrega una imagen para empezar'
      : st.group.length > 1 ? (t ? `${st.group.length} seleccionadas · pellizca para escalar y girar` : `${st.group.length} seleccionadas · {shift}+clic: sumar o quitar · {esc}: deseleccionar`)
      : sel?.hidden ? 'Oculta: no se imprime · muéstrala en Capas'
      : sel?.src?.kind === 'text' ? (t ? 'Doble toque: escribir' : 'Doble clic o {enter}: escribir · lados: ancho del texto')
      : sel ? (t ? 'Pellizca sobre la imagen para escalar y girar' : '{shift}: deformar o girar de 15° en 15° · {alt}: desde el centro · {alt} sobre otra: distancias')
        : (t ? 'Mantén pulsado para más opciones' : 'Arrastra en el fondo para elegir varias · clic derecho: más opciones'),
    crop: t ? 'Pellizca para ampliar la imagen · bordes: tamaño del recorte' : 'Rueda: ampliar · {shift}: proporción · {alt}: desde el centro · {enter}: aplicar',
    erase: S.brushMode === 'erase' ? 'Pinta para borrar' : 'Pinta para recuperar lo borrado',
    wand: t ? 'Toca un color para borrarlo' : 'Clic en un color para borrarlo',
  };
  hint.replaceChildren(rich(H[S.mode] ?? ''));
  // con el póster vacío la pista sobra: la pantalla de inicio ya explica qué hacer
  hint.classList.toggle('invisible', !st.layers.length && !st.placingText);
}


export function initPanel() {
  initGuides();
  initSelectionCard();
  // pestañas
  for (const b of $$<HTMLButtonElement>('[role=tab]')) {
    b.addEventListener('click', () => pickTab(b.dataset.tab!));
  }
  // escritorio: tarjetas de Póster y de Capas (sus botones dicen si están abiertas)
  for (const b of $$<HTMLButtonElement>('#panelOpeners [data-open]')) {
    $(`#${b.getAttribute('popovertarget')}`).addEventListener('toggle', (e) => {
      b.setAttribute('aria-expanded', String((e as ToggleEvent).newState === 'open'));
    });
  }
  $('#panelHide').addEventListener('click', () => togglePanel(false));
  placePanes();
  deskMQ?.addEventListener('change', placePanes);
  $('[role=tablist]').addEventListener('keydown', (e) => {
    const tabs = $$<HTMLButtonElement>('[role=tab]'), i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); e.stopPropagation();
    tabs[j]!.focus(); pickTab(tabs[j]!.dataset.tab!);
  });

  // hojas
  $('#bySize').onclick = () => {
    if (S.posterSize) return;
    const g = posterGeo();
    editLayout('posterSize', { w: g.W, h: g.H });
  };
  $('#bySheets').onclick = () => {
    if (!S.posterSize) return;
    const g = posterGeo();
    applyCrop(); snap();
    Object.assign(S, { posterSize: null, cols: g.cols, rows: g.rows });
    layoutChanged();
  };
  // tamaño exacto: como los campos de Selección (coma decimal, operaciones como «100/2», ↑ ↓ de 1 mm y, con Mayús,
  // de 1 cm). Lo que no es una medida válida (vacío, 0 o negativo) vuelve al valor que había
  for (const [id, key] of [['#posterWidth', 'w'], ['#posterHeight', 'h']] as const) {
    const field = $<HTMLInputElement>(id);
    const apply = (cm: number) => {
      if (!S.posterSize) return;
      if (!(cm >= 0.1)) { showResult(field, syncLayoutUI); return; } // no vale: vuelve al que había
      const mm = Math.round(cm * 100) / 10;
      showResult(field, () => { if (mm !== S.posterSize![key]) editLayout('posterSize', { ...S.posterSize!, [key]: mm }); else syncLayoutUI(); });
    };
    field.onchange = () => apply(parseNum(field.value));
    field.onkeydown = (e) => {
      if (e.key === 'Enter') { e.preventDefault(); apply(parseNum(field.value)); field.select(); return; }
      if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
      const v = parseNum(field.value);
      if (!Number.isFinite(v)) return;
      e.preventDefault();
      field.value = fmtMeasure(Math.round((v + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 0.1)) * 1000) / 1000);
      apply(parseNum(field.value)); field.select();
    };
  }
  const presets = $('#presets');
  for (const [c, r] of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip chip-layout';
    b.dataset.c = String(c); b.dataset.r = String(r);
    // icono: miniatura del póster partida en columnas × filas; su forma la pone syncPresetIcons
    const box = document.createElement('span'), grid = document.createElement('span');
    box.className = 'sheet-box'; box.setAttribute('aria-hidden', 'true');
    grid.className = 'sheet-grid';
    grid.style.gridTemplate = `repeat(${r}, 1fr) / repeat(${c}, 1fr)`;
    for (let i = 0; i < c * r; i++) grid.appendChild(document.createElement('i'));
    box.appendChild(grid);
    const label = document.createElement('span');
    label.textContent = `${c}×${r}`;
    b.append(box, label);
    b.addEventListener('click', () => {
      if (S.cols === c && S.rows === r && sheetsVisible()) return;
      applyCrop(); snap(); S.cols = c; S.rows = r; st.sheetsOn = true; layoutChanged();
    });
    presets.appendChild(b);
  }
  for (const b of $$('[data-step]')) b.addEventListener('click', () => {
    const k = b.dataset.step === 'rows' ? 'rows' : 'cols';
    editLayout(k, Math.min(Math.max(S[k] + Number(b.dataset.d), 1), MAX_COLS_ROWS));
  });
  for (const b of $$('[data-paper]')) b.addEventListener('click', () => editLayout('paper', b.dataset.paper as Paper));
  for (const b of $$('[data-orient]')) b.addEventListener('click', () => editLayout('orient', b.dataset.orient as Orient));
  for (const b of $$('[data-relayout]')) {
    b.addEventListener('click', () => {
      relayoutMode = b.dataset.relayout === 'keep' ? 'keep' : 'scale';
      setPref('relayout', relayoutMode);
      syncRelayoutUI();
    });
  }
  syncRelayoutUI();
  // margen y solape: mientras se ajustan, se ve el papel entero de cada hoja (al soltar, un momento más)
  let paperTimer = 0;
  const showPaper = (on: boolean) => {
    clearTimeout(paperTimer);
    if (on) { st.showPaper = true; dirty(); }
    else paperTimer = window.setTimeout(() => { st.showPaper = false; dirty(); }, 900);
  };
  for (const id of ['margin', 'overlap'] as const) {
    const el = $<HTMLInputElement>('#' + id);
    el.addEventListener('input', () => {
      showPaper(true); editLayout(id, +el.value, true);
      if (id === 'margin') setPref('margin', el.value); // es de la impresora: vale para los pósters nuevos
    });
    el.addEventListener('change', () => showPaper(false));
    el.addEventListener('blur', () => showPaper(false));
  }

  // propiedades (escribir una medida = colocar a mano)
  // nombre: se aplica al confirmar (Enter o al salir del campo); Esc deshace lo escrito
  const name = $<HTMLInputElement>('#pName');
  name.addEventListener('change', () => { if (st.sel && !renameLayer(st.sel, name.value)) name.value = st.sel.name; });
  name.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); name.blur(); }
    if (e.key === 'Escape' && st.sel) { name.value = st.sel.name; name.blur(); }
  });
  const opacity = $<HTMLInputElement>('#pOpacity');
  opacity.addEventListener('input', () => {
    if (!st.sel) return;
    setOpacity(st.sel, +opacity.value / 100);
    $('#pOpacityOut').textContent = `${opacity.value} %`;
  });
  opacity.addEventListener('change', () => renderList());
  // nombre del grupo: se aplica al confirmar (Enter o al salir); Esc deshace lo escrito
  const gName = $<HTMLInputElement>('#gName');
  const gNow = () => { const g = selectedGroup(); return g == null ? '' : groupName(g); };
  gName.addEventListener('change', () => { const g = selectedGroup(); if (g == null || !renameGroup(g, gName.value)) gName.value = gNow(); });
  gName.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); gName.blur(); }
    if (e.key === 'Escape') { gName.value = gNow(); gName.blur(); }
  });
  const gOpacity = $<HTMLInputElement>('#gOpacity');
  gOpacity.addEventListener('input', () => {
    if (st.group.length < 2) return;
    setOpacity(st.group, +gOpacity.value / 100);
    $('#gOpacityOut').textContent = `${gOpacity.value} %`;
  });
  gOpacity.addEventListener('change', () => renderList());
  initListDrag($('#layers'), (li) => rowLayer.get(li));
  // el tamaño del póster (abajo a la izquierda) abre Póster, lo mismo que su botón
  $('#posterSize').addEventListener('click', () => $<HTMLButtonElement>('[data-open=sheets]').click());
  $('#gHide').addEventListener('click', hideSelected);
  $('#gLock').addEventListener('click', lockSelected);
  numField('#pW', (l, v) => { const f = Math.max(3, v * 10) / visW(l); if (S.lock || l.src?.kind === 'text') scaleLayer(l, f, cropCenter(l)); else keepCenter(l, (x) => { x.w *= f; }); markManual(l); });
  numField('#pH', (l, v) => { const f = Math.max(3, v * 10) / visH(l); if (S.lock || l.src?.kind === 'text') scaleLayer(l, f, cropCenter(l)); else keepCenter(l, (x) => { x.h *= f; }); markManual(l); });
  numField('#pX', (l, v) => { l.cx += v * 10 - bboxMM(l).x0; markManual(l); });
  numField('#pY', (l, v) => { l.cy += v * 10 - bboxMM(l).y0; markManual(l); });
  numField('#pR', (l, v) => { rotateLayer(l, normDeg(v) - l.rot, cropCenter(l)); markManual(l); }, 1);
  // la proporción fija es una sola preferencia: la de una imagen y la del conjunto van juntas
  for (const id of ['#pLock', '#gRatio']) $(id).addEventListener('click', () => { S.lock = !S.lock; syncRatioButtons(); });
  // varias: el marco común (con su proporción, como una sola). Si alguna está girada en ángulo o es un texto, no se
  // pueden estirar en un eje: ancho y alto van siempre juntos
  const groupOk = () => st.group.length > 1;
  const gField = (id: string, key: 'w' | 'h' | 'x' | 'y' | 'rot', k = 10) =>
    numInput(id, { ok: groupOk, apply: (v) => setGroupFrame(st.group, { [key]: v * k }), step: key === 'rot' ? 1 : 0.1 });
  gField('#gW', 'w'); gField('#gH', 'h'); gField('#gX', 'x'); gField('#gY', 'y'); gField('#gR', 'rot', 1);
  $('#unstretch').addEventListener('click', unstretchSel);
  $('#fitContain').addEventListener('click', fitSel('contain'));
  $('#fitCover').addEventListener('click', fitSel('cover'));
  $('#center').addEventListener('click', centerSel);
  const pageRequests = new WeakMap<Layer, number>();
  $<HTMLInputElement>('#pdfPage').addEventListener('change', async (e) => {
    const l = st.sel, input = e.target as HTMLInputElement;
    if (!l?.pdf || l.locked) return;
    const n = Math.min(Math.max(parseInt(input.value) || 1, 1), l.pages);
    const request = (pageRequests.get(l) ?? 0) + 1;
    pageRequests.set(l, request);
    input.value = String(n);
    if (n === l.page) return;
    const previous = l.img;
    try {
      const c = await renderPdfPage(l.pdf, n);
      if (pageRequests.get(l) !== request || l.img !== previous || !st.layers.includes(l) || l.locked) {
        freeCanvas(c);
        if (pageRequests.get(l) === request && st.sel === l) input.value = String(l.page);
        return;
      }
      if (st.sel === l) applyCrop();
      snap();
      const w = visW(l);
      keepCenter(l, (x) => { Object.assign(x, { img: c, orig: c, page: n, crop: { x0: 0, y0: 0, x1: 1, y1: 1 } }); x.w = w; x.h = w * natRatio(x); });
      // si estaba ajustada al póster, la nueva página (quizá de otra proporción) también se ajusta
      if (l.fit) applyFit(l, l.fit, posterGeo());
      afterChange();
    } catch {
      if (pageRequests.get(l) === request && st.sel === l) {
        input.value = String(l.page); toast('No se pudo leer esa página');
      }
    }
  });

  // exportar
  for (const b of $$('[data-dpi]')) b.addEventListener('click', () => { S.dpi = Number(b.dataset.dpi); syncExportUI(); scheduleSave(); });
  // los ajustes de descarga no son pasos de deshacer (ni este ni la resolución, las marcas o la guía)
  $<HTMLInputElement>('#skipBlank').onchange = (e) => {
    S.skipBlank = (e.target as HTMLInputElement).checked;
    syncExportUI(); scheduleSave();
  };
  $('#pdfCard').addEventListener('toggle', updateStats);
  $<HTMLInputElement>('#marks').addEventListener('change', (e) => { S.marks = (e.target as HTMLInputElement).checked; syncNewPoster(); scheduleSave(); });
  $<HTMLInputElement>('#guide').addEventListener('change', (e) => { S.guide = (e.target as HTMLInputElement).checked; syncLayoutUI(); syncNewPoster(); scheduleSave(); });


  prevG = posterGeo();
  syncLayoutUI();
}
