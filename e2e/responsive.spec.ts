/**
 * Diseño en todos los tamaños: teléfono (320 y 390), teléfono girado, tableta y escritorio (960 y 1920). Con una
 * imagen seleccionada nada se sale de la pantalla ni se monta sobre otra isla, las barras no esconden botones y las
 * ventanas (PDF, Póster, Capas) caben y se abren bajo la cabecera.
 */
import { expect, test, type Page } from '@playwright/test';
import { addImage, openApp } from './helpers';

const SIZES = [
  { name: 'teléfono 320', width: 320, height: 640, touch: true },
  { name: 'teléfono 390', width: 390, height: 844, touch: true },
  { name: 'teléfono girado', width: 844, height: 390, touch: true },
  { name: 'tableta', width: 1024, height: 768, touch: true },
  { name: 'escritorio 960', width: 960, height: 700, touch: false },
  { name: 'escritorio 1920', width: 1920, height: 1080, touch: false },
];
const ISLANDS = ['header', '#tools', '#panelOpeners', '#toolbar', '#ctxbar', '#panel'];

/** Cajas de las islas visibles, si la página tiene scroll horizontal y cuánto desborda la barra. */
const layout = (page: Page) => page.evaluate((ids) => {
  const boxes: Record<string, { x: number; y: number; r: number; b: number }> = {};
  for (const id of ids) {
    const e = document.querySelector<HTMLElement>(id);
    if (!e || !e.getClientRects().length) continue;
    const r = e.getBoundingClientRect();
    if (r.width > 1 && r.height > 1) boxes[id] = { x: r.x, y: r.y, r: r.right, b: r.bottom };
  }
  const over = (id: string) => { const b = document.querySelector<HTMLElement>(id)!; return b.scrollWidth - b.clientWidth; };
  return { boxes, hscroll: document.documentElement.scrollWidth > innerWidth, barOverflow: Math.max(over('#ctxbar'), over('#toolbar')) };
}, ISLANDS);

for (const s of SIZES) {
  test.describe(s.name, () => {
    test.use({ viewport: { width: s.width, height: s.height }, hasTouch: s.touch, isMobile: s.touch && s.width < 768 });

    test('nada se sale ni se monta, y las ventanas caben bajo la cabecera', async ({ page }) => {
      await openApp(page);
      await addImage(page);
      await page.locator('#toast').evaluate((t: HTMLElement) => { t.hidden = true; });
      const m = await layout(page);
      expect(m.hscroll).toBe(false);
      expect(m.barOverflow).toBeLessThanOrEqual(1);
      const ids = Object.keys(m.boxes);
      for (const id of ids) {
        const b = m.boxes[id]!;
        expect(b.x, `${id} dentro`).toBeGreaterThanOrEqual(0);
        expect(b.r, `${id} dentro`).toBeLessThanOrEqual(s.width + 1);
        expect(b.b, `${id} dentro`).toBeLessThanOrEqual(s.height + 1);
      }
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
        const a = m.boxes[ids[i]!]!, c = m.boxes[ids[j]!]!;
        const ix = Math.min(a.r, c.r) - Math.max(a.x, c.x), iy = Math.min(a.b, c.b) - Math.max(a.y, c.y);
        expect(ix > 1 && iy > 1, `${ids[i]} sobre ${ids[j]}`).toBe(false);
      }
      // la ventana del PDF: bajo la cabecera y dentro de la pantalla
      const head = (await page.locator('header').boundingBox())!;
      await page.locator('#exportMore').click();
      const card = (await page.locator('#pdfCard').boundingBox())!;
      expect(card.y).toBeGreaterThanOrEqual(head.y + head.height + 4);
      expect(card.x).toBeGreaterThanOrEqual(0);
      expect(card.x + card.width).toBeLessThanOrEqual(s.width);
      expect(card.y + card.height).toBeLessThanOrEqual(s.height);
      await page.keyboard.press('Escape');
      // Capas: su ventana (escritorio y tableta), también bajo la cabecera
      if (await page.locator('#panelOpeners').isVisible()) {
        await page.locator('#panelOpeners [data-open="image"]').click();
        const lc = (await page.locator('#layersCard').boundingBox())!;
        expect(lc.y).toBeGreaterThanOrEqual(head.y + head.height + 4);
        expect(lc.x + lc.width).toBeLessThanOrEqual((await page.locator('#panel').boundingBox())!.x);
      }
    });
  });
}
