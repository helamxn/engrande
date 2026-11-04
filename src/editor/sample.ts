/** Imagen de ejemplo dibujada en código (globo aerostático), para que el lienzo no arranque vacío. */
function cloud(x: CanvasRenderingContext2D, px: number, py: number, s: number) {
  x.beginPath();
  for (const [dx, dy, r] of [[0, 0, 110], [100, -40, 130], [220, 10, 100], [110, 40, 110]] as const) {
    x.moveTo(px + dx * s + r * s, py + dy * s);
    x.arc(px + dx * s, py + dy * s, r * s, 0, Math.PI * 2);
  }
  x.fill();
}

export function sampleCanvas() {
  const c = document.createElement('canvas');
  c.width = 1800; c.height = 2400;
  const x = c.getContext('2d', { willReadFrequently: true })!;
  x.fillStyle = '#f1ece2'; x.fillRect(0, 0, 1800, 2400);
  x.fillStyle = '#cfe2ec'; cloud(x, 260, 480, 1); cloud(x, 1300, 820, 0.85); cloud(x, 340, 1600, 0.7);
  const cx = 900, cy = 950, R = 560, a0 = Math.PI * 0.82, a1 = Math.PI * 0.18;
  const env = () => {
    x.beginPath(); x.arc(cx, cy, R, a0, a1 + Math.PI * 2, false);
    x.quadraticCurveTo(cx + R * 0.42, cy + R * 1.2, cx + R * 0.2, cy + R * 1.42); x.lineTo(cx - R * 0.2, cy + R * 1.42);
    x.quadraticCurveTo(cx - R * 0.42, cy + R * 1.2, cx + R * Math.cos(a0), cy + R * Math.sin(a0)); x.closePath();
  };
  x.save(); env(); x.clip();
  const cols = ['#e0533d', '#f2b134', '#2f8f9d', '#1f4e79', '#2f8f9d', '#f2b134', '#e0533d'], bw = (2 * R) / cols.length;
  cols.forEach((col, i) => { x.fillStyle = col; x.fillRect(cx - R + i * bw, 0, bw + 1, 2400); });
  const gr = x.createRadialGradient(cx - R * 0.35, cy - R * 0.4, 20, cx - R * 0.2, cy - R * 0.2, R * 1.1);
  gr.addColorStop(0, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 1800, 2400);
  x.restore(); x.lineWidth = 10; x.strokeStyle = '#2a2620'; env(); x.stroke();
  const by = cy + R * 1.42 + 210;
  x.lineWidth = 8; x.beginPath();
  x.moveTo(cx - R * 0.2, cy + R * 1.42); x.lineTo(cx - 105, by); x.moveTo(cx + R * 0.2, cy + R * 1.42); x.lineTo(cx + 105, by); x.stroke();
  x.fillStyle = '#8a5a2b'; x.beginPath(); x.roundRect(cx - 125, by, 250, 165, 18); x.fill(); x.stroke();
  x.strokeStyle = '#5e3c1b'; x.lineWidth = 6;
  for (let i = 1; i < 4; i++) { x.beginPath(); x.moveTo(cx - 125, by + i * 41); x.lineTo(cx + 125, by + i * 41); x.stroke(); }
  x.fillStyle = '#1f2a36'; x.textAlign = 'center'; x.font = '800 160px "Archivo Variable", system-ui, sans-serif'; x.fillText('VUELA ALTO', 900, 2290);
  return c;
}
