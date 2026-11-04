/**
 * Geometría pura (sin DOM): conversiones mm ↔ coordenadas locales de la imagen, recorte, escalado y ajuste.
 * Todo está en milímetros del póster; las coordenadas locales (u, v) van de 0 a 1 sobre la imagen completa.
 */
import { PAPERS } from './constants';
import type { Crop, CropDrag, Fit, FitMode, Geo, HandleId, LayerGeom, Pt, ScaleDrag, Settings, Source, Transform, UV } from './types';

export const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
export const rad = (d: number) => (d * Math.PI) / 180;
/** Normaliza un ángulo a (-180, 180]. */
export const normDeg = (d: number) => {
  const n = (((d + 180) % 360) + 360) % 360 - 180;
  return n === -180 ? 180 : n;
};
/** Fila 0 → "A", 1 → "B"… */
export const rowName = (r: number) => String.fromCharCode(65 + r);

export function geo(s: Pick<Settings, 'paper' | 'orient' | 'cols' | 'rows' | 'margin' | 'overlap'>): Geo {
  let [pw, ph] = PAPERS[s.paper];
  if (s.orient === 'landscape') [pw, ph] = [ph, pw];
  const m = Math.min(s.margin, pw / 4);
  const tw = pw - 2 * m, th = ph - 2 * m;
  const ov = Math.min(s.overlap, tw / 3, th / 3);
  return { pw, ph, m, tw, th, ov, W: s.cols * tw - (s.cols - 1) * ov, H: s.rows * th - (s.rows - 1) * ov };
}

/* ---------- coordenadas locales ---------- */
export function localToMM(l: Transform, u: number, v: number): Pt {
  let x = (u - 0.5) * l.w, y = (v - 0.5) * l.h;
  if (l.flipX) x = -x;
  if (l.flipY) y = -y;
  const a = rad(l.rot), c = Math.cos(a), s = Math.sin(a);
  return { x: l.cx + x * c - y * s, y: l.cy + x * s + y * c };
}
/** Pasa un vector del póster a los ejes de la imagen (deshace giro y espejo). */
export function toAxes(l: Transform, d: Pt): Pt {
  const a = rad(l.rot), c = Math.cos(a), s = Math.sin(a);
  let x = d.x * c + d.y * s, y = -d.x * s + d.y * c;
  if (l.flipX) x = -x;
  if (l.flipY) y = -y;
  return { x, y };
}
export function mmToLocal(l: Transform, p: Pt): UV {
  const q = toAxes(l, { x: p.x - l.cx, y: p.y - l.cy });
  return { u: q.x / l.w + 0.5, v: q.y / l.h + 0.5 };
}
/** Mueve la imagen para que su punto local (u, v) quede en P. */
export function placeLocal(l: Transform, u: number, v: number, P: Pt) {
  l.cx = 0; l.cy = 0;
  const q = localToMM(l, u, v);
  l.cx = P.x - q.x; l.cy = P.y - q.y;
}

export const cropMid = (l: LayerGeom): [number, number] => [(l.crop.x0 + l.crop.x1) / 2, (l.crop.y0 + l.crop.y1) / 2];
export const cropCenter = (l: LayerGeom) => localToMM(l, ...cropMid(l));
export const visW = (l: LayerGeom) => l.w * (l.crop.x1 - l.crop.x0);
export const visH = (l: LayerGeom) => l.h * (l.crop.y1 - l.crop.y0);
export const natRatio = (l: LayerGeom) => l.img.height / l.img.width;

export function scaleLayer(l: Transform, f: number, p: Pt) {
  l.cx = p.x + (l.cx - p.x) * f; l.cy = p.y + (l.cy - p.y) * f; l.w *= f; l.h *= f;
}
export function rotateLayer(l: Transform, d: number, p: Pt) {
  const a = rad(d), c = Math.cos(a), s = Math.sin(a), dx = l.cx - p.x, dy = l.cy - p.y;
  l.cx = p.x + dx * c - dy * s; l.cy = p.y + dx * s + dy * c; l.rot = normDeg(l.rot + d);
}
/** Ejecuta fn y vuelve a dejar el centro de la zona visible donde estaba. */
export function keepCenter<L extends LayerGeom>(l: L, fn: (l: L) => void) {
  const P = cropCenter(l);
  fn(l);
  placeLocal(l, ...cropMid(l), P);
}
export function cropPtsMM(l: LayerGeom): Pt[] {
  const k = l.crop;
  return ([[k.x0, k.y0], [k.x1, k.y0], [k.x1, k.y1], [k.x0, k.y1]] as const).map(([u, v]) => localToMM(l, u, v));
}
export function bboxMM(l: LayerGeom) {
  const p = cropPtsMM(l), xs = p.map((q) => q.x), ys = p.map((q) => q.y);
  return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
}
export function inside(l: LayerGeom, m: Pt) {
  const q = mmToLocal(l, m), k = l.crop;
  return q.u >= k.x0 && q.u <= k.x1 && q.v >= k.y0 && q.v <= k.y1;
}

export function centerLayer(l: LayerGeom, g: Geo) {
  const c = cropCenter(l);
  l.cx += g.W / 2 - c.x; l.cy += g.H / 2 - c.y;
}
/** Ajusta (contain) o llena (cover) el póster con la zona visible, considerando el giro. */
export function fitLayer(l: LayerGeom, mode: FitMode, g: Geo) {
  const a = rad(l.rot), vw = visW(l), vh = visH(l);
  const bw = Math.abs(Math.cos(a)) * vw + Math.abs(Math.sin(a)) * vh;
  const bh = Math.abs(Math.sin(a)) * vw + Math.abs(Math.cos(a)) * vh;
  const f = mode === 'cover' ? Math.max(g.W / bw, g.H / bh) : Math.min(g.W / bw, g.H / bh);
  scaleLayer(l, f, cropCenter(l));
  centerLayer(l, g);
}
export const isStretched = (l: LayerGeom) => Math.abs(l.h / l.w / natRatio(l) - 1) > 0.005;
export const unstretch = (l: LayerGeom) => keepCenter(l, (x) => { x.h = x.w * natRatio(x); });

/* ---------- tiradores ---------- */
export const HANDLES: readonly HandleId[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export function handleLocal(l: LayerGeom, id: HandleId): [number, number] {
  const k = l.crop, mx = (k.x0 + k.x1) / 2, my = (k.y0 + k.y1) / 2;
  return [id.includes('w') ? k.x0 : id.includes('e') ? k.x1 : mx, id.includes('n') ? k.y0 : id.includes('s') ? k.y1 : my];
}

export function startScale(l: LayerGeom, id: HandleId): ScaleDrag {
  return { t: 'scale', id, L0: { cx: l.cx, cy: l.cy, w: l.w, h: l.h, rot: l.rot, flipX: l.flipX, flipY: l.flipY }, k0: { ...l.crop } };
}
/** Escalar desde un tirador: esquinas proporcional (Shift = libre), lados estiran; Alt = desde el centro. */
export function applyScale(l: LayerGeom, d: ScaleDrag, m: Pt, shift: boolean, alt: boolean) {
  const k = d.k0, id = d.id, cu = (k.x0 + k.x1) / 2, cv = (k.y0 + k.y1) / 2;
  const ua = alt ? cu : id.includes('w') ? k.x1 : id.includes('e') ? k.x0 : cu;
  const va = alt ? cv : id.includes('n') ? k.y1 : id.includes('s') ? k.y0 : cv;
  const uh = id.includes('w') ? k.x0 : id.includes('e') ? k.x1 : cu;
  const vh = id.includes('n') ? k.y0 : id.includes('s') ? k.y1 : cv;
  const A = localToMM(d.L0, ua, va), v = toAxes(d.L0, { x: m.x - A.x, y: m.y - A.y });
  const hx = (uh - ua) * d.L0.w, hy = (vh - va) * d.L0.h;
  let sx = 1, sy = 1;
  if (id.length === 2) {
    if (shift) { sx = v.x / hx; sy = v.y / hy; } else sx = sy = (v.x * hx + v.y * hy) / (hx * hx + hy * hy);
  } else if (hx) sx = v.x / hx;
  else sy = v.y / hy;
  const vw0 = d.L0.w * (k.x1 - k.x0), vh0 = d.L0.h * (k.y1 - k.y0), mn = 3; // tamaño mínimo visible: 3 mm
  if (id.length === 2 && !shift) { const s = Math.max(sx, mn / vw0, mn / vh0); sx = sy = s; }
  else { sx = Math.max(sx, mn / vw0); sy = Math.max(sy, mn / vh0); }
  Object.assign(l, { rot: d.L0.rot, flipX: d.L0.flipX, flipY: d.L0.flipY, w: d.L0.w * sx, h: d.L0.h * sy });
  placeLocal(l, ua, va, A);
}

/** Recorte con un tirador: Shift mantiene la proporción, Alt es simétrico desde el centro, fixedRatio fija la proporción (w/h en mm). */
export function applyCropDrag(l: LayerGeom, d: CropDrag, m: Pt, shift: boolean, alt: boolean, fixedRatio: number | null) {
  const q = mmToLocal(l, m), u = clamp(q.u, 0, 1), v = clamp(q.v, 0, 1), k: Crop = { ...d.k0 }, id = d.id, M = 0.02;
  const cu = (k.x0 + k.x1) / 2, cv = (k.y0 + k.y1) / 2;
  if (/[we]/.test(id)) {
    if (alt) { const hw = Math.max(M / 2, Math.min(Math.abs(u - cu), cu, 1 - cu)); k.x0 = cu - hw; k.x1 = cu + hw; }
    else if (id.includes('w')) k.x0 = Math.min(u, k.x1 - M);
    else k.x1 = Math.max(u, k.x0 + M);
  }
  if (/[ns]/.test(id)) {
    if (alt) { const hh = Math.max(M / 2, Math.min(Math.abs(v - cv), cv, 1 - cv)); k.y0 = cv - hh; k.y1 = cv + hh; }
    else if (id.includes('n')) k.y0 = Math.min(v, k.y1 - M);
    else k.y1 = Math.max(v, k.y0 + M);
  }
  const ratio = fixedRatio || (shift && id.length === 2 ? d.ratio0 : null);
  if (ratio) {
    let cw = (k.x1 - k.x0) * l.w, ch = (k.y1 - k.y0) * l.h;
    if (id.length === 2) { if (cw / ch > ratio) ch = cw / ratio; else cw = ch * ratio; }
    else if (/[ns]/.test(id)) cw = ch * ratio;
    else ch = cw / ratio;
    let fw = cw / l.w, fh = ch / l.h;
    const hA = alt || /^[ns]$/.test(id) ? 'c' : id.includes('w') ? 'r' : 'l';
    const vA = alt || /^[we]$/.test(id) ? 'c' : id.includes('n') ? 'b' : 't';
    const ocu = (d.k0.x0 + d.k0.x1) / 2, ocv = (d.k0.y0 + d.k0.y1) / 2;
    const maxW = hA === 'c' ? 2 * Math.min(ocu, 1 - ocu) : hA === 'r' ? d.k0.x1 : 1 - d.k0.x0;
    const maxH = vA === 'c' ? 2 * Math.min(ocv, 1 - ocv) : vA === 'b' ? d.k0.y1 : 1 - d.k0.y0;
    const t = Math.min(1, maxW / fw, maxH / fh); fw *= t; fh *= t;
    if (hA === 'c') { k.x0 = ocu - fw / 2; k.x1 = ocu + fw / 2; } else if (hA === 'r') { k.x1 = d.k0.x1; k.x0 = k.x1 - fw; } else { k.x0 = d.k0.x0; k.x1 = k.x0 + fw; }
    if (vA === 'c') { k.y0 = ocv - fh / 2; k.y1 = ocv + fh / 2; } else if (vA === 'b') { k.y1 = d.k0.y1; k.y0 = k.y1 - fh; } else { k.y0 = d.k0.y0; k.y1 = k.y0 + fh; }
  }
  l.crop = k;
}
/** Encoge el recorte actual (centrado) hasta la proporción pedida. */
export function conformCrop(l: LayerGeom, ratio: number | null) {
  if (!ratio) return;
  const [cu, cv] = cropMid(l);
  let cw = visW(l), ch = visH(l);
  if (cw / ch > ratio) cw = ch * ratio; else ch = cw / ratio;
  let fw = cw / l.w, fh = ch / l.h;
  const t = Math.min(1, (2 * Math.min(cu, 1 - cu)) / fw, (2 * Math.min(cv, 1 - cv)) / fh); fw *= t; fh *= t;
  l.crop = { x0: cu - fw / 2, x1: cu + fw / 2, y0: cv - fh / 2, y1: cv + fh / 2 };
}

/** Ajusta o llena el póster y, si scale < 1, lo reduce desde el centro (p. ej. la imagen de ejemplo al 94 %). */
export function applyFit(l: LayerGeom, fit: NonNullable<Fit>, g: Geo) {
  fitLayer(l, fit.mode, g);
  if (fit.scale !== 1) scaleLayer(l, fit.scale, cropCenter(l));
}

/**
 * Al cambiar papel, orientación, margen, solape u hojas:
 * - Imagen ajustada o llenada: se vuelve a ajustar al nuevo póster.
 * - Imagen colocada a mano: conserva su tamaño en cm (lo que se imprimirá) y el centro de su zona visible
 *   mantiene su posición relativa en el póster.
 * Las dos reglas son reversibles: volver a la distribución anterior deja la imagen exactamente igual.
 * (Antes se escalaba por min(sx, sy) en cada paso, y la imagen se encogía con cada ida y vuelta.)
 */
export function relayout(layers: (LayerGeom & { fit: Fit })[], prev: Geo, next: Geo) {
  if (prev.W === next.W && prev.H === next.H) return;
  const sx = next.W / prev.W, sy = next.H / prev.H;
  for (const l of layers) {
    if (l.fit) { applyFit(l, l.fit, next); continue; }
    const c = cropCenter(l);
    l.cx += c.x * (sx - 1);
    l.cy += c.y * (sy - 1);
  }
}

/* ---------- recorte con marco fijo ---------- */
/** El punto cae sobre la imagen completa (también la parte recortada, que se ve atenuada al recortar). */
export function insideImage(l: Transform, m: Pt) {
  const q = mmToLocal(l, m);
  return q.u >= 0 && q.u <= 1 && q.v >= 0 && q.v <= 1;
}

/**
 * Deja el recorte como un marco fijo en el póster (centro C, tamaño vw × vh mm) sobre la imagen en su posición
 * actual. Si la imagen ya no cubre el marco, la desplaza lo justo para que lo cubra: nunca quedan huecos.
 */
export function frameCrop(l: LayerGeom, C: Pt, vw: number, vh: number) {
  const fw = Math.min(1, vw / l.w), fh = Math.min(1, vh / l.h);
  const q = mmToLocal(l, C);
  const u = clamp(q.u, fw / 2, 1 - fw / 2), v = clamp(q.v, fh / 2, 1 - fh / 2);
  l.crop = { x0: u - fw / 2, x1: u + fw / 2, y0: v - fh / 2, y1: v + fh / 2 };
  placeLocal(l, u, v, C);
}

/** Desplaza la imagen d mm bajo el marco de recorte, que no se mueve. */
export function panInFrame(l: LayerGeom, start: LayerGeom, d: Pt) {
  const C = cropCenter(start), vw = visW(start), vh = visH(start);
  Object.assign(l, { cx: start.cx + d.x, cy: start.cy + d.y, w: start.w, h: start.h });
  frameCrop(l, C, vw, vh);
}

/**
 * Amplía (f > 1) o reduce la imagen dentro del marco de recorte, alrededor del punto P del póster.
 * El marco no cambia; la imagen nunca se reduce tanto que deje huecos, ni se amplía por debajo de un 2 % visible.
 */
export function zoomInFrame(l: LayerGeom, f: number, P: Pt) {
  const C = cropCenter(l), vw = visW(l), vh = visH(l);
  const cw = l.crop.x1 - l.crop.x0, ch = l.crop.y1 - l.crop.y0;
  const s = clamp(f, Math.max(cw, ch), Math.min(cw, ch) / 0.02);
  scaleLayer(l, s, P);
  frameCrop(l, C, vw, vh);
}

/* ---------- resolución ---------- */
/**
 * Resolución disponible para exportar: la del archivo original (no la del lienzo de trabajo), limitada a hiArea px.
 * SVG y PDF son vectoriales: se pueden rasterizar hasta hiArea.
 */
export function srcDims(l: LayerGeom & { src: Source | null }, hiArea: number) {
  const s = l.src, iw = l.img.width, ih = l.img.height;
  let w = iw, h = ih;
  if (s?.kind === 'svg' || s?.kind === 'pdf') { const a = iw / ih; w = Math.sqrt(hiArea * a); h = w / a; }
  else if (s?.kind === 'img' && s.w && s.h) { const f = Math.min(1, Math.sqrt(hiArea / (s.w * s.h))); w = s.w * f; h = s.h * f; }
  return { w: Math.max(w, iw), h: Math.max(h, ih) };
}
/** Puntos por pulgada de la imagen tal como está colocada. */
export function pppOf(l: LayerGeom & { src: Source | null }, hiArea: number) {
  const d = srcDims(l, hiArea);
  return Math.round(Math.min(d.w / (l.w / 25.4), d.h / (l.h / 25.4)));
}
export type Quality = 'good' | 'warn' | 'bad';
export const qualityOf = (ppp: number): Quality => (ppp >= 150 ? 'good' : ppp >= 100 ? 'warn' : 'bad');

/* ---------- impresión ---------- */
/** Largo de las marcas de corte: van en el margen pero terminan a 3 mm del borde del papel. */
export const markLen = (g: Geo) => Math.min(5, g.m - 0.8 - 3);
export const hasCutMarks = (g: Geo, marks: boolean) => marks && markLen(g) >= 1.2;

/* ---------- copias reducidas para la pantalla ---------- */
/** Tamaños fijos de la copia de pantalla: así no se rehace con cada paso de zoom. */
export const DISPLAY_STEPS = [256, 512, 768, 1024, 1536, 2048] as const;
/**
 * Lado largo (px) de la copia reducida con la que se dibuja una imagen en pantalla, o null si conviene usar
 * el lienzo de trabajo tal cual (la copia casi no ahorraría nada o haría falta más resolución de la que hay).
 * needPx: px que ocupa en pantalla el lado largo de la imagen completa; longPx: lado largo del lienzo de trabajo.
 */
export function displaySide(needPx: number, longPx: number): number | null {
  const side = DISPLAY_STEPS.find((s) => s >= needPx * 1.1);
  if (!side || side >= longPx * 0.85) return null;
  return side;
}

/* ---------- espejo ---------- */
/**
 * Espejo respecto a la PANTALLA (lo que ve el usuario), no a los ejes propios de la imagen.
 * Voltear en pantalla una imagen girada θ equivale a voltearla en sus ejes y cambiar el giro a −θ
 * (M·R(θ) = R(−θ)·M). Antes solo se volteaba en sus ejes: con un giro de ±90° el espejo horizontal
 * se veía vertical, y con otros ángulos salía en diagonal. El centro de la zona visible no se mueve.
 */
export function flipOnScreen(l: LayerGeom, axis: 'x' | 'y') {
  keepCenter(l, (x) => {
    if (axis === 'x') x.flipX = !x.flipX; else x.flipY = !x.flipY;
    x.rot = normDeg(-x.rot);
  });
}
