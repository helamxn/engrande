/** Guardado automático en el navegador: lo que se hace sigue ahí al recargar. */
import { expect, test } from '@playwright/test';
import { addImage, expectSavedNames, listNames, openApp, saved, selectRow } from './helpers';

test.beforeEach(async ({ page }) => { await openApp(page); });

test('una imagen recién cargada sigue ahí al recargar', async ({ page }) => {
  await addImage(page);
  await expectSavedNames(page, ['foto']);
  await page.reload();
  await expect(page.locator('#toast')).toContainText('Se recuperó tu póster');
  expect(await listNames(page)).toEqual(['foto']);
});

test('duplicar (Ctrl+D) y quitar (Supr) se guardan', async ({ page }) => {
  await addImage(page);
  await selectRow(page);
  await page.keyboard.press('Control+d');
  await expectSavedNames(page, ['foto', 'foto (copia)']);
  await page.keyboard.press('Delete'); // quita la copia, que es la seleccionada
  await expectSavedNames(page, ['foto']);
  await page.reload();
  expect(await listNames(page)).toEqual(['foto']);
});

test('cerrar la pestaña antes de que se guarde avisa', async ({ page }) => {
  await addImage(page);
  // justo después de cargar el guardado aún está pendiente (espera 1,2 s)
  const dialog = page.waitForEvent('dialog');
  await page.close({ runBeforeUnload: true });
  const d = await dialog;
  expect(d.type()).toBe('beforeunload');
  await d.dismiss();
});

test('deshacer también se guarda', async ({ page }) => {
  await addImage(page);
  await expectSavedNames(page, ['foto']);
  await selectRow(page);
  await page.keyboard.press('Delete');
  await expectSavedNames(page, null); // póster vacío: no queda nada guardado
  await page.locator('#undo').click();
  await expectSavedNames(page, ['foto']);
  expect(await saved(page)).not.toBeNull();
});
