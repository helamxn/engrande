/** Detección de plataforma, etiquetas de atajos y límites de memoria según el dispositivo. */

const nav = typeof navigator !== 'undefined' ? navigator : undefined;
const mm = (q: string) => (typeof matchMedia !== 'undefined' ? matchMedia(q) : null);

export const isMac = /Mac|iPhone|iPad/.test(nav?.platform ?? '');
export const MOD = isMac ? '⌘' : 'Ctrl+';
export const ALT = isMac ? '⌥' : 'Alt';
export const SHIFT = isMac ? '⇧' : 'Shift+';
export const DELK = isMac ? '⌫' : 'Supr';

export const coarseMQ = mm('(pointer: coarse)');
/** Escritorio (breakpoint desk de Tailwind): el lienzo ocupa la ventana y el resto flota encima. */
export const deskMQ = mm('(min-width: 60rem)');
/** Barra contextual acoplada abajo del lienzo (móvil o pantalla táctil). */
export const dockMQ = mm('(max-width: 700px), (pointer: coarse)');

let lastPointer = 'mouse';
export const setLastPointer = (t: string) => { lastPointer = t; };
export const lastPointerType = () => lastPointer;
export const isTouch = () => !!coarseMQ?.matches || lastPointer === 'touch';

const coarse = !!coarseMQ?.matches;
/** Área máxima (px) de cada imagen en alta resolución al exportar. */
export const HI_AREA = coarse ? 16e6 : 36e6;
/** Área máxima (px) del PDF de una sola hoja grande. */
export const SINGLE_AREA = coarse ? 16e6 : 40e6;
/** Presupuesto de memoria (bytes) de los lienzos retenidos por el historial. */
export const PIX_BUDGET = coarse ? 160e6 : 480e6;
