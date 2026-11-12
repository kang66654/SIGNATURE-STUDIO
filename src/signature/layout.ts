import type { Config } from '../config';
import { stageSize } from '../config';
import { getGlyph, NOMINAL_PX } from './skeleton';
import type { Glyph, StrokePoint } from './skeleton';
import type { Deco, DecoMotion, Effect, WriteStyle, CJKFontKey } from '../config';

export interface PlacedStroke {
  pts: StrokePoint[];
  color: string;
  /** 起始时间占总时长的比例 */
  d: number;
  /** 持续时长占总时长的比例 */
  a: number;
  block: number;
}

export interface PlacedGlyph {
  ch: string;
  /** 基线左端 */
  x: number;
  y: number;
  size: number;
  color: string;
  glyph: Glyph;
  block: number;
  /** 该字第一笔在 art.strokes 里的下标 */
  strokeStart: number;
}

export interface DecoPlacement {
  kind: Deco;
  x: number;
  y: number;
  r: number;
  color: string;
  /** 出现时间（比例） */
  at: number;
}

export interface Art {
  W: number;
  H: number;
  glyphs: PlacedGlyph[];
  strokes: PlacedStroke[];
  deco: DecoPlacement | null;
  missing: string[];
  /** 参数指纹，用于底图缓存 */
  key: string;
  /** 名字区域的包围盒，粒子从这儿冒出来 */
  box: { x: number; y: number; w: number; h: number };
  /**
   * 登场时间图：半分辨率的字节图，值 = 该像素“写到这里”的时刻（0–255 映射到 0–1）。
   * 遮罩每帧只需拿它和当前时间比较，墨迹不会镂空，也不会把未来的笔画提前露出来。
   */
  map: Uint8Array;
  mapW: number;
  mapH: number;
  /** 字形风格与图层开关，跟着 Art 一起走，导出与预览共用 */
  style: WriteStyle;
  cjkFont: CJKFontKey;
  decoMotion: DecoMotion;
  effects: Effect[];
}

interface Block {
  text: string;
  color: string;
  scale: number;
}

export const WRITE_START = 0.05;
export const WRITE_END = 0.8;

export function buildArt(cfg: Config): Art {
  const { W, H } = stageSize(cfg);
  const blocks: Block[] = [{ text: cfg.nameA, color: cfg.colorA, scale: cfg.scaleA }];
  if (cfg.nameB.trim()) blocks.push({ text: cfg.nameB, color: cfg.colorB, scale: cfg.scaleB });

  const missing: string[] = [];
  const placed: Array<{ glyph: Glyph; size: number; block: number; color: string }[]> = [];

  // 基准字号：以画布短边为参照，保证换比例时观感一致
  const shortSide = Math.min(W, H);
  const single = blocks.length === 1;
  const maxW = single ? W * 0.74 : W * 0.42;
  // 连笔签名整体收紧字距，笔画挨得近才连得上
  const track = cfg.style === 'signature' ? 0.92 : 1;

  for (let bi = 0; bi < blocks.length; bi++) {
    const b = blocks[bi];
    const chars = [...b.text];
    const glyphs: Glyph[] = [];
    for (const ch of chars) {
      if (ch === ' ') continue;
      const g = getGlyph(ch, cfg.cjkFont);
      if (g) glyphs.push(g);
      else missing.push(ch);
    }
    if (!glyphs.length) {
      placed.push([]);
      continue;
    }
    let size = shortSide * 0.2 * b.scale;
    const naturalW = glyphs.reduce((s, g) => s + g.adv * track * (size / NOMINAL_PX), 0);
    if (naturalW > maxW) size *= maxW / naturalW;
    // 字少时（比如单个汉字、两三个字母）名字会缩在画面中间，放大一档让它撑住版面
    else if (naturalW < maxW * 0.8) size *= Math.min(1.7, (maxW * 0.86) / naturalW);
    placed.push(glyphs.map((g) => ({ glyph: g, size, block: bi, color: b.color })));
  }

  const glyphs: PlacedGlyph[] = [];
  const strokes: PlacedStroke[] = [];

  // 横向排布：单名居中；双名左右分列、基线错开，看起来像两个人各写各的
  const blockWidths = placed.map((gs) =>
    gs.reduce((s, it) => s + it.glyph.adv * track * (it.size / NOMINAL_PX), 0),
  );
  const gap = single ? 0 : W * 0.05;
  const totalW = blockWidths.reduce((a, b) => a + b, 0) + gap * (blocks.length - 1);
  let cursorX = (W - totalW) / 2;

  for (let bi = 0; bi < placed.length; bi++) {
    const gs = placed[bi];
    if (!gs.length) {
      cursorX += blockWidths[bi] + gap;
      continue;
    }
    const ascI = gs.reduce((m, it) => Math.max(m, it.glyph.asc * (it.size / NOMINAL_PX)), 0);
    // 单名：按字面墨迹垂直居中；双名：各自居中后再上下错开，像两个人各写各的
    const baseline = single
      ? H * 0.5 + ascI * 0.5
      : H * 0.5 + ascI * 0.5 + (bi === 0 ? -H * 0.05 : H * 0.06);

    for (const it of gs) {
      const g = it.glyph;
      const s = it.size / NOMINAL_PX;
      const strokeStart = strokes.length;
      glyphs.push({
        ch: g.ch,
        x: cursorX,
        y: baseline,
        size: it.size,
        color: it.color,
        glyph: g,
        block: bi,
        strokeStart,
      });
      for (const st of g.strokes) {
        strokes.push({
          pts: st.pts.map((p) => ({ x: cursorX + p.x * s, y: baseline + p.y * s, w: p.w * s })),
          color: it.color,
          d: 0,
          a: 0,
          block: bi,
        });
      }
      cursorX += g.adv * s * track;
    }
    cursorX += gap;
  }

  assignTiming(strokes, blocks.length);

  // 装饰：落在最长区块最后一个字的右上方
  let deco: DecoPlacement | null = null;
  if (cfg.deco !== 'none' && glyphs.length) {
    // 装饰落在“最长那一行”的末端：最长行末尾通常离画面右边界最近，上方也最空
    let anchor = glyphs[0];
    let widest = -1;
    for (let bi = 0; bi < placed.length; bi++) {
      const inBlock = glyphs.filter((g) => g.block === bi);
      if (!inBlock.length) continue;
      const first = inBlock[0];
      const last = inBlock[inBlock.length - 1];
      const span = last.x + (last.glyph.adv * last.size) / NOMINAL_PX - first.x;
      if (span > widest) {
        widest = span;
        anchor = last;
      }
    }
    const g = anchor.glyph;
    const s = anchor.size / NOMINAL_PX;
    const r = shortSide * 0.07 * cfg.decoScale;
    // 贴着最后一个字：横向落在字身中线偏右，纵向压在字顶上方（留出一个半径的呼吸，别压住字头）
    const x = anchor.x + (g.adv * s) * 0.62;
    const y = Math.max(r * 1.6, anchor.y - g.asc * s - r * 1.25);
    deco = {
      kind: cfg.deco,
      x,
      y,
      r,
      color: anchor.color,
      at: WRITE_END + 0.03,
    };
  }

  const box = boundsOf(glyphs);
  const key = [
    W, H, cfg.nameA, cfg.nameB, cfg.colorA, cfg.colorB, cfg.scaleA, cfg.scaleB, cfg.deco, cfg.decoScale,
    cfg.style, cfg.cjkFont,
  ].join('|');

  const mapW = Math.ceil(W / 2);
  const mapH = Math.ceil(H / 2);
  const map = buildTimeMap(glyphs, strokes, mapW, mapH);

  return {
    W, H, glyphs, strokes, deco, missing, key, box, map, mapW, mapH,
    style: cfg.style,
    cjkFont: cfg.cjkFont,
    decoMotion: cfg.decoMotion,
    effects: cfg.effects,
  };
}

/** 把每个字的“登场时间”投影到整张画布的半分辨率字节图上 */
function buildTimeMap(
  glyphs: PlacedGlyph[],
  strokes: PlacedStroke[],
  mapW: number,
  mapH: number,
): Uint8Array {
  const map = new Uint8Array(mapW * mapH);
  for (const g of glyphs) {
    const rv = g.glyph.reveal;
    const rs = g.glyph.raster;
    const s = g.size / NOMINAL_PX;
    // 目标像素反查源像素，保证放大时不出空洞
    const x0 = Math.max(0, Math.floor((g.x + (0 - rs.pad) * s) / 2));
    const x1 = Math.min(mapW - 1, Math.ceil((g.x + (rs.w - rs.pad) * s) / 2));
    const y0 = Math.max(0, Math.floor((g.y + (0 - rs.base) * s) / 2));
    const y1 = Math.min(mapH - 1, Math.ceil((g.y + (rs.h - rs.base) * s) / 2));
    for (let dy = y0; dy <= y1; dy++) {
      const sy = Math.min(rs.h - 1, Math.max(0, Math.round((dy * 2 - g.y) / s + rs.base)));
      const row = sy * rs.w;
      for (let dx = x0; dx <= x1; dx++) {
        const sx = Math.min(rs.w - 1, Math.max(0, Math.round((dx * 2 - g.x) / s + rs.pad)));
        const si = rv.idx[row + sx];
        if (si < 0) continue;
        const sIdx = g.strokeStart + si;
        const st = strokes[sIdx];
        if (!st) continue;
        const tv = st.d + (rv.frac[row + sx] / 255) * st.a;
        // 1..255 表示“时刻”，0 留给未覆盖的像素
        const v = Math.max(1, Math.min(255, Math.round(tv * 254) + 1));
        const di = dy * mapW + dx;
        if (map[di] === 0 || v < map[di]) map[di] = v;
      }
    }
  }
  return map;
}

/** 把笔画按区块分时间：块内按弧长比例 + 段间空窗，块间再留一点气口 */
function assignTiming(strokes: PlacedStroke[], blockCount: number) {
  if (!strokes.length) return;
  const span = WRITE_END - WRITE_START;
  const blockSpan = span / blockCount;

  for (let bi = 0; bi < blockCount; bi++) {
    const list = strokes.filter((s) => s.block === bi);
    if (!list.length) continue;
    const base = WRITE_START + blockSpan * bi;
    const arcs = list.map((s) => arcLength(s.pts));
    const totalArc = arcs.reduce((a, b) => a + b, 0) || 1;
    // 抬笔空窗：段越多，空窗越短，但不少于 8% 的块时长
    const gapShare = Math.min(0.1, 0.02 + 0.012 * list.length);
    let cursor = base;
    list.forEach((s, i) => {
      const share = (arcs[i] / totalArc) * (blockSpan * (1 - gapShare));
      s.d = cursor;
      s.a = Math.max(0.015, share);
      cursor += share + (blockSpan * gapShare) / Math.max(1, list.length - 1);
    });
  }

  // 收口：最后一笔必须在 0.8 之前结束
  for (const s of strokes) {
    const end = s.d + s.a;
    if (end > WRITE_END) {
      const scale = (WRITE_END - s.d) / (end - s.d);
      s.a *= Math.max(0.2, scale);
    }
  }
}

function arcLength(pts: StrokePoint[]): number {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

function boundsOf(glyphs: PlacedGlyph[]) {
  if (!glyphs.length) return { x: 0, y: 0, w: 0, h: 0 };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const g of glyphs) {
    const s = g.size / NOMINAL_PX;
    x0 = Math.min(x0, g.x);
    x1 = Math.max(x1, g.x + g.glyph.adv * s);
    y0 = Math.min(y0, g.y - g.glyph.asc * s);
    y1 = Math.max(y1, g.y);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** 当前帧每一笔的进度 0–1，导出与预览共用 */
export function strokeProgress(s: PlacedStroke, t: number): number {
  if (t <= s.d) return 0;
  if (t >= s.d + s.a) return 1;
  const k = (t - s.d) / s.a;
  // 起笔快、收笔慢，比线性更像手写
  return k < 0.75 ? Math.pow(k / 0.75, 0.9) * 0.85 : 0.85 + ((k - 0.75) / 0.25) * 0.15;
}
