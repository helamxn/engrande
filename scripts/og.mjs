/** Publica Desborde 3D y genera los iconos desde el símbolo, sin redibujar la campaña aprobada. */
import { chromium } from '@playwright/test';
import { readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const publicFile = (name) => fileURLToPath(new URL(`../public/${name}`, import.meta.url));
const source = fileURLToPath(new URL('./og/desborde-3d.png', import.meta.url));
const image = await readFile(source);
if (image.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
  || image.readUInt32BE(16) !== 1200 || image.readUInt32BE(20) !== 630) {
  throw new Error('El OG aprobado debe ser un PNG de 1200 × 630.');
}
const symbol = await readFile(publicFile('brand-symbol.svg'), 'utf8');
const artwork = symbol.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
const favicon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><title>engrande</title><rect width="64" height="64" rx="14" fill="#161d23"/>${artwork}</svg>\n`;

const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'msedge' });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const icoImages = [];
  const outputs = new Map([[96, 'favicon-96.png'], [180, 'apple-touch-icon.png'], [192, 'icon-192.png'], [512, 'icon-512.png']]);
  for (const size of [16, 32, 48, ...outputs.keys()]) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<style>html,body{margin:0;width:100%;height:100%}svg{display:block;width:100%;height:100%}</style>${favicon}`);
    const png = await page.screenshot({ omitBackground: true });
    if (size <= 48) icoImages.push({ size, png });
    if (outputs.has(size)) await writeFile(publicFile(outputs.get(size)), png);
  }
  // ICO con las tres resoluciones nativas: no se reduce una imagen grande a 16 px en el navegador del usuario.
  const directory = Buffer.alloc(6 + icoImages.length * 16);
  directory.writeUInt16LE(1, 2); directory.writeUInt16LE(icoImages.length, 4);
  let offset = directory.length;
  icoImages.forEach(({ size, png }, i) => {
    const at = 6 + i * 16;
    directory[at] = size; directory[at + 1] = size;
    directory.writeUInt16LE(1, at + 4); directory.writeUInt16LE(32, at + 6);
    directory.writeUInt32LE(png.length, at + 8); directory.writeUInt32LE(offset, at + 12);
    offset += png.length;
  });
  await writeFile(publicFile('favicon.ico'), Buffer.concat([directory, ...icoImages.map(({ png }) => png)]));
  await writeFile(publicFile('favicon.svg'), favicon);
  await copyFile(source, publicFile('og.png'));
  for (const name of ['og.png', 'favicon.svg', 'favicon.ico', ...outputs.values()]) {
    console.log(`public/${name} · ${Math.round((await stat(publicFile(name))).size / 1024)} KB`);
  }
} finally {
  await browser.close();
}
