/**
 * Grupos de imágenes (Ctrl+G). Un grupo es solo un número (gid) compartido por sus imágenes; no hay grupos dentro de
 * grupos. Reglas, como en Figma:
 * - Las imágenes de un grupo van seguidas en el orden de capas, a la altura de la que esté más al frente.
 * - Un grupo con menos de dos imágenes deja de existir.
 * Estas funciones no dependen del navegador: se pueden probar sin canvas.
 */

export interface Groupable { gid: number | null; gname?: string }

/**
 * Deja los grupos en regla: quita el grupo a las imágenes que se quedaron solas y junta las de cada grupo
 * (manteniendo su orden relativo) en la posición de la que está más al frente. Devuelve el nuevo orden.
 */
export function normalizeGroups<T extends Groupable>(layers: T[]): T[] {
  const count = new Map<number, number>();
  for (const l of layers) if (l.gid != null) count.set(l.gid, (count.get(l.gid) ?? 0) + 1);
  for (const l of layers) if (l.gid != null && (count.get(l.gid) ?? 0) < 2) { l.gid = null; if (l.gname !== undefined) l.gname = ''; }
  // posición de la imagen más al frente de cada grupo (la última en el orden de dibujo)
  const top = new Map<number, number>();
  layers.forEach((l, i) => { if (l.gid != null) top.set(l.gid, i); });
  const out: T[] = [];
  layers.forEach((l, i) => {
    if (l.gid == null) out.push(l);
    else if (top.get(l.gid) === i) out.push(...layers.filter((x) => x.gid === l.gid));
  });
  return out;
}

/** Siguiente número de grupo libre. */
export const nextGid = (layers: Groupable[]) => layers.reduce((m, l) => Math.max(m, l.gid ?? 0), 0) + 1;

/**
 * Copias (duplicar, pegar, Alt + arrastrar): cada grupo copiado pasa a ser un grupo nuevo, independiente del
 * original. used: las imágenes ya en el póster, para no repetir números.
 */
export function regroupCopies(copies: Groupable[], used: Groupable[]) {
  let next = nextGid([...used, ...copies]);
  const map = new Map<number, number>();
  for (const c of copies) {
    if (c.gid == null) continue;
    if (!map.has(c.gid)) map.set(c.gid, next++);
    c.gid = map.get(c.gid)!;
  }
}
