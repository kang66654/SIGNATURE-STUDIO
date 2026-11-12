import type { CJKFontKey, Config, Deco, DecoMotion, Effect, Ratio, Res, WriteStyle } from '../config';

type Patch = (patch: Partial<Config>) => void;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`缺少 DOM 节点 #${id}`);
  return node as T;
}

/** 把面板与配置双向绑定：控件改配置，配置也能推回控件 */
export function mountPanel(initial: Config, onChange: Patch) {
  const nameA = el<HTMLInputElement>('nameA');
  const nameB = el<HTMLInputElement>('nameB');
  const colorA = el<HTMLInputElement>('colorA');
  const colorB = el<HTMLInputElement>('colorB');
  const colorAHex = el<HTMLElement>('colorAHex');
  const colorBHex = el<HTMLElement>('colorBHex');
  const scaleA = el<HTMLInputElement>('scaleA');
  const scaleB = el<HTMLInputElement>('scaleB');
  const scaleAVal = el<HTMLElement>('scaleAVal');
  const scaleBVal = el<HTMLElement>('scaleBVal');
  const deco = el<HTMLSelectElement>('deco');
  const decoMotion = el<HTMLSelectElement>('decoMotion');
  const style = el<HTMLSelectElement>('style');
  const cjkFont = el<HTMLSelectElement>('cjkFont');
  const effectsBox = el<HTMLElement>('effects');
  const effectInputs = Array.from(effectsBox.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
  const decoScale = el<HTMLInputElement>('decoScale');
  const decoScaleVal = el<HTMLElement>('decoScaleVal');
  const duration = el<HTMLInputElement>('duration');
  const durationVal = el<HTMLElement>('durationVal');
  const ratio = el<HTMLElement>('ratio');
  const res = el<HTMLElement>('res');

  function sync(cfg: Config) {
    nameA.value = cfg.nameA;
    nameB.value = cfg.nameB;
    colorA.value = cfg.colorA;
    colorB.value = cfg.colorB;
    colorAHex.textContent = cfg.colorA;
    colorBHex.textContent = cfg.colorB;
    scaleA.value = String(cfg.scaleA);
    scaleB.value = String(cfg.scaleB);
    scaleAVal.textContent = `${cfg.scaleA.toFixed(2)}×`;
    scaleBVal.textContent = `${cfg.scaleB.toFixed(2)}×`;
    deco.value = cfg.deco;
    decoMotion.value = cfg.decoMotion;
    style.value = cfg.style;
    cjkFont.value = cfg.cjkFont;
    for (const input of effectInputs) {
      input.checked = cfg.effects.includes(input.value as Effect);
    }
    decoScale.value = String(cfg.decoScale);
    decoScaleVal.textContent = `${cfg.decoScale.toFixed(2)}×`;
    duration.value = String(cfg.duration);
    durationVal.textContent = `${cfg.duration.toFixed(1)}s`;
    for (const b of ratio.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-value') === cfg.ratio));
    }
    for (const b of res.querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-value') === cfg.res));
    }
  }

  nameA.addEventListener('input', () => onChange({ nameA: nameA.value.slice(0, 12) }));
  nameB.addEventListener('input', () => onChange({ nameB: nameB.value.slice(0, 12) }));
  colorA.addEventListener('input', () => {
    colorAHex.textContent = colorA.value.toUpperCase();
    onChange({ colorA: colorA.value.toUpperCase() });
  });
  colorB.addEventListener('input', () => {
    colorBHex.textContent = colorB.value.toUpperCase();
    onChange({ colorB: colorB.value.toUpperCase() });
  });
  for (const [input, label, key] of [
    [scaleA, scaleAVal, 'scaleA'],
    [scaleB, scaleBVal, 'scaleB'],
    [decoScale, decoScaleVal, 'decoScale'],
  ] as const) {
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      label.textContent = `${v.toFixed(2)}×`;
      onChange({ [key]: v } as Partial<Config>);
    });
  }
  duration.addEventListener('input', () => {
    const v = parseFloat(duration.value);
    durationVal.textContent = `${v.toFixed(1)}s`;
    onChange({ duration: v });
  });
  deco.addEventListener('change', () => {
    renderHint();
    onChange({ deco: deco.value as Deco });
  });
  decoMotion.addEventListener('change', () => {
    renderHint();
    onChange({ decoMotion: decoMotion.value as DecoMotion });
  });
  style.addEventListener('change', () => onChange({ style: style.value as WriteStyle }));
  cjkFont.addEventListener('change', () => onChange({ cjkFont: cjkFont.value as CJKFontKey }));
  effectsBox.addEventListener('change', () => {
    onChange({ effects: effectInputs.filter((i) => i.checked).map((i) => i.value as Effect) });
  });

  const segHandler = (root: HTMLElement, key: 'ratio' | 'res') => {
    root.addEventListener('click', (event) => {
      const btn = (event.target as HTMLElement).closest('button[data-value]');
      if (!btn) return;
      const value = btn.getAttribute('data-value')!;
      root.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
      btn.setAttribute('aria-pressed', 'true');
      onChange({ [key]: value } as Partial<Config>);
    });
  };
  segHandler(ratio, 'ratio');
  segHandler(res, 'res');

  // 装饰 × 动作的适配提示：不同动作对图形本身有偏好，直接写在面板里，别让用户自己猜
  const MOTION_HINT: Record<Deco, { best: DecoMotion; why: string }> = {
    sun: { best: 'orbit', why: '太阳适合绕字公转，像给名字打光' },
    planet: { best: 'orbit', why: '星球绕字转圈最像行星轨道' },
    star: { best: 'spin', why: '星星自旋入场，闪一下才亮' },
    sparkle: { best: 'spin', why: '闪光自旋 + 缩放，收尾最抓眼' },
    crown: { best: 'drop', why: '皇冠从上方落下弹跳，像戴到字头上' },
    bolt: { best: 'drop', why: '闪电从上砸下来，弹一下更利落' },
    flame: { best: 'swing', why: '火焰左右晃，像被风吹着烧' },
    note: { best: 'swing', why: '音符钟摆式摇摆，像在打拍子' },
    leaf: { best: 'drift', why: '叶子本来就该慢慢飘' },
    cloud: { best: 'drift', why: '云朵悬浮漂移最自然' },
    moon: { best: 'breathe', why: '月亮呼吸式明暗起伏' },
    heart: { best: 'breathe', why: '爱心一胀一缩，最像心跳' },
    cat: { best: 'pop', why: '猫耳贴住字头弹出，不宜乱飞' },
    dog: { best: 'pop', why: '小狗弹出后停住，跟着晃会怪' },
    none: { best: 'pop', why: '没有装饰时动作无效' },
  };
  const motionHint = document.getElementById('motionHint');
  const renderHint = () => {
    if (!motionHint) return;
    const h = MOTION_HINT[deco.value as Deco] ?? MOTION_HINT.sun;
    const cur = decoMotion.value as DecoMotion;
    const label: Record<DecoMotion, string> = {
      pop: '收尾弹出',
      follow: '跟随笔尖',
      drift: '悬浮漂移',
      orbit: '绕字旋转',
      drop: '落下弹跳',
      spin: '自旋入场',
      swing: '钟摆摇晃',
      breathe: '呼吸缩放',
    };
    motionHint.textContent =
      cur === h.best
        ? `适配：${label[cur]} —— ${h.why}`
        : `建议换成「${label[h.best]}」：${h.why}。当前「${label[cur]}」也能跑，只是没那么贴。`;
    motionHint.classList.remove('warn');
    if (cur !== h.best) motionHint.classList.add('warn');
  };

  // 输入框回车直接收起焦点，避免手机键盘挡住预览
  for (const input of [nameA, nameB]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  }

  sync(initial);
  renderHint();

  return {
    sync,
    setMissing(text: string | null) {
      const note = document.getElementById('missingNote');
      if (!note) return;
      if (!text) {
        note.hidden = true;
        note.textContent = '';
        return;
      }
      note.hidden = false;
      note.textContent = text;
      note.classList.add('warn');
    },
    ratio: initial.ratio as Ratio,
    res: initial.res as Res,
  };
}
