/** Lo que usa el editor de opentype.js (el paquete no trae tipos). Ver src/editor/text/fonts.ts. */
declare module 'opentype.js' {
  export interface BoundingBox { x1: number; y1: number; x2: number; y2: number; isEmpty(): boolean }
  export interface Path { toPathData(options?: number | { decimalPlaces?: number; optimize?: boolean; flipY?: boolean }): string; getBoundingBox(): BoundingBox }
  export interface Glyph { index: number; advanceWidth?: number; getPath(x?: number, y?: number, fontSize?: number): Path }
  export interface Font {
    unitsPerEm: number;
    ascender: number;
    descender: number;
    tables: {
      os2?: { sCapHeight?: number };
      gsub?: {
        features: { tag: string; feature: { lookupListIndexes: number[] } }[];
        lookups: { lookupType: number; subtables: { substFormat: number }[] }[];
      };
    };
    getEnglishName(name: 'fontFamily' | 'fontSubfamily' | 'fullName' | 'postScriptName'): string | undefined;
    charToGlyph(c: string): Glyph;
    stringToGlyphs(s: string): Glyph[];
    getKerningValue(left: Glyph, right: Glyph): number;
  }
  export function parse(buffer: ArrayBuffer): Font;
}
