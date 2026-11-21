/** Tamaño del póster por medidas y hojas en blanco que no se imprimen. */
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { addImage, closeCards, openApp, openPdfCard, openTab, saved } from './helpers';

test.beforeEach(async ({ page }) => { await openApp(page); });

/** Escribe una medida en cm en el campo de ancho o alto del póster (Enter aplica). */
async function setSize(page: Page, w: string, h: string) {
  await openTab(page, 'sheets');
  await page.locator('#sizeW').fill(w); await page.locator('#sizeW').press('Enter');
  await page.locator('#sizeH').fill(h); await page.locator('#sizeH').press('Enter');
}
const pdfPagesOf = async (page: Page) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#quickExport').click()]);
  const pdf = (await readFile((await download.path())!)).toString('latin1');
  return { name: download.suggestedFilename(), pages: pdf.match(/\/Type \/Page[^s]/g)?.length ?? 0 };
};

test('una medida en cm calcula las hojas, sobrevive a recargar y se deshace en un paso', async ({ page }) => {
  await addImage(page);
  await setSize(page, '100', '70');
  await expect(page.locator('#sizeNote')).toContainText('6 × 3 hojas A4 vertical');
  await expect(page.locator('#sizeNote')).toContainText('a medias');
  await expect(page.locator('#colsOut')).toHaveText('6');
  // ninguna distribución por hojas queda marcada: el tamaño lo eligió el usuario
  await expect(page.locator('#presets [aria-pressed="true"]')).toHaveCount(0);
  await expect.poll(async () => (await saved(page))?.layout.size, { timeout: 15_000 }).toEqual({ w: 1000, h: 700 });
  // cambiar el papel conserva la medida y recalcula las hojas
  await page.locator('[data-paper="A3"]').click();
  await expect(page.locator('#sizeW')).toHaveValue('100');
  await expect(page.locator('#sizeNote')).toContainText('4 × 2 hojas A3');
  await page.reload();
  await expect(page.locator('#toast')).toContainText('Se recuperó tu póster');
  await openTab(page, 'sheets');
  await expect(page.locator('#sizeH')).toHaveValue('70');
  await expect(page.locator('#sizeNote')).toContainText('4 × 2 hojas A3');
});

test('cada medida es un paso de deshacer; deshacer la primera vuelve a las hojas', async ({ page }) => {
  await addImage(page);
  await setSize(page, '80', '60');
  await expect(page.locator('#sizeH')).toHaveValue('60');
  await closeCards(page);
  await page.keyboard.press('Control+z'); // el alto
  await openTab(page, 'sheets');
  await expect(page.locator('#sizeW')).toHaveValue('80');
  await expect(page.locator('#sizeH')).toHaveValue('28,5');
  await closeCards(page);
  await page.keyboard.press('Control+z'); // el ancho: vuelve a 2 × 1 hojas
  await openTab(page, 'sheets');
  await expect(page.locator('#sizeW')).toHaveValue('38,6');
  await expect(page.locator('#presets [data-c="2"][data-r="1"]')).toHaveAttribute('aria-pressed', 'true');
});

test('sugiere la orientación con menos hojas y elegir hojas vuelve a mandar', async ({ page }) => {
  await addImage(page);
  await setSize(page, '100', '70');
  const tip = page.locator('#sizeTips .tip').filter({ hasText: 'horizontal' });
  await expect(tip).toContainText('16 en vez de 18');
  await tip.getByRole('button', { name: 'Cambiar' }).click();
  await expect(page.locator('[data-orient="landscape"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#sizeNote')).toContainText('4 × 4 hojas A4 horizontal');
  await expect(page.locator('#sizeW')).toHaveValue('100');
  // una distribución por hojas quita la medida
  await page.locator('#presets [data-c="2"][data-r="2"]').click();
  await expect(page.locator('#presets [data-c="2"][data-r="2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => (await saved(page))?.layout.size, { timeout: 15_000 }).toBeNull();
});

test('una medida demasiado grande se limita y lo avisa; la que deja poco en la última columna sugiere ajustarla', async ({ page }) => {
  await addImage(page);
  await setSize(page, '900', '50');
  await expect(page.locator('#toast')).toContainText('llega hasta');
  await expect(page.locator('#colsOut')).toHaveText('12');
  // 2 hojas A4 llegan a 38,6 cm: con 40 cm la tercera columna lleva solo 1,4 cm
  await setSize(page, '40', '28,5');
  const tip = page.locator('#sizeTips .tip').filter({ hasText: 'última columna' });
  await expect(tip).toContainText('1,4 cm');
  await tip.getByRole('button', { name: 'Ajustar' }).click();
  await expect(page.locator('#sizeW')).toHaveValue('38,6');
  await expect(page.locator('#sizeNote')).toContainText('2 × 1 hojas');
});

test('las hojas en blanco no se imprimen, salvo que se pida', async ({ page }) => {
  // una franja muy alargada en un póster de 3 × 3: solo la fila del medio lleva algo
  await addImage(page, { w: 3000, h: 300, color: '#cc3300' });
  await openTab(page, 'sheets');
  await page.locator('#presets [data-c="3"][data-r="3"]').click();
  await expect(page.locator('#sizeNote')).toContainText('6 en blanco');
  await closeCards(page);
  await expect(page.locator('#quickExport')).toHaveAttribute('title', 'PDF por hojas · 4 páginas · 150 ppp');
  // addImage pinta la imagen con fondo blanco y la franja de color en el centro: las de arriba y abajo quedan blancas
  let out = await pdfPagesOf(page);
  expect(out.pages).toBe(4); // guía + 3
  expect(out.name).toContain('3hojas');
  await openPdfCard(page);
  await expect(page.locator('#exportSummary')).toContainText('6 en blanco no se imprimen');
  await page.locator('#skipBlank').uncheck();
  await expect(page.locator('#quickExport')).toHaveAttribute('title', 'PDF por hojas · 10 páginas · 150 ppp');
  await page.keyboard.press('Escape');
  out = await pdfPagesOf(page);
  expect(out.pages).toBe(10);
  await expect.poll(async () => (await saved(page))?.skipBlank, { timeout: 15_000 }).toBe(false);
});

test('si nada cae dentro del póster, no deja descargar un PDF vacío', async ({ page }) => {
  await addImage(page, { color: '#ffffff' }); // imagen toda blanca
  await expect(page.locator('#quickExport')).toBeDisabled();
  await expect(page.locator('#quickExport')).toHaveAttribute('title', /todas las hojas saldrían en blanco/);
});
