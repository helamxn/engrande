/**
 * Guardar y abrir el proyecto como archivo (.engrande): una copia del póster entero que se puede guardar, enviar o abrir
 * en otro equipo. Ctrl+S guarda; abrir es como agregar un archivo (botón, Ctrl+O o arrastrarlo a la ventana).
 */
import { BRAND } from '../../brand';
import { cancelCrop, select, setMode } from '../actions';
import { hideToast, toast } from '../dom';
import { markExported, snap, undo } from '../history';
import { renderBar } from '../ui/contextbar';
import { layoutRestored, renderList, syncExportUI } from '../ui/panel';
import { fitView } from '../view';
import { S, st } from '../state';
import { openProjectData, projectSnapshot, scheduleSave } from './persist';
import { MAX_PROJECT_BYTES, packProject, PROJECT_EXT, ProjectFileError, unpackProject } from './projectfile';

const today = () => new Date().toISOString().slice(0, 10);

export async function saveProjectFile() {
  if (!st.layers.length) { toast('El póster está vacío: no hay nada que guardar.', 5000); return; }
  toast('Preparando el proyecto…', 0);
  try {
    const { project, files } = await projectSnapshot();
    const blob = packProject(project, files), url = URL.createObjectURL(blob), a = document.createElement('a');
    const name = `${BRAND.name}-${today()}${PROJECT_EXT}`;
    a.href = url; a.download = name; a.rel = 'noopener';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
    markExported(); // es una copia del trabajo: al cerrar la pestaña ya no hace falta avisar
    toast(`Proyecto guardado: ${name} · ${Math.max(1, Math.round(blob.size / 1024 / 1024))} MB. Ábrelo aquí con «Abrir proyecto».`, 7000);
  } catch (err) {
    console.error(err);
    toast('No se pudo guardar el proyecto.', 6000);
  }
}

/** Abre un archivo de proyecto en lugar del póster de ahora; se puede deshacer. */
export async function openProjectFile(f: File) {
  if (f.size > MAX_PROJECT_BYTES) { toast(`«${f.name}» es demasiado grande para abrirlo.`, 6000); return; }
  toast('Abriendo el proyecto…', 0);
  let data;
  try { data = unpackProject(await f.arrayBuffer()); } catch (err) {
    console.error(err);
    toast(err instanceof ProjectFileError ? `«${f.name}»: ${err.message}` : `No se pudo abrir «${f.name}».`, 7000);
    return;
  }
  const had = st.layers.length > 0;
  if (S.mode === 'crop') cancelCrop();
  if (S.mode !== 'move') setMode('move');
  snap();
  st.layers = []; st.sel = null; st.group = [];
  let failed: string[];
  try { ({ failed } = await openProjectData(data.project, data.files)); } catch (err) {
    console.error(err);
    undo(); // vuelve el póster de antes, tal cual
    toast(`«${f.name}» está dañado o es de otra versión.`, 7000);
    return;
  }
  st.sheetsOn = true;
  syncExportUI(); layoutRestored(); fitView();
  select(null); renderList(); renderBar();
  scheduleSave();
  hideToast();
  if (!st.layers.length) { undo(); toast(`«${f.name}» no tiene nada que se pueda abrir.`, 7000); return; }
  const msg = failed.length ? `Proyecto abierto. No se pudo recuperar: ${failed.join(', ')}.` : `Proyecto abierto: ${f.name}.`;
  toast(msg, 8000, had ? { label: 'Deshacer', fn: undo } : undefined);
}
