# Pliego

Convierte una imagen o un PDF en un póster grande impreso en varias hojas (A4, A3 o Carta), con marcas de corte, franjas de solape para pegar y una página de guía de armado.

Todo ocurre en el navegador: no hay servidor, cuentas ni base de datos, y las imágenes nunca salen del equipo del usuario. El póster se guarda automáticamente en el propio navegador (IndexedDB) y se restaura al volver; el botón «Nuevo» lo borra.

## Stack

- **Astro 7** (sitio estático) + **TypeScript** estricto
- **Tailwind CSS 4**: tokens del tema en `src/styles/global.css` (`@theme`) y unas pocas clases de componente para lo que el editor genera desde TypeScript
- **pdf.js 6** para leer PDF y **jsPDF 4** para exportar. Las dos librerías se cargan solo cuando se usan.
- Fuentes Archivo e IBM Plex Mono servidas desde el propio dominio (Fontsource)
- Iconos de **Lucide** (`lucide-static`), importados uno a uno en `src/editor/ui/icons.ts`
- **Vitest** para la lógica pura y **Playwright** para probar la app entera en el navegador (`e2e/`): guardado, «Nuevo», gestos del lienzo, rejilla, copiar/pegar, recorte y descarga

## Comandos

| Comando        | Qué hace                                                                    |
| :------------- | :-------------------------------------------------------------------------- |
| `pnpm install` | Instala dependencias                                                        |
| `pnpm dev`     | Servidor de desarrollo en `localhost:4321`                                  |
| `pnpm build`   | Copia los recursos de pdf.js, comprueba los tipos y genera `dist/`          |
| `pnpm preview` | Sirve `dist/` para probar el build (con la CSP activa)                      |
| `pnpm test`    | Tests de la lógica pura: geometría, grupos, historial, formato              |
| `pnpm test:e2e` | Build y tests de punta a punta con Playwright en Edge (`PW_CHANNEL=chrome` para Chrome) |
| `pnpm check`   | Comprobación de tipos de Astro y TypeScript                                 |

La CSP solo se aplica en el build: pruébala con `pnpm build && pnpm preview`, no con `pnpm dev`.

## Estructura

```text
src/
  pages/index.astro          monta el editor
  layouts/Layout.astro       <html lang="es">, metadatos
  components/                Header, Workspace (lienzo), Panel (Hojas / Imágenes / Exportar)
  styles/global.css          Tailwind, tema claro/oscuro y componentes
  editor/
    main.ts                  arranque: conecta módulos y eventos
    state.ts, types.ts       estado compartido y tipos
    geometry.ts              geometría pura (mm ↔ imagen, recorte, escala, resolución) + tests
    history.ts               deshacer/rehacer con límite de memoria + tests
    actions.ts               selección, capas, modos, recorte, borrador y varita
    render.ts, view.ts       dibujo del lienzo, zoom y encuadre
    input/                   puntero y gestos, teclado
    io/                      carga de archivos, pdf.js, exportación con jsPDF
    ui/                      barra contextual, menú, panel, iconos
scripts/copy-pdfjs.mjs       copia cmaps, fuentes y WASM de pdf.js a public/pdfjs (no se versiona)
vercel.json                  cabeceras de seguridad y caché
```

## Seguridad

- **pdf.js ≥ 4.2.67**: corrige CVE-2024-4367, la ejecución de código mediante un PDF malicioso. **jsPDF ≥ 3.0.2**: corrige CVE-2025-29907 y CVE-2025-57810.
- **Sin CDN:** todas las dependencias, fuentes y recursos de pdf.js se sirven desde el propio dominio.
- **Content-Security-Policy por `<meta>`**, generada por Astro con hashes (`security.csp` en `astro.config.mjs`): solo se permiten scripts y estilos propios, sin `object`, `base` ni formularios.
- **Cabeceras HTTP en Vercel** (`vercel.json`): `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS y COOP.
- **Límites de entrada:** archivos de hasta 150 MB e imágenes de hasta 200 MP. pdf.js limita las imágenes internas de cada PDF.
- **Sin inyección de HTML:** los datos del usuario, como los nombres de archivo, se insertan siempre con `textContent`. Los SVG se cargan como `<img>`, así que su JavaScript no se ejecuta.

## Despliegue en Vercel

Importa el repositorio en Vercel. `vercel.json` ya fija el framework, `pnpm install --frozen-lockfile`, `pnpm build` y la carpeta `dist`. Despliégalo en un dominio o subdominio propio, sin compartir origen con aplicaciones que tengan sesión.
