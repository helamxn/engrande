# Plan de mejora del editor (auditoría del 22-11-2026)

Revisión del editor visual (lienzo, selección, transformación, capas y grupos, herramientas de píxeles, texto,
formas, paneles, portapapeles, historial y atajos) comparado con Figma, Photoshop/Photopea, Illustrator y
Excalidraw. Cada propuesta indica **por qué aporta algo a engrande**, no solo que otro editor la tenga.

## 1. Lo que ya está a nivel profesional (no se toca salvo fallo)

Esto evita duplicar trabajo o «mejorar» lo que ya funciona:

- **Modelo de objetos**: capas con transformación en mm (centro, tamaño, giro, espejo), recorte no destructivo
  (`crop` en fracciones), lienzo de trabajo + original, opacidad, oculta/bloqueada y grupos anidados por ruta
  (`gpath`), normalizados en `groups.ts`.
- **Historial**: instantáneas completas con presupuesto de memoria (`trimStack`), series para flechas y
  deslizadores (`snapSeries`), pasos pendientes que solo se guardan si el gesto cambia algo, y liberación de
  lienzos y PDF descartados.
- **Ajuste magnético**: bordes y centros de otras capas y del póster, tamaño igual, separación igual, guías de
  usuario, rejilla de 1 mm; Ctrl/⌘ lo desactiva. Las flechas se detienen en las líneas que cruzarían.
- **Medidas** con Alt (al pasar, al mover, al escalar), como en Figma.
- **Selección**: clic por niveles de grupo, doble clic para entrar, Esc para salir, recuadro en vivo, Shift/Ctrl
  para sumar o quitar, Alt + arrastrar para duplicar, duplicado con paso repetido (Ctrl+D).
- **Transformación**: esquinas proporcionales, Shift libre, lados para estirar, Alt desde el centro, giro con
  imán a 0/90/180/270 y Shift de 15°, recorte con marco fijo, proporciones y cuadrícula de tercios.
- **Píxeles en un worker**: quitar fondo, varita (contigua o global), borrador y restaurar con mezcla exacta.
- **Texto en contornos** (se imprime sin la fuente), formas, pegado del sistema, persistencia en IndexedDB.
- Base de pruebas: 242 unitarias en verde y e2e de lienzo, edición, texto, composición, táctil y móvil.

## 2. Hallazgos: fallos, incoherencias y huecos

| # | Área | Hallazgo | Dónde |
|---|------|----------|-------|
| H1 | Lienzo | La etiqueta «Póster … · margen 6 mm» desaparecía si no cabía en el ancho del papel. **Corregido**: ocupa el hueco libre hasta la siguiente isla. | `render.ts` `drawPosterCaption` |
| H2 | Giro | Girar **una** capa tiene imán a 0/90/180/270; girar **varias** no. Mismo gesto, distinto resultado. | `pointer.ts`, caso `grot` |
| H3 | Capas | En la lista, Shift + clic alterna como Ctrl + clic. En Figma, Photoshop e Illustrator Shift selecciona el **rango**: con muchas capas no hay forma rápida de elegir un tramo. | `panel.ts:438` |
| H4 | Portapapeles | Pegar siempre desplaza +10 mm × n desde el original. Si el original ya no se ve (vista desplazada o con zoom), lo pegado cae fuera de pantalla. No hay «pegar en el mismo sitio». | `actions.ts` `pasteLayer` |
| H5 | Atajos | Ocultar y bloquear la selección existen en el menú pero no tienen atajo. Alinear tampoco. | `keyboard.ts` |
| H6 | Pincel | El tamaño del borrador solo cambia con el deslizador de la barra: hay que soltar el lienzo en cada ajuste. `[` y `]` sin modificador están libres. | `contextbar.ts`, `keyboard.ts` |
| H7 | Zoom | No hay atajo para el 100 % (tamaño real aproximado), que en un póster es la vista más útil para juzgar la calidad. | `view.ts`, `keyboard.ts` |
| H8 | Grupos | Un grupo o una selección múltiple se escala solo desde las esquinas (no hay tiradores de lado) y en el panel no tiene ancho, alto, posición ni giro numéricos. Una capa sola sí los tiene. | `render.ts` `groupHandles`, `SelectionCard.astro` |
| H9 | Campos | Los campos numéricos aceptan flechas y Shift, pero no operaciones (`21/2`, `+5`, `*2`) ni arrastrar la etiqueta para cambiar el valor, que en Figma son la forma habitual de ajustar con precisión. | `panel.ts` `parseNum` |
| H10 | Rendimiento | ~~Leer un píxel en cada movimiento~~ **Corregido tras medir**: al pasar el ratón no se leían píxeles (solo al hacer clic, y cuesta poco: 4 ms en 40 clics). El problema real era otro. El resaltado usaba solo la caja de la capa y no coincidía con lo que seleccionaba el clic. Y cada clic reconstruía la lista de capas dos veces y programaba un guardado sin haber cambiado nada. | `pointer.ts`, `panel.ts` `renderList` |

## 3. Plan por tandas

Cada tanda se cierra con: pruebas unitarias de la lógica nueva, un e2e de la interacción, `pnpm check`,
la suite completa y una prueba a mano en el navegador.

### Tanda 1: coherencia y flujo diario — **hecha** (pruebas en `e2e/atajos.spec.ts`)

1. **Imán de giro también para varias capas** (H2): misma regla que una sola (±3° a múltiplos de 90°), con
   Shift a 15°. Unifica el cálculo en una función de `geometry.ts` con su prueba.
2. **Rango en la lista de capas** (H3): Shift + clic, del último clic al actual, en el orden visible y respetando
   el nivel de grupo; Ctrl/⌘ + clic sigue alternando. Ocultas y bloqueadas quedan fuera, como en el lienzo.
3. **Pegar visible y en el sitio** (H4): si la posición desplazada queda fuera de la vista, se pega centrado en la
   zona libre; **Ctrl/⌘ + Mayús + V** pega en el mismo sitio. Se documenta en `?` y en el menú.
4. **Atajos que faltan** (H5, H7): Ctrl/⌘ + Mayús + H ocultar, Ctrl/⌘ + Mayús + L bloquear, Mayús + 1 ver todo
   (además de Ctrl/⌘ + 0) y Mayús + 0 al 100 %. Alinear: Alt + A/D/W/S/H/V como Figma **solo si** el navegador
   deja interceptarlos (Alt + D va a la barra de direcciones en Edge y Chrome); si no, se dejan en el menú.
5. **Pincel con `[` y `]`** (H6): ± 10 % con aviso breve del tamaño y el círculo del pincel actualizado al momento.

### Tanda 2: precisión en grupos y campos — **hecha** (pruebas en `e2e/precision.spec.ts`)

6. **Panel de la selección múltiple** con ancho, alto, X, Y y giro del marco común, con candado de proporción.
7. **Tiradores de lado en grupos** para estirar en un eje (con Alt desde el centro), con el mismo imán que una capa.
8. **Operaciones en los campos** (`+5`, `-2`, `*2`, `/3`, `21/2`) y arrastrar la etiqueta para cambiar el valor.

### Tanda 3: rendimiento y robustez — **hecha**

Medido con 16 imágenes de 2400 × 1600 px con el centro transparente (el clic las atraviesa todas), en Edge, con la
compilación de producción:

| | Antes | Después |
|---|---|---|
| Un clic sobre el lienzo | 4,7–5,7 ms | 0,5 ms |
| Pasar el ratón (por movimiento) | 0,04 ms (sin mirar píxeles) | 0,05 ms (mirando los píxeles de las 16) |
| Mover la vista | 60 fps (16,7 ms) | 60 fps (16,7 ms) |

9. **El resaltado es lo que seleccionaría el clic**: al pasar el ratón y al medir con Alt se usa la misma prueba
   precisa que el clic (las zonas transparentes dejan ver la imagen de debajo).
   Se descartó la máscara de opacidad en caché del plan inicial. Medido, leer un píxel cuesta unos 7 µs porque los
   lienzos de las capas ya están en memoria de CPU (`willReadFrequently`), y la máscara solo añadía complejidad.
   Las páginas de PDF eran la excepción: ahora también se crean así. La copia a alta resolución para exportar no.
10. **La lista de capas no se reconstruye si solo cambia la selección**: se comparan las filas que habría que dibujar
    (objeto, nombre, oculta, bloqueada, opacidad, tamaño, página y grupos) y, si son las mismas, solo se marcan las
    seleccionadas y se redibujan las miniaturas en su sitio. Se conserva el foco del teclado.
11. **Un clic que no mueve nada no cuenta como cambio**: ni se reconstruye la lista ni se programa un guardado.
12. **Memoria**: sin cambios. El historial ya tiene un presupuesto de lienzos (`trimStack`) y libera los lienzos
    y PDF que dejan de usarse. El montón de JavaScript se queda en 3–5 MB con las 16 imágenes, porque los píxeles van
    en los lienzos, fuera de él.

Nota sobre las pruebas e2e: con el número de procesos por defecto, tres pruebas pesadas (fuentes del equipo y
exportación) pueden agotar su tiempo en este equipo. Con `--workers 3` pasan las 103.

### Ronda 4: ajustes pedidos tras probar — **hecha** (pruebas en `e2e/arreglos.spec.ts` y `e2e/fijo.spec.ts`)

13. **Lag tras un zoom extremo**: cada imagen se dibuja desde una copia reducida que solo crecía. Tras acercar mucho,
    al volver se reducía cada fotograma una copia de 1536 px a unos cientos (12–15 fps). Ahora se rehace más pequeña
    cuando sobra el doble, teniendo en cuenta los duplicados que la comparten. Medido con 4 fotos de 4000 × 3000:
    después de volver con Ctrl+0 o alejando, de 66–83 ms a 16,7 ms por fotograma.
14. **Relleno de las formas**: se ve mientras se elige el color, es un solo paso de deshacer y se aplica a su forma
    aunque el selector se cierre con un clic en el lienzo que la deselecciona. Antes solo se aplicaba al cerrar, y el
    panel podía devolver el valor anterior mientras se elegía.
15. **Alt + Mayús / Mayús + Alt**: con Alt al pulsar, arrastrar siempre copia (Mayús solo restringe el eje). Si Alt
    llega después del clic pero antes de mover, también copia. Antes, Mayús al pulsar ganaba: «sumar a la selección».
16. **Recorte rápido**: Ctrl/⌘ + arrastrar un tirador recorta sin entrar en el modo de recorte. Es la convención de
    Figma. Canva recorta siempre por los lados, pero aquí los lados ya estiran, y Alt es «desde el centro».
17. **Tamaño del póster**: pasa del lienzo, encima de la regla, a abajo a la izquierda, delante de la línea de estado,
    como el tamaño del documento en la barra de estado de Photoshop o Photopea. No tapa nada ni se mueve, y abre Póster.
18. **Aviso del margen sin imprimir**: heredaba la alineación centrada de la etiqueta de la selección, así que el texto se
    salía de su recuadro. Además se dibujaba debajo de las reglas y podía quedar bajo el panel. Ahora tiene su propio
    estilo, se dibuja lo último y queda dentro de lo que se ve.

### Ronda 5: «Omitir hojas en blanco» — **hecha** (pruebas en `geometry.test.ts`, `format.test.ts` y `e2e/editar.spec.ts`)

19. **Lo de una franja de solape se imprime una sola vez**: el póster se parte en zonas (lo de cada hoja, las franjas
    que comparten dos y los cruces que comparten cuatro; ver `sheetCells`). Una zona con tinta de una sola hoja la
    obliga a salir. Las compartidas solo añaden una hoja si ninguna de las suyas sale ya (`chooseSheets`). Antes, una
    imagen que entraba 0,1 mm en la vecina sacaba una hoja entera más.
20. **Contar cuesta menos y no se repite**: las hojas que no toca ninguna capa no se dibujan, y el resultado se guarda
    con lo que lo decide (hojas, resolución y cada capa). La descarga aprovecha las hojas ya dibujadas. Con 3 × 3 A4 y
    una foto en una hoja, abrir la tarjeta pasa de 643 ms a 311 ms a 150 ppp y de 1838 ms a 333 ms a 300 ppp. Volver
    a abrirla sin cambios no redibuja nada.
21. **Se dice qué hojas salen**: «Se imprimirán 2 de 9 hojas del póster (las 1 y 2)…».

22. **Ajustes de descarga y deshacer**: marcar «Omitir hojas en blanco» creaba un paso de deshacer; cambiar las marcas,
    la guía o la resolución no. Además, cada paso guardaba esos ajustes y deshacer cualquier edición los restauraba: tras
    mover una imagen y poner 300 ppp, deshacer el movimiento volvía a 150 ppp sin avisar. Ahora ninguno de los cuatro
    es un paso de deshacer y solo vuelven al deshacer o rehacer «Nuevo póster», que es lo que los restablece
    (`restoreExport`).

## 4. Descartado por ahora (y por qué)

- **Pluma y curvas Bézier, operaciones booleanas, modos de fusión, efectos, componentes, varias mesas de trabajo**:
  engrande arma un póster impreso por hojas a partir de imágenes. Añaden mucha superficie de interfaz y de
  exportación (jsPDF) para un uso muy poco frecuente.
- **Pinceles de color y máscaras de capa editables**: el borrador con «Restaurar» ya es una máscara no destructiva
  sobre el original; una segunda forma de enmascarar duplicaría conceptos.
- **Selección por lazo**: el recuadro ya cubre la composición; con pocas capas grandes, el lazo no ahorra pasos.
