import { STAGE_BG } from '../config';
import type { WriteStyle } from '../config';
import type { Art, PlacedGlyph, PlacedStroke } from './layout';
import { strokeProgress, WRITE_END, WRITE_START } from './layout';
import {
  dotsForStroke,
  drawDeco,
  drawRipple,
  drawSeal,
  drawSparks,
  drawTrail,
  makeSparks,
  SPARK_START,
} from './effects';
import type { Spark } from './effects';

export type Quality = 'lo' | 'hi';

const FONT_FAMILY = '"Caveat", "Segoe Script", "Ink Free", "Bradley Hand", cursive';

/** 字形风格的三组参数：倾斜（正=右倾）、描边加粗（1024 em 单位）、是否有连笔 */
interface StyleParams {
  lean: number;
  bold: number;
  ligature: boolean;
}

const STYLE_PARAMS: Record<WriteStyle, StyleParams> = {
  ink: { lean: 0.02, bold: 12, ligature: false },
  brush: { lean: 0.06, bold: 21, ligature: false },
  signature: { lean: 0.16, bold: 17, ligature: true },
  round: { lean: 0.03, bold: 25, ligature: false },
};

/**
 * 画一个字的“肉”：拉丁字符用 fillText，汉字用笔画矢量轮廓直接填充。
 * 汉字那条路不吃字体，笔形完全由数据决定，所以在任何机器上都长一样。
 */
function drawGlyphInk(ctx: CanvasRenderingContext2D, g: PlacedGlyph, style: WriteStyle = 'ink') {
  const gp = g.glyph;
  const sp = STYLE_PARAMS[style];
  ctx.save();
  // 倾斜作用在屏幕坐标里：基线上不动、字头往右倒，像快速连笔的手写
  ctx.translate(g.x, g.y);
  if (sp.lean) ctx.transform(1, 0, -sp.lean, 1, 0, 0);

  if (!gp.paths) {
    ctx.fillText(g.ch, 0, 0);
    if (sp.bold > 12) {
      // 拉丁也用同色描边把笔画压粗一档，粗细口径与汉字一致
      ctx.lineWidth = ((sp.bold - 12) / 1024) * g.size;
      ctx.lineJoin = 'round';
      ctx.strokeText(g.ch, 0, 0);
    }
    ctx.restore();
    return;
  }

  const scale = g.size / 1024;
  // 笔画数据的 y 轴向上（基线 y=0），屏幕 y 向下，所以这里把 y 翻过来
  ctx.scale(scale, -scale);
  ctx.lineWidth = sp.bold;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (const p of gp.paths) {
    ctx.fill(p);
    ctx.stroke(p);
  }
  if (sp.ligature) drawLigatures(ctx, g);
  ctx.restore();
}

/** 连笔：把上一笔的收笔处轻轻接到下一笔的起笔处，签名才有“一笔写下来”的味道 */
function drawLigatures(ctx: CanvasRenderingContext2D, g: PlacedGlyph) {
  const strokes = g.glyph.strokes;
  if (strokes.length < 2) return;
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 8;
  for (let i = 1; i < strokes.length; i++) {
    const a = strokes[i - 1].pts[strokes[i - 1].pts.length - 1];
    const b = strokes[i].pts[0];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    // 只连挨得近的两笔，否则会甩出一条跑到字外的假笔画
    if (len > 18 || len < 3) continue;
    const cx = (a.x + b.x) / 2 + Math.max(-6, Math.min(6, dy * 0.18));
    const cy = (a.y + b.y) / 2 - len * 0.16;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(cx, cy, b.x, b.y);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/** 泛光开始收尾的比例：写字期间不亮，写完才“晕开” */
const BLOOM_START = 0.74;

export interface RenderOpts {
  quality: Quality;
}

/**
 * 场景渲染器：墨迹与泛光按参数指纹缓存一次，之后每帧只重画遮罩与收尾特效。
 * 同一 t 输出的画面必须完全一致——导出依赖这一点。
 */
export class Scene {
  /** 清晰墨迹（不含泛光） */
  private base: HTMLCanvasElement | null = null;
  /** 泛光层，收尾时整层叠上去 */
  private glow: HTMLCanvasElement | null = null;
  private baseKey = '';
  private mask: HTMLCanvasElement | null = null;
  private layer: HTMLCanvasElement | null = null;
  private art: Art | null = null;
  private sparks: Spark[] = [];
  private maskImg: ImageData | null = null;
  /** 印章里那个“字”的预渲染图，避免每帧重画轮廓 */
  private sealGlyph: HTMLCanvasElement | null = null;
  private W = 0;
  private H = 0;

  /** 低质量档只烤墨迹、不做泛光，拖动时省一半时间 */
  setArt(art: Art, quality: Quality = 'hi') {
    const key = `${art.key}|${art.W}x${art.H}|${quality}`;
    const sizeChanged = this.W !== art.W || this.H !== art.H;
    this.art = art;
    if (key !== this.baseKey || sizeChanged || !this.base) {
      this.W = art.W;
      this.H = art.H;
      this.mask = makeCanvas(art.mapW, art.mapH);
      this.maskImg = null;
      this.layer = makeCanvas(art.W, art.H);
      this.bake(art, quality);
      this.baseKey = key;
      this.sparks = makeSparks(art);
      this.sealGlyph = this.bakeSealGlyph(art);
    }
  }

  /** 印章里的首字：单独烤一张小图，颜色走第二色 */
  private bakeSealGlyph(art: Art): HTMLCanvasElement | null {
    const g = art.glyphs[0];
    if (!g) return null;
    const side = 256;
    const c = makeCanvas(side, side);
    const cx = c.getContext('2d')!;
    const temp: PlacedGlyph = { ...g, x: side / 2 - side * 0.34, y: side * 0.86, size: side * 0.62, color: art.deco?.color ?? g.color };
    cx.textBaseline = 'alphabetic';
    cx.font = `${temp.size}px ${FONT_FAMILY}`;
    cx.fillStyle = temp.color;
    cx.strokeStyle = temp.color;
    drawGlyphInk(cx, temp, art.style);
    return c;
  }

  /** 底图：清晰墨迹一层；泛光另存一层（1/4 分辨率两次模糊，放大回来） */
  private bake(art: Art, quality: Quality) {
    const ink = makeCanvas(art.W, art.H);
    const ictx = ink.getContext('2d')!;
    ictx.textBaseline = 'alphabetic';
    for (const g of art.glyphs) {
      ictx.font = `${g.size}px ${FONT_FAMILY}`;
      ictx.fillStyle = g.color;
      ictx.strokeStyle = g.color;
      drawGlyphInk(ictx, g, art.style);
    }
    this.base = ink;

    if (quality === 'lo') {
      this.glow = null;
      return;
    }

    const k = 4;
    const small = makeCanvas(Math.round(art.W / k), Math.round(art.H / k));
    const sctx = small.getContext('2d')!;
    sctx.textBaseline = 'alphabetic';
    sctx.scale(1 / k, 1 / k);
    for (const g of art.glyphs) {
      sctx.font = `${g.size}px ${FONT_FAMILY}`;
      sctx.fillStyle = g.color;
      sctx.strokeStyle = g.color;
      drawGlyphInk(sctx, g, art.style);
    }
    sctx.setTransform(1, 0, 0, 1, 0, 0);

    const glow = makeCanvas(art.W, art.H);
    const gctx = glow.getContext('2d')!;
    gctx.globalCompositeOperation = 'lighter';
    for (const layer of [
      { blur: 3.2, alpha: 0.34 },
      { blur: 11, alpha: 0.16 },
    ]) {
      const blur = makeCanvas(small.width, small.height);
      const bctx = blur.getContext('2d')!;
      bctx.filter = `blur(${layer.blur}px)`;
      bctx.drawImage(small, 0, 0);
      gctx.globalAlpha = layer.alpha;
      gctx.drawImage(blur, 0, 0, art.W, art.H);
    }
    gctx.globalAlpha = 1;
    this.glow = glow;
  }

  draw(ctx: CanvasRenderingContext2D, t: number, opts: RenderOpts) {
    const art = this.art;
    if (!art || !this.base || !this.mask || !this.layer) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    paintBackground(ctx, art, t);
    this.drawInk(t, opts);
    ctx.drawImage(this.layer!, 0, 0);

    // 收尾泛光：写完才慢慢晕开，不靠每帧 shadowBlur；勾了呼吸效果就随时间脉动
    if (this.glow && t > BLOOM_START) {
      const a = Math.min(1, (t - BLOOM_START) / (1 - BLOOM_START));
      const pulse = art.effects.includes('pulse')
        ? 0.78 + 0.22 * Math.sin((t - BLOOM_START) * Math.PI * 3.2)
        : 1;
      ctx.globalAlpha = a * a * pulse;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.glow, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    if (opts.quality === 'hi' && art.effects.includes('ripple')) {
      const d = art.deco;
      drawRipple(
        ctx,
        art.box.x + art.box.w / 2,
        art.box.y + art.box.h * 0.55,
        art.box.w * 0.55,
        d ? d.color : '#FFFFFF',
        t,
        WRITE_END,
        art.glyphs[art.glyphs.length - 1].color,
      );
    }

    if (art.deco) this.drawDecoration(ctx, art, t, opts);

    if (opts.quality === 'hi' && art.effects.includes('seal')) {
      const at = 0.88;
      const local = (t - at) / 0.07;
      if (local > 0) {
        const kk = Math.min(1, local);
        const size = Math.min(art.H, art.W) * 0.1;
        // 印章落在名字右下角外侧，不压字；出界时自动往里收
        const cx = Math.min(art.W - size * 0.6, art.box.x + art.box.w + size * 0.42);
        const cy = Math.min(art.H - size * 0.5, art.box.y + art.box.h + size * 0.1);
        drawSeal(
          ctx,
          cx,
          cy,
          size,
          art.glyphs[art.glyphs.length - 1].color,
          Math.min(1, kk * 1.6),
          this.sealGlyph,
        );
      }
    }

    if (opts.quality === 'hi') {
      drawSparks(ctx, this.sparks, t, SPARK_START);
    }
  }

  /** 装饰的入场：弹出 / 跟着笔尖跑 / 入场后悬浮漂移 */
  private drawDecoration(ctx: CanvasRenderingContext2D, art: Art, t: number, opts: RenderOpts) {
    const d = art.deco!;
    const r = d.r;

    if (art.decoMotion === 'follow') {
      const tip = opts.quality === 'hi' ? activeTip(art, t) : null;
      const write = Math.min(1, Math.max(0, (t - WRITE_START) / (WRITE_END - WRITE_START)));
      if (tip && write < 1) {
        // 写字时缩到笔尖旁边跟着走，写得越多越往锚点靠
        const ease = write * write;
        const x = tip.x * (1 - ease) + d.x * ease + r * 0.7;
        const y = tip.y * (1 - ease) + d.y * ease - r * 0.5;
        drawDeco(ctx, d.kind, x, y, r, d.color, 0.9, 0.62 + 0.38 * ease, Math.sin(t * Math.PI * 6) * 0.16);
      } else if (t > d.at) {
        const kk = Math.min(1, (t - d.at) / 0.06);
        drawDeco(ctx, d.kind, d.x, d.y, r, d.color, Math.min(1, kk * 2), easeOutBack(kk));
      }
      return;
    }

    if (t <= d.at) return;
    const local = (t - d.at) / 0.06;
    const kk = Math.min(1, local);
    if (art.decoMotion === 'drift') {
      // 入场后一直轻轻上下浮 + 小幅摆动，整段时间都有动作
      const ph = (t - d.at) * Math.PI * 2.4;
      const y = d.y + Math.sin(ph) * r * 0.22;
      const rot = Math.sin(ph * 0.5) * 0.16;
      drawDeco(ctx, d.kind, d.x, y, r, d.color, Math.min(1, kk * 2), easeOutBack(kk), rot);
      return;
    }
    drawDeco(ctx, d.kind, d.x, d.y, r, d.color, Math.min(1, kk * 2), easeOutBack(kk));
  }

  /** 每帧：按登场时间图生成遮罩，再以 destination-in 把墨迹“刷”出来 */
  private drawInk(t: number, opts: RenderOpts) {
    const art = this.art!;
    const lctx = this.layer!.getContext('2d')!;
    lctx.clearRect(0, 0, art.W, art.H);
    lctx.globalCompositeOperation = 'source-over';
    lctx.drawImage(this.base!, 0, 0);

    // 写完就整幅墨迹直接用，省掉一次逐像素扫描
    if (t >= 1) {
      lctx.globalCompositeOperation = 'source-over';
      return;
    }

    const mctx = this.mask!.getContext('2d')!;
    if (!this.maskImg || this.maskImg.width !== art.mapW) {
      this.maskImg = mctx.createImageData(art.mapW, art.mapH);
    }
    const img = this.maskImg;
    const px = img.data;
    const mapData = art.map;
    const cut = Math.round(t * 254) + 1;
    for (let i = 0, p = 0; i < mapData.length; i++, p += 4) {
      const on = mapData[i] !== 0 && mapData[i] <= cut;
      px[p] = 255;
      px[p + 1] = 255;
      px[p + 2] = 255;
      px[p + 3] = on ? 255 : 0;
    }
    mctx.putImageData(img, 0, 0);

    lctx.globalCompositeOperation = 'destination-in';
    lctx.drawImage(this.mask!, 0, 0, art.W, art.H);
    lctx.globalCompositeOperation = 'source-over';

    // 笔尖辉光：跟着正在写的那一笔走
    if (opts.quality === 'hi') {
      const tip = activeTip(art, t);
      if (tip) {
        const r = Math.max(5, tip.w * 1.6);
        const g = lctx.createRadialGradient(tip.x, tip.y, 0, tip.x, tip.y, r);
        g.addColorStop(0, 'rgba(255,255,255,.16)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        lctx.globalCompositeOperation = 'lighter';
        lctx.fillStyle = g;
        lctx.beginPath();
        lctx.arc(tip.x, tip.y, r, 0, Math.PI * 2);
        lctx.fill();
        lctx.globalCompositeOperation = 'source-over';
      }

      if (art.effects.includes('trail')) {
        const tail = strokeTail(art, t);
        if (tail) drawTrail(lctx, tail.pts, tail.color, 1);
      }
      if (art.effects.includes('splash')) drawSplash(lctx, art, t);
    }
  }
}

/** 沿当前笔画往回取一段（最多 14 个点），给拖尾用 */
function strokeTail(art: Art, t: number): { pts: Array<{ x: number; y: number; w: number }>; color: string } | null {
  for (const s of art.strokes) {
    if (t < s.d || t > s.d + s.a) continue;
    const p = strokeProgress(s, t);
    if (p <= 0 || p >= 1) continue;
    const n = s.pts.length;
    const upto = Math.max(2, Math.round((n - 1) * p) + 1);
    const from = Math.max(0, upto - 14);
    return { pts: s.pts.slice(from, upto), color: s.color };
  }
  return null;
}

/** 墨点飞溅：笔画推进到某个位置时，从笔尖甩出几颗小墨点，飞出去再淡掉 */
function drawSplash(ctx: CanvasRenderingContext2D, art: Art, t: number) {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  art.strokes.forEach((s, si) => {
    const age = t - s.d;
    if (age <= 0 || t > s.d + s.a + 0.12) return;
    const p = strokeProgress(s, t);
    const dots = dotsForStroke(si);
    for (const dot of dots) {
      if (p < dot.at) continue;
      const since = (t - s.d) / Math.max(0.001, s.a);
      const k = Math.min(1, (since - dot.at * 0.9) / 0.2);
      if (k >= 1 || k < 0) continue;
      const base = s.pts[Math.min(s.pts.length - 1, Math.round((s.pts.length - 1) * dot.at))];
      const dir = Math.atan2(1, 0) + dot.angle;
      const dist = dot.dist * (1 - Math.pow(1 - k, 2));
      const x = base.x + Math.cos(dir) * dist;
      const y = base.y + Math.sin(dir) * dist + dist * 0.35;
      const r = Math.max(0.8, dot.r * (1 - k * 0.5));
      ctx.globalAlpha = (1 - k) * 0.5;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  ctx.restore();
}

/** 当前正在推进的那一笔，返回笔尖位置；没有就返回 null */
function activeTip(art: Art, t: number): { x: number; y: number; w: number } | null {
  let best: { x: number; y: number; w: number } | null = null;
  for (const s of art.strokes) {
    if (t < s.d || t > s.d + s.a) continue;
    const p = strokeProgress(s, t);
    if (p <= 0 || p >= 1) continue;
    const n = s.pts.length;
    const idx = Math.min(n - 2, Math.floor((n - 1) * p));
    const frac = (n - 1) * p - idx;
    const a = s.pts[idx];
    const b = s.pts[idx + 1] ?? a;
    best = { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac, w: a.w };
  }
  return best;
}

function paintBackground(ctx: CanvasRenderingContext2D, art: Art, t: number) {
  const { W, H } = art;
  ctx.fillStyle = STAGE_BG;
  ctx.fillRect(0, 0, W, H);
  const breathe = 0.5 + 0.5 * Math.sin(Math.min(1, t) * Math.PI * 1.1);
  const g = ctx.createRadialGradient(W * 0.5, H * 0.46, 0, W * 0.5, H * 0.46, Math.max(W, H) * 0.7);
  g.addColorStop(0, `rgba(24,32,58,${0.55 + 0.12 * breathe})`);
  g.addColorStop(0.55, 'rgba(12,16,28,.55)');
  g.addColorStop(1, 'rgba(5,7,12,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

function easeOutBack(k: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(k - 1, 3) + c1 * Math.pow(k - 1, 2);
}

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** 导出时复用：从 Art 直接建场景 */
export function makeScene(art: Art): Scene {
  const s = new Scene();
  s.setArt(art);
  return s;
}

export type { PlacedStroke };
