/** Coma decimal (38,6 cm), como en el resto del texto en español. */
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
/** mm → texto en cm con un decimal. */
export const cm = (mm: number) => nf1.format(mm / 10);
const nf12 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: 1 });
/**
 * Distancia medida (Alt, separación igual): en cm con hasta dos decimales (al menos uno), con la misma precisión a
 * cualquier tamaño (1,08 · 0,98 · 2,0 · 38,6): un hueco pequeño nunca dice «0,0» y cada mm se ve.
 */
export const cmGap = (mm: number) => nf12.format(mm / 10);
/** Por debajo de esto (mm) dos bordes se tocan: no se dibuja ninguna distancia. */
export const TOUCH_MM = 0.05;
/** Número con como mucho un decimal y coma decimal, para los campos de entrada (14,3). */
export const fmt1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');
/** Lee lo escrito en un campo: acepta coma o punto decimal y espacios («14,3», «14.3», « 14 »). */
export const parseNum = (s: string) => parseFloat(s.trim().replace(/\s+/g, '').replace(',', '.'));
