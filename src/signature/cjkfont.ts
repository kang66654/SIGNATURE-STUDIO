import type { CJKFontKey } from '../config';

/**
 * 中文字体表。
 * 第一款走内置笔画数据（矢量轮廓 + 真实笔顺，不占额外体积）；
 * 其余走本地内嵌的 woff2 分片（按本站 3755 字裁剪，见 scripts/build-cjk.mjs），
 * 笔顺仍然来自笔画数据，和字体解耦 —— 换字体只换“肉”，不换“骨”。
 */
export const CJK_FONTS: Array<{ key: CJKFontKey; family: string; label: string }> = [
  { key: 'kai', family: '', label: '楷书 · 内置笔画' },
  { key: 'brush', family: 'MSZ Brush', label: '毛笔楷书 · 马善政' },
  { key: 'cursive', family: 'ZMX Cursive', label: '行书 · 志莽' },
];

export function cjkFamily(key: CJKFontKey): string | null {
  const hit = CJK_FONTS.find((f) => f.key === key);
  return hit && hit.family ? hit.family : null;
}

/** 中文字体就绪检测：字体没到之前栅格化会掉到系统字体上，画出来是印刷体 */
export async function ensureCjkFont(key: CJKFontKey, sample = '康誉张伟李娜'): Promise<void> {
  const family = cjkFamily(key);
  if (!family) return;
  try {
    await document.fonts.load(`96px "${family}"`, sample);
    await document.fonts.ready;
  } catch {
    /* 字体加载失败时退回内置楷书，不静默吞掉：UI 上会显示字体名，用户能看到变化 */
  }
}
