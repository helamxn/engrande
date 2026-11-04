const nf1 = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
/** mm → texto en cm con un decimal. */
export const cm = (mm: number) => nf1.format(mm / 10);
/** Número con como mucho un decimal, para los campos de entrada. */
export const fmt1 = (v: number) => (Math.round(v * 10) / 10).toString();
