/** Cada sección cuando hace falta (tarjetas de Póster y Capas, panel de la selección), la barra fija y la isla de vista. */
import { expect, test } from '@playwright/test';
import { addImage, openApp, startText } from './helpers';

test('cada sección aparece cuando hace falta: Póster y Capas en su tarjeta, Selección al seleccionar', async ({ page }) => {
  await openApp(page);
  const panel = page.locator('#panel'), openers = page.locator('#panelOpeners');
  const poster = page.locator('#posterCard'), layers = page.locator('#layersCard');
  // al entrar no hay panel ni tarjetas: solo sus botones
  await expect(panel).toBeHidden();
  await expect(poster).toBeHidden();
  await expect(openers).toBeVisible();
  // «Póster» abre su tarjeta con las hojas; «Capas», la suya con la lista (y cierra la otra); Esc la cierra
  await openers.locator('[data-open="sheets"]').click();
  await expect(poster).toBeVisible();
  await expect(poster.locator('#presets')).toBeVisible();
  await expect(openers.locator('[data-open="sheets"]')).toHaveAttribute('aria-expanded', 'true');
  await openers.locator('[data-open="image"]').click();
  await expect(layers).toBeVisible();
  await expect(layers.locator('#posterLayers')).toBeVisible();
  await expect(poster).toBeHidden();
  await page.keyboard.press('Escape');
  await expect(layers).toBeHidden();
  // Ctrl+\ muestra u oculta las capas
  await page.keyboard.press('Control+Backslash');
  await expect(layers).toBeVisible();
  await page.keyboard.press('Control+Backslash');
  await expect(layers).toBeHidden();
  // un texto nuevo abre el panel de la selección, solo con lo suyo (sin pestañas)
  await startText(page);
  await page.locator('.text-editor').fill('Texto contextual');
  await page.locator('.text-editor').press('Escape');
  await expect(panel).toBeVisible();
  await expect(page.locator('#sheetTabs')).toBeHidden();
  await expect(page.locator('#selectionTitle')).toHaveText('Texto');
  await expect(page.locator('#tSize')).toBeVisible();
  // posición, tamaño y opacidad, siempre a la vista (sin apartado plegable)
  await expect(page.locator('#pW')).toBeVisible();
  await expect(page.locator('#selectionGeometry summary')).toHaveCount(0);
  // con el panel abierto: los botones siguen arriba (el panel se abre debajo) y la tarjeta de Capas, a su izquierda
  const pb = (await panel.boundingBox())!;
  expect((await openers.boundingBox())!.y + (await openers.boundingBox())!.height).toBeLessThanOrEqual(pb.y);
  await openers.locator('[data-open="image"]').click();
  const lb = (await layers.boundingBox())!;
  expect(lb.x + lb.width).toBeLessThanOrEqual(pb.x);
  // elegir otra capa en la lista: el panel sigue con lo seleccionado
  await layers.locator('#layers li.layer .layer-main').first().click();
  await expect(panel).toBeVisible();
  // ✕ deselecciona y el panel se va
  await page.locator('#selectionClose').click();
  await expect(panel).toBeHidden();
});

test('con una imagen seleccionada se cambia el papel sin deseleccionar', async ({ page }) => {
  await openApp(page);
  await addImage(page);
  await page.locator('#panelOpeners [data-open="sheets"]').click();
  await page.locator('[data-paper="A3"]').click();
  await expect(page.locator('#layers li.layer.on')).toHaveCount(1);
  await expect(page.locator('#panel')).toBeVisible();
  await expect(page.locator('#selectionTitle')).toHaveText('Imagen');
});

test('la barra de herramientas es fija, abajo en el centro; encima, las opciones solo cuando hacen falta', async ({ page }) => {
  await openApp(page);
  const tools = page.locator('#toolbar'), bar = page.locator('#ctxbar'), shape = tools.locator('[data-tool=shape]');
  const tool = (t: string) => tools.locator(`[data-tool=${t}]`);
  // también con la bienvenida: abajo, centrada en la ventana y a 12 px del borde
  await expect(shape).toBeVisible();
  await expect(tools.locator('[data-tool=add]')).toHaveCount(0); // sin «＋»: agregar está en ⋮, Ctrl+O y la bienvenida
  const t0 = (await tools.boundingBox())!, vw = page.viewportSize()!;
  expect(Math.abs(t0.x + t0.width / 2 - vw.width / 2)).toBeLessThan(2);
  expect(Math.abs(t0.y + t0.height - (vw.height - 12))).toBeLessThan(2);
  // sin imagen: las herramientas de la imagen, apagadas, y sin barra de opciones
  await expect(tool('crop')).toBeDisabled();
  await expect(bar).toBeHidden();
  await addImage(page);
  await expect(tool('crop')).toBeEnabled();
  // una imagen sola no necesita barra de opciones: sus órdenes están en el panel de la selección
  await expect(bar).toBeHidden();
  // el menú de Forma se abre hacia arriba, sobre el lienzo
  await shape.click();
  const m = (await page.locator('#menu').boundingBox())!;
  expect(m.y + m.height).toBeLessThanOrEqual(t0.y);
  await page.keyboard.press('Escape');
  // girar y voltear no están en las barras: van junto a la rotación, en Selección
  await expect(bar.locator('[data-act=rotR]')).toHaveCount(0);
  await page.locator('#pRot90').click();
  await expect(page.locator('#pR')).toHaveValue('90');
  // mover la imagen no mueve la barra
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let i = 0; i < 5; i++) await page.keyboard.press('Shift+ArrowDown');
  expect(await tools.boundingBox()).toEqual(t0);
  // recortar: la herramienta se marca y sus opciones salen encima; la barra no se mueve
  await tool('crop').click();
  await expect(tool('crop')).toHaveAttribute('aria-pressed', 'true');
  await expect(bar.locator('[data-act=applyCrop]')).toBeVisible();
  expect(await tools.boundingBox()).toEqual(t0);
  const b0 = (await bar.boundingBox())!; // las opciones, encima de las herramientas
  expect(b0.y + b0.height).toBeLessThanOrEqual(t0.y);
  // pulsarla otra vez vuelve a Mover
  await tool('crop').click();
  await expect(tool('move')).toHaveAttribute('aria-pressed', 'true');
  // sin selección: sin opciones y con las herramientas de la imagen apagadas, en el mismo sitio
  await page.keyboard.press('Escape');
  await expect(bar).toBeHidden();
  await expect(tool('crop')).toBeDisabled();
  expect(await tools.boundingBox()).toEqual(t0);
  // Texto no crea nada hasta elegir dónde (cursor de texto, botón marcado, sin barra de opciones con su ✕);
  // pulsarlo otra vez lo termina
  await tool('text').click();
  await expect(tool('text')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#cv')).toHaveCSS('cursor', 'text');
  await expect(page.locator('.text-editor')).toHaveCount(0);
  await expect(bar).toBeHidden();
  await tool('text').click();
  await expect(tool('text')).toHaveAttribute('aria-pressed', 'false');
  // un clic lo pone ahí: el texto empieza en ese punto (alineado a la izquierda)
  await page.keyboard.press('t');
  await page.locator('#cv').click({ position: { x: 300, y: 200 } });
  const box = page.locator('.text-editor');
  await expect(box).toBeFocused();
  const r = (await box.boundingBox())!, cv = (await page.locator('#cv').boundingBox())!;
  expect(Math.abs(r.x - (cv.x + 300))).toBeLessThan(4);
  expect(Math.abs(r.y - (cv.y + 200))).toBeLessThan(4);
  await expect(tool('text')).toHaveAttribute('aria-pressed', 'false'); // ya colocado: el modo termina
});

test('con varias capas, el panel de la selección agrupa, duplica y elimina (la barra no)', async ({ page }) => {
  await openApp(page);
  await addImage(page, { name: 'a' });
  await addImage(page, { name: 'b', color: '#cc3333' });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Control+a');
  await expect(page.locator('#ctxbar')).toBeHidden(); // sus órdenes están en el panel
  const acts = page.locator('#selectionActions');
  await acts.getByRole('button', { name: 'Agrupar' }).click();
  await expect(acts.getByRole('button', { name: 'Desagrupar' })).toBeVisible();
  await acts.getByRole('button', { name: 'Duplicar' }).click();
  await expect(page.locator('#layers li.layer')).toHaveCount(4);
  await acts.getByRole('button', { name: 'Eliminar' }).click();
  await expect(page.locator('#layers li.layer')).toHaveCount(2);
});

test('con una imagen, eliminar está en el panel de la selección y no en la barra', async ({ page }) => {
  await openApp(page);
  await addImage(page, { name: 'a' });
  await expect(page.locator('#ctxbar')).toBeHidden();
  await expect(page.locator('#selGroup')).toBeHidden(); // agrupar, solo con varias
  await page.locator('#selDelete').click();
  await expect(page.locator('#layers li.layer')).toHaveCount(0);
});

test('en 960 px con el panel abierto, las barras de abajo y el zoom caben sin taparse ni esconder nada', async ({ page }) => {
  await page.setViewportSize({ width: 960, height: 760 });
  await openApp(page);
  // sin nada seleccionado: herramientas abajo en el centro y zoom abajo a la derecha, en la misma fila, sin tocarse
  const bar = page.locator('#ctxbar'), tools = page.locator('#tools'), toolbar = page.locator('#toolbar');
  const t0 = (await tools.boundingBox())!, tb = (await toolbar.boundingBox())!;
  expect(Math.abs(t0.x + t0.width - (960 - 12))).toBeLessThan(2);
  expect(Math.abs(t0.y + t0.height - (760 - 12))).toBeLessThan(2);
  expect(Math.abs(tb.y + tb.height - (760 - 12))).toBeLessThan(2);
  expect(tb.x + tb.width).toBeLessThan(t0.x);
  // con la imagen seleccionada se abre el panel: las opciones llegan hasta él sin esconder nada, encima de las
  // herramientas, y el zoom sigue en su esquina, bajo el panel
  await addImage(page);
  const panelX = (await page.locator('#panel').boundingBox())!.x;
  const fits = async (what: string) => {
    const r = await bar.evaluate((b) => ({ right: b.getBoundingClientRect().right, bottom: b.getBoundingClientRect().bottom, scroll: b.scrollWidth - b.clientWidth }));
    expect(r.right, what).toBeLessThanOrEqual(panelX);
    expect(r.bottom, what).toBeLessThanOrEqual(tb.y);
    expect(r.scroll, what).toBeLessThanOrEqual(0);
    const t = (await tools.boundingBox())!;
    expect(t.y, what).toBeGreaterThanOrEqual((await page.locator('#panel').boundingBox())!.y + (await page.locator('#panel').boundingBox())!.height); // el zoom, en su esquina, bajo el panel
  };
  await fits('imagen');
  for (const [key, what] of [['c', 'recorte'], ['b', 'borrador'], ['w', 'varita']] as const) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(key);
    await fits(what);
    await page.keyboard.press('Escape');
  }
});

test('tableta y móvil girados: panel a la derecha y lienzo con sitio', async ({ page }) => {
  const free = () => page.locator('#free').evaluate((f) => Math.round(f.getBoundingClientRect().height));
  // tableta apaisada: al seleccionar, panel lateral de 300 px (no la hoja inferior)
  await page.setViewportSize({ width: 800, height: 600 });
  await openApp(page);
  await addImage(page);
  const panel = (await page.locator('#panel').boundingBox())!;
  expect(Math.round(panel.width)).toBe(300);
  expect(panel.x + panel.width).toBeLessThanOrEqual(800);
  await expect(page.locator('#sheetHandle')).toBeHidden();
  expect(await free()).toBeGreaterThanOrEqual(400);
  // móvil girado (640 × 360): sin nada seleccionado no hay panel y el lienzo mide al menos 180 px de alto
  await page.setViewportSize({ width: 640, height: 360 });
  await page.reload();
  await expect(page.locator('#panel')).toBeHidden();
  await expect(page.locator('#panelOpeners')).toBeVisible();
  expect(await free()).toBeGreaterThanOrEqual(180);
  const bar = (await page.locator('#toolbar').boundingBox())!;
  expect(bar.x + bar.width).toBeLessThanOrEqual(640);
});

test('arrastrar un recuadro con «Agregar texto» crea un texto de ese ancho; un clic sobre un texto lo edita', async ({ page }) => {
  await openApp(page);
  await page.locator('[data-addtext]:visible').first().click();
  const cv = (await page.locator('#cv').boundingBox())!;
  await page.mouse.move(cv.x + 200, cv.y + 200); await page.mouse.down();
  await page.mouse.move(cv.x + 700, cv.y + 260, { steps: 6 }); await page.mouse.up();
  const box = page.locator('.text-editor');
  await expect(box).toBeFocused();
  await page.keyboard.type('Uno dos tres cuatro cinco seis siete');
  await page.keyboard.press('Escape');
  await expect(page.locator('#tWidth [data-w="fixed"]')).toHaveAttribute('aria-pressed', 'true');
  await expect.poll(async () => +(await page.locator('#pW').inputValue()).replace(',', '.')).toBeGreaterThan(15);
  // otra vez «Agregar texto» y clic sobre el texto: se edita ese, no se crea otro
  await page.keyboard.press('Escape');
  await page.keyboard.press('t');
  await page.locator('#cv').click({ position: { x: 230, y: 230 } });
  await expect(box).toHaveValue('Uno dos tres cuatro cinco seis siete');
});

test('la tarjeta es accesible en móvil y no desborda', async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openApp(page);
  await startText(page);
  await page.locator('.text-editor').fill('Texto');
  await page.locator('.text-editor').press('Escape');
  // plegada, la hoja deja ver las pestañas, con Selección elegida
  await expect(page.locator('#tab-sel')).toBeVisible();
  await expect(page.locator('#tab-sel')).toHaveAttribute('aria-selected', 'true');
  await page.locator('#sheetHandle').click();
  await expect(page.locator('#selectionCard')).toBeVisible();
  await page.locator('#tColorHex').scrollIntoViewIfNeeded();
  const bounds = (await page.locator('#selectionCard').boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(390);
  await page.screenshot({ path: info.outputPath('tarjeta-movil.png') });
});

test('U, O e Y agregan un rectángulo, una elipse y un triángulo; «Opciones del póster» (⋮) va al final de las herramientas', async ({ page }) => {
  await openApp(page);
  const rows = page.locator('#layers li.layer');
  for (const [key, n] of [['u', 1], ['o', 2], ['y', 3]] as const) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press(key);
    await expect(rows).toHaveCount(n);
  }
  await expect(page.locator('#layers')).toContainText('Rectángulo');
  await expect(page.locator('#layers')).toContainText('Elipse');
  await expect(page.locator('#layers')).toContainText('Triángulo');
  // ⋮ es lo último de la barra de herramientas y la de opciones ya no tiene «Más»
  const more = page.locator('#toolbar [data-tool]').last();
  await expect(more).toHaveAttribute('data-tool', 'more');
  await expect(page.locator('#ctxbar').getByRole('button', { name: /Más opciones/ })).toHaveCount(0);
  // son las opciones del póster, aunque haya algo seleccionado (no las de la forma)
  await more.click();
  const menu = page.locator('#menu');
  await expect(menu.getByRole('menuitem', { name: /Nuevo póster/ })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: /Duplicar/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.locator('#selectionTitle')).toHaveText('Forma'); // la selección sigue igual
  // y sin nada seleccionado, las mismas
  await page.keyboard.press('Escape');
  await more.click();
  await expect(menu.getByRole('menuitem', { name: /Nuevo póster/ })).toBeVisible();
});

test(', y . (o [ y ]) cambian el pincel del borrador y la tolerancia de la varita', async ({ page }) => {
  await openApp(page);
  await addImage(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  // varita: de 5 en 5, dentro de sus límites
  await page.keyboard.press('w');
  const tol = page.locator('#bTol'), brush = page.locator('#bBrush');
  const t0 = +(await tol.inputValue());
  await page.keyboard.press('.');
  await expect(tol).toHaveValue(String(t0 + 5));
  await page.keyboard.press(',');
  await page.keyboard.press(',');
  await expect(tol).toHaveValue(String(t0 - 5));
  await expect(page.locator('#bTolOut')).toHaveText(String(t0 - 5));
  await page.keyboard.press('Escape');
  // borrador: el pincel crece y se encoge
  await page.keyboard.press('b');
  const b0 = +(await brush.inputValue());
  await page.keyboard.press('.');
  await expect.poll(async () => +(await brush.inputValue())).toBeGreaterThan(b0);
  await page.keyboard.press(',');
  await page.keyboard.press(',');
  await expect.poll(async () => +(await brush.inputValue())).toBeLessThan(b0);
});

test('Alt + clic derecho y arrastrar cambia el pincel y la tolerancia, como en Photoshop, sin abrir el menú', async ({ page }) => {
  await openApp(page);
  await addImage(page);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  const cv = (await page.locator('#cv').boundingBox())!, at = { x: cv.x + cv.width / 2 - 100, y: cv.y + cv.height / 2 };
  const altDrag = async (dx: number) => {
    await page.mouse.move(at.x, at.y);
    await page.keyboard.down('Alt');
    await page.mouse.down({ button: 'right' });
    await page.mouse.move(at.x + dx, at.y + 5, { steps: 6 });
    await page.mouse.up({ button: 'right' });
    await page.keyboard.up('Alt');
  };
  // borrador: el pincel crece lo que se arrastra (su borde sigue al ratón)
  await page.keyboard.press('b');
  const brush = page.locator('#bBrush'), b0 = +(await brush.inputValue());
  await altDrag(30);
  await expect(brush).toHaveValue(String(b0 + 30));
  await expect(page.locator('#menu')).toBeHidden();
  await altDrag(-20);
  await expect(brush).toHaveValue(String(b0 + 30 - 20));
  await page.keyboard.press('Escape');
  // varita: la tolerancia, a la mitad de lo que se arrastra
  await page.keyboard.press('w');
  const tol = page.locator('#bTol'), t0 = +(await tol.inputValue());
  await altDrag(40);
  await expect(tol).toHaveValue(String(t0 + 20));
  await expect(page.locator('#menu')).toBeHidden();
});

test('el panel de la selección sube, baja, lleva al frente o al fondo, oculta y bloquea la capa', async ({ page }) => {
  await openApp(page);
  await addImage(page, { name: 'a' });
  await addImage(page, { name: 'b', color: '#cc3333' }); // b, al frente y seleccionada
  const up = page.locator('#selUp'), down = page.locator('#selDown'), lock = page.locator('#selLock');
  await expect(up).toBeDisabled(); // ya está al frente
  await down.click();
  await expect.poll(() => page.locator('#layers li.layer .layer-main span').evaluateAll((s) => s.map((x) => x.firstChild?.textContent))).toEqual(['a', 'b']);
  await expect(down).toBeDisabled();
  await expect(up).toBeEnabled();
  await up.click();
  await expect(up).toBeDisabled();
  // al fondo y al frente del todo, de un salto
  const names = () => page.locator('#layers li.layer .layer-main span').evaluateAll((s) => s.map((x) => x.firstChild?.textContent));
  const front = page.locator('#selFront'), back = page.locator('#selBack');
  await expect(front).toBeDisabled();
  await back.click();
  await expect.poll(names).toEqual(['a', 'b']);
  await expect(back).toBeDisabled();
  await front.click();
  await expect.poll(names).toEqual(['b', 'a']);
  // bloquear: sigue seleccionada, con el candado cerrado; otra vez la desbloquea
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#lockNote')).toBeVisible();
  await lock.click();
  await expect(lock).toHaveAttribute('aria-pressed', 'false');
  // ocultar: deja de verse y se deselecciona
  await page.locator('#selHide').click();
  await expect(page.locator('#selectionHead')).toBeHidden();
  await expect(page.locator('#layers li.layer').first().locator('.act[aria-label="Mostrar"]')).toHaveCount(1);
});
