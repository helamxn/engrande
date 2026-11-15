/**
 * Escribir un texto sobre el lienzo, como en Excalidraw: mientras se escribe, el texto deja de dibujarse y en su
 * lugar hay un cuadro de escritura con la misma fuente, tamaño, color y giro. Al salir (Esc, Ctrl+Enter o tocar
 * fuera) se convierte en contornos: es un solo paso de deshacer. Si queda vacío, el texto se quita.
 */
import { removeLayer, select, setMode, afterChange } from '../actions';
import { $, toast } from '../dom';
import { pushUndo, takeSnap } from '../history';
import { dirty } from '../render';
import { scheduleSave } from '../io/persist';
import { S, st, V } from '../state';
import { freeArea, mm2s, s2mm } from '../view';
import type { Pt, TextSpec } from '../types';
import { DEFAULT_FONT, ensureFont, getFont, type FontEntry } from './fonts';
import { askLocalFonts, localState, requestLocalFonts } from './local';
import { capHeight, lineAdvances } from './shape';
import { createText, fontSizePT, isText, originMM, relayout, specOf, TEXT_DEFAULTS, unitMM, type TextLayer } from './text';
import { DEFAULT_TEXT_PT, MAX_TEXT_LENGTH, MM_PER_PT } from './values';

type Style = Pick<TextSpec, 'align' | 'line' | 'track' | 'color' | 'fit' | 'width'>;
interface Session {
  ta: HTMLTextAreaElement;
  /** El texto que se edita; null = uno nuevo. */
  l: TextLayer | null;
  /** La fuente, si ya llegó (las incluidas se descargan la primera vez). */
  f: FontEntry | null;
  fontId: string;
  fontName: string;
  fontP: Promise<FontEntry | null>;
  style: Style;
  /** Punto de alineación (mm), alto de letra (mm) y giro. */
  origin: Pt; cap: number; rot: number; flipX: boolean; flipY: boolean;
  /** Ancho fijo pedido con un recuadro (mm): pasa a unidades de la fuente cuando la fuente llega (ver fixWidth). */
  widthMM?: number;
  /** Tamaño de un texto nuevo (pt): fija el alto de letra exacto cuando llega la fuente (ver fixSize). */
  pt?: number;
  done: boolean;
}
let session: Session | null = null;

function saveDraft(s: Session) {
  st.textDraft = {
    target: s.l ? st.layers.indexOf(s.l) : null, text: s.ta.value,
    font: s.fontId, fontName: s.fontName, style: { ...s.style }, origin: { ...s.origin },
    cap: s.cap, rot: s.rot, flipX: s.flipX, flipY: s.flipY,
  };
  scheduleSave(250);
}

/** «Nuevo» descarta también una edición pendiente, incluso si la fuente aún está descargándose. */
export function discardTextDraft() {
  const s = session;
  session = null; st.editingText = null; st.textDraft = null;
  if (s) { s.done = true; s.ta.remove(); }
}

/** Una fuente elegida para recuperar un borrador puede ser la original u otra de reemplazo. */
export function useDraftFont(f: FontEntry): boolean {
  const s = session;
  if (!s) return false;
  if (s.fontId !== f.id) {
    const m = metrics(s);
    s.cap *= (m.upm / m.cap) * (capHeight(f.font) / f.font.unitsPerEm);
  }
  s.f = f; s.fontP = Promise.resolve(f); s.fontId = f.id; s.fontName = f.name;
  positionTextEditor(); saveDraft(s);
  return true;
}

export async function refreshDraftFont() {
  const s = session;
  if (!s || !s.fontId.startsWith('l:')) return;
  const f = await ensureFont(s.fontId).catch(() => null);
  if (f && session === s) useDraftFont(f);
}

/** La fuente de un borrador se puede usar ya: incluida, del equipo con permiso, o un archivo aún cargado. */
const fontAvailable = (id: string) => !!getFont(id) || (id.startsWith('l:') ? localState() === 'ready' : !id.startsWith('u:'));

/**
 * Vuelve a abrir el texto que se estaba escribiendo al cerrar la pestaña. Solo con su fuente disponible: si no, queda
 * guardado y se ofrece al editar ese texto (o al llegar las fuentes del equipo; ver textpanel.ts).
 */
export function restoreTextDraft(onlyNew = false) {
  const d = st.textDraft;
  if (!d || session || !fontAvailable(d.font)) return;
  // más tarde (al llegar las fuentes del equipo con un clic) no se abre la edición de un texto que ya está en el póster:
  // ese clic era para otra cosa; sus palabras se retoman al editarlo
  if (onlyNew && d.target !== null) return;
  const l = d.target === null ? null : st.layers[d.target];
  const f = getFont(d.font), fontP = ensureFont(d.font).catch(() => null);
  st.sheetsOn = true;
  select(null);
  open({ l: isText(l) ? l : null, f, fontP, fontId: d.font, fontName: d.fontName,
    style: d.style, origin: d.origin, cap: d.cap, rot: d.rot, flipX: d.flipX, flipY: d.flipY }, d.text);
  toast('Se recuperó el texto que estabas escribiendo.', 6000);
}
/** Lo último que se usó en un texto nuevo: el siguiente sale igual. */
let last = { font: DEFAULT_FONT as string, style: { ...TEXT_DEFAULTS } as Style };

export const isEditingText = () => !!session;
/** Tamaño de letra de los textos nuevos: el último usado (al crear uno o al cambiarlo en el panel). */
let lastPT = DEFAULT_TEXT_PT;
export const rememberSize = (pt: number) => { if (pt > 0) lastPT = pt; };
/** La fuente elegida en el panel es la de los textos nuevos. */
export const rememberFont = (id: string) => { last = { ...last, font: id }; };

/** El tamaño en puntos de un texto nuevo, como alto de letra (mm) de su fuente: hace falta la fuente. */
function fixSize(s: Session) {
  if (!s.pt || !s.f) return;
  s.cap = (s.pt * MM_PER_PT * capHeight(s.f.font)) / s.f.font.unitsPerEm;
  s.pt = undefined;
}

/** El ancho del recuadro, en unidades de la fuente (hace falta la fuente para saber cuánto mide una unidad). */
function fixWidth(s: Session) {
  if (!s.widthMM || !s.f) return;
  s.style = { ...s.style, width: s.widthMM / (s.cap / capHeight(s.f.font)) };
  s.widthMM = undefined;
}

/** Métricas en unidades de la fuente; mientras llega la fuente, unas aproximadas. */
function metrics(s: Session) {
  const f = s.f?.font;
  return f
    ? { upm: f.unitsPerEm, asc: f.ascender, desc: f.descender, cap: capHeight(f), adv: (t: string) => lineAdvances(f, t, s.style.track, s.style.width) }
    : { upm: 1000, asc: 900, desc: -250, cap: 700, adv: (t: string) => t.split('\n').map((x) => x.length * 550) };
}

/** Coloca el cuadro sobre el texto: lo llama el dibujo de cada fotograma (zoom, mover la vista…). */
export function positionTextEditor() {
  const s = session;
  if (!s) return;
  fixSize(s); fixWidth(s);
  const m = metrics(s), px = (s.cap / m.cap) * m.upm * V.k; // tamaño de la fuente en px de pantalla
  // iOS amplía la página al escribir con letra de menos de 16 px: se escribe a 16 o más y se reduce con transform
  const base = Math.max(16, px), sc = px / base, u = base / m.upm;
  // con ancho fijo, el cuadro mide ese ancho y reparte las líneas como quedarán (ver wrapText)
  const fixed = s.style.width ?? null, advs = m.adv(s.ta.value), lines = advs, maxW = Math.max(fixed ?? 0, ...advs) * u;
  // el cuadro es la caja de los renglones, la misma del texto ya escrito: solo se suma sitio para el cursor y para el
  // espaciado que el navegador pone tras la última letra
  const extra = 2 + Math.max(0, s.style.track / 1000) * base;
  const lineH = s.style.line * base;
  const left = s.style.align === 'center' ? -(maxW + extra) / 2 : s.style.align === 'right' ? -(maxW + extra) : 0;
  // la línea base de la primera línea queda en el punto de alineación (el navegador centra la letra en su renglón)
  const top = -((lineH - (m.asc - m.desc) * u) / 2 + m.asc * u);
  const o = mm2s(s.origin), t = s.ta.style;
  t.fontFamily = s.f ? `"${s.f.css}", sans-serif` : 'sans-serif';
  t.fontSize = `${base}px`; t.lineHeight = `${lineH}px`; t.letterSpacing = `${s.style.track / 1000}em`;
  t.textAlign = s.style.align; t.color = s.style.color;
  t.width = `${maxW + extra}px`; t.height = `${lines.length * lineH}px`;
  t.whiteSpace = fixed ? 'pre-wrap' : 'pre'; s.ta.wrap = fixed ? 'soft' : 'off';
  t.left = `${o.x + left}px`; t.top = `${o.y + top}px`;
  t.transformOrigin = `${-left}px ${-top}px`;
  t.transform = `rotate(${s.rot}deg) scale(${(s.flipX ? -sc : sc)}, ${(s.flipY ? -sc : sc)})`;
}

function open(s: Omit<Session, 'ta' | 'done'>, text: string) {
  const ta = document.createElement('textarea');
  ta.className = 'text-editor';
  ta.value = text;
  ta.maxLength = Math.max(MAX_TEXT_LENGTH, text.length);
  ta.spellcheck = false;
  ta.setAttribute('autocomplete', 'off');
  ta.setAttribute('autocapitalize', 'off');
  ta.setAttribute('aria-label', 'Texto');
  ta.wrap = 'off';
  const sess: Session = { ...s, ta, done: false };
  session = sess;
  st.editingText = s.l;
  const stage = $('#stage');
  stage.append(ta);
  // al escribir, el navegador desplaza lo que haga falta para que se vea el cursor, también el lienzo (aunque no tenga
  // barras): la vista se movería sola. Se deshace al momento; para ver más, se mueve la vista como siempre.
  if (!stage.dataset.noScroll) {
    stage.dataset.noScroll = '1';
    stage.addEventListener('scroll', () => { if (stage.scrollTop || stage.scrollLeft) { stage.scrollTop = 0; stage.scrollLeft = 0; } });
  }
  positionTextEditor();
  ta.focus({ preventScroll: true });
  ta.setSelectionRange(text.length, text.length); // al editar, el cursor al final (no se reemplaza todo sin querer)
  ta.addEventListener('input', () => { positionTextEditor(); saveDraft(sess); });
  ta.addEventListener('paste', (e) => {
    const pasted = e.clipboardData?.getData('text/plain') ?? '';
    if (ta.value.length - (ta.selectionEnd - ta.selectionStart) + pasted.length > ta.maxLength)
      toast(`El texto admite hasta ${ta.maxLength.toLocaleString('es')} caracteres. Solo se pegará lo que quepa.`, 6000);
  });
  ta.addEventListener('keydown', (e) => {
    e.stopPropagation(); // el teclado es del cuadro: Supr, flechas, letras… no actúan sobre el lienzo
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) { e.preventDefault(); void commit(true); }
  });
  ta.addEventListener('blur', () => void commit(false));
  if (!s.f) {
    void s.fontP.then((f) => {
      if (session !== sess || sess.fontId !== s.fontId) return;
      if (!f) { missingFont(sess); return; }
      sess.f = f; positionTextEditor();
    });
  }
  dirty();
}

/** Termina de escribir. reselect: dejar el texto seleccionado (Esc, Ctrl+Enter); al tocar fuera manda lo tocado. */
async function commit(reselect: boolean) {
  const s = session;
  if (!s || s.done) return;
  s.done = true;
  const text = s.ta.value.replace(/\r/g, '');
  const nothingSelected = () => !st.sel && st.group.length < 2;
  // sin cambios en un texto que ya existe: se cierra sin más (no hace falta su fuente)
  const same = !!s.l && st.layers.includes(s.l) && text === specOf(s.l).text && s.fontId === specOf(s.l).font;
  // la fuente se espera un rato, nunca para siempre: las del equipo pueden no llegar (permiso, lectura parada)
  const f = s.f ?? (same || !text.trim() ? null : await Promise.race([s.fontP, new Promise<null>((r) => setTimeout(() => r(null), 5000))]));
  if (session !== s) return;
  if (text.trim() && !f && !same) {
    // sin la fuente no se puede convertir en contornos: el cuadro se cierra igual (el texto queda como estaba) y las
    // palabras se guardan en el borrador, para retomarlas al volver a editarlo con la fuente disponible
    saveDraft(s);
    close(s, true);
    if (s.l && st.layers.includes(s.l) && (reselect || nothingSelected())) select(s.l);
    missingFont(s);
    return;
  }
  try {
    if (s.l) {
      const l = s.l;
      if (st.layers.includes(l)) {
        if (!text.trim()) removeLayer(l);
        else {
          if (f && (text !== specOf(l).text || f.id !== specOf(l).font)) {
            const before = takeSnap();
            if (relayout(l, f, { text })) { pushUndo(before); afterChange(); }
            else removeLayer(l);
          }
          if (st.layers.includes(l) && (reselect || nothingSelected())) select(l);
        }
      }
    } else if (text.trim() && f) {
      if (!s.f) s.f = f;
      fixSize(s); fixWidth(s);
      last = { font: f.id, style: { ...s.style, width: null } }; // el siguiente texto, de ancho automático
      const l = createText(f, text, s.origin, s.cap, s.style, s.rot);
      if (l) lastPT = fontSizePT(l);
      if (l && !reselect && !nothingSelected()) select(null);
    }
  } catch (error) {
    console.warn('No se pudo componer el texto', error);
    saveDraft(s); close(s, true);
    toast('Esta fuente no pudo componer el texto. Tus palabras siguen en el borrador; puedes cargar otra fuente.', 8000,
      { label: 'Cargar fuente', fn: () => document.querySelector<HTMLInputElement>('#fontFile')?.click() });
    return;
  }
  close(s, false);
}

/** Cierra el cuadro de escritura; keepDraft: las palabras siguen guardadas en el borrador. */
function close(s: Session, keepDraft: boolean) {
  session = null; st.editingText = null;
  if (!keepDraft) st.textDraft = null;
  s.ta.remove(); scheduleSave(); dirty();
}

function missingFont(s: Session) {
  const local = s.fontId.startsWith('l:');
  toast(`Falta la fuente «${s.fontName}»${local ? ' (de tu equipo)' : ''}. Tus palabras quedan guardadas: vuelve a editar el texto cuando esté disponible.`, 8000,
    { label: local ? 'Permitir fuentes' : 'Cargar fuente', fn: () => { if (local) void requestLocalFonts(); else document.querySelector<HTMLElement>('#fontFile')?.click(); } });
}

/** Fuente de un texto nuevo: la última usada, si se puede (un archivo del usuario puede ya no estar cargado). */
const newFontId = () => (getFont(last.font) || !last.font.startsWith('u:') ? last.font : DEFAULT_FONT);

/**
 * «Agregar texto» (T, la barra, la bienvenida): no crea nada todavía. El cursor pasa a ser el de texto y el usuario
 * elige dónde: un clic pone el texto ahí (ancho automático) y un recuadro le da además un ancho fijo (ver pointer.ts).
 * Volver a pulsarlo o Esc lo cancela.
 */
export function startTextPlacement() {
  if (session) return;
  if (st.placingText) { cancelTextPlacement(); return; }
  askLocalFonts(); // con este gesto: la primera vez el navegador pide permiso para las fuentes del equipo
  if (S.mode !== 'move') setMode('move');
  st.sheetsOn = true; // se ve el papel (y se quita la bienvenida) para elegir dónde
  st.placingText = true;
  select(null);
  $('#cv').style.cursor = 'text';
  void ensureFont(newFontId()).catch(() => null); // que la fuente vaya llegando mientras se elige el sitio
  afterPlacingChange();
}
export function cancelTextPlacement() {
  if (!st.placingText) return;
  st.placingText = false;
  $('#cv').style.cursor = 'default';
  afterPlacingChange();
}
/** La barra (botón marcado) y la pista cambian con el modo; los registra main.ts para evitar dependencias circulares. */
let afterPlacingChange = () => {};
export const onPlacingChange = (fn: () => void) => { afterPlacingChange = fn; };

/**
 * Un texto nuevo con la esquina de arriba a la izquierda de su primera línea en P (mm), listo para escribir.
 * widthMM: ancho fijo (de un recuadro); sin él, ancho automático. Sin P, en el centro de la vista.
 */
export function addText(P?: Pt, widthMM?: number) {
  if (session) return;
  if (st.placingText) { st.placingText = false; $('#cv').style.cursor = 'default'; }
  askLocalFonts();
  if (S.mode !== 'move') setMode('move');
  st.sheetsOn = true;
  select(null);
  afterPlacingChange();
  const id = newFontId(), f = getFont(id), fontP = f ? Promise.resolve(f) : ensureFont(id).catch(() => null);
  const a = freeArea(), at = P ?? s2mm({ x: a.x + a.w / 2, y: a.y + a.h / 2 });
  const style: Style = { ...last.style, width: null };
  // tamaño fijo en puntos (el último usado), igual en cualquier póster; de la esquina del renglón a la línea base
  // (con la fuente, si ya está; si no, unas medidas habituales, y el tamaño exacto al llegar: ver fixSize)
  const m = f ? { upm: f.font.unitsPerEm, asc: f.font.ascender, desc: f.font.descender, cap: capHeight(f.font) } : { upm: 1000, asc: 900, desc: -250, cap: 700 };
  const mm = (lastPT * MM_PER_PT) / m.upm, cap = m.cap * mm;
  const lh = style.line * m.upm, base = ((lh - (m.asc - m.desc)) / 2 + m.asc) * mm;
  // el punto de alineación: el borde izquierdo, el centro o el derecho del ancho (con ancho automático, en P)
  const w = widthMM ?? 0, ox = style.align === 'center' ? w / 2 : style.align === 'right' ? w : 0;
  open({ l: null, f, fontP, fontId: id, fontName: f?.name ?? id, style, origin: { x: at.x + ox, y: at.y + base }, cap, rot: 0, flipX: false, flipY: false, widthMM, pt: f ? undefined : lastPT }, '');
}

/** Editar las palabras de un texto (doble clic, Enter o «Editar texto»). */
export function editText(l: TextLayer) {
  if (session || !isText(l)) return;
  if (l.locked) { toast('El texto está bloqueado. Desbloquéalo en la barra o en la pestaña Capas.'); return; }
  const s = specOf(l), f = getFont(s.font);
  if (!f && s.font.startsWith('u:')) {
    toast(`Para cambiar las palabras, vuelve a cargar la fuente «${s.fontName}» (o elige otra en el panel).`, 7000,
      { label: 'Cargar fuente', fn: () => document.querySelector<HTMLInputElement>('#fontFile')?.click() });
    return;
  }
  if (S.mode !== 'move') setMode('move');
  // si quedaron palabras sin aplicar de este texto (faltaba la fuente), se retoman
  const d = st.textDraft, draft = d && d.target === st.layers.indexOf(l) ? d.text : null;
  select(null);
  const fontP = f ? Promise.resolve(f) : ensureFont(s.font).catch(() => null);
  open({
    l, f, fontP, fontId: s.font, fontName: s.fontName, style: { align: s.align, line: s.line, track: s.track, color: s.color, fit: s.fit, width: s.width ?? null },
    origin: originMM(l), cap: unitMM(l) * s.shape.cap, rot: l.rot, flipX: l.flipX, flipY: l.flipY,
  }, draft ?? s.text);
}
