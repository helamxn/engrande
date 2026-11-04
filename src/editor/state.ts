/** Estado compartido del editor. Un único objeto mutable: lo leen el render, la interfaz y la entrada. */
import { geo } from './geometry';
import type { Layer, Pt, Settings } from './types';

export const S: Settings = {
  paper: 'A4', orient: 'portrait', cols: 2, rows: 2, margin: 6, overlap: 10, marks: true, guide: true, dpi: 150,
  mode: 'move', brush: 24, brushMode: 'erase', tol: 40, contig: true, cropRatio: null, cropRatioKey: 'null', lock: true,
};

export const st = {
  layers: [] as Layer[],
  sel: null as Layer | null,
  nextId: 1,
  /** Imagen copiada con Ctrl+C dentro de Pliego. */
  clip: null as Layer | null,
  /** Posición del puntero (círculo del pincel). */
  hover: null as Pt | null,
  /** Imagen bajo el ratón (se resalta). */
  hoverL: null as Layer | null,
};

/** Vista: escala (px por mm) y desplazamiento del lienzo. */
export const V = { k: 1, ox: 0, oy: 0, fitted: true };

/** Tamaño del lienzo en px CSS y densidad de píxeles. */
export const view = { dpr: 1, CW: 0, CH: 0 };

/** Colores del tema leídos de las variables CSS (el canvas no entiende var()). */
export const C: Record<string, string> = {};

export const posterGeo = () => geo(S);
