export type Deco =
  | 'sun'
  | 'moon'
  | 'star'
  | 'sparkle'
  | 'heart'
  | 'cat'
  | 'dog'
  | 'cloud'
  | 'bolt'
  | 'flame'
  | 'crown'
  | 'note'
  | 'leaf'
  | 'planet'
  | 'none';
export type Ratio = '16:9' | '9:16' | '1:1';
export type Res = '1080' | '720';
/** 字形风格：直接作用在墨迹层，决定“像哪种笔写的” */
export type WriteStyle = 'ink' | 'brush' | 'signature' | 'round';
/** 装饰的入场方式：静止弹出 / 跟着笔尖走 / 悬浮漂移 */
export type DecoMotion = 'pop' | 'follow' | 'drift';
/** 随时间轴运动的效果层，可多选 */
export type Effect = 'trail' | 'splash' | 'pulse' | 'seal' | 'ripple';

export interface Config {
  nameA: string;
  nameB: string;
  colorA: string;
  colorB: string;
  scaleA: number;
  scaleB: number;
  deco: Deco;
  decoScale: number;
  decoMotion: DecoMotion;
  style: WriteStyle;
  effects: Effect[];
  duration: number;
  ratio: Ratio;
  res: Res;
}

export const DEFAULT_CONFIG: Config = {
  nameA: 'Taiyang',
  nameB: 'yueliang',
  colorA: '#FFFFFF',
  colorB: '#FFC0CC',
  scaleA: 1.5,
  scaleB: 1.6,
  deco: 'sun',
  decoScale: 0.7,
  decoMotion: 'pop',
  style: 'brush',
  effects: ['trail', 'pulse'],
  duration: 5,
  ratio: '16:9',
  res: '1080',
};

export const STAGE_BG = '#05070C';

/** 输出画布尺寸：基准短边由分辨率与比例共同决定 */
export function stageSize(cfg: Config): { W: number; H: number } {
  const base = cfg.res === '1080' ? 1080 : 720;
  if (cfg.ratio === '16:9') return { W: Math.round((base * 16) / 9 / 2) * 2, H: base };
  if (cfg.ratio === '9:16') return { W: base, H: Math.round((base * 16) / 9 / 2) * 2 };
  return { W: base, H: base };
}

const DECOS: Deco[] = [
  'sun', 'moon', 'star', 'sparkle', 'heart', 'cat', 'dog', 'cloud',
  'bolt', 'flame', 'crown', 'note', 'leaf', 'planet', 'none',
];
const RATIOS: Ratio[] = ['16:9', '9:16', '1:1'];
const STYLES: WriteStyle[] = ['ink', 'brush', 'signature', 'round'];
const MOTIONS: DecoMotion[] = ['pop', 'follow', 'drift'];
const EFFECTS: Effect[] = ['trail', 'splash', 'pulse', 'seal', 'ripple'];

export function encodeHash(cfg: Config): string {
  const p = new URLSearchParams();
  p.set('a', cfg.nameA);
  p.set('b', cfg.nameB);
  p.set('ca', cfg.colorA.replace('#', ''));
  p.set('cb', cfg.colorB.replace('#', ''));
  p.set('sa', cfg.scaleA.toFixed(2));
  p.set('sb', cfg.scaleB.toFixed(2));
  p.set('d', cfg.deco);
  p.set('ds', cfg.decoScale.toFixed(2));
  p.set('dm', cfg.decoMotion);
  p.set('w', cfg.style);
  p.set('fx', cfg.effects.join(','));
  p.set('t', String(cfg.duration));
  p.set('r', cfg.ratio);
  p.set('q', cfg.res);
  return p.toString();
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

export function decodeHash(hash: string): Config {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const num = (k: string, d: number) => {
    const v = parseFloat(p.get(k) ?? '');
    return Number.isFinite(v) ? v : d;
  };
  const hex = (k: string, d: string) => {
    const v = (p.get(k) ?? '').toLowerCase();
    return /^[0-9a-f]{6}$/.test(v) ? `#${v.toUpperCase()}` : d;
  };
  const deco = (p.get('d') ?? '') as Deco;
  const ratio = (p.get('r') ?? '') as Ratio;
  const style = (p.get('w') ?? '') as WriteStyle;
  const motion = (p.get('dm') ?? '') as DecoMotion;
  const fxRaw = p.get('fx');
  const effects = fxRaw === null
    ? DEFAULT_CONFIG.effects
    : (fxRaw.split(',').map((s) => s.trim()).filter((s) => EFFECTS.includes(s as Effect)) as Effect[]);
  return {
    nameA: (p.get('a') ?? DEFAULT_CONFIG.nameA).slice(0, 12),
    nameB: (p.get('b') ?? DEFAULT_CONFIG.nameB).slice(0, 12),
    colorA: hex('ca', DEFAULT_CONFIG.colorA),
    colorB: hex('cb', DEFAULT_CONFIG.colorB),
    scaleA: clamp(num('sa', DEFAULT_CONFIG.scaleA), 0.8, 2.2),
    scaleB: clamp(num('sb', DEFAULT_CONFIG.scaleB), 0.8, 2.2),
    deco: DECOS.includes(deco) ? deco : DEFAULT_CONFIG.deco,
    decoScale: clamp(num('ds', DEFAULT_CONFIG.decoScale), 0.4, 1.2),
    decoMotion: MOTIONS.includes(motion) ? motion : DEFAULT_CONFIG.decoMotion,
    style: STYLES.includes(style) ? style : DEFAULT_CONFIG.style,
    effects: [...new Set(effects)],
    duration: clamp(Math.round(num('t', DEFAULT_CONFIG.duration)), 3, 10),
    ratio: RATIOS.includes(ratio) ? ratio : DEFAULT_CONFIG.ratio,
    res: p.get('q') === '720' ? '720' : '1080',
  };
}
