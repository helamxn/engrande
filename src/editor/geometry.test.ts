import { describe, expect, it } from 'vitest';
import {
  applyCropDrag, applyScale, bboxMM, conformCrop, cropCenter, fitLayer, geo, hasCutMarks, inside, isStretched, localToMM,
  markLen, mmToLocal, normDeg, pppOf, rescaleForLayout, rotateLayer, srcDims, startScale, unstretch, visH, visW,
} from './geometry';
import type { LayerGeom, Settings, Source } from './types';

const settings = (o: Partial<Settings> = {}) =>
  ({ paper: 'A4', orient: 'portrait', cols: 2, rows: 2, margin: 6, overlap: 10, ...o }) as Settings;

/** Capa de prueba: imagen de 1000×500 px colocada a 200×100 mm centrada en (100, 50). */
const layer = (o: Partial<LayerGeom & { src: Source | null }> = {}) => ({
  cx: 100, cy: 50, w: 200, h: 100, rot: 0, flipX: false, flipY: false,
  crop: { x0: 0, y0: 0, x1: 1, y1: 1 }, img: { width: 1000, height: 500 }, src: null as Source | null, ...o,
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

describe('cambio de distribución', () => {
  it('añadir una fila o una columna no cambia el tamaño de la imagen (se comportan igual)', () => {
    const a = geo(settings()), rows = geo(settings({ rows: 3 })), cols = geo(settings({ cols: 3 }));
    const l1 = layer(), l2 = layer();
    rescaleForLayout([l1], a, rows);
    rescaleForLayout([l2], a, cols);
    expect(l1.w).toBe(200); expect(l2.w).toBe(200);
  });
  it('pasar de A4 a A3 escala la imagen en proporción', () => {
    const a = geo(settings()), b = geo(settings({ paper: 'A3' })), l = layer();
    rescaleForLayout([l], a, b);
    close(l.w / l.h, 2);
    expect(l.w).toBeGreaterThan(200);
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
    const d = srcDims(layer({ src: { kind: 'pdf' } }), 8e6);
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
