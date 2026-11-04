/**
 * Preferencias de este navegador (localStorage): comodidades de la interfaz, nada imprescindible.
 * El almacenamiento puede no estar disponible (navegación privada, permisos): entonces no se recuerda nada.
 */
const PREFIX = 'pliego.';

export function getPref(key: string): string | null {
  try { return localStorage.getItem(PREFIX + key); } catch { return null; }
}
export function setPref(key: string, value: string) {
  try { localStorage.setItem(PREFIX + key, value); } catch { /* sin almacenamiento */ }
}
