/** Copiar y pegar, recorte con proporciones y descarga del PDF. */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { addImage, listNames, openApp, selectRow } from './helpers';

test.beforeEach(async ({ page }) => { await openApp(page); });

test('Ctrl+C en Pliego pisa el portapapeles: Ctrl+V pega la copia, no una imagen vieja de otra app', async ({ page, context, baseURL }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL });
  await addImage(page);
  // en el portapapeles del sistema hay una captura copiada antes en otra app
  await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 40; c.height = 30;
    c.getContext('2d')!.fillRect(0, 0, 40, 30);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
  });
  await selectRow(page);
  await page.keyboard.press('Control+c');
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('foto');
  await page.keyboard.press('Control+v');
  await expect(page.locator('#layers li.layer')).toHaveCount(2);
  expect(await listNames(page)).toEqual(['foto*', 'foto']); // la copia, no «imagen pegada»
});

test('ir y venir entre proporciones de recorte no encoge el marco; «Libre» lo devuelve entero', async ({ page }) => {
  await addImage(page);
  await selectRow(page);
  const size = async () => `${await page.locator('#pW').inputValue()} × ${await page.locator('#pH').inputValue()}`;
  const start = await size();
  await page.keyboard.press('c');
  const ratio = (r: string) => page.locator(`#ctxbar [data-act=ratio][data-r="${r}"]`).click();
  await ratio(String(16 / 9));
  const wide = await size();
  for (let i = 0; i < 5; i++) { await ratio(String(3 / 4)); await ratio(String(16 / 9)); }
  expect(await size()).toBe(wide);
  await ratio('null');
  expect(await size()).toBe(start);
});

test('«Descargar PDF por hojas» genera una página de guía y una por hoja, del tamaño del papel', async ({ page }) => {
  await addImage(page);
  await page.locator('#tab-export').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#exportTiles').click()]);
  expect(download.suggestedFilename()).toBe('pliego-2x1-A4.pdf');
  const pdf = (await readFile((await download.path())!)).toString('latin1');
  expect(pdf.match(/\/Type \/Page[^s]/g)).toHaveLength(3); // guía + 2 hojas
  expect([...new Set(pdf.match(/\/MediaBox \[[^\]]+\]/g))]).toEqual(['/MediaBox [0 0 595.2755905511811534 841.8897637795276978]']); // A4
});
