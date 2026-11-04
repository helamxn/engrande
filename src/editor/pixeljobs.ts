/**
 * Cliente del worker de píxeles. Si el navegador no puede crear el worker (o falla), la tarea se hace
 * en la propia página con el mismo código: más lenta para la interfaz, pero con el mismo resultado.
 */
import { runPixelJob, type PixelJob, type PixelResult } from './pixels';

interface Pending { resolve: (r: PixelResult & { data: Uint8ClampedArray }) => void; reject: (e: Error) => void }

let worker: Worker | null = null;
let broken = false;
let seq = 0;
const pending = new Map<number, Pending>();

function getWorker(): Worker | null {
  if (worker || broken) return worker;
  try {
    worker = new Worker(new URL('./workers/pixels.worker.ts', import.meta.url), { type: 'module' });
    worker.addEventListener('message', (e: MessageEvent<{ id: number; buf: ArrayBuffer } & PixelResult>) => {
      const p = pending.get(e.data.id);
      pending.delete(e.data.id);
      p?.resolve({ removed: e.data.removed, error: e.data.error, data: new Uint8ClampedArray(e.data.buf) });
    });
    worker.addEventListener('error', () => {
      // a partir de ahora, en la página; las tareas en curso se repiten allí (los datos se transfirieron)
      broken = true;
      worker?.terminate();
      worker = null;
      for (const p of pending.values()) p.reject(new Error('El worker de píxeles falló'));
      pending.clear();
    });
  } catch {
    broken = true;
    worker = null;
  }
  return worker;
}

/**
 * Ejecuta la tarea sobre una copia de los datos del lienzo y devuelve los datos resultantes.
 * readData se llama cada vez que hace falta leerlos (otra vez si el worker falla a mitad).
 */
export async function runJob(readData: () => ImageData, job: PixelJob): Promise<PixelResult & { data: Uint8ClampedArray; w: number; h: number }> {
  const img = readData();
  const { width: w, height: h } = img;
  const wk = getWorker();
  if (wk) {
    try {
      const r = await new Promise<PixelResult & { data: Uint8ClampedArray }>((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        wk.postMessage({ id, buf: img.data.buffer, w, h, job }, [img.data.buffer]);
      });
      return { ...r, w, h };
    } catch { /* el worker falló: se repite en la página */ }
  }
  const again = broken ? readData() : img;
  const r = runPixelJob(again.data, w, h, job);
  return { ...r, data: again.data, w, h };
}
