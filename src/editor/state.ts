/** Estado compartido del editor. Un único objeto mutable: lo leen el render, la interfaz y la entrada. */
import { geo } from './geometry';
import type { Layer, LayoutSettings, Pt, Settings } from './types';

/** Ajustes de un póster nuevo (los que se guardan y se restablecen con "Nuevo póster"). */
export const DEFAULT_LAYOUT: LayoutSettings = { paper: 'A4', orient: 'portrait', cols: 2, rows: 1, margin: 6, overlap: 10 };
export const DEFAULT_EXPORT: Pick<Settings, 'dpi' | 'marks' | 'guide'> = { dpi: 150, marks: true, guide: true };

export const S: Settings = {
  ...DEFAULT_LAYOUT, ...DEFAULT_EXPORT,
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
  /** Recuadro de selección mientras se arrastra (px de pantalla). */
  marquee: null as { a: Pt; b: Pt } | null,
  nextId: 1,
  /** Imágenes copiadas con Ctrl+C dentro de Pliego, y cuántas veces se pegaron (cada pegado se desplaza un poco más). */
  clip: null as Layer[] | null,
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
