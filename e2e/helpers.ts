/** Ayudantes de los tests de punta a punta: cargar imágenes, leer lo guardado y localizar la imagen en el lienzo. */
import { expect, type Page } from '@playwright/test';

/** Caja de una imagen en mm (zona visible, sin girar), tal como queda guardada. */
export interface SavedBox { x0: number; y0: number; x1: number; y1: number; w: number; h: number }
export interface Saved { names: string[]; boxes: SavedBox[]; layout: Record<string, unknown>; dpi: number; skipBlank?: boolean }

/**
 * «Agregar texto» y elegir dónde: el de la bienvenida o el de «＋ Agregar» en la barra, y un clic en el lienzo, que
 * es donde empieza el texto. Devuelve con el cuadro de escritura listo.
 */
export async function startText(page: Page, at = { x: 220, y: 260 }) {
  const welcome = page.locator('#empty [data-addtext]');
  if (await welcome.isVisible()) await welcome.click();
  else {
    await page.locator('#ctxbar [data-act=add]').click();
    await page.locator('#menu').getByRole('menuitem', { name: /Agregar texto/ }).click();
  }
  await page.locator('#cv').click({ position: at });
  await expect(page.locator('.text-editor')).toBeFocused();
}

/** Abre la app con el póster vacío. */
export async function openApp(page: Page) {
  await page.goto('/');
  await expect(page.locator('#empty')).toBeVisible();
}

/**
 * Agrega una imagen PNG generada en la página (como si se eligiera con «Agregar imagen»). La imagen tiene un rectángulo
 * de color sobre fondo blanco.
 */
export async function addImage(page: Page, { name = 'foto', w = 1200, h = 800, color = '#3399cc' } = {}) {
  const before = await page.locator('#layers li.layer').count();
  await page.evaluate(async ({ name, w, h, color }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const x = c.getContext('2d')!;
    x.fillStyle = '#ffffff'; x.fillRect(0, 0, w, h);
    x.fillStyle = color; x.fillRect(w * 0.2, h * 0.2, w * 0.6, h * 0.6);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const input = document.querySelector<HTMLInputElement>('#file')!, dt = new DataTransfer();
    dt.items.add(new File([blob], name + '.png', { type: 'image/png' }));
    input.files = dt.files;
    input.dispatchEvent(new Event('change'));
  }, { name, w, h, color });
  await expect(page.locator('#layers li.layer')).toHaveCount(before + 1);
}

/** Lo guardado en IndexedDB (null si no hay nada). */
export function saved(page: Page): Promise<Saved | null> {
  return page.evaluate(() => new Promise<Saved | null>((res) => {
    const q = indexedDB.open('pliego', 1);
    q.onupgradeneeded = () => { q.result.createObjectStore('project'); q.result.createObjectStore('blobs'); };
    q.onsuccess = () => {
      const t = q.result.transaction('project'), g = t.objectStore('project').get('current');
      t.oncomplete = () => {
        const p = g.result as undefined | {
          layers: { name: string; cx: number; cy: number; w: number; h: number; crop: { x0: number; y0: number; x1: number; y1: number } }[];
          layout: Record<string, unknown>; dpi: number; skipBlank?: boolean;
        };
        if (!p) { res(null); return; }
        res({
          names: p.layers.map((l) => l.name),
          // zona visible (con el recorte) de una imagen sin girar
          boxes: p.layers.map((l) => {
            const x0 = l.cx - l.w / 2 + l.w * l.crop.x0, y0 = l.cy - l.h / 2 + l.h * l.crop.y0;
            const x1 = l.cx - l.w / 2 + l.w * l.crop.x1, y1 = l.cy - l.h / 2 + l.h * l.crop.y1;
            return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
          }),
          layout: p.layout, dpi: p.dpi, skipBlank: p.skipBlank,
        });
      };
    };
  }));
}

/**
 * Cuánto esperar a un guardado: va 1,2 s después del último cambio y escribe las imágenes en IndexedDB, que con
 * todos los tests en paralelo puede tardar varios segundos.
 */
const SAVE_WAIT = { timeout: 15_000 };

/** Espera a que lo guardado tenga estas imágenes. */
export async function expectSavedNames(page: Page, names: string[] | null) {
  await expect.poll(async () => (await saved(page))?.names ?? null, SAVE_WAIT).toEqual(names);
}

/** Espera al siguiente guardado y devuelve la caja de la imagen i (por defecto, la última). */
export async function savedBox(page: Page, check: (b: SavedBox) => boolean = () => true, i = -1): Promise<SavedBox> {
  let box: SavedBox | undefined;
  await expect.poll(async () => {
    const s = await saved(page);
    box = s?.boxes.at(i);
    return !!box && check(box);
  }, SAVE_WAIT).toBe(true);
  return box!;
}

/** Nombres de las filas de la lista de imágenes (arriba = al frente), con * si están seleccionadas. */
export async function listNames(page: Page) {
  return page.locator('#layers li.layer').evaluateAll((lis) =>
    lis.map((li) => (li.querySelector('.layer-main span')?.firstChild?.textContent ?? '') + (li.classList.contains('on') ? '*' : '')));
}

/** Muestra la lista de capas. */
export async function showLayers(page: Page) { await openTab(page, 'image'); }

/**
 * Muestra una sección: en el móvil, su pestaña del panel inferior; en escritorio, la tarjeta de Póster o de Capas
 * (con su botón de arriba a la derecha) o el panel de la selección (aparece solo al seleccionar algo).
 */
export async function openTab(page: Page, tab: 'sheets' | 'image' | 'sel') {
  const t = page.locator(`#tab-${tab}`);
  if (await t.isVisible()) { await t.click(); return; }
  if (tab === 'sel') { await expect(page.locator('#selectionCard')).toBeVisible(); return; }
  const pane = page.locator(`#pane-${tab}`);
  if (!(await pane.isVisible())) await page.locator(`#panelOpeners [data-open="${tab}"]`).click();
  await expect(pane).toBeVisible();
}

/** Cierra las tarjetas de Póster y de Capas (escritorio), para que no tapen el lienzo. */
export async function closeCards(page: Page) {
  await page.evaluate(() => {
    for (const c of document.querySelectorAll<HTMLElement>('#posterCard, #layersCard')) if (c.matches(':popover-open')) c.hidePopover();
  });
}

/** Abre la tarjeta del PDF (flecha de «Descargar PDF»): resolución, marcas, guía, imprimir y otras descargas. */
export async function openPdfCard(page: Page) {
  if (!(await page.locator('#pdfCard').isVisible())) await page.locator('#exportMore').click();
  await expect(page.locator('#pdfCard')).toBeVisible();
}

/** Pulsa una salida de la tarjeta del PDF (#exportTiles, #printTiles, #exportSingle, #marginTest…). */
export async function pdfCardButton(page: Page, id: string) {
  await openPdfCard(page);
  await page.locator(id).click();
}

/**
 * Selecciona desde la lista la fila i (0 = la de arriba), deja a la vista sus propiedades (Selección), cierra la
 * tarjeta de Capas para que no tape el lienzo y quita el foco, para que el teclado vaya al lienzo.
 */
export async function selectRow(page: Page, i = 0) {
  // la fila ya está (si se acaba de cargar, su selección automática no llega a mitad de camino)
  await expect(page.locator('#layers li.layer').nth(i)).toBeAttached({ timeout: 15_000 });
  await expect(page.locator('#toast:visible', { hasText: 'Cargando' })).toHaveCount(0);
  await showLayers(page);
  await page.locator('#layers li.layer .layer-main').nth(i).click();
  await openTab(page, 'sel');
  await closeCards(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/**
 * Conversión mm → píxeles de pantalla para la imagen seleccionada: se busca en el lienzo dónde aparece el cursor de
 * mover (la imagen) y se compara con su caja guardada en mm.
 */
export async function screenMap(page: Page, box: SavedBox) {
  const r = await page.evaluate(() => {
    const cv = document.querySelector<HTMLCanvasElement>('#cv')!, rc = cv.getBoundingClientRect();
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let y = rc.top + 1; y < rc.bottom; y += 2) for (let x = rc.left + 1; x < rc.right; x += 6) {
      cv.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, pointerType: 'mouse', clientX: x, clientY: y }));
      if (cv.style.cursor === 'move') { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
    }
    return { x0, y0, x1, y1 };
  });
  const k = (r.y1 - r.y0) / box.h; // en vertical el barrido es más fino
  return {
    k,
    toScreen: (mx: number, my: number) => ({ x: r.x0 + (mx - box.x0) * k, y: r.y0 + (my - box.y0) * k }),
  };
}

/** Arrastre con el ratón en varios pasos (como una persona), con teclas opcionales pulsadas durante el gesto. */
export async function drag(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, hold: string[] = []) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (const k of hold) await page.keyboard.down(k);
  await page.mouse.move(to.x, to.y, { steps: 10 });
  await page.mouse.up();
  for (const k of hold) await page.keyboard.up(k);
}

/** Está en un mm entero (con margen para la coma flotante). */
export const onMm = (v: number) => Math.abs(v - Math.round(v)) < 1e-6;

/* ---------- PDF de prueba y archivos ---------- */
/** Página de un PDF de prueba: color de fondo en RGB (0–255) o en CMYK (0–1). */
export type PdfPage = { rgb: [number, number, number] } | { cmyk: [number, number, number, number] };

/** PDF de varias páginas (A5 apaisado), cada una de un color y con su número, generado con jsPDF en Node. */
export async function makePdf(pages: PdfPage[]): Promise<Buffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a5', orientation: 'landscape' });
  pages.forEach((p, i) => {
    if (i) doc.addPage('a5', 'landscape');
    if ('rgb' in p) doc.setFillColor(...p.rgb); else doc.setFillColor(...p.cmyk);
    doc.rect(0, 0, 210, 148, 'F');
    doc.setFontSize(60); doc.setTextColor(255, 255, 255); doc.text(`Página ${i + 1}`, 30, 80);
  });
  return Buffer.from(doc.output('arraybuffer'));
}

/** Agrega un archivo cualquiera con el selector de «Agregar imagen». */
export async function addFile(page: Page, name: string, mimeType: string, buffer: Buffer) {
  await page.locator('#file').setInputFiles({ name, mimeType, buffer });
}

/** Color (r, g, b) de la miniatura de la fila i de la lista (lo que se ve de la imagen, a 88 px), bajo el centro. */
export function thumbColor(page: Page, i = 0) {
  // por debajo del centro: en los PDF de makePdf el centro cae sobre el texto blanco, y su antialias cambia con el sistema
  return page.locator('#layers li.layer canvas').nth(i).evaluate((c: HTMLCanvasElement) =>
    [...c.getContext('2d')!.getImageData(44, 66, 1, 1).data].slice(0, 3));
}

/* ---------- toques de verdad ---------- */
/**
 * Dedos sobre la pantalla con el protocolo de Chromium (Edge y Chrome): eventos táctiles reales, con varios dedos a la
 * vez, que el navegador convierte en pointer events con pointerType «touch» (Playwright solo sabe tocar con uno).
 */
export async function fingers(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  const send = (type: 'touchStart' | 'touchMove' | 'touchEnd', pts: { x: number; y: number }[]) =>
    cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((p, id) => ({ x: p.x, y: p.y, id })) });
  return {
    /** Mantener pulsado un dedo ms milisegundos. */
    async hold(p: { x: number; y: number }, ms: number) {
      await send('touchStart', [p]); await page.waitForTimeout(ms); await send('touchEnd', []);
    },
    /** Dos dedos que van de a0/b0 a a1/b1 en varios pasos. */
    async pinch(a0: { x: number; y: number }, b0: { x: number; y: number }, a1: { x: number; y: number }, b1: { x: number; y: number }) {
      await send('touchStart', [a0, b0]);
      for (let i = 1; i <= 10; i++) {
        const t = i / 10, lerp = (p: { x: number; y: number }, q: { x: number; y: number }) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t });
        await send('touchMove', [lerp(a0, a1), lerp(b0, b1)]);
      }
      await send('touchEnd', []);
    },
    /** Un dedo que arrastra de p a q. */
    async swipe(p: { x: number; y: number }, q: { x: number; y: number }) {
      await send('touchStart', [p]);
      for (let i = 1; i <= 10; i++) await send('touchMove', [{ x: p.x + (q.x - p.x) * i / 10, y: p.y + (q.y - p.y) * i / 10 }]);
      await send('touchEnd', []);
    },
  };
}
