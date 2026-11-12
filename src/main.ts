import { DEFAULT_CONFIG, decodeHash, encodeHash } from './config';
import type { Config } from './config';
import { buildArt } from './signature/layout';
import { Scene } from './signature/render';
import { clearGlyphCache, warmGlyphFont } from './signature/skeleton';
import { ensureCjkFont } from './signature/cjkfont';
import { exportMp4, hasWebCodecs } from './export/mp4';
import { exportWebm, pickWebmMime } from './export/webm';
import { mountPanel } from './ui/panel';
import { toast } from './ui/toast';

const stageEl = document.getElementById('stage');
if (!(stageEl instanceof HTMLCanvasElement)) throw new Error('缺少 #stage');
const stage: HTMLCanvasElement = stageEl;
const ctx = stage.getContext('2d', { alpha: false })!;

let cfg: Config = location.hash.length > 1 ? decodeHash(location.hash) : DEFAULT_CONFIG;

const scene = new Scene();
let art = buildArt(cfg);
let hiTimer = 0;
let loPending = false;
let raf = 0;
let playing = false;
let exporting = false;

/* ------------------------------------------------------------ 渲染 */

function applyArt(quality: 'lo' | 'hi') {
  art = buildArt(cfg);
  if (stage.width !== art.W || stage.height !== art.H) {
    stage.width = art.W;
    stage.height = art.H;
  }
  scene.setArt(art, quality);
  stage.style.aspectRatio = `${art.W} / ${art.H}`;
  updateSpecs();
  updateMissing();
  // 方便本地调试 / 自动化验收读取真实排版数据
  (window as unknown as { __art: typeof art }).__art = art;
  (window as unknown as { __scene: typeof scene }).__scene = scene;
  // 参数变过之后停在“写完”的那一帧，除非正在播放
  if (!playing) scene.draw(ctx, 1, { quality });
}

function updateSpecs() {
  const specs = document.getElementById('specs');
  if (!specs) return;
  const total = Math.round(cfg.duration * 30);
  specs.textContent = `${art.W}×${art.H} · 30fps · ${cfg.duration.toFixed(1)}s · ${total} 帧`;
}

function updateMissing() {
  const fallback = [...new Set(art.fontFallback)].join(' ');
  if (art.missing.length) {
    const list = [...new Set(art.missing)].join(' ');
    panel.setMissing(
      `这些字符没有字形：${list}。可用范围＝拉丁字母、数字、常见标点，加 GB2312 全部 6763 个汉字（一级 3755 + 二级 3008）；GBK 扩展区生僻字（如「玥」「旻」）、日文假名、emoji 暂不支持。`,
    );
  } else if (fallback) {
    panel.setMissing(
      `所选手写字体只裁了常用字，「${fallback}」在里面没有字形，整个名字已改用内置楷书，避免一半毛笔一半楷书。`,
    );
  } else {
    panel.setMissing(null);
  }
}

function scheduleRebuild() {
  // 拖动中：下一帧用低质量档重画，保证跟手
  if (!loPending) {
    loPending = true;
    requestAnimationFrame(() => {
      loPending = false;
      applyArt('lo');
    });
  }
  // 松手 120ms 后：全质量重建（放进空闲时间，不和动画抢帧）
  window.clearTimeout(hiTimer);
  hiTimer = window.setTimeout(() => {
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (idle) idle(() => applyArt('hi'));
    else applyArt('hi');
  }, 120);
}

function play() {
  cancelAnimationFrame(raf);
  playing = true;
  const t0 = performance.now();
  const D = cfg.duration * 1000;
  const tick = (now: number) => {
    const t = Math.min(1, (now - t0) / D);
    scene.draw(ctx, t, { quality: 'hi' });
    if (t < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      playing = false;
    }
  };
  raf = requestAnimationFrame(tick);
}

/* ------------------------------------------------------------ 面板 */

const panel = mountPanel(cfg, (patch) => {
  cfg = { ...cfg, ...patch };
  scheduleRebuild();
  syncHash();
});

let hashTimer = 0;
function syncHash() {
  window.clearTimeout(hashTimer);
  hashTimer = window.setTimeout(() => {
    history.replaceState(null, '', `#${encodeHash(cfg)}`);
  }, 320);
}

/* ------------------------------------------------------------ 导出 */

function fileName(ext: string) {
  const name = `${cfg.nameA}${cfg.nameB ? `-${cfg.nameB}` : ''}`.replace(/[^\p{L}\p{N}-]/gu, '') || 'signature';
  return `signature-${name}-${art.W}x${art.H}.${ext}`;
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function setExportUI(on: boolean, label = '', ratio = 0, note = '') {
  const box = document.getElementById('exporting');
  const lab = document.getElementById('exportLabel');
  const bar = document.getElementById('exportBar');
  const nt = document.getElementById('exportNote');
  if (box) box.hidden = !on;
  if (lab && label) lab.textContent = label;
  if (bar) bar.style.width = `${Math.round(ratio * 100)}%`;
  if (nt && note) nt.textContent = note;
}

async function runExport(kind: 'mp4' | 'webm') {
  if (exporting) return;
  exporting = true;
  const btnMp4 = document.getElementById('export') as HTMLButtonElement | null;
  const btnWebm = document.getElementById('exportWebm') as HTMLButtonElement | null;
  if (btnMp4) btnMp4.disabled = true;
  if (btnWebm) btnWebm.disabled = true;

  const cancel = { value: false };
  const onCancel = () => {
    cancel.value = true;
  };
  document.getElementById('cancelExport')?.addEventListener('click', onCancel, { once: true });

  const total = Math.round(cfg.duration * 30);
  const startNote = hasWebCodecs() ? '离线帧循环 · 不读真实时钟' : '实时录制 · 草稿格式';
  setExportUI(true, `正在编码 0 / ${total} 帧`, 0, startNote);

  let progressRaf = 0;
  let displayRatio = 0;
  const paint = () => {
    const bar = document.getElementById('exportBar');
    if (bar) bar.style.width = `${Math.round(displayRatio * 100)}%`;
    progressRaf = requestAnimationFrame(paint);
  };
  progressRaf = requestAnimationFrame(paint);

  try {
    // 导出用独立场景，不干扰预览的画布与缓存
    const jobArt = buildArt(cfg);
    const jobScene = new Scene();
    jobScene.setArt(jobArt, 'hi');

    let blob: Blob;
    let ext: string;
    let frames: number;
    let ms = 0;

    const useMp4 = kind === 'mp4' && hasWebCodecs();
    if (useMp4) {
      const result = await exportMp4({
        scene: jobScene,
        art: jobArt,
        fps: 30,
        duration: cfg.duration,
        cancel,
        onProgress: (done, all) => {
          displayRatio = done / all;
          const lab = document.getElementById('exportLabel');
          if (lab) lab.textContent = `正在编码 ${done} / ${all} 帧`;
        },
      });
      blob = result.blob;
      ext = 'mp4';
      frames = result.frames;
      ms = result.elapsedMs;
    } else {
      const result = await exportWebm({
        scene: jobScene,
        art: jobArt,
        fps: 30,
        duration: cfg.duration,
        cancel,
        onProgress: (done, all) => {
          displayRatio = done / all;
          const lab = document.getElementById('exportLabel');
          if (lab) lab.textContent = `正在录制 ${done} / ${all} 帧`;
        },
      });
      blob = result.blob;
      ext = 'webm';
      frames = result.frames;
    }

    download(blob, fileName(ext));
    const kb = blob.size / 1024;
    toast(
      ext === 'mp4'
        ? `已导出 ${art.W}×${art.H} · ${frames} 帧 · ${(kb / 1024).toFixed(1)}MB · ${Math.round(ms)}ms`
        : `已导出 WebM 草稿（${frames} 帧，${(kb / 1024).toFixed(1)}MB）—— 正式 MP4 请在 Chrome 里导出`,
      3600,
    );
  } catch (err) {
    const message = (err as Error).message;
    if (message === 'CANCELLED') {
      toast('已取消导出');
    } else if (message === 'NO_WEBCODECS') {
      toast('当前浏览器没有 WebCodecs，正在改用 WebM 草稿格式…');
      exporting = false;
      cancelAnimationFrame(progressRaf);
      setExportUI(false);
      if (btnMp4) btnMp4.disabled = false;
      if (btnWebm) btnWebm.disabled = false;
      await runExport('webm');
      return;
    } else if (message === 'NO_MEDIARECORDER') {
      toast('这个浏览器既不支持 WebCodecs 也不支持 MediaRecorder，无法导出视频');
    } else {
      toast(`导出失败：${message}`);
    }
  } finally {
    cancelAnimationFrame(progressRaf);
    setExportUI(false);
    exporting = false;
    if (btnMp4) btnMp4.disabled = false;
    if (btnWebm) btnWebm.disabled = false;
  }
}

/* ------------------------------------------------------------ 顶栏 */

function setupTopbar() {
  const cap = document.getElementById('capability');
  if (cap) {
    if (hasWebCodecs()) cap.textContent = 'WebCodecs · H.264 · MP4';
    else if (pickWebmMime()) cap.textContent = '无 WebCodecs · 仅 WebM 草稿';
    else cap.textContent = '当前浏览器不支持导出';
  }

  document.getElementById('export')?.addEventListener('click', () => void runExport('mp4'));
  document.getElementById('exportWebm')?.addEventListener('click', () => void runExport('webm'));
  document.getElementById('play')?.addEventListener('click', () => {
    applyArt('hi');
    play();
  });

  document.getElementById('share')?.addEventListener('click', async () => {
    const url = `${location.origin}${location.pathname}#${encodeHash(cfg)}`;
    try {
      await navigator.clipboard.writeText(url);
      toast(`分享链接已复制（${url.length} 字符）`);
    } catch {
      toast('浏览器不允许写剪贴板，链接已放进地址栏，可直接复制');
      history.replaceState(null, '', `#${encodeHash(cfg)}`);
    }
  });
}

/* ------------------------------------------------------------ 启动 */

async function boot() {
  setupTopbar();
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    await document.fonts.load('200px "Caveat"');
    await document.fonts.ready;
  } catch {
    toast('手写体加载失败，已回退到系统手写字体');
  }
  // 中文字体晚到会掉到系统字体（画成印刷体），必须等它真的就绪再开始造字形
  await ensureCjkFont(cfg.cjkFont);
  warmGlyphFont();
  clearGlyphCache();
  applyArt('hi');
  if (reduce) {
    scene.draw(ctx, 1, { quality: 'hi' });
  } else {
    play();
  }

  // 同页改 hash（粘贴分享链接、浏览器前进后退）也要真的换配置，不然链接看着生效其实没换
  window.addEventListener('hashchange', () => {
    cfg = location.hash.length > 1 ? decodeHash(location.hash) : DEFAULT_CONFIG;
    panel.sync(cfg);
    cancelAnimationFrame(raf);
    playing = false;
    void reloadCjkFont(cfg.cjkFont).then(() => applyArt('hi'));
  });
}

/** 换中文字体：先把字体等到位，再清缓存重建，避免先用系统字体画一遍 */
async function reloadCjkFont(key: Config['cjkFont']) {
  await ensureCjkFont(key);
  clearGlyphCache();
}

void boot();
