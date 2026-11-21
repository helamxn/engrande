# engrande

Convierte una imagen o un PDF en un póster grande impreso en varias hojas (A4, A3 o Carta), con marcas de corte, franjas de solape para pegar y una página de guía de armado.

Todo ocurre en el navegador: no hay servidor, cuentas ni base de datos, y las imágenes nunca salen del equipo del usuario. El póster se guarda automáticamente en el propio navegador (IndexedDB) y se restaura al volver; el botón «Nuevo» lo borra.

## Qué se puede hacer

- Póster por medidas (ancho × alto en cm, tamaños habituales o «Como la imagen») o por número de hojas A4, A3 o Carta, con margen de impresora y solape ajustables. Sugiere la orientación que usa menos hojas y avisa cuando la última columna o fila apenas se aprovecha.
- Varias imágenes o páginas de PDF que se colocan, recortan, agrupan y retocan (quitar el fondo, borrador, varita).
- Tamaño real (escala 1:1) para PDF y SVG con medidas: moldes de costura, planos y plantillas. Al cargarlos se ofrece imprimirlos a su medida, con el póster y las hojas calculados solos.
- Ajustes de color por imagen: brillo, contraste, saturación y blanco y negro (para ahorrar tinta), sin tocar el archivo original; se ven igual en pantalla y en el PDF.
- Textos para títulos en grande o moldes: se escriben sobre el lienzo, con 20 familias y 55 variantes de Google Fonts, o una fuente del equipo del usuario, que no se guarda. Incluye búsqueda, vista previa y selección de estilo.
- Contorno del texto (grosor en mm y color) y letras huecas, solo con el contorno, para plantillas de recorte o esténcil. El contorno va por dentro de la letra: la letra mide lo mismo y su borde es la línea de corte.
- Tamaño de letra en puntos, altura de referencia en cm, color hexadecimal editable y botón para restablecerlo.
- Ayudas de precisión: imán, rejilla de 1 mm y medidas.
- Descarga en PDF por hojas, con marcas de corte y guía de armado, o en una sola hoja grande para imprenta. Las hojas que no llevan nada no se imprimen (se puede desactivar).
- Guardar el proyecto en un archivo `.engrande` (Ctrl+S) y abrirlo en otro equipo o navegador (Ctrl+O, el botón o arrastrándolo).
- Funciona con ratón, teclado, pantalla táctil y móvil. La tecla `?` muestra todos los atajos y gestos.

## Stack

- **Astro 7** (sitio estático) + **TypeScript** estricto
- **Tailwind CSS 4**, con los tokens del tema en `src/styles/global.css`
- **pdf.js** para leer PDF, **jsPDF** para exportar y **opentype.js** para convertir el texto en contornos, cargados solo cuando se usan
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
| `pnpm og`       | Regenera la imagen para compartir y los iconos de marca (`public/`) |

La CSP solo se aplica en el build: pruébala con `pnpm build && pnpm preview`, no con `pnpm dev`.

## Pruebas

- **Unitarias** (`src/editor/*.test.ts`): la lógica pura, como la geometría, los grupos, el historial y los píxeles.
- **De punta a punta** (`e2e/`): la app compilada, en el Edge instalado en el equipo (`PW_CHANNEL=chrome` para Chrome, o `PW_EXECUTABLE=/ruta/a/chromium` para un navegador ya instalado, como en CI o un contenedor). Cubren el guardado, los gestos del lienzo, la edición, las medidas y las hojas en blanco, el PDF de entrada, la pantalla táctil y el móvil.

## Estructura

```text
src/
  pages/, layouts/, components/   página, marcado del editor y su panel
  styles/global.css               tema claro/oscuro y componentes
  editor/
    main.ts                       arranque: conecta módulos y eventos
    state.ts                      estado compartido
    geometry.ts                   geometría pura del póster, sus hojas y las imágenes
    blank.ts, sheets.ts           hojas en blanco: lógica pura y qué se imprime
    input/                        ratón, táctil y teclado
    io/                           carga de archivos, PDF, guardado y exportación
    text/                         textos: fuentes, contornos, escritura sobre el lienzo y su panel
    ui/                           barra contextual, menú y panel
    workers/                      procesamiento de píxeles fuera del hilo principal
e2e/                              tests de punta a punta
scripts/                          copia los recursos de pdf.js a public/ (no se versionan)
vercel.json                       cabeceras de seguridad y caché
```

## Cómo funciona

- **Guardado:** el póster se guarda solo en IndexedDB, con los archivos originales. Mientras escribes también se guarda un borrador de las palabras, incluso antes de crear la primera capa. Al volver se reabre la edición; confirmarla es un único paso de deshacer. El historial de deshacer no se guarda.
- **Calidad:** las imágenes grandes se editan en una copia más ligera. Al descargar se vuelve al archivo original.
- **Precisión:** las posiciones caen en mm enteros. El imán a otras imágenes y al póster tiene prioridad sobre la rejilla, y Ctrl/⌘ desactiva los dos.
- **Texto:** se convierte en contornos con la fuente. El póster guarda esos contornos y no la fuente, así que se puede imprimir sin ella; para cambiar las palabras de un texto con una fuente propia hay que volver a cargarla. La entrada admite 10.000 caracteres; se siguen recuperando los textos más largos de versiones anteriores.
- **Tipografías:** el catálogo inicial de Google Fonts está en `src/editor/text/catalog.ts`, con archivos WOFF de Fontsource servidos desde el mismo dominio. Cada variante se descarga al elegirla, sin llamadas del navegador a Google. Sus licencias están en `public/fonts/licenses/`. Añadir otro proveedor no requiere cambiar el formato de los textos guardados.
- **Medidas del texto:** el tamaño en puntos mide el cuerpo tipográfico (1 pt = 25,4/72 mm). La altura de una H es una referencia aproximada de impresión; el marco puede incluir el espacio del renglón. Cambiar de familia conserva los puntos.
- **Color del texto:** acepta códigos hexadecimales de tres o seis dígitos, con o sin `#`. Al arrastrar el selector se reutiliza una vista previa a resolución de pantalla; al confirmar se regenera el texto y se guarda un solo paso de deshacer. El color predeterminado es `#111111`.
- **Tamaño:** sin medida, el póster mide lo que cubren sus columnas y filas. Con medida (`size` en los ajustes), cambiar el papel, el margen o el solape la conserva y recalcula las hojas (`geo()` y `tiles()` en `geometry.ts`); la última columna y fila pueden ir a medias, y lo que sobra se recorta por sus marcas de corte. Hasta 12 × 12 hojas.
- **Hojas en blanco** (`blank.ts` y `sheets.ts`): primero por geometría (ninguna imagen visible toca la hoja), al instante; después por píxeles (lo que la toca es todo blanco o transparente), a baja resolución con el póster quieto. Al exportar se confirma a la resolución del PDF y, ante la duda, la hoja se imprime. Un píxel cuenta como blanco con sus tres canales ≥ 248.
- **Hojas:** se numeran 1, 2, 3… en el mismo orden que las páginas del PDF; las que no se imprimen no cuentan, y el mapa de la guía las muestra rayadas. El nombre de cada hoja y la regla van en franjas de solape que tapará una vecina impresa.
- **Archivo de proyecto** (`io/projectfile.ts`): «ENGRANDE», versión, longitud de la cabecera, cabecera JSON (el mismo proyecto que se guarda en IndexedDB y la lista de archivos) y los archivos tal cual, sin base64 ni ZIP. Al abrirlo se comprueban tamaños, claves y tipos, y cada valor del proyecto se valida como lo guardado en el navegador; abrirlo sustituye al póster y se puede deshacer.
- **Lo guardado se valida al leerlo:** una distribución, una resolución o una opción fuera de lo que admite el panel vuelve a su valor de siempre (`readLayout` en `state.ts`).
- **Tamaño real** (`realsize.ts`): de un PDF, la página en puntos (1/72 de pulgada) con su giro y su UserUnit; de un SVG, el ancho y el alto de la etiqueta raíz solo en mm, cm, in, pt o pc (en px o sin unidad no se adivina: Illustrator cuenta 72 por pulgada y el navegador 96). Las fotos no tienen tamaño real: sus ppp casi nunca son de fiar. Si la imagen es la única, el póster toma su medida (redondeada hacia arriba al mm) y la imagen va a su esquina, en un solo paso de deshacer.
- **Ajustes de color** (`adjustData` en `pixels.ts`): la fórmula de brightness(), contrast() y saturate() de CSS, aplicada a los píxeles (no con `ctx.filter`, que no está en todos los navegadores), sobre la versión que se dibuja: copia de pantalla, lienzo de trabajo o alta resolución al exportar. Las versiones ajustadas se guardan en caché por lienzo y revisión.
- **Color:** todo se trabaja en sRGB. Los PDF en CMYK se convierten con perfil, y el PDF descargado va en RGB sin perfil ICC.

## Seguridad

- **Astro ≥ 7.4.7**: corrige GHSA-r3h5-4585-7x3w (no afecta a un sitio estático, pero `pnpm audit` queda limpio). Ojo: con Astro 7.4.13 las dependencias se resuelven con dos versiones incompatibles de `@emnapi/runtime` y `astro check` falla.
- **pdf.js ≥ 4.2.67**: corrige CVE-2024-4367, la ejecución de código mediante un PDF malicioso. **jsPDF ≥ 3.0.2**: corrige CVE-2025-29907 y CVE-2025-57810.
- **Sin CDN:** todas las dependencias, fuentes y recursos de pdf.js se sirven desde el propio dominio.
- **Content-Security-Policy por `<meta>`**, generada por Astro con hashes (`security.csp` en `astro.config.mjs`): solo se permiten scripts y estilos propios, sin `object`, `base` ni formularios.
- **Cabeceras HTTP en Vercel** (`vercel.json`): `frame-ancestors 'none'`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, HSTS y COOP.
- **Límites de entrada:** archivos de hasta 150 MB e imágenes de hasta 200 MP (menos en equipos con poca memoria). pdf.js limita las imágenes internas de cada PDF.
- **Sin inyección de HTML:** los datos del usuario, como los nombres de archivo, se insertan siempre con `textContent`. Los SVG se cargan como `<img>`, así que su JavaScript no se ejecuta.

## Despliegue en Vercel

La dirección pública (`site` en `astro.config.mjs`) da la URL canónica, la imagen para compartir, `robots.txt` y el sitemap; al pasar a un dominio propio se cambia ahí.

Importa el repositorio en Vercel. `vercel.json` ya fija el framework, `pnpm install --frozen-lockfile`, `pnpm build` y la carpeta `dist`. Despliégalo en un dominio o subdominio propio, sin compartir origen con aplicaciones que tengan sesión.
