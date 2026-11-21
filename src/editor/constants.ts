import type { Paper } from './types';

/** Tamaño de papel en mm (vertical). */
export const PAPERS: Record<Paper, readonly [number, number]> = {
  A4: [210, 297],
  A3: [297, 420],
  Carta: [215.9, 279.4],
};

export const PRESETS: ReadonlyArray<readonly [number, number]> = [
  [1, 1], [2, 1], [3, 1], [1, 3], [2, 2], [3, 2], [3, 3], [4, 4],
];

/** Lado máximo del lienzo de trabajo. La exportación usa el archivo original (ver HI_AREA). */
export const MAX_SIDE = 2400;
export const UNDO_MAX = 20;
/** Hojas por lado como máximo (12 × 12 en A4 vertical: unos 2,3 × 3,3 m). */
export const MAX_COLS_ROWS = 12;
/** Medida más pequeña que se puede pedir (mm). */
export const MIN_SIZE = 50;

/** Tamaños de póster habituales (mm, en vertical). */
export const SIZE_PRESETS: ReadonlyArray<readonly [string, number, number]> = [
  ['A2', 420, 594], ['A1', 594, 841], ['A0', 841, 1189], ['50 × 70', 500, 700], ['70 × 100', 700, 1000],
];

/** Archivos que se rechazan para no colgar la pestaña (imágenes "bomba" o PDF enormes). Megapíxeles: ver LIMITS. */
export const MAX_FILE_BYTES = 150 * 1024 * 1024;

export const RATIOS: ReadonlyArray<readonly [string, number | 'orig' | null]> = [
  ['Libre', null], ['Original', 'orig'], ['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9],
];
