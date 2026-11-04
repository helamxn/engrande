/** Panel lateral: pestañas, ajustes de hojas, propiedades de la imagen, lista de imágenes, exportación y lectura. */
import {
  afterChange, centerSel, duplicateLayer, fitSel, markManual, removeLayer, reorder, select, toggleHidden, unstretchSel,
} from '../actions';
import { MAX_COLS_ROWS, PRESETS } from '../constants';
import { $, $$, toast } from '../dom';
import { cm, fmt1 } from '../format';
import {
  applyFit, bboxMM, cropCenter, isStretched, keepCenter, natRatio, normDeg, pppOf, qualityOf, relayout,
  rotateLayer, scaleLayer, visH, visW,
} from '../geometry';
import { snap } from '../history';
import { ALT, DELK, HI_AREA, isTouch, MOD } from '../platform';
import { dirty } from '../render';
import { C, posterGeo, S, st } from '../state';
import { fitView } from '../view';
import { renderPdfPage } from '../io/pdf';
import { scheduleSave } from '../io/persist';
import { ICON } from './icons';
import { layerMenu, openMenu } from './menu';
import type { Geo, Layer, LayoutSettings, Orient, Paper } from '../types';

/* ---------- pestañas (patrón ARIA tabs) ---------- */
function showTab(t: string) {
  for (const b of $$<HTMLButtonElement>('[role=tab]')) {
    const on = b.dataset.tab === t;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
  }
  for (const p of $$('[role=tabpanel]')) p.hidden = p.dataset.pane !== t;
}

/* ---------- distribución de hojas ---------- */
let prevG: Geo | null = null;
export function layoutChanged() {
  const g = posterGeo();
  if (prevG) relayout(st.layers, prevG, g);
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
  if (sel) {
    const b = bboxMM(sel);
    setField('#pW', fmt1(visW(sel) / 10)); setField('#pH', fmt1(visH(sel) / 10));
    setField('#pX', fmt1(b.x0 / 10)); setField('#pY', fmt1(b.y0 / 10)); setField('#pR', Math.round(sel.rot));
    $('#unstretch').hidden = !isStretched(sel);
    $('#pdfField').hidden = !(sel.pdf && sel.pages > 1);
    if (sel.pdf) { $<HTMLInputElement>('#pdfPage').max = String(sel.pages); setField('#pdfPage', sel.page); $('#pdfPages').textContent = 'de ' + sel.pages; }
  }
  updateReadout(); updateHint();
}
function numField(id: string, apply: (l: Layer, v: number) => void) {
  const el = $<HTMLInputElement>(id);
  const run = () => {
    const sel = st.sel;
    if (!sel) return;
    const v = parseFloat(String(el.value).replace(',', '.'));
    if (!Number.isFinite(v)) { syncSel(); return; }
    snap(); apply(sel, v); afterChange();
  };
  el.addEventListener('change', run);
  el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); el.select(); } });
}

/* ---------- lista de imágenes ---------- */
export function renderList() {
  const ol = document.querySelector('#layers');
  if (!ol || !C.chk1) return;
  ol.textContent = '';
  const n = st.layers.length;
  [...st.layers].reverse().forEach((l) => {
    const li = document.createElement('li');
    li.className = 'layer' + (l === st.sel ? ' on' : '') + (l.hidden ? ' off' : '');
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'layer-main';
    b.addEventListener('click', () => select(l));
    b.addEventListener('contextmenu', (e) => { e.preventDefault(); select(l); openMenu(e.clientX, e.clientY, layerMenu(l)); });
    // miniatura sobre fondo de cuadros
    const tc = document.createElement('canvas'); tc.width = 88; tc.height = 88;
    const x = tc.getContext('2d')!;
    for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { x.fillStyle = (i + j) % 2 ? C.chk2! : C.chk1!; x.fillRect(i * 11, j * 11, 11, 11); }
    const k = l.crop, sw = (k.x1 - k.x0) * l.img.width, sh = (k.y1 - k.y0) * l.img.height, dw = visW(l), dh = visH(l), s = Math.min(84 / dw, 84 / dh);
    x.drawImage(l.img, k.x0 * l.img.width, k.y0 * l.img.height, sw, sh, 44 - (dw * s) / 2, 44 - (dh * s) / 2, dw * s, dh * s);
    // el nombre del archivo es dato del usuario: siempre con textContent
    const nm = document.createElement('span'); nm.textContent = l.name;
    const sm = document.createElement('small');
    sm.textContent = (l.hidden ? 'Oculta · ' : '') + `${cm(visW(l))} × ${cm(visH(l))} cm` + (l.isSample ? ' · ejemplo' : l.pdf ? ` · PDF pág. ${l.page}` : '');
    nm.appendChild(sm);
    b.append(tc, nm); li.appendChild(b);
    const i = st.layers.indexOf(l);
    const acts: [keyof typeof ICON, string, () => void, boolean][] = [
      // ojo abierto = visible, como en Figma o Photoshop; al pulsarlo se oculta
      [l.hidden ? 'eyeOff' : 'eye', l.hidden ? 'Mostrar' : 'Ocultar', () => toggleHidden(l), false],
      ['up', 'Traer adelante', () => reorder(l, 1), i === n - 1],
      ['down', 'Enviar atrás', () => reorder(l, -1), i === 0],
      ['dup', 'Duplicar', () => duplicateLayer(l), false],
      ['del', 'Quitar del póster', () => removeLayer(l), false],
    ];
    for (const [ic, t, fn, dis] of acts) {
      const a = document.createElement('button');
      a.type = 'button'; a.className = 'act'; a.title = t; a.setAttribute('aria-label', t);
      a.innerHTML = ICON[ic]; a.disabled = dis;
      a.addEventListener('click', fn);
      li.appendChild(a);
    }
    ol.appendChild(li);
  });
  $('#layerCount').textContent = String(n);
  const badge = $('#sampleBadge'), wasHidden = badge.hidden;
  badge.hidden = !st.layers.some((l) => l.isSample) || !!st.sel;
  if (wasHidden !== badge.hidden) dirty();
  updateHint();
}

/* ---------- lectura bajo el lienzo ---------- */
export function updateReadout() {
  const g = posterGeo(), sel = st.sel;
  // las imágenes ocultas no se imprimen: no cuentan para la calidad
  const t = sel ?? st.layers.reduce<Layer | null>((a, l) => (l.hidden ? a : !a || pppOf(l, HI_AREA) < pppOf(a, HI_AREA) ? l : a), null);
  const out = $('#readout');
  out.textContent = '';
  const item = (label: string, value: string) => {
    const s = document.createElement('span'); s.append(label + ' ');
    const b = document.createElement('b'); b.textContent = value; s.append(b);
    out.appendChild(s); return s;
  };
  item('Póster', `${cm(g.W)} × ${cm(g.H)} cm`);
  const sheets = document.createElement('span');
  const nb = document.createElement('b'); nb.textContent = String(S.cols * S.rows);
  sheets.append(nb, ` hojas ${S.paper} ${S.orient === 'portrait' ? 'verticales' : 'horizontales'}`);
  out.appendChild(sheets);
  if (t) {
    const ppp = pppOf(t, HI_AREA), q = qualityOf(ppp);
    const s = item(sel ? 'Seleccionada' : st.layers.length > 1 ? 'Peor imagen' : 'Imagen', `${ppp} ppp`);
    const pill = document.createElement('span');
    pill.className = `pill q-${q}`;
    pill.textContent = q === 'good' ? 'buena' : q === 'warn' ? 'aceptable' : 'baja';
    s.append(' ', pill);
  }
}

/* ---------- pista inferior ---------- */
export function updateHint() {
  const hint = document.querySelector('#hint');
  if (!hint) return;
  const t = isTouch(), sel = st.sel;
  const H: Record<string, string> = {
    move: !st.layers.length ? 'Agrega una imagen para empezar'
      : sel?.hidden ? 'Imagen oculta: no se imprime · muéstrala con el ojo de la lista'
      : sel ? (t ? 'Arrastra para mover · pellizca sobre la imagen para escalar y girar · toca fuera para soltar' : 'Esquinas: escalar · lados: estirar · punto superior: girar · clic fuera para soltar')
        : (t ? 'Toca una imagen para seleccionarla · mantén pulsado para más opciones' : 'Clic en una imagen para seleccionarla · clic derecho para más opciones'),
    crop: t
      ? 'Arrastra la imagen para encuadrarla · pellizca para ampliarla · bordes: tamaño del recorte'
      : `Arrastra la imagen para encuadrarla · rueda: ampliarla · bordes: tamaño del recorte (Shift: proporción, ${ALT}: desde el centro) · Enter aplica`,
    erase: S.brushMode === 'erase' ? 'Pinta sobre la imagen para borrar' : 'Pinta para recuperar lo borrado',
    wand: 'Toca un color de la imagen para borrarlo',
  };
  hint.textContent = H[S.mode] ?? '';
  const tip = document.querySelector('#tip');
  if (tip) tip.textContent = t ? 'Mantén pulsada una imagen para más opciones' : 'Clic derecho sobre el lienzo para más opciones';
}

const SHORTCUTS: [string, string][] = [
  ['Clic derecho / mantener pulsado', 'Menú de opciones'], ['Doble clic', 'Recortar · Enter aplica · Esc cancela'], ['Al recortar: arrastrar · rueda', 'Encuadrar · ampliar la imagen en el marco'],
  ['Esquina', 'Escalar proporcional'], ['Shift + esquina', 'Escalar libre (deforma)'], ['Lado', 'Estirar en una dirección'],
  [ALT + ' + tirador', 'Escalar o recortar desde el centro'], ['Shift + girar', 'De 15° en 15°'],
  ['Shift + arrastrar', 'Mover solo en horizontal o vertical'], [ALT + ' + arrastrar', 'Arrastrar una copia'],
  [`${MOD}D · ${MOD}C · ${MOD}V`, 'Duplicar · copiar · pegar'], [`${MOD}] · ${MOD}[`, 'Adelante · atrás (con Shift: al frente / al fondo)'],
  [`${MOD}Z · ${MOD}Y`, 'Deshacer · rehacer'], [MOD + '0', 'Ver todo el póster'], ['Flechas', 'Mover 1 mm (Shift: 10 mm)'],
  ['C · E · W', 'Recortar · borrador · varita'], ['R · H', 'Girar 90° · espejo (Shift: al revés / vertical)'], [DELK, 'Quitar imagen'],
  ['Rueda del ratón', 'Acercar o alejar'], ['Trackpad: dos dedos', 'Mover la vista (pellizco: zoom)'], ['Espacio + arrastrar', 'Mover la vista'],
];

export function initPanel() {
  // pestañas
  for (const b of $$<HTMLButtonElement>('[role=tab]')) b.addEventListener('click', () => showTab(b.dataset.tab!));
  $('[role=tablist]').addEventListener('keydown', (e) => {
    const tabs = $$<HTMLButtonElement>('[role=tab]'), i = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (i < 0) return;
    const j = e.key === 'ArrowRight' ? (i + 1) % tabs.length : e.key === 'ArrowLeft' ? (i - 1 + tabs.length) % tabs.length
      : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : -1;
    if (j < 0) return;
    e.preventDefault(); e.stopPropagation();
    tabs[j]!.focus(); showTab(tabs[j]!.dataset.tab!);
  });

  // hojas
  const presets = $('#presets');
  for (const [c, r] of PRESETS) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'chip'; b.textContent = `${c}×${r}`;
    b.dataset.c = String(c); b.dataset.r = String(r);
    b.addEventListener('click', () => {
      if (S.cols === c && S.rows === r) return;
      snap(); S.cols = c; S.rows = r; layoutChanged();
    });
    presets.appendChild(b);
  }
  for (const b of $$('[data-step]')) b.addEventListener('click', () => {
    const k = b.dataset.step === 'rows' ? 'rows' : 'cols';
    editLayout(k, Math.min(Math.max(S[k] + Number(b.dataset.d), 1), MAX_COLS_ROWS));
  });
  for (const b of $$('[data-paper]')) b.addEventListener('click', () => editLayout('paper', b.dataset.paper as Paper));
  for (const b of $$('[data-orient]')) b.addEventListener('click', () => editLayout('orient', b.dataset.orient as Orient));
  $<HTMLInputElement>('#margin').addEventListener('input', (e) => editLayout('margin', +(e.target as HTMLInputElement).value, true));
  $<HTMLInputElement>('#overlap').addEventListener('input', (e) => editLayout('overlap', +(e.target as HTMLInputElement).value, true));

  // propiedades (escribir una medida = colocar a mano)
  numField('#pW', (l, v) => { const f = Math.max(3, v * 10) / visW(l); if (S.lock) scaleLayer(l, f, cropCenter(l)); else keepCenter(l, (x) => { x.w *= f; }); markManual(l); });
  numField('#pH', (l, v) => { const f = Math.max(3, v * 10) / visH(l); if (S.lock) scaleLayer(l, f, cropCenter(l)); else keepCenter(l, (x) => { x.h *= f; }); markManual(l); });
  numField('#pX', (l, v) => { l.cx += v * 10 - bboxMM(l).x0; markManual(l); });
  numField('#pY', (l, v) => { l.cy += v * 10 - bboxMM(l).y0; markManual(l); });
  numField('#pR', (l, v) => { rotateLayer(l, normDeg(v) - l.rot, cropCenter(l)); markManual(l); });
  $('#pLock').addEventListener('click', () => {
    S.lock = !S.lock;
    const b = $('#pLock');
    b.setAttribute('aria-pressed', String(S.lock));
    b.innerHTML = ICON[S.lock ? 'lock' : 'lockOpen']; // constante del código
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

  // atajos
  const keys = $('#keys');
  for (const [k, d] of SHORTCUTS) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = d;
    keys.append(dt, dd);
  }

  prevG = posterGeo();
  syncLayoutUI();
}
