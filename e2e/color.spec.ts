/** Ajustes de color de una imagen: brillo, contraste, saturación y blanco y negro. */
import { expect, test, type Page } from '@playwright/test';
import { addImage, openApp, selectRow, thumbColor } from './helpers';

/** Ajustes guardados de la primera imagen (null si no tiene). */
const savedAdjust = (page: Page) => page.evaluate(() => new Promise<unknown>((res) => {
  const q = indexedDB.open('pliego', 1);
  q.onsuccess = () => {
    const g = q.result.transaction('project').objectStore('project').get('current');
    g.onsuccess = () => res((g.result as { layers: { adjust?: unknown }[] } | undefined)?.layers[0]?.adjust ?? null);
  };
}));
/** Mueve un deslizador a v (como si se arrastrara: un evento input por valor). */
const slide = (page: Page, id: string, v: number) => page.locator(id).evaluate((el: HTMLInputElement, v) => {
  el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

test.beforeEach(async ({ page }) => { await openApp(page); });
/** Abre la sección plegable de Color de la imagen seleccionada. */
const openColor = async (page: Page) => {
  await expect(page.locator('#adjState')).toBeVisible();
  if (!(await page.locator('#adjustField').evaluate((d: HTMLDetailsElement) => d.open))) await page.locator('#adjustField summary').click();
};

test('blanco y negro y brillo cambian la imagen, se guardan y se deshacen de una vez', async ({ page }) => {
  await addImage(page, { color: '#cc2200' }); // rojo en el centro (la miniatura mira por debajo del centro)
  await selectRow(page);
  const [r0, g0] = await thumbColor(page, 0, 44);
  expect(r0).toBeGreaterThan(150); expect(g0).toBeLessThan(80);
  await expect(page.locator('#adjState')).toHaveText('sin ajustes');
  await openColor(page);
  await page.locator('#adjGray').check();
  await expect(page.locator('#adjState')).toHaveText('blanco y negro');
  await expect.poll(async () => { const [r, g, b] = await thumbColor(page, 0, 44); return Math.max(r, g, b) - Math.min(r, g, b); }).toBeLessThan(3);
  await expect.poll(() => savedAdjust(page), { timeout: 15_000 }).toEqual({ bright: 0, contrast: 0, sat: 0, gray: true });
  // un arrastre del brillo: un solo paso de deshacer
  for (const v of [10, 20, 30, 40]) await slide(page, '#adjBright', v);
  await expect(page.locator('#adjBrightOut')).toHaveText('+40');
  await expect(page.locator('#adjSat')).toBeDisabled(); // en blanco y negro no hace nada
  // el foco sigue en la casilla de blanco y negro: Ctrl+Z deshace igual en el póster
  await expect(page.locator('#adjGray')).toBeFocused();
  await page.keyboard.press('Control+z');
  await expect(page.locator('#adjBrightOut')).toHaveText('0');
  await expect(page.locator('#adjGray')).toBeChecked();
  await page.locator('#adjReset').click();
  await expect(page.locator('#adjGray')).not.toBeChecked();
  await expect(page.locator('#adjReset')).toBeDisabled();
  await expect.poll(() => savedAdjust(page), { timeout: 15_000 }).toBeNull();
  await expect.poll(async () => (await thumbColor(page, 0, 44))[0]).toBeGreaterThan(150);
});

test('los ajustes se recuperan al volver y no aparecen en un texto', async ({ page }) => {
  await addImage(page);
  await selectRow(page);
  await openColor(page);
  await slide(page, '#adjContrast', -50);
  await expect.poll(() => savedAdjust(page), { timeout: 15_000 }).toEqual({ bright: 0, contrast: -50, sat: 0, gray: false });
  await page.reload();
  await expect(page.locator('#toast')).toContainText('Se recuperó tu póster');
  await selectRow(page);
  await expect(page.locator('#adjState')).toHaveText('ajustada'); // plegada, dice que tiene ajustes
  await openColor(page);
  await expect(page.locator('#adjContrastOut')).toHaveText('-50');
  await expect(page.locator('#adjustField')).toBeVisible();
});
