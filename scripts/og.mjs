/**
 * Genera la imagen para compartir (public/og.png, 1200 × 630) y el icono de iOS (public/apple-touch-icon.png) a
 * partir de scripts/og/og.html, con el Edge instalado (PW_CHANNEL=chrome para Chrome). Las imágenes se versionan:
 * el build de Vercel no necesita un navegador. Ejecutar de nuevo solo al cambiar la plantilla.
 */
import { chromium } from '@playwright/test';
import { statSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  await page.goto(pathToFileURL(resolve('scripts/og/og.html')).href);
  await page.waitForSelector('body[data-ready]');
  for (const [sel, file] of [['#og', 'public/og.png'], ['#icon', 'public/apple-touch-icon.png']]) {
    await page.locator(sel).screenshot({ path: file });
    console.log(`${file} · ${Math.round(statSync(file).size / 1024)} KB`);
  }
} finally {
  await browser.close();
}
