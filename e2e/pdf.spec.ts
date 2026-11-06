/** PDF de entrada: páginas, guardado, colores CMYK y archivos que no se pueden abrir. */
import { expect, test } from '@playwright/test';
import { addFile, expectSavedNames, makePdf, openApp, selectRow, thumbColor } from './helpers';

test.beforeEach(async ({ page }) => { await openApp(page); });

test('un PDF de varias páginas se abre en la 1 y se puede cambiar de página; la página se guarda', async ({ page }) => {
  await addFile(page, 'folleto.pdf', 'application/pdf', await makePdf([{ rgb: [200, 30, 30] }, { rgb: [30, 160, 60] }, { rgb: [30, 60, 200] }]));
  const info = page.locator('#layers li.layer small');
  await expect(info).toContainText('PDF pág. 1');
  expect((await thumbColor(page))[0]).toBeGreaterThan(150); // rojo
  await selectRow(page);
  await expect(page.locator('#pdfPages')).toHaveText('de 3');
  await page.locator('#pdfPage').fill('2');
  await page.locator('#pdfPage').press('Enter');
  await expect(info).toContainText('PDF pág. 2');
  expect((await thumbColor(page))[1]).toBeGreaterThan(120); // verde
  await expectSavedNames(page, ['folleto']);
  await page.reload();
  await expect(info).toContainText('PDF pág. 2');
});

test('una página que no existe se corrige a la última', async ({ page }) => {
  await addFile(page, 'folleto.pdf', 'application/pdf', await makePdf([{ rgb: [200, 30, 30] }, { rgb: [30, 160, 60] }]));
  await selectRow(page);
  await page.locator('#pdfPage').fill('99');
  await page.locator('#pdfPage').press('Enter');
  await expect(page.locator('#pdfPage')).toHaveValue('2');
  await expect(page.locator('#layers li.layer small')).toContainText('PDF pág. 2');
});

test('un PDF en CMYK se convierte a RGB con perfil (cian 100 % se ve cian, no azul puro)', async ({ page }) => {
  await addFile(page, 'imprenta.pdf', 'application/pdf', await makePdf([{ cmyk: [1, 0, 0, 0] }]));
  await expect(page.locator('#layers li.layer small')).toContainText('PDF pág. 1');
  const [r, g, b] = await thumbColor(page);
  // con el perfil de pdf.js, cian 100 % ≈ (0, 173, 239); una conversión ingenua daría (0, 255, 255)
  expect(r).toBeLessThan(40);
  expect(g).toBeGreaterThan(140); expect(g).toBeLessThan(210);
  expect(b).toBeGreaterThan(200);
});

test('un archivo que no es imagen ni PDF se rechaza con un aviso claro', async ({ page }) => {
  await addFile(page, 'notas.txt', 'text/plain', Buffer.from('hola'));
  await expect(page.locator('#toast')).toContainText('«notas.txt» no es una imagen ni un PDF');
  await expect(page.locator('#layers li.layer')).toHaveCount(0);
});

test('un PDF dañado no rompe nada: avisa y el póster sigue vacío', async ({ page }) => {
  await addFile(page, 'roto.pdf', 'application/pdf', Buffer.from('%PDF-1.7\nesto no es un PDF de verdad'));
  await expect(page.locator('#toast')).toContainText('No se pudo abrir «roto.pdf»');
  await expect(page.locator('#layers li.layer')).toHaveCount(0);
  await expect(page.locator('#empty')).toBeVisible();
});
