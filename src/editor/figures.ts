import type { ShapeSpec } from './types';

export const figures = { rectangle: 'Rectángulo', ellipse: 'Elipse', triangle: 'Triángulo' } as const;

export function validFigure(spec: ShapeSpec | undefined): boolean {
  return !!spec && Object.hasOwn(figures, spec.figure) && /^#[0-9a-f]{6}$/i.test(spec.fill);
}

/** La capa y la exportación generan la misma silueta a la resolución que necesitan. */
export function figureCanvas(spec: ShapeSpec, width = spec.figure === 'rectangle' ? 768 : 512, height = 512) {
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.scale(width, height);
  ctx.fillStyle = spec.fill;
  if (spec.figure === 'rectangle') ctx.fillRect(0, 0, 1, 1);
  else {
    ctx.beginPath();
    if (spec.figure === 'ellipse') ctx.ellipse(0.5, 0.5, 0.5, 0.5, 0, 0, Math.PI * 2);
    else { ctx.moveTo(0.5, 0); ctx.lineTo(1, 1); ctx.lineTo(0, 1); ctx.closePath(); }
    ctx.fill();
  }
  ctx.resetTransform();
  return c;
}
