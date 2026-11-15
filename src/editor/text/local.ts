/** Enumera metadatos del equipo con el permiso del navegador; no lee los archivos hasta elegir una variante. */
export interface LocalFace {
  family: string;
  fullName: string;
  postscriptName: string;
  style: string;
  blob(): Promise<Blob>;
}
type LocalWindow = Window & { queryLocalFonts?: () => Promise<LocalFace[]> };
export type LocalState = 'unsupported' | 'prompt' | 'loading' | 'ready' | 'denied' | 'interaction' | 'error';
const faces = new Map<string, LocalFace>();
let state: LocalState = typeof window !== 'undefined' && window.isSecureContext && typeof (window as LocalWindow).queryLocalFonts === 'function' ? 'prompt' : 'unsupported';
let changed = () => {};
let ready: Promise<void> = Promise.resolve();
let pending: Promise<boolean> | null = null;
let permitted = false;

export const localState = () => state;
export const localFaces = () => [...faces.entries()];
export const localFace = (id: string) => faces.get(id);
export const localReady = () => ready;

/** La consulta en curso empezó con un gesto del usuario (si no, el navegador puede dejarla esperando). */
let pendingWithGesture = false;
let token = 0;
const hasGesture = () => !!(navigator as Navigator & { userActivation?: { isActive: boolean } }).userActivation?.isActive;

/** force: repetir la consulta aunque haya una en curso (la anterior empezó sin gesto y puede no terminar nunca). */
export function requestLocalFonts(force = false): Promise<boolean> {
  if (pending && !force) return pending;
  const query = typeof window === 'undefined' ? undefined : (window as LocalWindow).queryLocalFonts;
  if (!query || state === 'unsupported') return Promise.resolve(false);
  // Invocar antes de cualquier await conserva la activación del clic que autoriza el acceso.
  state = 'loading'; changed();
  const mine = ++token;
  pendingWithGesture = hasGesture();
  pending = query.call(window).then(result => {
    if (mine !== token) return state === 'ready'; // ya respondió otra consulta más reciente
    faces.clear();
    for (const face of result) if (face.postscriptName && face.family) faces.set('l:' + face.postscriptName, face);
    state = 'ready'; changed(); return true;
  }).catch(error => {
    if (mine !== token) return false;
    state = error instanceof DOMException && error.name === 'NotAllowedError' ? 'denied'
      : error instanceof DOMException && error.name === 'SecurityError' ? 'interaction' : 'error';
    faces.clear(); changed(); return false;
  }).finally(() => { if (mine === token) pending = null; });
  return pending;
}

/**
 * Las fuentes del equipo salen por defecto: la primera vez se piden con un gesto del usuario (agregar un texto, abrir
 * la lista de fuentes o el botón de un aviso), que es cuando el navegador deja preguntar. Si ya se concedieron, se
 * leen al abrir la app; si se negaron, no se vuelve a preguntar.
 */
export function askLocalFonts() {
  if (state === 'prompt' || state === 'interaction') void requestLocalFonts();
  // la lectura del arranque (permiso ya dado) no tenía gesto y sigue esperando: se repite con este
  else if (state === 'loading' && !pendingWithGesture && hasGesture()) void requestLocalFonts(true);
}

/** El arranque consulta el permiso sin solicitarlo. Solo enumera automáticamente si ya estaba concedido. */
export function initLocalFonts(onChange: () => void) {
  changed = onChange;
  if (state === 'unsupported') { changed(); return; }
  // con permiso, cualquier gesto vale para leerlas si al abrir no se pudo (o la lectura se quedó esperando)
  const retry = () => { if (permitted) askLocalFonts(); };
  document.addEventListener('pointerdown', retry, true);
  document.addEventListener('keydown', retry, true);
  ready = (async () => {
    try {
      const permission = await navigator.permissions.query({ name: 'local-fonts' as PermissionName });
      const update = async () => {
        permitted = permission.state === 'granted';
        if (permitted) await requestLocalFonts();
        else { faces.clear(); state = permission.state === 'denied' ? 'denied' : 'prompt'; changed(); }
      };
      permission.addEventListener('change', () => { void update(); });
      await update();
    } catch { state = 'prompt'; changed(); }
  })();
}
