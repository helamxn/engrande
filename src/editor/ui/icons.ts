/** Iconos SVG (constantes del código, nunca datos del usuario: es seguro usarlos con innerHTML). */
const svg = (body: string, extra = '') =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${body}</svg>`;

export const ICON = {
  up: svg('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down: svg('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  dup: svg('<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 00-2-2H5a2 2 0 00-2 2v9a2 2 0 002 2h3"/>'),
  del: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  crop: svg('<path d="M6 2v14a2 2 0 002 2h14"/><path d="M2 6h14a2 2 0 012 2v14"/>'),
  bg: svg('<circle cx="12" cy="9" r="4"/><path d="M5 21c1-4 4-6 7-6s6 2 7 6"/><path d="M3 3l2 2M21 3l-2 2" stroke-dasharray="2 2"/>'),
  erase: svg('<path d="M20 20H9L3.5 14.5a2 2 0 010-2.8l8.7-8.7a2 2 0 012.8 0l5 5a2 2 0 010 2.8L12 18.8"/><path d="M7 10l7 7"/>'),
  restore: svg('<path d="M18 2l4 4-11 11H7v-4z"/><path d="M7 17c-2 0-4 1.5-4 5 3 0 5-1 5-4"/>'),
  wand: svg('<path d="M4 20L15 9M13 7l4 4"/><path d="M18 2v3M21.5 5.5L19.4 7.6M22 11h-3M14 2.5l1.1 2"/>'),
  rot: svg('<path d="M21 12a9 9 0 11-3-6.7L21 8"/><path d="M21 3v5h-5"/>'),
  flip: svg('<path d="M12 3v18"/><path d="M8 7L3 17h5zM16 7l5 10h-5z"/>'),
  more: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>',
  check: svg('<path d="M5 12l5 5L20 7"/>', ' stroke-width="2.4"'),
  x: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
} as const;
export type IconName = keyof typeof ICON;
