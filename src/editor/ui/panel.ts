/** Panel lateral: pestañas, ajustes de hojas, propiedades de la imagen, lista de imágenes, exportación y lectura. */
import {
  afterChange, centerSel, fitSel, groupName, hideSelected, lockSelected, markManual, renameGroup, renameLayer,
  reorder, select, selectedGroup, selectMany, setOpacity, toggleGroupFlag, toggleHidden, toggleInSelection,
  toggleLocked, unstretchSel,
} from '../actions';
import { MAX_COLS_ROWS, PRESETS } from '../constants';
import { $, $$, toast } from '../dom';
import { cm, fmt1, parseNum } from '../format';
import {
  applyFit, bboxMM, cropCenter, isStretched, keepCenter, natRatio, newLayoutMemory, normDeg, pppOf, qualityOf, relayout,
  rotateLayer, scaleLayer, visH, visW,
} from '../geometry';
import { snap } from '../history';
import { ALT, deskMQ, dockMQ, HI_AREA, isTouch } from '../platform';
import { C, posterGeo, S, st } from '../state';
import { fitView } from '../view';
import { renderPdfPage } from '../io/pdf';
import { canvasRevision, scheduleSave } from '../io/persist';
import { ICON } from './icons';
import { isPanelOff, isSheetOpen, openSheet, togglePanel } from './layout';
import { initListDrag } from './listdrag';
import { groupMenu, layerMenu, openMenu } from './menu';
import type { Quality, RelayoutMode } from '../geometry';
import { getPref, setPref } from '../prefs';
import type { Geo, Layer, LayoutSettings, Orient, Paper } from '../types';

/* ---------- pestañas (patrón ARIA tabs) ---------- */
/**
 * Pestaña que sigue a la selección, con memoria:
 * - al seleccionar algo estando en Hojas, pasa a Imágenes (en Descargar no se mueve: estarías leyendo o eligiendo);
 * - al soltar la selección vuelve a Hojas, pero solo si el cambio anterior fue automático;
 * - lo que eliges a mano se respeta; en móvil solo cambia si el panel inferior está abierto (nunca lo abre).
 */
let autoTab = false, hadSel = false;
const activeTab = () => $$<HTMLButtonElement>('[role=tab]').find((b) => b.getAttribute('aria-selected') === 'true')?.dataset.tab;
function followSelection(has: boolean) {
  // punto en «Imágenes» si hay selección y se está en otra pestaña
  $('#tab-image').classList.toggle('dot', has && activeTab() !== 'image');
  if (has === hadSel) return;
  hadSel = has;
  if (!deskMQ?.matches && !isSheetOpen()) return;
  if (has && activeTab() === 'sheets') { showTab('image'); autoTab = true; }
  else if (!has && autoTab && activeTab() === 'image') { showTab('sheets'); autoTab = false; }
  $('#tab-image').classList.toggle('dot', has && activeTab() !== 'image');
}

function showTab(t: string) {
  for (const b of $$<HTMLButtonElement>('[role=tab]')) {
    const on = b.dataset.tab === t;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  for (const p of $$('[role=tabpanel]')) p.hidden = p.dataset.pane !== t;
}
/** Renombrar un grupo: lo selecciona entero y lleva al campo «Nombre del grupo». */
export function focusGroupName(gid: number) {
  selectMany(st.layers.filter((l) => l.gid === gid));
  if (isPanelOff()) togglePanel(true);
  openSheet('half');
  showTab('image');
  const el = $<HTMLInputElement>('#gName');
  el.focus(); el.select();
}
/** Renombrar: lleva al campo «Nombre» de la imagen seleccionada (abre la pestaña y, si estaba plegado, el panel). */
export function focusName() {
  if (!st.sel) return;
  if (isPanelOff()) togglePanel(true);
  openSheet('half');
  showTab('image');
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
  syncLayoutUI();
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
  if (S[key] === value) return;
  const now = performance.now();
  if (!(coalesce && lastLayoutEdit.key === key && now - lastLayoutEdit.t < 1000)) snap();
  lastLayoutEdit = { key, t: now };
  (S as LayoutSettings)[key] = value;
  st.sheetsOn = true; // el usuario eligió la hoja: desde ahora se ven aunque el póster esté vacío
  layoutChanged();
}
export function syncLayoutUI() {
  $('#colsOut').textContent = String(S.cols);
  $('#rowsOut').textContent = String(S.rows);
  for (const b of $$('#presets [data-c]')) b.setAttribute('aria-pressed', String(+b.dataset.c! === S.cols && +b.dataset.r! === S.rows));
  for (const b of $$('[data-paper]')) b.setAttribute('aria-pressed', String(b.dataset.paper === S.paper));
  for (const b of $$('[data-orient]')) b.setAttribute('aria-pressed', String(b.dataset.orient === S.orient));
  $('#marginOut').textContent = S.margin + ' mm';
  $('#overlapOut').textContent = S.overlap + ' mm';
  const n = S.cols * S.rows + (S.guide ? 1 : 0);
  $('#exportTiles').textContent = `Descargar PDF por hojas · ${n} ${n === 1 ? 'página' : 'páginas'}`;
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
  followSelection(!!sel || st.group.length > 1);
  const gsel = selectedGroup();
  $('#gNameField').hidden = gsel == null;
  if (gsel != null) setField('#gName', st.layers.find((l) => l.gid === gsel)?.gname ?? '');
  if (st.group.length > 1) {
    // opacidad común; si son distintas se muestra «varias» y el deslizador en la mayor
    const ops = st.group.map((l) => Math.round(l.opacity * 100)), same = ops.every((o) => o === ops[0]);
    setField('#gOpacity', Math.max(...ops));
    $('#gOpacityOut').textContent = same ? `${ops[0]} %` : 'varias';
  }
  $('#lockNote').hidden = !sel?.locked;
  const n = st.group.length;
  $('#selNote').textContent = n > 1
    ? `${n} imágenes seleccionadas. Muévelas, escálalas o gíralas juntas en el lienzo; para alinearlas o repartirlas usa la barra ${dockMQ?.matches ? 'de abajo' : 'sobre el lienzo'}.`
    : 'Selecciona una imagen en el lienzo o en la lista para ver y cambiar su tamaño, posición y opacidad.';
  if (sel) {
    setField('#pName', sel.name);
    const op = Math.round(sel.opacity * 100);
    setField('#pOpacity', op); $('#pOpacityOut').textContent = `${op} %`;
    const b = bboxMM(sel);
    setField('#pW', fmt1(visW(sel) / 10)); setField('#pH', fmt1(visH(sel) / 10));
    setField('#pX', fmt1(b.x0 / 10)); setField('#pY', fmt1(b.y0 / 10)); setField('#pR', Math.round(sel.rot));
    $('#unstretch').hidden = !isStretched(sel);
    $('#pdfField').hidden = !(sel.pdf && sel.pages > 1);
    if (sel.pdf) { $<HTMLInputElement>('#pdfPage').max = String(sel.pages); setField('#pdfPage', sel.page); $('#pdfPages').textContent = 'de ' + sel.pages; }
  }
  updateStats(); updateHint();
}
/**
 * Campo numérico de la imagen (texto con coma decimal, no type=number, que mostraría «14.3» según el navegador).
 * Enter o salir del campo aplica; ↑ ↓ suman o restan step (con Shift, 10 veces más), como en Figma.
 */
function numField(id: string, apply: (l: Layer, v: number) => void, step = 0.1) {
  const el = $<HTMLInputElement>(id);
  const run = () => {
    const sel = st.sel;
    if (!sel) return;
    const v = parseNum(el.value);
    if (!Number.isFinite(v)) { syncSel(); return; }
    if (sel.locked) { syncSel(); return; }
    snap(); apply(sel, v); afterChange();
  };
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
function focusRow(l: Layer) {
  for (const li of document.querySelectorAll('#layers li')) if (rowLayer.get(li) === l) li.querySelector<HTMLElement>('.layer-main')?.focus();
}

/** Grupos plegados en la lista (solo afecta a la vista; no se guarda). */
const collapsed = new Set<number>();

/** Fila de un grupo: plegar, seleccionar el grupo entero, verlo u ocultarlo, bloquearlo y su menú. */
function groupRow(gid: number): HTMLLIElement {
  const members = st.layers.filter((l) => l.gid === gid);
  const li = document.createElement('li');
  const allHidden = members.every((l) => l.hidden), allLocked = members.every((l) => l.locked);
  li.className = 'group-row' + (selectedGroup() === gid ? ' on' : '') + (allHidden ? ' off' : '');
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
      pick(); if (st.group.length > 1) openMenu(r.left, r.bottom + 4, groupMenu());
    }],
  ];
  for (const [ic, t, fn] of acts) {
    const a = document.createElement('button');
    a.type = 'button'; a.className = 'act'; a.title = t; a.setAttribute('aria-label', t);
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
  let lastGid: number | null = null;
  [...st.layers].reverse().forEach((l) => {
    // las imágenes de un grupo van seguidas: antes de la primera, la fila del grupo
    if (l.gid != null && l.gid !== lastGid) ol.appendChild(groupRow(l.gid));
    lastGid = l.gid;
    const li = document.createElement('li');
    const on = l === st.sel || st.group.includes(l);
    li.className = 'layer' + (on ? ' on' : '') + (l.hidden ? ' off' : '') + (l.gid != null ? ' in-group' : '');
    if (l.gid != null && collapsed.has(l.gid)) li.hidden = true;
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
      if (st.group.length > 1 && st.group.includes(l)) { openMenu(r.left, r.bottom + 4, groupMenu()); return; }
      select(l); openMenu(r.left, r.bottom + 4, layerMenu(l));
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
      a.type = 'button'; a.className = 'act'; a.title = t; a.setAttribute('aria-label', t);
      a.innerHTML = ICON[ic]; a.disabled = dis;
      // bloqueada: el candado se resalta para que se distinga del abierto de un vistazo
      if (ic === 'lock') { a.classList.add('text-accent'); a.setAttribute('aria-pressed', 'true'); }
      a.addEventListener('click', fn);
      li.appendChild(a);
    }
    ol.appendChild(li);
  });
  $('#layerCount').textContent = String(n);
  // pantalla de inicio (un aviso con «Elegir imagen»), solo con el póster vacío
  $('#empty').hidden = n > 0;
  // sin nada que imprimir no se puede descargar (las ocultas no se imprimen)
  const printable = st.layers.some((l) => !l.hidden);
  for (const id of ['#quickExport', '#exportTiles', '#exportSingle']) {
    const b = $<HTMLButtonElement>(id);
    b.disabled = !printable;
    if (!printable) b.title = n ? 'Todas las imágenes están ocultas' : 'Agrega una imagen primero';
    else b.removeAttribute('title');
  }
  updateHint();
}

/* ---------- resumen para descargar ---------- */
/**
 * La lectura ya no flota en el lienzo: el tamaño del póster se dibuja junto a él y la calidad, en la etiqueta de la
 * imagen seleccionada. En la pestaña Descargar se dice qué se va a descargar y, solo si alguna imagen no tiene buena
 * calidad, un aviso estándar (icono, título y texto).
 */
export function updateStats() {
  const g = posterGeo(), n = S.cols * S.rows;
  // las ocultas no se imprimen: no cuentan
  const rows = st.layers.filter((l) => !l.hidden).map((l) => { const ppp = pppOf(l, HI_AREA); return { l, ppp, q: qualityOf(ppp) }; });
  const bad = rows.filter((r) => r.q === 'bad'), warn = rows.filter((r) => r.q === 'warn');

  const box = $('#exportSummary');
  box.textContent = '';
  const info = document.createElement('p');
  info.className = 'm-0 text-[.88rem] font-semibold';
  const orient = S.orient === 'portrait' ? (n === 1 ? 'vertical' : 'verticales') : (n === 1 ? 'horizontal' : 'horizontales');
  info.textContent = `Póster ${cm(g.W)} × ${cm(g.H)} cm · ${n} ${n === 1 ? 'hoja' : 'hojas'} ${S.paper} ${orient}`;
  box.appendChild(info);
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
  const H: Record<string, string> = {
    move: !st.layers.length ? 'Agrega una imagen para empezar'
      : st.group.length > 1 ? (t
        ? `${st.group.length} seleccionadas · arrastra para moverlas · pellizca para escalar y girar · toca fuera para deseleccionar`
        : `${st.group.length} seleccionadas · arrastra para moverlas · esquinas: escalar · círculo: girar · Esc: deseleccionar`)
      : sel?.hidden ? 'Imagen oculta: no se imprime · muéstrala con el ojo de la lista'
      : sel ? (t ? 'Arrastra para mover · pellizca sobre la imagen para escalar y girar · toca fuera para deseleccionar' : 'Esquinas: escalar · lados: estirar · círculo: girar · clic fuera para deseleccionar')
        : (t ? 'Toca una imagen para seleccionarla · mantén pulsado para más opciones' : 'Clic en una imagen para seleccionarla · arrastra en el fondo para elegir varias · clic derecho: más opciones'),
    crop: t
      ? 'Arrastra la imagen para encuadrarla · pellizca para ampliarla · bordes: tamaño del recorte'
      : `Arrastra la imagen para encuadrarla · rueda: ampliarla · bordes: tamaño del recorte (Shift: proporción, ${ALT}: desde el centro) · Enter: aplicar`,
    erase: S.brushMode === 'erase' ? 'Pinta sobre la imagen para borrar' : 'Pinta para recuperar lo borrado',
    wand: t ? 'Toca un color de la imagen para borrarlo' : 'Haz clic en un color de la imagen para borrarlo',
  };
  hint.textContent = H[S.mode] ?? '';
  // con el póster vacío la pista sobra: la pantalla de inicio ya explica qué hacer
  hint.classList.toggle('invisible', !st.layers.length);
}


export function initPanel() {
  // pestañas
  // elegida a mano: se respeta (deja de ser un cambio automático)
  for (const b of $$<HTMLButtonElement>('[role=tab]')) {
    b.addEventListener('click', () => { autoTab = false; showTab(b.dataset.tab!); $('#tab-image').classList.toggle('dot', hadSel && b.dataset.tab !== 'image'); });
  }
  $('[role=tablist]').addEventListener('keydown', (e) => {
    const tabs = $$<HTMLButtonElement>('[role=tab]'), i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); e.stopPropagation();
    tabs[j]!.focus(); autoTab = false; showTab(tabs[j]!.dataset.tab!);
  });

  // hojas
  const presets = $('#presets');
  for (const [c, r] of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = `${c}×${r}`;
    b.dataset.c = String(c); b.dataset.r = String(r);
    b.addEventListener('click', () => {
      if (S.cols === c && S.rows === r) return;
      snap(); S.cols = c; S.rows = r; st.sheetsOn = true; layoutChanged();
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
  $<HTMLInputElement>('#margin').addEventListener('input', (e) => editLayout('margin', +(e.target as HTMLInputElement).value, true));
  $<HTMLInputElement>('#overlap').addEventListener('input', (e) => editLayout('overlap', +(e.target as HTMLInputElement).value, true));

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
  const gNow = () => { const g = selectedGroup(); return g == null ? '' : st.layers.find((l) => l.gid === g)?.gname ?? ''; };
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
  numField('#pW', (l, v) => { const f = Math.max(3, v * 10) / visW(l); if (S.lock) scaleLayer(l, f, cropCenter(l)); else keepCenter(l, (x) => { x.w *= f; }); markManual(l); });
  numField('#pH', (l, v) => { const f = Math.max(3, v * 10) / visH(l); if (S.lock) scaleLayer(l, f, cropCenter(l)); else keepCenter(l, (x) => { x.h *= f; }); markManual(l); });
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
  $<HTMLInputElement>('#marks').addEventListener('change', (e) => { S.marks = (e.target as HTMLInputElement).checked; scheduleSave(); });
  $<HTMLInputElement>('#guide').addEventListener('change', (e) => { S.guide = (e.target as HTMLInputElement).checked; syncLayoutUI(); scheduleSave(); });


  prevG = posterGeo();
  syncLayoutUI();
}
