/** Guardar el proyecto en un archivo (.engrande) y abrirlo en otro navegador. */
import { readFile } from 'node:fs/promises';
import { expect, test } from '@playwright/test';
import { addImage, closeCards, openApp, openPdfCard, openTab, saved, startText } from './helpers';

test('guardar el proyecto y abrirlo en un navegador limpio deja el póster igual', async ({ page, browser }) => {
  await openApp(page);
  await addImage(page, { name: 'foto', color: '#22aa44' });
  await startText(page);
  await page.keyboard.type('Hola');
  await page.keyboard.press('Escape');
  await openTab(page, 'sheets');
  await page.locator('#sizeW').fill('80'); await page.locator('#sizeW').press('Enter');
  await closeCards(page);
  await expect.poll(async () => (await saved(page))?.names.length, { timeout: 15_000 }).toBe(2);
  const before = (await saved(page))!;

  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  expect(download.suggestedFilename()).toMatch(/^engrande-\d{4}-\d{2}-\d{2}\.engrande$/);
  const file = await readFile((await download.path())!);
  expect(file.subarray(0, 8).toString()).toBe('ENGRANDE');

  // otro navegador, sin nada guardado: se abre arrastrándolo… o con el selector, como una imagen
  const ctx = await browser.newContext();
  const other = await ctx.newPage();
  await openApp(other);
  await other.locator('#file').setInputFiles({ name: 'mi-poster.engrande', mimeType: 'application/octet-stream', buffer: file });
  await expect(other.locator('#toast')).toContainText('Proyecto abierto');
  await expect(other.locator('#layers li.layer')).toHaveCount(2);
  await expect.poll(async () => (await saved(other))?.names, { timeout: 15_000 }).toEqual(before.names);
  const after = (await saved(other))!;
  expect(after.layout).toEqual(before.layout);
  after.boxes.forEach((b, i) => { expect(b.x0).toBeCloseTo(before.boxes[i]!.x0, 3); expect(b.w).toBeCloseTo(before.boxes[i]!.w, 3); });
  await ctx.close();
});

test('abrir un proyecto sustituye al póster y se puede deshacer', async ({ page }) => {
  await openApp(page);
  await addImage(page, { name: 'primera' });
  const [download] = await Promise.all([page.waitForEvent('download'), page.keyboard.press('Control+s')]);
  const file = await readFile((await download.path())!);
  await addImage(page, { name: 'segunda' });
  await expect(page.locator('#layers li.layer')).toHaveCount(2);
  await page.locator('#file').setInputFiles({ name: 'copia.engrande', mimeType: '', buffer: file });
  await expect(page.locator('#toast')).toContainText('Proyecto abierto');
  await expect(page.locator('#layers li.layer')).toHaveCount(1);
  await page.locator('#toast').getByRole('button', { name: 'Deshacer' }).click();
  await expect(page.locator('#layers li.layer')).toHaveCount(2);
});

test('un archivo .engrande dañado avisa y no toca el póster', async ({ page }) => {
  await openApp(page);
  await addImage(page);
  await page.locator('#file').setInputFiles({ name: 'roto.engrande', mimeType: '', buffer: Buffer.from('ENGRANDE\x01\xff\xff\xff\x00basura') });
  await expect(page.locator('#toast')).toContainText('dañado');
  await expect(page.locator('#layers li.layer')).toHaveCount(1);
});

test('la tarjeta del PDF ofrece guardar y abrir el proyecto', async ({ page }) => {
  await openApp(page);
  await addImage(page);
  await openPdfCard(page);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#saveProject').click()]);
  expect(download.suggestedFilename()).toMatch(/\.engrande$/);
  await expect(page.locator('#pdfCard')).toBeHidden();
  await openPdfCard(page);
  const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.locator('#openProject').click()]);
  expect(chooser.isMultiple()).toBe(true);
});
