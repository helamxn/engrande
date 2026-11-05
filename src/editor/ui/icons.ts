/**
 * Iconos de Lucide (https://lucide.dev, licencia ISC), importados uno a uno como texto SVG:
 * solo se incluyen en el build los que aparecen aquí. Se usan tanto desde TypeScript como desde
 * los componentes .astro (Icon.astro). Son constantes del código, no datos del usuario:
 * es seguro insertarlos con innerHTML.
 */
import alignBottom from 'lucide-static/icons/align-end-horizontal.svg?raw';
import alignHCenter from 'lucide-static/icons/align-center-vertical.svg?raw';
import alignLeft from 'lucide-static/icons/align-start-vertical.svg?raw';
import alignRight from 'lucide-static/icons/align-end-vertical.svg?raw';
import alignTop from 'lucide-static/icons/align-start-horizontal.svg?raw';
import alignVCenter from 'lucide-static/icons/align-center-horizontal.svg?raw';
import distributeH from 'lucide-static/icons/align-horizontal-distribute-center.svg?raw';
import distributeV from 'lucide-static/icons/align-vertical-distribute-center.svg?raw';
import selectBox from 'lucide-static/icons/square-dashed-mouse-pointer.svg?raw';
import arrowDown from 'lucide-static/icons/arrow-down.svg?raw';
import arrowUp from 'lucide-static/icons/arrow-up.svg?raw';
import check from 'lucide-static/icons/check.svg?raw';
import chevronLeft from 'lucide-static/icons/chevron-left.svg?raw';
import chevronRight from 'lucide-static/icons/chevron-right.svg?raw';
import clipboardPaste from 'lucide-static/icons/clipboard-paste.svg?raw';
import copy from 'lucide-static/icons/copy.svg?raw';
import copyPlus from 'lucide-static/icons/copy-plus.svg?raw';
import crop from 'lucide-static/icons/crop.svg?raw';
import download from 'lucide-static/icons/download.svg?raw';
import ellipsis from 'lucide-static/icons/ellipsis.svg?raw';
import eraser from 'lucide-static/icons/eraser.svg?raw';
import expand from 'lucide-static/icons/expand.svg?raw';
import eye from 'lucide-static/icons/eye.svg?raw';
import focus from 'lucide-static/icons/focus.svg?raw';
import eyeOff from 'lucide-static/icons/eye-off.svg?raw';
import filePlus from 'lucide-static/icons/file-plus.svg?raw';
import flip from 'lucide-static/icons/flip-horizontal-2.svg?raw';
import history from 'lucide-static/icons/history.svg?raw';
import imagePlus from 'lucide-static/icons/image-plus.svg?raw';
import keyboard from 'lucide-static/icons/keyboard.svg?raw';
import layers from 'lucide-static/icons/layers.svg?raw';
import link from 'lucide-static/icons/link-2.svg?raw';
import linkOff from 'lucide-static/icons/link-2-off.svg?raw';
import lock from 'lucide-static/icons/lock.svg?raw';
import lockOpen from 'lucide-static/icons/lock-open.svg?raw';
import maximize from 'lucide-static/icons/maximize.svg?raw';
import minus from 'lucide-static/icons/minus.svg?raw';
import paintbrush from 'lucide-static/icons/paintbrush.svg?raw';
import panelRightClose from 'lucide-static/icons/panel-right-close.svg?raw';
import panelRightOpen from 'lucide-static/icons/panel-right-open.svg?raw';
import plus from 'lucide-static/icons/plus.svg?raw';
import printer from 'lucide-static/icons/printer.svg?raw';
import redo from 'lucide-static/icons/redo-2.svg?raw';
import rotateCw from 'lucide-static/icons/rotate-cw.svg?raw';
import scaling from 'lucide-static/icons/scaling.svg?raw';
import shrink from 'lucide-static/icons/shrink.svg?raw';
import pencilLine from 'lucide-static/icons/pen-line.svg?raw';
import sparkles from 'lucide-static/icons/sparkles.svg?raw';
import trash from 'lucide-static/icons/trash-2.svg?raw';
import undo from 'lucide-static/icons/undo-2.svg?raw';
import wand from 'lucide-static/icons/wand-sparkles.svg?raw';
import x from 'lucide-static/icons/x.svg?raw';
import zoomInLens from 'lucide-static/icons/zoom-in.svg?raw';
import zoomOutLens from 'lucide-static/icons/zoom-out.svg?raw';

/** Quita el comentario de licencia y marca el icono como decorativo (el texto accesible va en el botón). */
const clean = (svg: string) =>
  svg.replace(/<!--[\s\S]*?-->/g, '').trim().replace('<svg', '<svg aria-hidden="true" focusable="false"');

const RAW = {
  // barra de la imagen
  crop, bg: sparkles, erase: eraser, wand, rot: rotateCw, flip, more: ellipsis, del: trash,
  // recorte y borrador
  check, x, restore: paintbrush,
  // lista de imágenes
  up: arrowUp, down: arrowDown, dup: copyPlus, eye, eyeOff,
  // cabecera y herramientas
  newPoster: filePlus, addImage: imagePlus, download, undo, redo, zoomIn: plus, zoomOut: minus, lock, lockOpen, printer,
  plus, minus, keyboard, panelClose: panelRightClose, panelOpen: panelRightOpen,
  // menú contextual (flechas de submenú e iconos de las opciones principales)
  chevronRight, chevronLeft, copy, paste: clipboardPaste, layers, scaling, history, fitAll: maximize, zoomInLens, zoomOutLens,
  // varias imágenes: alinear, repartir y seleccionar
  // tamaño y posición en el panel, renombrar
  ratioOn: link, ratioOff: linkOff,
  fitContain: shrink, fitCover: expand, center: focus, rename: pencilLine,
  alignLeft, alignHCenter, alignRight, alignTop, alignVCenter, alignBottom, distributeH, distributeV, selectBox,
} as const;

export type IconName = keyof typeof RAW;
export const ICON = Object.fromEntries(Object.entries(RAW).map(([k, v]) => [k, clean(v)])) as Record<IconName, string>;
