/** El panel según la selección (pestañas o la tarjeta de lo seleccionado) y la barra de herramientas fija. */
import { expect, test } from '@playwright/test';
import { addImage, openApp, selectRow, startText } from './helpers';

test('con algo seleccionado el panel es su tarjeta; al deseleccionar vuelven las pestañas', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#selectionCard')).toBeHidden();
  await expect(page.locator('#sheetTabs')).toBeVisible();
  await startText(page);
  await page.locator('.text-editor').fill('Texto contextual');
  await page.locator('.text-editor').press('Escape');
  // la tarjeta ocupa el panel: sin pestañas ni lista de capas, solo lo del texto
  await expect(page.locator('#selectionTitle')).toHaveText('Texto');
  await expect(page.locator('#selectionCard')).toBeVisible();
  await expect(page.locator('#sheetTabs')).toBeHidden();
  await expect(page.locator('#posterLayers')).toBeHidden();
  await expect(page.locator('#tSize')).toBeVisible();
  await expect(page.locator('#pW')).toBeHidden(); // posición y tamaño, plegados en un texto
  await page.locator('#selectionGeometry').locator('summary').click();
  await expect(page.locator('#pW')).toBeVisible();
  // ✕ deselecciona: vuelven las pestañas
  await page.locator('#selectionClose').click();
  await expect(page.locator('#selectionCard')).toBeHidden();
  await expect(page.locator('#sheetTabs')).toBeVisible();
  // una imagen: su tarjeta, sin los controles del texto
  await addImage(page);
  await expect(page.locator('#selectionTitle')).toHaveText('Imagen');
  await expect(page.locator('#tSize')).toBeHidden();
  await expect(page.locator('#pW')).toBeVisible();
  // Esc también deselecciona; elegir en la lista vuelve a mostrar la tarjeta
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await expect(page.locator('#selectionCard')).toBeHidden();
  await selectRow(page);
  await expect(page.locator('#selectionCard')).toBeVisible();
});

test('la barra de herramientas es fija y cambia con la selección', async ({ page }) => {
  await openApp(page);
  const bar = page.locator('#ctxbar');
  await expect(bar).toBeHidden(); // con la bienvenida, que ya tiene esas acciones
  await addImage(page);
  await expect(bar.locator('[data-act=crop]')).toBeVisible();
  // abajo, en la fila de las herramientas, sin taparlas
  const tools = (await page.locator('#tools').boundingBox())!, b0 = (await bar.boundingBox())!;
  expect(Math.abs(b0.y + b0.height - (tools.y + tools.height))).toBeLessThan(2);
  expect(b0.x).toBeGreaterThan(tools.x + tools.width);
  // mover la imagen no mueve la barra
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowDown');
  expect(await bar.boundingBox()).toEqual(b0);
  // sin selección: agregar imagen o texto
  await page.keyboard.press('Escape');
  await expect(bar.locator('[data-addtext]')).toBeVisible();
  await expect(bar.locator('[data-addfile]')).toBeVisible();
  await expect(bar.locator('[data-act=crop]')).toHaveCount(0);
  // agregar texto: no crea nada hasta elegir dónde (cursor de texto, botón marcado); Esc lo cancela
  await bar.locator('[data-addtext]').click();
  await expect(bar.locator('[data-addtext]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#cv')).toHaveCSS('cursor', 'text');
  await expect(page.locator('.text-editor')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(bar.locator('[data-addtext]')).toHaveAttribute('aria-pressed', 'false');
  // un clic lo pone ahí: el texto empieza en ese punto (alineado a la izquierda)
  await bar.locator('[data-addtext]').click();
  await page.locator('#cv').click({ position: { x: 300, y: 200 } });
  const box = page.locator('.text-editor');
  await expect(box).toBeFocused();
  const r = (await box.boundingBox())!, cv = (await page.locator('#cv').boundingBox())!;
  expect(Math.abs(r.x - (cv.x + 300))).toBeLessThan(4);
  expect(Math.abs(r.y - (cv.y + 200))).toBeLessThan(4);
  await expect(bar.locator('[data-addtext]')).toHaveAttribute('aria-pressed', 'false'); // ya colocado: el modo termina
});

test('arrastrar un recuadro con «Agregar texto» crea un texto de ese ancho; un clic sobre un texto lo edita', async ({ page }) => {
  await openApp(page);
  await page.locator('[data-addtext]:visible').first().click();
  const cv = (await page.locator('#cv').boundingBox())!;
  await page.mouse.move(cv.x + 200, cv.y + 200); await page.mouse.down();
  await page.mouse.move(cv.x + 700, cv.y + 260, { steps: 6 }); await page.mouse.up();
  const box = page.locator('.text-editor');
  await expect(box).toBeFocused();
  await page.keyboard.type('Uno dos tres cuatro cinco seis siete');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tWidth [data-w="fixed"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => +(await page.locator('#pW').inputValue()).replace(',', '.')).toBeGreaterThan(15);
  // otra vez «Agregar texto» y clic sobre el texto: se edita ese, no se crea otro
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  await page.locator('#cv').click({ position: { x: 230, y: 230 } });
  await expect(box).toHaveValue('Uno dos tres cuatro cinco seis siete');
});

test('la tarjeta es accesible en móvil y no desborda', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await startText(page);
  await page.locator('.text-editor').fill('Texto');
  await page.locator('.text-editor').press('Escape');
  // plegada, la hoja deja ver la cabecera de la tarjeta (no las pestañas)
  await expect(page.locator('#selectionHead')).toBeVisible();
  await page.locator('#sheetHandle').click();
  await expect(page.locator('#selectionCard')).toBeVisible();
  await page.locator('#tColorHex').scrollIntoViewIfNeeded();
  const bounds = (await page.locator('#selectionCard').boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('tarjeta-movil.png') });
});
