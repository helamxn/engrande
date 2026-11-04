/** Atajos de DOM tipados. */
export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`Falta el elemento ${sel}`);
  return el;
}
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T[] =>
  [...root.querySelectorAll<T>(sel)];

export const tick = () => new Promise<void>((r) => setTimeout(r, 0));

let toastT: ReturnType<typeof setTimeout> | undefined;
export interface ToastAction { label: string; fn: () => void }
/** Aviso flotante. ms = 0 lo deja visible (progreso). action: botón opcional dentro del aviso. */
export function toast(msg: string, ms = 3200, action?: ToastAction) {
  const t = $('#toast');
  t.textContent = msg;
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
