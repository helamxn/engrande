/** Móvil: panel inferior deslizable, barras de herramientas y de opciones abajo y nada que se salga de la pantalla. */
import { expect, test, type Page } from '@playwright/test';
import { addImage, openApp, openTab, selectRow } from './helpers';

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => { await openApp(page); });

const sheetHeight = (page: Page) => page.locator('#panel').evaluate((p) => Math.round(p.getBoundingClientRect().height));

test('una sola fila arriba, sin scroll horizontal, y los botones tienen nombre aunque solo se vea el icono', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ['Descargar PDF', 'Opciones del PDF e imprimir']) {
    await expect(page.locator('header').getByRole('button', { name })).toBeVisible();
  }
  for (const name of ['Deshacer', 'Rehacer']) await expect(page.locator('#tools').getByRole('button', { name })).toBeVisible();
  // la cabecera y la isla de historial y vista comparten fila
  const head = (await page.locator('header').boundingBox())!, tools = (await page.locator('#tools').boundingBox())!;
  expect(Math.abs(tools.y - head.y)).toBeLessThan(2);
  // «Nuevo póster» está en la tarjeta del PDF, que cabe en la pantalla
  await page.locator('#exportMore').tap();
  await expect(page.locator('#newPosterAlt')).toBeVisible();
  const card = (await page.locator('#pdfCard').boundingBox())!;
  expect(card.x).toBeGreaterThanOrEqual(0); expect(card.x + card.width).toBeLessThanOrEqual(375);
});

test('el panel inferior empieza recogido; el asa y las pestañas lo abren', async ({ page }) => {
  const handle = page.locator('#sheetHandle');
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  const peek = await sheetHeight(page);
  await handle.tap();
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await expect.poll(() => sheetHeight(page)).toBeGreaterThan(peek + 150);
  await handle.tap();
  await expect(handle).toHaveAttribute('aria-expanded', 'false');
  await page.locator('#tab-image').tap(); // tocar una pestaña con el panel recogido lo abre
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#pane-image')).toBeVisible();
});

test('con una imagen seleccionada, herramientas abajo y opciones encima, acopladas y con deslizadores con nombre', async ({ page }) => {
  await addImage(page);
  await selectRow(page);
  const tools = page.locator('#toolbar'), bar = page.locator('#ctxbar');
  await expect(bar).toHaveClass(/dock/);
  for (const name of ['Texto', 'Recortar', 'Borrador', 'Varita', 'Quitar fondo', 'Opciones del póster']) await expect(tools.getByRole('button', { name, exact: true })).toBeVisible();
  // las herramientas, dentro de la pantalla y encima del panel inferior (abierto a media altura: suben con él);
  // nada escondido
  const gap = () => page.evaluate(() => document.querySelector('#panel')!.getBoundingClientRect().top - document.querySelector('#toolbar')!.getBoundingClientRect().bottom);
  await expect.poll(gap).toBeGreaterThanOrEqual(0);
  await page.waitForTimeout(300); // la transición de la altura
  const box = (await tools.boundingBox())!, panel = (await page.locator('#panel').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(box.y + box.height).toBeLessThanOrEqual(panel.y);
  expect(await tools.evaluate((x) => x.scrollWidth - x.clientWidth)).toBeLessThanOrEqual(0);
  await tools.getByRole('button', { name: 'Borrador' }).tap();
  await expect(bar.getByRole('slider', { name: 'Tamaño del pincel' })).toBeVisible();
  // las opciones, encima de las herramientas y sin nada escondido
  const b = (await bar.boundingBox())!;
  expect(b.y + b.height).toBeLessThanOrEqual((await tools.boundingBox())!.y);
  expect(await bar.evaluate((x) => x.scrollWidth - x.clientWidth)).toBeLessThanOrEqual(0);
  await bar.getByRole('button', { name: 'Listo' }).tap();
  await tools.getByRole('button', { name: 'Varita' }).tap();
  await expect(bar.getByRole('slider', { name: 'Tolerancia' })).toBeVisible();
});

/** Botones visibles dentro de root que miden menos de 44 px de alto o de ancho (el asa del panel ocupa todo el ancho). */
const smallTargets = (page: Page, root: string) => page.locator(root).evaluate((r) =>
  [...r.querySelectorAll<HTMLElement>('button, [role="tab"], .chip')]
    .filter((b) => b.id !== 'sheetHandle' && b.getClientRects().length > 0)
    .map((b) => ({ b, r: b.getBoundingClientRect() }))
    .filter(({ r: x }) => Math.round(x.height) < 44 || Math.round(x.width) < 44)
    .map(({ b, r: x }) => `${b.getAttribute('aria-label') || b.title || b.textContent?.trim() || b.className} ${Math.round(x.width)}×${Math.round(x.height)}`));

test('en táctil, los botones de la cabecera, la vista, las barras, el panel y la lista miden al menos 44 px', async ({ page }) => {
  // recién agregada queda seleccionada: barra acoplada y tarjeta de la selección en el panel
  await addImage(page);
  await page.locator('#sheetHandle').tap();
  for (const root of ['header', '#tools', '#toolbar', '#ctxbar', '#panel']) expect(await smallTargets(page, root), `${root} con selección`).toEqual([]);
  for (const tab of ['image', 'sheets', 'sel'] as const) {
    await openTab(page, tab);
    expect(await smallTargets(page, '#panel'), tab).toEqual([]);
  }
  expect(await smallTargets(page, '#toolbar'), 'herramientas sin selección').toEqual([]);
});

test('«Más opciones» de su fila en Capas abre el menú de la imagen con submenús dentro (botón «Atrás»)', async ({ page }) => {
  await addImage(page);
  await selectRow(page);
  await openTab(page, 'image');
  await page.locator('#layers li.layer .act[data-ic=more]').first().tap();
  const menu = page.locator('#menu');
  await menu.getByRole('menuitem', { name: /Girar y voltear/ }).tap();
  await expect(menu.getByRole('menuitem', { name: 'Atrás' })).toBeVisible();
  await menu.getByRole('menuitem', { name: /Girar 90° a la derecha/ }).tap();
  await expect(menu).toBeHidden();
});
