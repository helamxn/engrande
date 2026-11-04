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
/** Aviso flotante. ms = 0 lo deja visible (progreso). */
export function toast(msg: string, ms = 3200) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toastT);
  if (ms) toastT = setTimeout(() => (t.hidden = true), ms);
}
export const hideToast = () => { $('#toast').hidden = true; };
