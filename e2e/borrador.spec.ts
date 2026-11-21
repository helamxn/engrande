/** Dureza del borrador: borde nítido (100 %) o que se desvanece (fotos, pelo, sombras). */
import { expect, test, type Page } from '@playwright/test';
import { addImage, closeCards, drag, openApp, selectRow } from './helpers';

/** Píxeles semitransparentes y transparentes del lienzo editado guardado (el PNG del borrador). */
const editedAlpha = (page: Page) => page.evaluate(() => new Promise<{ soft: number; clear: number } | null>((res) => {
  const q = indexedDB.open('pliego', 1);
  q.onsuccess = () => {
    const t = q.result.transaction(['project', 'blobs']);
    const g = t.objectStore('project').get('current');
    g.onsuccess = () => {
      const key = (g.result as { layers: { edit: string | null }[] } | undefined)?.layers[0]?.edit;
      if (!key) { res(null); return; }
      const b = t.objectStore('blobs').get(key);
      b.onsuccess = async () => {
        const bmp = await createImageBitmap(b.result as Blob), c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d')!;
        x.drawImage(bmp, 0, 0);
        const d = x.getImageData(0, 0, bmp.width, bmp.height).data;
        let soft = 0, clear = 0;
        for (let i = 3; i < d.length; i += 4) { if (d[i]! === 0) clear++; else if (d[i]! > 8 && d[i]! < 247) soft++; }
        res({ soft, clear });
      };
    };
  };
}));

async function erase(page: Page, hard: number) {
  await openApp(page);
  await addImage(page, { color: '#3366cc' });
  await selectRow(page);
  await closeCards(page);
  await page.locator('#ctxbar [data-act=erase]').click();
  await page.locator('#bHard').evaluate((el: HTMLInputElement, v) => { el.value = String(v); el.dispatchEvent(new Event('input', { bubbles: true })); }, hard);
  await expect(page.locator('#bHardOut')).toHaveText(`${hard} %`);
  const cv = (await page.locator('#cv').boundingBox())!, y = cv.y + cv.height / 2;
  await drag(page, { x: cv.x + cv.width / 2 - 120, y }, { x: cv.x + cv.width / 2 + 120, y });
  await page.keyboard.press('Escape');
  await expect.poll(() => editedAlpha(page), { timeout: 15_000 }).not.toBeNull();
  return (await editedAlpha(page))!;
}

test('con dureza 0 % el borde del trazo se desvanece', async ({ page }) => {
  const a = await erase(page, 0);
  expect(a.clear).toBeGreaterThan(100);
  expect(a.soft).toBeGreaterThan(a.clear * 0.5); // un buen borde semitransparente
});

test('con dureza 100 % el borde es nítido (solo el antialias)', async ({ page }) => {
  const a = await erase(page, 100);
  expect(a.clear).toBeGreaterThan(100);
  expect(a.soft).toBeLessThan(a.clear * 0.15);
});
