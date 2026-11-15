/** Cada sección cuando hace falta (tarjetas de Póster y Capas, panel de la selección), la barra fija y la isla de vista. */
import { expect, test } from '@playwright/test';
import { addImage, openApp, startText } from './helpers';

test('cada sección aparece cuando hace falta: Póster y Capas en su tarjeta, Selección al seleccionar', async ({ page }) => {
  await openApp(page);
  const panel = page.locator('#panel'), openers = page.locator('#panelOpeners');
  const poster = page.locator('#posterCard'), layers = page.locator('#layersCard');
  // al entrar no hay panel ni tarjetas: solo sus botones
  await expect(panel).toBeHidden();
  await expect(poster).toBeHidden();
  await expect(openers).toBeVisible();
  // «Póster» abre su tarjeta con las hojas; «Capas», la suya con la lista (y cierra la otra); Esc la cierra
  await openers.locator('[data-open="sheets"]').click();
  await expect(poster).toBeVisible();
  await expect(poster.locator('#presets')).toBeVisible();
  await expect(openers.locator('[data-open="sheets"]')).toHaveAttribute('aria-expanded', 'true');
  await openers.locator('[data-open="image"]').click();
  await expect(layers).toBeVisible();
  await expect(layers.locator('#posterLayers')).toBeVisible();
  await expect(poster).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(layers).toBeHidden();
  // Ctrl+\ muestra u oculta las capas
  await page.keyboard.press('Control+Backslash');
  await expect(layers).toBeVisible();
  await page.keyboard.press('Control+Backslash');
  await expect(layers).toBeHidden();
  // un texto nuevo abre el panel de la selección, solo con lo suyo (sin pestañas)
  await startText(page);
  await page.locator('.text-editor').fill('Texto contextual');
  await page.locator('.text-editor').press('Escape');
  await expect(panel).toBeVisible();
  await expect(page.locator('#sheetTabs')).toBeHidden();
  await expect(page.locator('#selectionTitle')).toHaveText('Texto');
  await expect(page.locator('#tSize')).toBeVisible();
  // posición, tamaño y opacidad, siempre a la vista (sin apartado plegable)
  await expect(page.locator('#pW')).toBeVisible();
  await expect(page.locator('#selectionGeometry summary')).toHaveCount(0);
  // con el panel abierto: los botones siguen arriba (el panel se abre debajo) y la tarjeta de Capas, a su izquierda
  const pb = (await panel.boundingBox())!;
  expect((await openers.boundingBox())!.y + (await openers.boundingBox())!.height).toBeLessThanOrEqual(pb.y);
  await openers.locator('[data-open="image"]').click();
  const lb = (await layers.boundingBox())!;
  expect(lb.x + lb.width).toBeLessThanOrEqual(pb.x);
  // elegir otra capa en la lista: el panel sigue con lo seleccionado
  await layers.locator('#layers li.layer .layer-main').first().click();
  await expect(panel).toBeVisible();
  // ✕ deselecciona y el panel se va
  await page.locator('#selectionClose').click();
  await expect(panel).toBeHidden();
});

test('con una imagen seleccionada se cambia el papel sin deseleccionar', async ({ page }) => {
  await openApp(page);
  await addImage(page);
  await page.locator('#panelOpeners [data-open="sheets"]').click();
  await page.locator('[data-paper="A3"]').click();
  await expect(page.locator('#layers li.layer.on')).toHaveCount(1);
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#selectionTitle')).toHaveText('Imagen');
});

test('la barra es fija: «＋ Agregar» siempre en el mismo punto y al lado lo de la selección', async ({ page }) => {
  await openApp(page);
  const bar = page.locator('#ctxbar'), add = bar.locator('[data-act=add]');
  // también con la bienvenida
  await expect(add).toBeVisible();
  const a0 = (await add.boundingBox())!;
  await addImage(page);
  await expect(bar.locator('[data-act=crop]')).toBeVisible();
  // en escritorio, arriba a la izquierda, justo bajo la cabecera (8 px), alineada con ella
  const head = (await page.locator('header').boundingBox())!, b0 = (await bar.boundingBox())!;
  expect(Math.abs(b0.x - head.x)).toBeLessThan(2);
  expect(Math.abs(b0.y - (head.y + head.height + 8))).toBeLessThan(2);
  // su menú se abre hacia abajo, sobre el lienzo
  await bar.locator('[data-act=add]').click();
  expect((await page.locator('#menu').boundingBox())!.y).toBeGreaterThan(b0.y + b0.height);
  await page.keyboard.press('Escape');
  expect(await add.boundingBox()).toEqual(a0);
  // girar y voltear ya no están en la barra: van junto a la rotación, en Selección
  await expect(bar.locator('[data-act=rotR]')).toHaveCount(0);
  await page.locator('#pRot90').click();
  await expect(page.locator('#pR')).toHaveValue('90');
  // mover la imagen no mueve la barra
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowDown');
  expect(await bar.boundingBox()).toEqual(b0);
  // recortar: «Agregar» se apaga pero no se mueve
  await bar.locator('[data-act=crop]').click();
  await expect(add).toBeDisabled();
  expect(await add.boundingBox()).toEqual(a0);
  await page.keyboard.press('Escape');
  // sin selección: solo «Agregar», en el mismo punto
  await page.keyboard.press('Escape');
  await expect(bar.locator('[data-act=crop]')).toHaveCount(0);
  expect(await add.boundingBox()).toEqual(a0);
  // «＋ Agregar» abre su menú; «Agregar texto» no crea nada hasta elegir dónde (cursor de texto, botón marcado,
  // Cancelar en la barra); Cancelar lo termina
  await add.click();
  await page.locator('#menu').getByRole('menuitem', { name: /Agregar texto/ }).click();
  await expect(add).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#cv')).toHaveCSS('cursor', 'text');
  await expect(page.locator('.text-editor')).toHaveCount(0);
  await bar.locator('[data-act=cancelText]').click();
  await expect(add).not.toHaveAttribute('aria-pressed');
  // un clic lo pone ahí: el texto empieza en ese punto (alineado a la izquierda)
  await page.keyboard.press('t');
  await page.locator('#cv').click({ position: { x: 300, y: 200 } });
  const box = page.locator('.text-editor');
  await expect(box).toBeFocused();
  const r = (await box.boundingBox())!, cv = (await page.locator('#cv').boundingBox())!;
  expect(Math.abs(r.x - (cv.x + 300))).toBeLessThan(4);
  expect(Math.abs(r.y - (cv.y + 200))).toBeLessThan(4);
  await expect(add).not.toHaveAttribute('aria-pressed'); // ya colocado: el modo termina
});

test('con varias capas, la barra ofrece agrupar, duplicar y quitar', async ({ page }) => {
  await openApp(page);
  await addImage(page, { name: 'a' });
  await addImage(page, { name: 'b', color: '#cc3333' });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+a');
  const bar = page.locator('#ctxbar');
  await bar.getByRole('button', { name: /^Agrupar/ }).click();
  await expect(bar.getByRole('button', { name: /^Desagrupar/ })).toBeVisible();
  await bar.getByRole('button', { name: /^Duplicar/ }).click();
  await expect(page.locator('#layers li.layer')).toHaveCount(4);
  await bar.getByRole('button', { name: /^Quitar del póster/ }).click();
  await expect(page.locator('#layers li.layer')).toHaveCount(2);
});

test('en 960 px con el panel abierto, la barra de arriba y el zoom de abajo caben sin taparse ni esconder nada', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 760 });
  await openApp(page);
  // sin nada seleccionado: barra arriba a la izquierda, zoom abajo a la derecha (sin panel)
  const bar = page.locator('#ctxbar'), tools = page.locator('#tools');
  const t0 = (await tools.boundingBox())!;
  expect(Math.abs(t0.x + t0.width - (960 - 12))).toBeLessThan(2);
  expect(Math.abs(t0.y + t0.height - (760 - 12))).toBeLessThan(2);
  expect((await bar.boundingBox())!.y).toBeLessThan(120);
  // con la imagen seleccionada se abre el panel: la barra llega hasta él sin esconder nada y el zoom sigue en su
  // esquina, bajo el panel
  await addImage(page);
  const panelX = (await page.locator('#panel').boundingBox())!.x;
  const fits = async (what: string) => {
    const r = await bar.evaluate((b) => ({ right: b.getBoundingClientRect().right, scroll: b.scrollWidth - b.clientWidth }));
    expect(r.right, what).toBeLessThanOrEqual(panelX);
    expect(r.scroll, what).toBeLessThanOrEqual(0);
    const t = (await tools.boundingBox())!;
    expect(t.y, what).toBeGreaterThanOrEqual((await page.locator('#panel').boundingBox())!.y + (await page.locator('#panel').boundingBox())!.height); // el zoom, en su esquina, bajo el panel
  };
  await fits('imagen');
  for (const [key, what] of [['c', 'recorte'], ['e', 'borrador'], ['w', 'varita']] as const) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(key);
    await fits(what);
    await page.keyboard.press('Escape');
  }
});

test('tableta y móvil girados: panel a la derecha y lienzo con sitio', async ({ page }) => {
  const free = () => page.locator('#free').evaluate((f) => Math.round(f.getBoundingClientRect().height));
  // tableta apaisada: al seleccionar, panel lateral de 300 px (no la hoja inferior)
  await page.setViewportSize({ width: 800, height: 600 });
  await openApp(page);
  await addImage(page);
  const panel = (await page.locator('#panel').boundingBox())!;
  expect(Math.round(panel.width)).toBe(300);
  expect(panel.x + panel.width).toBeLessThanOrEqual(800);
  await expect(page.locator('#sheetHandle')).toBeHidden();
  expect(await free()).toBeGreaterThanOrEqual(400);
  // móvil girado (640 × 360): sin nada seleccionado no hay panel; con la barra arriba el lienzo mide ~184 px (antes ~100)
  await page.setViewportSize({ width: 640, height: 360 });
  await page.reload();
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('#panelOpeners')).toBeVisible();
  expect(await free()).toBeGreaterThanOrEqual(180);
  const bar = (await page.locator('#ctxbar').boundingBox())!;
  expect(bar.x + bar.width).toBeLessThanOrEqual(640);
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
  // plegada, la hoja deja ver las pestañas, con Selección elegida
  await expect(page.locator('#tab-sel')).toBeVisible();
  await expect(page.locator('#tab-sel')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#sheetHandle').click();
  await expect(page.locator('#selectionCard')).toBeVisible();
  await page.locator('#tColorHex').scrollIntoViewIfNeeded();
  const bounds = (await page.locator('#selectionCard').boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('tarjeta-movil.png') });
});
