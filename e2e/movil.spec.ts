/** Móvil: panel inferior deslizable, barra de la imagen acoplada abajo y nada que se salga de la pantalla. */
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

test('con una imagen seleccionada, la barra va acoplada abajo, con etiquetas y deslizadores con nombre', async ({ page }) => {
  await addImage(page);
  await selectRow(page);
  const bar = page.locator('#ctxbar');
  await expect(bar).toHaveClass(/dock/);
  for (const name of ['Agregar', 'Recortar', 'Quitar fondo', 'Borrador']) await expect(bar.getByRole('button', { name, exact: true })).toBeVisible();
  // la barra queda dentro de la pantalla, sin nada escondido (la Varita, sin sitio, está en Más › Borrar zonas)
  const box = (await bar.boundingBox())!;
  expect(Math.abs(box.x - 8)).toBeLessThan(2); // a la izquierda, como sin selección: «Agregar» no se mueve
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  expect(await bar.evaluate((b) => b.scrollWidth - b.clientWidth)).toBeLessThanOrEqual(0);
  await bar.getByRole('button', { name: 'Borrador' }).tap();
  await expect(bar.getByRole('slider', { name: 'Tamaño del pincel' })).toBeVisible();
  await bar.getByRole('button', { name: 'Listo' }).tap();
  await bar.getByRole('button', { name: /Más opciones/ }).tap();
  await page.locator('#menu').getByRole('menuitem', { name: /Borrar zonas/ }).tap();
  await page.locator('#menu').getByRole('menuitem', { name: /Varita/ }).tap();
  await expect(bar.getByRole('slider', { name: 'Tolerancia' })).toBeVisible();
});

/** Botones visibles dentro de root que miden menos de 44 px de alto o de ancho (el asa del panel ocupa todo el ancho). */
const smallTargets = (page: Page, root: string) => page.locator(root).evaluate((r) =>
  [...r.querySelectorAll<HTMLElement>('button, [role="tab"], .chip')]
    .filter((b) => b.id !== 'sheetHandle' && b.getClientRects().length > 0)
    .map((b) => ({ b, r: b.getBoundingClientRect() }))
    .filter(({ r: x }) => Math.round(x.height) < 44 || Math.round(x.width) < 44)
    .map(({ b, r: x }) => `${b.getAttribute('aria-label') || b.title || b.textContent?.trim() || b.className} ${Math.round(x.width)}×${Math.round(x.height)}`));

test('en táctil, los botones de la cabecera, la vista, la barra, el panel y la lista miden al menos 44 px', async ({ page }) => {
  // recién agregada queda seleccionada: barra acoplada y tarjeta de la selección en el panel
  await addImage(page);
  await page.locator('#sheetHandle').tap();
  for (const root of ['header', '#tools', '#ctxbar', '#panel']) expect(await smallTargets(page, root), `${root} con selección`).toEqual([]);
  for (const tab of ['image', 'sheets', 'sel'] as const) {
    await openTab(page, tab);
    expect(await smallTargets(page, '#panel'), tab).toEqual([]);
  }
  expect(await smallTargets(page, '#ctxbar'), 'barra sin selección').toEqual([]);
});

test('«Más» de la barra abre el menú con submenús dentro (botón «Atrás»)', async ({ page }) => {
  await addImage(page);
  await selectRow(page);
  await page.locator('#ctxbar').getByRole('button', { name: /Más opciones/ }).tap();
  const menu = page.locator('#menu');
  await menu.getByRole('menuitem', { name: /Girar y voltear/ }).tap();
  await expect(menu.getByRole('menuitem', { name: 'Atrás' })).toBeVisible();
  await menu.getByRole('menuitem', { name: /Girar 90° a la derecha/ }).tap();
  await expect(menu).toBeHidden();
});
