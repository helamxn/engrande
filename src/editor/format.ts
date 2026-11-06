/** Coma decimal (38,6 cm), como en el resto del texto en español. */
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
/** mm → texto en cm con un decimal. */
export const cm = (mm: number) => nf1.format(mm / 10);
const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
/**
 * Distancia medida (Alt, separación igual) en cm, con la misma precisión que el resto (un decimal = mm entero:
 * 1,0 · 1,3 · 38,6). Las posiciones van en mm enteros (ver GRID_MM), así que casi siempre es exacta. Si no cae en un
 * mm entero (alineada con algo en décimas, alto fraccionario por la proporción) se ven dos decimales (1,08 · 2,05):
 * avisa de que esa medida no es redonda y un hueco pequeño nunca dice «0,0».
 */
export const cmGap = (mm: number) => {
  const r = Math.round(mm);
  return Math.abs(mm - r) < 0.05 ? nf1.format(r / 10) : nf2.format(mm / 10);
};
/** Por debajo de esto (mm) dos bordes se tocan: no se dibuja ninguna distancia. */
export const TOUCH_MM = 0.05;
/** Número con como mucho un decimal y coma decimal, para los campos de entrada (14,3). */
export const fmt1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');
/** Lee lo escrito en un campo: acepta coma o punto decimal y espacios («14,3», «14.3», « 14 »). */
export const parseNum = (s: string) => parseFloat(s.trim().replace(/\s+/g, '').replace(',', '.'));
