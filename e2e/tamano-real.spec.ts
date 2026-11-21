/** Tamaño real (1:1) de un PDF o un SVG: moldes, planos y plantillas a su medida exacta. */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addFile, closeCards, makePdf, openApp, savedBox, saved, selectRow } from './helpers';

test.beforeEach(async ({ page }) => { await openApp(page); });

test('un PDF dice cuánto mide y «Usar tamaño real» lo pone al 100 % con el póster a su medida', async ({ page }) => {
  // makePdf hace páginas A5 apaisadas: 21 × 14,8 cm
  await addFile(page, 'molde.pdf', 'application/pdf', await makePdf([{ rgb: [30, 90, 200] }]));
  const toast = page.locator('#toast');
  await expect(toast).toContainText('«molde» mide 21,0 × 14,8 cm');
  await toast.getByRole('button', { name: 'Usar tamaño real' }).click();
  await expect(toast).toContainText('Al 100 %: 21,0 × 14,8 cm');
  await expect(toast).toContainText('2 × 1 hojas A4');
  await expect.poll(async () => (await saved(page))?.layout.size, { timeout: 15_000 }).toEqual({ w: 210, h: 148 });
  const b = await savedBox(page);
  expect(b.w).toBeCloseTo(210, 0); expect(b.h).toBeCloseTo(148, 0);
  expect(b.x0).toBeCloseTo(0, 3); expect(b.y0).toBeCloseTo(0, 3);
  // un solo paso de deshacer lo devuelve todo
  await closeCards(page);
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await saved(page))?.layout.size ?? null, { timeout: 15_000 }).toBeNull();
  // en una sola hoja grande, la página del PDF mide lo mismo que el molde
  await page.keyboard.press('Control+y');
  await page.locator('#exportMore').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportSingle').click()]);
  const pdf = (await readFile((await download.path())!)).toString('latin1');
  const [, w, h] = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf)!;
  expect((+w! * 25.4) / 72).toBeCloseTo(210, 1);
  expect((+h! * 25.4) / 72).toBeCloseTo(148, 1);
});

test('el botón «Tamaño real» solo aparece en lo que dice su medida (SVG en mm sí, en px no)', async ({ page }) => {
  const svg = (w: string, h: string) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 100 50"><rect width="100" height="50" fill="#e33"/></svg>`);
  await addFile(page, 'plantilla.svg', 'image/svg+xml', svg('100mm', '50mm'));
  await expect(page.locator('#toast')).toContainText('«plantilla» mide 10,0 × 5,0 cm');
  await selectRow(page);
  await expect(page.locator('#realSize')).toBeVisible();
  await page.locator('#realSize').click();
  await expect.poll(async () => (await saved(page))?.layout.size, { timeout: 15_000 }).toEqual({ w: 100, h: 50 });
  await addFile(page, 'icono.svg', 'image/svg+xml', svg('800px', '400px'));
  await selectRow(page);
  await expect(page.locator('#realSize')).toBeHidden();
});

test('con más imágenes, el póster no cambia: solo la imagen se pone al 100 %', async ({ page }) => {
  await addFile(page, 'a.pdf', 'application/pdf', await makePdf([{ rgb: [200, 30, 30] }]));
  await addFile(page, 'b.pdf', 'application/pdf', await makePdf([{ rgb: [30, 200, 30] }]));
  await selectRow(page); // la de arriba: b
  await page.locator('#realSize').click();
  await expect(page.locator('#toast')).toContainText('Al 100 %: 21,0 × 14,8 cm.');
  await expect(page.locator('#toast')).not.toContainText('El póster se ajustó');
  expect((await saved(page))?.layout.size ?? null).toBeNull();
});
