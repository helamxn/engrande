import type { PDFDocumentProxy } from 'pdfjs-dist';
import type { GroupRef } from './groups';

export type Paper = 'A4' | 'A3' | 'Carta';
export type Orient = 'portrait' | 'landscape';
export type Mode = 'move' | 'crop' | 'erase' | 'wand';
export type BrushMode = 'erase' | 'restore';
export type FitMode = 'contain' | 'cover';
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

export interface Pt { x: number; y: number }
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

/** Origen de la imagen, para exportar a la resolución del archivo original y no a la del lienzo de trabajo. */
export type Source =
  | { kind: 'img'; blob: Blob; w: number; h: number }
  | { kind: 'svg'; blob: Blob }
  | { kind: 'pdf'; blob: Blob }
  | { kind: 'text'; spec: TextSpec };
/** Origen que es un archivo (todos menos el texto, que se guarda como contornos). */
export type FileSource = Exclude<Source, { kind: 'text' }>;

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

/**
 * Ajustes de color de una imagen, de −100 a 100 (0 = sin cambio), con la misma fórmula que los filtros CSS
 * brightness, contrast y saturate. No tocan el archivo ni el lienzo de trabajo: se aplican al dibujar (pantalla y PDF).
 */
export interface Adjust { bright: number; contrast: number; sat: number; gray: boolean }

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
  /** Brillo, contraste, saturación y blanco y negro; null = sin ajustes. Se trata como inmutable. */
  adjust: Adjust | null;
  /** Grupos a los que pertenece (Ctrl+G), del más externo al más interno; vacío = suelta. Ver groups.ts. */
  gpath: GroupRef[];
}

/** Medida del póster en mm. */
export interface Size { w: number; h: number }

export interface Settings {
  paper: Paper;
  orient: Orient;
  /** Columnas y filas elegidas a mano. Con medidas (size), las hojas salen de ellas: ver geo(). */
  cols: number;
  rows: number;
  /**
   * Medida del póster elegida por el usuario (mm). null = el póster mide lo que dan las columnas y filas. Con medida,
   * cambiar el papel, el margen o el solape conserva el tamaño y recalcula las hojas; la última columna y la última fila
   * pueden ir a medias (lo que sobra se recorta).
   */
  size: Size | null;
  /** Margen sin imprimir, en mm. */
  margin: number;
  /** Solape para pegar, en mm. */
  overlap: number;
  marks: boolean;
  guide: boolean;
  /** No incluir en el PDF por hojas las que no llevan nada (ver blank.ts). */
  skipBlank: boolean;
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
  /** Papel. */ pw: number; ph: number;
  /** Margen efectivo. */ m: number;
  /** Zona imprimible de cada hoja. */ tw: number; th: number;
  /** Solape efectivo. */ ov: number;
  /** Tamaño del póster (lo que se imprime). */ W: number; H: number;
  /** Hojas: columnas y filas. */ cols: number; rows: number;
  /** Lo que cubren las hojas (≥ W × H: con medida, la última columna y fila pueden ir a medias). */ GW: number; GH: number;
}

/** Una hoja: su fila y columna (desde 0), su esquina en el póster y lo que lleva impreso (mm; las del borde, a medias). */
export interface Tile { r: number; c: number; x0: number; y0: number; w: number; h: number }

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
  adjust: Adjust | null;
  hidden: boolean;
  gpath: GroupRef[];
  /** Cambia solo en los textos (al editarlos); en las imágenes es siempre el mismo. */
  src: Source | null;
}

/** Ajustes que definen la geometría del póster (se guardan en el historial). */
export type LayoutSettings = Pick<Settings, 'paper' | 'orient' | 'cols' | 'rows' | 'size' | 'margin' | 'overlap'>;

export interface Snapshot {
  layers: Layer[];
  sel: Layer | null;
  group: Layer[];
  props: LayerProps[];
  layout: LayoutSettings;
  /** Ajustes de descarga (opcional: los pasos de antes no los tenían). */
  exp?: Pick<Settings, 'dpi' | 'marks' | 'guide'> & Partial<Pick<Settings, 'skipBlank'>>;
  /** Se veían las hojas (en un póster sin imágenes, solo si se eligió la distribución). */
  sheetsOn?: boolean;
}

export interface ScaleDrag { t: 'scale'; id: HandleId; L0: Transform; k0: Crop }
export interface CropDrag { t: 'crop'; id: HandleId; k0: Crop; ratio0: number }
