# Pliego

Convierte una imagen o un PDF en un póster grande impreso en varias hojas (A4, A3 o Carta), con marcas de corte, franjas de solape para pegar y una página de guía de armado.

Todo ocurre en el navegador: no hay servidor, cuentas ni base de datos, y las imágenes nunca salen del equipo del usuario. El póster se guarda automáticamente en el propio navegador (IndexedDB) y se restaura al volver; el botón «Nuevo» lo borra.

## Qué se puede hacer

- Póster de varias hojas A4, A3 o Carta, con margen de impresora y solape ajustables.
- Varias imágenes o páginas de PDF que se colocan, recortan, agrupan y retocan (quitar el fondo, borrador, varita).
- Ayudas de precisión: imán, rejilla de 1 mm y medidas.
- Descarga en PDF por hojas, con marcas de corte y guía de armado, o en una sola hoja grande para imprenta.
- Funciona con ratón, teclado, pantalla táctil y móvil. La tecla `?` muestra todos los atajos y gestos.

## Stack

- **Astro 7** (sitio estático) + **TypeScript** estricto
- **Tailwind CSS 4**, con los tokens del tema en `src/styles/global.css`
- **pdf.js** para leer PDF y **jsPDF** para exportar, cargados solo cuando se usan
- Fuentes de Fontsource e iconos de Lucide, servidos desde el propio dominio
- **Vitest** para la lógica pura y **Playwright** para probar la app entera en el navegador

## Comandos

| Comando         | Qué hace                                                        |
| :-------------- | :-------------------------------------------------------------- |
| `pnpm install`  | Instala dependencias                                            |
| `pnpm dev`      | Servidor de desarrollo                                          |
| `pnpm build`    | Comprueba los tipos y genera `dist/`                            |
| `pnpm preview`  | Sirve `dist/` para probar el build (con la CSP activa)          |
| `pnpm test`     | Tests unitarios                                                 |
| `pnpm test:e2e` | Build y tests de punta a punta                                  |
| `pnpm check`    | Comprobación de tipos                                           |
| `pnpm og`       | Regenera la imagen para compartir y el icono de iOS (`public/`) |

La CSP solo se aplica en el build: pruébala con `pnpm build && pnpm preview`, no con `pnpm dev`.

## Pruebas

- **Unitarias** (`src/editor/*.test.ts`): la lógica pura, como la geometría, los grupos, el historial y los píxeles.
- **De punta a punta** (`e2e/`): la app compilada, en el Edge instalado en el equipo (`PW_CHANNEL=chrome` para Chrome). Cubren el guardado, los gestos del lienzo, la edición, el PDF de entrada, la pantalla táctil y el móvil.

## Estructura

```text
src/
  pages/, layouts/, components/   página, marcado del editor y su panel
  styles/global.css               tema claro/oscuro y componentes
  editor/
    main.ts                       arranque: conecta módulos y eventos
    state.ts                      estado compartido
    geometry.ts                   geometría pura del póster y las imágenes
    input/                        ratón, táctil y teclado
    io/                           carga de archivos, PDF, guardado y exportación
    ui/                           barra contextual, menú y panel
    workers/                      procesamiento de píxeles fuera del hilo principal
e2e/                              tests de punta a punta
scripts/                          copia los recursos de pdf.js a public/ (no se versionan)
vercel.json                       cabeceras de seguridad y caché
```

## Cómo funciona

- **Guardado:** el póster se guarda solo en IndexedDB, con los archivos originales. El historial de deshacer no se guarda.
- **Calidad:** las imágenes grandes se editan en una copia más ligera. Al descargar se vuelve al archivo original.
- **Precisión:** las posiciones caen en mm enteros. El imán a otras imágenes y al póster tiene prioridad sobre la rejilla, y Ctrl/⌘ desactiva los dos.
- **Hojas:** se numeran 1, 2, 3… en el mismo orden que las páginas del PDF.
- **Color:** todo se trabaja en sRGB. Los PDF en CMYK se convierten con perfil, y el PDF descargado va en RGB sin perfil ICC.

## Seguridad

- **pdf.js ≥ 4.2.67**: corrige CVE-2024-4367, la ejecución de código mediante un PDF malicioso. **jsPDF ≥ 3.0.2**: corrige CVE-2025-29907 y CVE-2025-57810.
- **Sin CDN:** todas las dependencias, fuentes y recursos de pdf.js se sirven desde el propio dominio.
- **Content-Security-Policy por `<meta>`**, generada por Astro con hashes (`security.csp` en `astro.config.mjs`): solo se permiten scripts y estilos propios, sin `object`, `base` ni formularios.
- **Cabeceras HTTP en Vercel** (`vercel.json`): `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS y COOP.
- **Límites de entrada:** archivos de hasta 150 MB e imágenes de hasta 200 MP (menos en equipos con poca memoria). pdf.js limita las imágenes internas de cada PDF.
- **Sin inyección de HTML:** los datos del usuario, como los nombres de archivo, se insertan siempre con `textContent`. Los SVG se cargan como `<img>`, así que su JavaScript no se ejecuta.

## Despliegue en Vercel

La dirección pública (`site` en `astro.config.mjs`) da la URL canónica, la imagen para compartir, `robots.txt` y el sitemap; al pasar a un dominio propio se cambia ahí.

Importa el repositorio en Vercel. `vercel.json` ya fija el framework, `pnpm install --frozen-lockfile`, `pnpm build` y la carpeta `dist`. Despliégalo en un dominio o subdominio propio, sin compartir origen con aplicaciones que tengan sesión.
