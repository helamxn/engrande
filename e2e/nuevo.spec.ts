/** «Nuevo póster»: solo actúa si hay algo que reiniciar, avisa de lo que hizo y un «Deshacer» lo recupera todo. */
import { expect, test } from '@playwright/test';
import { addImage, expectSavedNames, listNames, openApp } from './helpers';

test.beforeEach(async ({ page }) => { await openApp(page); });

test('con el póster recién abierto, «Nuevo» está desactivado (también en el menú)', async ({ page }) => {
  await expect(page.locator('#newPoster')).toBeDisabled();
  await expect(page.locator('#newPoster')).toHaveAttribute('title', 'Ya es un póster nuevo');
  await page.locator('#cv').click({ button: 'right', position: { x: 300, y: 300 } });
  await expect(page.getByRole('menuitem', { name: /Nuevo póster/ })).toBeDisabled();
});

test('sin imágenes, restablece las hojas y deshacer las devuelve', async ({ page }) => {
  await page.locator('#presets [data-c="3"][data-r="2"]').click();
  await expect(page.locator('#newPoster')).toBeEnabled();
  await page.locator('#newPoster').click();
  await expect(page.locator('#toast')).toContainText('Hojas y ajustes restablecidos');
  await expect(page.locator('#presets [aria-pressed=true]')).toHaveText('2×1');
  await expect(page.locator('#newPoster')).toBeDisabled();
  await page.locator('#undo').click();
  await expect(page.locator('#presets [aria-pressed=true]')).toHaveText('3×2');
});

test('con imágenes, avisa del borrado; una segunda pulsación no hace nada y un solo deshacer lo recupera', async ({ page }) => {
  await addImage(page);
  await expectSavedNames(page, ['foto']);
  await page.locator('#newPoster').click();
  await expect(page.locator('#toast')).toContainText('Se borró el trabajo guardado');
  await expectSavedNames(page, null);
  await expect(page.locator('#newPoster')).toBeDisabled();
  await page.locator('#undo').click();
  expect(await listNames(page)).toEqual(['foto*']); // vuelve también seleccionada, como estaba
  await expectSavedNames(page, ['foto']);
});

test('deshacer «Nuevo» devuelve la resolución, las marcas y la guía', async ({ page }) => {
  await addImage(page);
  await page.locator('#tab-export').click();
  await page.locator('[data-dpi="300"]').click();
  await page.locator('#marks').uncheck();
  await page.locator('#newPoster').click();
  await expect(page.locator('[data-dpi="150"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#undo').click();
  await expect(page.locator('[data-dpi="300"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#marks')).not.toBeChecked();
});
