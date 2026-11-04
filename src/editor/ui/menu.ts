/**
 * Menú contextual (clic derecho, mantener pulsado o botón "Más"), con submenús.
 *
 * - Ratón: el submenú se abre al pasar por encima, con un pequeño retardo, y no se cierra si el puntero
 *   va en diagonal hacia él (se comprueba si se mueve dentro del triángulo que apunta al submenú).
 * - Teclado: ↑ ↓ Inicio Fin para moverse, → o Enter abre el submenú, ← o Esc lo cierra, Esc cierra el menú.
 * - Táctil: los submenús no se abren al lado (no caben); el menú pasa a mostrar su contenido con «Atrás».
 */
import {
  copyLayer, duplicateLayer, enterCrop, fitSel, centerSel, flip, newPoster, pasteLayer, removeLayer, reorder,
  resetOriginal, rotate90, select, setMode, toggleHidden, unstretchSel, autoBackground,
} from '../actions';
import { $, toast } from '../dom';
import { isStretched } from '../geometry';
import { DELK, isTouch, MOD, SHIFT } from '../platform';
import { st } from '../state';
import { fitView, zoomCenter } from '../view';
import { loadFiles } from '../io/load';
import { ICON } from './icons';
import type { Layer, Pt } from '../types';

export interface ActionItem { label: string; kbd?: string; fn: () => void; disabled?: boolean; danger?: boolean }
export interface SubmenuItem { label: string; submenu: MenuItem[]; disabled?: boolean }
export type MenuItem = '-' | { head: string } | ActionItem | SubmenuItem;
const isSub = (it: ActionItem | SubmenuItem): it is SubmenuItem => 'submenu' in it;

/* ---------- contenido ---------- */
/** "Pegar" primero intenta una imagen del portapapeles del sistema (como Ctrl+V); si no hay, la copiada en Pliego. */
const canPaste = () => !!st.clip || !!navigator.clipboard?.read;
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
  if (!pasteLayer()) toast(`No hay ninguna imagen para pegar. Copia una imagen o usa ${MOD}C sobre una del póster.`);
}

/**
 * Lo frecuente queda a la vista; lo ocasional va en submenús (Orden, Girar y voltear, Tamaño y posición).
 * Lo que nunca aplica se oculta en vez de desactivarse: "Orden" con una sola imagen y "Quitar deformación"
 * si no está deformada. "Pegar" sí aparece desactivado, porque ese estado informa.
 */
export function layerMenu(l: Layer): MenuItem[] {
  const i = st.layers.indexOf(l), top = i === st.layers.length - 1, bottom = i === 0;
  const locked = l.hidden; // oculta: no se puede editar hasta mostrarla
  return [
    { label: 'Recortar', kbd: isTouch() ? 'Doble toque' : 'Doble clic', fn: () => { select(l); enterCrop(); }, disabled: locked },
    { label: 'Quitar fondo', fn: () => { select(l); autoBackground(); }, disabled: locked },
    {
      label: 'Borrar a mano', disabled: locked, submenu: [
        { label: 'Borrador', kbd: 'E', fn: () => { select(l); setMode('erase'); } },
        { label: 'Varita', kbd: 'W', fn: () => { select(l); setMode('wand'); } },
      ],
    },
    '-',
    { label: 'Copiar', kbd: MOD + 'C', fn: () => copyLayer(l) },
    { label: 'Pegar', kbd: MOD + 'V', fn: () => void pasteAny(), disabled: !canPaste() },
    { label: 'Duplicar', kbd: MOD + 'D', fn: () => duplicateLayer(l) },
    { label: l.hidden ? 'Mostrar' : 'Ocultar', fn: () => toggleHidden(l) },
    '-',
    ...(st.layers.length > 1 ? [{
      label: 'Orden', submenu: [
        { label: 'Traer al frente', kbd: MOD + SHIFT + ']', fn: () => reorder(l, 'front'), disabled: top },
        { label: 'Traer adelante', kbd: MOD + ']', fn: () => reorder(l, 1), disabled: top },
        { label: 'Enviar atrás', kbd: MOD + '[', fn: () => reorder(l, -1), disabled: bottom },
        { label: 'Enviar al fondo', kbd: MOD + SHIFT + '[', fn: () => reorder(l, 'back'), disabled: bottom },
      ],
    } satisfies SubmenuItem] : []),
    {
      label: 'Girar y voltear', submenu: [
        { label: 'Girar 90° a la derecha', kbd: 'R', fn: rotate90(1) },
        { label: 'Girar 90° a la izquierda', kbd: SHIFT + 'R', fn: rotate90(-1) },
        { label: 'Espejo horizontal', kbd: 'H', fn: flip('x') },
        { label: 'Espejo vertical', kbd: SHIFT + 'H', fn: flip('y') },
      ],
    },
    {
      label: 'Tamaño y posición', submenu: [
        { label: 'Ajustar al póster', fn: fitSel('contain') },
        { label: 'Llenar el póster', fn: fitSel('cover') },
        { label: 'Centrar', fn: centerSel },
        ...(isStretched(l) ? [{ label: 'Quitar deformación', fn: unstretchSel }] : []),
      ],
    },
    '-',
    { label: 'Volver a la imagen original', fn: () => resetOriginal(l), disabled: locked },
    { label: 'Quitar del póster', kbd: DELK, fn: () => removeLayer(l), danger: true },
  ];
}
export function emptyMenu(): MenuItem[] {
  return [
    { label: 'Pegar', kbd: MOD + 'V', fn: () => void pasteAny(), disabled: !canPaste() },
    { label: 'Agregar imagen…', fn: () => $<HTMLInputElement>('#file').click() },
    { label: 'Nuevo póster', fn: newPoster },
    '-',
    { label: 'Ver todo el póster', kbd: MOD + '0', fn: fitView },
    { label: 'Acercar', kbd: '+', fn: () => zoomCenter(1.4) },
    { label: 'Alejar', kbd: '−', fn: () => zoomCenter(1 / 1.4) },
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

export const isMenuOpen = () => !!root && !root.hidden;
export function closeMenu() {
  if (!root) return;
  clearTimeout(hoverTimer);
  closeSub();
  root.hidden = true;
}

/* ---------- construcción ---------- */
const icon = (name: 'chevronRight' | 'chevronLeft', cls: string) => ICON[name].replace('class="', `class="${cls} `);

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
      const showKbd = it.kbd && (!drill || it.kbd.includes(' '));
      if (showKbd) { const k = document.createElement('kbd'); k.textContent = it.kbd!; b.appendChild(k); }
      b.addEventListener('click', () => { closeMenu(); it.fn(); });
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

export function openMenu(x: number, y: number, items: MenuItem[]) {
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
    case 'Escape': if (!back()) closeMenu(); break;
    default: handled = false;
  }
  if (handled) { e.preventDefault(); e.stopPropagation(); }
}

export function initMenu() {
  root = $('#menu');
  sub = document.createElement('div');
  sub.className = 'menu';
  sub.setAttribute('role', 'menu');
  sub.hidden = true;
  document.body.appendChild(sub);

  document.addEventListener('pointerdown', (e) => {
    const t = e.target as Node;
    if (!root.hidden && !root.contains(t) && !sub.contains(t)) closeMenu();
  }, true);
  addEventListener('resize', closeMenu);
  addEventListener('blur', closeMenu);
  root.addEventListener('mousemove', (e) => { moves.push({ x: e.clientX, y: e.clientY }); if (moves.length > 4) moves.shift(); });
  root.addEventListener('mouseleave', () => { moves = []; });
  sub.addEventListener('mouseenter', () => clearTimeout(hoverTimer));
  root.addEventListener('keydown', onKey);
  sub.addEventListener('keydown', onKey);
}
