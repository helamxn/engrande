/**
 * Grupos de imágenes (Ctrl+G), también unos dentro de otros. Cada imagen guarda su cadena de grupos (gpath), del
 * más externo al más interno; cada grupo es un número y un nombre («Grupo 1», «Grupo 2»… o el que se le dé).
 * Reglas, como en Figma:
 * - Las imágenes de un grupo van seguidas en el orden de capas, a la altura de la que esté más al frente (y lo
 *   mismo dentro de cada grupo con sus subgrupos).
 * - Un grupo con menos de dos elementos (imágenes o subgrupos) deja de existir.
 * - Clic: lo de más arriba del nivel en el que se está; doble clic: un nivel más adentro; Esc: un nivel más afuera.
 * Estas funciones no dependen del navegador: se pueden probar sin canvas.
 */

export interface GroupRef { id: number; name: string }
export interface Groupable { gpath: GroupRef[] }

/** Nombre de un grupo nuevo: «Grupo N», con N uno más que el mayor en uso. */
export const GROUP_BASE = 'Grupo';
export function nextGroupName(layers: Groupable[]): string {
  let n = 0;
  for (const l of layers) for (const g of l.gpath) {
    const m = new RegExp(`^${GROUP_BASE} (\\d+)$`).exec(g.name);
    if (m) n = Math.max(n, Number(m[1]));
  }
  return `${GROUP_BASE} ${n + 1}`;
}

/** Siguiente número de grupo libre. */
export const nextGid = (layers: Groupable[]) => layers.reduce((m, l) => Math.max(m, ...l.gpath.map((g) => g.id)), 0) + 1;

/** La imagen está en el grupo id (a cualquier profundidad). */
export const inGroup = (l: Groupable, id: number) => l.gpath.some((g) => g.id === id);
/** Imágenes del grupo id (a cualquier profundidad), en el orden de layers. */
export const membersOf = <T extends Groupable>(layers: T[], id: number) => layers.filter((l) => inGroup(l, id));
/** El grupo id, tal como lo guarda alguna de sus imágenes (para su nombre). */
export const findGroup = (layers: Groupable[], id: number) => {
  for (const l of layers) { const g = l.gpath.find((x) => x.id === id); if (g) return g; }
  return null;
};

/**
 * Lo que cuelga de scope (null = el póster) en el camino hacia l: el número del grupo hijo o null si es la propia
 * imagen. undefined si l no está dentro de scope.
 */
export function childOf(l: Groupable, scope: number | null): number | null | undefined {
  if (scope == null) return l.gpath[0]?.id ?? null;
  const i = l.gpath.findIndex((g) => g.id === scope);
  if (i < 0) return undefined;
  return l.gpath[i + 1]?.id ?? null;
}
/** Elemento al que pertenece l visto desde scope: su grupo hijo de scope entero, o solo l. */
export function unitAt<T extends Groupable>(layers: T[], l: T, scope: number | null): T[] {
  const c = childOf(l, scope);
  return c == null ? [l] : membersOf(layers, c);
}
/** Grupos que comparten todas (del más externo al más interno). */
export function commonPath(ls: Groupable[]): GroupRef[] {
  if (!ls.length) return [];
  const out: GroupRef[] = [];
  for (let i = 0; ; i++) {
    const g = ls[0]!.gpath[i];
    if (!g || ls.some((l) => l.gpath[i]?.id !== g.id)) return out;
    out.push(g);
  }
}
/**
 * El grupo cuyas imágenes son exactamente ls (solo cuentan las que cumplen ok: en el lienzo no se seleccionan las
 * ocultas ni las bloqueadas). null si ls no es un grupo entero.
 */
export function groupOf<T extends Groupable>(layers: T[], ls: T[], ok: (l: T) => boolean = () => true): number | null {
  if (ls.length < 2) return null;
  const p = commonPath(ls);
  for (let k = p.length - 1; k >= 0; k--) {
    const m = membersOf(layers, p[k]!.id).filter(ok);
    if (m.length === ls.length && ls.every((l) => m.includes(l))) return p[k]!.id;
  }
  return null;
}
/**
 * Nivel en el que se está con esta selección (el grupo «abierto»; null = el póster): con un grupo entero
 * seleccionado, el que lo contiene; si no, el más interno que contiene a toda la selección.
 */
export function scopeOf<T extends Groupable>(layers: T[], ls: T[], ok?: (l: T) => boolean): number | null {
  if (!ls.length) return null;
  const p = commonPath(ls), g = groupOf(layers, ls, ok);
  if (g != null) { const i = p.findIndex((x) => x.id === g); return i > 0 ? p[i - 1]!.id : null; }
  return p.at(-1)?.id ?? null;
}

/**
 * Deja los grupos en regla: deshace los que tienen menos de dos elementos (sus imágenes pasan al grupo de fuera) y
 * junta las de cada grupo (manteniendo su orden relativo) en la posición de la que está más al frente, en cada
 * nivel. Devuelve el nuevo orden.
 */
export function normalizeGroups<T extends Groupable>(layers: T[]): T[] {
  for (let changed = true; changed;) {
    changed = false;
    const ids = new Set(layers.flatMap((l) => l.gpath.map((g) => g.id)));
    for (const id of ids) {
      const kids = new Set<unknown>();
      for (const l of layers) { const c = childOf(l, id); if (c !== undefined) kids.add(c ?? l); }
      if (kids.size >= 2) continue;
      for (const l of layers) l.gpath = l.gpath.filter((g) => g.id !== id);
      changed = true;
    }
  }
  const arrange = (ls: T[], depth: number): T[] => {
    // posición de la imagen más al frente de cada grupo de este nivel (la última en el orden de dibujo)
    const top = new Map<number, number>();
    ls.forEach((l, i) => { const g = l.gpath[depth]; if (g) top.set(g.id, i); });
    const out: T[] = [];
    ls.forEach((l, i) => {
      const g = l.gpath[depth];
      if (!g) out.push(l);
      else if (top.get(g.id) === i) out.push(...arrange(ls.filter((x) => x.gpath[depth]?.id === g.id), depth + 1));
    });
    return out;
  };
  return arrange(layers, 0);
}

/**
 * Para copiar: de la cadena de cada original, los grupos que se copian enteros (todas sus imágenes están entre los
 * originales; siempre son los de dentro) y los de alrededor (keep), donde se quedan las copias.
 */
export function splitPaths(originals: Groupable[], all: Groupable[]): { keep: GroupRef[]; whole: GroupRef[] }[] {
  const set = new Set(originals);
  const isWhole = new Map<number, boolean>();
  const whole = (id: number) => {
    if (!isWhole.has(id)) isWhole.set(id, all.filter((l) => inGroup(l, id)).every((l) => set.has(l)));
    return isWhole.get(id)!;
  };
  return originals.map((o) => {
    const i = o.gpath.findIndex((g) => whole(g.id)), k = i < 0 ? o.gpath.length : i;
    return { keep: o.gpath.slice(0, k), whole: o.gpath.slice(k) };
  });
}
/**
 * Los grupos copiados enteros pasan a ser grupos nuevos, independientes del original (con el mismo nombre, como en
 * Figma). used: las imágenes ya en el póster, para no repetir números. Devuelve las cadenas con los números nuevos.
 */
export function freshGroups(paths: GroupRef[][], used: Groupable[]): GroupRef[][] {
  let next = nextGid(used);
  for (const p of paths) for (const g of p) next = Math.max(next, g.id + 1);
  const map = new Map<number, number>();
  return paths.map((p) => p.map((g) => {
    if (!map.has(g.id)) map.set(g.id, next++);
    return { id: map.get(g.id)!, name: g.name };
  }));
}
/** Copia de una cadena de grupos (cada imagen tiene la suya: cambiar el nombre en una no toca las demás). */
export const clonePath = (p: GroupRef[]) => p.map((g) => ({ ...g }));
/** ¿Existe aún esta cadena de grupos en el póster? (para pegar dentro del grupo del que se copió) */
export const pathExists = (layers: Groupable[], p: GroupRef[]) =>
  !p.length || layers.some((l) => p.every((g, i) => l.gpath[i]?.id === g.id));
