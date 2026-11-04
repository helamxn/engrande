import { defineConfig } from 'vitest/config';

// Tests de la lógica pura (geometría e historial): no necesitan navegador ni Astro.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
