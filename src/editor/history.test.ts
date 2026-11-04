import { describe, expect, it, vi } from 'vitest';
import { releaseUnused, trimStack } from './history';

const canvas = (w: number, h: number) => ({ width: w, height: h });
const step = (...imgs: { width: number; height: number }[]) => ({ props: imgs.map((img) => ({ img, orig: img })) });

describe('trimStack (límite de memoria del historial)', () => {
  it('no descarta nada si cabe en el presupuesto', () => {
    const stack = [step(canvas(100, 100)), step(canvas(100, 100))];
    trimStack(stack, new Set(), 1e9);
    expect(stack).toHaveLength(2);
  });

  it('descarta los pasos más viejos cuando los lienzos retenidos superan el presupuesto', () => {
    // cada lienzo de 1000×1000 ocupa 4 MB
    const stack = [step(canvas(1000, 1000)), step(canvas(1000, 1000)), step(canvas(1000, 1000))];
    trimStack(stack, new Set(), 9e6);
    expect(stack).toHaveLength(2);
  });

  it('no cuenta los lienzos que siguen en uso en el póster', () => {
    const live = canvas(1000, 1000);
    const stack = [step(live), step(live), step(canvas(1000, 1000))];
    trimStack(stack, new Set([live]), 5e6);
    expect(stack).toHaveLength(3);
  });

  it('cuenta una sola vez un lienzo compartido por varios pasos', () => {
    const shared = canvas(1000, 1000);
    const stack = [step(shared), step(shared), step(shared)];
    trimStack(stack, new Set(), 5e6);
    expect(stack).toHaveLength(3);
  });

  it('siempre conserva al menos un paso', () => {
    const stack = [step(canvas(5000, 5000))];
    trimStack(stack, new Set(), 1);
    expect(stack).toHaveLength(1);
  });
});

describe('trimStack devuelve los pasos descartados', () => {
  it('para poder liberar su memoria', () => {
    const a = step(canvas(1000, 1000)), b = step(canvas(1000, 1000)), c = step(canvas(1000, 1000));
    const stack = [a, b, c];
    expect(trimStack(stack, new Set(), 9e6)).toEqual([a]);
  });
});

describe('releaseUnused (liberar lienzos y PDF del historial descartado)', () => {
  const doc = () => ({ loadingTask: { destroy: vi.fn(() => Promise.resolve()) } });
  const layer = (img: { width: number; height: number }, pdf: ReturnType<typeof doc> | null = null) => ({ img, orig: img, pdf });
  const snapOf = (...ls: ReturnType<typeof layer>[]) => ({ layers: ls, props: ls.map((l) => ({ l, img: l.img, orig: l.orig })) });

  it('deja a tamaño 0 los lienzos que ya no usa nadie y respeta los que siguen en uso', () => {
    const dead = canvas(800, 600), alive = canvas(800, 600);
    const r = releaseUnused([snapOf(layer(dead), layer(alive))], { canvases: new Set([alive]), docs: new Set() });
    expect(r.canvases).toBe(1);
    expect(dead).toEqual({ width: 0, height: 0 });
    expect(alive).toEqual({ width: 800, height: 600 });
  });

  it('cierra los PDF que ya no usa nadie, una sola vez, y no toca los que siguen en uso', () => {
    const deadDoc = doc(), liveDoc = doc();
    const s1 = snapOf(layer(canvas(10, 10), deadDoc)), s2 = snapOf(layer(canvas(10, 10), deadDoc), layer(canvas(10, 10), liveDoc));
    const r = releaseUnused([s1, s2], { canvases: new Set(), docs: new Set([liveDoc]) });
    expect(r.docs).toBe(1);
    expect(deadDoc.loadingTask.destroy).toHaveBeenCalledTimes(1);
    expect(liveDoc.loadingTask.destroy).not.toHaveBeenCalled();
  });

  it('un lienzo compartido entre un paso descartado y uno vivo no se libera', () => {
    const shared = canvas(500, 500);
    releaseUnused([snapOf(layer(shared))], { canvases: new Set([shared]), docs: new Set() });
    expect(shared.width).toBe(500);
  });
});

describe('instantáneas (takeSnap / restoreSnap)', () => {
  it('deshacer recupera nombre, bloqueo, opacidad y la selección de varias', async () => {
    const { takeSnap, restoreSnap } = await import('./history');
    const { st } = await import('./state');
    const mk = (name: string) => ({
      name, cx: 0, cy: 0, w: 10, h: 10, rot: 0, flipX: false, flipY: false, crop: { x0: 0, y0: 0, x1: 1, y1: 1 },
      img: canvas(1, 1), orig: canvas(1, 1), page: 1, fit: null, hidden: false, locked: false, opacity: 1,
    });
    const a = mk('a'), b = mk('b');
    st.layers = [a, b] as never;
    st.group = [a, b] as never;
    const s = takeSnap();
    a.name = 'otro'; a.locked = true; a.opacity = 0.4;
    st.group = [];
    restoreSnap(s);
    expect([a.name, a.locked, a.opacity]).toEqual(['a', false, 1]);
    expect(st.group).toEqual([a, b]);
  });
});
