/**
 * 生成中文笔画数据：src/data/hanzi.ts
 *
 * 数据源：hanzi-writer-data（npm 包，衍生自 Make Me a Hanzi / Arphic 字体，Arphic Public License）
 *   每个字一个 JSON：strokes = 每笔的 SVG 轮廓路径（1024×1024，y 向下，基线 y=900）
 *                     medians = 每笔的中线折线（同一坐标空间，数组顺序 = 真实笔顺）
 *
 * 覆盖范围：GB2312 一级字表 3755 字（按字节区间解码得到，不用人工字表）。
 * 编码：坐标量化为 0–1023 的整数，用 2 位 base36 表示（36²=1296 > 1024，无损）；
 *       路径按 “命令字母 + 每坐标 2 位” 排列；中线点按 “x y” 连续 2 位一组。
 *       strokes 之间用 `#`，strokes 与 medians 之间用 `$`。
 *
 * 用法：npm i -D hanzi-writer-data
 *      node scripts/build-hanzi.mjs [--src <解包目录>]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const B36 = '0123456789abcdefghijklmnopqrstuvwxyz';

let srcDir = path.join(ROOT, '.vendor', 'hanzi', 'package');
const argIdx = process.argv.indexOf('--src');
if (argIdx > 0) srcDir = path.resolve(process.argv[argIdx + 1]);
if (!fs.existsSync(srcDir)) {
  const fallback = path.join(ROOT, 'node_modules', 'hanzi-writer-data');
  if (fs.existsSync(fallback)) srcDir = fallback;
}
if (!fs.existsSync(srcDir)) {
  console.error(
    `找不到笔画数据目录：${srcDir}\n先从项目根执行：npm pack hanzi-writer-data@2.0.1 && mkdir -p .vendor/hanzi && tar -xzf hanzi-writer-data-2.0.1.tgz -C .vendor/hanzi`,
  );
  process.exit(1);
}

/** GB2312 全部汉字（一级 0xB0A1–0xD7F9 + 二级 0xD8A1–0xF7FE），解码得到 6763 个汉字 */
function gb2312All() {
  const dec = new TextDecoder('gbk');
  const out = [];
  for (let hi = 0xb0; hi <= 0xf7; hi++) {
    for (let lo = 0xa1; lo <= 0xfe; lo++) {
      const c = dec.decode(new Uint8Array([hi, lo]));
      if (c.length !== 1 || c.charCodeAt(0) === 0xfffd) continue;
      out.push(c);
    }
  }
  return out;
}

const b36 = (n) => {
  n = Math.max(0, Math.min(1023, Math.round(n)));
  return B36[Math.floor(n / 36)] + B36[n % 36];
};

const TOKEN = /([MLQCZ])|(-?\d+(?:\.\d+)?)/g;

/** SVG 路径 → “命令字母 + 2位base36 坐标” */
function encodePath(d) {
  let out = '';
  let nx = 0;
  const pending = [];
  for (const m of d.matchAll(TOKEN)) {
    if (m[1]) {
      out += m[1];
      pending.length = 0;
      if (m[1] === 'M') nx = 0;
      continue;
    }
    pending.push(parseFloat(m[2]));
    if (pending.length === 2) {
      out += b36(pending[0]) + b36(pending[1]);
      pending.length = 0;
    }
  }
  return out;
}

function encodeMedian(points) {
  let out = '';
  for (const pt of points) out += b36(pt[0]) + b36(pt[1]);
  return out;
}

const chars = gb2312All();
const payloads = new Map();
let hit = 0;
let miss = 0;

for (const ch of chars) {
  const file = path.join(srcDir, `${ch}.json`);
  if (!fs.existsSync(file)) {
    miss++;
    continue;
  }
  const j = JSON.parse(fs.readFileSync(file, 'utf8'));
  const strokes = (j.strokes || []).map((d) => encodePath(d)).join('#');
  const medians = (j.medians || []).map((m) => encodeMedian(m)).join('#');
  payloads.set(ch, `${strokes}$${medians}`);
  hit++;
}

const kept = chars.filter((c) => payloads.has(c));
const list = [...kept].join('');
const data = kept.map((c) => payloads.get(c)).join(',');

const outFile = path.join(ROOT, 'src', 'data', 'hanzi.ts');
const header = `/**
 * 中文笔画数据（生成文件，勿手改）
 *   由 scripts/build-hanzi.mjs 从 hanzi-writer-data 生成。
 *   来源：Make Me a Hanzi / Arphic 字体，Arphic Public License（见 src/data/ARPHICPL.txt）。
 *   覆盖：GB2312 全部汉字 ${kept.length} 字（一级 3755 + 二级 3008）；坐标为 1024 见方、y 向下、基线 y=900。
 */
`;
const body = `export const HANZI_CHARS = ${JSON.stringify(list)};\n\nexport const HANZI_DATA = ${JSON.stringify(
  data,
)};\n`;
fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, header + body, 'utf8');

const bytes = Buffer.byteLength(header + body, 'utf8');
console.log(
  `hanzi.ts: ${kept.length} 字（缺 ${miss}）、${(bytes / 1024 / 1024).toFixed(2)}MB、平均 ${Math.round(
    bytes / kept.length,
  )} B/字`,
);
