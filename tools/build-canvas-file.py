#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build-canvas-file.py — 把一张图纸打包成「独立画布文件」。

设计：
  circuit-canvas/ 是公用库（styles.css / symbols.generated.js / app.js / assets/），
  而每一张具体图纸是一个独立的 .html 文件——图纸数据直接内嵌在这个 HTML 里，
  所以单个文件就可以在机器之间互拷，只要目标机器上有同一份 circuit-canvas 目录。

做法：
  1. 读 index.html 当外壳模板（顶栏 / 元件库 / 检查器 / SVG 骨架都是同一份）；
  2. 把外壳里的 <!-- @@CANVAS_DATA@@ --> 占位符换成内嵌的
     window.CANVAS_FILE = {...}（id / title / 尺寸 / 初始草稿 / 残余几何 / 吸附点）；
  3. 改 <title>，写出行文件。
  这样多张画布共用一份 UI 与元件库，但彼此的数据、本地草稿、导出文件都独立。

用法:
  python tools/build-canvas-file.py --data assets/example-canvas.js \\
      --out example.html --id example-sheet --title "示例电路"
"""
import argparse
import json
import os
import re
import sys

SHELL_CANDIDATE = "index.html"
DATA_SLOT_RE = re.compile(r'[ \t]*<!-- *@@CANVAS_DATA@@ *-->[ \t]*\r?\n')


def read_text(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def load_payload(path):
    """从 assets/xxx-canvas.js 里取出 window.XXX = {...}; 的 JSON 部分。"""
    text = read_text(path)
    start = text.index("{", text.index("="))
    end = text.rindex("}")
    return json.loads(text[start:end + 1])


def build_shell(repo, payload, canvas_id, title):
    shell = read_text(os.path.join(repo, SHELL_CANDIDATE))
    data = {
        "id": canvas_id,
        "title": title,
        "sheet": payload.get("meta", {}).get("page", ""),
        "source": payload.get("meta", {}).get("source", ""),
        # 残余几何层的名称（从 schematic 导入时是「原图走线」；Visio 流程不设）
        "residualLabel": payload.get("residualLabel", ""),
        # 构建指纹：内容一变就变，app.js 用它判断 localStorage 里的旧草稿是否过期
        "build": payload.get("meta", {}).get("build", ""),
        "width": payload["meta"]["width"],
        "height": payload["meta"]["height"],
        "draft": payload["draft"],
        "residual": payload["residual"],
        "snap": payload["snap"],
    }
    inline = (
        "  <!-- ↓↓↓ 本画布自带的数据（由 tools/build-canvas-file.py 生成，请勿手改） ↓↓↓ -->\n"
        "  <script>window.CANVAS_FILE = "
        + json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        + ";</script>\n"
    )
    if not DATA_SLOT_RE.search(shell):
        raise SystemExit("index.html 里找不到 @@CANVAS_DATA@@ 占位符，外壳模板变了？")
    shell = DATA_SLOT_RE.sub(inline, shell, count=1)
    shell = re.sub(r"<title>.*?</title>", f"<title>{title} · 回路</title>", shell, count=1)
    banner = (
        "<!--\n"
        f"  {title} —— 独立画布文件（single-file canvas）\n"
        "  SPDX-License-Identifier: AGPL-3.0-only\n\n"
        "  这张图纸的数据已内嵌在本文件里，可以单独拷到别的机器；\n"
        "  运行期只依赖同目录下的公用库：styles.css / symbols.generated.js / app.js。\n"
        "  要改图纸数据请在源工程里改，然后重新运行 tools/build-canvas-file.py 生成。\n"
        "-->\n"
    )
    return banner + shell


def main():
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description="把图纸数据打包成独立画布 HTML")
    ap.add_argument("--data", required=True, help="数据文件（assets/*-canvas.js）")
    ap.add_argument("--out", required=True, help="输出的画布文件")
    ap.add_argument("--id", default="canvas-sheet", help="画布 id（决定本地草稿 key）")
    ap.add_argument("--title", default="电路画布", help="画布标题")
    args = ap.parse_args()

    data_path = args.data if os.path.isabs(args.data) else os.path.join(repo, args.data)
    out_path = args.out if os.path.isabs(args.out) else os.path.join(repo, args.out)
    if not os.path.exists(data_path):
        sys.exit(f"找不到数据文件：{data_path}")

    payload = load_payload(data_path)
    html = build_shell(repo, payload, args.id, args.title)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    draft = payload["draft"]
    print(f"canvas={payload['meta']['width']:.0f}x{payload['meta']['height']:.0f} "
          f"shapes={len(draft['shapes'])} texts={len(draft['texts'])} "
          f"comps={len(draft['components'])} residual={len(payload['residual'])}")
    print(f"  -> {out_path}  ({len(html) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
