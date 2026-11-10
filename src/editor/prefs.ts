/**
 * Preferencias de este navegador (localStorage): comodidades de la interfaz, nada imprescindible.
 * El almacenamiento puede no estar disponible (navegación privada, permisos): entonces no se recuerda nada.
 */
// Clave histórica: conserva margen, panel y redistribución de las versiones anteriores.
const PREFIX = 'pliego.';

export function getPref(key: string): string | null {
  try { return localStorage.getItem(PREFIX + key); } catch { return null; }
}
/**
 * Margen sin imprimir de la impresora de este navegador (mm): el último que se eligió, para cada póster nuevo.
 * Sin guardar o fuera de rango, null (se usa el de siempre).
 */
export function savedMargin(): number | null {
  const v = Number(getPref('margin'));
  return getPref('margin') !== null && Number.isInteger(v) && v >= 0 && v <= 15 ? v : null;
}
export function setPref(key: string, value: string) {
  try { localStorage.setItem(PREFIX + key, value); } catch { /* sin almacenamiento */ }
}
