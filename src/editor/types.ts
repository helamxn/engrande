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
  | { kind: 'pdf'; blob: Blob };

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
}

/** Ajustes que definen la geometría del póster (se guardan en el historial). */
export type LayoutSettings = Pick<Settings, 'paper' | 'orient' | 'cols' | 'rows' | 'margin' | 'overlap'>;

export interface Snapshot {
  layers: Layer[];
  sel: Layer | null;
  group: Layer[];
  props: LayerProps[];
  layout: LayoutSettings;
  /** Ajustes de descarga (opcional: los pasos de antes no los tenían). */
  exp?: Pick<Settings, 'dpi' | 'marks' | 'guide'>;
  /** Se veían las hojas (en un póster sin imágenes, solo si se eligió la distribución). */
  sheetsOn?: boolean;
}

export interface ScaleDrag { t: 'scale'; id: HandleId; L0: Transform; k0: Crop }
export interface CropDrag { t: 'crop'; id: HandleId; k0: Crop; ratio0: number }
