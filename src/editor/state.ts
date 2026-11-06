/** Estado compartido del editor. Un único objeto mutable: lo leen el render, la interfaz y la entrada. */
import { savedMargin } from './prefs';
import { geo, type Box, type Dash, type Gap, type GuideSeg } from './geometry';
import type { GroupRef } from './groups';
import type { Layer, LayoutSettings, Pt, Settings } from './types';

/** Ajustes de un póster nuevo (los que se guardan y se restablecen con "Nuevo póster"). */
export const DEFAULT_LAYOUT: LayoutSettings = { paper: 'A4', orient: 'portrait', cols: 2, rows: 1, margin: 6, overlap: 10 };
export const DEFAULT_EXPORT: Pick<Settings, 'dpi' | 'marks' | 'guide'> = { dpi: 150, marks: true, guide: true };

/** Distribución de un póster nuevo: la de siempre, con el margen de la impresora si ya se eligió uno. */
export const freshLayout = (): LayoutSettings => ({ ...DEFAULT_LAYOUT, margin: savedMargin() ?? DEFAULT_LAYOUT.margin });

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
  /** Medir (Alt al pasar el ratón, o «Medir» en el menú en táctil): distancias de la selección a target. */
  measure: null as { gaps: Gap[]; dashes: Dash[]; target: Box } | null,
  /** Alt pulsado (para medir al pasar el ratón). */
  altDown: false,
  /** Táctil: «Medir» activado desde el menú; el siguiente toque elige con qué medir. */
  measureMode: false,
  /** El ratón está sobre el margen sin imprimir (la franja alrededor del póster): se explica qué es. */
  hoverBand: false,
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
};

/** Vista: escala (px por mm) y desplazamiento del lienzo. */
export const V = { k: 1, ox: 0, oy: 0, fitted: true };

/**
 * Tamaño del lienzo en px CSS y densidad de píxeles.
 * ins: márgenes (px) que tapan las islas flotantes en escritorio; lo que queda dentro es la zona libre.
 */
export const view = { dpr: 1, CW: 0, CH: 0, ins: { t: 0, r: 0, b: 0, l: 0 } };

/** Colores del tema leídos de las variables CSS (el canvas no entiende var()). */
export const C: Record<string, string> = {};

export const posterGeo = () => geo(S);
/** Se dibujan el papel y las hojas: hay imágenes o el usuario ya eligió la distribución. */
export const sheetsVisible = () => st.layers.length > 0 || st.sheetsOn;
