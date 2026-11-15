/** Ventana de atajos: se abre con «?» (o desde la bienvenida), lista todo sin buscador y Esc la cierra. */
import { expect, test } from '@playwright/test';
import { addImage, openApp, selectRow } from './helpers';

test('«?» abre los atajos, sin buscador; Esc y la X los cierran', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Atajos de teclado y gestos' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('searchbox')).toHaveCount(0);
  const rows = dialog.locator('.sk-row dt');
  await expect(rows.first()).toHaveText('Ver esta ayuda');
  await expect(dialog.locator('.sk-row', { hasText: 'Agregar imagen o PDF' }).locator('kbd')).toHaveText(['Ctrl', 'O']);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // también desde la bienvenida, y la X la cierra
  await page.locator('#empty').getByRole('button', { name: /Atajos y ayuda/ }).click();
  await expect(dialog).toBeVisible();
  await page.locator('#shortcutsClose').click();
  await expect(dialog).toBeHidden();
  // y desde «?» de la isla de vista, arriba
  await page.locator('#tools').getByRole('button', { name: 'Atajos de teclado y gestos' }).click();
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  // y desde el menú del lienzo vacío
  await page.locator('#cv').click({ button: 'right', position: { x: 40, y: 300 } });
  await page.locator('#menu').getByRole('menuitem', { name: /Atajos y gestos/ }).click();
  await expect(dialog).toBeVisible();
});

test('las teclas se ven igual en el menú que en la ayuda: una tecla por <kbd>', async ({ page }) => {
  await openApp(page);
  await addImage(page);
  await selectRow(page);
  await page.locator('#ctxbar').getByRole('button', { name: /Más opciones/ }).click();
  const copy = page.locator('#menu').getByRole('menuitem', { name: /Copiar/ });
  await expect(copy.locator('.keys kbd')).toHaveText(['Ctrl', 'C']);
  await page.keyboard.press('Escape');
  // la nota de la lista, escrita en el marcado, también
  await expect(page.locator('#pane-image [data-keys] kbd')).toHaveText(['Alt', '↑', 'Alt', '↓']);
});
