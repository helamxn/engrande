// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';

// https://astro.build/config
export default defineConfig({
  // dirección pública: la usan la URL canónica, la imagen para compartir, robots.txt y el sitemap.
  // Con dominio propio, basta con cambiarla aquí
  site: 'https://pliego-omega.vercel.app',

  // sitio 100 % estático: todo ocurre en el navegador, no hay servidor
  output: 'static',

  // no hay contenido markdown; Shiki usa estilos en línea incompatibles con la CSP
  markdown: { syntaxHighlight: false },

  security: {
    /*
     * Content-Security-Policy por <meta>: Astro calcula los hashes de sus scripts y estilos en línea.
     * Solo se aplica en `astro build` (no en `astro dev`).
     * Las directivas que no admite <meta> (frame-ancestors…) van como cabecera HTTP en vercel.json.
     */
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        // blob: y data: para las imágenes que el usuario carga (URL.createObjectURL) y las miniaturas
        "img-src 'self' blob: data:",
        "font-src 'self'",
        // worker de pdf.js, servido desde el propio dominio
        "worker-src 'self'",
        "connect-src 'self' blob: data:",
        "object-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
      ],
      scriptDirective: { resources: ["'self'"] },
      styleDirective: { resources: ["'self'"] },
    },
  },

  vite: {
    plugins: [tailwindcss()],
  },
});
