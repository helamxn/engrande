/** Carga de imágenes y PDF: selector de archivos, arrastrar y soltar en toda la página y pegar. */
import { addLayer, applyCrop, makeCanvas, newLayer } from '../actions';
import { MAX_FILE_BYTES, MAX_IMAGE_PIXELS } from '../constants';
import { $, hideToast, toast } from '../dom';
import { snap } from '../history';
import { S, st } from '../state';
import { openPdf, renderPdfPage } from './pdf';
import type { Layer } from '../types';

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

const MB = (b: number) => Math.round(b / 1024 / 1024);
class LoadError extends Error {}

async function fileToLayer(f: File): Promise<Layer | null> {
  const fname = f.name || 'imagen pegada';
  const name = fname.replace(/\.[^.]+$/, '') || 'imagen';
  const isPdf = f.type === 'application/pdf' || /\.pdf$/i.test(fname);
  const isSvg = f.type === 'image/svg+xml' || /\.svg$/i.test(fname);
  const isImg = f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp|avif)$/i.test(fname);
  if (!isPdf && !isImg && !isSvg) throw new LoadError(`“${fname}” no es una imagen ni un PDF`);
  if (f.size > MAX_FILE_BYTES) throw new LoadError(`“${fname}” pesa ${MB(f.size)} MB. El máximo es ${MB(MAX_FILE_BYTES)} MB.`);

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
  if (px > MAX_IMAGE_PIXELS) throw new LoadError(`“${fname}” tiene ${Math.round(px / 1e6)} megapíxeles. El máximo es ${MAX_IMAGE_PIXELS / 1e6}.`);
  // se guarda el archivo original: el lienzo de trabajo es como máximo de MAX_SIDE, pero al exportar se usa la resolución completa
  return newLayer(makeCanvas(im, im.naturalWidth, im.naturalHeight), name, { src: { kind: 'img', blob: f, w: im.naturalWidth, h: im.naturalHeight } });
}

export async function loadFiles(list: Iterable<File | null> | ArrayLike<File | null>) {
  const files = [...(list as Iterable<File | null>)].filter((f): f is File => !!f);
  if (!files.length) return;
  if (S.mode === 'crop') applyCrop();
  toast(files.length > 1 ? `Cargando ${files.length} archivos…` : 'Cargando…', 0);
  const replaceSample = st.layers.length > 0 && st.layers.every((l) => l.isSample);
  let added = 0;
  const failed: string[] = [];
  for (const f of files) {
    try {
      const l = await fileToLayer(f);
      if (!l) continue;
      snap();
      if (replaceSample && !added) st.layers = st.layers.filter((x) => !x.isSample);
      addLayer(l, st.layers.length === 0 ? {} : { factor: 0.5, offset: added * 12 });
      added++;
    } catch (err) {
      console.error(err);
      failed.push(err instanceof LoadError ? err.message : `No se pudo abrir “${f.name || 'el archivo'}”. Prueba con JPG, PNG o PDF.`);
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
