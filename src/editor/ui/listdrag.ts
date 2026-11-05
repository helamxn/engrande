/**
 * Reordenar la lista de imágenes arrastrando. Con ratón se arrastra la fila entera; en táctil, el asa de la
 * izquierda (el resto de la fila deja hacer scroll del panel). La fila sigue al dedo y las demás se apartan;
 * al soltar se cambia el orden con un solo paso de deshacer. Arriba en la lista = al frente en el póster.
 */
import { reorder } from '../actions';
import { st } from '../state';
import type { Layer } from '../types';

interface DragState {
  li: HTMLElement; l: Layer; id: number;
  y0: number; scroll0: number; started: boolean;
  rows: HTMLElement[]; from: number; to: number; step: number; mids: number[];
}

let drag: DragState | null = null;
/** El navegador lanza un clic al soltar: tras un arrastre no debe seleccionar ni abrir nada. */
let swallowClick = false;

export function initListDrag(ol: HTMLElement, layerOf: (li: Element) => Layer | undefined) {
  const scroller = () => ol.closest<HTMLElement>('[role=tabpanel]');

  ol.addEventListener('pointerdown', (e) => {
    const t = e.target as Element;
    if (e.button !== 0 || t.closest('.act')) return;
    const grip = t.closest('.grip');
    // táctil: solo desde el asa, para no impedir el scroll del panel
    if (!grip && e.pointerType !== 'mouse') return;
    const li = t.closest<HTMLElement>('li.layer'), l = li && layerOf(li);
    if (!li || !l || st.layers.length < 2) return;
    drag = { li, l, id: e.pointerId, y0: e.clientY, scroll0: scroller()?.scrollTop ?? 0, started: false, rows: [], from: 0, to: 0, step: 0, mids: [] };
    if (grip) { e.preventDefault(); ol.setPointerCapture(e.pointerId); }
  });

  ol.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const sc = scroller();
    const dy = e.clientY - drag.y0 + ((sc?.scrollTop ?? 0) - drag.scroll0);
    if (!drag.started) {
      if (Math.abs(dy) < 6) return;
      drag.started = true;
      if (!ol.hasPointerCapture(e.pointerId)) ol.setPointerCapture(e.pointerId);
      // solo las filas de imágenes visibles (no las de grupo ni las de un grupo plegado)
      drag.rows = ([...ol.children] as HTMLElement[]).filter((r) => r.classList.contains('layer') && !r.hidden);
      drag.from = drag.to = drag.rows.indexOf(drag.li);
      const r = drag.li.getBoundingClientRect(), next = drag.rows[drag.from + 1] ?? drag.rows[drag.from - 1];
      const gap = next ? Math.abs(next.getBoundingClientRect().top - r.top) - r.height : 6;
      drag.step = r.height + gap;
      drag.mids = drag.rows.map((row) => { const b = row.getBoundingClientRect(); return b.top + b.height / 2 + (sc?.scrollTop ?? 0); });
      drag.li.classList.add('dragging');
      ol.classList.add('reordering');
    }
    drag.li.style.transform = `translateY(${dy}px)`;
    // posición de destino: cuántas filas quedan por encima del centro de la arrastrada
    const center = drag.mids[drag.from]! + dy;
    let to = 0;
    drag.mids.forEach((m, i) => { if (i !== drag!.from && m < center) to++; });
    if (to !== drag.to) {
      drag.to = to;
      drag.rows.forEach((row, i) => {
        if (row === drag!.li) return;
        const shift = drag!.from < to && i > drag!.from && i <= to ? -drag!.step : drag!.from > to && i >= to && i < drag!.from ? drag!.step : 0;
        row.style.transform = shift ? `translateY(${shift}px)` : '';
      });
    }
    // cerca del borde del panel, se desplaza solo
    if (sc) {
      const b = sc.getBoundingClientRect();
      if (e.clientY < b.top + 32) sc.scrollTop -= 8;
      else if (e.clientY > b.bottom - 32) sc.scrollTop += 8;
    }
  });

  const end = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (!d.started) return;
    swallowClick = true;
    setTimeout(() => { swallowClick = false; }, 0);
    for (const row of d.rows) row.style.transform = '';
    d.li.classList.remove('dragging');
    ol.classList.remove('reordering');
    // la lista va al revés que st.layers (arriba = al frente = último del póster)
    const n = st.layers.length, i = st.layers.indexOf(d.l), j = n - 1 - d.to;
    if (e.type === 'pointerup' && i >= 0 && j !== i) reorder(d.l, j - i);
  };
  ol.addEventListener('pointerup', end);
  ol.addEventListener('pointercancel', end);
  ol.addEventListener('click', (e) => { if (swallowClick) { e.stopPropagation(); e.preventDefault(); } }, true);
}
