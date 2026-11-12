import type { Deco } from '../config';
import type { Art } from './layout';

/* ------------------------------------------------------------ 装饰图形 */

/** 全部用内联路径画，不依赖图片与 emoji */
export function drawDeco(
  ctx: CanvasRenderingContext2D,
  kind: Deco,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha = 1,
  scale = 1,
) {
  if (kind === 'none' || alpha <= 0) return;
  const R = r * scale;
  ctx.save();
  ctx.translate(x, y);
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(1, R * 0.07);

  switch (kind) {
    case 'sun': {
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.36, 0, Math.PI * 2);
      ctx.stroke();
      for (let i = 0; i < 8; i++) {
        const a = (Math.PI / 4) * i + Math.PI / 8;
        ctx.beginPath();
        ctx.moveTo(Math.cos(a) * R * 0.56, Math.sin(a) * R * 0.56);
        ctx.lineTo(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86);
        ctx.stroke();
      }
      break;
    }
    case 'cat': {
      // 两只三角形耳朵 + 圆头 + 两撇胡须
      ctx.beginPath();
      ctx.arc(0, R * 0.08, R * 0.5, Math.PI * 0.08, Math.PI * 0.92, true);
      ctx.stroke();
      const ear = (dir: number) => {
        ctx.beginPath();
        ctx.moveTo(dir * R * 0.34, -R * 0.18);
        ctx.lineTo(dir * R * 0.5, -R * 0.82);
        ctx.lineTo(dir * R * 0.72, -R * 0.24);
        ctx.stroke();
      };
      ear(-1);
      ear(1);
      for (const dir of [-1, 1]) {
        for (let i = 0; i < 2; i++) {
          ctx.beginPath();
          ctx.moveTo(dir * R * 0.5, R * 0.16 + i * R * 0.16);
          ctx.lineTo(dir * R * 1.0, R * 0.06 + i * R * 0.3);
          ctx.stroke();
        }
      }
      break;
    }
    case 'dog': {
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.46, 0, Math.PI * 2);
      ctx.stroke();
      // 两只垂耳
      ctx.beginPath();
      ctx.ellipse(-R * 0.5, R * 0.06, R * 0.16, R * 0.34, 0.3, 0, Math.PI * 2);
      ctx.ellipse(R * 0.5, R * 0.06, R * 0.16, R * 0.34, -0.3, 0, Math.PI * 2);
      ctx.stroke();
      // 鼻子
      ctx.beginPath();
      ctx.ellipse(0, R * 0.12, R * 0.12, R * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case 'cloud': {
      ctx.beginPath();
      ctx.arc(-R * 0.34, R * 0.08, R * 0.3, Math.PI, Math.PI * 2);
      ctx.arc(R * 0.02, -R * 0.02, R * 0.36, Math.PI * 0.9, Math.PI * 2.05);
      ctx.arc(R * 0.42, R * 0.1, R * 0.26, Math.PI * 1.1, Math.PI * 2.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-R * 0.6, R * 0.24);
      ctx.lineTo(R * 0.62, R * 0.24);
      ctx.stroke();
      break;
    }
    case 'star': {
      const pts: Array<[number, number]> = [];
      for (let i = 0; i < 10; i++) {
        const a = (Math.PI / 5) * i - Math.PI / 2;
        const rr = i % 2 === 0 ? R * 0.82 : R * 0.32;
        pts.push([Math.cos(a) * rr, Math.sin(a) * rr]);
      }
      ctx.beginPath();
      pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
      ctx.closePath();
      ctx.stroke();
      break;
    }
    case 'heart': {
      ctx.beginPath();
      ctx.moveTo(0, R * 0.62);
      ctx.bezierCurveTo(-R * 0.95, -R * 0.05, -R * 0.42, -R * 0.78, 0, -R * 0.3);
      ctx.bezierCurveTo(R * 0.42, -R * 0.78, R * 0.95, -R * 0.05, 0, R * 0.62);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
  ctx.restore();
}

/* ------------------------------------------------------------ 收尾火花 */

export interface Spark {  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  life: number;
  delay: number;
  color: string;
}

/** 固定种子，保证同一组参数每次导出的粒子完全一致 */
export function makeSparks(art: Art): Spark[] {
  const sparks: Spark[] = [];
  let seed = 0;
  for (const ch of art.key) seed = (seed * 31 + ch.charCodeAt(0)) % 2147483647;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  const colors = art.glyphs.map((g) => g.color);
  const bx = art.box.x;
  const by = art.box.y;
  const bw = Math.max(1, art.box.w);
  const bh = Math.max(1, art.box.h);
  const count = 34;
  for (let i = 0; i < count; i++) {
    sparks.push({
      x: bx + bw * (0.1 + rnd() * 0.85),
      y: by + bh * (0.25 + rnd() * 0.7),
      vx: (rnd() - 0.5) * bw * 0.09,
      vy: -bh * (0.12 + rnd() * 0.4),
      r: art.H * (0.0016 + rnd() * 0.0035),
      life: 0.1 + rnd() * 0.14,
      delay: rnd() * 0.1,
      color: colors[Math.floor(rnd() * colors.length)] ?? '#fff',
    });
  }
  return sparks;
}

/** 收尾特效的起点（占时长比例）：最后一笔写完时才冒火花 */
export const SPARK_START = 0.8;

export function drawSparks(ctx: CanvasRenderingContext2D, sparks: Spark[], t: number, startAt: number) {
  const local = t - startAt;
  if (local <= 0) return;
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (const s of sparks) {
    const age = local - s.delay;
    if (age <= 0) continue;
    const k = age / s.life;
    if (k >= 1) continue;
    const ease = 1 - Math.pow(1 - k, 3);
    const x = s.x + s.vx * ease;
    const y = s.y + s.vy * ease;
    const alpha = 1 - k;
    const r = Math.max(1, s.r * (1 - k * 0.4));
    // 光点：中心实、边缘软，叠出来像星屑，不会糊成灰团
    ctx.globalAlpha = alpha * 0.85;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r * 2.6);
    g.addColorStop(0, s.color);
    g.addColorStop(0.28, s.color);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}
