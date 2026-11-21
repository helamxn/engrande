/** Contorno del texto y letras huecas (plantillas para recortar o calcar). */
import { expect, test, type Page } from '@playwright/test';
import { openApp, startText } from './helpers';

/** Especificación guardada del primer texto (contorno, color y huecas). */
const savedText = (page: Page) => page.evaluate(() => new Promise<Record<string, unknown> | null>((res) => {
  const q = indexedDB.open('pliego', 1);
  q.onsuccess = () => {
    const g = q.result.transaction('project').objectStore('project').get('current');
    g.onsuccess = () => {
      const l = (g.result as { layers: { src: { kind: string; spec?: Record<string, unknown> } }[] } | undefined)?.layers.find((x) => x.src.kind === 'text');
      res(l?.src.spec ?? null);
    };
  };
}));
const slide = (page: Page, id: string, v: number) => page.locator(id).evaluate((el: HTMLInputElement, v) => {
  el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
}, v);

test('contorno en mm, letras huecas y deshacer; se guarda con el texto', async ({ page }) => {
  await openApp(page);
  await startText(page);
  await page.keyboard.type('MOLDE');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tOutlineOut')).toHaveText('sin contorno');
  // un arrastre del grosor: un solo paso de deshacer; el valor se lee en mm sobre el papel
  for (const v of [10, 20, 30]) await slide(page, '#tOutline', v);
  await expect(page.locator('#tOutlineOut')).toHaveText(/^\d+(,\d)? mm$/);
  await expect.poll(() => savedText(page), { timeout: 15_000 }).toMatchObject({ outline: 30 });
  await page.locator('#tHollow').check();
  await expect.poll(() => savedText(page), { timeout: 15_000 }).toMatchObject({ outline: 30, hollow: true });
  await page.keyboard.press('Control+z'); // las huecas
  await expect(page.locator('#tHollow')).not.toBeChecked();
  await page.keyboard.press('Control+z'); // el grosor, de una vez
  await expect(page.locator('#tOutlineOut')).toHaveText('sin contorno');
});

test('vaciar las letras sin contorno les pone uno del color del texto', async ({ page }) => {
  await openApp(page);
  await startText(page);
  await page.keyboard.type('A');
  await page.keyboard.press('Escape');
  await page.locator('#tHollow').check();
  await expect(page.locator('#tOutlineOut')).not.toHaveText('sin contorno');
  await expect.poll(() => savedText(page), { timeout: 15_000 }).toMatchObject({ hollow: true, outline: 25, outlineColor: '#111111' });
});
