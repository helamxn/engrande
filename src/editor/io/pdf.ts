/**
 * Lectura de PDF con pdf.js (≥ 4.2.67: sin el fallo CVE-2024-4367 de ejecución de código).
 * La librería se carga solo cuando el usuario abre un PDF y se sirve desde el propio dominio (sin CDN).
 */
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { MAX_SIDE } from '../constants';
import { LIMITS } from '../platform';

/** Recursos de pdf.js copiados a public/pdfjs por scripts/copy-pdfjs.mjs. */
const ASSETS = '/pdfjs/';

let lib: Promise<typeof import('pdfjs-dist')> | null = null;
function pdfjs() {
  return (lib ??= import('pdfjs-dist').then((m) => {
    m.GlobalWorkerOptions.workerSrc = workerUrl;
    return m;
  }));
}

export async function openPdf(data: ArrayBuffer): Promise<PDFDocumentProxy> {
  const m = await pdfjs();
  return m.getDocument({
    data,
    cMapUrl: ASSETS + 'cmaps/',
    cMapPacked: true,
    standardFontDataUrl: ASSETS + 'standard_fonts/',
    wasmUrl: ASSETS + 'wasm/',
    iccUrl: ASSETS + 'iccs/',
    enableXfa: false,
    // limita las imágenes internas del PDF para que un archivo malicioso no agote la memoria
    maxImageSize: LIMITS.pdfImageSize,
  }).promise;
}

/** Renderiza una página a un canvas cuyo lado mayor es maxSide (sin pasar de maxScale × el tamaño nominal). */
export async function renderPdfPage(doc: PDFDocumentProxy, n: number, maxSide = MAX_SIDE, maxScale = 4) {
  const page = await doc.getPage(n);
  const vp0 = page.getViewport({ scale: 1 });
  const scale = Math.min(maxScale, maxSide / Math.max(vp0.width, vp0.height));
  const vp = page.getViewport({ scale });
  const c = document.createElement('canvas');
  c.width = Math.round(vp.width);
  c.height = Math.round(vp.height);
  // intent 'print': renderiza lo que se imprimiría (anotaciones de impresión incluidas) y no depende de
  // requestAnimationFrame, que el navegador pausa en pestañas en segundo plano (la exportación se quedaba colgada)
  await page.render({ canvas: c, viewport: vp, background: '#ffffff', intent: 'print' }).promise;
  return c;
}
