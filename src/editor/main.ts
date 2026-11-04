/** Arranque del editor: conecta módulos, eventos y la imagen de ejemplo. */
import { addLayer, afterHistory, cancelCrop, newLayer, pasteLayer, select } from './actions';
import { $ } from './dom';
import { hasUnexported, redo, setHistoryHooks, undo } from './history';
import { exportSingle, exportTiles } from './io/export';
import { handlePaste, initLoad } from './io/load';
import { initKeyboard } from './input/keyboard';
import { initPointer } from './input/pointer';
import { dockMQ } from './platform';
import { initRender, readColors } from './render';
import { sampleCanvas } from './sample';
import { st, V } from './state';
import { initContextBar } from './ui/contextbar';
import { initMenu } from './ui/menu';
import { initPanel, updateHint } from './ui/panel';
import { fitView, resize, zoomCenter } from './view';

export function startEditor() {
  const cv = $<HTMLCanvasElement>('#cv'), stage = $('#stage');

  initRender(cv);
  initMenu();
  initContextBar();
  initPanel();
  initPointer(cv);
  initKeyboard();
  initLoad();

  setHistoryHooks({
    afterHistory,
    cancelCrop,
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
  document.addEventListener('paste', (e) => handlePaste(e, pasteLayer));

  // tema: el canvas necesita releer los colores al cambiar entre claro y oscuro
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readColors);
  new MutationObserver(readColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  new ResizeObserver(() => resize(stage, cv)).observe(stage);
  dockMQ?.addEventListener('change', () => { if (V.fitted) fitView(); });

  // aviso al cerrar o recargar si hay trabajo sin exportar
  addEventListener('beforeunload', (e) => { if (hasUnexported()) e.preventDefault(); });

  readColors();
  updateHint();

  // la imagen de ejemplo usa la fuente Archivo: se espera a que cargue
  document.fonts.load('800 160px "Archivo Variable"').catch(() => {}).finally(() => {
    if (!st.layers.length) {
      addLayer(newLayer(sampleCanvas(), 'Vuela alto', { isSample: true }), { factor: 0.94 });
      select(null);
    }
    resize(stage, cv);
  });
}
