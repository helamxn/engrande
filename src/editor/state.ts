/** Estado compartido del editor. Un único objeto mutable: lo leen el render, la interfaz y la entrada. */
import { savedMargin } from './prefs';
import { MAX_COLS_ROWS, MIN_SIZE, PAPERS } from './constants';
import { geo, maxSize, type Box, type Dash, type Gap, type GuideSeg } from './geometry';
import type { GroupRef } from './groups';
import type { Layer, LayoutSettings, Pt, Settings, TextDraft } from './types';

/** Ajustes de un póster nuevo (los que se guardan y se restablecen con "Nuevo póster"). */
export const DEFAULT_LAYOUT: LayoutSettings = { paper: 'A4', orient: 'portrait', cols: 2, rows: 1, size: null, margin: 6, overlap: 10 };
export const DEFAULT_EXPORT: Pick<Settings, 'dpi' | 'marks' | 'guide' | 'skipBlank'> = { dpi: 150, marks: true, guide: true, skipBlank: true };

/** Distribución de un póster nuevo: la de siempre, con el margen de la impresora si ya se eligió uno. */
export const freshLayout = (): LayoutSettings => ({ ...DEFAULT_LAYOUT, margin: savedMargin() ?? DEFAULT_LAYOUT.margin });

/** Copia de la distribución (para el historial y el guardado). */
export const layoutOf = (s: LayoutSettings): LayoutSettings => ({
  paper: s.paper, orient: s.orient, cols: s.cols, rows: s.rows, size: s.size && { ...s.size }, margin: s.margin, overlap: s.overlap,
});

/**
 * Distribución leída de lo guardado: lo que falte o no tenga sentido vuelve al valor de siempre, así un póster de una
 * versión anterior (sin medida) o un dato dañado no rompe la geometría.
 */
export function readLayout(raw: unknown): LayoutSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>, d = DEFAULT_LAYOUT;
  const int = (v: unknown, lo: number, hi: number, def: number) => (Number.isInteger(v) && (v as number) >= lo && (v as number) <= hi ? v as number : def);
  const paper = typeof r.paper === 'string' && Object.hasOwn(PAPERS, r.paper) ? r.paper as LayoutSettings['paper'] : d.paper;
  const orient = r.orient === 'landscape' ? 'landscape' : 'portrait';
  const out: LayoutSettings = {
    paper, orient,
    cols: int(r.cols, 1, MAX_COLS_ROWS, d.cols), rows: int(r.rows, 1, MAX_COLS_ROWS, d.rows),
    size: null,
    margin: int(r.margin, 0, 15, d.margin), overlap: int(r.overlap, 0, 30, d.overlap),
  };
  const z = r.size as { w?: unknown; h?: unknown } | null | undefined;
  if (z && typeof z === 'object' && Number.isFinite(z.w) && Number.isFinite(z.h)) {
    const max = maxSize(out, MAX_COLS_ROWS);
    out.size = { w: clampSize(z.w as number, max.w), h: clampSize(z.h as number, max.h) };
  }
  return out;
}
/** Medida entre el mínimo y el máximo, en mm enteros (la precisión del panel). */
export const clampSize = (v: number, max: number) => Math.round(Math.min(Math.max(v, MIN_SIZE), Math.floor(max)));

export const S: Settings = {
  ...freshLayout(), ...DEFAULT_EXPORT,
  mode: 'move', brush: 24, brushMode: 'erase', tol: 40, contig: true, cropRatio: null, cropRatioKey: 'null', lock: true,
};

export const st = {
  layers: [] as Layer[],
  sel: null as Layer | null,
  /**
   * Selección de varias imágenes (2 o más). Cuando hay grupo, sel es null: así todo lo que trabaja con una sola
   * imagen (barra, recorte, borrador, propiedades) queda sin efecto. Ver selected() en actions.ts.
   */
  group: [] as Layer[],
  /**
   * El usuario ya hizo algo en este póster (cargó una imagen o cambió la distribución): desde entonces se ven
   * las hojas aunque se quede vacío. Un póster nuevo empieza sin hojas a la vista.
   */
  sheetsOn: false,
  /** Marco del grupo mientras se gira (esquinas en mm); null = la caja común, alineada con la pantalla. */
  groupFrame: null as Pt[] | null,
  /** Guías del imán durante un gesto: tramos entre lo alineado, con × en los puntos que coinciden (ver measure.ts). */
  guides: null as GuideSeg[] | null,
  /** Separación igual durante un gesto: las medidas iguales, en rojo. */
  gaps: null as Gap[] | null,
  /** Medir (Alt al pasar el ratón por otra imagen o el póster): distancias de la selección a target. */
  measure: null as { gaps: Gap[]; dashes: Dash[]; target: Box } | null,
  /** Alt pulsado (para medir al pasar el ratón). */
  altDown: false,
  /** El ratón está sobre el papel fuera del póster: el margen sin imprimir o, con medida, el papel de más. Se explica qué es. */
  hoverBand: null as 'margin' | 'trim' | null,
  /** Persona de 1,70 m junto al póster, para ver su tamaño real (ver scaleref.ts). */
  scaleRef: false,
  /** Se está ajustando el margen o el solape: se dibuja el papel entero de cada hoja. */
  showPaper: false,
  /** Recuadro de selección mientras se arrastra (px de pantalla). */
  marquee: null as { a: Pt; b: Pt } | null,
  nextId: 1,
  /** Imágenes copiadas con Ctrl+C dentro de Pliego, y cuántas veces se pegaron (cada pegado se desplaza un poco más). */
  clip: null as Layer[] | null,
  /** Grupos en los que estaba lo copiado (sin los copiados enteros): al pegar, se pega dentro si aún existen. */
  clipScope: [] as GroupRef[],
  clipN: 0,
  /** Posición del puntero (círculo del pincel). */
  hover: null as Pt | null,
  /** Imagen bajo el ratón (se resalta). */
  hoverL: null as Layer | null,
  /** Texto que se está escribiendo (ver text/editor.ts): no se dibuja; en su lugar está el cuadro de escritura. */
  editingText: null as Layer | null,
  /** «Agregar texto»: se espera el clic (o el recuadro) que dice dónde va el texto. Ver text/editor.ts. */
  placingText: false,
  textDraft: null as TextDraft | null,
  /** Vista previa de color a resolución de pantalla; no modifica los lienzos del historial. */
  textColorPreview: null as { layer: Layer; canvas: HTMLCanvasElement } | null,
};

/** Vista: escala (px por mm) y desplazamiento del lienzo. */
export const V = { k: 1, ox: 0, oy: 0, fitted: true };

/**
 * Tamaño del lienzo en px CSS y densidad de píxeles.
 * ins: márgenes (px) que tapan ahora las islas y los paneles; lo que queda dentro es la zona libre a la vista.
 * fit: los márgenes con los que se encaja el póster: solo lo fijo (cabecera, barra, isla de vista, pestañas del
 * panel inferior). El panel de la selección y el panel inferior abierto van encima: no mueven el lienzo.
 */
export const view = { dpr: 1, CW: 0, CH: 0, ins: { t: 0, r: 0, b: 0, l: 0 }, fit: { t: 0, r: 0, b: 0, l: 0 } };

/** Colores del tema leídos de las variables CSS (el canvas no entiende var()). */
export const C: Record<string, string> = {};

export const posterGeo = () => geo(S);
/**
 * El póster está como uno nuevo: sin imágenes, sin hojas elegidas y con los ajustes iniciales. Entonces «Nuevo
 * póster» no tiene nada que hacer (el botón se desactiva).
 */
export function isFreshPoster() {
  if (st.layers.length || st.sheetsOn) return false;
  const f: Record<string, unknown> = { ...freshLayout(), ...DEFAULT_EXPORT };
  return Object.keys(f).every((k) => S[k as keyof Settings] === f[k]); // size: null en uno nuevo
}
/** Se dibujan el papel y las hojas: hay imágenes o el usuario ya eligió la distribución. */
export const sheetsVisible = () => st.layers.length > 0 || st.sheetsOn;
