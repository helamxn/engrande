/**
 * Persona de referencia: el botón de la isla de vista pone una persona de 1,70 m junto al póster. Se activa cuando
 * hay póster a la vista, encuadra la persona y el póster juntos, se recuerda al recargar y no sale en el PDF
 * (solo se dibuja en el lienzo).
 */
import { expect, test } from '@playwright/test';
import { addImage, openApp } from './helpers';

const pct = async (page: import('@playwright/test').Page) => Number((await page.locator('#zoomPct').textContent())!.replace('%', ''));

test('la persona de 1,70 m se muestra, encuadra con el póster y se recuerda', async ({ page }) => {
  await openApp(page);
  const btn = page.locator('#scaleRef');
  // sin póster a la vista no hay con qué comparar
  await expect(btn).toBeDisabled();
  await addImage(page);
  await expect(btn).toBeEnabled();
  await expect(btn).toHaveAttribute('aria-pressed', 'false');
  const z0 = await pct(page);

  // al mostrarla se encuadra todo: la persona es más alta que este póster, así que el zoom baja
  await btn.click();
  await expect(btn).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => pct(page)).toBeLessThan(z0);

  // se recuerda en este navegador
  await page.reload();
  await expect(page.locator('#scaleRef')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(() => pct(page)).toBeLessThan(z0);

  // al quitarla, vuelve el encuadre del póster solo
  await page.locator('#scaleRef').click();
  await expect(page.locator('#scaleRef')).toHaveAttribute('aria-pressed', 'false');
  await expect.poll(() => pct(page)).toBe(z0);
});
