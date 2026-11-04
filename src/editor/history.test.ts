import { describe, expect, it } from 'vitest';
import { trimStack } from './history';

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
