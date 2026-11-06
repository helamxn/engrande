/** Ventana de atajos: se abre con «?», el buscador filtra y Esc la cierra sin tocar el póster. */
import { expect, test } from '@playwright/test';
import { addImage, openApp, selectRow } from './helpers';

test('«?» abre los atajos con el buscador listo; buscar filtra y Esc cierra', async ({ page }) => {
  await openApp(page);
  await page.keyboard.press('?');
  const dialog = page.getByRole('dialog', { name: 'Atajos de teclado y gestos' });
  await expect(dialog).toBeVisible();
  const search = dialog.getByRole('searchbox', { name: 'Buscar atajos' });
  await expect(search).toBeFocused();
  const rows = dialog.locator('.sk-row:visible dt');
  // una letra suelta se busca como tecla: «ctrl g» es agrupar y desagrupar, no todo lo que lleva una g
  await search.fill('ctrl g');
  await expect(rows).toHaveText(['Agrupar (también grupos)', 'Desagrupar un nivel']);
  // sin tildes ni mayúsculas
  await search.fill('MENU');
  await expect(rows.first()).toHaveText('Menú de opciones');
  await search.fill('zzz');
  await expect(dialog.getByRole('status')).toHaveText('Nada coincide con «zzz».');
  // Esc primero borra la búsqueda y después cierra
  await page.keyboard.press('Escape');
  await expect(search).toHaveValue('');
  await expect(rows.first()).toHaveText('Ver esta ayuda');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  // al volver a abrir, la búsqueda empieza vacía
  await page.keyboard.press('?');
  await search.fill('girar');
  await page.locator('#shortcutsClose').click();
  await page.keyboard.press('?');
  await expect(search).toHaveValue('');
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
