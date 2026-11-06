import { defineConfig } from '@playwright/test';

/**
 * Tests de punta a punta: la app real (el build de producción, con su CSP) en un navegador de verdad, con su
 * IndexedDB, portapapeles y descargas. Cada test abre un perfil limpio, así que no toca lo guardado en tu navegador.
 *
 * Usa el navegador instalado en el equipo (Edge por defecto; PW_CHANNEL=chrome para Chrome): no descarga ninguno.
 * Se ejecuta con `pnpm test:e2e`, que primero genera el build.
 */
const PORT = 4330;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: [['list']],
  timeout: 30_000,
  expect: { timeout: 6_000 }, // el guardado espera 1,2 s después del último cambio
  use: {
    baseURL: `http://localhost:${PORT}`,
    channel: process.env.PW_CHANNEL ?? 'msedge',
    viewport: { width: 1400, height: 860 },
    locale: 'es-ES',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `node node_modules/astro/bin/astro.mjs preview --port ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
