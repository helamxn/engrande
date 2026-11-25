/** Coma decimal (38,6 cm), como en el resto del texto en español. */
const nf1 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
/** mm → texto en cm con un decimal. */
export const cm = (mm: number) => nf1.format(mm / 10);
const nf2 = new Intl.NumberFormat('es-ES', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
/**
 * Distancia medida (Alt, separación igual) en cm, con la misma precisión que el resto (un decimal = mm entero:
 * 1,0 · 1,3 · 38,6). Las posiciones van en mm enteros (ver GRID_MM), así que casi siempre es exacta. Si no cae en un
 * mm entero (alineada con algo en décimas, alto fraccionario por la proporción) se ven dos decimales (1,08 · 2,05):
 * avisa de que esa medida no es redonda y un hueco pequeño nunca dice «0,0».
 */
export const cmGap = (mm: number) => {
  const r = Math.round(mm);
  return Math.abs(mm - r) < 0.05 ? nf1.format(r / 10) : nf2.format(mm / 10);
};
/** Por debajo de esto (mm) dos bordes se tocan: no se dibuja ninguna distancia. */
export const TOUCH_MM = 0.05;
/** Número con como mucho un decimal y coma decimal, para los campos de entrada (14,3). */
export const fmt1 = (v: number) => (Math.round(v * 10) / 10).toString().replace('.', ',');
/** Hasta tres decimales para conservar posiciones submilimétricas y ángulos en el inspector. */
export const fmtMeasure = (v: number) => String(Math.round(v * 1000) / 1000).replace('.', ',');
/**
 * Lee lo escrito en un campo: coma o punto decimal y espacios («14,3», «14.3», « 14 »), la unidad al final («14 cm»,
 * «30°») y operaciones, como en Figma: «21/2», «14,3+2», «(10+5)*2», «-3». Así se puede partir una medida o sumar un
 * margen sin calculadora. Sin eval: solo números, + − × ÷ y paréntesis. Lo que no se entiende da NaN.
 */
const lengthMM = { cm: 10, mm: 1, pt: 25.4 / 72 };
type MeasureUnit = keyof typeof lengthMM | '°' | '%';
export function parseNum(s: string, target?: MeasureUnit): number {
  if (s.length > 512) return NaN;
  const value = s.trim(), unit = value.match(/(cm|mm|pt|°|%)$/i)?.[0].toLowerCase() as MeasureUnit | undefined;
  let factorToTarget = 1;
  if (target && unit && unit !== target) {
    if (target === '°' || target === '%' || unit === '°' || unit === '%') return NaN;
    factorToTarget = lengthMM[unit] / lengthMM[target];
  }
  const src = (unit ? value.slice(0, -unit.length) : value).replace(/\s+/g, '').replace(/,/g, '.')
    .replace(/[×x]/g, '*').replace(/÷/g, '/').replace(/[−–]/g, '-');
  let i = 0;
  const peek = () => src[i];
  // expr = term (('+' | '-') term)*; term = factor (('*' | '/') factor)*; factor = ('+' | '-') factor | número | '(' expr ')'
  const expr = (): number => {
    let v = term();
    while (peek() === '+' || peek() === '-') v = src[i++] === '+' ? v + term() : v - term();
    return v;
  };
  const term = (): number => {
    let v = factor();
    while (peek() === '*' || peek() === '/') v = src[i++] === '*' ? v * factor() : v / factor();
    return v;
  };
  const factor = (): number => {
    const c = peek();
    if (c === '+' || c === '-') { i++; const v = factor(); return c === '-' ? -v : v; }
    if (c === '(') { i++; const v = expr(); if (src[i++] !== ')') return NaN; return v; }
    const m = /^(\d+\.?\d*|\.\d+)/.exec(src.slice(i));
    if (!m) return NaN;
    i += m[0].length;
    return parseFloat(m[0]);
  };
  if (!src) return NaN;
  const v = expr() * factorToTarget;
  return i === src.length && Math.abs(v) <= Number.MAX_SAFE_INTEGER / 1000 ? v : NaN;
}

/** Números de hoja en pocas palabras: [1, 2, 3, 5] → «1–3 y 5»; [4] → «4». */
export function numberList(ns: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < ns.length;) {
    let j = i;
    while (j + 1 < ns.length && ns[j + 1] === ns[j]! + 1) j++;
    parts.push(j - i >= 2 ? `${ns[i]}–${ns[j]}` : j > i ? `${ns[i]}, ${ns[j]}` : String(ns[i]));
    i = j + 1;
  }
  const flat = parts.join(', ').split(', ');
  return flat.length > 1 ? `${flat.slice(0, -1).join(', ')} y ${flat.at(-1)}` : flat[0] ?? '';
}
