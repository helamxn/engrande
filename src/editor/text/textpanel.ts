/**
 * Sección «Texto» del panel (con un texto seleccionado): fuente, alto de letra, color, alineación, interlineado y
 * espaciado. También los botones «Agregar texto» y la carga de fuentes del usuario (selector o soltarlas).
 */
import { afterChange } from '../actions';
import { $, $$, toast } from '../dom';
import { fmt1, parseNum } from '../format';
import { pushUndo, snap, takeSnap } from '../history';
import { st } from '../state';
import type { Snapshot, TextAlign } from '../types';
import { startTextPlacement, rememberFont, rememberSize, refreshDraftFont, restoreTextDraft, useDraftFont } from './editor';
import { ensureFont, FontError, fontChoices, getFont, loadFontFile, type FontChoice } from './fonts';
import { capMM, fontFor, fontSizePT, isText, relayout, setCapMM, setFontSizePT, setFit, setWidthMode, specOf, type TextLayer } from './text';
import { initTextColor, syncTextColor } from './color';
import { askLocalFonts, initLocalFonts, localState } from './local';

const fmt2 = (v: number) => (Math.round(v * 100) / 100).toString().replace('.', ',');
let request = 0;
let busy = false;
function option(value: string, name: string) {
  const op = document.createElement('option'); op.value = value; op.textContent = name; return op;
}

function syncFonts() {
  const l = st.sel;
  if (!isText(l)) return;
  const s = specOf(l), opts = fontChoices();
  if (!opts.some(o => o.id === s.font)) opts.push({ id: s.font, name: `${s.fontName} (sin cargar)`, family: s.fontName, style: 'Original', weight: 400, italic: false, builtin: false, provider: s.font.startsWith('l:') ? 'local' : 'file' });
  const current = opts.find(o => o.id === s.font)!;
  const familyKey = (o: FontChoice) => `${o.provider}:${o.family}`;
  const currentKey = familyKey(current);
  const families = new Map<string, FontChoice[]>();
  for (const o of opts) {
    const key = familyKey(o), variants = families.get(key) ?? []; variants.push(o); families.set(key, variants);
  }
  const sel = $<HTMLSelectElement>('#tFont');
  if (document.activeElement !== sel || !busy) {
    const sources = { google: 'Incluidas', local: 'De tu equipo', file: 'Archivos cargados' };
    const groups = Object.entries(sources).map(([provider, label]) => {
      const group = document.createElement('optgroup'); group.label = label;
      const matches = [...families.entries()].filter(([, variants]) => variants[0]!.provider === provider);
      group.append(...matches.map(([key, variants]) => {
        const v = variants.find(o => o.id === current.id) ?? variants.find(o => o.weight === current.weight && o.italic === current.italic) ?? variants[0]!;
        return option(v.id, key === currentKey ? current.name : v.family);
      }));
      return group;
    }).filter(group => group.children.length);
    sel.replaceChildren(...groups, option('__load', 'Cargar archivo de fuente…'));
    sel.value = s.font;
  }
  const style = $<HTMLSelectElement>('#tFontStyle');
  style.replaceChildren(...families.get(currentKey)!.map(o => option(o.id, o.style)));
  style.value = s.font; style.disabled = style.options.length < 2;
  if (!busy) $('#tFontStatus').textContent = '';
}

/** Solo se avisa cuando las fuentes del equipo no están y hay algo que explicar; si están, salen en la lista. */
function syncLocalAccess() {
  const state = localState();
  $('#tLocalStatus').textContent = state === 'unsupported' ? 'Para usar una fuente de tu equipo en este navegador, elige «Cargar archivo de fuente…» en la lista.'
    : state === 'denied' ? 'Las fuentes de tu equipo no tienen permiso. Puedes darlo en los permisos del sitio o cargar un archivo de fuente.'
    : state === 'error' ? 'No se pudieron leer las fuentes de tu equipo. Puedes cargar un archivo de fuente.'
    : state === 'loading' ? 'Buscando las fuentes de tu equipo…'
    : '';
}
function setVal(id: string, v: string) {
  const el = $<HTMLInputElement | HTMLSelectElement>(id);
  if (document.activeElement !== el) el.value = v;
}

/** Rellena la sección con el texto seleccionado (lo llama syncSel del panel). */
export function syncTextPanel() {
  const l = st.sel;
  document.body.classList.toggle('sel-text', isText(l));
  if (!isText(l)) return;
  const s = specOf(l);
  syncFonts();
  setVal('#tSize', fmt1(fontSizePT(l)));
  setVal('#tCap', fmt1(capMM(l) / 10));
  $<HTMLInputElement>('#tFit').checked = s.fit;
  syncTextColor();
  for (const b of $$<HTMLButtonElement>('#tAlign [data-align]')) b.setAttribute('aria-pressed', String(b.dataset.align === s.align));
  for (const b of $$<HTMLButtonElement>('#tWidth [data-w]')) b.setAttribute('aria-pressed', String((b.dataset.w === 'fixed') === !!s.width));
  setVal('#tLine', String(s.line)); $('#tLineOut').textContent = fmt2(s.line);
  setVal('#tTrack', String(s.track)); $('#tTrackOut').textContent = String(Math.round(s.track));
}

/** Un arrastre seguido de un deslizador (o del color) es un solo paso de deshacer. */
let gesture: { l: TextLayer; key: string; t: number } | null = null;
function stepOnce(l: TextLayer, key: string) {
  const now = performance.now();
  if (!(gesture && gesture.l === l && gesture.key === key && now - gesture.t < 1200)) snap();
  gesture = { l, key, t: now };
}

/** Rehace el texto con la fuente y el cambio dados; un paso de deshacer (o el del arrastre, si step lo dio). */
async function restyle(change: Parameters<typeof relayout>[2], what: string, opts: { font?: string; anchor?: 'origin' | 'center'; key?: string } = {}) {
  const l = st.sel;
  if (!isText(l) || l.locked) return;
  const token = ++request;
  busy = true;
  $('#tFontStatus').textContent = 'Cargando fuente…';
  const f = opts.font ? await ensureFont(opts.font).catch(() => null) ?? getFont(opts.font) : await fontFor(l, what);
  // La última petición gana, aunque una descarga anterior termine después.
  if (token !== request) return;
  busy = false;
  if (!f || st.sel !== l || !st.layers.includes(l) || l.locked) {
    syncTextPanel();
    if (!f) $('#tFontStatus').textContent = 'No se pudo cargar la fuente. Vuelve a elegirla para reintentar.';
    return;
  }
  let before: Snapshot | null = null;
  if (opts.key) stepOnce(l, opts.key); else before = takeSnap();
  try {
    if (relayout(l, f, change, opts.anchor) && before) pushUndo(before);
    afterChange();
  } catch (error) {
    console.warn('No se pudo componer el texto', error);
    syncTextPanel();
    $('#tFontStatus').textContent = 'Esta fuente no pudo componer el texto. Prueba con otra.';
  }
}

/** Usa una fuente del usuario: queda en la lista y, si hay un texto seleccionado, se le aplica. */
async function useFontFile(file: File) {
  try {
    const f = await loadFontFile(file);
    rememberFont(f.id);
    const draft = useDraftFont(f);
    if (!draft && isText(st.sel)) await restyle({}, '', { font: f.id });
    toast(`Fuente «${f.name}» lista${draft ? '. Puedes terminar de escribir' : isText(st.sel) ? '' : '. Agrega un texto para usarla'}.`);
    syncTextPanel();
  } catch (err) {
    console.warn(err);
    toast(err instanceof FontError ? err.message : `No pude leer «${file.name}» como fuente.`, 6000);
  }
}
/** Fuentes soltadas o elegidas junto con imágenes (ver load.ts). */
export async function loadFonts(files: File[]) { for (const f of files) await useFontFile(f); }

export function initTextPanel() {
  initTextColor();
  initLocalFonts(() => {
    syncLocalAccess(); syncTextPanel();
    if (localState() === 'ready') { void refreshDraftFont(); restoreTextDraft(true); }
  });
  document.addEventListener('click', (e) => {
    if ((e.target as Element).closest?.('[data-addtext]')) startTextPlacement();
  });

  const file = $<HTMLInputElement>('#fontFile');
  file.addEventListener('change', () => { const f = file.files?.[0]; file.value = ''; if (f) void useFontFile(f); });

  const sel = $<HTMLSelectElement>('#tFont');
  sel.addEventListener('change', () => {
    const id = sel.value;
    if (id === '__load') { syncTextPanel(); file.click(); return; }
    if (!getFont(id) && id.startsWith('u:')) { syncTextPanel(); file.click(); return; }
    rememberFont(id);
    void restyle({}, '', { font: id });
  });
  // abrir la lista también es un gesto: si las fuentes del equipo aún no se pidieron, se piden ahora
  sel.addEventListener('pointerdown', askLocalFonts);
  sel.addEventListener('keydown', askLocalFonts);
  $<HTMLSelectElement>('#tFontStyle').addEventListener('change', e => {
    const id = (e.target as HTMLSelectElement).value;
    rememberFont(id); void restyle({}, '', { font: id });
  });

  const size = $<HTMLInputElement>('#tSize');
  const applySize = () => {
    const l = st.sel, value = parseNum(size.value);
    if (!isText(l) || l.locked || !Number.isFinite(value) || value < 1) { syncTextPanel(); return; }
    if (Math.abs(value - fontSizePT(l)) < 0.005) return;
    snap(); setFontSizePT(l, value); rememberSize(fontSizePT(l)); afterChange();
  };
  size.addEventListener('change', applySize);
  size.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); applySize(); size.select(); return; }
    if (!['ArrowUp', 'ArrowDown'].includes(e.key)) return;
    const value = parseNum(size.value);
    if (!Number.isFinite(value)) return;
    e.preventDefault(); size.value = fmt1(Math.max(1, value + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1))); applySize();
  });

  const cap = $<HTMLInputElement>('#tCap');
  const applyCap = () => {
    const l = st.sel, v = parseNum(cap.value);
    if (!isText(l) || l.locked || !Number.isFinite(v) || v <= 0) { syncTextPanel(); return; }
    if (Math.abs(v * 10 - capMM(l)) < 0.05) return;
    snap(); setCapMM(l, v * 10); rememberSize(fontSizePT(l)); afterChange();
  };
  cap.addEventListener('change', applyCap);
  cap.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); applyCap(); cap.select(); return; }
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    const v = parseNum(cap.value);
    if (!Number.isFinite(v)) return;
    e.preventDefault();
    cap.value = fmt1(Math.max(0.1, v + (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 1 : 0.1)));
    applyCap();
  });

  const fit = $<HTMLInputElement>('#tFit');
  fit.addEventListener('change', () => {
    const l = st.sel;
    if (!isText(l) || l.locked) { syncTextPanel(); return; }
    snap(); setFit(l, fit.checked); afterChange();
  });

  for (const b of $$<HTMLButtonElement>('#tAlign [data-align]')) {
    b.addEventListener('click', () => {
      const l = st.sel, a = b.dataset.align as TextAlign;
      if (!isText(l) || specOf(l).align === a) return;
      void restyle({ align: a }, 'cambiar la alineación', { anchor: 'center' });
    });
  }
  for (const b of $$<HTMLButtonElement>('#tWidth [data-w]')) {
    b.addEventListener('click', () => { const l = st.sel; if (isText(l) && !l.locked) void setWidthMode(l, b.dataset.w === 'fixed'); });
  }
  const line = $<HTMLInputElement>('#tLine'), track = $<HTMLInputElement>('#tTrack');
  line.addEventListener('input', () => {
    $('#tLineOut').textContent = fmt2(+line.value);
    void restyle({ line: +line.value }, 'cambiar el interlineado', { key: 'line' });
  });
  track.addEventListener('input', () => {
    $('#tTrackOut').textContent = track.value;
    void restyle({ track: +track.value }, 'cambiar el espaciado', { key: 'track' });
  });
}
