/**
 * Lo fijo no se mueve: al seleccionar aparece el panel de la selección encima del lienzo, sin reencajar el póster
 * (el zoom no cambia) ni mover la cabecera, la barra, los botones de Póster y Capas o la isla de vista. En el móvil,
 * abrir el panel inferior tampoco mueve el lienzo.
 */
import { expect, test, type Page } from '@playwright/test';
import { addImage, openApp } from './helpers';

const FIXED = ['header', '#ctxbar', '#panelOpeners', '#tools'];
const boxes = (page: Page) => page.evaluate((ids) => ids.map((id) => {
  const e = document.querySelector(id);
  if (!e || !e.getClientRects().length) return null;
  const r = e.getBoundingClientRect();
  return [Math.round(r.x), Math.round(r.y), Math.round(r.width)];
}), FIXED);

test('escritorio: seleccionar y deseleccionar no mueve el lienzo ni las islas fijas', async ({ page }) => {
  await openApp(page);
  await addImage(page);
  // sin selección: punto de partida
  await page.locator('#selectionClose').click();
  await expect(page.locator('#panel')).toBeHidden();
  const zoom0 = await page.locator('#zoomPct').textContent(), b0 = await boxes(page);
  // con selección: aparece el panel, encima; nada más cambia (la barra, solo su contenido, no su sitio)
  await page.locator('#cv').click({ position: { x: 700, y: 430 } });
  await expect(page.locator('#panel')).toBeVisible();
  expect(await page.locator('#zoomPct').textContent()).toBe(zoom0);
  const b1 = await boxes(page);
  for (const [i, id] of FIXED.entries()) expect(b1[i]?.slice(0, 2), id).toEqual(b0[i]?.slice(0, 2));
  // el panel, entre los botones de arriba y la isla de vista: no tapa ninguno
  const panel = (await page.locator('#panel').boundingBox())!;
  const openers = (await page.locator('#panelOpeners').boundingBox())!, tools = (await page.locator('#tools').boundingBox())!;
  expect(panel.y).toBeGreaterThanOrEqual(openers.y + openers.height);
  expect(panel.y + panel.height).toBeLessThanOrEqual(tools.y);
  // al deseleccionar, todo sigue igual
  await page.keyboard.press('Escape');
  await expect(page.locator('#panel')).toBeHidden();
  expect(await page.locator('#zoomPct').textContent()).toBe(zoom0);
});

test.describe('móvil', () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test('abrir el panel inferior no mueve el lienzo', async ({ page }) => {
    await openApp(page);
    await addImage(page);
    const zoom0 = await page.locator('#zoomPct').textContent();
    await page.locator('#tab-image').tap();
    await expect(page.locator('#sheetHandle')).toHaveAttribute('aria-expanded', 'true');
    await page.waitForTimeout(400); // la transición de la altura
    expect(await page.locator('#zoomPct').textContent()).toBe(zoom0);
  });
});
