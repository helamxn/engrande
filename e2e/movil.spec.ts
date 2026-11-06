/** Móvil: panel inferior deslizable, barra de la imagen acoplada abajo y nada que se salga de la pantalla. */
import { expect, test, type Page } from '@playwright/test';
import { addImage, openApp, selectRow } from './helpers';

test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

test.beforeEach(async ({ page }) => { await openApp(page); });

const sheetHeight = (page: Page) => page.locator('#panel').evaluate((p) => Math.round(p.getBoundingClientRect().height));

test('no hay scroll horizontal y los botones de la cabecera tienen nombre aunque solo se vea el icono', async ({ page }) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ['Nuevo póster', 'Agregar imagen', 'Descargar PDF']) {
    await expect(page.locator('header').getByRole('button', { name })).toBeVisible();
  }
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
  await page.locator('#tab-export').tap(); // tocar una pestaña con el panel recogido lo abre
  await expect(handle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#pane-export')).toBeVisible();
});

test('con una imagen seleccionada, la barra va acoplada abajo, con etiquetas y deslizadores con nombre', async ({ page }) => {
  await addImage(page);
  await selectRow(page);
  const bar = page.locator('#ctxbar');
  await expect(bar).toHaveClass(/dock/);
  for (const name of ['Recortar', 'Quitar fondo', 'Borrador', 'Varita']) await expect(bar.getByRole('button', { name })).toBeVisible();
  // la barra queda dentro de la pantalla
  const box = (await bar.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  await bar.getByRole('button', { name: 'Borrador' }).tap();
  await expect(bar.getByRole('slider', { name: 'Tamaño del pincel' })).toBeVisible();
  await bar.getByRole('button', { name: 'Listo' }).tap();
  await bar.getByRole('button', { name: 'Varita' }).tap();
  await expect(bar.getByRole('slider', { name: 'Tolerancia' })).toBeVisible();
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
