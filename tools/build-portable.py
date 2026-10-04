#!/usr/bin/env python3
"""
把「回路 · 电路绘图」打包成一个自包含的单文件 HTML。

用法：
    python3 tools/build-portable.py [输出路径]
    # 默认输出 dist/huilu.html

打包内容：
  * styles.css            → 内联 <style>
  * symbols.generated.js  → 内联 <script>（放在 </body> 前，保证 DOM 已就绪）
  * app.js                → 内联 <script>
  * LICENSE               → 内嵌在 id="agpl-license" 的 text/plain 脚本里，
                            这样单独一个文件也随附完整许可文本（AGPL-3.0-only 要求）

生成的单文件不依赖任何外部资源：字体只用 font-family 名 + 本地回退，
没有 @import、没有 CDN、没有图片，拷到任何机器/浏览器直接打开即可。
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parent.parent
STYLES = ROOT / "styles.css"
SYMBOLS = ROOT / "symbols.generated.js"
APP = ROOT / "app.js"
PAGE = ROOT / "index.html"
LICENSE = ROOT / "LICENSE"


def read(path: Path) -> str:
    if not path.is_file():
        sys.exit(f"缺少文件：{path}")
    return path.read_text(encoding="utf-8")


def safe(text: str) -> str:
    """内联进 <script>/<style> 时不能出现 </script>、</style>。"""
    return text.replace("</script", "<\\/script").replace("</style", "<\\/style")


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / "dist" / "huilu.html"

    html = read(PAGE)
    css = read(STYLES)
    symbols = read(SYMBOLS)
    app = read(APP)
    license_text = read(LICENSE)

    link_tag = '  <link rel="stylesheet" href="./styles.css">'
    script_tags = [
        '  <script defer src="./symbols.generated.js"></script>',
        '  <script defer src="./app.js"></script>',
    ]
    for needle in [link_tag, *script_tags]:
        if needle not in html:
            sys.exit(f"index.html 里找不到预期标签，脚本需要同步更新：{needle!r}")

    # 1) 样式就地内联；2) 两个脚本从 <head> 撤下，改到 </body> 前执行（内联脚本没有 defer，
    #    放在 head 里会因为 DOM 还没解析完而拿不到元素）。
    html = html.replace(link_tag, "  <style>\n" + css.rstrip() + "\n  </style>")
    for tag in script_tags:
        html = html.replace(tag + "\n", "").replace(tag, "")

    bundle = (
        "  <script>\n" + safe(symbols.rstrip()) + "\n  </script>\n"
        "  <script>\n" + safe(app.rstrip()) + "\n  </script>\n"
        "  <script type=\"text/plain\" id=\"agpl-license\">\n" + safe(license_text.rstrip()) + "\n  </script>\n"
    )
    html = html.replace("</body>", bundle + "</body>")

    marker = (
        "<!--\n"
        "  单文件构建：由 tools/build-portable.py 生成（CSS / 元件几何 / 逻辑 / 许可文本均已内联）。\n"
        "  完整 GNU Affero 通用公共许可证文本见下方 id=\"agpl-license\" 的 script 元素。\n"
        "  分发或二次修改请遵守 AGPL-3.0-only。\n"
        "-->\n"
    )
    html = html.replace("<!doctype html>\n", "<!doctype html>\n" + marker, 1)

    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(html, encoding="utf-8")

    size = out.stat().st_size
    print(f"已生成 {out}（{size / 1024:.1f} KiB）")
    print(f"  ├─ styles.css           {len(css) / 1024:7.1f} KiB")
    print(f"  ├─ symbols.generated.js {len(symbols) / 1024:7.1f} KiB")
    print(f"  ├─ app.js               {len(app) / 1024:7.1f} KiB")
    print(f"  └─ LICENSE              {len(license_text) / 1024:7.1f} KiB")
    print("单文件、零依赖：直接拷走这个 HTML，用浏览器打开即可。")


if __name__ == "__main__":
    main()
