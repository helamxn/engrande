import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test, type Page } from '@playwright/test';
import { openApp, selectRow, startText } from './helpers';

const require = createRequire(import.meta.url);
const bytes = [...readFileSync(require.resolve('@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff'))];

async function mockFonts(page: Page, initial: 'prompt' | 'granted' | 'denied') {
  await page.addInitScript(({ bytes, initial }) => {
    const w = window as unknown as { queryLocalFonts: () => Promise<unknown[]>; fontReads: number; fontQueries: number };
    w.fontReads = 0; w.fontQueries = 0;
    const status = Object.assign(new EventTarget(), { state: localStorage.getItem('test-font-permission') ?? initial });
    const original = navigator.permissions.query.bind(navigator.permissions);
    navigator.permissions.query = ((descriptor: PermissionDescriptor) => descriptor.name === ('local-fonts' as PermissionName)
      ? Promise.resolve(status as PermissionStatus) : original(descriptor));
    w.queryLocalFonts = async () => {
      w.fontQueries++;
      if (status.state === 'denied') throw new DOMException('Denied', 'NotAllowedError');
      localStorage.setItem('test-font-permission', 'granted'); status.state = 'granted';
      return ['Regular', 'Bold'].map(style => ({ family: 'Roboto', fullName: `Roboto ${style}`, postscriptName: `RobotoLocal-${style}`, style,
        blob: async () => { w.fontReads++; return new Blob([new Uint8Array(bytes)], { type: 'font/woff' }); } }));
    };
  }, { bytes, initial });
}

async function addText(page: Page) {
  await startText(page);
  await page.locator('.text-editor').fill('Fuentes del equipo');
  await page.locator('.text-editor').press('Escape');
  await expect(page.locator('#selectionCard')).toBeVisible();
}

test('no pide permiso al abrir; lo pide al agregar el primer texto y lee solo la variante elegida', async ({ page }) => {
  await mockFonts(page, 'prompt'); await openApp(page);
  expect(await page.evaluate(() => (window as unknown as { fontQueries: number }).fontQueries)).toBe(0);
  await addText(page);
  expect(await page.evaluate(() => (window as unknown as { fontQueries: number }).fontQueries)).toBe(1);
  expect(await page.evaluate(() => (window as unknown as { fontReads: number }).fontReads)).toBe(0);
  await expect(page.locator('#tFont optgroup[label="De tu equipo"] option')).toHaveCount(1);
  await expect(page.locator('#tLocalStatus')).toBeHidden(); // con las fuentes en la lista no hay nada que avisar
  await page.selectOption('#tFont', 'l:RobotoLocal-Regular');
  await expect(page.locator('#tFontStyle')).toHaveValue('l:RobotoLocal-Regular');
  expect(await page.evaluate(() => (window as unknown as { fontReads: number }).fontReads)).toBe(1);
  await page.waitForTimeout(1500);
  await page.reload();
  await selectRow(page);
  await expect(page.locator('#tFont')).toHaveValue('l:RobotoLocal-Regular');
  await expect(page.locator('#tFont optgroup[label="De tu equipo"] option')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { fontQueries: number }).fontQueries)).toBe(1);
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.keyboard.press('Enter');
  await expect(page.locator('.text-editor')).toHaveValue('Fuentes del equipo');
});

test('con permiso concedido el catálogo del equipo se carga por defecto', async ({ page }) => {
  await mockFonts(page, 'granted'); await openApp(page); await addText(page);
  await expect(page.locator('#tFont optgroup[label="De tu equipo"] option')).toHaveCount(1);
  expect(await page.evaluate(() => (window as unknown as { fontReads: number }).fontReads)).toBe(0);
});

test('si el permiso se deniega no se vuelve a preguntar y siguen las incluidas y la carga manual', async ({ page }) => {
  await mockFonts(page, 'denied'); await openApp(page); await addText(page);
  expect(await page.evaluate(() => (window as unknown as { fontQueries: number }).fontQueries)).toBe(0);
  await expect(page.locator('#tLocalStatus')).toContainText('no tienen permiso');
  await expect(page.locator('#tFont optgroup[label="Incluidas"] option')).toHaveCount(20);
  await expect(page.locator('#tFont option[value="__load"]')).toHaveCount(1);
  await expect(page.locator('#fontFile')).toBeAttached();
});

test('sin API local se ofrece cargar archivos sin bloquear la edición', async ({ page }) => {
  await page.addInitScript(() => { Object.defineProperty(window, 'queryLocalFonts', { value: undefined }); });
  await openApp(page); await addText(page);
  await expect(page.locator('#tLocalStatus')).toContainText('Cargar archivo de fuente');
});

test('Edge puede usar una fuente instalada real con permiso en el perfil temporal', async ({ page, context }) => {
  test.setTimeout(120_000);
  await context.grantPermissions(['local-fonts']);
  await openApp(page); await addText(page);
  // leer todas las fuentes instaladas tarda (más con las pruebas en paralelo)
  await expect(page.locator('#tFont optgroup[label="De tu equipo"] option').first()).toBeAttached({ timeout: 90_000 });
  const id = await page.locator('#tFont optgroup[label="De tu equipo"] option').evaluateAll(options =>
    (options.find(o => o.textContent === 'Arial') as HTMLOptionElement | undefined)?.value ?? '');
  expect(id).toMatch(/^l:/);
  await page.selectOption('#tFont', id);
  await expect(page.locator('#tFontStyle')).toHaveValue(id);
  await expect(page.locator('#tFontStatus')).toBeHidden(); // cargada: sin avisos
});

test('si la fuente del equipo no llega, editar el texto no deja el cuadro abierto sin salida', async ({ page }) => {
  // primera visita: se elige una fuente del equipo para el texto
  await mockFonts(page, 'granted'); await openApp(page); await addText(page);
  await page.selectOption('#tFont', 'l:RobotoLocal-Regular');
  await expect(page.locator('#tFont')).toHaveValue('l:RobotoLocal-Regular');
  await page.waitForTimeout(1500); // guardado
  // siguiente visita: la lectura de las fuentes del equipo se queda esperando (nunca responde)
  await page.addInitScript(() => {
    (window as unknown as { queryLocalFonts: () => Promise<unknown[]> }).queryLocalFonts = () => new Promise(() => {});
  });
  await page.reload();
  await expect(page.locator('#toast')).toContainText('Se recuperó tu póster');
  await selectRow(page);
  // sin cambios: Esc cierra al momento
  await page.keyboard.press('Enter');
  await expect(page.locator('.text-editor')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.text-editor')).toHaveCount(0);
  await expect(page.locator('#selectionTitle')).toHaveText('Texto');
  // con cambios y sin la fuente: se cierra igual, avisa y guarda las palabras
  await page.keyboard.press('Enter');
  await page.keyboard.type(' nuevo');
  await page.keyboard.press('Escape');
  await expect(page.locator('.text-editor')).toHaveCount(0, { timeout: 8000 });
  await expect(page.locator('#toast')).toContainText('Falta la fuente');
  await expect(page.locator('#selectionTitle')).toHaveText('Texto'); // seleccionado: se puede mover y escalar
  // al volver a editarlo se retoman las palabras guardadas
  await page.keyboard.press('Enter');
  await expect(page.locator('.text-editor')).toHaveValue('Fuentes del equipo nuevo');
});
