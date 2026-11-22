/**
 * Lo fijo no se mueve: al seleccionar aparece el panel de la selección encima del lienzo, sin reencajar el póster
 * (el zoom no cambia) ni mover la cabecera, la barra, los botones de Póster y Capas o la isla de vista. En el móvil,
 * abrir el panel inferior tampoco mueve el lienzo.
 */
import { expect, test, type Page } from '@playwright/test';
import { addImage, closeCards, openApp, openTab } from './helpers';

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

test('el tamaño del póster está abajo a la izquierda, antes de la línea de estado, no se mueve y abre Póster', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#posterSize')).toBeHidden(); // póster nuevo: sin hojas a la vista
  await openTab(page, 'sheets');
  await page.locator('#presets [data-c="1"][data-r="1"]').click();
  await closeCards(page);
  const size = page.locator('#posterSize');
  await expect(size).toHaveText('19,8 × 28,5 cm · 1 hoja A4');
  await expect(size).toHaveAttribute('title', /margen 6 mm/);
  const at = (await size.boundingBox())!;
  // a la izquierda, en la fila de la isla de vista, y la línea de estado empieza a su derecha
  const tools = (await page.locator('#tools').boundingBox())!;
  expect(at.x).toBeLessThan(40);
  expect(Math.abs(at.y + at.height / 2 - (tools.y + tools.height / 2))).toBeLessThan(2);
  const hint = (await page.locator('#hint').boundingBox())!;
  expect(hint.x).toBeGreaterThanOrEqual(at.x + at.width);
  // mover la vista no lo mueve
  await page.mouse.move(800, 470);
  await page.mouse.down({ button: 'middle' });
  await page.mouse.move(700, 380, { steps: 5 });
  await page.mouse.up({ button: 'middle' });
  expect(await size.boundingBox()).toEqual(at);
  await size.click();
  await expect(page.locator('#posterCard')).toBeVisible();
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
