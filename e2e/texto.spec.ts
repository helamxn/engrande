/** Textos: escribir sobre el lienzo, editarlos, su panel, fuentes del usuario y el guardado como contornos. */
import { expect, test, type Page } from '@playwright/test';
import { saved, expectSavedNames, listNames, openApp, selectRow, startText } from './helpers';

/** Lo guardado de cada capa: su clase de origen y, si es texto, sus palabras y su fuente. */
function savedSources(page: Page) {
  return page.evaluate(() => new Promise<{ kind: string; text?: string; font?: string }[] | null>((res) => {
    const q = indexedDB.open('pliego', 1);
    q.onupgradeneeded = () => { q.result.createObjectStore('project'); q.result.createObjectStore('blobs'); };
    q.onsuccess = () => {
      const t = q.result.transaction('project'), g = t.objectStore('project').get('current');
      t.oncomplete = () => {
        const p = g.result as { layers: { src: { kind: string; spec?: { text: string; font: string } } }[] } | undefined;
        res(p ? p.layers.map((l) => ({ kind: l.src.kind, text: l.src.spec?.text, font: l.src.spec?.font })) : null);
      };
    };
  }));
}

/** Escribe un texto nuevo con T (y un clic donde va) y termina con Esc. */
async function writeText(page: Page, text: string) {
  await page.locator('#cv').click({ position: { x: 20, y: 300 } });
  await page.keyboard.press('t');
  await page.locator('#cv').click({ position: { x: 220, y: 260 } });
  const box = page.locator('.text-editor');
  await expect(box).toBeFocused();
  await page.keyboard.type(text.replace(/\n/g, ''), { delay: 5 });
  await page.keyboard.press('Escape');
  await expect(box).toHaveCount(0);
}

test('escribir un texto lo deja en el póster como contornos; Enter lo edita y vacío se quita', async ({ page }) => {
  await openApp(page);
  await writeText(page, 'Hola');
  await expect(page.locator('#empty')).toBeHidden(); // la bienvenida se va al escribir
  expect(await listNames(page)).toEqual(['Hola*']);
  await expect(page.locator('#tFont')).toHaveValue('b:archivo-black');
  await expect(page.locator('#tCap')).not.toHaveValue('');
  await expectSavedNames(page, ['Hola']);
  expect(await savedSources(page)).toEqual([{ kind: 'text', text: 'Hola', font: 'b:archivo-black' }]);

  // Enter: escribir otra vez, con el cursor al final; el nombre sigue a las palabras
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Enter');
  await expect(page.locator('.text-editor')).toHaveValue('Hola');
  await page.keyboard.type(' mundo');
  await page.keyboard.press('Escape');
  await expectSavedNames(page, ['Hola mundo']);

  // las herramientas de píxeles no se aplican a un texto
  await page.keyboard.press('c');
  await expect(page.locator('#toast')).toContainText('el texto no se puede recortar');

  // deshacer devuelve las palabras de antes
  await page.keyboard.press('Control+z');
  await expectSavedNames(page, ['Hola']);

  // vaciarlo lo quita del póster (y se puede deshacer)
  await page.keyboard.press('Enter');
  await page.keyboard.press('Control+a');
  await page.keyboard.press('Backspace');
  await page.keyboard.press('Escape');
  await expect(page.locator('#layers li.layer')).toHaveCount(0);
  await page.locator('#undo').click();
  await expect(page.locator('#layers li.layer')).toHaveCount(1);
});

test('el panel cambia fuente, color y alto de letra; tras recargar el texto sigue igual', async ({ page }) => {
  await openApp(page);
  await writeText(page, 'Feliz');
  await page.selectOption('#tFont', 'b:saira-stencil');
  await expect.poll(async () => (await savedSources(page))?.[0]?.font, { timeout: 15_000 }).toBe('b:saira-stencil');
  await page.locator('#tColor').evaluate((el: HTMLInputElement) => { el.value = '#d81b60'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.locator('#tCap').fill('10');
  await page.locator('#tCap').press('Enter');
  await expect(page.locator('#tCap')).toHaveValue('10');
  const w = await page.locator('#pW').inputValue();
  await expectSavedNames(page, ['Feliz']);
  await page.waitForTimeout(1500); // el último cambio también llega a guardarse

  await page.reload();
  await expect(page.locator('#toast')).toContainText('Se recuperó tu póster');
  await selectRow(page, 0);
  await expect(page.locator('#tFont')).toHaveValue('b:saira-stencil');
  await expect(page.locator('#tColor')).toHaveValue('#d81b60');
  await expect(page.locator('#tCap')).toHaveValue('10');
  await expect(page.locator('#pW')).toHaveValue(w);
});

test('una fuente del usuario se usa sin guardarse; tras recargar pide cargarla para cambiar las palabras', async ({ page }) => {
  await openApp(page);
  await writeText(page, 'Ana');
  // una fuente cualquiera en WOFF: la incluida, con otro nombre de archivo
  const url = await page.evaluate(() => [...performance.getEntriesByType('resource')].map((e) => e.name).find((n) => /\.woff(\?|$)/.test(n))!);
  const bytes = await (await page.request.get(url)).body();
  await page.setInputFiles('#fontFile', { name: 'MiFuente.woff', mimeType: 'font/woff', buffer: bytes });
  await expect(page.locator('#toast')).toContainText('lista');
  await expect(page.locator('#tFont')).toHaveValue(/^u:/);
  await expect.poll(async () => (await savedSources(page))?.[0]?.font ?? '', { timeout: 15_000 }).toMatch(/^u:/);
  // en la base de datos solo está el póster: ningún archivo de fuente
  const blobs = await page.evaluate(() => new Promise<number>((res) => {
    const q = indexedDB.open('pliego', 1);
    q.onsuccess = () => { const r = q.result.transaction('blobs').objectStore('blobs').count(); r.onsuccess = () => res(r.result); };
  }));
  expect(blobs).toBe(0);

  await page.reload();
  await expect(page.locator('#toast')).toContainText('Se recuperó tu póster');
  expect(await listNames(page)).toEqual(['Ana']);
  await selectRow(page, 0);
  await expect(page.locator('#tFont option:checked')).toContainText('(sin cargar)');
  await page.keyboard.press('Enter');
  await expect(page.locator('#toast')).toContainText('vuelve a cargar la fuente');
  await expect(page.locator('.text-editor')).toHaveCount(0);

  // los WOFF2 se rechazan con una explicación
  await page.setInputFiles('#fontFile', { name: 'otra.woff2', mimeType: 'font/woff2', buffer: Buffer.from('wOF2') });
  await expect(page.locator('#toast')).toContainText('WOFF2');
});

/** Estado completo para comprobar borradores y medidas físicas. */
function project(page: Page) {
  return page.evaluate(() => new Promise<{
    draft?: { text: string } | null;
    layers: { w: number; src: { spec: { text: string; font: string; color: string } } }[];
  } | null>((resolve) => {
    const q = indexedDB.open('pliego', 1);
    q.onsuccess = () => {
      const r = q.result.transaction('project').objectStore('project').get('current');
      r.onsuccess = () => { resolve(r.result ?? null); q.result.close(); };
    };
  }));
}

test('recupera un texto nuevo sin terminar y confirma la edición en un paso de deshacer', async ({ page }) => {
  await openApp(page);
  await startText(page);
  await page.locator('.text-editor').fill('Mi borrador');
  await expect.poll(async () => (await project(page))?.draft?.text).toBe('Mi borrador');
  await page.reload();
  await expect(page.locator('.text-editor')).toHaveValue('Mi borrador');
  await page.locator('.text-editor').press('Escape');
  await expectSavedNames(page, ['Mi borrador']);
  expect((await project(page))?.draft).toBeNull();
  await page.locator('#undo').click();
  await expect(page.locator('#layers li.layer')).toHaveCount(0);
});

test('recupera cambios pendientes de una capa y deshacer devuelve sus palabras anteriores', async ({ page }) => {
  await openApp(page);
  await writeText(page, 'Antes');
  await expectSavedNames(page, ['Antes']);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Enter');
  await page.locator('.text-editor').fill('Después');
  await expect.poll(async () => (await project(page))?.draft?.text).toBe('Después');
  await page.reload();
  await expect(page.locator('.text-editor')).toHaveValue('Después');
  await page.locator('.text-editor').press('Escape');
  await expectSavedNames(page, ['Después']);
  await page.locator('#undo').click();
  await expectSavedNames(page, ['Antes']);
});

test('el límite de entrada no impide recuperar textos antiguos más largos', async ({ page }) => {
  await openApp(page);
  await writeText(page, 'Hola');
  await expectSavedNames(page, ['Hola']);
  await page.evaluate(() => new Promise<void>((resolve) => {
    const q = indexedDB.open('pliego', 1);
    q.onsuccess = () => {
      const t = q.result.transaction('project', 'readwrite'), store = t.objectStore('project'), r = store.get('current');
      r.onsuccess = () => { r.result.layers[0].src.spec.text = 'A' + ' '.repeat(10000); store.put(r.result, 'current'); };
      t.oncomplete = () => { q.result.close(); resolve(); };
    };
  }));
  await page.reload();
  await expect(page.locator('#layers li.layer')).toHaveCount(1);
  expect((await project(page))?.layers[0]?.src.spec.text.length).toBe(10001);
  await startText(page, { x: 220, y: 600 });
  await page.keyboard.insertText('A' + ' '.repeat(10000));
  await expect(page.locator('.text-editor')).toHaveJSProperty('value', 'A' + ' '.repeat(9999));
});

test('la última fuente elegida gana, aunque la primera descargue más tarde', async ({ page }) => {
  await openApp(page);
  await writeText(page, 'Hola');
  await page.route('**/*playfair-display-latin-400-normal*.woff', async route => {
    await new Promise(resolve => setTimeout(resolve, 1500)); await route.continue();
  });
  await page.selectOption('#tFont', 'g:playfair-display:400:normal');
  await page.selectOption('#tFont', 'b:saira-stencil');
  await expect(page.locator('#tFontStatus')).not.toHaveText('Cargando fuente…');
  await page.waitForTimeout(1800);
  await expect.poll(async () => (await savedSources(page))?.[0]?.font, { timeout: 15000 }).toBe('b:saira-stencil');
});

test('elegir otra fuente incluida, cambiar estilo y conservar el tamaño en puntos', async ({ page }) => {
  await openApp(page);
  await writeText(page, 'Ñandú');
  await page.locator('#tSize').fill('72');
  await page.locator('#tSize').press('Enter');
  await expect(page.locator('#tFont optgroup[label="Incluidas"] option[value="g:roboto:400:normal"]')).toHaveCount(1);
  await page.selectOption('#tFont', 'g:roboto:400:normal');
  await expect(page.locator('#tFontStyle')).toHaveValue('g:roboto:400:normal');
  await page.selectOption('#tFontStyle', 'g:roboto:700:italic');
  await expect.poll(async () => (await savedSources(page))?.[0]?.font, { timeout: 15000 }).toBe('g:roboto:700:italic');
  await expect(page.locator('#tSize')).toHaveValue('72');
  const cap = +(await page.locator('#tCap').inputValue()).replace(',', '.');
  expect(cap).toBeGreaterThan(1); expect(cap).toBeLessThan(2.54);
  await page.reload(); await selectRow(page);
  await expect(page.locator('#tSize')).toHaveValue('72');
  await expect(page.locator('#tFontStyle')).toHaveValue('g:roboto:700:italic');
});

test('pegar un color, rechazar valores inválidos y restaurar el predeterminado se pueden deshacer', async ({ page }) => {
  await openApp(page); await writeText(page, 'Color');
  const hex = page.locator('#tColorHex');
  await hex.fill('D81B60'); await hex.press('Enter');
  await expect(hex).toHaveValue('#d81b60'); await expect(page.locator('#tColor')).toHaveValue('#d81b60');
  await hex.fill('#12'); await hex.press('Enter');
  await expect(hex).toHaveAttribute('aria-invalid', 'true');
  await expect(page.locator('#tColor')).toHaveValue('#d81b60');
  await page.locator('#tColorReset').click();
  await expect(hex).toHaveValue('#111111');
  await page.locator('#undo').click();
  await expect(hex).toHaveValue('#d81b60');
  await page.locator('#undo').click();
  await expect(hex).toHaveValue('#111111');
});

test('un arrastre de color reutiliza la vista previa y genera un solo paso de deshacer', async ({ page }) => {
  await openApp(page); await writeText(page, 'Color');
  const stats = await page.locator('#tColor').evaluate(async (el: HTMLInputElement) => {
    el.focus();
    const make = document.createElement.bind(document);
    let canvases = 0, mutations = 0;
    const observer = new MutationObserver(entries => { mutations += entries.length; });
    observer.observe(document.querySelector('#layers')!, { childList: true, subtree: true });
    document.createElement = ((tag: string, options?: ElementCreationOptions) => {
      if (tag === 'canvas') canvases++;
      return make(tag, options);
    }) as typeof document.createElement;
    const start = performance.now();
    try {
      for (let i = 0; i < 100; i++) {
        el.value = '#' + (0x220000 + i * 123).toString(16).padStart(6, '0');
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }
      const inputMs = performance.now() - start;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = { canvases, mutations, inputMs };
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return result;
    } finally { document.createElement = make; observer.disconnect(); }
  });
  expect(stats.canvases).toBe(1);
  expect(stats.mutations).toBe(0);
  console.log('100 eventos de color:', stats);
  await page.locator('#undo').click();
  await expect(page.locator('#tColorHex')).toHaveValue('#111111');
  await expect(page.locator('#layers li.layer')).toHaveCount(1);
  await page.reload(); await selectRow(page);
  await expect(page.locator('#tColorHex')).toHaveValue('#111111');
});

test('un borrador con fuente propia conserva sus palabras hasta volver a cargarla', async ({ page }) => {
  await openApp(page); await writeText(page, 'Antes');
  const url = await page.evaluate(() => performance.getEntriesByType('resource').map(e => e.name).find(n => /\.woff$/.test(n))!);
  const bytes = await (await page.request.get(url)).body();
  const file = { name: 'Propia.woff', mimeType: 'font/woff', buffer: bytes };
  await page.setInputFiles('#fontFile', file);
  await expect.poll(async () => (await savedSources(page))?.[0]?.font ?? '', { timeout: 15000 }).toMatch(/^u:/);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Enter');
  await page.locator('.text-editor').fill('Palabras recuperadas');
  await expect.poll(async () => (await project(page))?.draft?.text).toBe('Palabras recuperadas');
  await page.reload();
  // sin la fuente no se abre la edición (no habría forma de terminarla): el texto sigue igual y las palabras, guardadas
  await expect(page.locator('#toast')).toContainText('Se recuperó tu póster');
  await expect(page.locator('.text-editor')).toHaveCount(0);
  expect(await listNames(page)).toEqual(['Antes']);
  expect((await project(page))?.draft?.text).toBe('Palabras recuperadas');
  await selectRow(page);
  await page.keyboard.press('Enter');
  await expect(page.locator('#toast')).toContainText('vuelve a cargar la fuente');
  await expect(page.locator('.text-editor')).toHaveCount(0);
  // con la fuente de nuevo, editarlo retoma las palabras guardadas
  await page.setInputFiles('#fontFile', file);
  await expect(page.locator('#toast')).toContainText('lista');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Enter');
  await expect(page.locator('.text-editor')).toHaveValue('Palabras recuperadas');
  await page.locator('.text-editor').press('Escape');
  await expectSavedNames(page, ['Palabras recuperadas']);
});

test('los controles de texto caben en escritorio y móvil', async ({ page }, testInfo) => {
  await openApp(page); await writeText(page, 'Feliz cumpleaños');
  await page.locator('#tSize').fill('96'); await page.locator('#tSize').press('Enter');
  await page.locator('#tSize').evaluate(el => el.scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: testInfo.outputPath('texto-escritorio.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#sheetHandle').click(); // en el móvil, la tarjeta del texto está en el panel inferior
  await page.locator('#tColorHex').scrollIntoViewIfNeeded();
  for (const selector of ['#tSize', '#tCap', '#tColor', '#tColorHex', '#tColorReset']) {
    const box = await page.locator(selector).boundingBox();
    expect(box!.x).toBeGreaterThanOrEqual(0); expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: testInfo.outputPath('texto-movil.png') });
});

test('con ancho fijo las líneas se parten entre palabras; automático las vuelve a unir', async ({ page }) => {
  await openApp(page);
  await writeText(page, 'Feliz');
  const height = async () => (await saved(page))?.boxes[0]?.h ?? 0;
  await expectSavedNames(page, ['Feliz']);
  const h1 = await height();
  // fijo: el ancho de ahora; al escribir más palabras, bajan a otra línea en vez de ensancharlo
  await page.locator('#tWidth [data-w="fixed"]').click();
  await expect(page.locator('#tWidth [data-w="fixed"]')).toHaveAttribute('aria-pressed', 'true');
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Enter');
  await page.keyboard.type(' cumpleaños Ana');
  await page.keyboard.press('Escape');
  await expect.poll(height, { timeout: 15_000 }).toBeGreaterThan(h1 * 2.5);
  // automático: una sola línea otra vez
  await page.locator('#tWidth [data-w="auto"]').click();
  await expect.poll(height, { timeout: 15_000 }).toBeLessThan(h1 * 1.2);
});

test('un texto nuevo sale a 96 pt en cualquier póster, sin encogerse, y el siguiente usa el último tamaño', async ({ page }) => {
  await openApp(page);
  // un póster pequeño (1×1) y un texto largo: no se reduce para caber
  await page.locator('#presets [data-c="1"][data-r="1"]').click();
  await writeText(page, 'Feliz cumpleaños querida Ana');
  await expect(page.locator('#tSize')).toHaveValue('96');
  const w = +(await page.locator('#pW').inputValue()).replace(',', '.');
  expect(w).toBeGreaterThan(21); // más ancho que una hoja A4: se ve tal cual y se ajusta a mano
  // otro tamaño en el panel: el siguiente texto sale igual
  await page.locator('#tSize').fill('150');
  await page.locator('#tSize').press('Enter');
  await page.locator('#selectionClose').click();
  await page.keyboard.press('t');
  await page.locator('#cv').click({ position: { x: 220, y: 650 } });
  await page.keyboard.type('Otro');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tSize')).toHaveValue('150');
});
