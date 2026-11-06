/**
 * Menú contextual (clic derecho, mantener pulsado o botón "Más"), con submenús.
 *
 * - Ratón: el submenú se abre al pasar por encima, con un pequeño retardo, y no se cierra si el puntero
 *   va en diagonal hacia él (se comprueba si se mueve dentro del triángulo que apunta al submenú).
 * - Teclado: ↑ ↓ Inicio Fin para moverse, → o Enter abre el submenú, ← o Esc lo cierra, Esc cierra el menú.
 * - Táctil: los submenús no se abren al lado (no caben); el menú pasa a mostrar su contenido con «Atrás».
 */
import {
  alignSelected, autoBackground, centerSel, copyLayer, copySelected, cutSelected, distributeSelected, duplicateLayer,
  duplicateSelected, enterCrop, fitSel, flip, groupName, groupSelected, hideSelected, leaveGroup, lockSelected,
  newPoster, pasteLayer, removeLayer, removeSelected, reorder, resetOriginal, rotate90, select, selectAll,
  selectedGroup, selectMany, setMode, toggleHidden, toggleLocked, ungroupSelected, groupMembers, unstretchSel,
} from '../actions';
import { focusGroupName, focusName } from './panel';
import { $, toast } from '../dom';
import { isStretched } from '../geometry';
import { isTouch } from '../platform';
import { isFreshPoster, st } from '../state';
import { fitView, zoomCenter } from '../view';
import { loadFiles } from '../io/load';
import { ICON, type IconName } from './icons';
import { gesture, k, keysEl, rich, type Part } from './keys';
import type { Layer, Pt } from '../types';

/** icon: solo en las opciones principales (primer nivel); los submenús van sin iconos. */
export interface ActionItem { label: string; icon?: IconName; kbd?: Part[]; fn: () => void; disabled?: boolean; danger?: boolean }
export interface SubmenuItem { label: string; icon?: IconName; submenu: MenuItem[]; disabled?: boolean }
export type MenuItem = '-' | { head: string } | ActionItem | SubmenuItem;
const isSub = (it: ActionItem | SubmenuItem): it is SubmenuItem => 'submenu' in it;

/* ---------- contenido ---------- */
/**
 * «Medir distancias»: con ratón basta con Alt al pasar por encima; en táctil no hay Alt, así que el siguiente toque
 * en otra imagen (o en el póster) muestra las distancias, hasta tocar fuera del póster o pulsar Esc.
 */
function startMeasureMode() {
  st.measureMode = true;
  toast(isTouch() ? 'Toca otra imagen o el póster para medir · toca fuera del póster para terminar'
    : rich('Pasa el ratón por otra imagen o el póster · también con {alt} pulsado · {esc} para terminar'), 6000);
}
/** "Pegar" primero intenta una imagen del portapapeles del sistema (como Ctrl+V); si no hay, la copiada en Pliego. */
const canPaste = () => !!st.clip?.length || !!navigator.clipboard?.read;
async function pasteAny() {
  try {
    if (navigator.clipboard?.read) {
      const files: File[] = [];
      for (const it of await navigator.clipboard.read()) {
        const t = it.types.find((x) => x.startsWith('image/'));
        if (t) files.push(new File([await it.getType(t)], 'imagen pegada', { type: t }));
      }
      if (files.length) { void loadFiles(files); return; }
    }
  } catch { /* permiso denegado o API no disponible: se usa la copia interna */ }
  if (!pasteLayer()) toast(rich('No hay ninguna imagen para pegar. Copia una imagen o usa {mod+c} sobre una del póster.'));
}

/**
 * Lo frecuente queda a la vista; lo ocasional va en submenús (Orden, Girar y voltear, Tamaño y posición).
 * Lo que nunca aplica se oculta en vez de desactivarse: "Orden" con una sola imagen y "Quitar deformación"
 * si no está deformada. "Pegar" sí aparece desactivado, porque ese estado informa.
 */
export function layerMenu(l: Layer, prev: Layer[] = []): MenuItem[] {
  const i = st.layers.indexOf(l), top = i === st.layers.length - 1, bottom = i === 0;
  const locked = l.hidden || l.locked; // oculta o bloqueada: no se puede editar hasta mostrarla o desbloquearla
  // en táctil no hay Shift ni Ctrl: mantener pulsada otra imagen ofrece sumarla a lo que estaba seleccionado
  const addTo = prev.filter((x) => !x.hidden && x !== l);
  return [
    ...(addTo.length && !l.hidden ? [
      { label: `Agregar a la selección (${addTo.length + 1})`, icon: 'selectBox', fn: () => selectMany([...addTo, l]) } satisfies ActionItem,
      '-' as const,
    ] : []),
    { label: 'Recortar', icon: 'crop', kbd: [gesture(isTouch() ? 'Doble toque' : 'Doble clic')], fn: () => { select(l); enterCrop(); }, disabled: locked },
    { label: 'Quitar fondo', icon: 'bg', fn: () => { select(l); autoBackground(); }, disabled: locked },
    {
      label: 'Borrar zonas', icon: 'erase', disabled: locked, submenu: [
        { label: 'Borrador', kbd: k('e'), fn: () => { select(l); setMode('erase'); } },
        { label: 'Varita', kbd: k('w'), fn: () => { select(l); setMode('wand'); } },
      ],
    },
    '-',
    { label: 'Copiar', icon: 'copy', kbd: k('mod+c'), fn: () => copyLayer(l) },
    { label: 'Cortar', icon: 'cut', kbd: k('mod+x'), fn: () => { select(l); cutSelected(); }, disabled: l.locked },
    { label: 'Pegar', icon: 'paste', kbd: k('mod+v'), fn: () => void pasteAny(), disabled: !canPaste() },
    { label: 'Duplicar', icon: 'dup', kbd: k('mod+d'), fn: () => duplicateLayer(l) },
    { label: l.hidden ? 'Mostrar' : 'Ocultar', icon: l.hidden ? 'eye' : 'eyeOff', fn: () => toggleHidden(l) },
    { label: l.locked ? 'Desbloquear' : 'Bloquear', icon: l.locked ? 'lockOpen' : 'lock', fn: () => toggleLocked(l) },
    { label: 'Renombrar…', icon: 'rename', fn: () => { select(l); focusName(); } },
    { label: 'Medir distancias', icon: 'ruler', kbd: isTouch() ? undefined : k('alt'), fn: startMeasureMode },
    ...(l.gpath.length ? [
      { label: 'Seleccionar el grupo', icon: 'group', fn: () => selectMany(groupMembers(l.gpath.at(-1)!.id)) } satisfies ActionItem,
      { label: 'Sacar del grupo', icon: 'ungroup', fn: () => leaveGroup(l) } satisfies ActionItem,
    ] : []),
    '-',
    ...(st.layers.length > 1 ? [{
      label: 'Orden', icon: 'layers', submenu: [
        { label: 'Traer al frente', kbd: k('mod+shift+]'), fn: () => reorder(l, 'front'), disabled: top },
        { label: 'Traer adelante', kbd: k('mod+]'), fn: () => reorder(l, 1), disabled: top },
        { label: 'Enviar atrás', kbd: k('mod+['), fn: () => reorder(l, -1), disabled: bottom },
        { label: 'Enviar al fondo', kbd: k('mod+shift+['), fn: () => reorder(l, 'back'), disabled: bottom },
      ],
    } satisfies SubmenuItem] : []),
    {
      label: 'Girar y voltear', icon: 'rot', disabled: l.locked, submenu: [
        { label: 'Girar 90° a la derecha', kbd: k('r'), fn: rotate90(1) },
        { label: 'Girar 90° a la izquierda', kbd: k('shift+r'), fn: rotate90(-1) },
        { label: 'Voltear en horizontal', kbd: k('h'), fn: flip('x') },
        { label: 'Voltear en vertical', kbd: k('shift+h'), fn: flip('y') },
      ],
    },
    {
      label: 'Tamaño y posición', icon: 'scaling', disabled: l.locked, submenu: [
        { label: 'Ajustar al póster', fn: fitSel('contain') },
        { label: 'Llenar el póster', fn: fitSel('cover') },
        { label: 'Centrar', fn: centerSel },
        ...(isStretched(l) ? [{ label: 'Quitar deformación', fn: unstretchSel }] : []),
      ],
    },
    '-',
    { label: 'Volver a la imagen original', icon: 'history', fn: () => resetOriginal(l), disabled: locked },
    { label: 'Quitar del póster', icon: 'del', kbd: k('del'), fn: () => removeLayer(l), danger: true },
  ];
}
/** Menú de varias imágenes seleccionadas. */
/** Alinear las seleccionadas (submenú del grupo y botón «Alinear» de la barra en móvil). */
export const alignMenu = (): MenuItem[] => [
  { label: 'A la izquierda', fn: () => alignSelected('left') },
  { label: 'Al centro (horizontal)', fn: () => alignSelected('hcenter') },
  { label: 'A la derecha', fn: () => alignSelected('right') },
  '-',
  { label: 'Arriba', fn: () => alignSelected('top') },
  { label: 'Al centro (vertical)', fn: () => alignSelected('vcenter') },
  { label: 'Abajo', fn: () => alignSelected('bottom') },
];
/** Repartir las seleccionadas (3 o más). */
export const distributeMenu = (): MenuItem[] => [
  { label: 'En horizontal', fn: () => distributeSelected('x') },
  { label: 'En vertical', fn: () => distributeSelected('y') },
];
/** Proporción del recorte (botón «Proporción» de la barra en móvil); la elegida lleva una marca. */
export const ratioMenu = (ratios: ReadonlyArray<readonly [string, unknown]>, current: string, pick: (key: string) => void): MenuItem[] =>
  ratios.map(([t, r]) => ({ label: t, icon: String(r) === current ? 'check' as const : undefined, fn: () => pick(String(r)) }));

export function groupMenu(): MenuItem[] {
  const n = st.group.length, whole = selectedGroup();
  return [
    { head: whole != null ? `${groupName(whole)} · ${n} imágenes` : `${n} imágenes` },
    { label: 'Copiar', icon: 'copy', kbd: k('mod+c'), fn: copySelected },
    { label: 'Cortar', icon: 'cut', kbd: k('mod+x'), fn: cutSelected },
    { label: 'Duplicar', icon: 'dup', kbd: k('mod+d'), fn: duplicateSelected },
    { label: 'Medir distancias', icon: 'ruler', kbd: isTouch() ? undefined : k('alt'), fn: startMeasureMode },
    whole != null
      ? { label: 'Desagrupar', icon: 'ungroup', kbd: k('mod+shift+g'), fn: ungroupSelected }
      : { label: 'Agrupar', icon: 'group', kbd: k('mod+g'), fn: groupSelected },
    ...(whole != null ? [{ label: 'Renombrar grupo…', icon: 'rename', fn: () => focusGroupName(whole) } satisfies ActionItem] : []),
    '-',
    { label: 'Alinear', icon: 'alignLeft', submenu: alignMenu() },
    { label: 'Repartir', icon: 'distributeH', disabled: n < 3, submenu: distributeMenu() },
    '-',
    { label: 'Ocultar las ' + n, icon: 'eyeOff', fn: hideSelected },
    { label: 'Bloquear las ' + n, icon: 'lock', fn: lockSelected },
    '-',
    { label: 'Deseleccionar', icon: 'x', kbd: k('esc'), fn: () => select(null) },
    { label: `Quitar ${n} del póster`, icon: 'del', kbd: k('del'), fn: removeSelected, danger: true },
  ];
}
export function emptyMenu(): MenuItem[] {
  const visible = st.layers.filter((l) => !l.hidden).length;
  return [
    { label: 'Pegar', icon: 'paste', kbd: k('mod+v'), fn: () => void pasteAny(), disabled: !canPaste() },
    { label: 'Seleccionar todas', icon: 'selectBox', kbd: k('mod+a'), fn: selectAll, disabled: visible < 1 },
    { label: 'Agregar imagen…', icon: 'addImage', fn: () => $<HTMLInputElement>('#file').click() },
    { label: 'Nuevo póster', icon: 'newPoster', fn: newPoster, disabled: isFreshPoster() },
    '-',
    { label: 'Ver todo el póster', icon: 'fitAll', kbd: k('mod+0'), fn: fitView },
    { label: 'Acercar', icon: 'zoomInLens', kbd: k('+'), fn: () => zoomCenter(1.4) },
    { label: 'Alejar', icon: 'zoomOutLens', kbd: k('−'), fn: () => zoomCenter(1 / 1.4) },
  ];
}

/* ---------- estado ---------- */
let root: HTMLElement;
/** Submenú desplegado al lado (solo con ratón). */
let sub: HTMLElement;
let rootItems: MenuItem[] = [];
/** Táctil: los submenús se muestran dentro del mismo menú, con «Atrás». */
let drill = false;
let openParent: HTMLButtonElement | null = null;
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let nextId = 0;
const subOf = new WeakMap<HTMLButtonElement, SubmenuItem>();

/**
 * Dónde estaba el foco al abrir el menú, para devolverlo al cerrarlo con el teclado o al elegir una opción. Es una
 * función porque la opción puede volver a dibujar la lista y cambiar el botón por otro nuevo.
 */
type FocusTarget = () => HTMLElement | null;
let returnTo: FocusTarget | null = null;
const focusBack = (t: FocusTarget | null) => { const el = t?.(); if (el?.isConnected) el.focus({ preventScroll: true }); };

export const isMenuOpen = () => !!root && !root.hidden;
/**
 * Cierra el menú. restore: el foco vuelve a donde estaba al abrirlo (Esc, Tab o elegir una opción), como pide el
 * patrón ARIA de menú; al cerrarlo con un clic fuera, el foco va adonde se hizo clic.
 */
export function closeMenu(restore = false) {
  if (!root) return;
  clearTimeout(hoverTimer);
  const inside = root.contains(document.activeElement) || sub.contains(document.activeElement);
  closeSub();
  root.hidden = true;
  if (restore && inside) focusBack(returnTo);
  returnTo = null;
}

/* ---------- construcción ---------- */
const icon = (name: IconName, cls: string) => ICON[name].replace('class="', `class="${cls} `);

function build(container: HTMLElement, items: MenuItem[], level: 0 | 1) {
  container.textContent = '';
  for (const it of items) {
    if (it === '-') { container.appendChild(document.createElement('hr')); continue; }
    if ('head' in it) {
      const d = document.createElement('div');
      d.className = 'mhead'; d.textContent = it.head;
      container.appendChild(d); continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.id = 'mi-' + nextId++;
    b.setAttribute('role', 'menuitem');
    b.disabled = !!it.disabled;
    if (it.icon) b.insertAdjacentHTML('beforeend', ICON[it.icon].replace('class="', 'class="micon ')); // constante del código
    const s = document.createElement('span'); s.textContent = it.label; b.appendChild(s);
    if (isSub(it)) {
      subOf.set(b, it);
      b.setAttribute('aria-haspopup', 'menu');
      b.setAttribute('aria-expanded', 'false');
      b.insertAdjacentHTML('beforeend', icon('chevronRight', 'chev')); // constante del código
      b.addEventListener('click', () => (drill ? showDrill(it) : openSub(b, it, true)));
    } else {
      if (it.danger) b.className = 'danger';
      // en táctil no se muestran atajos de teclado; sí gestos como «Doble toque»
      if (it.kbd && (!drill || it.kbd.every((p) => typeof p !== 'string'))) b.appendChild(keysEl([it.kbd]));
      b.addEventListener('click', () => {
        const back = returnTo;
        closeMenu(true);
        it.fn();
        // si la opción no llevó el foco a otro sitio (p. ej. «Renombrar…») y se perdió al redibujar, vuelve
        if (!document.activeElement || document.activeElement === document.body) focusBack(back);
      });
    }
    if (level === 0 && !drill) b.addEventListener('mouseenter', () => hoverRootItem(b));
    if (level === 1) b.addEventListener('mouseenter', () => b.focus({ preventScroll: true }));
    container.appendChild(b);
  }
}

function placeRoot(x: number, y: number) {
  const r = root.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  root.style.left = Math.min(Math.max(x, 8), Math.max(8, vw - r.width - 8)) + 'px';
  root.style.top = (y + r.height > vh - 8 ? Math.max(8, y - r.height) : y) + 'px';
}
const focusFirst = (c: HTMLElement) => c.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });

/** from: a quién devolver el foco al cerrar (por defecto, al que lo tenía al abrir). */
export function openMenu(x: number, y: number, items: MenuItem[], from: FocusTarget | null = null) {
  if (root.hidden) {
    const a = document.activeElement, el = a instanceof HTMLElement && a !== document.body ? a : null;
    returnTo = from ?? (() => el);
  } else if (from) returnTo = from;
  closeSub();
  drill = isTouch();
  rootItems = items;
  build(root, items, 0);
  root.hidden = false;
  placeRoot(x, y);
  focusFirst(root);
}

/* ---------- submenú lateral (ratón y teclado) ---------- */
function openSub(b: HTMLButtonElement, it: SubmenuItem, focus: boolean) {
  if (openParent === b) { if (focus) focusFirst(sub); return; }
  closeSub();
  openParent = b;
  b.setAttribute('aria-expanded', 'true');
  b.classList.add('open');
  build(sub, it.submenu, 1);
  sub.setAttribute('aria-labelledby', b.id);
  sub.hidden = false;
  // a la derecha del menú; si no cabe, a la izquierda. En vertical, alineado con la opción y dentro de la pantalla
  const pr = b.getBoundingClientRect(), mr = root.getBoundingClientRect(), sr = sub.getBoundingClientRect();
  let left = mr.right - 4;
  if (left + sr.width > innerWidth - 8) left = Math.max(8, mr.left - sr.width + 4);
  const top = Math.max(8, Math.min(pr.top - 5, innerHeight - sr.height - 8));
  sub.style.left = left + 'px';
  sub.style.top = top + 'px';
  if (focus) focusFirst(sub);
}
function closeSub() {
  if (openParent) { openParent.setAttribute('aria-expanded', 'false'); openParent.classList.remove('open'); }
  openParent = null;
  if (sub) sub.hidden = true;
}

/** Últimas posiciones del puntero, para saber si va hacia el submenú abierto. */
let moves: Pt[] = [];
function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt) {
  const s = (p1: Pt, p2: Pt, p3: Pt) => (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
  const d1 = s(p, a, b), d2 = s(p, b, c), d3 = s(p, c, a);
  return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
}
/** El puntero se mueve dentro del triángulo que va desde donde estaba hasta el borde del submenú. */
function headingToSub() {
  if (sub.hidden || moves.length < 2) return false;
  const r = sub.getBoundingClientRect(), mr = root.getBoundingClientRect();
  const x = r.left >= mr.right - 10 ? r.left : r.right;
  return inTriangle(moves[moves.length - 1]!, moves[0]!, { x, y: r.top - 20 }, { x, y: r.bottom + 20 });
}
function hoverRootItem(b: HTMLButtonElement) {
  clearTimeout(hoverTimer);
  if (openParent === b) return;
  const it = subOf.get(b);
  const act = () => {
    if (it && !b.disabled) openSub(b, it, false); else closeSub();
    b.focus({ preventScroll: true });
  };
  // si va en diagonal hacia el submenú abierto, se espera; si se queda en esta opción, se cambia
  if (headingToSub()) hoverTimer = setTimeout(act, 300);
  else if (it) hoverTimer = setTimeout(act, 100);
  else act();
}

/* ---------- táctil: submenú dentro del mismo menú ---------- */
let drillFrom: HTMLElement | null = null;
function showDrill(it: SubmenuItem) {
  const r = root.getBoundingClientRect();
  build(root, it.submenu, 1);
  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'mback';
  back.setAttribute('role', 'menuitem');
  back.setAttribute('aria-label', 'Atrás');
  back.insertAdjacentHTML('afterbegin', icon('chevronLeft', 'chev')); // constante del código
  const t = document.createElement('span'); t.textContent = it.label; back.appendChild(t);
  back.addEventListener('click', drillBack);
  root.prepend(back, document.createElement('hr'));
  drillFrom = root;
  placeRoot(r.left, r.top);
  focusFirst(root);
}
function drillBack() {
  const r = root.getBoundingClientRect();
  build(root, rootItems, 0);
  drillFrom = null;
  placeRoot(r.left, r.top);
  focusFirst(root);
}

/* ---------- teclado ---------- */
function onKey(e: KeyboardEvent) {
  const active = document.activeElement as HTMLButtonElement | null;
  const inSub = !!active && sub.contains(active);
  const cont = inSub ? sub : root;
  const bs = [...cont.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  const i = active ? bs.indexOf(active) : -1;
  const move = (j: number) => bs[(j + bs.length) % bs.length]?.focus();
  const back = () => {
    if (inSub && openParent) { const p = openParent; closeSub(); p.focus(); return true; }
    if (drillFrom) { drillBack(); return true; }
    return false;
  };
  let handled = true;
  switch (e.key) {
    case 'ArrowDown': move(i + 1); break;
    case 'ArrowUp': move(i - 1); break;
    case 'Home': move(0); break;
    case 'End': move(bs.length - 1); break;
    case 'ArrowRight': {
      const it = active && subOf.get(active);
      if (it && !inSub) { if (drill) showDrill(it); else openSub(active, it, true); }
      break;
    }
    case 'ArrowLeft': back(); break;
    case 'Escape': if (!back()) closeMenu(true); break;
    // Tab sale del menú (lo cierra) y sigue desde donde se abrió, como en los menús del sistema
    case 'Tab': closeMenu(true); handled = false; break;
    default: handled = false;
  }
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}

export function initMenu() {
  root = $('#menu');
  sub = document.createElement('div');
  sub.className = 'menu';
  sub.setAttribute('role', 'menu');
  root.setAttribute('aria-label', 'Opciones');
  sub.hidden = true;
  document.body.appendChild(sub);

  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (!root.hidden && !root.contains(t) && !sub.contains(t)) closeMenu();
  }, true);
  addEventListener('resize', () => closeMenu());
  addEventListener('blur', () => closeMenu());
  root.addEventListener('mousemove', (e) => { moves.push({ x: e.clientX, y: e.clientY }); if (moves.length > 4) moves.shift(); });
  root.addEventListener('mouseleave', () => { moves = []; });
  sub.addEventListener('mouseenter', () => clearTimeout(hoverTimer));
  root.addEventListener('keydown', onKey);
  sub.addEventListener('keydown', onKey);
}
