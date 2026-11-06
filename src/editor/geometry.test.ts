import { describe, expect, it } from 'vitest';
import {
  alignShifts, alignedLines, applyCropDrag, equalSpacing, guideSegments, measureBetween, nearestBox, gridLevels, snapBox, snapEdges, snapSize, snapTargets, applyFit, boxInside, distributeShifts, unionBox, applyScale, bboxMM, conformCrop, cropCenter, cropPtsMM, fitLayer, geo, hasCutMarks, inside,
  displaySide, flipOnScreen, isStretched, localToMM, markLen, mmToLocal, newLayoutMemory, normDeg, panInFrame, pppOf, relayout,
  rotateLayer, solvePointer, srcDims, startScale, stepToLines, gridStep, onGrid, toGrid, type RelayoutMode,
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
  it('ir y venir entre proporciones no encoge el recorte (se parte siempre del marco de referencia)', () => {
    const l = layer(), ref = { w: visW(l), h: visH(l) };
    conformCrop(l, 16 / 9, ref);
    const first = [visW(l), visH(l)];
    for (let i = 0; i < 5; i++) { conformCrop(l, 3 / 4, ref); conformCrop(l, 16 / 9, ref); }
    close(visW(l), first[0]!); close(visH(l), first[1]!);
    // «Libre» devuelve el marco de referencia entero
    conformCrop(l, null, ref);
    close(visW(l), 200); close(visH(l), 100);
  });
  it('cerca del borde de la imagen, el marco se desplaza para caber en vez de encogerse', () => {
    const l = layer({ crop: { x0: 0.7, y0: 0, x1: 1, y1: 1 } }); // marco de 60 × 100 mm pegado a la derecha
    conformCrop(l, 1, { w: 100, h: 100 });
    close(visW(l), 100); close(visH(l), 100);
    expect(l.crop.x1).toBeLessThanOrEqual(1 + 1e-9);
    expect(l.crop.x0).toBeGreaterThanOrEqual(-1e-9);
  });
});

describe('cambio de distribución (relayout)', () => {
  /** Aplica una secuencia de distribuciones y devuelve la capa. */
  const run = (l: ReturnType<typeof layer>, seq: Partial<Settings>[], mode: RelayoutMode = 'scale', mem = newLayoutMemory()) => {
    let prev = geo(settings(seq[0]));
    for (const s of seq.slice(1)) { const next = geo(settings(s)); relayout([l], prev, next, mode, mem); prev = next; }
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

  it.each([['escalar', 'scale'], ['mantener', 'keep']] as const)('ida y vuelta también en modo %s', (_, mode) => {
    const l = layer({ cx: 140, cy: 220 }), before = snapshot(l);
    same(snapshot(run(l, [{}, { cols: 4, rows: 4 }, { cols: 1, rows: 1 }, {}], mode)), before);
  });
  it('escalar: el diseño crece con el póster y queda centrado', () => {
    const g0 = geo(settings({ cols: 2, rows: 2 })), g1 = geo(settings({ cols: 4, rows: 4 }));
    const l = layer({ cx: g0.W / 2 + 30, cy: g0.H / 2 - 20 });
    relayout([l], g0, g1, 'scale', newLayoutMemory());
    const k = Math.min(g1.W / g0.W, g1.H / g0.H);
    close(l.w, 200 * k, 1e-6); close(l.h, 100 * k, 1e-6);
    close(l.cx, g1.W / 2 + 30 * k, 1e-6); close(l.cy, g1.H / 2 - 20 * k, 1e-6);
  });
  it('escalar: dos imágenes no se amontonan al reducir el póster (la distancia entre ellas se escala igual)', () => {
    const g0 = geo(settings({ cols: 4, rows: 4 })), g1 = geo(settings({ cols: 1, rows: 1 }));
    const a = layer({ cx: 200, cy: 200 }), b = layer({ cx: 200, cy: 600 });
    relayout([a, b], g0, g1, 'scale', newLayoutMemory());
    const k = Math.min(g1.W / g0.W, g1.H / g0.H);
    close(b.cy - a.cy, 400 * k, 1e-6);
    close(a.h, 100 * k, 1e-6);
  });
  it('mantener: conserva el tamaño en cm y la posición desde la esquina', () => {
    const l = run(layer({ cx: 140, cy: 220 }), [{}, { orient: 'landscape' }], 'keep');
    expect([l.cx, l.cy, l.w, l.h]).toEqual([140, 220, 200, 100]);
  });
  it('mover en formatos de otra proporción no encoge el diseño (1×1 → 4×4 → 3×2 → 1×1, A3 horizontal)', () => {
    const mem = newLayoutMemory(), base = { paper: 'A3', orient: 'landscape' } as const;
    const g11 = geo(settings({ ...base, cols: 1, rows: 1 })), g44 = geo(settings({ ...base, cols: 4, rows: 4 }));
    const g32 = geo(settings({ ...base, cols: 3, rows: 2 }));
    const l = layer({ cx: 150, cy: 100 });
    relayout([l], g11, g44, 'scale', mem);
    l.cx += 80; // mueve en 4×4
    relayout([l], g44, g32, 'scale', mem);
    l.cy += 40; // mueve en 3×2
    relayout([l], g32, g11, 'scale', mem);
    close(l.w, 200, 1e-6); close(l.h, 100, 1e-6); // mismo tamaño que al empezar
    const k44 = Math.min(g44.W / g11.W, g44.H / g11.H), k32 = Math.min(g32.W / g11.W, g32.H / g11.H);
    close(l.cx, 150 + 80 / k44, 1e-6); close(l.cy, 100 + 40 / k32, 1e-6); // y desplazada lo que se movió, en proporción
  });
  it('una imagen agregada en otra distribución entra en el mismo diseño', () => {
    const mem = newLayoutMemory(), g0 = geo(settings()), g1 = geo(settings({ cols: 4, rows: 4 }));
    const a = layer({ cx: 100, cy: 100 });
    relayout([a], g0, g1, 'scale', mem);
    const b = layer({ cx: a.cx, cy: a.cy, w: a.w, h: a.h }); // una copia agregada en 4×4
    relayout([a, b], g1, g0, 'scale', mem);
    same(snapshot(b), snapshot(a));
  });
  it('si se edita la imagen entre cambios, al volver queda donde se dejó', () => {
    const mem = newLayoutMemory(), l = layer({ cx: 140, cy: 220 });
    const g0 = geo(settings()), g1 = geo(settings({ cols: 4, rows: 4 }));
    relayout([l], g0, g1, 'scale', mem);
    l.cx += 50; // el usuario la mueve en el póster grande
    const moved = snapshot(l);
    relayout([l], g1, g0, 'scale', mem);
    relayout([l], g0, g1, 'scale', mem);
    same(snapshot(l), moved); // vuelve a donde la dejó, no a donde estaba antes de moverla
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

describe('copia reducida para la pantalla (displaySide)', () => {
  it('elige el tamaño fijo inmediatamente superior a lo que se ve, con un 10 % de margen', () => {
    expect(displaySide(400, 2400)).toBe(512);
    expect(displaySide(470, 2400)).toBe(768);
    expect(displaySide(900, 2400)).toBe(1024);
  });
  it('usa el lienzo de trabajo si la copia casi no ahorraría nada o haría falta más resolución', () => {
    expect(displaySide(1500, 1800)).toBeNull(); // 1536 ≥ 85 % de 1800
    expect(displaySide(2500, 2400)).toBeNull(); // con mucho zoom se ve la resolución completa
    expect(displaySide(100, 200)).toBeNull();   // imagen pequeña
  });
});

describe('espejo respecto a la pantalla (flipOnScreen)', () => {
  // con cualquier giro, el espejo horizontal invierte izquierda/derecha en pantalla alrededor del centro visible
  it.each([0, 90, -90, 30, -135])('espejo horizontal con giro de %i°', (rot) => {
    const l = layer({ rot, crop: { x0: 0.1, y0: 0.2, x1: 0.8, y1: 0.9 } });
    const c = cropCenter(l), before = [[0.15, 0.25], [0.7, 0.4], [0.5, 0.85]].map(([u, v]) => localToMM(l, u!, v!));
    flipOnScreen(l, 'x');
    const after = [[0.15, 0.25], [0.7, 0.4], [0.5, 0.85]].map(([u, v]) => localToMM(l, u!, v!));
    after.forEach((p, i) => { close(p.x, 2 * c.x - before[i]!.x); close(p.y, before[i]!.y); });
  });
  it.each([0, 90, -90, 30])('espejo vertical con giro de %i°', (rot) => {
    const l = layer({ rot });
    const c = cropCenter(l), before = localToMM(l, 0.9, 0.1);
    flipOnScreen(l, 'y');
    const after = localToMM(l, 0.9, 0.1);
    close(after.x, before.x); close(after.y, 2 * c.y - before.y);
  });
  it('dos espejos seguidos dejan la imagen como estaba', () => {
    const l = layer({ rot: -90 }), before = { ...l };
    flipOnScreen(l, 'x'); flipOnScreen(l, 'x');
    close(l.cx, before.cx); close(l.cy, before.cy); close(l.rot, before.rot);
    expect(l.flipX).toBe(false);
  });
});

describe('alinear y distribuir varias imágenes', () => {
  const B = (x0: number, y0: number, x1: number, y1: number) => ({ x0, y0, x1, y1 });
  const apply = (bs: ReturnType<typeof B>[], ds: { x: number; y: number }[]) =>
    bs.map((b, i) => B(b.x0 + ds[i]!.x, b.y0 + ds[i]!.y, b.x1 + ds[i]!.x, b.y1 + ds[i]!.y));
  const boxes = [B(10, 10, 30, 20), B(50, 40, 60, 80), B(100, 0, 140, 10)];

  it('caja común y contención', () => {
    expect(unionBox(boxes)).toEqual(B(10, 0, 140, 80));
    expect(boxInside(B(12, 12, 20, 18), boxes[0]!)).toBe(true);
    expect(boxInside(B(5, 12, 20, 18), boxes[0]!)).toBe(false);
  });

  it('alinea bordes y centros con la caja común', () => {
    expect(apply(boxes, alignShifts(boxes, 'left')).map((b) => b.x0)).toEqual([10, 10, 10]);
    expect(apply(boxes, alignShifts(boxes, 'right')).map((b) => b.x1)).toEqual([140, 140, 140]);
    expect(apply(boxes, alignShifts(boxes, 'bottom')).map((b) => b.y1)).toEqual([80, 80, 80]);
    expect(apply(boxes, alignShifts(boxes, 'vcenter')).map((b) => (b.y0 + b.y1) / 2)).toEqual([40, 40, 40]);
    // alinear en horizontal no mueve en vertical
    expect(alignShifts(boxes, 'hcenter').every((d) => d.y === 0)).toBe(true);
  });

  it('alinea con otra caja de referencia (el póster)', () => {
    const r = apply([boxes[0]!], alignShifts([boxes[0]!], 'hcenter', B(0, 0, 200, 100)))[0]!;
    expect((r.x0 + r.x1) / 2).toBe(100);
  });

  it('distribuye con el mismo espacio y deja quietas la primera y la última', () => {
    const out = apply(boxes, distributeShifts(boxes, 'x'));
    expect(out[0]).toEqual(boxes[0]);
    expect(out[2]).toEqual(boxes[2]);
    expect(out[1]!.x0 - out[0]!.x1).toBeCloseTo(out[2]!.x0 - out[1]!.x1, 9);
    expect(distributeShifts(boxes, 'y').every((d) => d.x === 0)).toBe(true);
  });

  it('distribuye según la posición, no el orden de la lista', () => {
    const shuffled = [boxes[2]!, boxes[0]!, boxes[1]!];
    const out = apply(shuffled, distributeShifts(shuffled, 'x'));
    expect(out[2]!.x0 - out[1]!.x1).toBeCloseTo(out[0]!.x0 - out[2]!.x1, 9);
  });

  it('con menos de tres no reparte nada', () => {
    expect(distributeShifts(boxes.slice(0, 2), 'x')).toEqual([{ x: 0, y: 0 }, { x: 0, y: 0 }]);
  });
});

describe('rejilla del fondo (gridLevels)', () => {
  it('a escala normal se ven 1 cm, 5 cm y 10 cm, más marcadas las gruesas', () => {
    const g = gridLevels(2); // 2 px por mm: 1 cm = 20 px
    expect(g.map((x) => x.step).slice(0, 3)).toEqual([10, 50, 100]);
    expect(g[0]!.alpha).toBeLessThan(g[1]!.alpha);
  });
  it('al alejar, la línea de 1 cm desaparece y quedan las gruesas', () => {
    expect(gridLevels(0.5).some((x) => x.step === 10)).toBe(false);
    expect(gridLevels(0.5)[0]!.step).toBe(50);
  });
  it('la opacidad cambia de forma continua con el zoom (sin saltos)', () => {
    let prev = gridLevels(0.6).find((x) => x.step === 10)?.alpha ?? 0;
    for (let k = 0.61; k < 4; k += 0.01) {
      const a = gridLevels(k).find((x) => x.step === 10)?.alpha ?? 0;
      expect(Math.abs(a - prev)).toBeLessThan(0.05);
      prev = a;
    }
  });
});

describe('imanes al mover (snapBox)', () => {
  const t = snapTargets(400, 300, [{ x0: 100, y0: 50, x1: 150, y1: 90 }]);
  it('pega el borde izquierdo al borde del póster si está cerca', () => {
    const r = snapBox({ x0: 3, y0: 200, x1: 53, y1: 240 }, t, 5);
    expect(r.dx).toBe(-3); expect(r.gx).toBe(0);
  });
  it('pega el centro al centro del póster', () => {
    const r = snapBox({ x0: 176, y0: 10, x1: 226, y1: 30 }, t, 5); // centro x = 201
    expect(r.dx).toBe(-1); expect(r.gx).toBe(200);
  });
  it('pega a los bordes y al centro de otra imagen, en cada eje por separado', () => {
    const r = snapBox({ x0: 152, y0: 88, x1: 172, y1: 108 }, t, 5); // x0 cerca de 150, y0 cerca de 90
    expect(r.dx).toBe(-2); expect(r.gx).toBe(150);
    expect(r.dy).toBe(2); expect(r.gy).toBe(90);
  });
  it('lejos de todo no se mueve ni hay guía', () => {
    const r = snapBox({ x0: 30, y0: 120, x1: 60, y1: 130 }, t, 2);
    expect(r).toEqual({ dx: 0, dy: 0, gx: null, gy: null });
  });
});

describe('guías como tramos (guideSegments)', () => {
  it('une solo las cajas alineadas y marca sus extremos', () => {
    const moving = { x0: 10, y0: 100, x1: 50, y1: 140 };
    const other = { x0: 10, y0: 20, x1: 30, y1: 60 }, far = { x0: 200, y0: 0, x1: 220, y1: 300 };
    const [g] = guideSegments(moving, [other, far], 10, null);
    expect(g).toEqual({ axis: 'x', at: 10, from: 20, to: 140, marks: [100, 140, 20, 60] });
  });
  it('alineado al centro de otra caja también cuenta', () => {
    const [g] = guideSegments({ x0: 0, y0: 50, x1: 20, y1: 60 }, [{ x0: 100, y0: 40, x1: 140, y1: 70 }], null, 55);
    expect(g!.from).toBe(0); expect(g!.to).toBe(140);
  });
});

describe('medir con Alt (measureBetween)', () => {
  it('dos cajas una encima de otra: la separación vertical, sin proyección', () => {
    const r = measureBetween({ x0: 0, y0: 0, x1: 100, y1: 40 }, { x0: 10, y0: 58, x1: 110, y1: 98 });
    const v = r.gaps.find((g) => g.axis === 'y')!;
    expect([v.from, v.to]).toEqual([40, 58]);
    expect(r.dashes).toHaveLength(0);
  });
  it('en diagonal: medida y línea discontinua de proyección', () => {
    const r = measureBetween({ x0: 0, y0: 0, x1: 50, y1: 50 }, { x0: 80, y0: 90, x1: 120, y1: 130 });
    expect(r.gaps.find((g) => g.axis === 'x')).toMatchObject({ from: 50, to: 80, at: 25 });
    expect(r.dashes.length).toBe(2);
  });
  it('dos imágenes que se cruzan: solo el lado en que lo seleccionado queda dentro (como en Figma)', () => {
    const t = { x0: 20, y0: 0, x1: 120, y1: 40 };
    const xs = (s: { x0: number; x1: number }) => measureBetween({ ...s, y0: 60, y1: 100 }, t).gaps.filter((g) => g.axis === 'x').map((g) => [g.from, g.to]);
    expect(xs({ x0: 31, x1: 131 })).toEqual([[20, 31]]); // a la derecha: se mide el borde izquierdo
    expect(xs({ x0: 14, x1: 114 })).toEqual([[114, 120]]); // al cruzar a la izquierda, salta al derecho
    expect(xs({ x0: 30, x1: 100 })).toEqual([[20, 30], [100, 120]]); // dentro: los dos lados
  });
  it('contra el póster, aunque se salga: los dos lados, sin signo (como el marco en Figma)', () => {
    const r = measureBetween({ x0: -2, y0: 20, x1: 100, y1: 60 }, { x0: 0, y0: 0, x1: 400, y1: 300 }, true);
    expect(r.gaps.filter((g) => g.axis === 'x').map((g) => g.to - g.from)).toEqual([2, 300]);
  });
  it('dentro del póster: distancia a los cuatro bordes', () => {
    const r = measureBetween({ x0: 14, y0: 20, x1: 386, y1: 100 }, { x0: 0, y0: 0, x1: 400, y1: 300 });
    expect(r.gaps.map((g) => g.to - g.from)).toEqual([14, 14, 20, 200]);
  });
});

describe('separación igual (equalSpacing)', () => {
  const a = { x0: 0, y0: 0, x1: 40, y1: 30 }, b = { x0: 60, y0: 0, x1: 100, y1: 30 }; // hueco de referencia 20
  it('pega a la misma separación que hay entre otras dos imágenes de la fila', () => {
    const moving = { x0: 118, y0: 0, x1: 150, y1: 30 }; // hueco con b: 18
    const r = equalSpacing(moving, [a, b], 'x', 5)!;
    expect(r.d).toBe(2);
    expect(r.gaps.map((g) => g.to - g.from)).toEqual([20, 20]);
  });
  it('centra entre dos vecinas si queda cerca', () => {
    const moving = { x0: 47, y0: 0, x1: 53, y1: 30 }; // entre a (x1 40) y b (x0 60): centro 50
    const r = equalSpacing(moving, [a, b], 'x', 3)!;
    expect(r.d).toBe(0); // ya está centrada
    expect(r.gaps.map((g) => g.to - g.from)).toEqual([7, 7]);
  });
  it('funciona en vertical', () => {
    const c = { x0: 0, y0: 0, x1: 30, y1: 40 }, d = { x0: 0, y0: 60, x1: 30, y1: 100 };
    const r = equalSpacing({ x0: 0, y0: 121, x1: 30, y1: 150 }, [c, d], 'y', 5)!;
    expect(r.d).toBe(-1);
    expect(r.gaps.every((g) => g.axis === 'y')).toBe(true);
  });
  it('lejos de cualquier separación igual, nada', () => {
    expect(equalSpacing({ x0: 150, y0: 0, x1: 180, y1: 30 }, [a, b], 'x', 3)).toBeNull();
  });
});

describe('imán de bordes sueltos (snapEdges)', () => {
  it('pega solo los bordes que se mueven', () => {
    const t = snapTargets(400, 300, []); // x: 0, 200, 400 · y: 0, 150, 300
    const r = snapEdges({ x0: 3, y0: 100, x1: 197, y1: 148 }, { x0: false, x1: true, y0: false, y1: true }, t, 5);
    expect(r.x).toEqual({ d: 3, g: 200 }); // el borde derecho, no el izquierdo (que también está cerca de 0)
    expect(r.y).toEqual({ d: 2, g: 150 });
  });
});

describe('la caja más cercana para medir (nearestBox)', () => {
  const b = { x0: 100, y0: 100, x1: 150, y1: 140 };
  it('prefiere una que queda enfrente aunque otra en diagonal esté algo más cerca', () => {
    const facing = { x0: 200, y0: 110, x1: 240, y1: 130 }; // a 50 a la derecha
    const diag = { x0: 160, y0: 150, x1: 180, y1: 170 }; // en diagonal, a ~14
    expect(nearestBox(b, [diag, facing])).toBe(facing);
  });
  it('sin ninguna enfrente, la más cercana', () => {
    const d1 = { x0: 160, y0: 150, x1: 180, y1: 170 }, d2 = { x0: 300, y0: 300, x1: 310, y1: 310 };
    expect(nearestBox(b, [d2, d1])).toBe(d1);
  });
  it('sin otras, ninguna', () => { expect(nearestBox(b, [])).toBeNull(); });
});

describe('imán de tamaño (snapSize)', () => {
  const other = { x0: 200, y0: 0, x1: 260, y1: 45 }; // 60 × 45
  it('iguala el ancho de otra imagen si queda cerca', () => {
    const r = snapSize({ x0: 0, y0: 0, x1: 58, y1: 30 }, { x0: false, x1: true, y0: false, y1: false }, [other], 4);
    expect(r.x).toEqual({ d: 2, box: other });
    expect(r.y).toBeNull(); // el alto no se está cambiando
  });
  it('iguala el alto', () => {
    const r = snapSize({ x0: 0, y0: 0, x1: 30, y1: 47 }, { x0: false, x1: false, y0: false, y1: true }, [other], 4);
    expect(r.y).toEqual({ d: -2, box: other });
  });
  it('lejos de cualquier tamaño, nada', () => {
    const r = snapSize({ x0: 0, y0: 0, x1: 30, y1: 30 }, { x0: false, x1: true, y0: false, y1: true }, [other], 4);
    expect(r).toEqual({ x: null, y: null });
  });
});

describe('imán al escalar desde una esquina (solvePointer)', () => {
  // read: aplica el gesto con el puntero en m y devuelve el borde que se quiere pegar
  type K = 'x0' | 'x1' | 'y0' | 'y1';
  const edgeOf = (id: 'nw' | 'ne' | 'se' | 'sw', alt: boolean, axis: 'x' | 'y', rot = 0, k?: K) => {
    const l = layer({ rot }), d = startScale(l, id);
    const key: K = k ?? (axis === 'x' ? (id.includes('w') ? 'x0' : 'x1') : id.includes('n') ? 'y0' : 'y1');
    const read = (m: { x: number; y: number }) => { applyScale(l, d, m, false, alt); return bboxMM(l)[key]; };
    return { l, read };
  };
  for (const id of ['nw', 'ne', 'se', 'sw'] as const) {
    for (const alt of [false, true]) {
      it(`${id}${alt ? ' con Alt' : ''}: el borde queda justo sobre la guía (sin deformar)`, () => {
        const { l, read } = edgeOf(id, alt, 'x');
        const handle = localToMM(l, id.includes('w') ? 0 : 1, id.includes('n') ? 0 : 1);
        const m = { x: handle.x + (id.includes('w') ? -20 : 20), y: handle.y + (id.includes('n') ? -5 : 5) };
        const v0 = read(m), goal = v0 + 3; // una guía a 3 mm del borde
        // mover el puntero solo 3 mm no basta: desde una esquina el borde sigue la diagonal
        expect(Math.abs(read({ x: m.x + 3, y: m.y }) - goal)).toBeGreaterThan(0.1);
        const p = solvePointer(m, 'x', read, goal, 3)!;
        expect(p).not.toBeNull();
        close(read(p), goal);
        close(l.w / l.h, 2); // sigue sin deformar
      });
    }
  }
  it('también en y, y con la imagen girada 180°', () => {
    const { read } = edgeOf('se', false, 'y', 180, 'y0'); // girada, la esquina «se» queda arriba a la izquierda
    const m = { x: -10, y: -10 }, goal = read(m) - 4;
    close(read(solvePointer(m, 'y', read, goal, -4)!), goal);
  });
  it('si el tamaño mínimo lo impide, no hay imán', () => {
    const { read } = edgeOf('se', false, 'x');
    expect(solvePointer({ x: 10, y: 10 }, 'x', read, -500, -500)).toBeNull();
  });
});

describe('guías sin dudas al mover (como en Figma)', () => {
  // otra imagen de 120 × 60 arriba; la que se mueve, del mismo ancho, debajo y casi alineada
  const other = { x0: 20, y0: 10, x1: 140, y1: 70 };
  const t = snapTargets(386, 285, [other]);
  const moving = (dx: number) => ({ x0: 20 + dx, y0: 100, x1: 140 + dx, y1: 160 });
  it('con el mismo ancho se pega y salen las tres guías: izquierda, centro y derecha', () => {
    for (const dx of [1.5, -1.5, 1.5 + 1e-13, 1.5 - 1e-13]) {
      const r = snapBox(moving(dx), t, 4);
      expect(r.dx).toBeCloseTo(-dx, 9);
      expect(alignedLines(moving(dx + r.dx), [other], 'x')).toHaveLength(3);
    }
  });
  it('en un empate gana el ajuste que alinea más, aunque los decimales digan otra cosa', () => {
    // otra imagen estrecha con el borde izquierdo a la misma distancia, al otro lado (y más cerca por decimales)
    const narrow = { x0: 21 + 1e-12, y0: 200, x1: 30, y1: 220 };
    const r = snapBox(moving(0.5 + 1e-12), snapTargets(386, 285, [narrow, other]), 4);
    expect(r.dx).toBeCloseTo(-0.5, 9); // alinea los tres con other en vez de solo el izquierdo con narrow
  });
  it('a igual distancia, una imagen gana al póster', () => {
    // centro del póster en x = 193; el borde derecho (192) queda a 1 de él y a 1 del de una imagen (191)
    const img = { x0: 150, y0: 200, x1: 191, y1: 240 };
    const r = snapBox({ x0: 172, y0: 100, x1: 192, y1: 110 }, snapTargets(386, 285, [img]), 3);
    expect(r.gx).toBe(191);
    expect(r.dx).toBe(-1);
  });
  it('las guías juntan todas las líneas que coinciden', () => {
    const b = moving(0), segs = guideSegments(b, [other], alignedLines(b, [other], 'x'), null);
    expect(segs.map((g) => g.at)).toEqual([20, 80, 140]);
    for (const g of segs) { expect(g.from).toBe(10); expect(g.to).toBe(160); }
  });
});

describe('flechas que paran en las líneas (stepToLines)', () => {
  // póster de 400 × 300 y otra imagen con el borde izquierdo en 150
  const t = snapTargets(400, 300, [{ x0: 150, y0: 200, x1: 250, y1: 260 }]);
  it('desde 0,8 mm del borde del póster, un paso de 1 mm se para en 0', () => {
    expect(stepToLines({ x0: 0.8, y0: 10, x1: 40.8, y1: 50 }, t, 'x', -1)).toBeCloseTo(-0.8, 9);
  });
  it('ya en la línea, el siguiente paso sigue entero (sale de ella)', () => {
    expect(stepToLines({ x0: 0, y0: 10, x1: 40, y1: 50 }, t, 'x', -1)).toBe(-1);
  });
  it('con Shift (10 mm) también se para en la primera línea que cruzaría', () => {
    // el borde derecho (146) cruzaría el izquierdo de la otra imagen (150), a 4 mm
    expect(stepToLines({ x0: 106, y0: 10, x1: 146, y1: 50 }, t, 'x', 10)).toBeCloseTo(4, 9);
  });
  it('sin líneas por el camino, el paso entero', () => {
    expect(stepToLines({ x0: 20, y0: 10, x1: 60, y1: 50 }, t, 'x', 1)).toBe(1);
    expect(stepToLines({ x0: 20, y0: 10, x1: 60, y1: 50 }, t, 'y', 0)).toBe(0);
  });
});

describe('rejilla de 1 mm', () => {
  it('lleva al mm entero más cercano', () => {
    expect(onGrid(13.833)).toBe(14);
    expect(toGrid(13.3)).toBeCloseTo(-0.3, 9);
  });
  it('fuera de la rejilla, la flecha llega primero al mm entero siguiente (el hueco 1,38 pasa a 1,3, no a 1,28)', () => {
    expect(gridStep(13.833, -1)).toBeCloseTo(-0.833, 9);
    expect(gridStep(13.833, 1)).toBeCloseTo(0.167, 9);
  });
  it('en la rejilla, avanza el paso entero', () => {
    expect(gridStep(13, -1)).toBe(-1);
    expect(gridStep(13, 10)).toBe(10);
  });
  it('con Shift (10 mm) también acaba en un mm entero', () => {
    expect(13.833 + gridStep(13.833, 10)).toBeCloseTo(23, 9);
    expect(13.833 + gridStep(13.833, -10)).toBeCloseTo(4, 9);
  });
  it('un error de coma flotante no cuenta como estar fuera de la rejilla', () => {
    expect(13.0000000001 + gridStep(13.0000000001, 1)).toBeCloseTo(14, 9);
    expect(12.9999999999 + gridStep(12.9999999999, 1)).toBeCloseTo(14, 9);
  });
});
