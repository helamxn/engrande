/** Pantalla táctil con dedos de verdad: mantener pulsado, pellizcar, doble toque y deslizar. */
import { expect, test, type Page } from '@playwright/test';
import { addImage, fingers, listNames, openApp, savedBox, screenMap, selectRow } from './helpers';

test.use({ hasTouch: true });

/** Póster 2×1 con una foto seleccionada; devuelve el centro de la foto en pantalla y su caja guardada. */
async function setup(page: Page) {
  await openApp(page);
  await addImage(page);
  await selectRow(page);
  const b = await savedBox(page), m = await screenMap(page, b);
  return { b, m, c: m.toScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2) };
}
/** Un punto del lienzo fuera del póster (a la izquierda, por encima de las herramientas). */
const outside = { x: 40, y: 400 };

test('mantener pulsada una imagen abre su menú; los submenús se abren dentro, con «Atrás»', async ({ page }) => {
  const { c } = await setup(page), f = await fingers(page);
  await f.hold(c, 800);
  const menu = page.locator('#menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Recortar/ })).toContainText('Doble toque');
  const sub = menu.getByRole('menuitem', { name: /Borrar zonas/ }), box = (await sub.boundingBox())!;
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await expect(menu.getByRole('menuitem', { name: 'Atrás' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Borrador/ })).toBeVisible();
});

test('mantener pulsado el fondo abre el menú del póster', async ({ page }) => {
  await setup(page);
  const f = await fingers(page);
  await f.hold(outside, 800);
  await expect(page.locator('#menu').getByRole('menuitem', { name: /Seleccionar todas/ })).toBeVisible();
});

test('pellizcar sobre el fondo hace zoom de la vista; sobre la imagen, la escala', async ({ page }) => {
  const { b } = await setup(page), f = await fingers(page);
  // primero el fondo: después la imagen, ya escalada, podría llegar hasta ahí
  const z0 = await page.locator('#zoomPct').textContent();
  await f.pinch({ x: outside.x - 20, y: 300 }, { x: outside.x + 20, y: 300 }, { x: outside.x - 5, y: 300 }, { x: outside.x + 5, y: 300 });
  await expect(page.locator('#zoomPct')).not.toHaveText(z0!);
  expect((await savedBox(page)).w).toBeCloseTo(b.w, 6); // la imagen no cambió
  const m = await screenMap(page, b), cc = m.toScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2); // la vista cambió: se vuelve a localizar
  await f.pinch({ x: cc.x - 30, y: cc.y }, { x: cc.x + 30, y: cc.y }, { x: cc.x - 60, y: cc.y }, { x: cc.x + 60, y: cc.y });
  const a = await savedBox(page, (x) => x.w > b.w * 1.5);
  expect(a.w / b.w).toBeGreaterThan(1.8); // los dedos se separaron el doble
});

test('deslizar un dedo por el fondo mueve la vista y deselecciona (sin recuadro de selección)', async ({ page }) => {
  await setup(page);
  const f = await fingers(page);
  await f.swipe(outside, { x: outside.x + 80, y: outside.y - 60 });
  expect(await listNames(page)).toEqual(['foto']);
  await expect(page.locator('#ctxbar')).toBeHidden();
});

test('doble toque sobre la imagen entra en el recorte', async ({ page }) => {
  const { c } = await setup(page);
  await page.touchscreen.tap(c.x, c.y);
  await page.touchscreen.tap(c.x, c.y);
  await expect(page.locator('#ctxbar [data-act=applyCrop]')).toBeVisible();
});
