/** Atajos de DOM tipados. */
export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Falta el elemento ${sel}`);
  return el;
}
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] =>
  [...root.querySelectorAll<T>(sel)];

export const tick = () => new Promise<void>((r) => setTimeout(r, 0));

/**
 * Libera la memoria de un lienzo que ya no se va a usar. Con tamaño 0 el navegador la devuelve al momento;
 * Safari, si no, la retiene hasta que pasa el recolector de basura y puede alcanzar su límite de canvas.
 */
export const freeCanvas = (c: HTMLCanvasElement) => { c.width = 0; c.height = 0; };

let toastT: ReturnType<typeof setTimeout> | undefined;
export interface ToastAction { label: string; fn: () => void }
/** Aviso flotante. msg: texto o nodos (p. ej. con teclas, ver ui/keys.ts). ms = 0 lo deja visible (progreso). action: botón opcional dentro del aviso. */
export function toast(msg: string | Node, ms = 3200, action?: ToastAction) {
  const t = $('#toast');
  t.replaceChildren(msg);
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'ml-3 cursor-pointer border-0 bg-transparent p-0 font-bold text-inherit underline underline-offset-2';
    b.textContent = action.label;
    b.addEventListener('click', () => { t.hidden = true; action.fn(); });
    t.appendChild(b);
  }
  t.hidden = false;
  clearTimeout(toastT);
  if (ms) toastT = setTimeout(() => (t.hidden = true), ms);
}
export const hideToast = () => { $('#toast').hidden = true; };
