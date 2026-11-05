/** Ventana de atajos de teclado y gestos (tecla «?» o botón del panel). */
import { $, $$ } from '../dom';
import { ALT, DELK, isMac, MOD, SHIFT } from '../platform';

const SHIFT_CLICK = isMac ? '⇧ o ⌘ + clic' : 'Shift o Ctrl + clic';

type Group = [title: string, items: [keys: string, what: string][]];

const GROUPS: Group[] = [
  ['General', [
    ['?', 'Ver esta ayuda'],
    [`${MOD}Z · ${MOD}Y`, 'Deshacer · rehacer'],
    [`${MOD}V`, 'Pegar una imagen'],
    ['Clic derecho', 'Menú de opciones'],
    ['Esc', 'Salir de la herramienta o deseleccionar'],
  ]],
  ['Vista', [
    [`${MOD}0`, 'Ver todo el póster'],
    [`${MOD}\\`, 'Mostrar u ocultar el panel (escritorio)'],
    ['+ · −', 'Acercar · alejar'],
    ['Rueda del ratón', 'Acercar o alejar'],
    ['Trackpad: dos dedos', 'Mover la vista (pellizco: zoom)'],
    ['Espacio + arrastrar', 'Mover la vista (también con el botón central)'],
  ]],
  ['Varias imágenes', [
    [SHIFT_CLICK, 'Agregar o quitar de la selección'],
    ['Arrastrar en el fondo', 'Recuadro: selecciona las que quedan dentro'],
    [`${MOD}A`, 'Seleccionar todas'],
    [`${MOD}G · ${MOD}${SHIFT}G`, 'Agrupar · desagrupar'],
    ['Doble clic en un grupo', 'Entrar en él y elegir una sola imagen'],
    ['Arrastrar una', 'Mover todas juntas'],
    ['Esquinas · círculo', 'Escalar · girar todas (Shift: de 15° en 15°)'],
    ['Mantener pulsada otra', 'Táctil: «Agregar a la selección»'],
  ]],
  ['Imagen seleccionada', [
    ['Flechas', 'Mover 1 mm (con Shift, 10 mm)'],
    [`${MOD}C · ${MOD}X · ${MOD}D`, 'Copiar · cortar · duplicar'],
    [`${MOD}] · ${MOD}[`, 'Adelante · atrás (con Shift: al frente / al fondo)'],
    [`${ALT} + ↑ ↓ en la lista`, 'Adelante · atrás (o arrastra la fila)'],
    ['R · H', 'Girar 90° · voltear (con Shift: al revés / en vertical)'],
    ['C · E · W', 'Recortar · borrador · varita'],
    [DELK, 'Quitar del póster'],
  ]],
  ['Con el ratón', [
    ['Esquina', 'Escalar sin deformar'],
    ['Shift + esquina', 'Escalar libre (deforma)'],
    ['Lado', 'Estirar en una dirección'],
    [`${ALT} + tirador`, 'Escalar o recortar desde el centro'],
    ['Shift + girar', 'Girar de 15° en 15°'],
    ['Shift + arrastrar', 'Mover solo en horizontal o vertical'],
    [`${ALT} + arrastrar`, 'Arrastrar una copia'],
  ]],
  ['Recortar', [
    ['Doble clic', 'Entrar en el recorte'],
    ['Arrastrar · rueda', 'Encuadrar · ampliar la imagen en el marco'],
    [`Shift · ${ALT} en un borde`, 'Mantener proporción · desde el centro'],
    ['Enter · Esc', 'Aplicar · cancelar'],
  ]],
  ['Pantalla táctil', [
    ['Mantener pulsado', 'Menú de opciones'],
    ['Pellizcar', 'Zoom; sobre la imagen, escalar y girar'],
    ['Doble toque', 'Recortar'],
  ]],
];

let dialog: HTMLDialogElement;

export const isShortcutsOpen = () => !!dialog?.open;
export function openShortcuts() { if (!dialog.open) dialog.showModal(); }

export function initShortcuts() {
  dialog = $<HTMLDialogElement>('#shortcuts');
  const body = $('#shortcutsBody');
  for (const [title, items] of GROUPS) {
    const sec = document.createElement('section');
    const h = document.createElement('h3');
    h.className = 'm-0 mb-2 text-[.72rem] font-bold uppercase tracking-[.07em] text-muted';
    h.textContent = title;
    const dl = document.createElement('dl');
    dl.className = 'keys';
    for (const [k, d] of items) {
      const dt = document.createElement('dt'); dt.textContent = k;
      const dd = document.createElement('dd'); dd.textContent = d;
      dl.append(dt, dd);
    }
    sec.append(h, dl);
    body.appendChild(sec);
  }
  for (const b of $$('[data-shortcuts]')) b.addEventListener('click', openShortcuts);
  $('#shortcutsClose').addEventListener('click', () => dialog.close());
  // clic fuera de la ventana (en el fondo oscuro) la cierra; Esc la cierra de forma nativa
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}
