"""把两款中文字体子集的覆盖字表导出成 TS 常量。

浏览器在字体缺字时会静默用系统字体顶上（画出来就是印刷体），
光靠 inkCount 判断抓不到这种情况，所以要有一份明确的覆盖清单。
"""
import pathlib
from fontTools.ttLib import TTFont

ROOT = pathlib.Path(r"C:\Users\kangy\Doubao\chats\2026-11-12\new-chat")
OUT = ROOT / "src" / "signature" / "cjkCover.ts"

parts = []
for key, name in (("brush", "BRUSH_COVER"), ("cursive", "CURSIVE_COVER")):
    f = TTFont(str(ROOT / "src" / "assets" / "cjk" / f"{key}.woff2"))
    cmap = f.getBestCmap()
    chars = [chr(cp) for cp in sorted(cmap.keys()) if cp >= 0x2E80]
    chars.sort()
    s = "".join(chars)
    parts.append((name, s))
    print(key, len(chars))

body = "\n\n".join(
    f"/** {name} 覆盖的汉字（由字体 cmap 导出，勿手改） */\nexport const {name} = {s!r};".replace("'", '"')
    for name, s in parts
)
header = """/**
 * 中文字体子集的覆盖字表（生成文件，勿手改）
 *   由脚本从 src/assets/cjk/*.woff2 的 cmap 导出。
 *   用途：字体缺字时浏览器会静默用系统字体顶替，画出来是印刷体；
 *        这里先查一遍清单，缺字就主动退回内置楷书，并在面板上说明。
 */

"""
OUT.write_text(header + body + "\n", encoding="utf-8")
print("written", OUT, OUT.stat().st_size)
