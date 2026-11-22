/** Copiar y pegar, recorte con proporciones y descarga del PDF. */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { addImage, listNames, openApp, openPdfCard, openTab, pdfCardButton, saved, savedBox, screenMap, selectRow } from './helpers';

test.beforeEach(async ({ page }) => { await openApp(page); });

test('Ctrl+C en engrande pisa el portapapeles: Ctrl+V pega la copia, no una imagen vieja de otra app', async ({ page, context, baseURL }) => {
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
  await expect(page.locator('#quickExport')).toHaveAttribute('title', 'PDF por hojas · 2 páginas · 150 ppp');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#quickExport').click()]);
  expect(download.suggestedFilename()).toBe('engrande-1x1-A4.pdf');
  const pdf = (await readFile((await download.path())!)).toString('latin1');
  expect(pdf.match(/\/Type \/Page[^s]/g)).toHaveLength(2); // guía + 1 hoja
  expect([...new Set(pdf.match(/\/MediaBox \[[^\]]+\]/g))]).toEqual(['/MediaBox [0 0 595.2755905511811534 841.8897637795276978]']); // A4
  // la flecha abre la tarjeta del PDF: qué se descarga, sus opciones y las salidas; Esc la cierra
  await openPdfCard(page);
  const card = page.locator('#pdfCard');
  await expect(card.locator('#exportSummary')).toContainText('Póster 19,8 × 28,5 cm · 1 hoja A4');
  await expect(card.locator('#exportSummary')).toContainText('PDF por hojas: 2 páginas (con la guía) · 150 ppp');
  await card.locator('[data-dpi="200"]').click();
  await expect(page.locator('#quickExport')).toHaveAttribute('title', 'PDF por hojas · 2 páginas · 200 ppp');
  await page.keyboard.press('Escape');
  await expect(card).toBeHidden();
});

test('50 × 70 cm se conserva al cambiar de papel, recargar y descargar a tamaño real', async ({ page }) => {
  await openTab(page, 'sheets');
  await page.locator('#bySize').click();
  for (const [id, value] of [['#posterWidth', '50'], ['#posterHeight', '70']]) {
    await page.locator(id!).fill(value!);
    await page.locator(id!).press('Enter');
  }
  await expect(page.locator('#tileSummary')).toContainText('3 columnas × 3 filas · 9 hojas A4');
  await page.locator('[data-paper=A3]').click();
  await expect(page.locator('#tileSummary')).toContainText('2 columnas × 2 filas · 4 hojas A3');
  await expect.poll(async () => (await saved(page))?.layout.paper).toBe('A3');
  await page.reload();
  await openTab(page, 'sheets');
  await expect(page.locator('#posterWidth')).toHaveValue('50');
  await expect(page.locator('#posterHeight')).toHaveValue('70');
  await addImage(page);
  const [file] = await Promise.all([page.waitForEvent('download'), pdfCardButton(page, '#exportSingle')]);
  const pdf = (await readFile((await file.path())!)).toString('latin1');
  const box = /\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/.exec(pdf)!;
  expect(Number(box[1]) * 25.4 / 72).toBeCloseTo(500, 5);
  expect(Number(box[2]) * 25.4 / 72).toBeCloseTo(700, 5);
});

test('omite blanco puro, conserva trazos tenues y lo de una franja de solape lo imprime una sola vez', async ({ page }) => {
  await openTab(page, 'sheets');
  await page.locator('#presets [data-c="2"][data-r="1"]').click();
  await addImage(page, { color: 'white' });
  await openPdfCard(page);
  await expect(page.locator('#skipBlank')).not.toBeChecked();
  await page.locator('#skipBlank').check();
  await expect(page.locator('#exportSummary')).toContainText('Todas las hojas están en blanco');
  await page.locator('#exportTiles').click();
  await expect(page.locator('#toast')).toContainText('Todas las hojas están en blanco');
  await addImage(page, { color: '#fefefe', name: 'tenue', w: 100, h: 100 });
  await selectRow(page);
  const set = async (id: string, v: string) => { await page.locator(id).fill(v); await page.locator(id).press('Enter'); };
  await set('#pW', '0,5');
  await set('#pX', '25');
  await openPdfCard(page);
  await expect(page.locator('#exportSummary')).toContainText('1 de 2 hojas del póster (la 2) + 1 guía');
  const [file] = await Promise.all([page.waitForEvent('download'), page.locator('#exportTiles').click()]);
  const pdf = (await readFile((await file.path())!)).toString('latin1');
  expect(pdf.match(/\/Type \/Page[^s]/g)).toHaveLength(2);
  // en la franja de solape (188–198 mm) la imprimen las dos hojas: con una basta
  await set('#pX', '19');
  await openPdfCard(page);
  await expect(page.locator('#exportSummary')).toContainText('1 de 2 hojas del póster (la 1) + 1 guía');
  const [solape] = await Promise.all([page.waitForEvent('download'), page.locator('#exportTiles').click()]);
  expect((await readFile((await solape.path())!)).toString('latin1').match(/\/Type \/Page[^s]/g)).toHaveLength(2);
  // de una hoja a la otra, fuera de la franja: hacen falta las dos
  await set('#pW', '30');
  await set('#pX', '5');
  await openPdfCard(page);
  await expect(page.locator('#exportSummary')).toContainText('2 de 2 hojas del póster (las 1 y 2) + 1 guía');
});

test('«Imprimir» abre el PDF por hojas en el cuadro de impresión, sin descargarlo', async ({ page }) => {
  const csp: string[] = [];
  page.on('console', (m) => { if (/Content Security Policy/i.test(m.text())) csp.push(m.text()); });
  await addImage(page);
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await pdfCardButton(page, '#printTiles');
  await expect(page.locator('#pdfCard')).toBeHidden();
  // el PDF va a un marco oculto con el visor del navegador (blob:), permitido por la CSP
  await expect(page.locator('iframe.print-frame')).toHaveAttribute('src', /^blob:/, { timeout: 20_000 });
  await expect(page.locator('#toast')).toContainText('cuadro de impresión');
  expect(downloads).toBe(0);
  expect(csp).toEqual([]);
});

test('retocar una imagen con transparencia parcial no la aclara en el PDF de alta resolución', async ({ page }) => {
  test.setTimeout(90_000);
  // se anota el píxel central de cada página antes de codificarla, y no se descarga nada
  await page.evaluate(() => {
    const w = window as unknown as { __px: number[] };
    w.__px = [];
    const orig = HTMLCanvasElement.prototype.toDataURL;
    HTMLCanvasElement.prototype.toDataURL = function (this: HTMLCanvasElement, ...a: unknown[]) {
      if (a[0] === 'image/jpeg') w.__px.push(this.getContext('2d')!.getImageData(this.width >> 1, this.height >> 1, 1, 1).data[0]!);
      return (orig as (...x: unknown[]) => string).apply(this, a);
    };
    HTMLAnchorElement.prototype.click = function () { /* sin descarga */ };
  });
  // una «sombra»: negro al 50 %, de 3000 px (más que el lienzo de trabajo: al exportar se usa el archivo original)
  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 3000; c.height = 2000;
    const x = c.getContext('2d')!;
    x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, 0, 3000, 2000);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const input = document.querySelector<HTMLInputElement>('#file')!, dt = new DataTransfer();
    dt.items.add(new File([blob], 'sombra.png', { type: 'image/png' }));
    input.files = dt.files; input.dispatchEvent(new Event('change'));
  });
  await expect(page.locator('#layers li.layer')).toHaveCount(1, { timeout: 20_000 });
  await selectRow(page);
  const b = await savedBox(page), m = await screenMap(page, b), corner = m.toScreen(b.x0, b.y0);
  const exported = async (n: number) => {
    await openPdfCard(page);
    await page.locator('[data-dpi="300"]').click();
    await pdfCardButton(page, '#exportSingle');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __px: number[] }).__px.length), { timeout: 40_000 }).toBe(n);
    return page.evaluate(() => (window as unknown as { __px: number[] }).__px.at(-1)!);
  };
  const before = await exported(1);
  expect(before).toBeGreaterThan(120); expect(before).toBeLessThan(135); // negro al 50 % sobre papel blanco
  // se borra un punto en una esquina, lejos del centro
  await openTab(page, 'image');
  await selectRow(page);
  await page.keyboard.press('e');
  await page.mouse.click(corner.x + 12, corner.y + 12);
  await page.keyboard.press('Escape');
  expect(await exported(2)).toBe(before); // el centro sigue igual: no se aplica la transparencia dos veces
});
