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
export const MAX_COLS_ROWS = 8;

/** Archivos que se rechazan para no colgar la pestaña (imágenes "bomba" o PDF enormes). Megapíxeles: ver LIMITS. */
export const MAX_FILE_BYTES = 150 * 1024 * 1024;

export const RATIOS: ReadonlyArray<readonly [string, number | 'orig' | null]> = [
  ['Libre', null], ['Original', 'orig'], ['1:1', 1], ['4:3', 4 / 3], ['3:4', 3 / 4], ['16:9', 16 / 9],
];
