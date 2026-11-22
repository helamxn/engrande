# engrande

Convierte una imagen o un PDF en un póster grande impreso en varias hojas (A4, A3 o Carta), con marcas de corte, franjas de solape para pegar y una página de guía de armado.

Todo ocurre en el navegador: no hay servidor, cuentas ni base de datos, y las imágenes nunca salen del equipo del usuario. El póster se guarda automáticamente en el propio navegador (IndexedDB) y se restaura al volver; el botón «Nuevo» lo borra.

## Qué se puede hacer

- Póster de varias hojas A4, A3 o Carta, con margen de impresora y solape ajustables.
- Varias imágenes o páginas de PDF que se colocan, recortan, agrupan y retocan (quitar el fondo, borrador, varita).
- Textos para títulos en grande o moldes: se escriben sobre el lienzo, con 20 familias y 55 variantes de Google Fonts, o una fuente del equipo del usuario, que no se guarda. Incluye búsqueda, vista previa y selección de estilo.
- Tamaño de letra en puntos, altura de referencia en cm, color hexadecimal editable y botón para restablecerlo.
- Arrastra desde una regla para crear una guía horizontal o vertical. Arrastra la línea para moverla o devuélvela a su regla para quitarla. En **Póster → Reglas y guías** puedes cambiar su visibilidad y el ajuste magnético. Las guías se guardan con el proyecto, también en un póster vacío. El PDF contiene solo el diseño y las marcas de impresión elegidas.
- Rectángulos, elipses y triángulos desde **Agregar → Agregar forma**, con relleno editable en Selección. Al cambiar el color se conservan las zonas borradas.
- **Mayús + 2** encuadra la selección en el espacio libre del inspector. **Ctrl/⌘ + 0** o **Mayús + 1** vuelve al póster completo y **Mayús + 0** pone el 100 % (tamaño real aproximado).
- Atajos de Figma para componer: **Alt + A / H / D** alinea a la izquierda, al centro o a la derecha y **Alt + W / V / S** arriba, al centro o abajo (una sola cosa, con el póster). **Ctrl/⌘ + Mayús + H** oculta y **Ctrl/⌘ + Mayús + L** bloquea.
- **Ctrl/⌘ + arrastrar un tirador** recorta ese lado sin entrar en Recortar (como en Figma). Con Alt recorta desde el centro y con Mayús en una esquina conserva la proporción.
- **Alt + arrastrar** mueve una copia; con **Mayús**, en línea recta, pulsadas en cualquier orden (también si Alt llega después del clic, antes de mover).
- El tamaño del póster y sus hojas se ven abajo a la izquierda, delante de la línea de estado. Al pulsarlo se abre Póster.
- Pegar coloca lo copiado desplazado; si eso queda fuera de la vista, lo centra en lo que se ve. **Ctrl/⌘ + Mayús + V** pega en el mismo sitio.
- En la lista de capas, **Mayús + clic** elige un tramo y **Ctrl/⌘ + clic** suma o quita una capa.
- Los campos de medidas aceptan operaciones y la unidad al final (`21/2`, `14,3+2`, `(10+5)*2`, `30°`). Arrastrar el nombre de un campo en horizontal cambia su valor (Mayús: 10 veces más) en un solo paso de deshacer.
- Con varias seleccionadas, el panel muestra el ancho, el alto, la posición y el giro del conjunto, con su proporción. Los lados del marco estiran el conjunto en un eje (Alt: desde el centro; Mayús: sin deformar), salvo si hay textos o imágenes giradas en ángulo, que no se pueden estirar sin sesgarse.
- Con el borrador, **[** y **]** cambian el tamaño del pincel. Girar una o varias capas se pega a 0°, 90°, 180° y 270° (Mayús: de 15° en 15°).
- Al alinear varios elementos, cada grupo conserva su composición interna. Un grupo seleccionado por sí solo se alinea con el área imprimible. La distribución requiere tres elementos del mismo nivel.
- Descarga en PDF por hojas, con marcas de corte y guía de armado, o en una sola hoja grande para imprenta.
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
- **Precisión:** al pasar el ratón se resalta lo que seleccionaría el clic: las zonas transparentes de una imagen dejan ver la de debajo. Las posiciones caen en mm enteros. El imán a otras imágenes y al póster tiene prioridad sobre la rejilla, y Ctrl/⌘ desactiva los dos.
- **Texto:** se convierte en contornos con la fuente. El póster guarda esos contornos y no la fuente, así que se puede imprimir sin ella; para cambiar las palabras de un texto con una fuente propia hay que volver a cargarla. La entrada admite 10.000 caracteres; se siguen recuperando los textos más largos de versiones anteriores.
- **Tipografías:** el catálogo inicial de Google Fonts está en `src/editor/text/catalog.ts`, con archivos WOFF de Fontsource servidos desde el mismo dominio. Cada variante se descarga al elegirla, sin llamadas del navegador a Google. Sus licencias están en `public/fonts/licenses/`. Añadir otro proveedor no requiere cambiar el formato de los textos guardados.
- **Medidas del texto:** el tamaño en puntos mide el cuerpo tipográfico (1 pt = 25,4/72 mm). La altura de una H es una referencia aproximada de impresión; el marco puede incluir el espacio del renglón. Cambiar de familia conserva los puntos.
- **Color del texto:** acepta códigos hexadecimales de tres o seis dígitos, con o sin `#`. Al arrastrar el selector se reutiliza una vista previa a resolución de pantalla; al confirmar se regenera el texto y se guarda un solo paso de deshacer. El color predeterminado es `#111111`.
- **Hojas:** se numeran 1, 2, 3… en el mismo orden que las páginas del PDF.
- **Omitir hojas en blanco:** una hoja sale si tiene tinta (cualquier píxel que no sea blanco puro) fuera de las franjas de solape. Lo que cae en una franja lo imprimen las dos hojas que la comparten, así que basta con una de ellas. La tarjeta del PDF dice cuáles saldrán («las 1 y 2»). Las hojas que no toca ninguna capa no se dibujan para comprobarlo, y el resultado se reutiliza hasta que cambie algo.
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
