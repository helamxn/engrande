/**
 * Archivo de proyecto (.engrande): el póster entero en un solo archivo, para guardar una copia, seguir en otro equipo
 * o no depender del almacenamiento del navegador. Es lo mismo que se guarda en IndexedDB (ver persist.ts).
 *
 * Formato, sin librerías ni base64 (los archivos van tal cual):
 *   «ENGRANDE» + versión (1 byte) + longitud de la cabecera (uint32, little endian)
 *   cabecera JSON en UTF-8: { project, files: [{ key, type, size }] }
 *   los archivos, uno detrás de otro, en el orden de la cabecera
 *
 * Un archivo de proyecto puede venir de cualquiera: aquí se comprueba su forma (tamaños, claves, tipos) y persist.ts
 * valida cada valor del proyecto al reconstruirlo. Este módulo es puro (sin DOM).
 */
const MAGIC = 'ENGRANDE';
const VERSION = 1;
export const PROJECT_EXT = '.engrande';
export const PROJECT_TYPE = 'application/x-engrande';
/** Límites: un proyecto real se queda muy lejos; un archivo malicioso no puede pedir más memoria que esto. */
const MAX_HEADER = 32 * 1024 * 1024;
const MAX_FILES = 1000;
export const MAX_PROJECT_BYTES = 1024 * 1024 * 1024;
/** Claves que escribe persist.ts: archivos originales (src-) y lienzos editados (px-). */
const KEY = /^(src|px)-[A-Za-z0-9_-]{1,64}$/;
const TYPE = /^(image\/[a-z0-9.+-]{1,40}|application\/pdf|)$/;

export class ProjectFileError extends Error {}

export interface ProjectData<P = unknown> { project: P; files: Map<string, Blob> }

/** ¿Es un archivo de proyecto? (por la extensión o por los primeros bytes). */
export const isProjectName = (name: string) => name.toLowerCase().endsWith(PROJECT_EXT);

export function packProject(project: unknown, files: Map<string, Blob>): Blob {
  const list = [...files].map(([key, b]) => ({ key, type: b.type, size: b.size }));
  const head = new TextEncoder().encode(JSON.stringify({ project, files: list }));
  const pre = new Uint8Array(MAGIC.length + 5);
  pre.set(new TextEncoder().encode(MAGIC), 0);
  pre[MAGIC.length] = VERSION;
  new DataView(pre.buffer).setUint32(MAGIC.length + 1, head.length, true);
  return new Blob([pre, head, ...files.values()], { type: PROJECT_TYPE });
}

export function unpackProject(buf: ArrayBuffer): ProjectData {
  const bytes = new Uint8Array(buf), pre = MAGIC.length + 5;
  if (bytes.length < pre || new TextDecoder().decode(bytes.subarray(0, MAGIC.length)) !== MAGIC) {
    throw new ProjectFileError('No es un proyecto de engrande.');
  }
  if (bytes[MAGIC.length] !== VERSION) throw new ProjectFileError('Este proyecto es de una versión más nueva de engrande.');
  const len = new DataView(buf).getUint32(MAGIC.length + 1, true);
  if (len > MAX_HEADER || pre + len > bytes.length) throw new ProjectFileError('El proyecto está dañado.');
  let head: { project?: unknown; files?: unknown };
  try { head = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(pre, pre + len))); } catch {
    throw new ProjectFileError('El proyecto está dañado.');
  }
  if (!head || typeof head !== 'object' || !head.project || typeof head.project !== 'object' || !Array.isArray(head.files) || head.files.length > MAX_FILES) {
    throw new ProjectFileError('El proyecto está dañado.');
  }
  const files = new Map<string, Blob>();
  let at = pre + len;
  for (const f of head.files as { key?: unknown; type?: unknown; size?: unknown }[]) {
    if (!f || typeof f.key !== 'string' || !KEY.test(f.key) || typeof f.type !== 'string' || !TYPE.test(f.type)
      || !Number.isSafeInteger(f.size) || (f.size as number) < 0 || at + (f.size as number) > bytes.length || files.has(f.key)) {
      throw new ProjectFileError('El proyecto está dañado.');
    }
    files.set(f.key, new Blob([bytes.slice(at, at + (f.size as number))], { type: f.type }));
    at += f.size as number;
  }
  return { project: head.project, files };
}
