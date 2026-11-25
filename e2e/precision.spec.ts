import { expect, test, type Page } from '@playwright/test';
import { closeCards, drag, openApp, openTab, saved, savedBox, screenMap, type SavedBox } from './helpers';

async function addFigure(page: Page) {
  await page.locator('#toolbar [data-tool=shape]').click();
  await page.getByRole('menuitem', { name: /^Rectángulo/ }).click();
  await expect(page.locator('#selectionTitle')).toHaveText('Forma');
}
async function blur(page: Page) {
  await closeCards(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}
/** Caja común de lo guardado, cuando haya n capas. */
async function union(page: Page, n: number, check: (b: SavedBox) => boolean = () => true) {
  let u: SavedBox | null = null;
  await expect.poll(async () => {
    const bs = (await saved(page))?.boxes ?? [];
    if (bs.length !== n) return false;
    const x0 = Math.min(...bs.map((b) => b.x0)), y0 = Math.min(...bs.map((b) => b.y0));
    const x1 = Math.max(...bs.map((b) => b.x1)), y1 = Math.max(...bs.map((b) => b.y1));
    u = { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
    return check(u);
  }, { timeout: 15_000 }).toBe(true);
  return u!;
}
const near = (a: number, b: number) => Math.abs(a - b) < 0.01;

test('los campos aceptan operaciones y arrastrar su nombre cambia el valor en un paso de deshacer', async ({ page }) => {
  await openApp(page);
  await addFigure(page);
  await openTab(page, 'sel');
  const w = page.locator('#pW');
  await w.fill('210/2 mm');
  await w.press('Enter');
  await savedBox(page, (b) => near(b.w, 105));
  await expect(w).toHaveValue('10,5'); // el campo muestra el resultado, no la operación
  const x = page.locator('#pX');
  await x.fill('3 manzanas');
  await x.press('Enter');
  await expect(x).not.toHaveValue('3 manzanas'); // lo que no es una medida vuelve al valor que había
  await x.fill('1,5+2');
  await x.press('Enter');
  const b0 = await savedBox(page, (b) => near(b.x0, 35));
  // arrastrar «Desde la izquierda» 30 px a la derecha: 1 mm por píxel
  const label = (await page.getByText('Desde la izquierda', { exact: true }).boundingBox())!;
  const from = { x: label.x + 10, y: label.y + label.height / 2 };
  await drag(page, from, { x: from.x + 30, y: from.y });
  await savedBox(page, (b) => near(b.x0, b0.x0 + 30));
  await expect(x).not.toBeFocused();
  await page.locator('#undo').click();
  await savedBox(page, (b) => near(b.x0, b0.x0));
  // un clic sin arrastrar en el nombre lleva al campo, como siempre
  await page.getByText('Desde la izquierda', { exact: true }).click();
  await expect(x).toBeFocused();
});

test('con varias, el panel cambia el tamaño, la posición y el giro del conjunto', async ({ page }) => {
  await openApp(page);
  await addFigure(page);
  await blur(page);
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+a');
  await openTab(page, 'sel');
  const u0 = await union(page, 2);
  await expect(page.locator('#gW')).toHaveValue(String(Math.round(u0.w * 100) / 1000).replace('.', ','));
  // con la proporción fija, el ancho cambia también el alto
  await page.locator('#gW').fill(String((u0.w * 2) / 10).replace('.', ','));
  await page.locator('#gW').press('Enter');
  const u1 = await union(page, 2, (u) => near(u.w, u0.w * 2));
  expect(u1.h).toBeCloseTo(u0.h * 2, 2);
  // sin ella, solo el alto
  await page.locator('#gRatio').click();
  await expect(page.locator('#gRatio')).toHaveAttribute('aria-pressed', 'false');
  await page.locator('#gH').fill('5');
  await page.locator('#gH').press('Enter');
  await union(page, 2, (u) => near(u.h, 50) && near(u.w, u1.w));
  await page.locator('#gX').fill('0');
  await page.locator('#gX').press('Enter');
  await union(page, 2, (u) => near(u.x0, 0));
  await page.locator('#gR').fill('90');
  await page.locator('#gR').press('Enter');
  await expect(page.locator('#gR')).toHaveValue('90');
  // girado 90°, todo sigue pudiéndose estirar; con 45°, la proporción queda fija
  await page.locator('#gR').fill('45');
  await page.locator('#gR').press('Enter');
  await expect(page.locator('#gRatio')).toBeDisabled();
  await expect(page.locator('#gRatio')).toHaveAttribute('aria-pressed', 'true');
});

test('arrastrar un lado del marco de varias las estira solo en ese eje', async ({ page }) => {
  await openApp(page);
  await addFigure(page);
  const a = await savedBox(page), map = await screenMap(page, a);
  await blur(page);
  await page.keyboard.press('Control+d');
  await page.keyboard.press('Control+a');
  const u0 = await union(page, 2);
  // el lado derecho, en el centro de su altura; Ctrl: sin imán ni rejilla, para medir el arrastre exacto
  const e0 = map.toScreen(u0.x1, (u0.y0 + u0.y1) / 2);
  await page.mouse.move(e0.x, e0.y);
  await expect(page.locator('#cv')).toHaveCSS('cursor', 'ew-resize');
  await drag(page, e0, { x: e0.x + 60, y: e0.y + 25 }, ['Control']);
  const u1 = await union(page, 2, (u) => u.w > u0.w + 5);
  // la escala de screenMap es aproximada (barrido de unos píxeles)
  expect(Math.abs(u1.w - (u0.w + 60 / map.k))).toBeLessThan(1.5);
  expect(u1.x0).toBeCloseTo(u0.x0, 6);
  expect(u1.h).toBeCloseTo(u0.h, 6);
  // un solo paso de deshacer
  await page.locator('#undo').click();
  await union(page, 2, (u) => near(u.w, u0.w));
});

test('el tamaño exacto del póster usa el mismo campo: coma, operaciones y flechas', async ({ page }) => {
  await openApp(page);
  await openTab(page, 'sheets');
  await page.locator('#bySize').click();
  const w = page.locator('#posterWidth');
  await expect(w.locator('xpath=..')).toHaveClass('unit'); // la unidad «cm» dentro, como en Selección
  await w.fill('100/2');
  await w.press('Enter');
  await expect(w).toHaveValue('50');
  await w.press('ArrowUp');
  await expect(w).toHaveValue('50,1');
  await w.press('Shift+ArrowDown');
  await expect(w).toHaveValue('49,1');
  await w.fill('0');
  await w.press('Enter');
  await expect(w).toHaveValue('49,1'); // no vale: vuelve al que había
  await expect.poll(async () => ((await saved(page))?.layout.posterSize as { w: number } | null)?.w).toBe(491);
});
