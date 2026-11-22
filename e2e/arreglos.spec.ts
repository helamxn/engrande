import { expect, test, type Page } from '@playwright/test';
import { closeCards, drag, openApp, openTab, saved, savedBox, screenMap, showLayers, thumbColor } from './helpers';

async function addFigure(page: Page) {
  await page.locator('#ctxbar [data-act=add]').click();
  await page.getByRole('menuitem', { name: 'Agregar forma' }).click();
  await page.getByRole('menuitem', { name: 'Rectángulo', exact: true }).click();
  await expect(page.locator('#selectionTitle')).toHaveText('Forma');
}
const count = async (page: Page) => (await saved(page))?.boxes.length ?? 0;

test('el relleno de una forma se ve mientras se elige y se aplica aunque se salga deseleccionando', async ({ page }) => {
  await openApp(page);
  await addFigure(page);
  await openTab(page, 'sel');
  await showLayers(page);
  const fill = page.locator('#figureFill');
  // como el selector nativo: varios «input» mientras se arrastra y, al cerrarlo, un «change»
  for (const c of ['#aa0000', '#cc2200', '#eb3512']) await fill.evaluate((el: HTMLInputElement, c) => { el.value = c; el.dispatchEvent(new Event('input', { bubbles: true })); }, c);
  await expect.poll(() => thumbColor(page)).toEqual([235, 53, 18]); // vista previa: ya se ve en la miniatura
  // se cierra con un clic fuera (en el fondo del lienzo): la forma se deselecciona antes del «change»
  await closeCards(page);
  await page.mouse.click(30, 300);
  await fill.evaluate((el: HTMLInputElement) => { el.dispatchEvent(new Event('change', { bubbles: true })); el.blur(); });
  await expect.poll(() => thumbColor(page)).toEqual([235, 53, 18]);
  // todo el arrastre del color es un solo paso de deshacer
  await page.locator('#undo').click();
  await expect.poll(() => thumbColor(page)).toEqual([36, 88, 166]);
});

test('Alt + Mayús y Mayús + Alt arrastran una copia en línea recta', async ({ page }) => {
  await openApp(page);
  await addFigure(page);
  const a = await savedBox(page), map = await screenMap(page, a);
  const c = map.toScreen((a.x0 + a.x1) / 2, (a.y0 + a.y1) / 2);
  for (const [first, second, n] of [['Alt', 'Shift', 2], ['Shift', 'Alt', 3]] as const) {
    await page.keyboard.down(first); await page.keyboard.down(second);
    // desde la original (la copia queda lejos: Mayús + Alt sobre una no seleccionada la coge sola)
    await drag(page, c, { x: c.x + 220, y: c.y + 6 });
    await page.keyboard.up(second); await page.keyboard.up(first);
    await expect.poll(() => count(page)).toBe(n);
    const b = (await saved(page))!.boxes.at(-1)!;
    expect(b.y0).toBeCloseTo(a.y0, 6); // Mayús: en horizontal
    expect(b.x0).toBeGreaterThan(a.x0 + 10);
  }
});

test('Ctrl + arrastrar un lado lo recorta sin entrar en Recortar, en un paso de deshacer', async ({ page }) => {
  await openApp(page);
  await addFigure(page);
  const a = await savedBox(page), map = await screenMap(page, a);
  await closeCards(page);
  const e = map.toScreen(a.x1, (a.y0 + a.y1) / 2);
  await drag(page, e, { x: e.x - 60, y: e.y }, ['Control']);
  const b = await savedBox(page, (b) => b.w < a.w - 10);
  expect(b.x0).toBeCloseTo(a.x0, 6); // el lado izquierdo no se mueve
  expect(b.h).toBeCloseTo(a.h, 6); // ni se estira en alto
  await expect(page.locator('#ctxbar [data-act=done]')).toHaveCount(0); // no se entró en el modo de recorte
  await page.locator('#undo').click();
  await savedBox(page, (b) => Math.abs(b.w - a.w) < 1e-6);
});
