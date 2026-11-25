/** Carga de imágenes y PDF: selector de archivos, arrastrar y soltar en toda la página y pegar. */
import { addLayer, applyCrop, makeCanvas, newLayer } from '../actions';
import { MAX_FILE_BYTES, MAX_SIDE } from '../constants';
import { LIMITS } from '../platform';
import { $, hideToast, toast } from '../dom';
import { snap } from '../history';
import { S, st } from '../state';
import { openPdf, renderPdfPage } from './pdf';
import type { Layer } from '../types';
import { isFontFile } from '../text/fonts';
import { loadFonts } from '../text/textpanel';

/**
 * Se espera al evento load y no a img.decode(): decode() no se resuelve mientras la pestaña está en segundo plano.
 * Las dimensiones se conocen en load, antes de decodificar, así que se pueden rechazar imágenes gigantes a tiempo.
 */
export const loadImg = (url: string) =>
  new Promise<HTMLImageElement>((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => rej(new Error('Imagen no válida'));
    im.src = url;
  });
async function fileToImage(f: Blob) {
  const url = URL.createObjectURL(f);
  try { return await loadImg(url); } finally { setTimeout(() => URL.revokeObjectURL(url), 1000); }
}

/**
 * El archivo decodificado a w × h px, fuera del hilo principal (createImageBitmap), o null si no se puede. Dibujar la
 * <img> en un lienzo la decodifica y la reduce en el hilo principal: con una foto de 4000 × 3000 eran unos 65 ms con la
 * página congelada, y 11 así (un PNG de 2400 × 1600, 43 frente a 8). im es la misma imagen ya cargada: da el tamaño
 * orientado como lo muestra el navegador. Si el mapa de bits no sale de ese tamaño (p. ej. no aplicó el giro del EXIF),
 * se descarta y quien llama dibuja la <img>, como antes. Los SVG no se admiten: devuelve null.
 */
export async function bitmapAt(blob: Blob, im: HTMLImageElement, w: number, h: number): Promise<ImageBitmap | null> {
  if (typeof createImageBitmap !== 'function') return null;
  try {
    // solo el ancho: el alto sale de la proporción de la imagen ya orientada, y así se nota si no se orientó
    const resize: ImageBitmapOptions = w !== im.naturalWidth ? { resizeWidth: w, resizeQuality: 'high' } : {};
    const bm = await createImageBitmap(blob, { imageOrientation: 'from-image', ...resize });
    if (Math.abs(bm.width - w) <= 1 && Math.abs(bm.height - h) <= 1) return bm;
    bm.close();
  } catch { /* formato u opción que el navegador no admite aquí: se dibuja la <img> */ }
  return null;
}

/**
 * Lienzo de trabajo de un archivo de imagen (no SVG): como mucho de max px de lado, como makeCanvas, pero decodificado
 * fuera del hilo principal cuando se puede (ver bitmapAt).
 */
export async function imageCanvas(blob: Blob, im: HTMLImageElement, max = MAX_SIDE) {
  const sw = im.naturalWidth, sh = im.naturalHeight, sc = Math.min(1, max / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * sc)), h = Math.max(1, Math.round(sh * sc));
  const bm = await bitmapAt(blob, im, w, h);
  if (!bm) return makeCanvas(im, sw, sh, false, max);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.imageSmoothingQuality = 'high';
  x.drawImage(bm, 0, 0, w, h);
  // el navegador deja el dibujo pendiente hasta el siguiente fotograma: al recuperar el póster se juntaban todos en una
  // sola tarea (16 fotos, 180 ms con un procesador lento) y retenía cada mapa de bits hasta entonces. Leer un píxel lo
  // obliga a hacerlo ya, cada uno en su turno
  x.getImageData(0, 0, 1, 1);
  bm.close();
  return c;
}

const MB = (b: number) => Math.round(b / 1024 / 1024);
/** Archivos que se abren a la vez al cargar varios: aprovecha más núcleos sin juntar en memoria todos los originales. */
const LOAD_AHEAD = 3;
class LoadError extends Error {}

async function fileToLayer(f: File): Promise<Layer | null> {
  const fname = f.name || 'imagen pegada';
  const name = fname.replace(/\.[^.]+$/, '') || 'imagen';
  const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(fname);
  const isSvg = f.type === 'image/svg+xml' || /\.svg$/i.test(fname);
  const isImg = f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(fname);
  if (!isPdf && !isImg && !isSvg) throw new LoadError(`«${fname}» no es una imagen ni un PDF`);
  if (f.size > MAX_FILE_BYTES) throw new LoadError(`«${fname}» pesa ${MB(f.size)} MB. El máximo es ${MB(MAX_FILE_BYTES)} MB.`);

  if (isPdf) {
    const doc = await openPdf(await f.arrayBuffer());
    try {
      return newLayer(await renderPdfPage(doc, 1), name, { pdf: doc, pages: doc.numPages, src: { kind: 'pdf', blob: f } });
    } catch (err) {
      void doc.loadingTask.destroy(); // si la página no se pudo dibujar, el documento no se queda cargado en el worker
      throw err;
    }
  }
  const im = await fileToImage(f);
  if (isSvg) {
    // los SVG se cargan como <img>: su JavaScript no se ejecuta
    const sw = im.naturalWidth || 1200, sh = im.naturalHeight || 1200;
    return newLayer(makeCanvas(im, sw, sh, true), name, { src: { kind: 'svg', blob: f } });
  }
  const px = im.naturalWidth * im.naturalHeight;
  if (px > LIMITS.maxImagePixels) {
    throw new LoadError(`«${fname}» tiene ${Math.round(px / 1e6)} megapíxeles. En este equipo el máximo es ${LIMITS.maxImagePixels / 1e6}.`);
  }
  // se guarda el archivo original: el lienzo de trabajo es como máximo de MAX_SIDE, pero al exportar se usa la resolución completa
  return newLayer(await imageCanvas(f, im), name, { src: { kind: 'img', blob: f, w: im.naturalWidth, h: im.naturalHeight } });
}

export async function loadFiles(list: Iterable<File | null> | ArrayLike<File | null>) {
  const all = [...(list as Iterable<File | null>)].filter((f): f is File => !!f);
  // las fuentes (TTF, OTF, WOFF) no son imágenes: quedan para los textos
  const fonts = all.filter(isFontFile), files = all.filter((f) => !isFontFile(f));
  if (fonts.length) await loadFonts(fonts);
  if (!files.length) return;
  if (S.mode === 'crop') applyCrop();
  toast(files.length > 1 ? `Cargando ${files.length} archivos…` : 'Cargando…', 0);
  let added = 0;
  const failed: string[] = [];
  // se decodifican varios a la vez (fuera del hilo principal, ver bitmapAt) y se agregan en el orden elegido
  const jobs: (Promise<Layer | null> | undefined)[] = [];
  const start = (i: number) => {
    const f = files[i];
    if (!f || jobs[i]) return;
    const job = jobs[i] = fileToLayer(f);
    job.catch(() => {}); // el error se trata al llegarle el turno
  };
  for (const [i, f] of files.entries()) {
    for (let j = i; j < i + LOAD_AHEAD; j++) start(j); // este y los siguientes, como mucho LOAD_AHEAD a la vez
    try {
      const l = await jobs[i]!;
      if (!l) continue;
      snap();
      addLayer(l, st.layers.length === 0 ? {} : { factor: 0.5, offset: added * 12 });
      added++;
    } catch (err) {
      console.error(err);
      failed.push(err instanceof LoadError ? err.message : `No se pudo abrir «${f.name || 'el archivo'}». Prueba con JPG, PNG o PDF.`);
    }
  }
  // los errores se muestran al final para que una carga correcta posterior no los tape
  if (failed.length) toast(failed.length === 1 ? failed[0]! : `${failed.length} archivos no se pudieron abrir. ${failed[0]}`, 6000);
  else if (added) hideToast();
}

export function initLoad() {
  const input = $<HTMLInputElement>('#file');
  input.addEventListener('change', () => { if (input.files) void loadFiles(input.files); input.value = ''; });
  document.addEventListener('click', (e) => {
    if ((e.target as Element).closest?.('[data-addfile]')) input.click();
  });

  // arrastrar y soltar en toda la página: si se suelta fuera del lienzo, el navegador abriría el archivo y se perdería el póster
  const drop = $('#drop');
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  document.addEventListener('dragover', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer!.dropEffect = 'copy';
    drop.hidden = false;
  });
  document.addEventListener('dragleave', (e) => {
    const to = e.relatedTarget as Node | null;
    if (!to || !document.documentElement.contains(to)) drop.hidden = true;
  });
  document.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    drop.hidden = true;
    if (e.dataTransfer) void loadFiles(e.dataTransfer.files);
  });
}

/** Ctrl+V: imágenes del portapapeles del sistema o, si no hay, la imagen copiada dentro de Pliego. */
export function handlePaste(e: ClipboardEvent, pasteInternal: () => boolean) {
  if ((e.target as Element).matches?.('input,textarea')) return;
  const fs = [...(e.clipboardData?.items ?? [])].filter((i) => i.type.startsWith('image/')).map((i) => i.getAsFile());
  if (fs.some(Boolean)) { e.preventDefault(); void loadFiles(fs); }
  else if (st.clip) { e.preventDefault(); pasteInternal(); }
}
