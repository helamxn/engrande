/**
 * Ventana de atajos de teclado y gestos (tecla «?» o botón del panel).
 * Cada fila es una acción y sus teclas (dibujadas con keys.ts, como en el resto de la app). En pantallas táctiles,
 * los gestos táctiles van primero.
 */
import { $, $$ } from '../dom';
import { BRAND } from '../../brand';
import { isTouch } from '../platform';
import { gesture as t, key, keysEl, type Part } from './keys';

/** Acción y sus combinaciones alternativas (cada una, teclas que se pulsan juntas). */
type Row = [what: string, ...combos: Part[][]];
interface Group { title: string; touch?: boolean; rows: Row[] }

const C = key('mod'), A = key('alt'), S = key('shift'), DELK = key('del');
const ARROWS = '← ↑ → ↓';

const GROUPS: Group[] = [
  { title: 'General', rows: [
    ['Ver esta ayuda', ['?']],
    ['Agregar imágenes o PDF', [C, 'O']],
    ['Deshacer', [C, 'Z']],
    ['Rehacer', [C, 'Y'], [C, S, 'Z']],
    [`Pegar una imagen o lo copiado en ${BRAND.name}`, [C, 'V']],
    ['Menú de opciones', [t('Clic derecho')]],
    ['Salir de la herramienta o del grupo, o deseleccionar', ['Esc']],
  ] },
  { title: 'Vista', rows: [
    ['Ver todo el póster', [C, '0']],
    ['Acercar · alejar', ['+'], ['−']],
    ['Acercar o alejar con el ratón', [t('Rueda')]],
    ['Mover la vista', ['Espacio', t('arrastrar')], [t('Botón central')]],
    ['Mover la vista con el trackpad', [t('Dos dedos')]],
    ['Mostrar u ocultar el panel', [C, '\\']],
  ] },
  { title: 'Herramientas', rows: [
    ['Mover', ['V']],
    ['Recortar', ['C'], [t('Doble clic')]],
    ['Borrador', ['E']],
    ['Varita', ['W']],
  ] },
  { title: 'Imagen seleccionada', rows: [
    ['Mover 1 mm', [ARROWS]],
    ['Mover 10 mm', [S, ARROWS]],
    ['Mover midiendo las distancias', [A, ARROWS]],
    ['Copiar', [C, 'C']],
    ['Cortar', [C, 'X']],
    ['Duplicar', [C, 'D']],
    ['Traer adelante · enviar atrás', [C, ']'], [C, '[']],
    ['Traer al frente · enviar al fondo', [C, S, ']'], [C, S, '[']],
    ['Subir o bajar en la lista', [A, '↑'], [A, '↓']],
    ['Girar 90°', ['R']],
    ['Girar 90° al revés', [S, 'R']],
    ['Voltear en horizontal · en vertical', ['H'], [S, 'H']],
    ['Quitar del póster', [DELK]],
  ] },
  { title: 'Varias imágenes', rows: [
    ['Agregar o quitar de la selección', [S, t('clic')], [C, t('clic')]],
    ['Seleccionar con un recuadro', [t('Arrastrar en el fondo')]],
    ['Seleccionar todas', [C, 'A']],
    ['Agrupar (también grupos)', [C, 'G']],
    ['Desagrupar un nivel', [C, S, 'G']],
    ['Entrar en un grupo', [t('Doble clic')]],
  ] },
  { title: 'Con el ratón', rows: [
    ['Escalar sin deformar', [t('Arrastrar una esquina')]],
    ['Escalar libre (deforma)', [S, t('esquina')]],
    ['Estirar en una dirección', [t('Arrastrar un lado')]],
    ['Escalar o recortar desde el centro', [A, t('tirador')]],
    ['Girar', [t('Arrastrar el círculo')]],
    ['Girar de 15° en 15°', [S, t('girar')]],
    ['Mover solo en horizontal o vertical', [S, t('arrastrar')]],
    ['Mover sin imán ni rejilla', [C, t('arrastrar')]],
    ['Arrastrar una copia', [A, t('arrastrar')]],
    ['Medir distancias a otra imagen o al póster', [A, t('pasar el ratón')]],
  ] },
  { title: 'Recortar', rows: [
    ['Encuadrar la imagen', [t('Arrastrar')]],
    ['Ampliar la imagen en el marco', [t('Rueda')]],
    ['Mantener la proporción', [S, t('borde')]],
    ['Recortar desde el centro', [A, t('borde')]],
    ['Aplicar · cancelar', ['Enter'], ['Esc']],
  ] },
  { title: 'Pantalla táctil', touch: true, rows: [
    ['Menú de opciones', [t('Mantener pulsado')]],
    ['Agregar otra a la selección', [t('Mantener pulsada otra')]],
    ['Mover la vista', [t('Deslizar en el fondo')]],
    ['Acercar o alejar', [t('Pellizcar en el fondo')]],
    ['Escalar y girar la imagen', [t('Pellizcar sobre ella')]],
    ['Recortar', [t('Doble toque')]],
    ['Medir distancias', [t('Menú › Medir distancias')]],
  ] },
];

let dialog: HTMLDialogElement, body: HTMLElement;

/** Dibuja las secciones (en táctil, los gestos táctiles primero). */
function render() {
  body.replaceChildren();
  const touchFirst = isTouch();
  const groups = touchFirst ? [...GROUPS.filter((g) => g.touch), ...GROUPS.filter((g) => !g.touch)] : GROUPS;
  for (const g of groups) {
    const sec = document.createElement('section');
    sec.className = 'sk-sec';
    const h = document.createElement('h3');
    h.textContent = g.title;
    const dl = document.createElement('dl');
    for (const [what, ...combos] of g.rows) {
      const row = document.createElement('div');
      row.className = 'sk-row';
      const dt = document.createElement('dt'); dt.textContent = what;
      const dd = document.createElement('dd'); dd.appendChild(keysEl(combos));
      row.append(dt, dd);
      dl.appendChild(row);
    }
    sec.append(h, dl);
    body.appendChild(sec);
  }
}

export const isShortcutsOpen = () => !!dialog?.open;
export function openShortcuts() {
  if (dialog.open) return;
  render();
  body.scrollTop = 0;
  dialog.showModal();
}

export function initShortcuts() {
  dialog = $<HTMLDialogElement>('#shortcuts');
  body = $('#shortcutsBody');
  for (const b of $$('[data-shortcuts]')) b.addEventListener('click', openShortcuts);
  $('#shortcutsClose').addEventListener('click', () => dialog.close());
  // clic fuera de la ventana (en el fondo oscuro) la cierra; Esc la cierra de forma nativa
  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
}
