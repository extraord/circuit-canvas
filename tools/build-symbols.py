#!/usr/bin/env python3
"""Regenerate symbols.generated.js from the upstream Analog Canvas catalog.

Source: https://github.com/cascode-ai/analog-canvas
        packages/components/definitions/<symbol-id>.json

Each upstream definition owns the authoritative geometry for one symbol:
its viewBox, its pin anchors and directions, and the primitives that draw it.
This script converts that data verbatim (no reshaping of coordinates, no
re-derived curves) into a plain-JS table the zero-dependency app can render.

Usage:
    python3 tools/build-symbols.py            # use the cached download
    python3 tools/build-symbols.py --fetch    # refresh from GitHub first

SPDX-License-Identifier: AGPL-3.0-only
"""

import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
CACHE = os.path.join(HERE, ".cache", "definitions")
OUTPUT = os.path.join(PROJECT, "symbols.generated.js")

API = "https://api.github.com/repos/cascode-ai/analog-canvas/contents/packages/components/definitions?ref=main"

# The sandbox ships a Cadence LD_LIBRARY_PATH that breaks wget's TLS stack.
CLEAN_ENV = {k: v for k, v in os.environ.items()
             if k not in ("LD_LIBRARY_PATH", "LD_PRELOAD")}


def fetch():
    """Download every definition JSON into the cache directory."""
    os.makedirs(CACHE, exist_ok=True)
    listing = os.path.join(CACHE, "_listing.json")
    subprocess.run(["wget", "-q", "-O", listing, API], check=True, env=CLEAN_ENV)
    with open(listing, encoding="utf-8") as handle:
        entries = json.load(handle)
    urls = os.path.join(CACHE, "_urls.txt")
    with open(urls, "w", encoding="utf-8") as handle:
        handle.write("\n".join(entry["download_url"] for entry in entries))
    subprocess.run(["wget", "-q", "-P", CACHE, "-i", urls], check=True, env=CLEAN_ENV)
    print(f"fetched {len(entries)} definitions into {CACHE}")


def num(value):
    """Round to 4 decimals (well past pixel resolution) and trim noise."""
    if value is None:
        return None
    if isinstance(value, int):
        return value
    rounded = round(float(value), 4)
    if rounded == int(rounded) and abs(rounded) < 1e15:
        return int(rounded)
    return rounded


def points(values):
    return [[num(p["x"]), num(p["y"])] for p in values]


def style_of(primitive):
    """Keep only the stroke facts the renderer needs."""
    style = primitive.get("style") or {}
    out = {}
    role = style.get("strokeRole")
    if role:
        out["s"] = role
    width = style.get("strokeWidth")
    if width is not None:
        out["w"] = num(width)
    for key, short in (("lineCap", "cap"), ("lineJoin", "join")):
        if style.get(key):
            out[short] = style[key]
    if style.get("miterLimit") is not None:
        out["ml"] = num(style["miterLimit"])
    return out


def primitive_of(primitive):
    """Convert one primitive, preserving every coordinate verbatim."""
    kind = primitive["kind"]
    out = {"t": kind}
    if kind == "line":
        out["x1"] = num(primitive["from"]["x"])
        out["y1"] = num(primitive["from"]["y"])
        out["x2"] = num(primitive["to"]["x"])
        out["y2"] = num(primitive["to"]["y"])
    elif kind in ("polyline", "polygon"):
        out["p"] = points(primitive["points"])
    elif kind == "circle":
        out["cx"] = num(primitive["center"]["x"])
        out["cy"] = num(primitive["center"]["y"])
        out["r"] = num(primitive["radius"])
    elif kind == "path":
        out["d"] = primitive["data"]
    else:
        raise SystemExit(f"unknown primitive kind: {kind}")

    out.update(style_of(primitive))
    if primitive.get("fill") is not None:
        out["fill"] = primitive["fill"]
    if primitive.get("stroke") is not None:
        out["stroke"] = primitive["stroke"]
    if primitive.get("part"):
        out["part"] = primitive["part"]
    return out


def pin_of(pin):
    presentation = pin["presentation"]
    out = {
        "n": pin["name"],
        "x": num(pin["at"]["x"]),
        "y": num(pin["at"]["y"]),
        "d": pin["direction"],
    }
    if presentation.get("leadLength") is not None:
        out["l"] = num(presentation["leadLength"])
    if presentation.get("visibility") and presentation["visibility"] != "visible":
        out["v"] = presentation["visibility"]
    if presentation.get("showName"):
        out["show"] = 1
    if presentation.get("displayName"):
        out["dn"] = presentation["displayName"]
    if presentation.get("textSizeScale") is not None:
        out["scale"] = num(presentation["textSizeScale"])
    if presentation.get("textStyle"):
        out["ts"] = presentation["textStyle"]
    return out


def variant_of(variant):
    out = {"id": variant["id"]}
    if variant.get("hiddenPinNames"):
        out["hide"] = variant["hiddenPinNames"]
    if variant.get("hiddenPrimitiveParts"):
        out["hideParts"] = variant["hiddenPrimitiveParts"]
    if variant.get("auxiliaryPins"):
        out["aux"] = [{
            "n": aux["name"],
            "x": num(aux["at"]["x"]),
            "y": num(aux["at"]["y"]),
            "d": aux["direction"],
        } for aux in variant["auxiliaryPins"]]
    if variant.get("additionalPrimitives"):
        out["add"] = [primitive_of(p) for p in variant["additionalPrimitives"]]
    return out


def symbol_of(definition):
    symbol = definition["symbol"]
    catalog = definition["catalog"]
    box = symbol["viewBox"]
    out = {
        "name": symbol["name"],
        "cat": catalog.get("category"),
        "vb": [num(box["x"]), num(box["y"]), num(box["width"]), num(box["height"])],
        "pins": [pin_of(pin) for pin in symbol["pins"]],
        "prim": [primitive_of(p) for p in symbol["primitives"]],
    }
    if catalog.get("name"):
        out["catName"] = catalog["name"]
    if symbol.get("labelVisibility"):
        out["label"] = symbol["labelVisibility"]
    if symbol.get("variants"):
        out["var"] = [variant_of(v) for v in symbol["variants"]]
    if symbol.get("defaultVariantId"):
        out["def"] = symbol["defaultVariantId"]
    formula = symbol.get("formulaPresentation")
    if formula:
        center = formula.get("center") or {}
        out["formula"] = {
            "text": formula.get("defaultFormula"),
            "size": num(formula.get("fontSize")),
            "cx": num(center.get("x", 0)),
            "cy": num(center.get("y", 0)),
        }
    return symbol["id"], out


BANNER = """/*
  符号几何 —— 逐字取自 Analog Canvas 的元件定义，未做任何坐标改写。
  来源：https://github.com/cascode-ai/analog-canvas
        packages/components/definitions/<symbol-id>.json
  上游作品：Copyright (C) 2026 Zengchun Chen 与 Zhishuai Zhang，AGPL-3.0-only。
  本文件由 tools/build-symbols.py 生成，请勿手工编辑。

  SPDX-License-Identifier: AGPL-3.0-only
*/
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--fetch", action="store_true",
                        help="re-download the definitions before generating")
    args = parser.parse_args()

    if args.fetch or not os.path.isdir(CACHE):
        fetch()

    names = sorted(n for n in os.listdir(CACHE) if n.endswith(".json")
                   and not n.startswith("_"))
    if not names:
        raise SystemExit(f"no definitions in {CACHE}; run with --fetch")

    symbols = {}
    for name in names:
        with open(os.path.join(CACHE, name), encoding="utf-8") as handle:
            definition = json.load(handle)
        symbol_id, payload = symbol_of(definition)
        symbols[symbol_id] = payload

    body = json.dumps(symbols, ensure_ascii=False, separators=(",", ":"),
                      sort_keys=True)
    with open(OUTPUT, "w", encoding="utf-8") as handle:
        handle.write(BANNER)
        handle.write("window.ANALOG_CANVAS_SYMBOLS = ")
        handle.write(body)
        handle.write(";\n")

    print(f"wrote {OUTPUT}: {len(symbols)} symbols, "
          f"{os.path.getsize(OUTPUT) / 1024:.1f} KiB")


if __name__ == "__main__":
    sys.exit(main())
