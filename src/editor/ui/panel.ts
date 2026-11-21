/** Panel lateral: pestañas, ajustes de hojas, propiedades de la imagen, lista de imágenes, exportación y lectura. */
import type { GroupRef } from '../groups';
import {
  afterChange, centerSel, fitSel, groupMembers, groupName, hideSelected, lockSelected, markManual, renameGroup, renameLayer,
  reorder, select, selectedGroup, selectMany, setAdjust, setOpacity, toggleGroupFlag, toggleHidden, toggleInSelection,
  toggleLocked, unstretchSel,
} from '../actions';
import { MAX_COLS_ROWS, MIN_SIZE, PRESETS, SIZE_PRESETS } from '../constants';
import { $, $$, toast } from '../dom';
import { cm, fmt1, parseNum } from '../format';
import {
  applyFit, bboxMM, cropCenter, geo, isStretched, keepCenter, maxSize, natRatio, newLayoutMemory, normDeg, pppOf, qualityOf, relayout,
  rotateLayer, scaleLayer, sheetCount, sizeSlack, visH, visW,
} from '../geometry';
import { onBlankChange, sheetPlan } from '../sheets';
import { snap } from '../history';
import { deskMQ, HI_AREA, isTouch } from '../platform';
import { rich } from './keys';
import { C, clampSize, isFreshPoster, posterGeo, S, sheetsVisible, st } from '../state';
import { adjustedSource, dirty } from '../render';
import { adjustKey } from '../pixels';
import { fitView } from '../view';
import { renderPdfPage } from '../io/pdf';
import { canvasRevision, scheduleSave } from '../io/persist';
import { ICON } from './icons';
import { isPanelOff, openSheet, togglePanel } from './layout';
import { initListDrag } from './listdrag';
import { groupMenu, layerMenu, openMenu } from './menu';
import type { Quality, RelayoutMode } from '../geometry';
import { getPref, setPref } from '../prefs';
import type { Geo, Layer, LayoutSettings, Orient, Paper, Size } from '../types';
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
  fitSizeToMax();
  const g = posterGeo();
  if (prevG) relayout(st.layers, prevG, g, relayoutMode, layoutMem);
  prevG = g;
  syncLayoutUI(); syncSel(); renderList(); fitView();
  scheduleSave();
}
/** Ajustes de color de la imagen seleccionada (un texto no tiene: se ocultan). */
function syncAdjustUI(sel: Layer) {
  const text = sel.src?.kind === 'text';
  $('#adjustField').hidden = text;
  if (text) return;
  const a = sel.adjust;
  for (const [id, v] of [['#adjBright', a?.bright ?? 0], ['#adjContrast', a?.contrast ?? 0], ['#adjSat', a?.sat ?? 0]] as const) {
    setField(id, v); $(id + 'Out').textContent = v > 0 ? `+${v}` : String(v);
  }
  $<HTMLInputElement>('#adjGray').checked = !!a?.gray;
  $<HTMLInputElement>('#adjSat').disabled = !!a?.gray; // en blanco y negro la saturación no hace nada
  $<HTMLButtonElement>('#adjReset').disabled = !a;
  $('#adjState').textContent = !a ? 'sin ajustes' : a.gray ? 'blanco y negro' : 'ajustada';
}
/** Calidad, marcas y guía (se guardan con el póster). */
export function syncExportUI() {
  for (const x of $$('[data-dpi]')) x.setAttribute('aria-pressed', String(Number(x.dataset.dpi) === S.dpi));
  $<HTMLInputElement>('#marks').checked = S.marks;
  $<HTMLInputElement>('#guide').checked = S.guide;
  $<HTMLInputElement>('#skipBlank').checked = S.skipBlank;
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
let lastLayoutEdit = { key: '', t: 0 };
function editLayout<K extends keyof LayoutSettings>(key: K, value: LayoutSettings[K], coalesce = false) {
  if (S[key] === value || (key === 'size' && sameSize(S.size, value as Size | null))) return;
  const now = performance.now();
  if (!(coalesce && lastLayoutEdit.key === key && now - lastLayoutEdit.t < 1000)) snap();
  lastLayoutEdit = { key, t: now };
  (S as LayoutSettings)[key] = value;
  st.sheetsOn = true; // el usuario eligió la hoja: desde ahora se ven aunque el póster esté vacío
  layoutChanged();
}
export function syncLayoutUI() {
  const g = posterGeo();
  $('#colsOut').textContent = String(g.cols);
  $('#rowsOut').textContent = String(g.rows);
  // una distribución solo está elegida si el tamaño sale de las hojas (con medida, las hojas son una consecuencia)
  for (const b of $$('#presets [data-c]')) b.setAttribute('aria-pressed', String(!S.size && +b.dataset.c! === S.cols && +b.dataset.r! === S.rows));
  syncSizeUI(g);
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
/* ---------- tamaño por medidas ---------- */
const sameSize = (a: Size | null, b: Size | null) => a === b || (!!a && !!b && a.w === b.w && a.h === b.h);
/** Proporción (ancho / alto) que se mantiene con el eslabón; null = suelto. */
let sizeRatio: number | null = null;
const paperName = () => `${S.paper} ${S.orient === 'portrait' ? 'vertical' : 'horizontal'}`;
/** Medida más grande que admite el papel de ahora (12 × 12 hojas). */
const sizeMax = () => maxSize(S, MAX_COLS_ROWS);

/**
 * Pone el póster a w × h mm (redondeado a mm, entre el mínimo y lo que caben 12 × 12 hojas). Si hubo que recortar la
 * medida, lo dice: es mejor que ver otro número sin saber por qué.
 */
function setSize(w: number, h: number) {
  const max = sizeMax(), next = { w: clampSize(w, max.w), h: clampSize(h, max.h) };
  if (Math.round(w) > Math.floor(max.w) || Math.round(h) > Math.floor(max.h)) {
    toast(`Con ${paperName()}, el póster llega hasta ${cm(max.w)} × ${cm(max.h)} cm (${MAX_COLS_ROWS} × ${MAX_COLS_ROWS} hojas). Para más, usa A3.`, 7000);
  } else if (Math.round(w) < MIN_SIZE || Math.round(h) < MIN_SIZE) toast(`La medida más pequeña es ${cm(MIN_SIZE)} cm.`, 5000);
  editLayout('size', next);
  syncLayoutUI(); // aunque no cambie (medida recortada igual a la de antes), el campo vuelve a mostrar la buena
}
/** Al cambiar a un papel más pequeño, una medida grande puede no caber en 12 × 12 hojas: se reduce y se avisa. */
function fitSizeToMax() {
  if (!S.size) return;
  const max = sizeMax();
  if (S.size.w <= max.w && S.size.h <= max.h) return;
  S.size = { w: clampSize(S.size.w, max.w), h: clampSize(S.size.h, max.h) };
  toast(`El póster se redujo a ${cm(S.size.w)} × ${cm(S.size.h)} cm: con ${paperName()} no caben más de ${MAX_COLS_ROWS} × ${MAX_COLS_ROWS} hojas.`, 7000);
}
/** Imagen de referencia para «Como la imagen»: la seleccionada o, si no, la primera visible. */
const refLayer = () => (st.sel && !st.sel.hidden ? st.sel : st.layers.find((l) => !l.hidden) ?? null);

/** Campo de medida (cm con coma decimal). Enter o salir aplica; ↑ ↓ suman o restan 1 cm (con Shift, 10). */
function sizeField(id: string, axis: 'w' | 'h') {
  const el = $<HTMLInputElement>(id);
  const run = () => {
    const v = parseNum(el.value) * 10, g = posterGeo();
    if (!Number.isFinite(v) || v <= 0) { syncLayoutUI(); return; }
    const cur = axis === 'w' ? g.W : g.H;
    if (Math.round(v) === Math.round(cur) && S.size) { syncLayoutUI(); return; }
    if (axis === 'w') setSize(v, sizeRatio ? v / sizeRatio : g.H);
    else setSize(sizeRatio ? v * sizeRatio : g.W, v);
  };
  el.addEventListener('change', run);
  el.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); run(); el.select(); return; }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      const v = parseNum(el.value);
      if (!Number.isFinite(v)) return;
      e.preventDefault();
      el.value = fmt1(Math.max(MIN_SIZE / 10, v + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)));
      run(); el.select();
    }
  });
}

function syncSizeUI(g: Geo) {
  for (const [id, v] of [['#sizeW', g.W], ['#sizeH', g.H]] as const) {
    const el = $<HTMLInputElement>(id);
    if (document.activeElement !== el) el.value = fmt1(v / 10);
  }
  const lock = $('#sizeLock');
  lock.setAttribute('aria-pressed', String(sizeRatio != null));
  lock.innerHTML = ICON[sizeRatio != null ? 'ratioOn' : 'ratioOff']; // constante del código
  for (const b of $$<HTMLButtonElement>('#sizePresets [data-w]')) {
    const w = +b.dataset.w!, h = +b.dataset.h!;
    b.setAttribute('aria-pressed', String(!!S.size && ((S.size.w === w && S.size.h === h) || (S.size.w === h && S.size.h === w))));
  }
  $<HTMLButtonElement>('#sizeImage').disabled = !refLayer();
  syncSizeNote(g);
}
/** Qué hojas lleva la medida y, si se pueden ahorrar hojas, cómo (cada sugerencia con su botón). */
function syncSizeNote(g: Geo = posterGeo()) {
  const n = g.cols * g.rows, plan = sheetPlan(g), skipped = plan.blank.size;
  const partial = g.GW > g.W + 0.5 || g.GH > g.H + 0.5;
  let t = `${g.cols} × ${g.rows} ${n === 1 ? 'hoja' : 'hojas'} ${paperName()}`;
  if (partial) t += g.GW > g.W + 0.5 && g.GH > g.H + 0.5 ? ' · la última columna y la última fila, a medias'
    : g.GW > g.W + 0.5 ? ' · la última columna, a medias' : ' · la última fila, a medias';
  if (skipped) t += ` · ${skipped} en blanco, no se ${skipped === 1 ? 'imprime' : 'imprimen'}`;
  if ($('#sizeNote').textContent !== t + '.') $('#sizeNote').textContent = t + '.';
  // las sugerencias solo se rehacen si cambian: rehacerlas durante un clic (llega la lectura de las hojas en blanco)
  // se comería el clic en su botón
  const list: [string, string, () => void][] = [];
  const tip = (text: string, label: string, fn: () => void) => { list.push([text, label, fn]); };
  // la otra orientación del papel, si usa menos hojas
  if (!S.size) { renderTips([]); return; }
  const other: Orient = S.orient === 'portrait' ? 'landscape' : 'portrait', alt = sheetCount(S, S.size, other);
  if (alt.n < n && alt.cols <= MAX_COLS_ROWS && alt.rows <= MAX_COLS_ROWS) {
    tip(`Con las hojas en ${other === 'portrait' ? 'vertical' : 'horizontal'}: ${alt.n} en vez de ${n}.`, 'Cambiar', () => editLayout('orient', other));
  }
  // la última columna o fila lleva muy poco: acortar un poco la medida ahorra una tira de hojas
  const slack = sizeSlack(g);
  if (slack) {
    const saved = slack.axis === 'w' ? g.rows : g.cols, w = slack.axis === 'w' ? Math.floor(g.W - slack.trim) : g.W;
    const h = slack.axis === 'h' ? Math.floor(g.H - slack.trim) : g.H;
    if (w >= MIN_SIZE && h >= MIN_SIZE) {
      tip(`La última ${slack.axis === 'w' ? 'columna' : 'fila'} lleva solo ${cm(slack.trim)} cm. Con ${cm(slack.axis === 'w' ? w : h)} cm de ${slack.axis === 'w' ? 'ancho' : 'alto'} ahorras ${saved} ${saved === 1 ? 'hoja' : 'hojas'}.`,
        'Ajustar', () => setSize(w, h));
    }
  }
  renderTips(list);
}
let tipsKey = '';
function renderTips(list: [string, string, () => void][]) {
  const key = list.map(([t, l]) => t + '|' + l).join('\n'), tips = $('#sizeTips');
  if (key === tipsKey) return;
  tipsKey = key;
  tips.textContent = '';
  for (const [text, label, fn] of list) {
    const d = document.createElement('div'), p = document.createElement('span'), b = document.createElement('button');
    d.className = 'tip'; p.textContent = text; b.type = 'button'; b.textContent = label;
    b.addEventListener('click', fn);
    d.append(p, b); tips.appendChild(d);
  }
}

/** Lado (px) del recuadro en el que cabe el icono de cada distribución (mismo valor que .sheet-box en global.css). */
const PRESET_BOX = 26;
/**
 * Icono de cada distribución: una miniatura del póster con la proporción que tendría con el papel, la orientación,
 * el margen y el solape actuales (1×3 en A4 vertical sale alto y estrecho), escalada para caber en el recuadro.
 */
function syncPresetIcons() {
  for (const b of $$('#presets [data-c]')) {
    const g = geo({ ...S, size: null, cols: +b.dataset.c!, rows: +b.dataset.r! }), k = PRESET_BOX / Math.max(g.W, g.H);
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
function setField(id: string, v: string | number) {
  const el = $<HTMLInputElement>(id);
  if (document.activeElement !== el) el.value = String(v);
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
  }
  $('#lockNote').hidden = !sel?.locked;
  if (sel) {
    setField('#pName', sel.name);
    const op = Math.round(sel.opacity * 100);
    setField('#pOpacity', op); $('#pOpacityOut').textContent = `${op} %`;
    syncAdjustUI(sel);
    const b = bboxMM(sel);
    setField('#pW', fmt1(visW(sel) / 10)); setField('#pH', fmt1(visH(sel) / 10));
    setField('#pX', fmt1(b.x0 / 10)); setField('#pY', fmt1(b.y0 / 10)); setField('#pR', Math.round(sel.rot));
    $('#unstretch').hidden = !isStretched(sel);
    $('#pdfField').hidden = !(sel.pdf && sel.pages > 1);
    if (sel.pdf) { $<HTMLInputElement>('#pdfPage').max = String(sel.pages); setField('#pdfPage', sel.page); $('#pdfPages').textContent = 'de ' + sel.pages; }
  }
  syncTextPanel();
  syncSelectionCard();
  followSelection();
  updateStats(); updateHint();
}
/**
 * Campo numérico de la imagen (texto con coma decimal, no type=number, que mostraría «14.3» según el navegador).
 * Enter o salir del campo aplica; ↑ ↓ suman o restan step (con Shift, 10 veces más), como en Figma.
 */
function numField(id: string, apply: (l: Layer, v: number) => void, step = 0.1) {
  const el = $<HTMLInputElement>(id);
  // texto que ya se aplicó: Enter aplica y, al salir del campo, el navegador lanza otro «change» con el mismo
  // texto, que no debe dejar un segundo paso de deshacer (vacío)
  let applied: string | null = null;
  const run = () => {
    const sel = st.sel;
    if (!sel || el.value === applied) return;
    const v = parseNum(el.value);
    if (!Number.isFinite(v)) { syncSel(); return; }
    if (sel.locked) { syncSel(); return; }
    applied = el.value;
    snap(); apply(sel, v); afterChange();
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
      el.value = step < 1 ? fmt1(v + d) : String(Math.round(v + d));
      run(); el.select();
    }
  });
}

/* ---------- lista de imágenes ---------- */
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
  const key = [canvasId(l.img), canvasRevision(l.img), k.x0, k.y0, k.x1, k.y1, l.w, l.h, l.rot, l.flipX, l.flipY, C.chk1, C.chk2, l.adjust ? adjustKey(l.adjust) : ''].join('|');
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
    x.drawImage(l.adjust ? adjustedSource(l.img, l.adjust) : l.img, k.x0 * l.img.width, k.y0 * l.img.height, sw, sh, (-dw * s) / 2, (-dh * s) / 2, dw * s, dh * s);
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
  b.addEventListener('click', pick);
  b.addEventListener('dblclick', () => focusGroupName(gid)); // doble clic: renombrar, como con las imágenes
  b.addEventListener('contextmenu', (e) => { e.preventDefault(); pick(); if (st.group.length > 1) openMenu(e.clientX, e.clientY, groupMenu()); });
  li.append(chev, b);
  const acts: [keyof typeof ICON, string, (e: MouseEvent) => void][] = [
    [allHidden ? 'eyeOff' : 'eye', allHidden ? 'Mostrar el grupo' : 'Ocultar el grupo', () => toggleGroupFlag(gid, 'hidden')],
    [allLocked ? 'lock' : 'lockOpen', allLocked ? 'Desbloquear el grupo' : 'Bloquear el grupo', () => toggleGroupFlag(gid, 'locked')],
    ['more', 'Más opciones del grupo', (e) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      pick(); if (st.group.length > 1) openMenu(r.left, r.bottom + 4, groupMenu(), () => moreOfGroup(gid));
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

export function renderList() {
  const ol = document.querySelector('#layers');
  if (!ol || !C.chk1) return;
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
    // Shift o Ctrl + clic en la lista también suma o quita de la selección
    b.addEventListener('click', (e) => { if ((e.shiftKey || e.ctrlKey || e.metaKey) && !l.hidden) toggleInSelection(l); else select(l); });
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
export const pdfPages = () => sheetPlan().printed + (S.guide ? 1 : 0);
/** Hay algo que imprimir (las ocultas no se imprimen). */
export const isPrintable = () => st.layers.some((l) => !l.hidden);
/**
 * Sin nada que imprimir no se puede descargar ni imprimir el póster (la hoja de prueba sí: no necesita imágenes).
 * También al terminar una descarga.
 */
export function syncExportButtons() {
  const n = pdfPages(), busy = document.body.classList.contains('exporting');
  // también si lo visible queda fuera del póster o es todo blanco: el PDF solo tendría papel vacío
  const empty = isPrintable() && sheetPlan().empty, printable = isPrintable() && !empty;
  const why = empty ? 'No hay nada dentro del póster: todas las hojas saldrían en blanco'
    : st.layers.length ? 'Todas las imágenes están ocultas' : 'Agrega una imagen primero';
  for (const id of ['#quickExport', '#exportTiles', '#printTiles', '#exportSingle']) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = !printable || busy;
    b.title = printable ? '' : why;
  }
  const pages = `${n} ${n === 1 ? 'página' : 'páginas'}`;
  if (printable) $('#quickExport').title = `PDF por hojas · ${pages} · ${S.dpi} ppp`;
  $<HTMLButtonElement>('#newPosterAlt').disabled = isFreshPoster();
}

/* ---------- resumen para descargar ---------- */
/**
 * La lectura ya no flota en el lienzo: el tamaño del póster se dibuja junto a él y la calidad, en la etiqueta de la
 * imagen seleccionada. Arriba de la tarjeta del PDF se dice qué se va a descargar y, solo si alguna imagen no tiene buena
 * calidad, un aviso estándar (icono, título y texto).
 */
export function updateStats() {
  const g = posterGeo(), plan = sheetPlan(g), n = plan.printed, skipped = plan.blank.size;
  // las ocultas no se imprimen: no cuentan
  const rows = st.layers.filter((l) => !l.hidden).map((l) => { const ppp = pppOf(l, HI_AREA); return { l, ppp, q: qualityOf(ppp) }; });
  const bad = rows.filter((r) => r.q === 'bad'), warn = rows.filter((r) => r.q === 'warn');


  const box = $('#exportSummary');
  box.textContent = '';
  const info = document.createElement('p');
  info.className = 'm-0 text-[.88rem] font-semibold';
  const orient = S.orient === 'portrait' ? (n === 1 ? 'vertical' : 'verticales') : (n === 1 ? 'horizontal' : 'horizontales');
  info.textContent = `Póster ${cm(g.W)} × ${cm(g.H)} cm · ${n} ${n === 1 ? 'hoja' : 'hojas'} ${S.paper} ${orient}`
    + (skipped ? ` (${skipped} en blanco no se ${skipped === 1 ? 'imprime' : 'imprimen'})` : '');
  // y el PDF por hojas: cuántas páginas (con la guía) y a qué resolución
  const pages = pdfPages(), sub = document.createElement('p');
  sub.className = 'm-0 text-[.84rem] text-muted';
  sub.textContent = `PDF por hojas: ${pages} ${pages === 1 ? 'página' : 'páginas'}${S.guide ? ' (con la guía)' : ''} · ${S.dpi} ppp`;
  box.append(info, sub);
  if (!rows.length || plan.empty) {
    const p = document.createElement('p');
    p.className = 'm-0 text-[.86rem] text-muted';
    p.textContent = plan.empty ? 'No hay nada dentro del póster: todas las hojas saldrían en blanco. Mueve una imagen sobre el papel.'
      : st.layers.length ? 'Todas las imágenes están ocultas.' : 'Agrega una imagen para descargar.';
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
      if (!S.size && S.cols === c && S.rows === r) return;
      snap(); S.cols = c; S.rows = r; S.size = null; st.sheetsOn = true; layoutChanged();
    });
    presets.appendChild(b);
  }
  for (const b of $$('[data-step]')) b.addEventListener('click', () => {
    const k = b.dataset.step === 'rows' ? 'rows' : 'cols', g = posterGeo();
    const v = Math.min(Math.max(g[k] + Number(b.dataset.d), 1), MAX_COLS_ROWS);
    if (!S.size) { editLayout(k, v); return; }
    // con medida, sumar o quitar hojas vuelve a elegir por hojas, desde las que había
    snap(); Object.assign(S, { cols: g.cols, rows: g.rows, size: null }, { [k]: v }); st.sheetsOn = true; layoutChanged();
  });
  // tamaño por medidas
  sizeField('#sizeW', 'w');
  sizeField('#sizeH', 'h');
  $('#sizeLock').addEventListener('click', () => {
    const g = posterGeo();
    sizeRatio = sizeRatio == null ? g.W / g.H : null;
    syncLayoutUI();
  });
  const sizeBox = $('#sizePresets');
  for (const [name, w, h] of SIZE_PRESETS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip chip-size';
    b.dataset.w = String(w); b.dataset.h = String(h);
    b.textContent = name;
    b.title = `${cm(w)} × ${cm(h)} cm`;
    b.addEventListener('click', () => {
      // en la orientación del póster de ahora (apaisado si es más ancho que alto)
      const g = posterGeo(), [W, H] = g.W > g.H ? [h, w] : [w, h];
      if (sizeRatio != null) sizeRatio = W / H;
      setSize(W, H);
    });
    sizeBox.insertBefore(b, $('#sizeImage'));
  }
  $('#sizeImage').addEventListener('click', () => {
    const l = refLayer();
    if (!l) return;
    // la forma con la que se ve en el póster (con su recorte y su giro), al ancho de ahora
    const b = bboxMM(l), r = (b.x1 - b.x0) / (b.y1 - b.y0), g = posterGeo(), max = sizeMax();
    let W = g.W, H = W / r;
    if (H > max.h) { H = max.h; W = H * r; }
    if (sizeRatio != null) sizeRatio = r;
    setSize(W, H);
  });
  onBlankChange(() => { syncSizeNote(); updateStats(); syncExportButtons(); dirty(); });
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
  // ajustes de color
  for (const [id, k] of [['#adjBright', 'bright'], ['#adjContrast', 'contrast'], ['#adjSat', 'sat']] as const) {
    const el = $<HTMLInputElement>(id);
    el.addEventListener('input', () => {
      if (!st.sel) return;
      setAdjust(st.sel, { [k]: +el.value }, k);
      syncAdjustUI(st.sel);
    });
    el.addEventListener('change', () => renderList());
    // doble clic en el deslizador: vuelve a 0, como en los editores de fotos
    el.addEventListener('dblclick', () => { if (st.sel) { setAdjust(st.sel, { [k]: 0 }); syncAdjustUI(st.sel); renderList(); } });
  }
  $<HTMLInputElement>('#adjGray').addEventListener('change', (e) => {
    if (!st.sel) return;
    setAdjust(st.sel, { gray: (e.target as HTMLInputElement).checked });
    syncAdjustUI(st.sel); renderList();
  });
  $('#adjReset').addEventListener('click', () => { if (st.sel) { setAdjust(st.sel, null); syncAdjustUI(st.sel); renderList(); } });
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
  $('#gHide').addEventListener('click', hideSelected);
  $('#gLock').addEventListener('click', lockSelected);
  numField('#pW', (l, v) => { const f = Math.max(3, v * 10) / visW(l); if (S.lock || l.src?.kind === 'text') scaleLayer(l, f, cropCenter(l)); else keepCenter(l, (x) => { x.w *= f; }); markManual(l); });
  numField('#pH', (l, v) => { const f = Math.max(3, v * 10) / visH(l); if (S.lock || l.src?.kind === 'text') scaleLayer(l, f, cropCenter(l)); else keepCenter(l, (x) => { x.h *= f; }); markManual(l); });
  numField('#pX', (l, v) => { l.cx += v * 10 - bboxMM(l).x0; markManual(l); });
  numField('#pY', (l, v) => { l.cy += v * 10 - bboxMM(l).y0; markManual(l); });
  numField('#pR', (l, v) => { rotateLayer(l, normDeg(v) - l.rot, cropCenter(l)); markManual(l); }, 1);
  $('#pLock').addEventListener('click', () => {
    S.lock = !S.lock;
    const b = $('#pLock');
    b.setAttribute('aria-pressed', String(S.lock));
    b.innerHTML = ICON[S.lock ? 'ratioOn' : 'ratioOff']; // constante del código
  });
  $('#unstretch').addEventListener('click', unstretchSel);
  $('#fitContain').addEventListener('click', fitSel('contain'));
  $('#fitCover').addEventListener('click', fitSel('cover'));
  $('#center').addEventListener('click', centerSel);
  $<HTMLInputElement>('#pdfPage').addEventListener('change', async (e) => {
    const l = st.sel, input = e.target as HTMLInputElement;
    if (!l?.pdf) return;
    const n = Math.min(Math.max(parseInt(input.value) || 1, 1), l.pages);
    input.value = String(n);
    try {
      const c = await renderPdfPage(l.pdf, n);
      snap();
      const w = visW(l);
      keepCenter(l, (x) => { Object.assign(x, { img: c, orig: c, page: n, crop: { x0: 0, y0: 0, x1: 1, y1: 1 } }); x.w = w; x.h = w * natRatio(x); });
      // si estaba ajustada al póster, la nueva página (quizá de otra proporción) también se ajusta
      if (l.fit) applyFit(l, l.fit, posterGeo());
      afterChange();
    } catch { toast('No se pudo leer esa página'); }
  });

  // exportar
  for (const b of $$('[data-dpi]')) b.addEventListener('click', () => { S.dpi = Number(b.dataset.dpi); syncExportUI(); scheduleSave(); });
  $<HTMLInputElement>('#marks').addEventListener('change', (e) => { S.marks = (e.target as HTMLInputElement).checked; syncNewPoster(); scheduleSave(); });
  $<HTMLInputElement>('#guide').addEventListener('change', (e) => { S.guide = (e.target as HTMLInputElement).checked; syncLayoutUI(); syncNewPoster(); scheduleSave(); });
  $<HTMLInputElement>('#skipBlank').addEventListener('change', (e) => { S.skipBlank = (e.target as HTMLInputElement).checked; syncLayoutUI(); syncNewPoster(); dirty(); scheduleSave(); });


  prevG = posterGeo();
  syncLayoutUI();
}
