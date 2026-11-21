/** Fondo de color del póster y papeles Legal y Tabloide. */
import { expect, test } from '@playwright/test';
import { addImage, closeCards, openApp, openPdfCard, openTab, saved } from './helpers';

test('un fondo de color se guarda, hace que se impriman todas las hojas y se deshace', async ({ page }) => {
  await openApp(page);
  // una franja alargada en 3 × 3: sin fondo, 6 hojas en blanco
  await addImage(page, { w: 3000, h: 300 });
  await openTab(page, 'sheets');
  await page.locator('#presets [data-c="3"][data-r="3"]').click();
  await expect(page.locator('#sizeNote')).toContainText('6 en blanco');
  await page.locator('#bgSwatches .swatch').first().click();
  await expect(page.locator('#bgOut')).toHaveText('#111111');
  await expect(page.locator('#sizeNote')).not.toContainText('en blanco');
  await expect.poll(async () => (await saved(page))?.layout.bg, { timeout: 15_000 }).toBe('#111111');
  await closeCards(page);
  await expect(page.locator('#quickExport')).toHaveAttribute('title', 'PDF por hojas · 10 páginas · 150 ppp');
  await page.keyboard.press('Control+z');
  await openTab(page, 'sheets');
  await expect(page.locator('#bgOut')).toHaveText('blanco del papel');
  await expect(page.locator('#bgClear')).toBeDisabled();
});

test('Legal y Tabloide: medida en el resumen y en el PDF', async ({ page }) => {
  await openApp(page);
  await addImage(page);
  await openTab(page, 'sheets');
  await page.locator('[data-paper="Tabloide"]').click();
  await expect(page.locator('[data-paper="Tabloide"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await saved(page))?.layout.paper, { timeout: 15_000 }).toBe('Tabloide');
  await page.locator('[data-paper="Legal"]').click();
  await closeCards(page);
  await openPdfCard(page);
  await expect(page.locator('#exportSummary')).toContainText('hojas Legal');
});
