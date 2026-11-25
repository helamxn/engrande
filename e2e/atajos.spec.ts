import { expect, test, type Page } from '@playwright/test';
import { closeCards, drag, listNames, openApp, saved, savedBox, screenMap, selectRow, showLayers } from './helpers';

async function addFigure(page: Page, name = 'Rectángulo') {
  await page.locator('#toolbar [data-tool=shape]').click();
  await page.getByRole('menuitem', { name: new RegExp(`^${name}`) }).click(); // el nombre y su tecla
  await expect(page.locator('#selectionTitle')).toHaveText('Forma');
}
/** Teclas sobre el lienzo (sin foco en un campo ni en un botón). */
async function onCanvas(page: Page) {
  await closeCards(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
const selectedCount = async (page: Page) => (await listNames(page)).filter((n) => n.endsWith('*')).length;

test('en la lista de capas, Mayús + clic elige un tramo y Ctrl + clic quita una', async ({ page }) => {
  await openApp(page);
  for (const f of ['Rectángulo', 'Elipse', 'Triángulo', 'Rectángulo']) await addFigure(page, f);
  await showLayers(page);
  const rows = page.locator('#layers li.layer .layer-main');
  await expect(rows).toHaveCount(4);
  await rows.nth(0).click();
  await rows.nth(2).click({ modifiers: ['Shift'] });
  await expect.poll(() => selectedCount(page)).toBe(3);
  expect((await listNames(page)).map((n) => n.endsWith('*'))).toEqual([true, true, true, false]);
  // el ancla sigue en la primera: Mayús + clic en la última amplía el tramo
  await rows.nth(3).click({ modifiers: ['Shift'] });
  await expect.poll(() => selectedCount(page)).toBe(4);
  await rows.nth(1).click({ modifiers: ['Control'] });
  expect((await listNames(page)).map((n) => n.endsWith('*'))).toEqual([true, false, true, true]);
});

test('pegar en el mismo sitio, pegar desplazado y pegar en la vista cuando el original no se ve', async ({ page }) => {
  await openApp(page);
  await addFigure(page);
  const orig = await savedBox(page);
  await onCanvas(page);
  await page.keyboard.press('Control+C');
  await page.keyboard.press('Control+Shift+V');
  const inPlace = await savedBox(page, () => true, 1);
  expect(inPlace.x0).toBeCloseTo(orig.x0, 6);
  expect(inPlace.y0).toBeCloseTo(orig.y0, 6);
  await page.keyboard.press('Control+V');
  const shifted = await savedBox(page, () => true, 2);
  expect(shifted.x0).toBeCloseTo(orig.x0 + 10, 6);
  // la vista se va lejos (dos dedos en el trackpad): lo pegado aparece en lo que se ve, no fuera de pantalla
  const cv = (await page.locator('#cv').boundingBox())!;
  await page.mouse.move(cv.x + cv.width / 2, cv.y + cv.height / 2);
  await page.mouse.wheel(3000, 0);
  await page.keyboard.press('Control+V');
  const seen = await savedBox(page, () => true, 3);
  expect(Math.abs(seen.x0 - (orig.x0 + 20))).toBeGreaterThan(50);
  const map = await screenMap(page, seen);
  const at = map.toScreen((seen.x0 + seen.x1) / 2, (seen.y0 + seen.y1) / 2);
  expect(at.x).toBeGreaterThan(cv.x);
  expect(at.x).toBeLessThan(cv.x + cv.width);
});

test('Alt + A / S alinean con el póster y Ctrl + Mayús + H / L ocultan y bloquean', async ({ page }) => {
  await openApp(page);
  await addFigure(page);
  await onCanvas(page);
  await page.keyboard.press('Alt+KeyA');
  await savedBox(page, (b) => Math.abs(b.x0) < 1e-6);
  await page.keyboard.press('Alt+KeyS');
  const H = (await saved(page))!.layout as { paper: string };
  expect(H.paper).toBe('A4');
  // A4 vertical, 1 hoja, margen 6 mm: 285 mm de alto imprimible
  await savedBox(page, (b) => Math.abs(b.y1 - 285) < 1e-6);
  await page.keyboard.press('Control+Shift+H');
  await showLayers(page);
  await expect(page.locator('#layers li.layer').first()).toHaveClass(/\boff\b/);
  await page.locator('#undo').click();
  await expect(page.locator('#layers li.layer').first()).not.toHaveClass(/\boff\b/);
  await expect.poll(() => selectedCount(page)).toBe(1);
  await onCanvas(page);
  await page.keyboard.press('Control+Shift+L');
  await expect(page.locator('#toast')).toContainText('bloqueada');
});

test('Mayús + 0 pone el 100 %, Mayús + 1 vuelve a todo el póster y [ ] cambian el pincel', async ({ page }) => {
  await openApp(page);
  await addFigure(page);
  await onCanvas(page);
  await page.keyboard.press('Shift+Digit0');
  await expect(page.locator('#zoomPct')).toHaveText('100%');
  await page.keyboard.press('Shift+Digit1');
  await expect(page.locator('#zoomPct')).not.toHaveText('100%');
  await page.keyboard.press('e');
  await expect(page.locator('#bBrushOut')).toHaveText('24 px');
  await page.keyboard.press(']');
  await expect(page.locator('#bBrushOut')).toHaveText('29 px');
  await expect(page.locator('#bBrush')).toHaveValue('29');
  await page.keyboard.press('[');
  await expect(page.locator('#bBrushOut')).toHaveText('24 px');
});

/** Giro guardado de cada capa (grados). */
const savedRots = (page: Page) => page.evaluate(() => new Promise<number[]>((res) => {
  const q = indexedDB.open('pliego', 1);
  q.onsuccess = () => {
    const t = q.result.transaction('project'), g = t.objectStore('project').get('current');
    t.oncomplete = () => res(((g.result?.layers ?? []) as { rot: number }[]).map((l) => l.rot));
  };
}));

test('girar varias capas se pega a 0° como girar una sola', async ({ page }) => {
  await openApp(page);
  await addFigure(page);
  // la escala de la vista, con una sola capa (con dos superpuestas, el barrido de screenMap las juntaría)
  const a = await savedBox(page), map = await screenMap(page, a);
  await onCanvas(page);
  await page.keyboard.press('Control+d');
  await expect.poll(async () => (await saved(page))?.boxes.length).toBe(2);
  const b = (await saved(page))!.boxes[1]!;
  await page.keyboard.press('Control+a');
  // marco común: el tirador de giro está 28 px sobre el centro del borde de arriba
  const x0 = Math.min(a.x0, b.x0), x1 = Math.max(a.x1, b.x1), y0 = Math.min(a.y0, b.y0), y1 = Math.max(a.y1, b.y1);
  const top = map.toScreen((x0 + x1) / 2, y0), c = map.toScreen((x0 + x1) / 2, (y0 + y1) / 2);
  const handle = { x: top.x, y: top.y - 28 }, r = c.y - handle.y, deg = Math.PI / 180;
  const at = (d: number) => ({ x: c.x + r * Math.sin(d * deg), y: c.y - r * Math.cos(d * deg) });
  // sin el imán (lejos de 90°), gira lo arrastrado
  await drag(page, handle, at(40));
  // el centro se estima desde la pantalla: el ángulo sale aproximado
  await expect.poll(async () => (await savedRots(page)).every((d) => Math.abs(d - 40) < 4)).toBe(true);
  await page.locator('#undo').click();
  await expect.poll(() => savedRots(page)).toEqual([0, 0]);
  // a 2° de 0°, se pega a 0° (antes solo pasaba con una capa sola)
  await drag(page, handle, at(2));
  await page.waitForTimeout(1500); // el guardado va 1,2 s después del cambio
  expect(await savedRots(page)).toEqual([0, 0]);
});
