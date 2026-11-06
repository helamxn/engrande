/** Acciones del editor: selección, capas, modos de herramienta, recorte y edición de píxeles. */
import { MAX_SIDE } from './constants';
import { $, hideToast, toast } from './dom';
import {
  alignShifts, applyFit, bboxMM, conformCrop, cropCenter, distributeShifts, flipOnScreen, keepCenter, mmToLocal,
  natRatio, rotateLayer, unstretch, visH, visW, type AlignEdge,
} from './geometry';
import {
  childOf, clonePath, commonPath, findGroup, freshGroups, GROUP_BASE, groupOf, inGroup, membersOf, nextGid,
  nextGroupName, normalizeGroups, pathExists, scopeOf, splitPaths, unitAt,
} from './groups';
import { pushUndo, snap, takeSnap, restoreSnap, undo } from './history';
import { canvasRevision, markCanvasChanged, scheduleSave } from './io/persist';
import { runJob } from './pixeljobs';
import type { PixelJob, PixelResult } from './pixels';
import { dirty } from './render';
import { DEFAULT_EXPORT, freshLayout, posterGeo, S, st, V } from './state';
import { s2mm } from './view';
import { MOD, SHIFT } from './platform';
import { renderBar } from './ui/contextbar';
import { layoutChanged, layoutRestored, renderList, syncExportUI, syncSel } from './ui/panel';
import type { FitMode, Layer, LayerProps, Mode, Pt, Snapshot, Source } from './types';

/* ---------- lienzos ---------- */
export function cloneCanvas(src: HTMLCanvasElement) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d', { willReadFrequently: true })!.drawImage(src, 0, 0);
  return c;
}
/** Lienzo de trabajo (máx. MAX_SIDE). upscale: para SVG, que se puede rasterizar más grande que su tamaño nominal. */
export function makeCanvas(src: CanvasImageSource, sw: number, sh: number, upscale = false) {
  const sc = upscale ? MAX_SIDE / Math.max(sw, sh) : Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(sw * sc)); c.height = Math.max(1, Math.round(sh * sc));
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/* ---------- capas ---------- */
export function newLayer(img: HTMLCanvasElement, name: string, extra: Partial<Layer> = {}): Layer {
  const g = posterGeo();
  return {
    id: st.nextId++, name, img, orig: img, cx: g.W / 2, cy: g.H / 2, w: g.W, h: (g.W * img.height) / img.width,
    rot: 0, flipX: false, flipY: false, crop: { x0: 0, y0: 0, x1: 1, y1: 1 },
    pdf: null, page: 1, pages: 1, src: null as Source | null, fit: null, hidden: false, locked: false, opacity: 1, gpath: [], ...extra,
  };
}
/** Coloca una imagen nueva ajustada al póster. Si va desplazada (varias a la vez), queda como colocada a mano. */
export function addLayer(l: Layer, { factor = 1, offset = 0 } = {}) {
  st.layers.push(l);
  st.sheetsOn = true;
  const fit = { mode: 'contain' as const, scale: factor };
  applyFit(l, fit, posterGeo());
  if (offset) { l.cx += offset; l.cy += offset; l.fit = null; } else l.fit = fit;
  select(l);
}
export const cloneLayer = (l: Layer, extra: Partial<Layer> = {}): Layer =>
  ({ ...l, id: st.nextId++, crop: { ...l.crop }, fit: l.fit && { ...l.fit }, gpath: clonePath(l.gpath), ...extra });
/** La imagen se movió o cambió de tamaño a mano: ya no se reajusta al cambiar la hoja. */
export const markManual = (l: Layer) => { l.fit = null; };

/**
 * Oculta o muestra una imagen: oculta no se dibuja, no se exporta y no se puede tocar en el lienzo.
 * Al ocultar la seleccionada se deselecciona, porque en el lienzo ya no habría nada que tocar.
 */
export function toggleHidden(l: Layer) {
  if (S.mode === 'crop') applyCrop();
  if (S.mode !== 'move') setMode('move');
  snap();
  l.hidden = !l.hidden;
  if (l.hidden && st.sel === l) select(null);
  else if (l.hidden && st.group.includes(l)) selectMany(st.group.filter((x) => x !== l));
  afterChange();
  toast(l.hidden ? `«${l.name}» oculta: no se imprimirá` : `«${l.name}» visible de nuevo`);
}

const LOCKED_MSG = 'La imagen está bloqueada. Desbloquéala con el candado de la lista.';

/** Bloquea o desbloquea: bloqueada se ve y se imprime, pero en el lienzo no se puede tocar. */
export function toggleLocked(l: Layer) {
  if (st.sel === l && S.mode === 'crop') applyCrop();
  if (st.sel === l && S.mode !== 'move') setMode('move');
  snap();
  l.locked = !l.locked;
  if (l.locked && st.group.includes(l)) selectMany(st.group.filter((x) => x !== l));
  afterChange(); renderBar();
  toast(l.locked ? `«${l.name}» bloqueada: no se puede mover ni editar en el lienzo` : `«${l.name}» desbloqueada`);
}
/** Cambia el nombre (paso de deshacer). Devuelve false si no hay nada que cambiar. */
export function renameLayer(l: Layer, name: string) {
  const n = name.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!n || n === l.name) return false;
  snap(); l.name = n; afterChange();
  return true;
}
/** Opacidad desde el deslizador (una imagen o todas las seleccionadas): un arrastre seguido es un solo paso de deshacer. */
let opacityEdit: { key: Layer | null; t: number } = { key: null, t: 0 };
export function setOpacity(l: Layer | Layer[], v: number) {
  const ls = Array.isArray(l) ? l : [l];
  if (!ls.length) return;
  if (ls.some((x) => x.locked)) { toast(LOCKED_MSG); return; }
  const now = performance.now();
  if (!(opacityEdit.key === ls[0] && now - opacityEdit.t < 1000)) snap();
  opacityEdit = { key: ls[0]!, t: now };
  for (const x of ls) x.opacity = Math.min(1, Math.max(0.05, v));
  dirty(); scheduleSave();
}
/** Oculta todas las seleccionadas (un paso de deshacer). */
export function hideSelected() {
  const ls = selected();
  if (!ls.length) return;
  snap();
  for (const l of ls) l.hidden = true;
  select(null); scheduleSave();
  toast(ls.length > 1 ? `${ls.length} imágenes ocultas: no se imprimirán` : `«${ls[0]!.name}» oculta: no se imprimirá`, 6000, { label: 'Deshacer', fn: undo });
}
/** Bloquea todas las seleccionadas (un paso de deshacer). Bloqueadas ya no se pueden seleccionar en el lienzo. */
export function lockSelected() {
  const ls = selected();
  if (!ls.length) return;
  snap();
  for (const l of ls) l.locked = true;
  select(null); scheduleSave();
  toast(ls.length > 1 ? `${ls.length} imágenes bloqueadas` : `«${ls[0]!.name}» bloqueada`, 6000, { label: 'Deshacer', fn: undo });
}

export function select(l: Layer | null) {
  if (S.mode === 'crop' && l !== st.sel) applyCrop();
  st.sel = l;
  st.group = [];
  st.hoverL = null;
  if (!l && S.mode !== 'move') setMode('move');
  renderList(); syncSel(); renderBar(); dirty();
}
export function afterChange() { renderList(); syncSel(); dirty(); scheduleSave(); }

/* ---------- selección de varias imágenes ---------- */
/** Lo seleccionado: la imagen sola, las del grupo o nada. */
export const selected = (): Layer[] => (st.sel ? [st.sel] : st.group);
export const isSelected = (l: Layer) => st.sel === l || st.group.includes(l);

/**
 * Selecciona varias imágenes a la vez. Con una sola equivale a select(); con dos o más forma un grupo
 * (st.sel queda en null). Las ocultas no se pueden seleccionar desde el lienzo y se descartan; se guardan
 * en el orden del póster (de atrás adelante).
 */
export function selectMany(ls: Layer[]) {
  const set = new Set(ls);
  const g = st.layers.filter((l) => set.has(l) && !l.hidden && !l.locked);
  if (g.length < 2) { select(g[0] ?? null); return; }
  if (S.mode === 'crop') applyCrop();
  if (S.mode !== 'move') setMode('move');
  st.sel = null;
  st.group = g;
  st.hoverL = null;
  renderList(); syncSel(); renderBar(); dirty();
}
/** Shift o Ctrl + clic: añade a la selección o quita el elemento de la imagen en el nivel actual (su grupo o ella). */
export function toggleInSelection(l: Layer) {
  const unit = unitOf(l), cur = selected();
  selectMany(unit.every((x) => cur.includes(x)) ? cur.filter((x) => !unit.includes(x)) : [...cur, ...unit]);
}

/* ---------- grupos (Ctrl+G), también unos dentro de otros: ver groups.ts ---------- */
/** En el lienzo no se seleccionan las ocultas ni las bloqueadas. */
const pickable = (l: Layer) => !l.hidden && !l.locked;
/** Nivel en el que se está: el grupo abierto con doble clic (null = el póster). */
export const currentScope = () => scopeOf(st.layers, selected(), pickable);
/** Nivel desde el que se ve l: el actual si l está dentro; si no, el póster (como en Figma). */
const scopeFor = (l: Layer) => { const s = currentScope(); return s != null && inGroup(l, s) ? s : null; };
/** Elemento de l en el nivel actual: su grupo (o subgrupo) entero, o solo l. */
export const unitOf = (l: Layer): Layer[] => unitAt(st.layers, l, scopeFor(l));
/** Imágenes de un grupo (a cualquier profundidad). */
export const groupMembers = (gid: number) => membersOf(st.layers, gid);
/** Número de grupo si la selección es exactamente un grupo entero; si no, null. */
export const selectedGroup = (): number | null => groupOf(st.layers, st.group, pickable);
/** Clic en una imagen: su elemento en el nivel actual (fuera del grupo abierto, el de más arriba), como en Figma. */
export function selectUnit(l: Layer) {
  const u = unitOf(l);
  if (u.length > 1) selectMany(u); else select(l);
}
/** Doble clic en el grupo seleccionado: un nivel más adentro, hacia la imagen tocada (su subgrupo o ella sola). */
export function enterGroup(l: Layer) {
  const g = selectedGroup();
  if (g == null || !inGroup(l, g)) { selectUnit(l); return; }
  const u = unitAt(st.layers, l, g);
  if (u.length > 1) selectMany(u); else select(l);
}
/** Esc: un nivel más afuera (se selecciona el grupo que contiene la selección); en el póster, deselecciona. */
export function exitGroup() {
  const s = currentScope();
  if (s == null) select(null); else selectMany(groupMembers(s));
}
/** Nombre visible de un grupo. */
export const groupName = (gid: number) => findGroup(st.layers, gid)?.name || GROUP_BASE;
/** Cambia el nombre del grupo (paso de deshacer). Vacío no vale. Devuelve false si no hay nada que cambiar. */
export function renameGroup(gid: number, name: string) {
  const ls = groupMembers(gid), n = name.replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!ls.length || !n || groupName(gid) === n) return false;
  snap();
  for (const l of ls) for (const g of l.gpath) if (g.id === gid) g.name = n;
  afterChange(); renderBar();
  return true;
}
/** Ordena las capas para que cada grupo quede junto (en cada nivel) y deshace los de un solo elemento. */
export function tidyGroups() { st.layers = normalizeGroups(st.layers); }

/**
 * Agrupa lo seleccionado (2 o más elementos del nivel actual: imágenes o grupos) en un grupo nuevo, «Grupo N»,
 * dentro del grupo en el que se está. Cada elemento entra entero (también sus imágenes ocultas o bloqueadas).
 */
export function groupSelected() {
  const ls = selected(), scope = currentScope();
  const units = new Set(ls.map((l) => childOf(l, scope) ?? l));
  if (units.size < 2) { if (selectedGroup() == null) toast('Selecciona al menos 2 imágenes para agruparlas'); return; }
  const members = st.layers.filter((l) => ls.some((x) => unitAt(st.layers, x, scope).includes(l)));
  const depth = scope == null ? 0 : members[0]!.gpath.findIndex((g) => g.id === scope) + 1;
  snap();
  const id = nextGid(st.layers), name = nextGroupName(st.layers);
  for (const l of members) l.gpath = [...l.gpath.slice(0, depth), { id, name }, ...l.gpath.slice(depth)];
  tidyGroups();
  selectMany(members);
  scheduleSave();
  toast(`${name} · ${MOD}${SHIFT}G para desagrupar`, 4000);
}
/** Desagrupa los grupos seleccionados, un solo nivel: lo que tenían dentro (también subgrupos) queda suelto. */
export function ungroupSelected() {
  const scope = currentScope();
  const gids = new Set(selected().map((l) => childOf(l, scope)).filter((g): g is number => g != null));
  if (!gids.size) return;
  snap();
  const freed = st.layers.filter((l) => l.gpath.some((g) => gids.has(g.id)));
  for (const l of freed) l.gpath = l.gpath.filter((g) => !gids.has(g.id));
  tidyGroups();
  selectMany(freed);
  scheduleSave();
  toast(gids.size > 1 ? `${gids.size} grupos deshechos` : 'Grupo deshecho', 6000, { label: 'Deshacer', fn: undo });
}
/** Saca una imagen de su grupo: pasa al de fuera (o queda suelta) y se queda donde está en el orden de capas. */
export function leaveGroup(l: Layer) {
  if (!l.gpath.length) return;
  snap();
  l.gpath = l.gpath.slice(0, -1);
  tidyGroups();
  afterChange();
}
/** Ver u ocultar, bloquear o desbloquear todas las imágenes de un grupo (desde la fila del grupo en la lista). */
export function toggleGroupFlag(gid: number, flag: 'hidden' | 'locked') {
  const ls = groupMembers(gid);
  if (!ls.length) return;
  snap();
  const on = !ls.every((l) => l[flag]);
  for (const l of ls) l[flag] = on;
  if (on) select(null); // ocultas o bloqueadas no se pueden tener seleccionadas en el lienzo
  afterChange();
  toast(flag === 'hidden' ? (on ? 'Grupo oculto: no se imprimirá' : 'Grupo visible de nuevo') : (on ? 'Grupo bloqueado' : 'Grupo desbloqueado'));
}
export const selectAll = () => selectMany(st.layers);

/** Desplaza todas las seleccionadas (ya con su paso de deshacer tomado). */
export function shiftSelected(dx: number, dy: number) {
  for (const l of selected()) {
    if (l.locked) continue;
    l.cx += dx; l.cy += dy; markManual(l);
  }
}

export function removeSelected() {
  const ls = selected();
  if (ls.length < 2) { if (ls[0]) removeLayer(ls[0]); return; }
  snap();
  st.layers = st.layers.filter((x) => !ls.includes(x));
  tidyGroups();
  select(null);
  scheduleSave();
  toast(`${ls.length} imágenes quitadas del póster`, 6000, { label: 'Deshacer', fn: undo });
}
/**
 * Grupos de las copias de ls: los copiados enteros pasan a ser grupos nuevos (con el mismo nombre); las copias se
 * quedan dentro de los grupos de alrededor, como en Figma (duplicar algo de dentro de un grupo lo deja en él).
 */
function copyGroups(ls: Layer[], copies: Layer[]) {
  // sin las copias: aún llevan los grupos del original y harían creer que ningún grupo se copió entero
  const others = st.layers.filter((x) => !copies.includes(x));
  const sp = splitPaths(ls, others), fresh = freshGroups(sp.map((s) => s.whole), st.layers);
  copies.forEach((c, i) => { c.gpath = [...clonePath(sp[i]!.keep), ...fresh[i]!]; });
}
/** Al portapapeles de Pliego: los grupos copiados enteros van con las copias; el de alrededor, aparte (clipScope). */
function toClip(ls: Layer[]) {
  const sp = splitPaths(ls, st.layers);
  st.clip = ls.map((l, i) => { const c = cloneLayer(l); c.gpath = clonePath(sp[i]!.whole); return c; });
  st.clipScope = clonePath(commonPath(sp.map((s) => ({ gpath: s.keep }))));
  // Se pisa también el portapapeles del sistema (con los nombres, como texto): si guardaba una imagen copiada antes
  // en otra app, Ctrl+V la preferiría a lo que se acaba de copiar aquí. Sin permiso, se queda como estaba.
  void navigator.clipboard?.writeText?.(ls.map((l) => l.name).join('\n')).catch(() => {});
}
export function duplicateSelected() {
  const ls = selected();
  if (ls.length < 2) { if (ls[0]) duplicateLayer(ls[0]); return; }
  snap();
  const copies = ls.map((l) => {
    const d = cloneLayer(l, { name: l.name + ' (copia)', fit: null });
    d.cx += 10; d.cy += 10;
    st.layers.splice(st.layers.indexOf(l) + 1, 0, d);
    return d;
  });
  copyGroups(ls, copies);
  tidyGroups();
  selectMany(copies);
  scheduleSave();
}
/** Duplica en el mismo sitio (Alt + arrastrar) y devuelve las copias, ya seleccionadas. */
export function cloneSelectedInPlace(): Layer[] {
  const ls = selected();
  const copies = ls.map((l) => {
    const d = cloneLayer(l, { name: l.name + ' (copia)', fit: null });
    st.layers.splice(st.layers.indexOf(l) + 1, 0, d);
    return d;
  });
  copyGroups(ls, copies);
  tidyGroups();
  selectMany(copies);
  return copies;
}
export function copySelected() {
  const ls = selected();
  if (!ls.length) return;
  toClip(ls);
  st.clipN = 0;
  toast(ls.length > 1 ? `${ls.length} imágenes copiadas` : `«${ls[0]!.name}» copiada`);
}
/**
 * Cortar (Ctrl+X): copia lo seleccionado y lo quita del póster en un solo paso de deshacer.
 * El primer pegado vuelve al mismo sitio (ya no hay original que tapar); los siguientes se desplazan como siempre.
 */
export function cutSelected() {
  const ls = selected();
  if (!ls.length) return;
  if (ls.some((l) => l.locked)) { toast(LOCKED_MSG); return; }
  if (S.mode === 'crop') applyCrop();
  toClip(ls);
  st.clipN = -1;
  snap();
  st.layers = st.layers.filter((x) => !ls.includes(x));
  tidyGroups();
  select(null);
  scheduleSave();
  toast(ls.length > 1 ? `${ls.length} imágenes cortadas` : `«${ls[0]!.name}» cortada`, 6000, { label: 'Deshacer', fn: undo });
}

/** Alinea las seleccionadas entre sí (con su caja común). */
export function alignSelected(edge: AlignEdge) {
  const ls = selected();
  if (ls.length < 2) return;
  const ds = alignShifts(ls.map((l) => bboxMM(l)), edge);
  if (ds.every((d) => Math.abs(d.x) < 1e-6 && Math.abs(d.y) < 1e-6)) { toast('Ya están alineadas'); return; }
  snap();
  ls.forEach((l, i) => { l.cx += ds[i]!.x; l.cy += ds[i]!.y; markManual(l); });
  afterChange();
}
/** Reparte las seleccionadas (3 o más) con el mismo espacio entre ellas. */
export function distributeSelected(axis: 'x' | 'y') {
  const ls = selected();
  if (ls.length < 3) { toast('Para repartir hacen falta al menos 3 imágenes'); return; }
  const ds = distributeShifts(ls.map((l) => bboxMM(l)), axis);
  snap();
  ls.forEach((l, i) => { l.cx += ds[i]!.x; l.cy += ds[i]!.y; markManual(l); });
  afterChange();
}

/**
 * Empieza un póster nuevo: quita las imágenes, vuelve a los ajustes iniciales y borra el trabajo guardado
 * (útil en un ordenador compartido). Se puede deshacer mientras la pestaña siga abierta.
 */
export function newPoster() {
  if (S.mode === 'crop') cancelCrop();
  if (S.mode !== 'move') setMode('move');
  snap();
  st.layers = [];
  st.sel = null;
  st.group = [];
  st.sheetsOn = false; // vuelve al estado inicial: sin hojas hasta que el usuario haga algo
  Object.assign(S, freshLayout(), DEFAULT_EXPORT); // el margen de la impresora se mantiene
  syncExportUI();
  layoutChanged();
  renderList(); // sin imágenes: aparece la pantalla de inicio
  renderBar(); // sin selección: se oculta la barra de la imagen
  scheduleSave(); // póster vacío: el guardado borra lo almacenado
  toast('Póster nuevo. Se borró el trabajo guardado en este navegador.', 7000, { label: 'Deshacer', fn: undo });
}
export function afterHistory() {
  if (!st.sel && S.mode !== 'move') setMode('move');
  layoutRestored();
  syncExportUI();
  renderList(); syncSel(); renderBar(); dirty();
  scheduleSave();
}

export function removeLayer(l: Layer) {
  if (S.mode === 'crop') applyCrop();
  snap();
  st.layers = st.layers.filter((x) => x !== l);
  tidyGroups();
  if (st.sel === l) select(null);
  else if (st.group.includes(l)) { selectMany(st.group.filter((x) => x !== l)); scheduleSave(); }
  else afterChange();
  toast(`«${l.name}» quitada del póster`, 6000, { label: 'Deshacer', fn: undo });
}
export function reorder(l: Layer, to: 'front' | 'back' | number) {
  const i = st.layers.indexOf(l);
  let j = to === 'front' ? st.layers.length - 1 : to === 'back' ? 0 : i + to;
  j = Math.min(Math.max(j, 0), st.layers.length - 1);
  if (i === j) return;
  snap();
  st.layers.splice(i, 1); st.layers.splice(j, 0, l);
  tidyGroups();
  afterChange();
}
export function duplicateLayer(l: Layer) {
  snap();
  // la copia de una imagen de un grupo queda dentro del mismo grupo, justo encima
  const d = cloneLayer(l, { name: l.name + ' (copia)', fit: null });
  d.cx += 10; d.cy += 10;
  st.layers.splice(st.layers.indexOf(l) + 1, 0, d);
  select(d);
}
export function copyLayer(l: Layer) { toClip([l]); st.clipN = 0; toast(`«${l.name}» copiada`); }
/**
 * Pega lo copiado en Pliego (una o varias imágenes), cada vez un poco más desplazado. Si el grupo del que se copió
 * sigue en el póster, se pega dentro de él, encima de lo que tiene; si no, suelto y al frente.
 */
export function pasteLayer() {
  const clip = st.clip;
  if (!clip?.length) return false;
  snap();
  const n = ++st.clipN;
  const scope = pathExists(st.layers, st.clipScope) ? st.clipScope : [];
  const fresh = freshGroups(clip.map((c) => c.gpath), st.layers);
  const host = scope.length ? membersOf(st.layers, scope.at(-1)!.id) : [];
  let at = host.length ? st.layers.indexOf(host.at(-1)!) + 1 : st.layers.length;
  const ds = clip.map((c, i) => {
    const d = cloneLayer(c, { name: c.name, fit: null });
    d.gpath = [...clonePath(scope), ...fresh[i]!];
    d.cx += 10 * n; d.cy += 10 * n;
    st.layers.splice(at++, 0, d);
    return d;
  });
  tidyGroups();
  selectMany(ds);
  scheduleSave();
  return true;
}
/** Envuelve una transformación de la imagen seleccionada con su paso de deshacer. */
export const tx = (fn: (l: Layer) => void) => () => {
  const l = st.sel;
  if (!l) return;
  if (l.locked) { toast(LOCKED_MSG); return; }
  snap(); fn(l); afterChange();
};
export const rotate90 = (dir: 1 | -1) => tx((l) => { rotateLayer(l, 90 * dir, cropCenter(l)); markManual(l); });
/** Espejo horizontal o vertical tal como se ve en pantalla (también con la imagen girada). */
export const flip = (axis: 'x' | 'y') => tx((l) => flipOnScreen(l, axis));
export const fitSel = (mode: FitMode) => tx((l) => { l.fit = { mode, scale: 1 }; applyFit(l, l.fit, posterGeo()); });
export const centerSel = tx((l) => { const g = posterGeo(), c = cropCenter(l); l.cx += g.W / 2 - c.x; l.cy += g.H / 2 - c.y; });
export const unstretchSel = tx((l) => { unstretch(l); markManual(l); });

/* ---------- modos ---------- */
let cropSession: Snapshot | null = null;
const cursorFor = (m: Mode) => (m === 'wand' ? 'crosshair' : m === 'erase' ? 'none' : 'default');

export function setMode(m: Mode) {
  if (S.mode === 'crop' && m !== 'crop') applyCrop();
  if (m === 'crop') { enterCrop(); return; }
  if (m !== 'move' && !st.sel) { toast('Primero selecciona una imagen'); return; }
  if (m !== 'move' && st.sel?.hidden) { toast('La imagen está oculta. Muéstrala para editarla.'); return; }
  if (m !== 'move' && st.sel?.locked) { toast(LOCKED_MSG); return; }
  S.mode = m;
  $('#cv').style.cursor = cursorFor(m);
  st.hoverL = null;
  renderBar(); dirty();
}
export function enterCrop() {
  if (!st.sel || S.mode === 'crop') return;
  if (st.sel.hidden) { toast('La imagen está oculta. Muéstrala para recortarla.'); return; }
  if (st.sel.locked) { toast(LOCKED_MSG); return; }
  S.cropRatio = null; S.cropRatioKey = 'null'; cropRef = null;
  cropSession = takeSnap();
  S.mode = 'crop';
  $('#cv').style.cursor = 'default';
  renderBar(); dirty();
}
export function applyCrop() {
  if (S.mode !== 'crop') return;
  const s = cropSession, sel = st.sel;
  cropSession = null; S.mode = 'move';
  const p = s && sel && s.props.find((q) => q.l === sel);
  // al encuadrar se mueve o amplía la imagen, no solo el recorte: se comparan las dos cosas
  const key = (o: Layer | LayerProps) => JSON.stringify([o.crop, o.cx, o.cy, o.w, o.h]);
  if (s && p && sel && key(p) !== key(sel)) { pushUndo(s); markManual(sel); }
  renderBar(); afterChange();
}
export function cancelCrop() {
  if (S.mode !== 'crop') return;
  if (cropSession) restoreSnap(cropSession);
  cropSession = null; S.mode = 'move';
  renderBar(); afterChange();
}
/**
 * Marco de referencia para las proporciones (mm): el que había al elegir la primera, y size, el que dejó la última.
 * Mientras el marco siga de ese tamaño (solo se encuadró o amplió la imagen), cada proporción parte de la referencia
 * y «Libre» la devuelve entera; si se cambió a mano con los bordes, ese pasa a ser la nueva referencia.
 */
let cropRef: { ref: { w: number; h: number }; size: { w: number; h: number } } | null = null;
export function setCropRatio(key: string) {
  const sel = st.sel;
  if (!sel) return;
  S.cropRatioKey = key;
  S.cropRatio = key === 'null' ? null : key === 'orig' ? sel.w / sel.h : +key;
  const cur = { w: visW(sel), h: visH(sel) }, same = (a: typeof cur, b: typeof cur) => Math.abs(a.w - b.w) < 1e-6 && Math.abs(a.h - b.h) < 1e-6;
  const ref = cropRef && same(cur, cropRef.size) ? cropRef.ref : cur;
  cropRef = { ref, size: conformCrop(sel, S.cropRatio, ref) };
  renderBar(); afterChange();
}

/* ---------- edición de píxeles ---------- */
const mmToPx = (l: Layer, m: Pt) => {
  const q = mmToLocal(l, m);
  return { x: q.u * l.img.width, y: q.v * l.img.height };
};
/** Guarda el paso de deshacer y trabaja sobre una copia del lienzo (el anterior queda en el historial). */
export function beginPixelEdit(l: Layer) { snap(); l.img = cloneCanvas(l.img); }

export function paint(l: Layer, a: Pt, b: Pt) {
  const r = S.brush / (V.k * Math.sqrt((l.w / l.img.width) * (l.h / l.img.height)));
  const pa = mmToPx(l, s2mm(a)), pb = mmToPx(l, s2mm(b)), c = l.img.getContext('2d')!;
  if (S.brushMode === 'erase') {
    c.save(); c.globalCompositeOperation = 'destination-out'; c.lineCap = 'round'; c.lineWidth = 2 * r; c.strokeStyle = '#000'; c.fillStyle = '#000';
    c.beginPath(); c.moveTo(pa.x, pa.y); c.lineTo(pb.x, pb.y); c.stroke();
    c.beginPath(); c.arc(pb.x, pb.y, r, 0, Math.PI * 2); c.fill(); c.restore();
  } else {
    restoreStroke(l, c, pa, pb, r);
  }
  markCanvasChanged(l.img);
  dirty();
}

/** Lienzos auxiliares reutilizados por «Restaurar» (crecen según haga falta). */
let maskCanvas: HTMLCanvasElement | null = null, origCanvas: HTMLCanvasElement | null = null;
const scratchCanvas = (c: HTMLCanvasElement | null, w: number, h: number) => {
  const s = c ?? document.createElement('canvas');
  if (s.width < w) s.width = w;
  if (s.height < h) s.height = h;
  return s;
};
/**
 * «Restaurar»: recupera el original bajo el pincel con la mezcla exacta
 *   resultado = actual × (1 − cobertura) + original × cobertura
 * (destination-out con la máscara y luego suma con 'lighter' del original enmascarado).
 * Antes se recortaba con los círculos y se hacía clearRect + drawImage: en el borde suavizado del recorte
 * cada píxel quedaba con opacidad cobertura + (1 − cobertura)², y como cada movimiento crea su propio borde
 * sobre zonas ya restauradas, quedaban anillos semitransparentes («rebaba»). Ahora repasar no cambia nada.
 * Solo se trabaja en el rectángulo que toca el pincel.
 */
function restoreStroke(l: Layer, c: CanvasRenderingContext2D, pa: Pt, pb: Pt, r: number) {
  const W = l.img.width, H = l.img.height;
  const x0 = Math.max(0, Math.floor(Math.min(pa.x, pb.x) - r - 2)), y0 = Math.max(0, Math.floor(Math.min(pa.y, pb.y) - r - 2));
  const x1 = Math.min(W, Math.ceil(Math.max(pa.x, pb.x) + r + 2)), y1 = Math.min(H, Math.ceil(Math.max(pa.y, pb.y) + r + 2));
  const bw = x1 - x0, bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return;
  // máscara: los círculos del pincel a lo largo del segmento (con borde suave)
  maskCanvas = scratchCanvas(maskCanvas, bw, bh);
  const m = maskCanvas.getContext('2d')!;
  m.globalCompositeOperation = 'source-over';
  m.clearRect(0, 0, bw, bh);
  m.fillStyle = '#000';
  m.beginPath();
  const d = Math.hypot(pb.x - pa.x, pb.y - pa.y), n = Math.max(1, Math.ceil(d / (r * 0.4)));
  for (let i = 0; i <= n; i++) {
    const x = pa.x + ((pb.x - pa.x) * i) / n - x0, y = pa.y + ((pb.y - pa.y) * i) / n - y0;
    m.moveTo(x + r, y); m.arc(x, y, r, 0, Math.PI * 2);
  }
  m.fill();
  // original × cobertura
  origCanvas = scratchCanvas(origCanvas, bw, bh);
  const o = origCanvas.getContext('2d')!;
  o.globalCompositeOperation = 'copy';
  o.drawImage(l.orig, x0, y0, bw, bh, 0, 0, bw, bh);
  o.globalCompositeOperation = 'destination-in';
  o.drawImage(maskCanvas, 0, 0, bw, bh, 0, 0, bw, bh);
  // actual × (1 − cobertura) + original × cobertura
  c.save();
  c.globalCompositeOperation = 'destination-out';
  c.drawImage(maskCanvas, 0, 0, bw, bh, x0, y0, bw, bh);
  c.globalCompositeOperation = 'lighter';
  c.drawImage(origCanvas, 0, 0, bw, bh, x0, y0, bw, bh);
  c.restore();
}

/* ---------- quitar fondo y varita (en un worker) ---------- */
let pixelBusy = false;
/**
 * Ejecuta la tarea en el worker y, si borró algo, la aplica como un paso de deshacer sobre un lienzo nuevo
 * (el anterior queda en el historial). Si mientras tanto la imagen cambió, el resultado se descarta.
 */
async function applyPixelJob(l: Layer, job: PixelJob, busyMsg: string): Promise<PixelResult | null> {
  if (l.locked) { toast(LOCKED_MSG); return null; }
  if (pixelBusy) { toast('Espera a que termine el proceso anterior…'); return null; }
  pixelBusy = true;
  const src = l.img, rev = canvasRevision(src), cv = $('#cv');
  // el aviso solo aparece si tarda (en tareas rápidas evita un parpadeo)
  const slow = setTimeout(() => toast(busyMsg, 0), 150);
  document.body.classList.add('busy');
  cv.setAttribute('aria-busy', 'true');
  try {
    const ctx = src.getContext('2d', { willReadFrequently: true })!;
    const r = await runJob(() => ctx.getImageData(0, 0, src.width, src.height), job);
    if (l.img !== src || canvasRevision(src) !== rev || !st.layers.includes(l)) {
      toast('La imagen cambió mientras se procesaba. Vuelve a intentarlo.');
      return null;
    }
    if (r.removed) {
      const s0 = takeSnap();
      const out = document.createElement('canvas');
      out.width = r.w; out.height = r.h;
      out.getContext('2d', { willReadFrequently: true })!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.w, r.h), 0, 0);
      l.img = out;
      pushUndo(s0); // solo se guarda el paso si borró algo (así no se pierde "rehacer")
      afterChange();
    }
    return r;
  } catch (err) {
    console.error(err);
    toast('No se pudo procesar la imagen.');
    return null;
  } finally {
    clearTimeout(slow);
    pixelBusy = false;
    document.body.classList.remove('busy');
    cv.removeAttribute('aria-busy');
  }
}
export async function wandAt(p: Pt) {
  const l = st.sel;
  if (!l) return;
  const q = mmToPx(l, s2mm(p)), x = Math.floor(q.x), y = Math.floor(q.y), w = l.img.width;
  if (x < 0 || y < 0 || x >= w || y >= l.img.height) { toast('Elige un punto dentro de la imagen seleccionada'); return; }
  const px = l.img.getContext('2d', { willReadFrequently: true })!.getImageData(x, y, 1, 1).data;
  if (px[3] === 0) { toast('Esa zona ya está vacía'); return; }
  const r = await applyPixelJob(l, { kind: 'wand', seeds: [y * w + x], ref: [px[0]!, px[1]!, px[2]!], tol: S.tol, contig: S.contig }, 'Borrando color…');
  if (r && !r.removed) toast('Nada que borrar con esta tolerancia. Súbela un poco.');
  else if (r) hideToast();
}
/** Quita el fondo uniforme tomando como referencia el color mediano de las cuatro esquinas. */
export async function autoBackground() {
  const l = st.sel;
  if (!l) return;
  const r = await applyPixelJob(l, { kind: 'auto', tol: S.tol }, 'Quitando el fondo…');
  if (!r) return;
  if (r.error === 'transparent') toast('Los bordes ya están transparentes');
  else if (r.error === 'nouniform') toast('No encontré un fondo uniforme. Prueba con la varita.');
  else toast(r.removed ? 'Fondo quitado. Si queda algo, retócalo con la varita o el borrador.' : 'No se borró nada. Sube la tolerancia de la varita.');
}
export function resetOriginal(l: Layer) {
  if (l.locked) { toast(LOCKED_MSG); return; }
  beginPixelEdit(l);
  const c = l.img.getContext('2d')!;
  c.clearRect(0, 0, l.img.width, l.img.height); c.drawImage(l.orig, 0, 0);
  markCanvasChanged(l.img);
  keepCenter(l, (x) => { x.crop = { x0: 0, y0: 0, x1: 1, y1: 1 }; x.h = x.w * natRatio(x); x.flipX = false; x.flipY = false; });
  markManual(l);
  afterChange();
  toast('Imagen original restaurada');
}
