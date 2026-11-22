import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { GroupRef } from './groups';

export type Paper = 'A4' | 'A3' | 'Carta';
export type Orient = 'portrait' | 'landscape';
export type Mode = 'move' | 'crop' | 'erase' | 'wand';
export type BrushMode = 'erase' | 'restore';
export type FitMode = 'contain' | 'cover';
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface Pt { x: number; y: number }
/** Referencia medida desde el origen imprimible, en mm. */
export interface LayoutGuide { axis: 'x' | 'y'; at: number }
export interface UV { u: number; v: number }

/** Ventana visible de la imagen, en fracciones 0..1 de su tamaño completo. */
export interface Crop { x0: number; y0: number; x1: number; y1: number }

/** Posición de una imagen en el póster. cx, cy: centro de la imagen completa (mm); w, h: su tamaño (mm, puede deformarse). */
export interface Transform {
  cx: number; cy: number; w: number; h: number; rot: number; flipX: boolean; flipY: boolean;
}

/** Lo mínimo que necesita la geometría: permite testear sin canvas reales. */
export interface LayerGeom extends Transform {
  crop: Crop;
  img: { width: number; height: number };
}

/**
 * Cómo está colocada la imagen. Si se ajustó o llenó el póster, al cambiar la hoja se vuelve a ajustar
 * (scale: fracción del ajuste, p. ej. 0.94). null = colocada a mano: conserva su tamaño en cm.
 */
export type Fit = { mode: FitMode; scale: number } | null;
export interface ShapeSpec { figure: 'rectangle' | 'ellipse' | 'triangle'; fill: string }

/** Origen de la imagen, para exportar a la resolución del archivo original y no a la del lienzo de trabajo. */
export type Source =
  | { kind: 'img'; blob: Blob; w: number; h: number }
  | { kind: 'svg'; blob: Blob }
  | { kind: 'pdf'; blob: Blob }
  | { kind: 'shape'; spec: ShapeSpec }
  | { kind: 'text'; spec: TextSpec };
/** Origen que es un archivo (todos menos el texto, que se guarda como contornos). */
export type FileSource = Extract<Source, { blob: Blob }>;

export type TextAlign = 'left' | 'center' | 'right';
/**
 * Texto convertido en contornos (en unidades de la fuente, y hacia abajo). El origen (0, 0) es la línea base de la
 * primera línea, en el punto de alineación: el borde izquierdo, el centro o el borde derecho de las líneas.
 */
export interface TextShape {
  /** Contorno de cada letra, en datos de trazado SVG (los espacios no tienen). */
  glyphs: { ch: string; d: string }[];
  /** Caja de la tinta: lo que se ve (la de la capa con «Ajustar la caja a las letras»). */
  box: { x0: number; y0: number; x1: number; y1: number };
  /** Caja de los renglones: la de la capa normalmente (ver frameOf en shape.ts). Falta en los primeros textos guardados. */
  lineBox?: { x0: number; y0: number; x1: number; y1: number };
  /** Altura de las mayúsculas: «Alto de mayúsculas» en el panel. */
  cap: number;
  /** Ascendente y descendente de la fuente (para colocar el cuadro de escritura). */
  asc: number; desc: number;
  upm: number;
}
/**
 * Texto: las palabras y su estilo, y sus contornos ya calculados. Así no hace falta la fuente para dibujarlo,
 * imprimirlo ni guardarlo: solo para cambiar las palabras, el espaciado o el interlineado. La fuente no se guarda.
 * Se trata como inmutable: cada cambio crea uno nuevo (el historial guarda el anterior).
 */
export interface TextSpec {
  text: string;
  /** Identificador de la fuente (ver fonts.ts) y su nombre, para pedirla si no está cargada. */
  font: string; fontName: string;
  align: TextAlign;
  /** Interlineado, en veces el tamaño de la fuente. */
  line: number;
  /** Espaciado entre letras, en milésimas del tamaño de la fuente. */
  track: number;
  color: string;
  /** Ajustar la caja a las letras (sin el aire de los renglones): para centrar o alinear con precisión. */
  fit: boolean;
  /**
   * Ancho fijo en unidades de la fuente: las líneas se parten entre palabras para no pasarse. null = automático (cada
   * línea mide lo que ocupa). Opcional para leer los textos guardados antes.
   */
  width?: number | null;
  shape: TextShape;
}

/** Borrador independiente de los contornos: también recupera palabras si falta la fuente del usuario. */
export interface TextDraft {
  target: number | null;
  text: string;
  font: string;
  fontName: string;
  style: Pick<TextSpec, 'align' | 'line' | 'track' | 'color' | 'fit'>;
  origin: Pt;
  cap: number;
  rot: number;
  flipX: boolean;
  flipY: boolean;
}

export interface Layer extends LayerGeom {
  id: number;
  name: string;
  /** Lienzo de trabajo (máx. MAX_SIDE px); las ediciones de píxeles se hacen aquí. */
  img: HTMLCanvasElement;
  /** Lienzo sin editar, para "Restaurar" y "Volver a la imagen original". */
  orig: HTMLCanvasElement;
  pdf: PDFDocumentProxy | null;
  page: number;
  pages: number;
  src: Source | null;
  fit: Fit;
  /** Oculta: no se dibuja, no se exporta y no se puede tocar en el lienzo. */
  hidden: boolean;
  /** Bloqueada: se ve y se imprime, pero en el lienzo no se puede tocar (útil para un fondo). Se elige desde la lista. */
  locked: boolean;
  /** Opacidad 0..1 (también en el PDF: se mezcla con el blanco del papel o con lo que haya debajo). */
  opacity: number;
  /** Grupos a los que pertenece (Ctrl+G), del más externo al más interno; vacío = suelta. Ver groups.ts. */
  gpath: GroupRef[];
}

export interface Settings {
  paper: Paper;
  orient: Orient;
  cols: number;
  rows: number;
  /** Margen sin imprimir, en mm. */
  margin: number;
  /** Solape para pegar, en mm. */
  overlap: number;
  posterSize?: { w: number; h: number } | null;
  skipBlank?: boolean;
  marks: boolean;
  guide: boolean;
  dpi: number;
  mode: Mode;
  /** Radio del pincel en px de pantalla. */
  brush: number;
  brushMode: BrushMode;
  tol: number;
  contig: boolean;
  cropRatio: number | null;
  cropRatioKey: string;
  lock: boolean;
}

/** Geometría del póster en mm. */
export interface Geo {
  cols: number; rows: number;
  /** Papel. */ pw: number; ph: number;
  /** Margen efectivo. */ m: number;
  /** Zona imprimible de cada hoja. */ tw: number; th: number;
  /** Solape efectivo. */ ov: number;
  /** Tamaño total del póster. */ W: number; H: number;
}

export interface LayerProps extends Transform {
  l: Layer;
  crop: Crop;
  img: HTMLCanvasElement;
  orig: HTMLCanvasElement;
  page: number;
  fit: Fit;
  name: string;
  locked: boolean;
  opacity: number;
  hidden: boolean;
  gpath: GroupRef[];
  /** Cambia solo en los textos (al editarlos); en las imágenes es siempre el mismo. */
  src: Source | null;
}

/** Ajustes que definen la geometría del póster (se guardan en el historial). */
export type LayoutSettings = Pick<Settings, 'paper' | 'orient' | 'cols' | 'rows' | 'margin' | 'overlap' | 'posterSize'>;

export interface Snapshot {
  layoutGuides?: LayoutGuide[];
  layers: Layer[];
  sel: Layer | null;
  group: Layer[];
  props: LayerProps[];
  layout: LayoutSettings;
  /** Ajustes de descarga (opcional: los pasos de antes no los tenían). */
  exp?: Pick<Settings, 'dpi' | 'marks' | 'guide' | 'skipBlank'>;
  /**
   * Deshacer o rehacer este paso devuelve también los ajustes de descarga. Solo «Nuevo póster», que los restablece: los
   * ajustes de descarga no son ediciones del póster y deshacer otra cosa no debe cambiarlos.
   */
  restoreExport?: boolean;
  /** Se veían las hojas (en un póster sin imágenes, solo si se eligió la distribución). */
  sheetsOn?: boolean;
}

export interface ScaleDrag { t: 'scale'; id: HandleId; L0: Transform; k0: Crop }
/** quick: Ctrl/⌘ + tirador fuera del modo de recorte (como en Figma): recorta ese lado sin entrar en el modo. */
export interface CropDrag { t: 'crop'; id: HandleId; k0: Crop; ratio0: number; quick?: boolean }
