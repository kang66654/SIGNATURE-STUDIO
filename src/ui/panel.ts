import type { Config, Deco, Ratio, Res } from '../config';

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
  deco.addEventListener('change', () => onChange({ deco: deco.value as Deco }));

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

  // 输入框回车直接收起焦点，避免手机键盘挡住预览
  for (const input of [nameA, nameB]) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
    });
  }

  sync(initial);

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
