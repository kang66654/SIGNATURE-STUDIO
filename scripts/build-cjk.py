"""把 fontsource 的中文字体按「本站支持的字」裁出来，尺寸压到能塞进单文件。

步骤：拉 index.css → 只下覆盖到这 3755 个字的 woff2 分片 → fontTools 合并成一个字体 →
按字符集 subset → 存 woff2 + 一行 @font-face。
用法：python scripts/build-cjk.py
"""
from __future__ import annotations

import json
import pathlib
import re
import sys
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "src" / "assets" / "cjk"
CDN = "https://fastly.jsdelivr.net/npm"
UA = {"User-Agent": "Mozilla/5.0"}

FONTS = [
    {"pkg": "@fontsource/ma-shan-zheng", "id": "brush",
     "family": "MSZ Brush", "label": "马善政毛笔楷书"},
    {"pkg": "@fontsource/zhi-mang-xing", "id": "cursive",
     "family": "ZMX Cursive", "label": "志莽行书"},
    {"pkg": "@fontsource/long-cang", "id": "hand",
     "family": "LongCang Hand", "label": "龙藏手写体"},
]


def fetch(url, binary=False, tries=3):
    last = None
    for _ in range(tries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            return data if binary else data.decode("utf-8")
        except Exception as e:  # noqa: BLE001
            last = e
    raise RuntimeError(f"{url}: {last}")


def latest_version(pkg):
    meta = json.loads(fetch(f"https://data.jsdelivr.com/v1/packages/npm/{pkg}"))
    return meta["tags"]["latest"]


def supported_chars():
    src = (ROOT / "src" / "data" / "hanzi.ts").read_text(encoding="utf-8")
    m = re.search(r"HANZI_CHARS\s*=\s*(['\"`])(.*?)\1", src, re.S)
    if not m:
        raise SystemExit("没在 src/data/hanzi.ts 里找到 HANZI_CHARS")
    return m.group(2)


def range_hits(urange, chars):
    hits = 0
    for raw in urange.split(","):
        t = raw.strip()
        if not t.lower().startswith("u+"):
            continue
        body = t[2:]
        if "?" in body:
            lo, hi = int(body.replace("?", "0"), 16), int(body.replace("?", "F"), 16)
        elif "-" in body:
            a, b = body.split("-")
            lo, hi = int(a, 16), int(b, 16)
        else:
            lo = hi = int(body, 16)
        hits += sum(1 for ch in chars if lo <= ord(ch) <= hi)
    return hits


def build(font, chars):
    pkg, ver, fid = font["pkg"], font["ver"], font["id"]
    css = fetch(f"{CDN}/{pkg}@{ver}/index.css")
    picked = []
    for block in css.split("@font-face")[1:]:
        m_ur = re.search(r"unicode-range:\s*([^;]+);", block)
        m_url = re.search(r"url\(\./files/([^)]+\.woff2)\)", block)
        if not m_ur or not m_url:
            continue
        if range_hits(m_ur.group(1), chars) == 0:
            continue
        picked.append(m_url.group(1))
    print(f"{fid}: 命中 {len(picked)} 个分片", flush=True)

    shard_dir = OUT / "shards"
    shard_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    total = 0
    for i, url in enumerate(picked):
        dst = shard_dir / f"{fid}-{i}.woff2"
        if not dst.exists() or dst.stat().st_size == 0:
            data = fetch(f"{CDN}/{pkg}@{ver}/files/{url}", binary=True)
            dst.write_bytes(data)
        total += dst.stat().st_size
        paths.append(dst)
        if (i + 1) % 20 == 0:
            print(f"  {fid} {i + 1}/{len(picked)} {total / 1024:.0f}KB", flush=True)

    from fontTools.ttLib import TTFont
    from fontTools.merge import Merger
    from fontTools.subset import Subsetter, Options

    print(f"  合并 {len(paths)} 个分片…", flush=True)
    # 分片里有的 GPOS/GSUB 是空表，直接合并会炸；这里先剥掉排版表再合成（逐字绘制用不到 kerning）
    from fontTools.ttLib import TTFont
    stripped = []
    tmp = shard_dir / f"_m_{fid}"
    tmp.mkdir(exist_ok=True)
    for p in paths:
        t = TTFont(p)
        t.flavor = None
        for tag in ("GPOS", "GSUB", "GDEF", "BASE", "JSTF", "MATH"):
            if tag in t:
                del t[tag]
        dst_t = tmp / (p.stem + ".ttf")
        t.save(dst_t)
        stripped.append(str(dst_t))
    merged = Merger().merge(stripped)

    text = "".join(sorted(chars))
    opts = Options()
    opts.flavor = "woff2"
    opts.desubroutinize = False
    opts.layout_features = []
    opts.notdef_outline = True
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.hinting = True
    sub = Subsetter(options=opts)
    sub.populate(text=text)
    sub.subset(merged)

    dst = OUT / f"{fid}.woff2"
    merged.save(dst, reorderTables=True)
    return dst.stat().st_size


def main():
    chars = supported_chars()
    print(f"支持汉字 {len(chars)} 个")
    OUT.mkdir(parents=True, exist_ok=True)
    summary = []
    only = sys.argv[1] if len(sys.argv) > 1 else None
    for font in FONTS:
        if only and font["id"] != only:
            continue
        font["ver"] = latest_version(font["pkg"])
        size = build(font, chars)
        css = (
            "@font-face{font-family:'%s';font-style:normal;font-weight:400;font-display:block;"
            "src:url('./%s.woff2') format('woff2');}" % (font["family"], font["id"])
        )
        (OUT / f"{font['id']}.css").write_text(css + "\n", encoding="utf-8")
        summary.append({"id": font["id"], "family": font["family"], "kb": round(size / 1024)})
        print(f"{font['id']}: {size / 1024:.0f}KB", flush=True)
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
