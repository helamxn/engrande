import type { Font } from 'opentype.js';

/**
 * opentype.js 2 aplica ccmp de DFLT incluso al latín, pero no implementa GSUB 6/1 ni 6/2.
 * Solo se omiten esas consultas de composición, conservando las ligaduras y las consultas compatibles.
 * shape.ts normaliza a NFC para usar los caracteres acentuados ya compuestos de la fuente.
 * No cambia los bytes originales ni los contornos; FontFace recibe el archivo intacto.
 */
export function prepareFont(font: Font): Font {
  const gsub = font.tables.gsub;
  if (gsub) {
    gsub.features = gsub.features.map(feature => feature.tag !== 'ccmp' ? feature : {
      ...feature,
      feature: { ...feature.feature, lookupListIndexes: feature.feature.lookupListIndexes.filter(index => {
        const lookup = gsub.lookups[index];
        return !(lookup?.lookupType === 6 && lookup.subtables.some(table => table.substFormat !== 3));
      }) },
    });
  }
  return font;
}
