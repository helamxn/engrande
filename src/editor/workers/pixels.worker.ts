/**
 * Worker de píxeles: quita el fondo o el color de la varita fuera del hilo principal, para que la página
 * no se congele mientras procesa (en 2400 px tardaba unos 270 ms bloqueando la interfaz).
 * Recibe los datos RGBA transferidos (sin copiarlos) y los devuelve igual.
 */
import { runPixelJob, type PixelJob } from '../pixels';

interface Request { id: number; buf: ArrayBuffer; w: number; h: number; job: PixelJob }

addEventListener('message', (e: MessageEvent<Request>) => {
  const { id, buf, w, h, job } = e.data;
  const d = new Uint8ClampedArray(buf);
  const result = runPixelJob(d, w, h, job);
  postMessage({ id, buf: d.buffer, ...result }, { transfer: [d.buffer] });
});
