/** Arranque del editor: conecta módulos y eventos, y restaura el póster guardado (si no hay, pantalla de inicio). */
import { afterHistory, cancelCrop, newPoster, pasteLayer, select } from './actions';
import { $, toast } from './dom';
import { clearHistory, hasUnexported, redo, setHistoryHooks, undo } from './history';
import { exportMarginTest, exportSingle, exportTiles } from './io/export';
import { handlePaste, initLoad } from './io/load';
import { flushSave, initPersistence, isOtherTabOpen, isWorkSafe, restoreProject, scheduleSave } from './io/persist';
import { initKeyboard } from './input/keyboard';
import { initPointer } from './input/pointer';
import { dockMQ, isMac, MOD } from './platform';
import { hydrateKeys } from './ui/keys';
import { initRender, readColors } from './render';
import { st, V } from './state';
import { initContextBar } from './ui/contextbar';
import { initLayout } from './ui/layout';
import { initMenu } from './ui/menu';
import { initShortcuts } from './ui/shortcuts';
import { initPanel, layoutRestored, renderList, syncExportUI, syncSel, updateHint } from './ui/panel';
import { fitView, resize, zoomCenter } from './view';

/** Los títulos del marcado dicen «Ctrl+»; en Mac se muestran con ⌘ (el editor acepta las dos teclas). */
function macTitles() {
  if (!isMac) return;
  document.querySelectorAll<HTMLElement>('[title*="Ctrl+"]').forEach((el) => { el.title = el.title.replaceAll('Ctrl+', MOD); });
}

export function startEditor() {
  macTitles();
  hydrateKeys(); // teclas del marcado (data-keys), con el mismo aspecto que en el resto de la app
  const cv = $<HTMLCanvasElement>('#cv'), stage = $('#stage');

  initRender(cv);
  initMenu();
  initContextBar();
  initPanel();
  initPointer(cv);
  initKeyboard();
  initLoad();
  initPersistence();
  initShortcuts();
  initLayout();

  setHistoryHooks({
    afterHistory,
    cancelCrop,
    changed: scheduleSave,
    syncUndo: (u, r) => { $<HTMLButtonElement>('#undo').disabled = !u; $<HTMLButtonElement>('#redo').disabled = !r; },
  });

  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#zoomIn').addEventListener('click', () => zoomCenter(1.4));
  $('#zoomOut').addEventListener('click', () => zoomCenter(1 / 1.4));
  $('#zoomFit').addEventListener('click', fitView);
  $('#exportTiles').addEventListener('click', () => void exportTiles());
  $('#exportSingle').addEventListener('click', () => void exportSingle());
  $('#quickExport').addEventListener('click', () => void exportTiles());
  $('#marginTest').addEventListener('click', () => void exportMarginTest());
  $('#newPoster').addEventListener('click', newPoster);
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
    if (hasUnexported()) e.preventDefault();
  });

  readColors();
  updateHint();

  // estado vacío listo desde el principio (pantalla de inicio, lectura, exportar desactivado): no depende de que
  // el guardado del navegador responda, que puede tardar o no estar disponible
  renderList();
  syncSel();

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
      else if (await isOtherTabOpen()) toast('Pliego está abierto en otra pestaña. Se guarda lo último que cambies en cualquiera de las dos.', 9000);
      else toast('Se recuperó tu póster.', 6000, { label: 'Empezar de nuevo', fn: newPoster });
    }
    resize(stage, cv);
  })();
}
