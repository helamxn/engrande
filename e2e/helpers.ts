/** Ayudantes de los tests de punta a punta: cargar imágenes, leer lo guardado y localizar la imagen en el lienzo. */
import { expect, type Page } from '@playwright/test';

/** Caja de una imagen en mm (zona visible, sin girar), tal como queda guardada. */
export interface SavedBox { x0: number; y0: number; x1: number; y1: number; w: number; h: number }
export interface Saved { names: string[]; boxes: SavedBox[]; layout: Record<string, unknown>; dpi: number }

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
          layout: Record<string, unknown>; dpi: number;
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
          layout: p.layout, dpi: p.dpi,
        });
      };
    };
  }));
}

/** Espera a que lo guardado tenga estas imágenes (el guardado va 1,2 s después del último cambio). */
export async function expectSavedNames(page: Page, names: string[] | null) {
  await expect.poll(async () => (await saved(page))?.names ?? null).toEqual(names);
}

/** Espera al siguiente guardado y devuelve la caja de la imagen i (por defecto, la última). */
export async function savedBox(page: Page, check: (b: SavedBox) => boolean = () => true, i = -1): Promise<SavedBox> {
  let box: SavedBox | undefined;
  await expect.poll(async () => {
    const s = await saved(page);
    box = s?.boxes.at(i);
    return !!box && check(box);
  }).toBe(true);
  return box!;
}

/** Nombres de las filas de la lista de imágenes (arriba = al frente), con * si están seleccionadas. */
export async function listNames(page: Page) {
  return page.locator('#layers li.layer').evaluateAll((lis) =>
    lis.map((li) => (li.querySelector('.layer-main span')?.firstChild?.textContent ?? '') + (li.classList.contains('on') ? '*' : '')));
}

/** Selecciona desde la lista la fila i (0 = la de arriba) y quita el foco, para que el teclado vaya al lienzo. */
export async function selectRow(page: Page, i = 0) {
  await page.locator('#tab-image').click();
  await page.locator('#layers li.layer .layer-main').nth(i).click();
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
