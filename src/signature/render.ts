import { STAGE_BG } from '../config';
import type { Art, PlacedGlyph, PlacedStroke } from './layout';
import { strokeProgress } from './layout';
import { drawDeco, drawSparks, makeSparks, SPARK_START } from './effects';
import type { Spark } from './effects';

export type Quality = 'lo' | 'hi';

const FONT_FAMILY = '"Caveat", "Segoe Script", "Ink Free", "Bradley Hand", cursive';

/**
 * 画一个字的“肉”：拉丁字符用 fillText，汉字用笔画矢量轮廓直接填充。
 * 汉字那条路不吃字体，笔形完全由数据决定，所以在任何机器上都长一样。
 */
function drawGlyphInk(ctx: CanvasRenderingContext2D, g: PlacedGlyph) {
  const gp = g.glyph;
  if (!gp.paths) {
    ctx.fillText(g.ch, g.x, g.y);
    return;
  }
  const scale = g.size / 1024;
  ctx.save();
  // 笔画数据的 y 轴向上（基线 y=0），屏幕 y 向下，所以这里把 y 翻过来
  ctx.translate(g.x, g.y);
  ctx.scale(scale, -scale);
  // 宋体级笔画在签名里偏瘦，按 1.2% em 描一圈同色边把墨迹加粗一档（笔形不变，只是长肉）
  const bold = ctx.lineWidth;
  ctx.lineWidth = 12;
  ctx.lineJoin = 'round';
  for (const p of gp.paths) {
    ctx.fill(p);
    ctx.stroke(p);
  }
  ctx.lineWidth = bold;
  ctx.restore();
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
    }
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
      drawGlyphInk(ictx, g);
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
      drawGlyphInk(sctx, g);
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

    // 收尾泛光：写完才慢慢晕开，不靠每帧 shadowBlur
    if (this.glow && t > BLOOM_START) {
      const a = Math.min(1, (t - BLOOM_START) / (1 - BLOOM_START));
      ctx.globalAlpha = a * a;
      ctx.globalCompositeOperation = 'lighter';
      ctx.drawImage(this.glow, 0, 0);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }

    // 装饰：收尾弹出
    if (art.deco) {
      const d = art.deco;
      const local = (t - d.at) / 0.06;
      if (local > 0) {
        const kk = Math.min(1, local);
        drawDeco(ctx, d.kind, d.x, d.y, d.r, d.color, Math.min(1, kk * 2), easeOutBack(kk));
      }
    }

    if (opts.quality === 'hi') {
      drawSparks(ctx, this.sparks, t, SPARK_START);
    }
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
    }
  }
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
