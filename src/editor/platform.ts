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

export interface MemoryLimits {
  /** Área máxima (px) de cada imagen en alta resolución al exportar. */
  hiArea: number;
  /** Área máxima (px) del PDF de una sola hoja grande. */
  singleArea: number;
  /** Presupuesto de memoria (bytes) de los lienzos retenidos por el historial. */
  pixBudget: number;
  /** Megapíxeles máximos de una imagen al abrirla (decodificarla ocupa 4 bytes por píxel). */
  maxImagePixels: number;
  /** Tamaño máximo (px) de las imágenes dentro de un PDF que pdf.js llega a decodificar. */
  pdfImageSize: number;
}

/**
 * Límites de memoria según la RAM del equipo. navigator.deviceMemory (Chrome, Edge, Android) da los GB
 * redondeados y con tope en 8 por privacidad; Safari y Firefox no lo dan, y entonces se decide por el tipo de
 * pantalla: táctil suele ser un móvil o tableta con menos memoria. Con 8 GB o más se usan los límites de escritorio.
 */
export function memoryLimits(deviceMemory: number | undefined, coarsePointer: boolean): MemoryLimits {
  const tier = typeof deviceMemory === 'number' && deviceMemory > 0
    ? (deviceMemory <= 2 ? 'low' : deviceMemory < 8 ? 'mid' : 'high')
    : (coarsePointer ? 'mid' : 'high');
  switch (tier) {
    case 'low': return { hiArea: 10e6, singleArea: 10e6, pixBudget: 96e6, maxImagePixels: 60e6, pdfImageSize: 24e6 };
    case 'mid': return { hiArea: 16e6, singleArea: 16e6, pixBudget: 160e6, maxImagePixels: 120e6, pdfImageSize: 40e6 };
    default: return { hiArea: 36e6, singleArea: 40e6, pixBudget: 480e6, maxImagePixels: 200e6, pdfImageSize: 64e6 };
  }
}

const deviceMemory = (nav as (Navigator & { deviceMemory?: number }) | undefined)?.deviceMemory;
export const LIMITS = memoryLimits(deviceMemory, !!coarseMQ?.matches);
export const HI_AREA = LIMITS.hiArea;
export const SINGLE_AREA = LIMITS.singleArea;
export const PIX_BUDGET = LIMITS.pixBudget;
