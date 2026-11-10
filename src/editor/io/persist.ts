/**
 * Guardado automático del póster en IndexedDB: solo en este navegador y este dispositivo, sin servidor.
 *
 * Se guardan los archivos originales (una vez cada uno), las versiones editadas en PNG (solo cuando cambian),
 * la colocación de cada imagen y los ajustes del póster. El historial de deshacer no se guarda.
 * Al abrir la app se restaura sin preguntar, como Excalidraw o tldraw.
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { makeCanvas, newLayer } from '../actions';
import { toast } from '../dom';
import { S, st } from '../state';
import { clonePath, nextGroupName, normalizeGroups, type GroupRef, type Groupable } from '../groups';
import { loadImg } from './load';
import { openPdf, renderPdfPage } from './pdf';
import type { Crop, Fit, Layer, LayoutSettings } from '../types';

const DB_NAME = 'pliego';
const SCHEMA = 1;
const SAVE_DELAY = 1200;

interface SavedSource { kind: 'img' | 'svg' | 'pdf'; key: string }
interface SavedLayer {
  name: string; cx: number; cy: number; w: number; h: number; rot: number; flipX: boolean; flipY: boolean;
  crop: Crop; page: number; pages: number; fit: Fit;
  /** Opcional para leer proyectos guardados antes de existir la opción de ocultar. */
  hidden?: boolean;
  /** Opcionales por la misma razón (bloquear y opacidad llegaron después). */
  locked?: boolean;
  opacity?: number;
  /** Grupos (Ctrl+G), del más externo al más interno; opcional por la misma razón. */
  gpath?: { id: number; name: string }[];
  /** Formato anterior (un solo grupo por imagen): se convierte al leer. */
  gid?: number | null;
  gname?: string;
  /** null solo en proyectos antiguos con la imagen de ejemplo (ya no existe): esas capas se omiten al restaurar. */
  src: SavedSource | null;
  /** Lienzo editado (borrador, varita, quitar fondo) en PNG; null si no se editó. */
  edit: string | null;
}
interface SavedProject {
  schema: number; savedAt: number;
  layout: LayoutSettings; dpi: number; marks: boolean; guide: boolean;
  layers: SavedLayer[];
}

/* ---------- IndexedDB mínimo ---------- */
let dbp: Promise<IDBDatabase> | null = null;
function db() {
  return (dbp ??= new Promise<IDBDatabase>((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => { r.result.createObjectStore('project'); r.result.createObjectStore('blobs'); };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
const req = <T>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (t: IDBTransaction) => new Promise<void>((res, rej) => { t.oncomplete = () => res(); t.onerror = t.onabort = () => rej(t.error); });

/* ---------- identidad de archivos y lienzos ---------- */
const uid = () => crypto.randomUUID();
/** Clave con la que se guardó cada archivo original (los duplicados comparten archivo). */
const blobKeys = new WeakMap<Blob, string>();
/** Clave y revisión con que se guardó cada lienzo editado. */
const savedCanvas = new WeakMap<HTMLCanvasElement, { key: string; rev: number }>();
/** Revisión del contenido de cada lienzo: sube con cada trazo o borrado. */
const canvasRev = new WeakMap<HTMLCanvasElement, number>();
/** Claves que hay ahora mismo en la base de datos. */
let stored = new Set<string>();

/** Avisa de que el contenido de un lienzo cambió (para volver a guardarlo). */
export function markCanvasChanged(c: HTMLCanvasElement) { canvasRev.set(c, (canvasRev.get(c) ?? 0) + 1); }
/** Revisión del contenido de un lienzo (la usan también las miniaturas para saber si redibujar). */
export const canvasRevision = (c: HTMLCanvasElement) => canvasRev.get(c) ?? 0;

const toPng = (c: HTMLCanvasElement) =>
  new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('No se pudo codificar la imagen'))), 'image/png'));

/* ---------- estado del guardado ---------- */
let available = typeof indexedDB !== 'undefined';
let timer: ReturnType<typeof setTimeout> | undefined;
let pending = false, saving = false, again = false, failed = false, warned = false, persistAsked = false;
/**
 * Se está recuperando el póster guardado. Mientras dura no se guarda: st.layers aún está a medias (o vacío) y un
 * guardado borraría de la base de datos los archivos que todavía no se han leído. Lo pendiente se guarda al terminar.
 */
let restoring = false;

/** El trabajo está a salvo en el navegador (no hace falta avisar al cerrar). */
export const isWorkSafe = () => available && !pending && !saving && !failed;

export function scheduleSave() {
  if (!available) return;
  pending = true;
  clearTimeout(timer);
  timer = setTimeout(() => void flushSave(), SAVE_DELAY);
}

/** Guarda ya (al ocultar la pestaña o antes de cerrarla). */
export async function flushSave() {
  clearTimeout(timer);
  if (!available || !pending || restoring) return;
  if (saving) { again = true; return; }
  saving = true; pending = false;
  try {
    await save();
    failed = false;
  } catch (err) {
    console.error('No se pudo guardar el póster', err);
    failed = true; pending = true;
    showInfo();
    if (!warned) {
      warned = true;
      const quota = err instanceof DOMException && err.name === 'QuotaExceededError';
      toast(quota ? 'No queda espacio en el navegador para guardar tu póster. Descarga el PDF para no perderlo.'
        : 'No se pudo guardar tu póster en este navegador. Descarga el PDF para no perderlo.', 8000);
    }
  } finally {
    saving = false;
    if (again) { again = false; void flushSave(); }
  }
}

async function save() {
  const d = await db();
  // póster vacío: no se guarda nada y al volver aparece la pantalla de inicio
  if (!st.layers.length) { await clearSaved(); return; }

  // 0. lo que hay de verdad en la base de datos: otra pestaña con Pliego abierta pudo borrar archivos que esta daba
  //    por guardados (cada una borra lo que su póster no usa), y entonces hay que volver a escribirlos
  stored = new Set((await req(d.transaction('blobs', 'readonly').objectStore('blobs').getAllKeys())).map(String));

  // 1. preparar lo que hay que escribir (fuera de la transacción: codificar PNG es asíncrono)
  const writes = new Map<string, Blob>();
  const used = new Set<string>();
  /** Archivos originales en memoria, por clave: si alguno desaparece entre el paso 0 y la escritura, se repone. */
  const sources = new Map<string, Blob>();
  const layers: SavedLayer[] = [];
  for (const l of st.layers) {
    let src: SavedSource | null = null;
    if (l.src) {
      let key = blobKeys.get(l.src.blob);
      if (!key) { key = 'src-' + uid(); blobKeys.set(l.src.blob, key); }
      if (!stored.has(key)) writes.set(key, l.src.blob);
      sources.set(key, l.src.blob);
      used.add(key);
      src = { kind: l.src.kind, key };
    } else continue; // sin archivo de origen no se puede reconstruir
    let edit: string | null = null;
    if (l.img !== l.orig) {
      const info = savedCanvas.get(l.img), rev = canvasRev.get(l.img) ?? 0;
      const key = info?.key ?? 'px-' + uid();
      if (!info || info.rev !== rev || !stored.has(key)) {
        if (!writes.has(key)) writes.set(key, await toPng(l.img));
        savedCanvas.set(l.img, { key, rev });
      }
      used.add(key);
      edit = key;
    }
    layers.push({
      name: l.name, cx: l.cx, cy: l.cy, w: l.w, h: l.h, rot: l.rot, flipX: l.flipX, flipY: l.flipY,
      crop: { ...l.crop }, page: l.page, pages: l.pages, fit: l.fit && { ...l.fit }, hidden: l.hidden,
      locked: l.locked, opacity: l.opacity, gpath: clonePath(l.gpath), src, edit,
    });
  }
  const project: SavedProject = {
    schema: SCHEMA, savedAt: Date.now(),
    layout: { paper: S.paper, orient: S.orient, cols: S.cols, rows: S.rows, margin: S.margin, overlap: S.overlap },
    dpi: S.dpi, marks: S.marks, guide: S.guide, layers,
  };

  // 2. escribir todo en una transacción y borrar los archivos que ya no usa ninguna imagen
  const t = d.transaction(['project', 'blobs'], 'readwrite');
  const blobs = t.objectStore('blobs');
  t.objectStore('project').put(project, 'current');
  for (const [k, b] of writes) blobs.put(b, k);
  const keys = blobs.getAllKeys();
  /** Falta un lienzo editado que se daba por guardado: no se puede codificar dentro de la transacción. */
  let lost = false;
  keys.onsuccess = () => {
    const have = new Set(keys.result.map(String));
    for (const k of have) if (!used.has(k)) blobs.delete(k);
    for (const k of used) {
      if (have.has(k)) continue;
      const b = sources.get(k);
      if (b) blobs.put(b, k); else lost = true;
    }
  };
  await done(t);
  stored = used;
  if (lost) scheduleSave(); // el siguiente guardado ve que falta (paso 0) y lo vuelve a codificar

  showInfo();
  askPersistence();
}

/** Borra el trabajo guardado. */
export async function clearSaved() {
  const d = await db();
  const t = d.transaction(['project', 'blobs'], 'readwrite');
  t.objectStore('project').clear();
  t.objectStore('blobs').clear();
  await done(t);
  stored = new Set();
  showInfo();
}

/**
 * Pide al navegador que no borre estos datos (Safari los borra tras 7 días sin visitar la web).
 * En Firefox no se pide, porque muestra un diálogo de permiso y allí no hay borrado por tiempo.
 */
function askPersistence() {
  if (persistAsked || /Firefox\//.test(navigator.userAgent)) return;
  persistAsked = true;
  void navigator.storage?.persist?.().catch(() => {});
}

/* ---------- restaurar ---------- */
/**
 * Reconstruye el póster guardado. Devuelve los nombres de las imágenes que no se pudieron recuperar,
 * o null si no había nada guardado.
 */
export async function restoreProject(): Promise<{ failed: string[] } | null> {
  restoring = true;
  try { return await readProject(); } finally {
    restoring = false;
    if (pending) scheduleSave(); // lo que se cambió mientras tanto se guarda ahora, con el póster ya completo
  }
}
async function readProject(): Promise<{ failed: string[] } | null> {
  let d: IDBDatabase;
  try { d = await db(); } catch (err) { console.warn('Guardado no disponible', err); available = false; showInfo(); return null; }
  const t = d.transaction(['project', 'blobs'], 'readonly');
  const project = await req(t.objectStore('project').get('current')) as SavedProject | undefined;
  if (!project || project.schema !== SCHEMA) { showInfo(); return null; }

  const getBlob = async (key: string) => {
    const b = await req(d.transaction('blobs', 'readonly').objectStore('blobs').get(key)) as Blob | undefined;
    if (!b) throw new Error('Falta ' + key);
    return b;
  };
  const decode = async (b: Blob) => {
    const url = URL.createObjectURL(b);
    try { return await loadImg(url); } finally { URL.revokeObjectURL(url); }
  };
  // cachés: los duplicados comparten archivo, documento PDF y lienzos, igual que en la sesión original
  const bases = new Map<string, { canvas: HTMLCanvasElement; blob: Blob; w: number; h: number }>();
  const pdfs = new Map<string, { doc: PDFDocumentProxy; blob: Blob }>();
  const edits = new Map<string, HTMLCanvasElement>();
  const used = new Set<string>();
  const failedNames: string[] = [];

  for (const r of project.layers) {
    try {
      let orig: HTMLCanvasElement, extra: Partial<Layer> = {};
      if (!r.src) continue; // imagen de ejemplo de versiones anteriores
      if (r.src.kind === 'pdf') {
        let p = pdfs.get(r.src.key);
        if (!p) { const blob = await getBlob(r.src.key); p = { doc: await openPdf(await blob.arrayBuffer()), blob }; pdfs.set(r.src.key, p); }
        orig = await renderPdfPage(p.doc, r.page);
        blobKeys.set(p.blob, r.src.key);
        extra = { pdf: p.doc, src: { kind: 'pdf', blob: p.blob } };
      } else {
        let b = bases.get(r.src.key);
        if (!b) {
          const blob = await getBlob(r.src.key), im = await decode(blob);
          const svg = r.src.kind === 'svg', w = im.naturalWidth || 1200, h = im.naturalHeight || 1200;
          b = { canvas: makeCanvas(im, w, h, svg), blob, w, h };
          bases.set(r.src.key, b);
        }
        orig = b.canvas;
        blobKeys.set(b.blob, r.src.key);
        extra = { src: r.src.kind === 'svg' ? { kind: 'svg', blob: b.blob } : { kind: 'img', blob: b.blob, w: b.w, h: b.h } };
      }
      if (r.src) used.add(r.src.key);

      let img = orig;
      if (r.edit) {
        let c = edits.get(r.edit);
        if (!c) {
          const im = await decode(await getBlob(r.edit));
          c = document.createElement('canvas');
          c.width = im.naturalWidth; c.height = im.naturalHeight;
          c.getContext('2d', { willReadFrequently: true })!.drawImage(im, 0, 0);
          savedCanvas.set(c, { key: r.edit, rev: 0 });
          edits.set(r.edit, c);
        }
        img = c;
        used.add(r.edit);
      }
      st.layers.push(newLayer(orig, r.name, {
        ...extra, img, orig, cx: r.cx, cy: r.cy, w: r.w, h: r.h, rot: r.rot, flipX: r.flipX, flipY: r.flipY,
        crop: { ...r.crop }, page: r.page, pages: r.pages, fit: r.fit && { ...r.fit }, hidden: !!r.hidden,
        locked: !!r.locked, opacity: typeof r.opacity === 'number' ? Math.min(1, Math.max(0, r.opacity)) : 1,
        gpath: readPath(r),
      }));
    } catch (err) {
      console.warn('No se pudo recuperar', r.name, err);
      failedNames.push(r.name);
    }
  }
  // grupos en regla (p. ej. si alguna imagen no se pudo recuperar) y con nombre los de antes
  st.layers = normalizeGroups(st.layers);
  nameUnnamedGroups(st.layers);
  Object.assign(S, project.layout, { dpi: project.dpi, marks: project.marks, guide: project.guide });
  stored = used;
  // si algo falló, el próximo guardado limpia lo que ya no se usa
  if (failedNames.length) scheduleSave();
  showInfo();
  return { failed: failedNames };
}

/* ---------- grupos guardados ---------- */
/** Cadena de grupos de una imagen guardada; los proyectos de antes (un solo grupo, nombre vacío) se convierten. */
function readPath(r: SavedLayer): GroupRef[] {
  const name = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, 80) : '');
  if (Array.isArray(r.gpath)) {
    return r.gpath.filter((g) => g && Number.isInteger(g.id)).slice(0, 32).map((g) => ({ id: g.id, name: name(g.name) }));
  }
  return typeof r.gid === 'number' ? [{ id: r.gid, name: name(r.gname) }] : [];
}
/** Grupos sin nombre (guardados antes de que lo tuvieran): «Grupo 1», «Grupo 2»…, por orden. */
export function nameUnnamedGroups(layers: Groupable[]) {
  for (const l of layers) for (const g of l.gpath) {
    if (g.name) continue;
    const n = nextGroupName(layers);
    for (const x of layers) for (const y of x.gpath) if (y.id === g.id) y.name = n;
  }
}

/* ---------- indicador en el panel ---------- */
function showInfo() {
  const el = document.querySelector('#saveInfo');
  if (!el) return;
  if (!available || failed) {
    el.textContent = 'Tu póster no se está guardando en este navegador. Descarga el PDF para no perderlo.';
    return;
  }
  if (otherTab) { el.textContent = 'Pliego está abierto en otra pestaña. Solo se guarda un póster: el de la última pestaña en la que cambies algo.'; return; }
  if (!stored.size) { el.textContent = 'Tu póster se guarda automáticamente en este navegador.'; return; }
  el.textContent = 'Guardado en este navegador.';
  void navigator.storage?.estimate?.().then(({ usage }) => {
    if (usage && stored.size) el.textContent = `Guardado en este navegador · ${Math.max(1, Math.round(usage / 1024 / 1024))} MB.`;
  }).catch(() => {});
}

/* ---------- otra pestaña ---------- */
/**
 * Solo hay un póster guardado por navegador. Con Pliego abierto en dos pestañas, cada una guarda el suyo encima del
 * de la otra: no se pierde nada a medias (ver el paso 0 de save), pero queda el de la última que cambió algo, y hay
 * que avisarlo. Las pestañas se saludan por un BroadcastChannel: la que llega dice «hola», las que están contestan
 * «aquí» y la que se va dice «adiós». Una pestaña cerrada o recargada no contesta, así que nunca cuenta de más.
 */
let otherTab = false;
let tabsKnown: Promise<void> = Promise.resolve();
function watchTabs() {
  if (typeof BroadcastChannel === 'undefined') return;
  const id = uid(), others = new Set<string>(), ch = new BroadcastChannel('pliego');
  const sync = () => { const on = others.size > 0; if (on !== otherTab) { otherTab = on; showInfo(); } };
  ch.onmessage = (e) => {
    const m = e.data as { t?: unknown; id?: unknown } | null;
    if (!m || typeof m.id !== 'string' || m.id === id) return;
    if (m.t === 'adios') others.delete(m.id);
    else { others.add(m.id); if (m.t === 'hola') ch.postMessage({ t: 'aqui', id }); }
    sync();
  };
  const hello = () => ch.postMessage({ t: 'hola', id });
  hello();
  addEventListener('pagehide', () => ch.postMessage({ t: 'adios', id }));
  // al volver con el botón «atrás» (la página se conservó): se vuelve a preguntar quién hay
  addEventListener('pageshow', (e) => { if (e.persisted) { others.clear(); sync(); hello(); } });
  // las respuestas llegan enseguida; pasado este plazo se da por sabido (si alguna llega después, también cuenta)
  tabsKnown = new Promise((known) => setTimeout(known, 300));
}
/** Hay otra pestaña con Pliego abierta (se sabe 0,3 s después de arrancar). */
export const isOtherTabOpen = async () => { await tabsKnown; return otherTab; };

export function initPersistence() {
  watchTabs();
  // al ocultar la pestaña (cambiar de app en el móvil, cerrar) se guarda sin esperar
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') void flushSave(); });
  addEventListener('pagehide', () => void flushSave());
  showInfo();
}
