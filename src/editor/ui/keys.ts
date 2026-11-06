/**
 * Teclas con el mismo aspecto en toda la app: cada tecla es un <kbd> (estilo global en global.css) y los gestos
 * («Doble clic») van como texto. En Mac se usan sus símbolos (⌘ ⇧ ⌥) y las teclas van juntas, como en el sistema;
 * en Windows y Linux, unidas con «+».
 *
 * Se escriben con nombres: k('mod+shift+g') → Ctrl + Shift + G (⌘⇧G en Mac). En un texto, entre llaves:
 * rich('{esc}: deseleccionar'); varias alternativas con «|»: '{alt+↑|alt+↓}'.
 */
import { DELK, isMac } from '../platform';

/** Parte de una combinación: una tecla (texto) o un gesto ({ t }). */
export type Part = string | { t: string };
export const gesture = (t: string): Part => ({ t });

const NAMES: Record<string, string> = {
  mod: isMac ? '⌘' : 'Ctrl', alt: isMac ? '⌥' : 'Alt', shift: isMac ? '⇧' : 'Shift',
  del: DELK, esc: 'Esc', enter: 'Enter', space: 'Espacio',
};
/** Nombre que se muestra de una tecla: los nombres de NAMES según la plataforma; las letras, en mayúscula. */
export const key = (name: string) => NAMES[name.toLowerCase()] ?? (name.length === 1 ? name.toUpperCase() : name);
/** 'mod+shift+g' → teclas que se pulsan juntas. «+» sola es la tecla +. */
export const k = (spec: string): Part[] => (spec === '+' ? ['+'] : spec.split('+').map(key));

/** Combinaciones alternativas, separadas por «o». */
export function keysEl(combos: Part[][]): HTMLSpanElement {
  const wrap = document.createElement('span');
  wrap.className = 'keys';
  combos.forEach((combo, i) => {
    const span = document.createElement('span');
    span.className = 'combo';
    // la «o» va pegada a la alternativa que sigue: si no cabe en una línea, baja con ella
    if (i) { const o = document.createElement('span'); o.className = 'or'; o.textContent = 'o'; span.appendChild(o); }
    combo.forEach((p, j) => {
      const prev = combo[j - 1];
      if (j && !(isMac && typeof p === 'string' && typeof prev === 'string')) span.append('+');
      if (typeof p === 'string') { const kb = document.createElement('kbd'); kb.textContent = p; span.appendChild(kb); }
      else { const g = document.createElement('span'); g.className = 'gest'; g.textContent = p.t; span.appendChild(g); }
    });
    wrap.appendChild(span);
  });
  return wrap;
}

/** Teclas de una especificación con alternativas: 'alt+↑|alt+↓'. */
export const keysOf = (spec: string) => keysEl(spec.split('|').map(k));

/**
 * Texto con teclas entre llaves: '{esc}: deseleccionar'. Solo para textos del código: un nombre de archivo o de
 * grupo con llaves se mostraría como teclas, así que esos van aparte, como texto.
 */
export function rich(text: string): DocumentFragment {
  const f = document.createDocumentFragment();
  text.split(/\{([^}]+)\}/).forEach((s, i) => { if (i % 2) f.appendChild(keysOf(s)); else if (s) f.append(s); });
  return f;
}

/** Rellena con teclas los elementos del marcado que las piden: <span data-keys="alt+↑|alt+↓"></span>. */
export function hydrateKeys(root: ParentNode = document) {
  for (const el of root.querySelectorAll<HTMLElement>('[data-keys]')) el.replaceChildren(keysOf(el.dataset.keys!));
}
