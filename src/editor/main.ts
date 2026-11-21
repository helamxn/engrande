/** Arranque del editor: conecta módulos y eventos, y restaura el póster guardado (si no hay, pantalla de inicio). */
import { BRAND } from '../brand';
import { afterHistory, cancelCrop, newPoster, pasteLayer, select } from './actions';
import { $, toast } from './dom';
import { clearHistory, hasUnexported, redo, setHistoryHooks, undo } from './history';
import { exportMarginTest, exportSingle, exportTiles, printTiles } from './io/export';
import { handlePaste, initLoad } from './io/load';
import { flushSave, initPersistence, isOtherTabOpen, isWorkSafe, restoreProject, scheduleSave } from './io/persist';
import { initKeyboard } from './input/keyboard';
import { initPointer } from './input/pointer';
import { dockMQ, isMac, MOD } from './platform';
import { hydrateKeys } from './ui/keys';
import { initRender, readColors } from './render';
import { st, V } from './state';
import { initContextBar, renderBar } from './ui/contextbar';
import { initLayout } from './ui/layout';
import { initMenu, pasteAny } from './ui/menu';
import { initShortcuts } from './ui/shortcuts';
import { initPanel, layoutRestored, renderList, syncExportButtons, syncExportUI, syncSel, updateHint } from './ui/panel';
import { fitView, resize } from './view';
import { initScaleRef, toggleScaleRef } from './scaleref';
import { initTextPanel } from './text/textpanel';
import { onPlacingChange } from './text/editor';
import { restoreTextDraft } from './text/editor';

/** Los títulos del marcado dicen «Ctrl+»; en Mac se muestran con ⌘ (el editor acepta las dos teclas). */
function macTitles() {
  if (!isMac) return;
  document.querySelectorAll<HTMLElement>('[title*="Ctrl+"]').forEach((el) => { el.title = el.title.replaceAll('Ctrl+', MOD); });
}

/**
 * Tarjeta del PDF (flecha de «Descargar PDF»): se abre 8 px bajo la cabecera, alineada con ella, como la barra de
 * acciones. Elegir una salida la cierra (el progreso sigue en el aviso de abajo).
 */
function initPdfCard() {
  const card = $('#pdfCard'), more = $('#exportMore');
  // bajo la cabecera, alineada con su borde izquierdo y a 8 px (la misma separación que la barra de acciones), y sin
  // pasar del borde de abajo. Se coloca antes de mostrarse (beforetoggle): en «toggle», que llega después, se veía un
  // instante en la esquina de la pantalla
  const place = () => {
    const r = $('header').getBoundingClientRect(), w = card.offsetWidth, top = Math.round(r.bottom + 8);
    card.style.left = `${Math.round(w ? Math.min(Math.max(8, r.left), innerWidth - w - 8) : Math.max(8, r.left))}px`;
    card.style.top = `${top}px`;
    card.style.maxHeight = `${Math.max(160, innerHeight - top - 8)}px`;
  };
  card.addEventListener('beforetoggle', (e) => { if ((e as ToggleEvent).newState === 'open') { syncExportButtons(); place(); } });
  card.addEventListener('toggle', (e) => {
    const open = (e as ToggleEvent).newState === 'open';
    more.setAttribute('aria-expanded', String(open));
    if (open) place(); // ya con su ancho real
  });
  const run = (id: string, fn: () => unknown) => $(id).addEventListener('click', () => { card.hidePopover(); void fn(); });
  run('#exportTiles', exportTiles);
  run('#printTiles', printTiles);
  run('#exportSingle', exportSingle);
  run('#marginTest', exportMarginTest);
  run('#newPosterAlt', newPoster);
}

export function startEditor() {
  macTitles();
  hydrateKeys(); // teclas del marcado (data-keys), con el mismo aspecto que en el resto de la app
  const cv = $<HTMLCanvasElement>('#cv'), stage = $('#stage');

  initRender(cv);
  initMenu();
  initContextBar();
  initPanel();
  initTextPanel();
  // «Agregar texto» esperando el clic: el botón de la barra se marca y la pista lo explica
  onPlacingChange(() => { renderBar(); updateHint(); });
  initPointer(cv);
  initKeyboard();
  initLoad();
  initPersistence();
  initShortcuts();
  initLayout();
  initScaleRef();

  setHistoryHooks({
    afterHistory,
    cancelCrop,
    changed: scheduleSave,
    syncUndo: (u, r) => { $<HTMLButtonElement>('#undo').disabled = !u; $<HTMLButtonElement>('#redo').disabled = !r; },
  });

  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#zoomFit').addEventListener('click', fitView);
  $('#scaleRef').addEventListener('click', () => toggleScaleRef());
  $('#quickExport').addEventListener('click', () => void exportTiles());
  initPdfCard();
  $('#newPoster').addEventListener('click', newPoster);
  // bienvenida: «Pegar» hace lo mismo que Pegar del menú (portapapeles del sistema o la copia interna)
  $('#welcomePaste').addEventListener('click', () => void pasteAny());
  document.addEventListener('paste', (e) => handlePaste(e, pasteLayer));

  // tema: el canvas necesita releer los colores al cambiar entre claro y oscuro
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  new ResizeObserver(() => resize(stage, cv)).observe(stage);
  dockMQ?.addEventListener('change', () => { if (V.fitted) fitView(); });

  // Al cerrar o recargar: si el trabajo ya está guardado en el navegador no hace falta avisar.
  // Si queda un guardado pendiente se intenta terminar; si el guardado no está disponible o falló, se avisa.
  addEventListener('beforeunload', (e) => {
    if (isWorkSafe()) return;
    void flushSave();
    if (hasUnexported() || st.textDraft) e.preventDefault();
  });

  readColors();
  updateHint();

  // estado vacío listo desde el principio (pantalla de inicio, lectura, exportar desactivado): no depende de que
  // el guardado del navegador responda, que puede tardar o no estar disponible
  renderList();
  syncSel();
  renderBar(); // «＋ Agregar» ya con la bienvenida

  void (async () => {
    // se restaura sin preguntar: solo hay una versión del trabajo, no hay nada que elegir
    const restored = await restoreProject().catch((err) => { console.error(err); return null; });
    if (restored && st.layers.length) {
      // si se tocó algo mientras se recuperaba, esos pasos de deshacer son de antes de que llegaran las imágenes
      clearHistory();
      syncExportUI();
      layoutRestored();
      select(null);
      renderList();
      if (restored.failed.length) toast(`No se pudo recuperar: ${restored.failed.join(', ')}.`, 8000);
      else if (await isOtherTabOpen()) toast(`${BRAND.name} está abierto en otra pestaña. Se guarda lo último que cambies en cualquiera de las dos.`, 9000);
      else toast('Se recuperó tu póster.', 6000, { label: 'Empezar de nuevo', fn: newPoster });
    }
    resize(stage, cv);
    restoreTextDraft();
  })();
}
