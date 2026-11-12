# 动态签名站 · 动态手写签名生成器

输入名字，实时看笔尖按笔画顺序把名字写出来，然后一键导出真 MP4。纯前端，无后端，不用 React/Vue/Tailwind/WebGL。

---

## 快速开始

```bash
npm install
npm run dev          # http://localhost:5173，改代码自动重建
npm run build        # 多文件产物 -> dist/
npm run build:single # 单文件产物 -> dist-single/签名生成器.html（字体已 base64 内联，可直接双击打开）
npm run typecheck    # npx tsc --noEmit
```

`dist-single/签名生成器.html` 是自包含的一个文件：拷到任何地方双击就能用，不联网也跑。

**环境要求**：Node ≥ 18（本机实测 v22.23.2）。导出 MP4 需要支持 WebCodecs 的浏览器（Chrome / Edge 116+）。Safari 走 WebM 回退。

### 为什么是 esbuild 而不是 Vite

原始方案写的是 Vite，但本机（Windows，带 AppLocker 类策略）加载 rollup 原生模块时会被拦：

```
Error: An Application Control policy has blocked this file
node_modules\@rollup\rollup-win32-x64-msvc\rollup.win32-x64-msvc.node  →  ERR_DLOPEN_FAILED
```

实测 esbuild 的可执行二进制能正常跑，于是整体换成 esbuild：`scripts/build.mjs`（构建）与 `scripts/dev.mjs`（监听 + 起服务）。`vite` 与 `vite-plugin-singlefile` 已从依赖里移除，**不要再用 `vite build`**。这也顺带解决了"换台机器 `npm run build` 就挂"的问题。

### 关于字形数据（偏离原方案的地方）

原方案要求 `scripts/generate-glyphs.ts` 离线生成 `src/data/glyphs.json`。这条路同样要 node-canvas 这种原生模块，在这台机器上跑不起来。改用**运行时按需生成 + 内存缓存**：

- `getGlyph(ch)` 首次调用时把字符栅格化到 200px（`NOMINAL_PX`），跑完"二值化 → Zhang–Suen 细化 → 距离变换 → 追踪 → RDP 简化 → 合段 → 排序"整条管线，之后按 `${cacheEpoch}:${ch}` 命中缓存；
- 排版时按 `size / NOMINAL_PX` 缩放坐标与笔宽；
- `clearGlyphCache()` 在字体加载完成后失效缓存（`cacheEpoch++`），所以字体到位后重算一遍；
- 代价：每个新字符首次生成要几十毫秒（在 `requestIdleCallback` 里做，不挡交互）。

`src/data/glyphs.json` 因此**不存在**。要重新生成字形：清空缓存即可 —— 浏览器里刷新页面，或改名字触发 `getGlyph` 重新算。想换手写体，把 `src/assets/caveat-400.woff2` / `caveat-700.woff2` 换掉（保持文件名，或同时改 `src/style.css` 里的 `@font-face`），刷新页面即是新字形。

### 字形是怎么变成"能按笔顺写"的

1. `fillText` 把字画成位图（肉）；
2. `alpha > 40` 二值化，Zhang–Suen 细化出 1px 中线（骨）；
3. 倒角距离变换（3-4-5）回填每点笔宽，骨架偏到边缘时按邻域取大 ×1.12 补宽；
4. 8 邻域追踪 + 方向惯性走成折线，RDP(eps=1.1) 简化；
5. **端点相接的碎段重新缝回一条**（细化会把一条笔画切成好几段，不缝笔顺就错）；
6. 起点按 `y - 0.35x` 选起笔，之后贪心就近接笔（近的还会翻转方向）；
7. 沿每笔铺种子做两轮多源 BFS，让**每一个墨迹像素**都知道"我属于第几笔、走到这一笔的百分之几"。

渲染时不做"沿骨架刷一条线"的遮罩（那样会把笔画切出毛边、i 的点会整块丢），而是把上面这份归属关系投影成一张**半分辨率的登场时间图**（`art.map`，值 1–255 = 时刻，0 = 没有墨）。每帧拿它和当前时间比一下阈值就得到遮罩，放大回全分辨率天然带插值，边缘是软的。写完（t ≥ 1）直接整幅墨迹，省掉逐像素扫描。

---

## 参数（9 个）

| # | 参数 | 默认 | 范围 |
| --- | --- | --- | --- |
| 1 | 名字 A | Taiyang | 1–12 字符 |
| 2 | 名字 B（可空） | yueliang | 0–12 字符 |
| 3 | 颜色 A | `#FFFFFF` | 任意 |
| 4 | 颜色 B | `#FFC0CC` | 任意 |
| 5 | 字号倍率 A | 1.5 | 0.8–2.2 |
| 6 | 字号倍率 B | 1.6 | 0.8–2.2 |
| 7 | 装饰 | 太阳 | 太阳 / 猫耳 / 小狗 / 云朵 / 星星 / 爱心 / 无 |
| 8 | 装饰倍率 | 0.7 | 0.4–1.2 |
| 9 | 时长 | 5.0s | 3–10s |

另有两个输出参数：比例（16:9 / 9:16 / 1:1）与分辨率基准（1080 / 720）。

所有参数都写进 `location.hash`，链接即配置；「复制分享链接」把当前 hash 拼到地址栏并复制。

---

## 项目结构

```
index.html                    页面骨架
src/main.ts                   挂载、事件、重建调度、播放、导出编排
src/config.ts                 参数类型、默认值、stageSize()、hash 编解码
src/style.css                 深浅两套纸面 + 舞台、控件、遮罩
src/signature/skeleton.ts     栅格化 → 细化 → 距离场 → 追踪 → 合段 → 笔顺 → 登场时间归属
src/signature/layout.ts       排布、时间分配、登场时间图投影、装饰锚点
src/signature/render.ts       draw(ctx, t, {quality})：墨迹 / 辉光 / 笔尖 / 装饰 / 星屑
src/signature/effects.ts      7 种装饰路径、确定性星屑、辉光
src/export/mp4.ts             WebCodecs 编码 + mp4-muxer 封装 + 背压 + 取消
src/export/webm.ts            MediaRecorder 回退（Safari / 无 WebCodecs）
src/ui/panel.ts               五组原生控件双向绑定、缺字提示
src/ui/toast.ts               单例提示
src/assets/*.woff2            Caveat 400 / 700（OFL，本地内联）
scripts/build.mjs             esbuild 构建（默认多文件，--single 出单文件）
scripts/dev.mjs               esbuild watch + 本地服务（端口 5173）
```

数据流：`面板/链接 → Config → buildArt()（字形 + 排布 + 时间 + 登场时间图）→ Scene.draw(t) → 预览 rAF 循环 / 导出离线帧循环 → VideoEncoder → mp4-muxer → Blob → 下载`。预览和导出共用同一个 `draw(t)`，但各有各的时钟：预览读真实时间，导出用 `t = i / total`。

---

## 已知限制

- **只支持手写体覆盖的字符**。字体是 Caveat（拉丁字母、数字、常见标点、带音标的拉丁扩展）。中文、日文、emoji 一律不支持 —— 缺字会在面板上给出"当前手写体不含这些字符：…"的提示，并且**不会被系统字体顶替**（顶替会画成印刷体，混在手写里更假）。要做中文签名，需要另外接一份笔画数据（Make Me a Hanzi / KanjiVG 之类）。
- **笔顺是几何推导的，不是真笔顺**。拉丁字母按起点+就近接笔排序，观感接近手写但不等同书法笔顺；`i` 的点这类孤立短笔画靠"孤立 + 粗"判定保留。
- **Safari 只能导出 WebM**（`MediaRecorder` 不支持 MP4 muxing）。界面会明确标"草稿格式"，并给出"正式导出请用 Chrome"的建议。WebM 是实时录制，掉帧风险比 MP4 高。
- **画布上限**：单边 ≤ 4096、面积 ≤ 16777216 像素。产品只提供到 1920×1080（面积 2.07M），远低于上限；`stageSize()` 里有面积断言，不会再往上加分辨率，所以不存在"8K 白屏"这条路径。
- **首字生成有延迟**：新字符第一次出现时要跑完整条骨架管线（约几十毫秒/字），第二个名字或换名字时可能感觉到一次微顿，之后走缓存。
- **导出耗时**：1920×1080 / 150 帧在本机 Chromium 实测 5.4–5.6s（含逐帧遮罩合成与编码），接近但没超 8s 目标；低配机器会更慢，导出期间有进度条与取消。
- **预览分辨率**：预览画布按容器尺寸 + DPR（上限 2）绘制，和导出尺寸不同源，所以预览的细节不等于成片细节。

---

## 验收清单（逐条实测）

| # | 项目 | 结果 | 依据 |
| --- | --- | --- | --- |
| 1 | 帧数恰好 150 | ✅ | 解析导出文件：`stts = [[150, 1920]]`、`sample_count = 150`、`duration = 5.0s`、`avc1` |
| 2 | 能被播放器播放 | ✅ | Chromium 载入导出 MP4：`duration 5`、`1920×1080`、`readyState 4`、`error null`，seek 到 4.95s 仍有 28563 个亮像素。**未在 QuickTime / 微信里实测**（本机没有这两者） |
| 3 | 高分辨率不白屏 | ✅（按设计规避） | 只提供 1080 / 720 基准 × 三种比例，最高 1920×1080；`stageSize()` 内含单边 4096 / 面积 16777216 断言，不会给出超限尺寸 |
| 4 | 缺字有提示 | ✅ | 输入「张三」→ `art.missing = ['张','三']`，面板 `#missingNote` 显示"当前手写体不含这些字符：张 三…"；且不会用系统字体顶替 |
| 5 | reduced-motion 一帧到位 | ✅ | `prefers-reduced-motion: reduce` 下直接 `draw(ctx, 1)`；间隔 500ms 两次截图 `toDataURL()` 完全一致 |
| 6 | 可点击热区 ≥ 44px | ✅ | 实测 `#share 112×44`、`#export 90×44`、`#play 72×44`、`#exportWebm 331×44`、比例/分辨率分段按钮 110×44 |
| 7 | 导出可取消 | ✅ | 导出中点「取消」→ Toast「已取消导出」，遮罩关闭，编码循环按 `cancel` 标记退出 |
| 8 | 分享链接还原参数 | ✅ | 改名字 + 装饰后 `location.hash = #a=Lumen&b=Nova&ca=FFFFFF&cb=FFC0CC&sa=1.50&sb=1.60&d=cat&ds=0.70&t=5&r=16%3A9&q=1080`；用该链接新开页面，名字 A/B、装饰全部还原；「复制分享链接」Toast「分享链接已复制（203 字符）」 |
| 9 | iOS 不崩 | ⚠️ 未真机实测 | 面积断言 + 预览 DPR 上限 2 + 导出画布与预览画布分离，都是按 iOS 的已知限制做的；但手里没有 iOS 设备，未实机验证 |
| 10 | 刷新不丢参数 | ✅ | 参数即 hash，刷新沿用同一 hash（已在上一条里验证还原路径） |

其他实测：`npx tsc --noEmit` 通过（strict）；单文件产物 193.9KB（含字体 base64）；打开无 `pageerror`；拖动字号滑块从 input 事件到下一次 rAF 落地 13ms（目标 ≤16ms）。
