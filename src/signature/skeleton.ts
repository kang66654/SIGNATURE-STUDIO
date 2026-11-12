/**
 * 字形 → 骨架 → 笔画段。
 *
 * 运行时只做一次（按字符缓存，可选 IndexedDB 持久化），之后每次重建只读坐标。
 * 管线：栅格化 → 二值化 → Zhang–Suen 细化 → 折线跟踪 → RDP 简化 → 距离变换回填笔宽 → 排序。
 */

export interface StrokePoint {
  x: number;
  y: number;
  w: number;
}

export interface Stroke {
  pts: StrokePoint[];
  arc: number;
}

export interface Glyph {
  ch: string;
  /** 排版前进宽度（nominal 坐标） */
  adv: number;
  /** 从基线向上的高度（nominal 坐标） */
  asc: number;
  strokes: Stroke[];
  /** 栅格尺寸与基线（reveal / idx 的坐标系） */
  raster: { w: number; h: number; base: number; pad: number };
  /**
   * 每个墨迹像素归属哪一笔、走到这一笔的百分之几。
   * 遮罩直接由它生成：墨迹的每一块都知道自己什么时候该出现，不靠“沿骨架刷一条线”。
   */
  reveal: { idx: Int16Array; frac: Uint8Array };
}

/** 骨架生成的基准字号：所有字形按这个尺寸算，排版时按比例缩放 */
export const NOMINAL_PX = 200;
const PAD = 6;

const glyphCache = new Map<string, Glyph>();
const missCache = new Set<string>();

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx(): CanvasRenderingContext2D {
  if (!measureCtx) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    measureCtx = c.getContext('2d', { willReadFrequently: true })!;
  }
  return measureCtx;
}

export function fontStack(family = 'Caveat'): string {
  return `${NOMINAL_PX}px "${family}", "Segoe Script", "Ink Free", "Bradley Hand", cursive`;
}

/** 该字符是否由手写体本体提供（缺字时交给 fallback 也画得出来，但那不是手写体） */
function hasHandwritingGlyph(ch: string): boolean {
  // 用“墨迹指纹”比对：手写体与纯 fallback 栈各画一次，像素分布一样就说明落到同一个系统字体了
  const a = inkSig('Caveat', ch);
  const b = inkSig('__none__', ch);
  if (!a || !b) return true;
  return a.some((v, i) => Math.abs(v - b[i]) > 0.5);
}

/** 把字符在小画布上画一遍，返回墨迹像素数、灰度总和与包围盒 */
function inkSig(family: string, ch: string): number[] | null {
  const c = document.createElement('canvas');
  c.width = c.height = 96;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) return null;
  g.font = `72px "${family}", "Segoe Script", "Ink Free", "Bradley Hand", cursive`;
  g.textBaseline = 'alphabetic';
  g.fillStyle = '#fff';
  g.fillText(ch, 8, 80);
  const d = g.getImageData(0, 0, 96, 96).data;
  let n = 0;
  let sum = 0;
  let x0 = 96;
  let y0 = 96;
  let x1 = 0;
  let y1 = 0;
  for (let i = 0; i < d.length; i += 4) {
    const al = d[i + 3];
    if (al <= 40) continue;
    n++;
    sum += al;
    const p = i / 4;
    const x = p % 96;
    const y = (p / 96) | 0;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  return [n, sum, x0, y0, x1, y1];
}

/** 产物缓存键，字体变化（加载完成）后需要失效 */
let cacheEpoch = 0;
/** 字体就绪后先空画一笔，让浏览器真正把字体激活到 canvas 上（否则第一次栅格化仍会用 fallback） */
export function warmGlyphFont() {
  const c = document.createElement('canvas');
  c.width = c.height = 16;
  const g = c.getContext('2d');
  if (!g) return;
  g.font = fontStack();
  g.fillText('Aa', 0, 12);
  inkSig('Caveat', 'A');
}

export function clearGlyphCache() {
  glyphCache.clear();
  missCache.clear();
  cacheEpoch++;
}

export function getGlyph(ch: string): Glyph | null {
  const key = `${cacheEpoch}:${ch}`;
  const hit = glyphCache.get(key);
  if (hit) return hit;
  if (missCache.has(key)) return null;
  const g = buildGlyph(ch);
  if (!g) {
    missCache.add(key);
    return null;
  }
  glyphCache.set(key, g);
  return g;
}

function buildGlyph(ch: string): Glyph | null {
  if (!ch.trim()) return null;
  // 只认手写体本身覆盖的字符；否则系统字体会顶上来，画出来是“印刷体”混在手写里。
  // 字体还没就绪时先跳过这项检查，等 document.fonts 完成后缓存会被清掉重算。
  if (document.fonts.status === 'loaded' && !hasHandwritingGlyph(ch)) return null;
  const ctx = getMeasureCtx();
  ctx.font = fontStack();
  const m = ctx.measureText(ch);
  const adv = Math.max(m.width, NOMINAL_PX * 0.12);
  // 用 1.6 倍行高保证带笔锋的字形不被裁掉
  const W = Math.ceil(adv) + PAD * 2;
  const H = Math.ceil(NOMINAL_PX * 1.7);
  const baseline = Math.ceil(NOMINAL_PX * 1.28);

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g2 = c.getContext('2d', { willReadFrequently: true })!;
  g2.font = fontStack();
  g2.fillStyle = '#fff';
  g2.textBaseline = 'alphabetic';
  g2.fillText(ch, PAD, baseline);

  const img = g2.getImageData(0, 0, W, H).data;
  const bin = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) bin[i] = img[i * 4 + 3] > 40 ? 1 : 0;

  const skeleton = thin(bin, W, H);
  const dist = distanceField(bin, W, H);
  const raw = traceSkeleton(skeleton, W, H);

  const strokes: Stroke[] = [];
  for (const poly of raw) {
    const simplified = simplify(poly, 1.1);
    if (simplified.length < 2) continue;
    const pts: StrokePoint[] = simplified.map(([x, y]) => {
      const d = dist[Math.min(H - 1, y) * W + Math.min(W - 1, x)] || 1;
      return { x: x - PAD, y: y - baseline, w: Math.max(1.6, d * 2) };
    });
    let arc = 0;
    for (let i = 1; i < pts.length; i++) {
      arc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    }
    if (arc < 2) continue; // 细化残留的单像素噪点
    strokes.push({ pts, arc });
  }

  if (!strokes.length) return null;

  // 细化会把同一条笔画切成好几段，先按端点相接重新缝回一条，笔顺才对得上
  const merged = mergeFragments(strokes);

  // 真实存在的“点”（i/j 的点儿）：孤立、短、粗，保留；其余短碎线都当毛刺剪掉
  const kept = merged.filter((s, i) => {
    if (s.arc >= 5) return true;
    const maxW = s.pts.reduce((m, p) => Math.max(m, p.w), 0);
    if (maxW < 10) return false;
    const p0 = s.pts[0];
    const near = merged.some((o, j) => {
      if (i === j) return false;
      return o.pts.some((q) => Math.hypot(q.x - p0.x, q.y - p0.y) < 10);
    });
    return !near;
  });

  if (!kept.length) return null;

  const ordered = orderStrokes(kept);

  // 轻微平滑，避免折线在放大后露出直角
  for (const s of ordered) widen(s.pts);
  for (const s of ordered) smooth(s.pts);

  let top = 0;
  for (const s of ordered) for (const p of s.pts) top = Math.min(top, p.y);

  const reveal = buildReveal(ordered, bin, W, H, baseline);

  return { ch, adv, asc: -top, strokes: ordered, raster: { w: W, h: H, base: baseline, pad: PAD }, reveal };
}

/**
 * 把每一笔“贴”到它覆盖的墨迹上：先沿笔画铺种子（记录笔画序号 + 弧长百分比），
 * 再做一次多源 BFS 把周围墨迹像素染上同一个标记。墨迹因此天然知道自己什么时候出现。
 */
function buildReveal(strokes: Stroke[], bin: Uint8Array, w: number, h: number, base: number) {
  const idx = new Int16Array(w * h).fill(-1);
  const frac = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  let tail = 0;

  const seed = (p: number, si: number, f: number) => {
    if (p < 0 || p >= w * h || idx[p] !== -1) return;
    idx[p] = si;
    frac[p] = f;
    queue[tail++] = p;
  };
  strokes.forEach((s, si) => {
    let total = 0;
    for (let i = 1; i < s.pts.length; i++) {
      total += Math.hypot(s.pts[i].x - s.pts[i - 1].x, s.pts[i].y - s.pts[i - 1].y);
    }
    total = total || 1;
    let acc = 0;
    for (let i = 0; i < s.pts.length; i++) {
      const p = s.pts[i];
      if (i > 0) {
        const prev = s.pts[i - 1];
        const len = Math.hypot(p.x - prev.x, p.y - prev.y);
        const steps = Math.max(1, Math.ceil(len / 0.7));
        for (let k = 0; k <= steps; k++) {
          const u = k / steps;
          const x = Math.round(prev.x + (p.x - prev.x) * u + PAD);
          const y = Math.round(prev.y + (p.y - prev.y) * u + base);
          seed(y * w + x, si, Math.round(((acc + len * u) / total) * 255));
        }
        acc += len;
      } else {
        seed(Math.round(p.x + PAD) + Math.round(p.y + base) * w, si, 0);
      }
    }
  });

  // 第一轮：只走墨迹，让墨迹像素就近归属某一笔
  const nb = [-1, 1, -w, w, -w - 1, -w + 1, w - 1, w + 1];
  let head = 0;
  while (head < tail) {
    const p = queue[head++];
    for (const d of nb) {
      const n = p + d;
      if (n < 0 || n >= w * h) continue;
      if (idx[n] !== -1 || !bin[n]) continue;
      idx[n] = idx[p];
      frac[n] = frac[p];
      queue[tail++] = n;
    }
  }

  // 第二轮：二值化漏掉的反锯齿边缘、笔画之间的细缝按最近邻补上，
  // 保证每一块墨迹都有登场时间（否则会出现“只揭开一半”的碎片感）
  head = 0;
  while (head < tail) {
    const p = queue[head++];
    for (const d of nb) {
      const n = p + d;
      if (n < 0 || n >= w * h || idx[n] !== -1) continue;
      idx[n] = idx[p];
      frac[n] = frac[p];
      queue[tail++] = n;
    }
  }

  return { idx, frac };
}

/* ------------------------------------------------------------------ 细化 */

function thin(bin: Uint8Array, w: number, h: number): Uint8Array {
  const out = bin.slice();
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 40) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      const del: number[] = [];
      for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
          const p = y * w + x;
          if (!out[p]) continue;
          const p2 = out[p - w];
          const p3 = out[p - w + 1];
          const p4 = out[p + 1];
          const p5 = out[p + w + 1];
          const p6 = out[p + w];
          const p7 = out[p + w - 1];
          const p8 = out[p - 1];
          const p9 = out[p - w - 1];
          const b = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (b < 2 || b > 6) continue;
          // 0→1 的环状跳变数必须为 1，保证不打断笔画
          const a =
            (!p2 && p3 ? 1 : 0) +
            (!p3 && p4 ? 1 : 0) +
            (!p4 && p5 ? 1 : 0) +
            (!p5 && p6 ? 1 : 0) +
            (!p6 && p7 ? 1 : 0) +
            (!p7 && p8 ? 1 : 0) +
            (!p8 && p9 ? 1 : 0) +
            (!p9 && p2 ? 1 : 0);
          if (a !== 1) continue;
          if (pass === 0) {
            if (p2 && p4 && p6) continue;
            if (p4 && p6 && p8) continue;
          } else {
            if (p2 && p4 && p8) continue;
            if (p2 && p6 && p8) continue;
          }
          del.push(p);
        }
      }
      if (del.length) {
        changed = true;
        for (const p of del) out[p] = 0;
      }
    }
  }
  return out;
}

/** 倒角距离变换（3-4-5），返回每个像素到最近背景的距离（像素单位） */
function distanceField(bin: Uint8Array, w: number, h: number): Float32Array {
  const d = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) d[i] = bin[i] ? 1e6 : 0;
  const a = 3,
    b = 4;
  for (let y = 1; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!bin[i]) continue;
      let m = d[i];
      if (x > 0) m = Math.min(m, d[i - 1] + a);
      if (x < w - 1) m = Math.min(m, d[i - w + 1] + b);
      m = Math.min(m, d[i - w] + a);
      if (x > 0) m = Math.min(m, d[i - w - 1] + b);
      d[i] = m;
    }
  }
  for (let y = h - 2; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!bin[i]) continue;
      let m = d[i];
      if (x < w - 1) m = Math.min(m, d[i + 1] + a);
      if (x > 0) m = Math.min(m, d[i + w - 1] + b);
      m = Math.min(m, d[i + w] + a);
      if (x < w - 1) m = Math.min(m, d[i + w + 1] + b);
      d[i] = m;
    }
  }
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = d[i] / 3;
  return out;
}

/* ------------------------------------------------------------------ 折线跟踪 */

function traceSkeleton(skel: Uint8Array, w: number, h: number): Array<Array<[number, number]>> {
  const nbrs: Array<[number, number]> = [
    [-1, -1], [0, -1], [1, -1],
    [-1, 0], [1, 0],
    [-1, 1], [0, 1], [1, 1],
  ];
  const deg = new Uint8Array(w * h);
  const pix: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!skel[i]) continue;
    pix.push(i);
    let n = 0;
    const x = i % w;
    const y = (i - x) / w;
    for (const [dx, dy] of nbrs) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      if (skel[ny * w + nx]) n++;
    }
    deg[i] = n;
  }

  const visited = new Uint8Array(w * h);
  const paths: Array<Array<[number, number]>> = [];

  const walk = (start: number) => {
    const path: Array<[number, number]> = [];
    let cur = start;
    let dx = 0;
    let dy = 0;
    while (cur >= 0 && !visited[cur]) {
      visited[cur] = 1;
      const x = cur % w;
      const y = (cur - x) / w;
      path.push([x, y]);
      let next = -1;
      let bestScore = -Infinity;
      for (const [sx, sy] of nbrs) {
        const nx = x + sx;
        const ny = y + sy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const ni = ny * w + nx;
        if (!skel[ni] || visited[ni]) continue;
        // 优先延续当前方向（惯性），避免在交叉点乱拐
        const score = dx || dy ? sx * dx + sy * dy : -Math.abs(sx) * 0.1;
        if (score > bestScore) {
          bestScore = score;
          next = ni;
        }
      }
      if (next < 0) break;
      const nx = next % w;
      const ny = (next - nx) / w;
      const vx = nx - x;
      const vy = ny - y;
      const len = Math.hypot(vx, vy) || 1;
      dx = vx / len;
      dy = vy / len;
      cur = next;
    }
    if (path.length >= 1) paths.push(path);
  };

  // 先走端点，再从剩下的像素（闭合环）开始
  const ends = pix.filter((i) => deg[i] === 1).sort((a, b) => {
    const ay = (a - (a % w)) / w;
    const by = (b - (b % w)) / w;
    return ay - by || (a % w) - (b % w);
  });
  for (const e of ends) if (!visited[e]) walk(e);
  for (const p of pix) if (!visited[p]) walk(p);

  return paths;
}

/** Ramer–Douglas–Peucker 简化 */
function simplify(points: Array<[number, number]>, eps: number): Array<[number, number]> {
  if (points.length < 3) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = 0;
    let idx = -1;
    const [x1, y1] = points[s];
    const [x2, y2] = points[e];
    const dx = x2 - x1;
    const dy = y2 - y1;
    const den = Math.hypot(dx, dy) || 1;
    for (let i = s + 1; i < e; i++) {
      const [x, y] = points[i];
      const d = Math.abs(dy * (x - x1) - dx * (y - y1)) / den;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  return points.filter((_, i) => keep[i]);
}

/** 把端点几乎相接的碎段缝回一条笔，避免一个字被切成十几段、每段各占一段时间 */
function mergeFragments(list: Stroke[]): Stroke[] {
  const cur: Stroke[] = list.map((s) => ({ arc: s.arc, pts: s.pts.slice() }));
  const gap = 3;
  for (let pass = 0; pass < 8; pass++) {
    let merged = false;
    for (let i = 0; i < cur.length && !merged; i++) {
      for (let j = i + 1; j < cur.length && !merged; j++) {
        const a = cur[i].pts;
        const b = cur[j].pts;
        const pairs: Array<[StrokePoint, StrokePoint, boolean, boolean]> = [
          [a[a.length - 1], b[0], false, false],
          [a[a.length - 1], b[b.length - 1], false, true],
          [a[0], b[0], true, false],
          [a[0], b[b.length - 1], true, true],
        ];
        for (const [pa, pb, flipA, flipB] of pairs) {
          if (Math.hypot(pa.x - pb.x, pa.y - pb.y) > gap) continue;
          const A = flipA ? a.slice().reverse() : a.slice();
          const B = flipB ? b.slice().reverse() : b.slice();
          cur[i].pts = A.concat(B);
          cur[i].arc += cur[j].arc + Math.hypot(pa.x - pb.x, pa.y - pb.y);
          cur.splice(j, 1);
          merged = true;
          break;
        }
      }
    }
    if (!merged) break;
  }
  return cur;
}

/**
 * 笔宽修整：距离变换取的是骨架点上的半径，骨架一旦偏到笔画边缘，宽度会掉一半。
 * 用邻域取大 + 轻微放大，保证遮罩一定能把这条笔画的墨盖全（宁可多一点，不要镂空）。
 */function widen(pts: StrokePoint[]) {
  const src = pts.map((p) => p.w);
  for (let i = 0; i < pts.length; i++) {
    let m = 0;
    for (let k = -2; k <= 2; k++) {
      const v = src[i + k];
      if (v !== undefined) m = Math.max(m, v);
    }
    pts[i].w = m * 1.12;
  }
}

/** 相邻点等距插值 + 一次低通，给笔宽做平滑 */
function smooth(pts: StrokePoint[]) {  if (pts.length < 3) return;
  const src = pts.map((p) => ({ ...p }));
  for (let i = 1; i < pts.length - 1; i++) {
    pts[i].w = (src[i - 1].w + src[i].w * 2 + src[i + 1].w) / 4;
  }
  for (let i = 1; i < pts.length - 1; i++) {
    pts[i].x = (src[i - 1].x + src[i].x * 2 + src[i + 1].x) / 4;
    pts[i].y = (src[i - 1].y + src[i].y * 2 + src[i + 1].y) / 4;
  }
}

/** 按真实运笔习惯排序：从左上起笔，之后每次接最近的一笔 */
function orderStrokes(strokes: Stroke[]): Stroke[] {
  if (strokes.length <= 2) return strokes;
  const pool = strokes.slice();
  const out: Stroke[] = [];

  let bestIdx = 0;
  let bestScore = Infinity;
  let bestFlip = false;
  pool.forEach((s, i) => {
    const head = s.pts[0];
    const tail = s.pts[s.pts.length - 1];
    const sh = head.y - head.x * 0.35;
    const st = tail.y - tail.x * 0.35;
    if (sh < bestScore) {
      bestScore = sh;
      bestIdx = i;
      bestFlip = false;
    }
    if (st < bestScore) {
      bestScore = st;
      bestIdx = i;
      bestFlip = true;
    }
  });

  let cur = pool.splice(bestIdx, 1)[0];
  if (bestFlip) cur.pts.reverse();
  out.push(cur);
  let end = cur.pts[cur.pts.length - 1];

  while (pool.length) {
    let pick = 0;
    let flip = false;
    let dist = Infinity;
    pool.forEach((s, i) => {
      const head = s.pts[0];
      const tail = s.pts[s.pts.length - 1];
      const dh = Math.hypot(head.x - end.x, head.y - end.y);
      const dt = Math.hypot(tail.x - end.x, tail.y - end.y);
      if (dh < dist) {
        dist = dh;
        pick = i;
        flip = false;
      }
      if (dt < dist) {
        dist = dt;
        pick = i;
        flip = true;
      }
    });
    const s = pool.splice(pick, 1)[0];
    if (flip) s.pts.reverse();
    out.push(s);
    end = s.pts[s.pts.length - 1];
  }
  return out;
}

export function supportsChar(ch: string): boolean {
  return getGlyph(ch) !== null;
}
