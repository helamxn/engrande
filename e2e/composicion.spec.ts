import { expect, test, type Page } from '@playwright/test';
import { addImage, closeCards, drag, expectSavedNames, listNames, openApp, openTab, saved, savedBox, screenMap, selectRow, startText, thumbColor } from './helpers';

test('repartir tres elementos y alinear el conjunto con el póster conserva las separaciones al recargar', async ({ page }, info) => {
  await openApp(page);
  await addFigure(page, 'Rectángulo');
  await page.locator('#cv').focus();
  await page.keyboard.press('Control+d');
  // la tercera (copia de la copia), más lejos: separaciones distintas
  await page.keyboard.press('Control+d');
  for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+ArrowRight');
  await page.keyboard.press('Control+a');
  const horizontal = page.locator('#gDist [data-a=x]');
  await expect(horizontal).toBeEnabled();
  await expect(page.locator('#gGap')).toHaveCount(0); // sin campo de separación: se reparte el hueco que hay
  await horizontal.click();
  await page.locator('#gAlignTarget').selectOption('poster');
  await page.locator('#gAlign [data-e=left]').click();
  await savedBox(page, b => Math.abs(b.x0) < 1e-6, 0);
  const boxes = (await saved(page))!.boxes.slice().sort((p, q) => p.x0 - q.x0);
  expect(boxes[1]!.x0 - boxes[0]!.x1).toBeCloseTo(boxes[2]!.x0 - boxes[1]!.x1);
  await page.screenshot({ path: info.outputPath('reparto.png') });
  await page.reload();
  await expect(page.locator('#layers li.layer')).toHaveCount(3);
  expect((await saved(page))!.boxes.slice().sort((p, q) => p.x0 - q.x0)).toEqual(boxes);
});

async function addFigure(page: Page, name: string) {
  await page.locator('#toolbar [data-tool=shape]').click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click(); // el nombre y su tecla
  await expect(page.locator('#selectionTitle')).toHaveText('Forma');
}

async function guides(page: Page) {
  await openTab(page, 'sheets');
  const summary = page.getByText('Reglas y guías', { exact: true });
  if (!(await page.locator('#rulers').isVisible())) await summary.click();
}

test('elegir una capa tapada permite seleccionar y transformar solo su grupo', async ({ page }) => {
  await openApp(page);
  await addFigure(page, 'Rectángulo');
  const b = await savedBox(page), map = await screenMap(page, b);
  await page.locator('#cv').focus();
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await addFigure(page, 'Elipse');
  const mid = map.toScreen(b.x0 + b.w / 2, b.y0 + b.h / 2);
  await page.mouse.click(mid.x, mid.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Seleccionar capa', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Grupo 1 › Rectángulo', exact: true }).click();
  await expect(page.locator('#pName')).toHaveValue('Rectángulo');
  const start = map.toScreen(b.x0 - 12, b.y0 - 12), end = map.toScreen(b.x1 + 19, b.y1 + 19);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await expect(page.locator('#selectionTitle')).toContainText('Grupo 1');
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('#pName')).toHaveValue('Rectángulo');
  await page.keyboard.press('Control+a');
  await expect(page.locator('#selectionTitle')).toHaveText('Grupo 1 · 2 capas');
  await page.keyboard.press('r');
  await expect(page.locator('#gR')).toHaveValue('90');
  await page.keyboard.press('h');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#gR')).toHaveValue('90');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#gR')).toHaveValue('0');
  await page.keyboard.press('Enter');
  await expect(page.locator('#pName')).toHaveValue('Rectángulo (copia)');
  await page.keyboard.press('Escape');
  await expect(page.locator('#selectionTitle')).toHaveText('Grupo 1 · 2 capas');
});

test('una plantilla de guías sin capas se recupera y quitar una guía se puede deshacer', async ({ page }) => {
  await openApp(page);
  await addFigure(page, 'Rectángulo');
  const map = await screenMap(page, await savedBox(page));
  const left = map.toScreen(0, 85), target = map.toScreen(40, 85);
  const ruler = { x: left.x - 6 * map.k - 25, y: left.y };
  await drag(page, ruler, target);
  await page.locator('#cv').focus();
  await page.keyboard.press('Delete');
  await expectSavedNames(page, []);
  const original = (await saved(page))!.guides;
  expect(original).toEqual([{ axis: 'x', at: expect.any(Number) }]);
  await page.reload();
  await expect(page.locator('#empty')).toBeHidden();
  await page.mouse.move(target.x, target.y);
  await expect(page.locator('#cv')).toHaveCSS('cursor', 'ew-resize');
  await drag(page, target, ruler);
  await expectSavedNames(page, null);
  await page.locator('#undo').click();
  await expect.poll(async () => (await saved(page))?.guides).toEqual(original);
});

test('el relleno de una forma y su máscara sobreviven al historial, a la recarga y a la descarga', async ({ page }) => {
  await openApp(page);
  await addFigure(page, 'Elipse');
  const before = await page.locator('#zoomPct').textContent();
  await page.locator('#zoomSelection').click();
  await expect(page.locator('#zoomPct')).not.toHaveText(before!);
  const area = (await page.locator('#free').boundingBox())!;
  await page.locator('#toolbar [data-tool=erase]').click();
  await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
  await page.locator('#ctxbar [data-act=done]').click();
  const erased = await thumbColor(page);
  expect(erased).not.toEqual([36, 88, 166]);
  await page.locator('#figureFill').fill('#eb3512');
  await expect(page.locator('#figureFill')).toHaveValue('#eb3512');
  await page.locator('#undo').click();
  await expect(page.locator('#figureFill')).toHaveValue('#2458a6');
  await page.locator('#redo').click();
  await expect.poll(() => page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve) => {
      const req = indexedDB.open('pliego'); req.onsuccess = () => resolve(req.result);
    });
    try {
      const project = db.transaction('project').objectStore('project').get('current');
      return await new Promise<string | undefined>((resolve) => { project.onsuccess = () => resolve(project.result?.layers[0]?.src?.spec?.fill); });
    } finally { db.close(); }
  })).toBe('#eb3512');
  await page.reload();
  await selectRow(page);
  await expect(page.locator('#figureFill')).toHaveValue('#eb3512');
  expect(await thumbColor(page)).toEqual(erased);
  await page.locator('#figureHex').fill('xyz');
  await page.locator('#figureHex').press('Enter');
  await expect(page.locator('#figureError')).toBeVisible();
  await page.locator('#figureHex').fill('#abc');
  await page.locator('#figureHex').press('Enter');
  await expect(page.locator('#figureFill')).toHaveValue('#aabbcc');
  expect(await thumbColor(page)).toEqual(erased);
  const download = page.waitForEvent('download');
  await page.locator('#quickExport').click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/i);
});

test('alinear un grupo y cambiar su apilamiento conserva los desplazamientos internos', async ({ page }) => {
  await openApp(page);
  await addFigure(page, 'Rectángulo');
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await expect(page.locator('#lblGAlign')).toHaveText('Alinear con el póster');
  await page.locator('#gAlign [data-e=left]').click();
  await savedBox(page, (b) => Math.abs(b.x0) < 0.0001, 0);
  const boxes = (await saved(page))!.boxes;
  expect(boxes[1]!.x0 - boxes[0]!.x0).toBeCloseTo(10);
  await addFigure(page, 'Triángulo');
  await page.keyboard.press('Control+BracketLeft');
  expect(await listNames(page)).toEqual(['Rectángulo (copia)', 'Rectángulo', 'Triángulo*']);
});

test('cambiar de la varita a una capa de texto desactiva la edición de píxeles', async ({ page }) => {
  await openApp(page);
  await startText(page);
  await page.locator('.text-editor').fill('Título');
  await page.keyboard.press('Escape');
  await addImage(page);
  await page.locator('#toolbar [data-tool=wand]').click();
  await openTab(page, 'image');
  await page.locator('#layers .layer-main').last().click();
  await closeCards(page);
  await expect(page.locator('#ctxbar [data-act=editText]')).toBeVisible();
  await expect(page.locator('#bTol')).toHaveCount(0);
});

test('copiar, pegar y duplicar un grupo conserva las capas ocultas y bloqueadas', async ({ page }) => {
  await openApp(page);
  await addFigure(page, 'Elipse');
  for (let i = 0; i < 3; i++) await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await openTab(page, 'image');
  const layers = page.locator('#layers .layer');
  await layers.nth(0).getByRole('button', { name: 'Ocultar', exact: true }).click();
  await layers.nth(1).getByRole('button', { name: 'Bloquear', exact: true }).click();
  await page.locator('#layers .group-row .layer-main').click();
  await closeCards(page);
  await page.locator('#cv').focus();
  await page.keyboard.press('Control+x');
  await expect(layers).toHaveCount(4);
  await expect(page.locator('#toast')).toContainText('Desbloquea');
  await page.keyboard.press('Control+d');
  await expect(layers).toHaveCount(8);
  await expect(page.locator('#layers .group-row')).toHaveCount(2);
  await page.keyboard.press('Control+z');
  await expect(layers).toHaveCount(4);
  await page.keyboard.press('Control+c');
  await page.evaluate(() => document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true })));
  await expect(layers).toHaveCount(8);
  await expect(page.locator('#layers .group-row')).toHaveCount(2);
  await expect(page.locator('#layers .layer.off')).toHaveCount(2);
  await expect(page.locator('#layers .layer [data-ic=lock]')).toHaveCount(2);
  await expect.poll(async () => (await saved(page))?.names.length).toBe(8);
  await page.reload();
  await expect(page.locator('#layers .group-row')).toHaveCount(2);
  await expect(page.locator('#layers .layer.off')).toHaveCount(2);
  await expect(page.locator('#layers .layer [data-ic=lock]')).toHaveCount(2);
});

test('duplicar tras colocar la copia repite su desplazamiento horizontal, vertical o diagonal', async ({ page }) => {
  await openApp(page);
  await addFigure(page, 'Rectángulo');
  const position = async (id: string, cm: string) => {
    const input = page.locator(id);
    await input.fill(cm); await input.press('Enter');
  };
  await position('#pX', '2'); await position('#pY', '5');
  await page.locator('#cv').focus();
  await page.keyboard.press('Control+d');
  await expect(page.locator('#pX')).toHaveValue('3');
  await position('#pX', '6'); await position('#pY', '4');
  await page.locator('#cv').focus();
  await page.keyboard.press('Control+d');
  await expect(page.locator('#pX')).toHaveValue('10');
  await expect(page.locator('#pY')).toHaveValue('3');
  await page.keyboard.press('Control+d');
  await expect(page.locator('#pX')).toHaveValue('14');
  await expect(page.locator('#pY')).toHaveValue('2');
  await page.keyboard.press('Control+z');
  await expect(page.locator('#layers li.layer')).toHaveCount(3);
});

test('clic derecho permite elegir qué objeto superpuesto se desbloquea', async ({ page }) => {
  await openApp(page);
  await addImage(page);
  await selectRow(page);
  const box = await savedBox(page), map = await screenMap(page, box);
  const p = map.toScreen(box.x0 + box.w / 2, box.y0 + box.h / 2);
  await page.keyboard.press('Control+d');
  for (let i = 0; i < 2; i++) {
    await page.mouse.click(p.x, p.y, { button: 'right' });
    await page.getByRole('menuitem', { name: /^Bloquear(?!\S)/ }).click();
  }
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await page.getByRole('menuitem', { name: 'Desbloquear objeto' }).click();
  await page.getByRole('menuitem', { name: 'foto', exact: true }).click();
  await expect(page.locator('#pName')).toHaveValue('foto');
  await page.mouse.click(p.x, p.y, { button: 'right' });
  await expect(page.getByRole('menuitem', { name: 'Desbloquear «foto (copia)»' })).toBeVisible();
});

test('el menú de Capas duplica también un grupo totalmente oculto', async ({ page }) => {
  await openApp(page);
  await addFigure(page, 'Rectángulo');
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Control+g');
  await openTab(page, 'image');
  const group = page.locator('#layers .group-row').first();
  await group.getByRole('button', { name: 'Ocultar el grupo' }).click();
  await group.getByRole('button', { name: 'Más opciones del grupo' }).click();
  await page.getByRole('menuitem', { name: 'Duplicar grupo' }).click();
  await expect(page.locator('#layers .group-row')).toHaveCount(2);
  await expect(page.locator('#layers .layer.off')).toHaveCount(4);
});

test('las reglas crean guías y el desplazamiento con teclado se detiene en la medida exacta', async ({ page }, info) => {
  await openApp(page);
  await addFigure(page, 'Rectángulo');
  await guides(page);
  await expect(page.locator('#rulers')).toBeChecked();
  await expect(page.locator('#showGuides')).toBeChecked();
  await expect(page.locator('#guideForm, #guideList')).toHaveCount(0);
  await closeCards(page);
  const map = await screenMap(page, await savedBox(page));
  const top = map.toScreen(155, 0), inside = map.toScreen(155, 85);
  await page.mouse.move(top.x, top.y - 3 * map.k);
  await expect(page.locator('#cv')).not.toHaveCSS('cursor', 'ns-resize');
  // La banda empieza fuera del margen físico (6 mm) y del espacio entre el papel y la regla.
  await page.mouse.move(top.x, top.y - 6 * map.k - 8);
  await expect(page.locator('#cv')).not.toHaveCSS('cursor', 'ns-resize');
  const rulerY = top.y - 6 * map.k - 25;
  await page.mouse.move(top.x, rulerY);
  await expect(page.locator('#cv')).toHaveCSS('cursor', 'ns-resize');
  await page.mouse.down();
  await page.mouse.move(inside.x, inside.y, { steps: 8 });
  await page.mouse.up();
  const position = async () => (await saved(page))?.guides.find(line => line.axis === 'y')?.at;
  await expect.poll(position).toBeGreaterThan(0);
  const initial = (await position())!;
  await page.mouse.move(inside.x, inside.y);
  await expect(page.locator('#cv')).toHaveCSS('cursor', 'ns-resize');
  await page.mouse.down();
  const next = map.toScreen(155, 60);
  await page.mouse.move(next.x, next.y);
  await page.mouse.up();
  await expect.poll(position).toBeLessThan(initial);
  const moved = (await position())!;
  await page.mouse.down();
  await page.mouse.move(top.x, rulerY);
  await page.mouse.up();
  await expect.poll(position).toBeUndefined();
  await page.keyboard.press('Control+z');
  await expect.poll(position).toBe(moved);
  await page.locator('#pY').fill(String((moved - 2) / 10));
  await page.locator('#pY').press('Enter');
  await page.locator('#cv').focus();
  await page.keyboard.press('Shift+ArrowDown');
  await savedBox(page, (b) => Math.abs(b.y0 - moved) < 1e-6);
  await expect(page.locator('#unstretch')).toBeHidden();
  await page.screenshot({ path: info.outputPath('composicion-escritorio.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#zoomFit').click();
  await expect(page.locator('#zoomPct')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: info.outputPath('composicion-movil.png') });
});
