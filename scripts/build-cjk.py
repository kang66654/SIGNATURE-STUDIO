"""裁中文字体子集：直接拉全量 TTF，按本站支持的字（GB2312 6763 字）subset 成 woff2。

之前走 fontsource 分片再合并，分片下载只有 2–3KB/s，只能裁一级字表 3755 字；
改成从 jsDelivr 的 google/fonts 仓库直接取全量 TTF（400–700KB/s），一次裁到 6763 字。

用法：python scripts/build-cjk.py [brush|cursive]
产物：src/assets/cjk/{brush,cursive}.woff2 + 同名 .css
缓存：.vendor/cjk/*.ttf（已进 .gitignore，可重复使用）
"""
from __future__ import annotations

import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "assets" / "cjk"
CACHE = ROOT / ".vendor" / "cjk"
UA = {"User-Agent": "Mozilla/5.0"}
GH = "https://fastly.jsdelivr.net/gh/google/fonts@main"

FONTS = [
    {"id": "brush", "family": "MSZ Brush", "label": "马善政毛笔楷书",
     "url": f"{GH}/ofl/mashanzheng/MaShanZheng-Regular.ttf"},
    {"id": "cursive", "family": "ZMX Cursive", "label": "志莽行书",
     "url": f"{GH}/ofl/zhimangxing/ZhiMangXing-Regular.ttf"},
]


def fetch_ttf(font):
    CACHE.mkdir(parents=True, exist_ok=True)
    dst = CACHE / f"{font['id']}.ttf"
    if dst.exists() and dst.stat().st_size > 1_000_000:
        print(f"  使用缓存 {dst.name} ({dst.stat().st_size / 1024:.0f}KB)", flush=True)
        return dst
    print(f"  下载 {font['url']}", flush=True)
    req = urllib.request.Request(font["url"], headers=UA)
    with urllib.request.urlopen(req, timeout=180) as r:
        data = r.read()
    dst.write_bytes(data)
    print(f"  {dst.stat().st_size / 1024:.0f}KB", flush=True)
    return dst


def supported_chars():
    src = (ROOT / "src" / "data" / "hanzi.ts").read_text(encoding="utf-8")
    m = re.search(r"HANZI_CHARS\s*=\s*(['\"`])(.*?)\1", src, re.S)
    if not m:
        raise SystemExit("没在 src/data/hanzi.ts 里找到 HANZI_CHARS")
    return m.group(2)


def build(font, chars):
    from fontTools.ttLib import TTFont
    from fontTools.subset import Options, Subsetter

    ttf = fetch_ttf(font)
    font_obj = TTFont(ttf)
    cmap = font_obj.getBestCmap()
    missing = [ch for ch in chars if ord(ch) not in cmap]
    print(f"  {font['id']}: 原字体缺 {len(missing)} 字" + (f"（{' '.join(missing[:20])}…）" if missing else ""),
          flush=True)

    text = "".join(sorted(set(chars)))
    opts = Options()
    opts.flavor = "woff2"
    opts.desubroutinize = False
    opts.layout_features = []
    opts.notdef_outline = True
    # Canvas 渲染不用 hinting 指令，丢掉能省 1/3 体积；名字表只留 family/style/full/ps
    opts.name_IDs = [1, 2, 4, 6]
    opts.name_languages = ["*"]
    opts.hinting = False
    opts.drop_tables += ["DSIG"]
    sub = Subsetter(options=opts)
    sub.populate(text=text)
    sub.subset(font_obj)

    dst = OUT / f"{font['id']}.woff2"
    font_obj.save(dst, reorderTables=True)
    return dst.stat().st_size


def main():
    chars = supported_chars()
    print(f"支持汉字 {len(chars)} 个", flush=True)
    OUT.mkdir(parents=True, exist_ok=True)
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for font in FONTS:
        if only and font["id"] != only:
            continue
        size = build(font, chars)
        css = (
            "@font-face{font-family:'%s';font-style:normal;font-weight:400;font-display:block;"
            "src:url('./%s.woff2') format('woff2');}" % (font["family"], font["id"])
        )
        (OUT / f"{font['id']}.css").write_text(css + "\n", encoding="utf-8")
        print(f"{font['id']}: {size / 1024:.0f}KB", flush=True)


if __name__ == "__main__":
    main()
