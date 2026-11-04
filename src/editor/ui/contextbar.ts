/** Barra de herramientas que flota junto a la imagen seleccionada (o acoplada abajo en móvil). */
import {
  applyCrop, autoBackground, cancelCrop, enterCrop, flip, removeLayer, rotate90, setCropRatio, setMode,
} from '../actions';
import { RATIOS } from '../constants';
import { $ } from '../dom';
import { DELK, dockMQ } from '../platform';
import { cropPts, dirty } from '../render';
import { S, st, view } from '../state';
import { isGesturing } from '../input/pointer';
import { ICON, type IconName } from './icons';
import { layerMenu, openMenu } from './menu';
import { updateHint } from './panel';

let bar: HTMLElement;

/** Botón de la barra. opt: la etiqueta solo se ve en la barra acoplada (móvil). */
function tb(icon: IconName | null, label: string, act: string, title = label, cls = '', opt = false) {
  const lab = label ? `<span${opt ? ' class="opt"' : ''}>${label}</span>` : '';
  return `<button type="button" class="tb ${cls}" data-act="${act}" title="${title}" aria-label="${title}">${icon ? ICON[icon] : ''}${lab}</button>`;
}
const SEP = '<span class="sep"></span>';

export function renderBar() {
  if (!st.sel || st.sel.hidden) { bar.hidden = true; $('#hint').hidden = false; updateHint(); return; }
  let h = '';
  if (S.mode === 'move') {
    h = tb('crop', 'Recortar', 'crop', 'Recortar (doble clic)') + tb('bg', 'Quitar fondo', 'autobg')
      + tb('erase', 'Borrador', 'erase', 'Borrador (E)') + tb('wand', 'Varita', 'wand', 'Varita (W)')
      + SEP + tb('rot', 'Girar', 'rotR', 'Girar 90°', '', true) + tb('flip', 'Espejo', 'flipX', 'Espejo horizontal', '', true)
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
      + SEP + tb('bg', 'Fondo auto', 'autobg', 'Quitar fondo automático') + tb('check', 'Listo', 'done', 'Listo (Esc)', 'primary');
  }
  bar.innerHTML = h; // solo constantes y números: sin datos del usuario
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
  positionBar();
}

export function positionBar() {
  const sel = st.sel;
  if (!bar || bar.hidden || !sel) return;
  const docked = !!dockMQ?.matches;
  bar.classList.toggle('dock', docked);
  bar.classList.toggle('ghost', isGesturing());
  $('#hint').hidden = docked;
  if (docked) { bar.style.left = ''; bar.style.top = ''; return; }
  const pts = cropPts(sel), xs = pts.map((p) => p.x), ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const bw = bar.offsetWidth, bh = bar.offsetHeight;
  const x = Math.min(Math.max((minX + maxX) / 2 - bw / 2, 8), Math.max(8, view.CW - bw - 8));
  let y = minY - bh - (S.mode === 'move' ? 46 : 16);
  if (y < 8) { y = maxY + 40; if (y + bh > view.CH - 8) y = 8; }
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
    if (!b || !sel) return;
    switch (b.dataset.act) {
      case 'crop': enterCrop(); break;
      case 'autobg': autoBackground(); break;
      case 'erase': setMode('erase'); break;
      case 'wand': setMode('wand'); break;
      case 'rotR': rotate90(1)(); break;
      case 'flipX': flip('x')(); break;
      case 'more': { const r = b.getBoundingClientRect(); openMenu(r.left, r.bottom + 4, layerMenu(sel)); break; }
      case 'delete': removeLayer(sel); break;
      case 'ratio': setCropRatio(b.dataset.r ?? 'null'); break;
      case 'cancelCrop': cancelCrop(); break;
      case 'applyCrop': applyCrop(); break;
      case 'bm': S.brushMode = b.dataset.m === 'restore' ? 'restore' : 'erase'; renderBar(); break;
      case 'done': setMode('move'); break;
    }
  });
  dockMQ?.addEventListener('change', () => renderBar());
}
