/** Identidad pública, cabecera adaptable y continuidad con los datos de Pliego. */
import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { addImage, expectSavedNames, listNames, openApp } from './helpers';

test.use({ colorScheme: 'light' }); // La marca abre en oscuro incluso si el sistema usa claro.

test('la marca y sus recursos funcionan con la CSP de producción', async ({ page, request }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    Object.defineProperty(window, '__brandCsp', { value: violations });
    document.addEventListener('securitypolicyviolation', (e) => violations.push(`${e.violatedDirective}: ${e.blockedURI}`));
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1, name: 'engrande' })).toHaveCount(1);
  await expect(page.locator('#empty .welcome-logo img')).toBeVisible();
  await expect(page).toHaveTitle('engrande · Pósters por hojas, a tu medida');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).colorScheme)).toBe('dark');
  await expect(page.locator('meta[property="og:site_name"]')).toHaveAttribute('content', 'engrande');
  const imageUrl = new URL((await page.locator('meta[property="og:image"]').getAttribute('content'))!);
  expect(imageUrl.origin).toBe('https://pliego-omega.vercel.app'); // Se conserva el origen público.
  const og = await request.get(imageUrl.pathname + imageUrl.search);
  expect(og.ok()).toBe(true);
  const bytes = await og.body();
  expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([1200, 630]);
  const schema = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
  expect(schema.name).toBe('engrande');
  expect(schema.url).toBe('https://pliego-omega.vercel.app/');
  await page.evaluate(async () => {
    const sources = ['/brand-symbol.svg', '/favicon.svg', '/favicon-96.png', '/apple-touch-icon.png'];
    await Promise.all(sources.map(async (src) => { const img = new Image(); img.src = src; await img.decode(); }));
  });
  const ico = await request.get('/favicon.ico');
  expect(ico.ok()).toBe(true);
  expect((await ico.body()).readUInt16LE(4)).toBe(3);
  expect(await page.evaluate(() => Reflect.get(window, '__brandCsp') as string[])).toEqual([]);
});

test('la bienvenida presenta la marca solo con el póster vacío; la cabecera no la repite', async ({ page }) => {
  await openApp(page);
  const welcome = page.locator('#empty');
  await expect(welcome.locator('.welcome-logo')).toHaveText('engrande');
  await expect(welcome.getByText('Dale espacio a lo que imaginas.')).toBeVisible();
  for (const name of [/Elegir imagen o PDF/, /Pegar una imagen/, /Atajos y ayuda/]) await expect(welcome.getByRole('button', { name })).toBeVisible();
  await expect(page.locator('header img')).toHaveCount(0);
  // Ctrl+O elige archivos, como el botón
  const chooser = page.waitForEvent('filechooser');
  await page.keyboard.press('Control+o');
  await chooser;
  // cualquier acción que muestra el papel la quita (si no, quedaría encima de la hoja blanca); deshacer la devuelve
  await page.locator('#presets [data-c="3"][data-r="1"]').click();
  await expect(welcome).toBeHidden();
  await page.locator('#undo').click();
  await expect(welcome).toBeVisible();
  await page.locator('[data-paper="A3"]').click();
  await expect(welcome).toBeHidden();
  await page.locator('#undo').click();
  await expect(welcome).toBeVisible();
  // con la primera imagen desaparece; con «Nuevo» (lienzo nuevo) vuelve
  await addImage(page);
  await expect(welcome).toBeHidden();
  await page.locator('#newPoster').click();
  await expect(welcome.locator('.welcome-logo')).toBeVisible();
});

test('las acciones de la cabecera caben en móvil, tableta y junto al panel de escritorio', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  for (const width of [320, 360, 520, 640, 959, 960, 1024, 1088, 1280]) {
    await test.step(`${width} px`, async () => {
      await page.setViewportSize({ width, height: 860 });
      const boxes = await page.locator('header').evaluate((header) => ({
        header: header.getBoundingClientRect().toJSON(),
        buttons: [...header.querySelectorAll('button')].map((b) => b.getBoundingClientRect().toJSON()),
      }));
      for (const box of boxes.buttons) {
        expect(box.x).toBeGreaterThanOrEqual(boxes.header.x);
        expect(box.x + box.width).toBeLessThanOrEqual(boxes.header.x + boxes.header.width);
        expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      for (const name of ['Nuevo póster', 'Agregar imagen', 'Descargar PDF']) {
        await expect(page.locator('header').getByRole('button', { name, exact: true })).toBeVisible();
      }
    });
  }
});

test('recupera las preferencias históricas y sigue guardando en la base existente', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('pliego.margin')) {
      localStorage.setItem('pliego.margin', '9');
      localStorage.setItem('pliego.relayout', 'keep');
    }
  });
  await page.goto('/');
  await expect(page.locator('#margin')).toHaveValue('9');
  await expect(page.locator('[data-relayout="keep"]')).toHaveAttribute('aria-pressed', 'true');
  await addImage(page, { name: 'póster anterior' });
  await expectSavedNames(page, ['póster anterior']); // El ayudante lee IndexedDB «pliego».
  await page.reload();
  await expect(page.locator('#toast')).toContainText('Se recuperó tu póster');
  expect(await listNames(page)).toEqual(['póster anterior']);
});

test('los otros PDF descargados también llevan la nueva marca', async ({ page }) => {
  await page.goto('/');
  const marginDownload = page.waitForEvent('download');
  await page.locator('#marginTest').click();
  const margins = await marginDownload;
  expect(margins.suggestedFilename()).toBe('engrande-prueba-margenes-A4-vertical.pdf');
  expect((await readFile((await margins.path())!)).subarray(0, 4).toString()).toBe('%PDF');
  await addImage(page, { w: 600, h: 400 });
  await page.locator('#tab-export').click();
  const singleDownload = page.waitForEvent('download');
  await page.locator('#exportSingle').click();
  const single = await singleDownload;
  expect(single.suggestedFilename()).toMatch(/^engrande-\d+x\d+cm\.pdf$/);
  expect((await readFile((await single.path())!)).subarray(0, 4).toString()).toBe('%PDF');
});
