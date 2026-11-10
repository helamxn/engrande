/** Guardado automático en el navegador: lo que se hace sigue ahí al recargar. */
import { expect, test, type Page } from '@playwright/test';
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

/** Las imágenes tardan ms en cargarse: así recuperar el póster dura lo bastante para tocar algo mientras tanto. */
const slowImages = (page: Page, ms: number) => page.addInitScript((ms) => {
  const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')!;
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    get() { return d.get!.call(this); },
    set(v) { setTimeout(() => d.set!.call(this, v), ms); },
  });
}, ms);

test('cambiar algo mientras el póster se recupera no borra lo guardado', async ({ page, context }) => {
  await addImage(page);
  await expectSavedNames(page, ['foto']);
  const slow = await context.newPage();
  await slowImages(slow, 3000);
  await slow.goto('/');
  // aún no llegó ninguna imagen: el póster parece vacío y el usuario cambia la distribución
  await slow.locator('#presets button', { hasText: '2×2' }).click();
  await slow.waitForTimeout(2000); // pasa el plazo del guardado automático (1,2 s) con el póster a medias
  expect((await saved(slow))?.names).toEqual(['foto']);
  await expect(slow.locator('#layers li.layer')).toHaveCount(1);
  // el paso de deshacer de antes de recuperar se descarta: deshacerlo quitaría la imagen
  await expect(slow.locator('#undo')).toBeDisabled();
  await page.close(); await slow.close();
  const again = await context.newPage();
  await again.goto('/');
  await expect(again.locator('#toast')).toContainText('Se recuperó tu póster');
  expect(await listNames(again)).toEqual(['foto']);
});

test('con dos pestañas se avisa y ninguna deja el guardado a medias', async ({ page, context }) => {
  await addImage(page, { name: 'a' });
  await expectSavedNames(page, ['a']);
  const b = await context.newPage();
  await b.goto('/');
  await expect(b.locator('#toast')).toContainText('abierto en otra pestaña');
  await expect(b.locator('#saveInfo')).toContainText('otra pestaña');
  await addImage(b, { name: 'b', color: '#cc3333' });
  await expectSavedNames(b, ['a', 'b']);
  // la primera guarda su póster (a y c) y, con él, borra el archivo de «b», que no conoce
  await addImage(page, { name: 'c', color: '#33aa33' });
  await expectSavedNames(page, ['a', 'c']);
  // la segunda cambia algo: tiene que volver a escribir «b», aunque la daba por guardada
  await selectRow(b);
  await b.keyboard.press('ArrowRight');
  await expectSavedNames(b, ['a', 'b']);
  await page.close();
  await b.reload();
  await expect(b.locator('#toast')).toContainText('Se recuperó tu póster'); // todo vuelve, y ya es la única pestaña
  expect(await listNames(b)).toEqual(['b', 'a']);
});
