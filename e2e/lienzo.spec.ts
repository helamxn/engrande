/** Gestos en el lienzo y rejilla de 1 mm: Alt + clic, Alt + arrastrar, flechas, mover, escalar y Ctrl sin rejilla. */
import { expect, test, type Page } from '@playwright/test';
import { addImage, drag, expectSavedNames, listNames, onMm, openApp, savedBox, screenMap, selectRow } from './helpers';

/** Póster 2×1 A4 con una foto 3:2 ajustada: queda a 13,833 mm del borde de arriba (fuera de la rejilla). */
async function setup(page: Page) {
  await openApp(page);
  await addImage(page);
  await selectRow(page);
  return savedBox(page, (b) => Math.abs(b.y0 - 13.833) < 0.01);
}

test('Alt + clic solo selecciona: no deja una copia encima', async ({ page }) => {
  const b = await setup(page), m = await screenMap(page, b), c = m.toScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  await page.keyboard.down('Alt');
  await page.mouse.click(c.x, c.y);
  await page.keyboard.up('Alt');
  expect(await listNames(page)).toEqual(['foto*']);
});

test('Alt + arrastrar mueve una copia y la original se queda; un deshacer la quita', async ({ page }) => {
  const b = await setup(page), m = await screenMap(page, b), c = m.toScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  await page.keyboard.down('Alt');
  await drag(page, c, { x: c.x - 60, y: c.y });
  await page.keyboard.up('Alt');
  expect(await listNames(page)).toEqual(['foto (copia)*', 'foto']);
  await expectSavedNames(page, ['foto', 'foto (copia)']);
  const orig = await savedBox(page, () => true, 0);
  expect(orig.x0).toBeCloseTo(b.x0, 6);
  await page.locator('#undo').click();
  expect(await listNames(page)).toEqual(['foto*']);
});

test('flechas: primero al mm entero, después de 1 en 1 (con Shift, de 10 en 10)', async ({ page }) => {
  await setup(page);
  await page.keyboard.press('ArrowUp');
  await savedBox(page, (b) => Math.abs(b.y0 - 13) < 1e-6); // 13,833 → 13, no 12,833
  await page.keyboard.press('ArrowUp');
  await savedBox(page, (b) => Math.abs(b.y0 - 12) < 1e-6);
  await page.keyboard.press('Shift+ArrowRight');
  await savedBox(page, (b) => Math.abs(b.x0 - 10) < 1e-6);
});

test('mover con el ratón deja la esquina en un mm entero, salvo si se alinea con algo', async ({ page }) => {
  const b = await setup(page), m = await screenMap(page, b), c = m.toScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  await drag(page, c, { x: c.x - 37.3, y: c.y + 23.7 });
  const a = await savedBox(page, (x) => Math.abs(x.x0 - b.x0) > 1);
  expect(onMm(a.x0)).toBe(true);
  // en vertical, o mm entero o pegada al borde de abajo del póster (285 mm): alinearse tiene prioridad
  expect(onMm(a.y0) || Math.abs(a.y1 - 285) < 1e-6).toBe(true);
});

test('escalar desde una esquina deja el borde que se arrastra en un mm entero', async ({ page }) => {
  const b = await setup(page), m = await screenMap(page, b), se = m.toScreen(b.x1, b.y1);
  await drag(page, se, { x: se.x - 53.3, y: se.y - 41.1 });
  const a = await savedBox(page, (x) => x.w < b.w - 1);
  expect(onMm(a.x1)).toBe(true);
  expect(a.x0).toBeCloseTo(b.x0, 6); // la esquina opuesta no se mueve
});

test('Ctrl + arrastrar desde el principio mueve sin imán ni rejilla (no la deselecciona)', async ({ page }) => {
  const b = await setup(page), m = await screenMap(page, b), c = m.toScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  await page.keyboard.down('Control');
  await drag(page, c, { x: c.x - 23.2, y: c.y });
  await page.keyboard.up('Control');
  const a = await savedBox(page, (x) => Math.abs(x.x0 - b.x0) > 1);
  expect(onMm(a.x0)).toBe(false);
  expect(await listNames(page)).toEqual(['foto*']);
});

test('Ctrl o Shift + clic sin arrastrar sobre una seleccionada la quita de la selección', async ({ page }) => {
  const b = await setup(page), m = await screenMap(page, b), c = m.toScreen((b.x0 + b.x1) / 2, (b.y0 + b.y1) / 2);
  await page.keyboard.down('Control');
  await page.mouse.click(c.x, c.y);
  await page.keyboard.up('Control');
  expect(await listNames(page)).toEqual(['foto']);
  await page.keyboard.down('Shift');
  await page.mouse.click(c.x, c.y); // ahora la vuelve a agregar
  await page.keyboard.up('Shift');
  expect(await listNames(page)).toEqual(['foto*']);
});
