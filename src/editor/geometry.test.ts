import { describe, expect, it } from 'vitest';
import {
  applyCropDrag, applyFit, applyScale, bboxMM, conformCrop, cropCenter, cropPtsMM, fitLayer, geo, hasCutMarks, inside,
  isStretched, localToMM, markLen, mmToLocal, normDeg, panInFrame, pppOf, relayout, rotateLayer, srcDims, startScale,
  unstretch, visH, visW, zoomInFrame,
} from './geometry';
import type { Fit, LayerGeom, Settings, Source } from './types';

const settings = (o: Partial<Settings> = {}) =>
  ({ paper: 'A4', orient: 'portrait', cols: 2, rows: 2, margin: 6, overlap: 10, ...o }) as Settings;

/** Capa de prueba: imagen de 1000×500 px colocada a 200×100 mm centrada en (100, 50). */
const layer = (o: Partial<LayerGeom & { src: Source | null; fit: Fit }> = {}) => ({
  cx: 100, cy: 50, w: 200, h: 100, rot: 0, flipX: false, flipY: false,
  crop: { x0: 0, y0: 0, x1: 1, y1: 1 }, img: { width: 1000, height: 500 }, src: null as Source | null, fit: null as Fit, ...o,
});

const close = (a: number, b: number, d = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(d);

describe('geo', () => {
  it('calcula el póster 2×2 A4 vertical con solape', () => {
    const g = geo(settings());
    expect(g.tw).toBe(198); expect(g.th).toBe(285);
    expect(g.W).toBe(2 * 198 - 10); expect(g.H).toBe(2 * 285 - 10);
  });
  it('gira el papel en horizontal', () => {
    const g = geo(settings({ orient: 'landscape' }));
    expect(g.pw).toBe(297); expect(g.ph).toBe(210);
  });
  it('limita margen y solape a valores que no rompan la hoja', () => {
    const g = geo(settings({ margin: 500, overlap: 500 }));
    expect(g.m).toBe(210 / 4);
    expect(g.ov).toBeCloseTo(Math.min(g.tw, g.th) / 3);
  });
});

describe('ángulos', () => {
  it('normaliza a (-180, 180]', () => {
    expect(normDeg(190)).toBe(-170);
    expect(normDeg(-180)).toBe(180);
    expect(normDeg(540)).toBe(180);
    expect(normDeg(-90)).toBe(-90);
  });
});

describe('coordenadas locales', () => {
  it('ida y vuelta con giro y espejo', () => {
    const l = layer({ rot: 33, flipX: true, flipY: true });
    const p = localToMM(l, 0.2, 0.7), q = mmToLocal(l, p);
    close(q.u, 0.2); close(q.v, 0.7);
  });
  it('detecta si un punto cae dentro de la zona recortada', () => {
    const l = layer({ crop: { x0: 0.5, y0: 0, x1: 1, y1: 1 } });
    expect(inside(l, { x: 150, y: 50 })).toBe(true);
    expect(inside(l, { x: 50, y: 50 })).toBe(false);
  });
  it('girar 90° alrededor del centro intercambia ancho y alto de la caja', () => {
    const l = layer();
    rotateLayer(l, 90, cropCenter(l));
    const b = bboxMM(l);
    close(b.x1 - b.x0, 100); close(b.y1 - b.y0, 200);
  });
});

describe('ajustar y escalar', () => {
  it('ajusta (contain) dentro del póster y lo centra', () => {
    const g = geo(settings()), l = layer();
    fitLayer(l, 'contain', g);
    close(visW(l), g.W);
    expect(visH(l)).toBeLessThanOrEqual(g.H + 1e-6);
    const c = cropCenter(l); close(c.x, g.W / 2); close(c.y, g.H / 2);
  });
  it('llena (cover) el póster', () => {
    const g = geo(settings()), l = layer();
    fitLayer(l, 'cover', g);
    expect(visW(l)).toBeGreaterThanOrEqual(g.W - 1e-6);
    close(visH(l), g.H);
  });
  it('una esquina escala proporcional y deja fija la esquina opuesta', () => {
    const l = layer(), d = startScale(l, 'se'), nw = localToMM(l, 0, 0);
    applyScale(l, d, { x: 400, y: 200 }, false, false); // doble de tamaño
    close(l.w, 400); close(l.h, 200);
    const nw2 = localToMM(l, 0, 0); close(nw2.x, nw.x); close(nw2.y, nw.y);
  });
  it('un lado estira solo en su eje y queda deformada; "quitar deformación" lo corrige', () => {
    const l = layer(), d = startScale(l, 'e');
    applyScale(l, d, { x: 300, y: 50 }, false, false);
    close(l.w, 300); close(l.h, 100);
    expect(isStretched(l)).toBe(true);
    unstretch(l);
    expect(isStretched(l)).toBe(false);
  });
  it('no deja que la imagen baje de 3 mm visibles', () => {
    const l = layer(), d = startScale(l, 'se');
    applyScale(l, d, { x: -500, y: -500 }, false, false);
    expect(Math.min(visW(l), visH(l))).toBeGreaterThanOrEqual(3 - 1e-9);
  });
});

describe('recorte', () => {
  it('recorta desde el borde izquierdo', () => {
    const l = layer();
    applyCropDrag(l, { t: 'crop', id: 'w', k0: { ...l.crop }, ratio0: 2 }, { x: 50, y: 50 }, false, false, null);
    close(l.crop.x0, 0.25);
    expect(l.crop.x1).toBe(1);
  });
  it('respeta una proporción fija', () => {
    const l = layer();
    applyCropDrag(l, { t: 'crop', id: 'se', k0: { ...l.crop }, ratio0: 2 }, { x: 150, y: 80 }, false, false, 1);
    close(visW(l) / visH(l), 1, 1e-9);
  });
  it('conformCrop encoge al centro hasta la proporción', () => {
    const l = layer();
    conformCrop(l, 1);
    close(visW(l), 100); close(visH(l), 100);
    close((l.crop.x0 + l.crop.x1) / 2, 0.5);
  });
});

describe('cambio de distribución (relayout)', () => {
  /** Aplica una secuencia de distribuciones y devuelve la capa. */
  const run = (l: ReturnType<typeof layer>, seq: Partial<Settings>[]) => {
    let prev = geo(settings(seq[0]));
    for (const s of seq.slice(1)) { const next = geo(settings(s)); relayout([l], prev, next); prev = next; }
    return l;
  };
  const snapshot = (l: ReturnType<typeof layer>) => ({ cx: l.cx, cy: l.cy, w: l.w, h: l.h });
  const same = (a: ReturnType<typeof snapshot>, b: ReturnType<typeof snapshot>) => {
    close(a.cx, b.cx, 1e-6); close(a.cy, b.cy, 1e-6); close(a.w, b.w, 1e-6); close(a.h, b.h, 1e-6);
  };

  // regresión: antes cada ida y vuelta Vertical → Horizontal → Vertical dejaba la imagen al 47,5 %
  it.each([
    ['orientación', [{}, { orient: 'landscape' }, {}, { orient: 'landscape' }, {}]],
    ['margen', [{ margin: 6 }, { margin: 10 }, { margin: 15 }, { margin: 3 }, { margin: 6 }]],
    ['solape', [{ overlap: 10 }, { overlap: 30 }, { overlap: 0 }, { overlap: 10 }]],
    ['papel', [{}, { paper: 'A3' }, { paper: 'Carta' }, {}]],
    ['filas y columnas', [{}, { rows: 3 }, { cols: 4, rows: 1 }, {}]],
  ] as [string, Partial<Settings>[]][])('ida y vuelta de %s deja la imagen igual (colocada a mano y ajustada)', (_, seq) => {
    const manual = layer({ cx: 140, cy: 220 });
    const before = snapshot(manual);
    same(snapshot(run(manual, seq)), before);

    const g0 = geo(settings(seq[0])), fitted = layer({ fit: { mode: 'contain', scale: 1 } });
    applyFit(fitted, fitted.fit!, g0);
    const fb = snapshot(fitted);
    same(snapshot(run(fitted, seq)), fb);
  });

  it('una imagen colocada a mano conserva su tamaño en cm', () => {
    const l = run(layer(), [{}, { orient: 'landscape' }]);
    expect(l.w).toBe(200); expect(l.h).toBe(100);
  });
  it('una imagen ajustada se vuelve a ajustar al nuevo póster', () => {
    const g = geo(settings({ orient: 'landscape' })), l = layer({ fit: { mode: 'contain', scale: 1 } });
    applyFit(l, l.fit!, geo(settings()));
    run(l, [{}, { orient: 'landscape' }]);
    expect(Math.abs(visW(l) - g.W) < 1e-6 || Math.abs(visH(l) - g.H) < 1e-6).toBe(true);
    const c = cropCenter(l); close(c.x, g.W / 2); close(c.y, g.H / 2);
  });
  it('respeta la escala del ajuste (imagen de ejemplo al 94 %)', () => {
    const g = geo(settings()), l = layer({ fit: { mode: 'contain', scale: 0.94 } });
    applyFit(l, l.fit!, g);
    close(visW(l), g.W * 0.94);
  });
});

describe('recorte con marco fijo', () => {
  const framed = () => layer({ crop: { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 } });
  const frameOf = (l: ReturnType<typeof layer>) => cropPtsMM(l);

  it('arrastrar mueve la imagen y el marco queda en el mismo sitio del póster', () => {
    const l = framed(), before = frameOf(l), start = { ...l, crop: { ...l.crop } };
    panInFrame(l, start, { x: 20, y: 10 });
    frameOf(l).forEach((p, i) => { close(p.x, before[i]!.x); close(p.y, before[i]!.y); });
    close(l.cx, 120); close(l.cy, 60);               // la imagen siguió al cursor
    close(l.crop.x0, 0.25 - 20 / 200); close(l.crop.y0, 0.25 - 10 / 100); // y se ve otra zona
  });
  it('la imagen no puede dejar huecos dentro del marco', () => {
    const l = framed(), before = frameOf(l), start = { ...l, crop: { ...l.crop } };
    panInFrame(l, start, { x: 500, y: -500 });
    expect(l.crop.x0).toBeGreaterThanOrEqual(-1e-9); expect(l.crop.y1).toBeLessThanOrEqual(1 + 1e-9);
    frameOf(l).forEach((p, i) => { close(p.x, before[i]!.x); close(p.y, before[i]!.y); });
  });
  it('funciona con la imagen girada y en espejo', () => {
    const l = layer({ rot: 30, flipX: true, crop: { x0: 0.25, y0: 0.25, x1: 0.75, y1: 0.75 } });
    const before = frameOf(l), start = { ...l, crop: { ...l.crop } };
    panInFrame(l, start, { x: 15, y: -5 });
    frameOf(l).forEach((p, i) => { close(p.x, before[i]!.x); close(p.y, before[i]!.y); });
  });
  it('ampliar dentro del marco no cambia el marco', () => {
    const l = framed(), before = frameOf(l);
    zoomInFrame(l, 2, cropCenter(l));
    close(l.w, 400);
    frameOf(l).forEach((p, i) => { close(p.x, before[i]!.x); close(p.y, before[i]!.y); });
  });
  it('reducir se detiene cuando la imagen llena justo el marco', () => {
    const l = framed();
    zoomInFrame(l, 0.1, cropCenter(l));
    close(l.w, 100); close(l.h, 50);                 // el recorte ocupa ahora toda la imagen
    close(l.crop.x1 - l.crop.x0, 1); close(l.crop.y1 - l.crop.y0, 1);
  });
});

describe('resolución', () => {
  it('usa la resolución del archivo original, no la del lienzo de trabajo', () => {
    // foto de 6000×3000 px reducida a 1000×500 para trabajar, colocada a 200 mm de ancho
    const l = layer({ src: { kind: 'img', blob: {} as Blob, w: 6000, h: 3000 } });
    expect(pppOf(l, 36e6)).toBe(Math.round(6000 / (200 / 25.4)));
    expect(pppOf(layer(), 36e6)).toBe(Math.round(1000 / (200 / 25.4)));
  });
  it('limita la resolución al área máxima de exportación', () => {
    const l = layer({ src: { kind: 'img', blob: {} as Blob, w: 20000, h: 10000 } });
    const d = srcDims(l, 8e6);
    close(d.w * d.h, 8e6, 1);
  });
  it('trata PDF y SVG como vectoriales (hasta el área máxima)', () => {
    const d = srcDims(layer({ src: { kind: 'pdf', blob: {} as Blob } }), 8e6);
    close(d.w * d.h, 8e6, 1); close(d.w / d.h, 2);
  });
});

describe('marcas de corte', () => {
  it('terminan a 3 mm del borde y desaparecen con márgenes pequeños', () => {
    const g6 = geo(settings({ margin: 6 })), g4 = geo(settings({ margin: 4 }));
    close(markLen(g6), 6 - 0.8 - 3);
    expect(hasCutMarks(g6, true)).toBe(true);
    expect(hasCutMarks(g4, true)).toBe(false);
    expect(hasCutMarks(g6, false)).toBe(false);
  });
});
