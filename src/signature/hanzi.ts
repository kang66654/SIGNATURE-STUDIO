/**
 * 中文笔画数据：查表 + 解码。
 *
 * 数据格式（由 scripts/build-hanzi.mjs 生成）：
 *   HANZI_CHARS = 所有支持的字，按顺序；HANZI_DATA = 每字的载荷，用 , 分隔。
 *   载荷 = `笔画轮廓#...#$中线#...#`
 *     轮廓：SVG 路径，命令字母后跟每坐标 2 位 base36（0–1023 无损）
 *     中线：每点 x y 各 2 位 base36，顺序即真实书写顺序
 *
 * 坐标空间：1024 见方，y 向下，基线在 y = 900。
 */

import { HANZI_CHARS, HANZI_DATA } from '../data/hanzi';

export const HANZI_EM = 1024;
export const HANZI_BASELINE = 900;

export interface HanziShape {
  /** 每笔的轮廓，已还原成 Path2D 可用的 SVG 路径字符串（1024 坐标空间） */
  paths: string[];
  /** 每笔的中线折线（1024 坐标空间），顺序 = 笔顺 */
  medians: Array<Array<[number, number]>>;
}

const B36V: Record<string, number> = {};
for (let i = 0; i < '0123456789abcdefghijklmnopqrstuvwxyz'.length; i++) {
  B36V['0123456789abcdefghijklmnopqrstuvwxyz'[i]] = i;
}

let codeIndex: Map<string, number> | null = null;
let payloads: string[] | null = null;

/** 首次用到中文时才拆表，避免打开页面就解析 4MB 数据 */
function buildIndex() {
  if (codeIndex) return;
  const chars = [...HANZI_CHARS];
  payloads = HANZI_DATA.split(',');
  codeIndex = new Map();
  for (let i = 0; i < chars.length; i++) codeIndex.set(chars[i], i);
}

const cache = new Map<string, HanziShape | null>();

/** 该字符是否有内置笔画数据 */
export function hasHanzi(ch: string): boolean {
  if ((ch.codePointAt(0) ?? 0) < 0x2e80) return false;
  const c = cache.get(ch);
  if (c !== undefined) return c !== null;
  buildIndex();
  return codeIndex!.has(ch);
}

/** 取某字的轮廓 + 中线；没有数据返回 null */
export function hanziShape(ch: string): HanziShape | null {
  buildIndex();
  const hit = cache.get(ch);
  if (hit !== undefined) return hit;
  const idx = codeIndex!.get(ch);
  if (idx === undefined) {
    cache.set(ch, null);
    return null;
  }
  const payload = payloads![idx];
  const cut = payload.indexOf('$');
  const shape: HanziShape = {
    paths: payload
      .slice(0, cut)
      .split('#')
      .map(decodePath),
    medians: payload
      .slice(cut + 1)
      .split('#')
      .map(decodeMedian),
  };
  cache.set(ch, shape);
  return shape;
}

function decodePath(enc: string): string {
  let out = '';
  let i = 0;
  while (i < enc.length) {
    const c = enc[i];
    if (c === 'M' || c === 'L' || c === 'Q' || c === 'C' || c === 'Z') {
      out += c;
      i += 1;
      continue;
    }
    const v = (B36V[enc[i]] ?? 0) * 36 + (B36V[enc[i + 1]] ?? 0);
    out += ` ${v}`;
    i += 2;
  }
  return out;
}

function decodeMedian(enc: string): Array<[number, number]> {
  const pts: Array<[number, number]> = [];
  for (let i = 0; i + 3 < enc.length; i += 4) {
    const x = (B36V[enc[i]] ?? 0) * 36 + (B36V[enc[i + 1]] ?? 0);
    const y = (B36V[enc[i + 2]] ?? 0) * 36 + (B36V[enc[i + 3]] ?? 0);
    pts.push([x, y]);
  }
  return pts;
}

/** 由脚本生成的覆盖字数，用于界面提示 */
export const HANZI_COUNT = 3755;
