/** Menú contextual (clic derecho, mantener pulsado o botón "Más"). */
import {
  copyLayer, duplicateLayer, enterCrop, fitSel, centerSel, flip, pasteLayer, removeLayer, reorder,
  resetOriginal, rotate90, select, setMode, unstretchSel, autoBackground,
} from '../actions';
import { $, toast } from '../dom';
import { isStretched } from '../geometry';
import { DELK, isTouch, MOD, SHIFT } from '../platform';
import { st } from '../state';
import { fitView, zoomCenter } from '../view';
import { loadFiles } from '../io/load';
import type { Layer } from '../types';

export type MenuItem =
  | '-'
  | { head: string }
  | { label: string; kbd?: string; fn: () => void; disabled?: boolean; danger?: boolean };

let menu: HTMLElement;

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

export function layerMenu(l: Layer): MenuItem[] {
  const i = st.layers.indexOf(l), top = i === st.layers.length - 1, bottom = i === 0;
  return [
    { label: 'Recortar', kbd: isTouch() ? 'Doble toque' : 'Doble clic', fn: () => { select(l); enterCrop(); } },
    { label: 'Quitar fondo', fn: () => { select(l); autoBackground(); } },
    { label: 'Borrador', kbd: 'E', fn: () => { select(l); setMode('erase'); } },
    { label: 'Varita', kbd: 'W', fn: () => { select(l); setMode('wand'); } },
    '-',
    { label: 'Copiar', kbd: MOD + 'C', fn: () => copyLayer(l) },
    { label: 'Pegar', kbd: MOD + 'V', fn: () => void pasteAny(), disabled: !canPaste() },
    { label: 'Duplicar', kbd: MOD + 'D', fn: () => duplicateLayer(l) },
    '-',
    { head: 'Orden' },
    { label: 'Traer al frente', kbd: MOD + SHIFT + ']', fn: () => reorder(l, 'front'), disabled: top },
    { label: 'Traer adelante', kbd: MOD + ']', fn: () => reorder(l, 1), disabled: top },
    { label: 'Enviar atrás', kbd: MOD + '[', fn: () => reorder(l, -1), disabled: bottom },
    { label: 'Enviar al fondo', kbd: MOD + SHIFT + '[', fn: () => reorder(l, 'back'), disabled: bottom },
    '-',
    { label: 'Girar 90° a la derecha', kbd: 'R', fn: rotate90(1) },
    { label: 'Girar 90° a la izquierda', kbd: SHIFT + 'R', fn: rotate90(-1) },
    { label: 'Espejo horizontal', kbd: 'H', fn: flip('x') },
    { label: 'Espejo vertical', kbd: SHIFT + 'H', fn: flip('y') },
    '-',
    { label: 'Ajustar al póster', fn: fitSel('contain') },
    { label: 'Llenar el póster', fn: fitSel('cover') },
    { label: 'Centrar', fn: centerSel },
    { label: 'Quitar deformación', fn: unstretchSel, disabled: !isStretched(l) },
    { label: 'Volver a la imagen original', fn: () => resetOriginal(l) },
    '-',
    { label: 'Quitar del póster', kbd: DELK, fn: () => removeLayer(l), danger: true },
  ];
}
export function emptyMenu(): MenuItem[] {
  return [
    { label: 'Pegar', kbd: MOD + 'V', fn: () => void pasteAny(), disabled: !canPaste() },
    { label: 'Agregar imagen…', fn: () => $<HTMLInputElement>('#file').click() },
    '-',
    { label: 'Ver todo el póster', kbd: MOD + '0', fn: fitView },
    { label: 'Acercar', kbd: '+', fn: () => zoomCenter(1.4) },
    { label: 'Alejar', kbd: '−', fn: () => zoomCenter(1 / 1.4) },
  ];
}

export const isMenuOpen = () => !menu.hidden;
export function closeMenu() { if (menu) menu.hidden = true; }

export function openMenu(x: number, y: number, items: MenuItem[]) {
  menu.textContent = '';
  for (const it of items) {
    if (it === '-') { menu.appendChild(document.createElement('hr')); continue; }
    if ('head' in it) {
      const d = document.createElement('div');
      d.className = 'mhead'; d.textContent = it.head;
      menu.appendChild(d); continue;
    }
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'menuitem');
    if (it.danger) b.className = 'danger';
    const s = document.createElement('span'); s.textContent = it.label; b.appendChild(s);
    if (it.kbd) { const k = document.createElement('kbd'); k.textContent = it.kbd; b.appendChild(k); }
    b.disabled = !!it.disabled;
    b.addEventListener('click', () => { closeMenu(); it.fn(); });
    menu.appendChild(b);
  }
  menu.hidden = false;
  const r = menu.getBoundingClientRect(), vw = innerWidth, vh = innerHeight;
  menu.style.left = Math.min(Math.max(x, 8), Math.max(8, vw - r.width - 8)) + 'px';
  menu.style.top = (y + r.height > vh - 8 ? Math.max(8, y - r.height) : y) + 'px';
  menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true });
}

export function initMenu() {
  menu = $('#menu');
  document.addEventListener('pointerdown', (e) => { if (!menu.hidden && !menu.contains(e.target as Node)) closeMenu(); }, true);
  addEventListener('resize', closeMenu);
  addEventListener('blur', closeMenu);
  menu.addEventListener('keydown', (e) => {
    const bs = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
    const i = bs.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); bs[(i + 1) % bs.length]?.focus(); }
    if (e.key === 'ArrowUp') { e.preventDefault(); bs[(i - 1 + bs.length) % bs.length]?.focus(); }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(); }
  });
}
