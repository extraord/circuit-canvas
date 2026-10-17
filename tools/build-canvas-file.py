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
  2. 把外壳里的 <script src="./assets/ucie-canvas.js"> 换成内嵌的
     window.CANVAS_FILE = {...}（id / title / 尺寸 / 初始草稿 / 残余几何 / 吸附点）；
  3. 改 <title>，写出行文件。
  这样多张画布共用一份 UI 与元件库，但彼此的数据、本地草稿、导出文件都独立。

用法:
  python tools/build-canvas-file.py                     # 用默认参数生成 ucie.html
  python tools/build-canvas-file.py --data assets/ucie-canvas.js --out ucie.html \\
      --id ucie-sheet --title "AT7210 · UCIe Analog PHY Blocks" --sheet "UCIe"
"""
import argparse
import hashlib
import json
import math
import os
import re
import statistics
import sys

DEFAULT_DATA = os.path.join("assets", "ucie-canvas.js")
SHELL_CANDIDATE = "index.html"
DATA_SCRIPT_RE = re.compile(r'[ \t]*<script[^>]*src="\./assets/[^"]*-canvas\.js"[^>]*></script>\r?\n')
PATH_TOKEN_RE = re.compile(r"[ML]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[-+]?\d+)?", re.IGNORECASE)


def read_text(path):
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def load_payload(path):
    """从 assets/xxx-canvas.js 里取出 window.XXX = {...}; 的 JSON 部分。"""
    text = read_text(path)
    start = text.index("{", text.index("="))
    end = text.rindex("}")
    return json.loads(text[start:end + 1])


def longest_path_segment(path):
    tokens = PATH_TOKEN_RE.findall(str(path or ""))
    segments = []
    point = None
    command = None
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token.upper() in ("M", "L"):
            command = token.upper()
            index += 1
            continue
        if command not in ("M", "L") or index + 1 >= len(tokens):
            break
        next_point = (float(tokens[index]), float(tokens[index + 1]))
        index += 2
        if command == "L" and point is not None:
            dx = next_point[0] - point[0]
            dy = next_point[1] - point[1]
            length = math.hypot(dx, dy)
            if length > 0:
                segments.append((length, (point[0] + next_point[0]) / 2,
                                 (point[1] + next_point[1]) / 2,
                                 math.degrees(math.atan2(dy, dx))))
        point = next_point
        if command == "M":
            command = "L"
    return max(segments, default=None, key=lambda segment: segment[0])


def rectangle_units_per_mm(draft):
    ratios = []
    texts = draft.get("texts", [])
    dimension_pattern = re.compile(r"^\s*(\d+(?:\.\d+)?)\s*[*x×]", re.IGNORECASE)
    for shape in draft.get("shapes", []):
        if shape.get("kind") != "rectangle" or not shape.get("src"):
            continue
        contained = [text for text in texts
                     if str(text.get("src")) == str(shape.get("src"))
                     and shape["x"] <= text.get("x", -1) <= shape["x"] + shape["width"]
                     and shape["y"] <= text.get("y", -1) <= shape["y"] + shape["height"]]
        for text in contained:
            dimension = dimension_pattern.match(str(text.get("text", "")))
            if dimension and float(dimension.group(1)) > 0 and shape["width"] > 0:
                ratios.append(shape["width"] / float(dimension.group(1)))
    if not ratios:
        raise ValueError("AT7210 标尺替换需要至少一个带宽度数字标签的矩形")
    return statistics.median(ratios) * 1000


def replace_at7210_rulers(payload):
    if os.path.basename(payload.get("meta", {}).get("source", "")).lower() != "at7210_floorplan.vsdx":
        return 0
    draft = payload.get("draft", {})
    shapes = draft.get("shapes", [])
    texts = draft.get("texts", [])
    components = draft.setdefault("components", [])
    rulers = [text for text in texts if str(text.get("text", "")).strip().lower() == "2.2741 mm"]
    scale = rectangle_units_per_mm(draft)
    ruler_components = []
    remove_shapes = set()
    remove_texts = set()
    for index, text in enumerate(rulers, 1):
        matching = [shape for shape in shapes
                    if shape.get("kind") == "freeform"
                    and str(shape.get("src")) == str(text.get("src"))]
        candidates = [(longest_path_segment(shape.get("path")), shape) for shape in matching]
        candidates = [(segment, shape) for segment, shape in candidates if segment]
        if candidates:
            segment, source_shape = max(candidates, key=lambda item: item[0][0])
            span, x, y, angle = segment
            remove_shapes.add(source_shape["id"])
        else:
            span = 50.87
            x = float(text.get("x", 0))
            y = float(text.get("y", 0)) + 16
            angle = float(text.get("angle", 0) or 0)
        if angle > 90:
            angle -= 180
        elif angle < -90:
            angle += 180
        length = 2.2741
        ruler_components.append({
            "id": f"r-{text.get('id', index)}",
            "type": "ruler",
            "name": f"RUL{index}",
            "x": x,
            "y": y,
            "rotation": angle,
            "length": length,
            "scale": scale,
            "unit": "mm",
        })
        remove_texts.add(text["id"])
    if ruler_components:
        draft["shapes"] = [shape for shape in shapes if shape.get("id") not in remove_shapes]
        draft["texts"] = [text for text in texts if text.get("id") not in remove_texts]
        components.extend(ruler_components)
    return len(ruler_components)


def embed_at7210_rectangle_text(payload, repo):
    """把 AT7210 Floorplan 中 Visio 矩形自带的中心文字并入矩形对象。"""
    if os.path.basename(payload.get("meta", {}).get("source", "")).lower() != "at7210_floorplan.vsdx":
        return 0, 0, 0

    replaced_rulers = replace_at7210_rulers(payload)
    draft = payload.get("draft", {})
    shapes = draft.get("shapes", [])
    texts = draft.get("texts", [])
    for shape in shapes:
        path = str(shape.get("path", "")).strip()
        if (shape.get("kind") == "freeform" and path.upper().endswith("Z")
                and path.count("L") == 8 and abs(shape.get("width", 0) - shape.get("height", 0)) <= 0.1):
            shape["kind"] = "octagon"
            shape["variableDiameter"] = True
            shape.pop("path", None)
            shape.pop("pathX", None)
            shape.pop("pathY", None)

    shapes_by_source = {}
    for shape in shapes:
        source_id = shape.get("src")
        if (shape.get("kind") == "rectangle" or shape.get("variableDiameter")) and source_id is not None:
            shapes_by_source.setdefault(str(source_id), []).append(shape)

    embedded = {}
    remaining = []
    for text in texts:
        candidates = shapes_by_source.get(str(text.get("src", "")), [])
        contained = [shape for shape in candidates
                     if shape["x"] <= text["x"] <= shape["x"] + shape["width"]
                     and shape["y"] <= text["y"] <= shape["y"] + shape["height"]]
        if not contained:
            remaining.append(text)
            continue
        shape = min(contained, key=lambda item: item["width"] * item["height"])
        embedded.setdefault(shape["id"], []).append(text)

    by_id = {shape["id"]: shape for shape in shapes}
    for shape_id, labels in embedded.items():
        shape = by_id[shape_id]
        labels.sort(key=lambda item: (item.get("y", 0), item.get("order", 0)))
        lines = [" ".join(str(item.get("text", "")).split()) for item in labels]
        shape["label"] = " ".join(line for line in lines if line)
        shape["labelLines"] = [line for line in lines if line]
        if shape.get("variableDiameter"):
            shape["labelScaleBaseDiameter"] = shape["width"]
        if len(lines) > 1:
            dimension = re.fullmatch(r"\s*(\d+(?:\.\d+)?)\s*([*x×])\s*(\d+(?:\.\d+)?)\s*", lines[1], re.IGNORECASE)
            if dimension and shape["width"] > 0 and shape["height"] > 0:
                shape["labelDimension"] = {
                    "width": float(dimension.group(1)),
                    "height": float(dimension.group(3)),
                    "baseWidth": shape["width"],
                    "baseHeight": shape["height"],
                    "separator": dimension.group(2),
                }
        shape["blockLabel"] = True

    draft["texts"] = remaining
    if embedded or replaced_rulers:
        meta = payload.setdefault("meta", {})
        meta.pop("build", None)
        serialized = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        with open(os.path.join(repo, "app.js"), "rb") as app_file:
            meta["build"] = hashlib.sha256(serialized.encode("utf-8") + app_file.read()).hexdigest()[:16]
    return len(embedded), len(texts) - len(remaining), replaced_rulers


def build_shell(repo, payload, canvas_id, title):
    embedded_shapes, embedded_texts, replaced_rulers = embed_at7210_rectangle_text(payload, repo)
    if embedded_texts:
        print(f"Embedded AT7210 labels: {embedded_shapes} shapes, {embedded_texts} text objects")
    if replaced_rulers:
        print(f"Replaced AT7210 rulers: {replaced_rulers} components")
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
    if not DATA_SCRIPT_RE.search(shell):
        raise SystemExit("index.html 里找不到 assets/*-canvas.js 的 script 标签，外壳模板变了？")
    shell = DATA_SCRIPT_RE.sub(inline, shell, count=1)
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


def make_portable(repo, html):
    """内联运行期资源和许可证，生成可脱离仓库使用的单文件 HTML。"""
    def read(name):
        return read_text(os.path.join(repo, name))

    def safe(text):
        return text.replace("</script", "<\\/script").replace("</style", "<\\/style")

    css, symbols, app, license_text = (read("styles.css"), read("symbols.generated.js"),
                                       read("app.js"), read("LICENSE"))
    link_tag = '  <link rel="stylesheet" href="./styles.css">'
    script_tags = ['  <script defer src="./symbols.generated.js"></script>',
                   '  <script defer src="./app.js"></script>']
    for needle in [link_tag, *script_tags]:
        if needle not in html:
            raise SystemExit(f"index.html 里找不到预期标签，外壳模板变了：{needle!r}")
    html = html.replace(link_tag, "  <style>\n" + css.rstrip() + "\n  </style>")
    for tag in script_tags:
        html = html.replace(tag + "\n", "").replace(tag, "")
    html = html.replace(
        '<a class="top-action" id="open-ucie-sheet"',
        '<a class="top-action" id="open-ucie-sheet" hidden',
    )
    bundle = (
        "  <script>\n" + safe(symbols.rstrip()) + "\n  </script>\n"
        "  <script>\n" + safe(app.rstrip()) + "\n  </script>\n"
        '  <script type="text/plain" id="agpl-license">\n'
        + safe(license_text.rstrip()) + "\n  </script>\n"
    )
    return html.replace("</body>", bundle + "</body>")


def main():
    repo = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    ap = argparse.ArgumentParser(description="把图纸数据打包成独立画布 HTML")
    ap.add_argument("--data", default=DEFAULT_DATA, help="数据文件（assets/*-canvas.js）")
    ap.add_argument("--out", default="ucie.html", help="输出的画布文件")
    ap.add_argument("--id", default="ucie-sheet", help="画布 id（决定本地草稿 key）")
    ap.add_argument("--title", default="AT7210 · UCIe Analog PHY Blocks", help="画布标题")
    ap.add_argument("--portable", action="store_true", help="内联所有运行期资源，生成完全自包含的 HTML")
    args = ap.parse_args()

    data_path = args.data if os.path.isabs(args.data) else os.path.join(repo, args.data)
    out_path = args.out if os.path.isabs(args.out) else os.path.join(repo, args.out)
    if not os.path.exists(data_path):
        sys.exit(f"找不到数据文件：{data_path}（先运行 tools/build-ucie-diagram.py）")

    payload = load_payload(data_path)
    html = build_shell(repo, payload, args.id, args.title)
    if args.portable:
        html = make_portable(repo, html)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(html)

    draft = payload["draft"]
    print(f"canvas={payload['meta']['width']:.0f}x{payload['meta']['height']:.0f} "
          f"shapes={len(draft['shapes'])} texts={len(draft['texts'])} "
          f"comps={len(draft['components'])} residual={len(payload['residual'])}")
    print(f"  -> {out_path}  ({len(html) / 1024:.0f} KB)")


if __name__ == "__main__":
    main()
