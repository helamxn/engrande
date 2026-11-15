/** Límites de entrada y conversiones compartidos por el panel y el editor. */
export const MAX_TEXT_LENGTH = 10_000;
export const DEFAULT_TEXT_COLOR = '#111111';
export const MM_PER_PT = 25.4 / 72;
/** Tamaño de letra de un texto nuevo (hasta que se use otro): un título que se lee a un metro. */
export const DEFAULT_TEXT_PT = 96;

export function normalizeColor(value: string): string | null {
  const hex = value.trim().replace(/^#/, '');
  if (/^[0-9a-f]{6}$/i.test(hex)) return '#' + hex.toLowerCase();
  if (/^[0-9a-f]{3}$/i.test(hex)) return '#' + [...hex].map(c => c + c).join('').toLowerCase();
  return null;
}
