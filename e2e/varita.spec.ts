/**
 * Varita que elige, como en Photoshop: un clic elige la zona de un color sin borrarla (se ve teñida), Shift + clic la
 * suma, Alt + clic la resta, Esc la quita y Supr la borra (no la imagen), en un paso que se puede deshacer.
 */
import { expect, test, type Page } from '@playwright/test';
import { addImage, openApp, savedBox, screenMap } from './helpers';

/** Clave del lienzo editado de la primera imagen en lo guardado (null: sin retoques). */
const editKey = (page: Page) => page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>((resolve) => { const req = indexedDB.open('pliego'); req.onsuccess = () => resolve(req.result); });
  try {
    const req = db.transaction('project').objectStore('project').get('current');
    return await new Promise<string | null | undefined>((resolve) => { req.onsuccess = () => resolve(req.result?.layers[0]?.edit); });
  } finally { db.close(); }
});
/** Color del lienzo en un punto de la pantalla. */
const colorAt = (page: Page, p: { x: number; y: number }) => page.evaluate(({ x, y }) => {
  const cv = document.querySelector<HTMLCanvasElement>('#cv')!, r = cv.getBoundingClientRect(), k = cv.width / r.width;
  return [...cv.getContext('2d')!.getImageData(Math.round((x - r.left) * k), Math.round((y - r.top) * k), 1, 1).data.slice(0, 3)];
}, p);
const blue = (c: number[]) => c[2]! > 150 && c[0]! < 90; // el cuadrado azul de addImage, sin teñir

test('la varita elige sin borrar, suma con Shift, resta con Alt y borra lo elegido con Supr', async ({ page }) => {
  await openApp(page);
  await addImage(page, { color: '#3399cc' }); // fondo blanco con un cuadrado azul en el centro
  const b = await savedBox(page), m = await screenMap(page, b);
  const white = m.toScreen(b.x0 + b.w * 0.08, b.y0 + b.h * 0.08), center = m.toScreen(b.x0 + b.w / 2, b.y0 + b.h / 2);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('w');
  const chosen = page.locator('#ctxbar [data-act=wInvert]'); // «Invertir» solo está con algo elegido
  await expect(chosen).toHaveCount(0);
  expect(blue(await colorAt(page, center))).toBe(true);

  // un clic en el blanco lo elige, sin borrar nada
  await page.mouse.click(white.x, white.y);
  await expect(chosen).toBeVisible();
  await page.waitForTimeout(1500); // el guardado espera 1,2 s
  expect(await editKey(page)).toBeFalsy();

  // Shift + clic suma el azul (se ve teñido); Alt + clic lo vuelve a quitar
  await page.keyboard.down('Shift'); await page.mouse.click(center.x, center.y); await page.keyboard.up('Shift');
  await expect.poll(async () => blue(await colorAt(page, center))).toBe(false);
  await page.keyboard.down('Alt'); await page.mouse.click(center.x, center.y); await page.keyboard.up('Alt');
  await expect.poll(async () => blue(await colorAt(page, center))).toBe(true);
  await expect(chosen).toBeVisible(); // el blanco sigue elegido

  // Esc quita lo elegido sin salir de la varita
  await page.keyboard.press('Escape');
  await expect(chosen).toHaveCount(0);
  await expect(page.locator('#bTol')).toBeVisible();

  // Supr borra lo elegido (no la imagen), en un paso que se puede deshacer
  await page.mouse.click(white.x, white.y);
  await expect(chosen).toBeVisible();
  await page.keyboard.press('Delete');
  await expect(chosen).toHaveCount(0);
  await expect(page.locator('#layers li.layer')).toHaveCount(1);
  await expect.poll(() => editKey(page)).toMatch(/^px-/);
  await page.locator('#undo').click();
  await expect.poll(() => editKey(page)).toBeFalsy();
});

test('sin teclas (táctil), los botones de la barra eligen si el clic suma o resta', async ({ page }) => {
  await openApp(page);
  await addImage(page, { color: '#3399cc' });
  const b = await savedBox(page), m = await screenMap(page, b);
  const white = m.toScreen(b.x0 + b.w * 0.08, b.y0 + b.h * 0.08), center = m.toScreen(b.x0 + b.w / 2, b.y0 + b.h / 2);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('w');
  const bar = page.locator('#ctxbar');
  await page.mouse.click(white.x, white.y);
  await bar.getByRole('button', { name: 'Sumar zona' }).click();
  await expect(bar.getByRole('button', { name: 'Sumar zona' })).toHaveAttribute('aria-pressed', 'true');
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => blue(await colorAt(page, center))).toBe(false);
  // restar el azul y después invertir: el azul vuelve a quedar elegido (y el blanco ya no)
  await bar.getByRole('button', { name: 'Restar zona' }).click();
  await page.mouse.click(center.x, center.y);
  await expect.poll(async () => blue(await colorAt(page, center))).toBe(true);
  await bar.getByRole('button', { name: 'Invertir' }).click();
  await expect.poll(async () => blue(await colorAt(page, center))).toBe(false);
});

test('elegir con la varita se deshace y se rehace con Ctrl+Z y Ctrl+Y; deshacer un borrado devuelve lo elegido', async ({ page }) => {
  await openApp(page);
  await addImage(page, { color: '#3399cc' });
  const b = await savedBox(page), m = await screenMap(page, b);
  const white = m.toScreen(b.x0 + b.w * 0.08, b.y0 + b.h * 0.08), center = m.toScreen(b.x0 + b.w / 2, b.y0 + b.h / 2);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('w');
  const chosen = page.locator('#ctxbar [data-act=wInvert]');
  await page.mouse.click(white.x, white.y);
  await page.keyboard.down('Shift'); await page.mouse.click(center.x, center.y); await page.keyboard.up('Shift');
  await expect.poll(async () => blue(await colorAt(page, center))).toBe(false);
  // Ctrl+Z quita el último paso (el azul sumado) y después el primero; Ctrl+Y los devuelve
  await page.keyboard.press('Control+z');
  await expect.poll(async () => blue(await colorAt(page, center))).toBe(true);
  await expect(chosen).toBeVisible();
  await page.keyboard.press('Control+z');
  await expect(chosen).toHaveCount(0);
  await expect(page.locator('#bTol')).toBeVisible(); // sigue en la varita
  await page.keyboard.press('Control+y');
  await expect(chosen).toBeVisible();
  // borrar y deshacer: vuelve la imagen y lo que estaba elegido
  await page.keyboard.press('Delete');
  await expect.poll(() => editKey(page)).toMatch(/^px-/);
  await expect(chosen).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect.poll(() => editKey(page)).toBeFalsy();
  await expect(chosen).toBeVisible();
});

test('duplicar o pegar con la varita activa vuelve a Mover, con lo nuevo seleccionado', async ({ page }) => {
  await openApp(page);
  await addImage(page, { color: '#3399cc' });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('w');
  await expect(page.locator('#toolbar [data-tool=wand]')).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Control+d');
  await expect(page.locator('#layers li.layer')).toHaveCount(2);
  await expect(page.locator('#toolbar [data-tool=move]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#bTol')).toHaveCount(0);
});
