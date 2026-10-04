#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
virtuoso-to-canvas.py — 把 Virtuoso schematic 导出的 JSON 转成 circuit-canvas 画布 HTML。

数据流：
  Virtuoso CIW / Schematic Editor 里跑 circuit_canvas.il（内部调 cc_export.il）
      → schematic.json（实例 / 网络 / 引脚 / label，Virtuoso 坐标，y 向上）
  本脚本
      → assets/<id>-canvas.js（circuit-canvas 画布数据）
      → <id>.html（独立画布文件，借 tools/build-canvas-file.py 的外壳）

符号替换：按「lib/cell 精确表 → cell 名精确表 → cell 名正则规则」三级匹配，
把 analogLib / basic / GPDK045 / 自定义 PDK 的单元映射成元件库里的符号
（电阻/电容/电感/MOS/BJT/电源/地/端口……），未识别的实例跳过并列出警告。

用法：
  python3 tools/virtuoso-to-canvas.py schematic.json --out opamp.html \
      --id opamp-sheet --title "Two-stage Miller Opamp" [--scale 160] [--portable]
"""
import argparse
import hashlib
import importlib.util
import json
import math
import os
import re
import sys
from collections import deque

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# ---------------------------------------------------------------- 符号库

# 画布元件类型 → 上游符号（与 app.js 的 PART_SOURCE 保持一致）
_PART_SOURCE = {
    'resistor': 'resistor', 'capacitor': 'capacitor', 'inductor': 'inductor',
    'voltage': 'voltage-source', 'pulse-voltage': 'pulse-voltage-source',
    'current': 'current-source', 'ground': 'ground', 'vdd-port': 'vdd-port',
    'port': 'port', 'diode': 'diode', 'zener-diode': 'zener-diode',
    'nmos': ('nmos', 'textbook-3terminal'), 'pmos': ('pmos', 'textbook-3terminal'),
    'nmos-bulk': 'nmos', 'pmos-bulk': 'pmos',
    'npn': 'npn', 'pnp': 'pnp',
}
_BUILTIN_PINS = {'junction': [{'n': '1', 'x': 0, 'y': 0}]}  # app.js 内置，不在上游库

# Virtuoso 方位 → (画布旋转角, 是否水平镜像)；画布 y 向下，导入时整体做 y 翻转
ORIENT = {
    'R0': (0, ''), 'R90': (270, ''), 'R180': (180, ''), 'R270': (90, ''),
    'MY': (0, 'x'), 'MX': (180, 'x'), 'MYR90': (270, 'x'), 'MXR90': (90, 'x'),
}

GRID = 10
MARGIN = 100
AUTO_NET = re.compile(r'^(net|n)\d+$', re.I)

# ---------------------------------------------------------------- 教科书排版
# 参考 Razavi《Design of Analog CMOS Integrated Circuits》、Gray & Meyer、
# Allen & Holberg、Abidi 的论文插图，好原理图的美感来自这几条硬规矩：
#
#   1. 电路被压成若干水平「电平层」，同一层的引脚严格共线 → 导线天生是直线，
#      不需要"折线绕行"，也就没有台阶状的丑线。
#   2. 最上面一条电源轨、最下面一条地轨，器件垂直挂在两轨之间；
#      地一般不画成散落各处的符号，而是汇到一条水平线上。
#   3. 差分对 / 电流镜关于竖直轴严格镜像（误差为 0，不是"差不多"）。
#   4. 只用水平段和垂直段；拐角能 1 个就不 2 个；不横穿器件本体。
#   5. 器件朝一个规矩方向（NMOS 漏上源下、PMOS 源上漏下、NPN 集上射下），
#      文字标注统一字号、统一相对位置，不压线不压器件。
#   6. 等间距：同一层的器件水平间隔一致。
#
# 注意：Virtuoso 的符号尺寸和我们画布的符号尺寸差 3~5 倍（源图一个电阻跨
# 1.25in，我们只有 0.25in），所以"把原图走线原样搬过来"永远画不出教科书效果：
# 线长是按大符号算的，套在小符号上就是一堆又长又空的残线。正解是重排。

_PIN_SPAN = 40.0   # 我们的符号上下两脚的距离（电阻/MOS/三极管都是 40）
# 一个「电平层」的高度 = 引脚跨度 + 一个元件的高度。器件挂在两条层线之间，
# 上下各留 24 单位的可见短线 —— 视觉上就是「器件之间空出一个元件的高度」。
_LVL = _PIN_SPAN + 48.0
_MIN_X = 20.0      # 同层器件之间要留的最小水平间隙（不是中心距）
_DECO_GAP = 130.0  # 端口/电源/地装饰与电路本体之间的水平间距（源图里常被摆得很远）
_OVL_TOL = 10.0    # 相邻电平层器件的图元会天然叠 8 单位（引脚 ±20、图元 ±24），不算遮挡
WIRE_JOG = 30      # 与 app.js 的 WIRE_JOG 保持一致（绕行导线的让位距离）

GROUND_RE = re.compile(r'^(a?vss|d?vss|gnd[a-z0-9_]*|agnd|dgnd|vbb|vee)$', re.I)
SUPPLY_RE = re.compile(r'^(a?vdd|d?vdd|vdd[a-z0-9_]*|vcc[a-z0-9_]*|vbat|vddio|vvdd)$',
                       re.I)

# 器件的「通路端子」（电流自上而下穿过的那两个脚）与「控制端子」（栅/基极）。
# 分层只看通路端子：控制脚不该把电平往下拽。
_THROUGH = {
    'nmos': ('D', 'S'), 'pmos': ('D', 'S'),
    'nmos-bulk': ('D', 'S'), 'pmos-bulk': ('D', 'S'),
    'npn': ('C', 'E'), 'pnp': ('C', 'E'),
    'resistor': ('1', '2'), 'capacitor': ('1', '2'), 'inductor': ('1', '2'),
    'voltage': ('+', '-'), 'pulse-voltage': ('+', '-'), 'current': ('+', '-'),
    'diode': ('A', 'K'), 'zener-diode': ('A', 'K'),
}
_CONTROL = {
    'nmos': ('G',), 'pmos': ('G',), 'nmos-bulk': ('G', 'B'), 'pmos-bulk': ('G', 'B'),
    'npn': ('B',), 'pnp': ('B',),
}


def through_indices(ptype, pins):
    """器件的「通路端子」下标：电流自上而下穿过的那两个脚（MOS 的 D-S、
    BJT 的 C-E、两端元件的两脚）。黑盒矩形没有内部信息，四个脚都算通路。"""
    if ptype == 'block':
        return list(range(len(pins)))
    tp = _THROUGH.get(ptype)
    if not tp:
        return []
    return [i for i, (nm, _, _) in enumerate(pins) if nm.upper() in tp]


def vspan(pins, thr):
    """通路端子的竖直跨度：>0 表示这是个「竖直」元件（要往下走一层），
    0 表示水平元件（它连的两个节点在同一行）。"""
    ys = [pins[i][2] for i in thr]
    return (max(ys) - min(ys)) if len(ys) >= 2 else 0.0


def vflip(comp):
    """上下镜像一个器件（保持它在画布里的变换式可表示：旋转 + 水平镜像）。"""
    comp['rotation'] = (180 - (comp['rotation'] or 0)) % 360
    comp['flip'] = '' if comp['flip'] == 'x' else 'x'


def hmirror(comp, ref):
    """把 comp 变成 ref 的左右镜像（教科书里差分对的两半就是这样画）。"""
    comp['rotation'] = (-(ref['rotation'] or 0)) % 360
    comp['flip'] = '' if ref['flip'] == 'x' else 'x'


def wire_points(a, b, mode=None):
    """复刻 app.js 的 pathBetween，返回这条导线的顶点表。
    用来判断“某个端点是不是落在另一条导线中间”（T 形三通要补连接点）。"""
    ax, ay = a
    bx, by = b
    if abs(ax - bx) < 2 and abs(ay - by) < 2:
        return [a, b]
    if mode == 'hl':
        return [a, (bx, ay), b]
    if mode == 'lv':
        return [a, (ax, by), b]
    if mode in ('h-', 'h+'):
        x0 = (round(min(ax, bx) - WIRE_JOG) if mode == 'h-'
              else round(max(ax, bx) + WIRE_JOG))
        return [a, (x0, ay), (x0, by), b]
    if mode in ('v-', 'v+'):
        y0 = (round(min(ay, by) - WIRE_JOG) if mode == 'v-'
              else round(max(ay, by) + WIRE_JOG))
        return [a, (ax, y0), (bx, y0), b]
    if abs(ax - bx) < 2 or abs(ay - by) < 2:
        return [a, b]
    if mode == 'v':
        my = round((ay + by) / 2)
        return [a, (ax, my), (bx, my), b]
    mx = round((ax + bx) / 2)
    return [a, (mx, ay), (mx, by), b]


def load_catalog():
    text = open(os.path.join(REPO, 'symbols.generated.js'), encoding='utf-8').read()
    start = text.index('{', text.index('='))
    return json.loads(text[start:text.rindex('}') + 1])


def effective_pins(catalog, ptype):
    """复制 app.js applyUpstreamGeometry 的引脚推导，返回 [(name, x, y), ...]。"""
    if ptype == 'block':
        return []                         # 黑盒的引脚随实例，见 comp_pins()
    src = _PART_SOURCE.get(ptype)
    if src is None:
        if ptype in catalog:
            src = ptype
        elif ptype in _BUILTIN_PINS:
            return [(p['n'], p['x'], p['y']) for p in _BUILTIN_PINS[ptype]]
        else:
            raise KeyError(f'未知元件类型 {ptype}')
    sym_id, var_id = src if isinstance(src, tuple) else (src, None)
    sym = catalog[sym_id]
    hidden = set()
    if var_id:
        var = next(v for v in sym.get('var', []) if v['id'] == var_id)
        hidden = set(var.get('hide', []))
    return [(p['n'], p['x'], p['y']) for p in sym['pins'] if p['n'] not in hidden]


def comp_pins(catalog, comp):
    """元件的引脚表 [(name, x, y), ...]。黑盒矩形把引脚直接存在元件上。"""
    if comp.get('pins') is not None:
        return [(p['n'], p['x'], p['y']) for p in comp['pins']]
    return effective_pins(catalog, comp['type'])


# ---------------------------------------------------------------- 单元映射
# 三级匹配：lib/cell 精确 → cell 名精确 → 正则规则。
# 每一项 = (画布元件类型, {Virtuoso 端子名: 画布引脚名}, 取值函数)

def _v_wl(inst):
    p = inst.get('props', {})
    w = p.get('w') or p.get('wf') or p.get('W')
    l = p.get('l') or p.get('lf') or p.get('L')
    return f'W/L = {w}/{l}' if w and l else ''


def _v_key(*keys):
    def f(inst):
        p = inst.get('props', {})
        for k in keys:
            if p.get(k):
                return str(p[k])
        return ''
    return f


def _v_none(inst):
    return ''


def _v_r(inst):
    """电阻：优先 Rnom，其次 r。"""
    p = inst.get('props', {})
    for k in ('r', 'Rnom', 'resistance', 'R'):
        if p.get(k):
            return str(p[k])
    return ''


MASKS = {'PLUS': '+', 'MINUS': '-'}
PASSIVE2 = {'PLUS': '1', 'MINUS': '2', '1': '1', '2': '2'}
MOS_VAL = _v_wl

# ① lib/cell 精确（小写）
FULL_MAP = {
    'basic/gnd':        ('ground', {}, _v_none),
    'basic/ipin':       ('port', {}, _v_none),   # 顶层引脚，通常与 dbPin 重合
    'basic/opin':       ('port', {}, _v_none),
    'basic/iopin':      ('port', {}, _v_none),
    'analoglib/gnd':    ('ground', {}, _v_none),
    'analoglib/vdd':    ('vdd-port', {}, _v_none),
    'analoglib/vss':    ('ground', {}, _v_none),
    'analoglib/res':    ('resistor', PASSIVE2, _v_r),
    'analoglib/cap':    ('capacitor', PASSIVE2, _v_key('c', 'capacitance')),
    'analoglib/ind':    ('inductor', PASSIVE2, _v_key('l', 'inductance')),
    'analoglib/nmos4':  ('nmos-bulk', {}, MOS_VAL),
    'analoglib/pmos4':  ('pmos-bulk', {}, MOS_VAL),
    'analoglib/npn':    ('npn', {}, _v_key('model')),
    'analoglib/pnp':    ('pnp', {}, _v_key('model')),
    'analoglib/diode':  ('diode', PASSIVE2, _v_key('model')),
    'analoglib/vdc':    ('voltage', MASKS, _v_key('vdc', 'dc')),
    'analoglib/vsin':   ('voltage', MASKS, _v_key('va', 'vdc')),
    'analoglib/vsource': ('voltage', MASKS, _v_key('vdc', 'dc')),
    'analoglib/vpulse': ('pulse-voltage', MASKS, _v_key('v1', 'v2')),
    'analoglib/idc':    ('current', MASKS, _v_key('idc', 'dc')),
    'analoglib/isource': ('current', MASKS, _v_key('idc', 'dc')),
    'aexamples/rplr':   ('resistor', PASSIVE2, _v_r),
    'aexamples/tnsa':   ('npn', {}, _v_key('model')),
}

# ② cell 名精确（小写）—— 库不限
CELL_MAP = {
    'res':       ('resistor', PASSIVE2, _v_r),
    'resistor':  ('resistor', PASSIVE2, _v_r),
    'cap':       ('capacitor', PASSIVE2, _v_key('c', 'capacitance')),
    'capacitor': ('capacitor', PASSIVE2, _v_key('c', 'capacitance')),
    'mimcap':    ('capacitor', PASSIVE2, _v_key('c', 'cf')),
    'momcap':    ('capacitor', PASSIVE2, _v_key('c', 'cf')),
    'ind':       ('inductor', PASSIVE2, _v_key('l', 'inductance')),
    'inductor':  ('inductor', PASSIVE2, _v_key('l', 'inductance')),
    'nmos':      ('nmos', {}, MOS_VAL),
    'pmos':      ('pmos', {}, MOS_VAL),
    'nmos4':     ('nmos-bulk', {}, MOS_VAL),
    'pmos4':     ('pmos-bulk', {}, MOS_VAL),
    'nmos3':     ('nmos', {}, MOS_VAL),
    'pmos3':     ('pmos', {}, MOS_VAL),
    'npn':       ('npn', {}, _v_key('model')),
    'pnp':       ('pnp', {}, _v_key('model')),
    'diode':     ('diode', PASSIVE2, _v_key('model')),
    'dio':       ('diode', PASSIVE2, _v_key('model')),
    'vdc':       ('voltage', MASKS, _v_key('vdc', 'dc')),
    'vsin':      ('voltage', MASKS, _v_key('va', 'vdc')),
    'vpulse':    ('pulse-voltage', MASKS, _v_key('v1', 'v2')),
    'idc':       ('current', MASKS, _v_key('idc', 'dc')),
    'vdd':       ('vdd-port', {}, _v_none),
    'vcc':       ('vdd-port', {}, _v_none),
    'vss':       ('ground', {}, _v_none),
    'gnd':       ('ground', {}, _v_none),
    'ipin':      ('port', {}, _v_none),
    'opin':      ('port', {}, _v_none),
    'iopin':     ('port', {}, _v_none),
    'port':      ('port', {}, _v_none),
}

# ③ 正则规则（按顺序，第一个匹配生效）。cell 名先转小写。
PATTERN_RULES = [
    (r'^(qnmos|nmos|nch|n_mos|nmosfet|mn)', 'nmos'),
    (r'^(qpmos|pmos|pch|p_mos|pmosfet|mp)', 'pmos'),
    (r'^(ndio|pdio|dio|diode)', 'diode'),
    (r'^(npn|vpnp|pnp)', 'npn'),
    (r'^(mimcap|momcap|cvar|nmoscap|pmoscap|cap|cf|mc)', 'capacitor'),
    (r'^(primres|res|rn|rp|rpo|rppoly|rnpoly|rm\d|r\d)', 'resistor'),
    (r'^(ind|spiral)', 'inductor'),
    (r'^(vdc|vsin|vpulse|vsour|vsrc|vsource)', 'voltage'),
    (r'^(idc|isrc|isour|isource|ibias)', 'current'),
    (r'^(gnd|agnd|dgnd|vss)', 'ground'),
    (r'^(vdd|vcc|vddio)', 'vdd-port'),
    (r'^(ipin|opin|iopin|pin|port|term)', 'port'),
]


def block_sides(inst, nets, data):
    origin = inst['xy']
    conn = {}
    for net in nets:
        for nm, term in net.get('conns', []):
            if nm == inst['name']:
                conn[str(term)] = net['name']
    pts_of = {}
    for w in (data.get('wireShapes') or []):
        pts_of.setdefault(w.get('net'), []).extend(w.get('points') or [])
    sides = {}
    for term in (inst.get('terms') or []):
        pts = pts_of.get(conn.get(str(term)))
        if not pts:
            continue
        best = min(pts, key=lambda p: (p[0] - origin[0]) ** 2 + (p[1] - origin[1]) ** 2)
        dx, dy = best[0] - origin[0], best[1] - origin[1]
        if abs(dx) >= abs(dy):
            sides[str(term)] = 'right' if dx >= 0 else 'left'
        else:
            sides[str(term)] = 'top' if dy >= 0 else 'bottom'
    return sides


def crosses_box(path, box, pad=2.0):
    """折线是否横穿某个器件本体（只是端点贴在框边不算）。"""
    x0, y0, w, h = box
    for k in range(len(path) - 1):
        ax, ay = path[k]
        bx, by = path[k + 1]
        if abs(ax - bx) < 0.5:                       # 竖直段
            if x0 + 1 < ax < x0 + w - 1:
                lo, hi = sorted((ay, by))
                if min(hi, y0 + h) - max(lo, y0) > pad:
                    return True
        elif abs(ay - by) < 0.5:                     # 水平段
            if y0 + 1 < ay < y0 + h - 1:
                lo, hi = sorted((ax, bx))
                if min(hi, x0 + w) - max(lo, x0) > pad:
                    return True
    return False


def match_map(cell, lib=''):
    """三级匹配，返回 (画布类型, 端子表, 取值函数) 或 None。"""
    hit = FULL_MAP.get(f'{lib.lower()}/{cell.lower()}')
    if hit:
        return hit
    hit = CELL_MAP.get(cell.lower())
    if hit:
        return hit
    low = cell.lower()
    for pattern, ptype in PATTERN_RULES:
        if re.search(pattern, low):
            if ptype in ('nmos', 'pmos'):
                return (ptype, {}, MOS_VAL)
            if ptype in ('resistor',):
                return (ptype, PASSIVE2, _v_r)
            if ptype in ('capacitor', 'inductor'):
                return (ptype, PASSIVE2, _v_key('c', 'cf', 'l', 'inductance'))
            if ptype in ('voltage', 'current'):
                return (ptype, MASKS, _v_key('vdc', 'dc', 'idc'))
            return (ptype, {}, _v_none)
    return None


def snap(v):
    return round(v / GRID) * GRID


def round2(v):
    return round(v * 100) / 100


def resolve_pin(pin_names, term, term_map, positional=False):
    """Virtuoso 端子名 → 有效引脚下标。找不到返回 None。"""
    upper = term.upper()
    candidates = [term_map[upper]] if upper in term_map else []
    if upper in ('PLUS', 'MINUS'):
        candidates += [{'PLUS': '1', 'MINUS': '2'}[upper],
                       {'PLUS': '+', 'MINUS': '-'}[upper]]
    candidates.append(term)
    have = {n.upper(): i for i, n in enumerate(pin_names)}
    for cand in candidates:
        if cand.upper() in have:
            return have[cand.upper()]
    if positional and len(pin_names) == 1:
        return 0
    return None


# ---------------------------------------------------------------- 转换主函数

def convert(data, canvas_id, title, scale, net_labels=True, label_scale=1.0,
            real_wires=True, layout='textbook', keep_bulk=False):
    catalog = load_catalog()
    src = data.get('source', {})
    instances = data.get('instances', [])
    nets = data.get('nets', [])
    top_pins = data.get('pins', [])
    labels = data.get('labels', [])

    # ── 坐标变换 ─────────────────────────────────────────────────────────
    # 吸附原点取「器件位置的重心」，不是 bbox 左下角：仿真里左右对称的版图，
    # 若按 bbox 取整，对称轴两侧会各自独立取整而差出 1 格；按重心取整
    # （对称版图的重心正好落在对称轴上）则镜像关系被精确保持。
    if not instances:
        sys.exit('schematic 里没有任何实例，无法确定画布范围')
    gx = sum(i['xy'][0] for i in instances) / len(instances)
    gy = sum(i['xy'][1] for i in instances) / len(instances)

    def quant(x, y):
        """Virtuoso 坐标 → 以重心为原点、格点化的坐标（X 向右 / Y 向上）。"""
        return (round((x - gx) * scale / GRID) * GRID,
                round((y - gy) * scale / GRID) * GRID)

    probe = [quant(*i['xy']) for i in instances]
    probe += [quant(*p['xy']) for p in top_pins]
    probe += [quant(*l['xy']) for l in labels]
    for w in (data.get('wireShapes') or []):
        probe += [quant(*pt) for pt in w.get('points', [])]
    minX = min(p[0] for p in probe)
    maxX = max(p[0] for p in probe)
    minY = min(p[1] for p in probe)
    maxY = max(p[1] for p in probe)

    def place(x, y):
        """Virtuoso 坐标 → 画布坐标（y 轴向下）。"""
        X, Y = quant(x, y)
        return X - minX + MARGIN, maxY - Y + MARGIN

    # ── 实例 → 元件 ───────────────────────────────────────────────────────
    components, skipped, unrouted = [], [], []
    blocks_made = []
    bulk_dropped = 0
    comp_of, pins_of = {}, {}
    info_of = {}
    # 每个实例的「端子 → 网络名」，用来判断衬底是不是接到了源/漏（默认做法）
    term_net = {}
    for net in nets:
        for inst_name, term in net.get('conns', []):
            term_net.setdefault(inst_name, {})[str(term).upper()] = net['name']
    pin_xy = [(p['xy'][0], p['xy'][1]) for p in top_pins]
    uses_pins = len(pin_xy) > 0

    for inst in instances:
        cell, lib = inst['cell'], inst['lib']
        # 已经有真正的 pin 对象时，ipin/opin 只是画在同位置的空符号，跳过
        if uses_pins and cell.lower() in ('ipin', 'opin', 'iopin'):
            x0, y0 = inst['xy']
            if any(abs(x0 - px) < 1e-6 and abs(y0 - py) < 1e-6 for px, py in pin_xy):
                continue
        hit = match_map(cell, lib)
        terms = [str(t) for t in (inst.get('terms') or [])]
        if not hit:
            # 未识别的单元：不跳过，画成矩形黑盒 —— 引脚名照抄 Virtuoso 的端子名，
            # 引脚的左右上下用原图走线的方向判断。这样 custom cell（VCO/LF/PD…）
            # 也看得见，连线不会凭空断掉。
            cols = {'left': [], 'right': [], 'top': [], 'bottom': []}
            sides = block_sides(inst, nets, data)
            for t in terms:
                cols[sides.get(t, 'left')].append(t)
            v_gap, h_gap = 36.0, 44.0
            n_lr = max(len(cols['left']), len(cols['right']), 1)
            n_tb = max(len(cols['top']), len(cols['bottom']), 0)
            longest = max((len(t) for t in terms), default=2)
            bw = max(120.0, 9.0 * longest + 36.0, n_tb * h_gap + 20.0)
            bh = max(70.0, n_lr * v_gap + 16.0)
            geom = []
            for side in ('left', 'right'):
                grp = cols[side]
                for k, t in enumerate(grp):
                    py = (k - (len(grp) - 1) / 2.0) * v_gap
                    geom.append((t, (-1 if side == 'left' else 1) * (bw / 2 + 20), py))
            for side in ('top', 'bottom'):
                grp = cols[side]
                for k, t in enumerate(grp):
                    px = (k - (len(grp) - 1) / 2.0) * h_gap
                    geom.append((t, px, (-1 if side == 'top' else 1) * (bh / 2 + 20)))
            x, y = place(*inst['xy'])
            comp = {
                'id': f'c{len(components) + 1}', 'type': 'block',
                'name': str(inst['name'])[:20], 'value': str(cell)[:40],
                'x': x, 'y': y, 'rotation': 0, 'flip': '',
                'w': bw, 'h': bh, 'labelPos': 'above',
                'pins': [{'n': t, 'dn': t, 'x': round2(px), 'y': round2(py)}
                         for t, px, py in geom],
            }
            components.append(comp)
            comp_of[inst['name']] = comp
            pins_of[comp['id']] = [t for t, _, _ in geom]
            info_of[inst['name']] = (cell, lib, {}, list(pins_of[comp['id']]))
            blocks_made.append(f"{inst['name']}（{lib}/{cell}，{len(terms)} 脚）")
            continue
        ptype, term_map, vfn = hit
        # 有 bulk 端子的 MOS 换成四端符号，画出来才和原理图一致
        if ptype in ('nmos', 'pmos') and any(t.upper() == 'B' for t in terms):
            ptype = {'nmos': 'nmos-bulk', 'pmos': 'pmos-bulk'}[ptype]
        # 衬底直接接在源（或漏）上 → 改用三端符号。四端符号的 bulk 脚长在右边，
        # 引到下/上面的轨上必然要拐一下；而且 bulk 接源本来就是默认做法，
        # 画成三端更干净（想保留四端用 --keep-bulk）。
        if not keep_bulk and ptype in ('nmos-bulk', 'pmos-bulk'):
            tn = term_net.get(inst['name'], {})
            nb = tn.get('B')
            if nb and nb in (tn.get('S'), tn.get('D')):
                ptype = {'nmos-bulk': 'nmos', 'pmos-bulk': 'pmos'}[ptype]
                bulk_dropped += 1
        pins = effective_pins(catalog, ptype)
        x, y = place(*inst['xy'])
        rot, flip = ORIENT.get(str(inst.get('orient', 'R0')), (0, ''))
        try:
            value = str(vfn(inst)) if vfn else ''
        except Exception:
            value = ''
        comp = {
            'id': f'c{len(components) + 1}', 'type': ptype,
            'name': str(inst['name'])[:20], 'value': value[:40],
            'x': x, 'y': y, 'rotation': rot, 'flip': flip,
        }
        components.append(comp)
        comp_of[inst['name']] = comp
        pins_of[comp['id']] = [n for n, _, _ in pins]
        info_of[inst['name']] = (cell, lib, term_map, list(pins_of[comp['id']]))

    # ── 顶层引脚 → port 元件 ──────────────────────────────────────────────
    for p in top_pins:
        x, y = place(*p['xy'])
        comp = {
            'id': f'c{len(components) + 1}', 'type': 'port',
            'name': str(p['name'])[:20], 'value': '',
            'x': x, 'y': y, 'rotation': 0, 'flip': '',
        }
        components.append(comp)
        comp_of[f'\x00pin:{p["name"]}'] = comp
        pins_of[comp['id']] = [n for n, _, _ in effective_pins(catalog, 'port')]

    # ── 电源/地符号合并 ───────────────────────────────────────────────────
    # 教科书里一个网络只画一个电源/地符号：源图里散落三处的 gnd 会各自带一段
    # 短残线，看着像没画完。合并成一个，剩下交给轨走线。
    merged_syms = 0
    if layout == 'textbook':
        owner = {}
        for net in nets:
            for inst_name, _t in net.get('conns', []):
                owner.setdefault(inst_name, net['name'])
        bucket = {}
        for inst in instances:
            c = comp_of.get(inst['name'])
            if c and c['type'] in ('ground', 'vdd-port'):
                bucket.setdefault((c['type'], owner.get(inst['name'])), []).append(
                    (inst['name'], c))
        for items in bucket.values():
            if len(items) < 2:
                continue
            # 地留在最下面那个、电源留在最上面那个，位置最接近教科书画法
            keep = (max if items[0][1]['type'] == 'ground' else min)(
                items, key=lambda it: it[1]['y'])[1]
            for name, c in items:
                if c is not keep:
                    components.remove(c)
                    comp_of.pop(name, None)
                    merged_syms += 1

    comp_by_id = {c['id']: c for c in components}

    def new_cid():
        """新元件 id：合并电源地符号后 id 会不连续，按 len() 取号会和旧号撞车。"""
        used = {c['id'] for c in components}
        k = len(components) + 1
        while f'c{k}' in used:
            k += 1
        return f'c{k}'

    # ── 引脚画布坐标 / 朝向 ───────────────────────────────────────────────
    def pin_canvas_pos(comp, index):
        _, px, py = comp_pins(catalog, comp)[index]
        if comp['flip'] == 'x':
            px = -px
        a = math.radians(comp['rotation'])
        return (comp['x'] + px * math.cos(a) - py * math.sin(a),
                comp['y'] + px * math.sin(a) + py * math.cos(a))

    def pin_face(comp, index):
        _, px, py = comp_pins(catalog, comp)[index]
        if comp['flip'] == 'x':
            px = -px
        a = math.radians(comp['rotation'])
        fx = px * math.cos(a) - py * math.sin(a)
        fy = px * math.sin(a) + py * math.cos(a)
        if abs(fx) >= abs(fy) and fx:
            return (1 if fx > 0 else -1), 0
        return (0, 1 if fy > 0 else -1) if fy else (0, 1)

    def wire_mode(a_pos, a_face, b_pos, b_face):
        """选折线走法：直线 > 一个拐角（L）> 两个拐角（Z），并尽量不横穿元件本体。

        一个拐角有两种走法：
          C1 = (b.x, a.y)：从 a 横着出去、竖着进 b            → 'hl'
          C2 = (a.x, b.y)：从 a 竖着出去、横着进 b            → 'lv'
        按两端引脚「朝外方向」打分：离开 a / 进入 b 的方向与引脚朝外方向一致最自然。"""
        ax, ay = a_pos
        bx, by = b_pos
        if abs(ax - bx) < 2 or abs(ay - by) < 2:
            return 'h'                       # 已经同排/同列 → 直线
        dx = 1 if bx > ax else -1
        dy = 1 if by > ay else -1

        def score(a_want, b_want):
            s = 0
            s += 3 if a_face == a_want else 0
            s += 3 if b_face == b_want else 0
            s -= 3 if a_face == (-a_want[0], -a_want[1]) else 0
            s -= 3 if b_face == (-b_want[0], -b_want[1]) else 0
            s += 1 if (a_want[0] and a_face[0] == a_want[0]) or \
                     (a_want[1] and a_face[1] == a_want[1]) else 0
            s += 1 if (b_want[0] and b_face[0] == b_want[0]) or \
                     (b_want[1] and b_face[1] == b_want[1]) else 0
            return s

        s1 = score((dx, 0), (0, dy))         # 先横后竖
        s2 = score((0, dy), (dx, 0))         # 先竖后横
        if s1 > 0 and s1 >= s2:
            return 'hl'
        if s2 > 0:
            return 'lv'
        # 两种 L 都会从引脚背面穿出去 → 退回 Z 形，仍然躲开元件本体
        h_bad = (a_face[0] and dx == -a_face[0]) or (b_face[0] and dx == b_face[0])
        v_bad = (a_face[1] and dy == -a_face[1]) or (b_face[1] and dy == b_face[1])
        return 'v' if h_bad and not v_bad else 'h'

    # ── 网络 → 导线 ───────────────────────────────────────────────────────
    wires, texts, dangling = [], [], []
    tally = {}
    cur_net = None

    def add_wire(a, b, hidden=False):
        ca, cb = comp_by_id[a[0]], comp_by_id[b[0]]
        pa, pb = pin_canvas_pos(ca, a[1]), pin_canvas_pos(cb, b[1])
        wire = {'id': f'w{len(wires) + 1}',
                'from': {'component': a[0], 'pin': a[1]},
                'to': {'component': b[0], 'pin': b[1]}}
        if cur_net:
            wire['net'] = cur_net
        mode = wire_mode(pa, pin_face(ca, a[1]), pb, pin_face(cb, b[1]))
        if mode != 'h':
            wire['mode'] = mode
        # 已经有真实走线几何的网络：这条自动生成的导线仍然保留（网表要用），
        # 但不画出来 —— 画面用原图走线，关掉“原图走线”层就能看到这条可编辑版。
        if hidden:
            wire['hidden'] = True
        else:
            if abs(pa[0] - pb[0]) < 2 or abs(pa[1] - pb[1]) < 2:
                tally['直线'] = tally.get('直线', 0) + 1
            elif mode in ('hl', 'lv'):
                tally['单拐'] = tally.get('单拐', 0) + 1
            else:
                tally['双拐'] = tally.get('双拐', 0) + 1
        wires.append(wire)

    label_texts = {str(l.get('text', '')).strip() for l in labels}

    # ── 去重叠：我们的符号尺寸和 Virtuoso 的不完全一样，偶尔会压在一起 ──────
    # 按「重叠更小的那个轴」把两者各推开一半，位移取整到网格，保证对称/网格不被破坏。
    # 教科书重排会自己按「同层水平分离」处理遮挡，这里就不动手了（否则会打乱行）。
    movable = [c for c in components if c['type'] != 'junction']
    if layout != 'textbook' and len(movable) > 1:
        for _round in range(32):
            boxes = {c['id']: comp_box(catalog, c) for c in movable}
            worst = None
            for i in range(len(movable)):
                for j in range(i + 1, len(movable)):
                    ca, cb = movable[i], movable[j]
                    ax0, ay0, aw, ah = boxes[ca['id']]
                    bx0, by0, bw, bh = boxes[cb['id']]
                    ox = min(ax0 + aw, bx0 + bw) - max(ax0, bx0)
                    oy = min(ay0 + ah, by0 + bh) - max(ay0, by0)
                    if ox > 0 and oy > 0:
                        if worst is None or min(ox, oy) > min(worst[2], worst[3]):
                            worst = (ca, cb, ox, oy)
            if worst is None:
                break
            ca, cb, ox, oy = worst
            if oy <= ox:                       # 竖直方向重叠更小 → 上下让开
                d = math.ceil((oy / 2 + 8) / GRID) * GRID
                up, dn = (ca, cb) if ca['y'] <= cb['y'] else (cb, ca)
                up['y'] -= d
                dn['y'] += d
            else:                              # 水平方向重叠更小 → 左右让开
                d = math.ceil((ox / 2 + 8) / GRID) * GRID
                left, right = (ca, cb) if ca['x'] <= cb['x'] else (cb, ca)
                left['x'] -= d
                right['x'] += d

    # ── 每条网络的端点（元件引脚 + 挂在同名网上的顶层引脚）──────────────
    def net_endpoints_of(net):
        eps, seen = [], set()
        for inst_name, term in net.get('conns', []):
            comp = comp_of.get(inst_name)
            if not comp:
                continue
            info = info_of.get(inst_name)
            term_map = info[2] if info else {}
            idx = resolve_pin(pins_of[comp['id']], term, term_map, positional=True)
            if idx is None:
                if term.upper() == 'B':      # 三端符号上没有 bulk 引脚，忽略
                    continue
                unrouted.append(f"{inst_name}.{term}（net {net['name']}）")
                continue
            if (comp['id'], idx) not in seen:
                seen.add((comp['id'], idx))
                eps.append((comp['id'], idx))
        for p in top_pins:
            if p.get('net') == net['name']:
                comp = comp_of.get(f'\x00pin:{p["name"]}')
                if comp and (comp['id'], 0) not in seen:
                    seen.add((comp['id'], 0))
                    eps.append((comp['id'], 0))
        return eps

    net_endpoints = {net['name']: net_endpoints_of(net) for net in nets}

    # ══ 教科书式重排 ═══════════════════════════════════════════════════════
    # 把电路压成若干水平「电平层」，同层引脚共线 → 导线自然是直线。
    # 见文件顶部「教科书排版」注释里的六条规矩。
    rail_info = {}
    rail_plan = {}
    if layout == 'textbook':
        pnet = {}
        for net in nets:
            for cid, idx in net_endpoints_of(net):
                pnet.setdefault((cid, idx), net['name'])

        def ppos(cid, idx):
            return pin_canvas_pos(comp_by_id[cid], idx)

        def net_y(name):
            ys = [ppos(c, i)[1] for c, i in net_endpoints.get(name, [])]
            return sum(ys) / len(ys) if ys else 0.0

        # ① 认电源轨 / 地轨：先看网络名和电源地符号，再按结构兜底
        names = [n['name'] for n in nets if len(net_endpoints.get(n['name'], [])) >= 2]
        top, bot = set(), set()
        for name in names:
            base = name.strip().rstrip('!')
            if GROUND_RE.match(base):
                bot.add(name)
            elif SUPPLY_RE.match(base):
                top.add(name)
        for cid, c in comp_by_id.items():
            if c['type'] not in ('ground', 'vdd-port'):
                continue
            for idx in range(len(comp_pins(catalog, c))):
                nn = pnet.get((cid, idx))
                if nn:
                    (bot if c['type'] == 'ground' else top).add(nn)
        if not top or not bot:
            fan = sorted(names, key=lambda n: -len(net_endpoints[n]))[:8]
            if not top:
                top.add(min(fan, key=net_y))
            if not bot:
                rest = [n for n in fan if n not in top]
                if rest:
                    bot.add(max(rest, key=net_y))
        top -= bot

        # ② 分层：从电源轨沿「通路端子」逐层往下走（BFS 取最短层）
        level = {n: 0.0 for n in top}
        for n in bot:
            level[n] = None                   # 地轨最后再定为最底层
        queue = deque(top)
        while queue:
            name = queue.popleft()
            for cid, c in comp_by_id.items():
                tp = _THROUGH.get(c['type'])
                if not tp:
                    continue
                pins = comp_pins(catalog, c)
                thr = through_indices(c['type'], pins)
                if not any(pnet.get((cid, i)) == name for i in thr):
                    continue
                for i in thr:
                    m = pnet.get((cid, i))
                    if not m or m in top or m in bot:
                        continue
                    # 水平元件（两个通路脚同高）不跨层：它连接的两个节点在同一行；
                    # 竖直元件（两脚上下分开）才往下走一层。
                    step = 1.0 if vspan(pins, thr) > 0 else 0.0
                    cand = level[name] + step
                    if level.get(m) is None or level[m] > cand:
                        level[m] = cand
                        queue.append(m)

        # ③ 先把地轨定为最底层，再算控制脚 —— 顺序不能反：地轨网络在 ② 里是刻意
        #    不参与的，如果先算控制脚，像 MN3 这种「漏极接中间节点、源极直接接地」
        #    的器件就只剩一个有效层，栅极会被放到半层错位的位置（实测 VBN 偏低 20）。
        known = [v for v in level.values() if v is not None]
        lmax = max(known) if known else 0.0
        for n in bot:
            level[n] = lmax + 1.0

        # ④ 栅 / 基极这类控制脚的层 = 器件正中的半层（栅极画在符号竖直中央）
        ctl_mid = {}
        for cid, c in comp_by_id.items():
            ctl = _CONTROL.get(c['type'])
            if not ctl:
                continue
            pins = comp_pins(catalog, c)
            thr = through_indices(c['type'], pins)
            lvs = [level[pnet[(cid, i)]] for i in thr
                   if level.get(pnet.get((cid, i))) is not None]
            if not lvs:
                continue
            mid = (min(lvs) + max(lvs)) / 2.0
            for i, (nm, _, _) in enumerate(pins):
                if nm.upper() not in ctl:
                    continue
                m = pnet.get((cid, i))
                if m and m not in top and m not in bot:
                    ctl_mid.setdefault(m, []).append(mid)
        for m, mids in ctl_mid.items():
            if level.get(m) is None:
                level[m] = min(mids)          # 同一个栅网接多只管子时取最上面那只

        # ⑤ 落位：把「上层脚」放到它的电平线上，竖向自然就排成一行行
        deco_pending = []
        for cid, c in comp_by_id.items():
            ptype = c['type']
            pins = comp_pins(catalog, c)
            thr = through_indices(ptype, pins)
            if not thr:                        # 单脚装饰符号：地 / 电源，第二趟再摆
                deco_pending.append(cid)
                continue
            if ptype == 'block':
                # 黑盒矩形：内部是黑盒，把它「摆在它那些网络层线的平均高度」上，
                # 让各引脚的引线总长度最短（不拉伸，矩形高度固定）。
                lines = [level[pnet[(cid, i)]] * _LVL for i in thr
                         if level.get(pnet.get((cid, i))) is not None]
                if lines:
                    c['y'] = round2(sum(lines) / len(lines)
                                    - sum(pins[i][2] for i in thr) / len(thr))
                continue
            lvs = {i: level.get(pnet.get((cid, i))) for i in thr}
            lvs = {i: v for i, v in lvs.items() if v is not None}
            if len(lvs) < 2:
                c['y'] = snap(c['y'])          # 层未知 → 保持原高度
                continue

            def wy(i, _c=c, _pins=pins):
                _, px, py = _pins[i]
                m = -1 if _c['flip'] == 'x' else 1
                a = math.radians(_c['rotation'])
                return px * m * math.sin(a) + py * math.cos(a)

            up_i = min(lvs, key=lambda i: lvs[i])
            dn_i = max(lvs, key=lambda i: lvs[i])
            if wy(up_i) > wy(dn_i):            # 朝向反了 → 上下镜像（漏上源下）
                vflip(c)
            # 器件挂在上下两条层线「之间」：上下各留 (层高-引脚跨度)/2 的一段短线，
            # 这就是教科书里器件之间那段可见的连接线。
            y_up = lvs[up_i] * _LVL
            y_dn = lvs[dn_i] * _LVL
            gap = (y_dn - y_up - (wy(dn_i) - wy(up_i))) / 2.0
            c['y'] = round2(y_up + gap - wy(up_i))
            # 跨多层（比如 vdc 要从电源轨直落地轨）时差出来的距离留给导线

        # 单脚装饰（端口 / 电源 / 地）贴到「它连的那个网络上、器件引脚所在的高度」。
        # 放到层线上会差半个间距（器件是挂在两条层线之间的），那样和器件之间就得拐弯。
        # 电源/地轨上的装饰由 ⑪ 再摆到轨线上，这里只管非轨网络。
        for cid in deco_pending:
            c = comp_by_id[cid]
            nn = pnet.get((cid, 0))
            if nn is None:
                continue
            others = [ppos(oc, oi)[1] for oc, oi in net_endpoints.get(nn, [])
                      if oc != cid]
            if others:
                y = sorted(others)[len(others) // 2]
            elif level.get(nn) is not None:
                y = level[nn] * _LVL
            else:
                continue
            c['y'] = round2(y - comp_pins(catalog, c)[0][2])

        # ⑥ 用原图的「同列意图」定 x。
        #    源图里画成竖直的网络说明那几个引脚在同一列；而我们的符号引脚偏移和
        #    Virtuoso 的并不一样（比如 npn 的 C/E 在源图里偏在原点右边 0.25in），
        #    所以「直接搬实例 x」会整体错开半格。这里只提取对齐关系，重新解一次 x。
        if data.get('wireShapes'):
            # 引脚 ↔ 走线端点的配对只能用「源图实例位置就近」，不能用我们自己的
            # 引脚坐标 —— 我们的符号偏移本来就偏，拿它去配对等于循环论证。
            inst_xy = {c['id']: inst['xy'] for inst in instances
                       for c in [comp_of.get(inst['name'])] if c}
            tol = 8.0 / scale                   # 画布 8 单位换算成源图的英寸
            src_pin = {}
            for w in (data.get('wireShapes') or []):
                pts = w.get('points') or []
                members = net_endpoints.get(w.get('net'), [])
                if len(pts) < 2 or not members:
                    continue
                for pt in (pts[0], pts[-1]):
                    best, bd = None, None
                    for cid, idx in members:
                        q = inst_xy.get(cid)
                        if q is None:
                            continue
                        d = (q[0] - pt[0]) ** 2 + (q[1] - pt[1]) ** 2
                        if bd is None or d < bd:
                            best, bd = (cid, idx), d
                    if best is not None:
                        src_pin[best] = pt
            adj = {}
            col_hint = {}                      # 元件 id → 它所在「列」应处的 x

            def link(a, b, d):                 # x_a - x_b == d
                adj.setdefault(a, []).append((b, d))
                adj.setdefault(b, []).append((a, -d))

            for net in nets:
                got = [(cid, idx, src_pin[(cid, idx)])
                       for cid, idx in net_endpoints.get(net['name'], [])
                       if (cid, idx) in src_pin]
                if len(got) < 2:
                    continue
                xs = [g[2][0] for g in got]
                ys = [g[2][1] for g in got]
                if max(xs) - min(xs) <= tol and max(ys) - min(ys) > tol:
                    base = got[0]                       # 源图里画成竖直的一列
                    off_b = ppos(base[0], base[1])[0] - comp_by_id[base[0]]['x']
                    # 列位置直接取「源图那条竖直走线的 x」（换算到画布坐标，要用
                    # place() 走一遍，否则会漏掉 -minX+MARGIN 的全局平移）。
                    # 不能平均各成员的实例 x —— Virtuoso 符号的引脚偏移和我们的
                    # 不一样，平均会把这个偏差带进来（实测右侧列被偏 20 单位，
                    # 整张图的镜像对称就没了）。
                    col_hint[base[0]] = place(base[2][0], 0.0)[0] - off_b
                    for cid, idx, _pt in got[1:]:
                        off_c = ppos(cid, idx)[0] - comp_by_id[cid]['x']
                        link(cid, base[0], off_b - off_c)
            seen = {}
            for cid in list(comp_by_id):
                if cid in seen:
                    continue
                seen[cid] = 0.0
                queue, group = deque([cid]), []
                while queue:
                    u = queue.popleft()
                    group.append(u)
                    for v, d in adj.get(u, []):
                        if v not in seen:
                            seen[v] = seen[u] + d
                            queue.append(v)
                if len(group) < 2:
                    continue
                anchor = next((g for g in group if g in col_hint), None)
                if anchor is not None:
                    base = col_hint[anchor] - seen[anchor]
                else:
                    base = sum(comp_by_id[g]['x'] - seen[g] for g in group) / len(group)
                for g in group:
                    comp_by_id[g]['x'] = round2(base + seen[g])

        # ⑦ 列对齐松弛：同一网络的引脚只要差得不多，就把器件搬正 → 竖线变直
        #    只动 x，绝不动 y（一动 y 就破坏刚排好的电平层）。
        for _pass in range(3):
            moved = 0
            for net in nets:
                eps = net_endpoints.get(net['name'], [])
                if len(eps) != 2:
                    continue
                (c1, i1), (c2, i2) = eps
                a, b = ppos(c1, i1), ppos(c2, i2)
                dx, dy = b[0] - a[0], b[1] - a[1]
                if 0 < abs(dx) <= 2 * GRID and abs(dy) > 2 * GRID:
                    tgt = c2 if len(pins_of.get(c2, [])) <= len(pins_of.get(c1, [])) else c1
                    comp_by_id[tgt]['x'] = round2(comp_by_id[tgt]['x'] - dx)
                    moved += 1
            if not moved:
                break

        # ⑧ 镜像对称：同型号同参数的器件对强制关于共同轴严格镜像（误差 = 0）
        #    「匹配对」的判据要严：只共用一个电源/地网络不算 —— 那样会把电路里
        #    任意两个同型号源器件拉到同一行，反而制造遮挡。
        groups = {}
        for c in comp_by_id.values():
            if c['type'] in ('junction', 'ground', 'vdd-port', 'port'):
                continue
            groups.setdefault((c['type'], c['value']), []).append(c)

        def netsof(cid):
            n = len(comp_pins(catalog, comp_by_id[cid]))
            return {pnet[(cid, i)] for i in range(n) if (cid, i) in pnet}

        sym_pairs = 0
        sym_axes = []
        for items in groups.values():
            if len(items) < 2 or len(items) > 8:
                continue
            used = set()
            for i, a in enumerate(items):
                if a['id'] in used:
                    continue
                for b in items[i + 1:]:
                    if b['id'] in used:
                        continue
                    shared = netsof(a['id']) & netsof(b['id'])
                    if not (shared - top - bot):     # 只有电源/地共享 → 不是匹配对
                        continue
                    if abs(a['y'] - b['y']) > 1.5 * _LVL:
                        continue                      # 层差太大 → 不是同一组匹配对
                    left, right = (a, b) if a['x'] <= b['x'] else (b, a)
                    if abs(right['x'] - left['x']) < 1:
                        continue
                    axis = (left['x'] + right['x']) / 2.0
                    half = abs(right['x'] - left['x']) / 2.0
                    left['x'] = round2(axis - half)
                    right['x'] = round2(axis + half)
                    if (left['rotation'], left['flip']) != (right['rotation'], right['flip']):
                        hmirror(right, left)      # 设计师本来就是镜像画的 → 精确镜像
                    if abs(left['y'] - right['y']) > 1:
                        avg = round2((left['y'] + right['y']) / 2.0)
                        left['y'] = right['y'] = avg
                    used.add(a['id'])
                    used.add(b['id'])
                    sym_pairs += 1
                    sym_axes.append(axis)
                    break

        # ⑨ 电源/地轨（第一趟）：把这一轨上的电源/地符号吸到轨线上。
        #    必须在「水平分离」之前做：否则它们浮在轨线上方会被当成遮挡推开，
        #    整体对称就破了（实测中心地符号被推偏 30）。
        #    竖直引线/连接点留到第二趟（⑫）再建 —— 连接点的 x 必须等横向紧凑
        #    结束之后才定，否则紧凑把器件移走了、连接点还留在原地，引线全是歪的。
        rail_info.update({'top': sorted(top), 'bot': sorted(bot),
                          'merged': merged_syms, 'sym': sym_pairs,
                          'levels': int(lmax) + 2})
        rail_axis = {}
        for rname in sorted(top | bot):
            eps = net_endpoints.get(rname, [])
            if len(eps) < 2:
                continue
            pre = [ppos(c, i) for c, i in eps]
            horiz = ((max(p[0] for p in pre) - min(p[0] for p in pre))
                     >= (max(p[1] for p in pre) - min(p[1] for p in pre)))
            axis_t = (level[rname] * _LVL if horiz
                      else round2(sum(p[0] for p in pre) / len(pre)))
            rail_axis[rname] = (horiz, axis_t)
            for cid, idx in eps:
                c = comp_by_id[cid]
                if c['type'] not in ('ground', 'vdd-port'):
                    continue
                p = ppos(cid, idx)
                if horiz:
                    c['y'] = round2(c['y'] + (axis_t - p[1]))
                elif abs(p[0] - axis_t) > 2:
                    c['x'] = round2(c['x'] + (axis_t - p[0]))

        # ⑩ 水平分离：对称做完、行高定下来之后，再把「竖向真有交叠」的器件左右拉开。
        #    这里和 --report 用同一套判据（完整视图框 + 10 单位容差），否则会出现
        #    「体检说遮挡、排版却认为没事」的不一致。10 单位容差是必要的：相邻电平层
        #    的符号图元（引脚 ±20、图元 ±24）本来就会叠 8 单位，那不是遮挡。
        def layout_box(c):
            return comp_box(catalog, c)

        movable = [c for c in comp_by_id.values() if c['type'] != 'junction']
        for _round in range(32):
            boxes = {c['id']: layout_box(c) for c in movable}
            worst = None
            for i in range(len(movable)):
                for j in range(i + 1, len(movable)):
                    ca, cb = movable[i], movable[j]
                    ax0, ay0, aw, ah = boxes[ca['id']]
                    bx0, by0, bw, bh = boxes[cb['id']]
                    ox = min(ax0 + aw, bx0 + bw) - max(ax0, bx0)
                    oy = min(ay0 + ah, by0 + bh) - max(ay0, by0)
                    if oy > _OVL_TOL and ox > -_MIN_X:
                        need = ox + _MIN_X       # 要拉开的量
                        if worst is None or need > worst[2]:
                            worst = (ca, cb, need)
            if worst is None:
                break
            ca, cb, need = worst
            d = math.ceil((need / 2 + 2) / GRID) * GRID
            left, right = (ca, cb) if ca['x'] <= cb['x'] else (cb, ca)
            left['x'] = round2(left['x'] - d)
            right['x'] = round2(right['x'] + d)

        # ⑪ 横向紧凑：源图的横向间距常常比纵向大一个数量级（折叠共源共栅会被
        #    画成 4:1 的长条，缩到「适配窗口」后整张图看不清）。做两件事：
        #      a) 电路本体按同一比例向自己的中心压缩 —— 等比缩放不会破坏「同列」
        #         （原本严格相等的 x 依然相等），直线与镜像对称都保持；
        #      b) 两侧的端口/电源/地装饰贴回电路旁边（只动 x，所以那些水平走线
        #         依旧是直线）。源图里它们常常被摆在离电路很远的空白处。
        devs = [c for c in comp_by_id.values() if c['type'] != 'junction']
        deco = [c for c in devs if c['type'] in ('port', 'ground', 'vdd-port')]
        plain = [c for c in devs if c['type'] not in ('port', 'ground', 'vdd-port')]
        if len(plain) > 2:
            xs = [c['x'] for c in plain]
            lo, hi = min(xs), max(xs)
            # 压缩中心必须用「真正的镜像轴」，不能用包围盒中心 —— 否则关于对称轴
            # 成对/居中的器件会被推偏（实测 diffamp 的中心电流源被挤偏 30 单位）。
            if sym_axes:
                mid_x = sorted(sym_axes)[len(sym_axes) // 2]
            else:
                mid_x = (lo + hi) / 2.0
            span = hi - lo
            orig_x = {c['id']: c['x'] for c in plain}

            def apply_k(k):
                for c in plain:
                    c['x'] = round2(mid_x + (orig_x[c['id']] - mid_x) * k)

            def cramped():
                boxes = {c['id']: layout_box(c) for c in devs}
                for i in range(len(devs)):
                    for j in range(i + 1, len(devs)):
                        ax0, ay0, aw, ah = boxes[devs[i]['id']]
                        bx0, by0, bw, bh = boxes[devs[j]['id']]
                        ox = min(ax0 + aw, bx0 + bw) - max(ax0, bx0)
                        oy = min(ay0 + ah, by0 + bh) - max(ay0, by0)
                        if oy > _OVL_TOL and ox > -_MIN_X:
                            return True
                return False

            tall = (lmax + 1) * _LVL + 120.0
            k = 1.0 if span <= 1 else min(1.0, max(tall * 1.6, 460.0) / span)
            for _ in range(26):
                apply_k(k)
                if not cramped():
                    break
                k = min(1.0, (k + 1.0) / 2.0)
            apply_k(k)
            rail_info['compact'] = round(k, 2)

            lo2 = min(c['x'] for c in plain)
            hi2 = max(c['x'] for c in plain)
            for sign in (-1, 1):
                side = [c for c in deco
                        if (c['x'] < lo2 if sign < 0 else c['x'] > hi2)]
                if not side:
                    continue
                sx = sorted(c['x'] for c in side)
                if sign < 0:
                    start = lo2 - _DECO_GAP - (sx[-1] - sx[0])
                else:
                    start = hi2 + _DECO_GAP
                for c in side:
                    c['x'] = round2(start + (c['x'] - sx[0]))
            # 贴位之后再做一轮通用分离兜底（紧凑过程中可能把器件推到端口上）
            for _round in range(16):
                boxes = {c['id']: layout_box(c) for c in devs}
                worst = None
                for i in range(len(devs)):
                    for j in range(i + 1, len(devs)):
                        ca, cb = devs[i], devs[j]
                        ax0, ay0, aw, ah = boxes[ca['id']]
                        bx0, by0, bw, bh = boxes[cb['id']]
                        ox = min(ax0 + aw, bx0 + bw) - max(ax0, bx0)
                        oy = min(ay0 + ah, by0 + bh) - max(ay0, by0)
                        if oy > _OVL_TOL and ox > -_MIN_X:
                            need = ox + _MIN_X
                            if worst is None or need > worst[2]:
                                worst = (ca, cb, need)
                if worst is None:
                    break
                ca, cb, need = worst
                d = math.ceil((need / 2 + 2) / GRID) * GRID
                lft, rgt = (ca, cb) if ca['x'] <= cb['x'] else (cb, ca)
                lft['x'] = round2(lft['x'] - d)
                rgt['x'] = round2(rgt['x'] + d)
                # 贴太近就整簇再往外推（它们都是单脚装饰，移动不影响拓扑，
                # 与电路之间是水平走线，所以线还是直的）
                for _ in range(12):
                    push = 0.0
                    for a in side:
                        ax0, ay0, aw, ah = layout_box(a)
                        for b in plain:
                            bx0, by0, bw, bh = layout_box(b)
                            ox = min(ax0 + aw, bx0 + bw) - max(ax0, bx0)
                            oy = min(ay0 + ah, by0 + bh) - max(ay0, by0)
                            if oy > _OVL_TOL and ox > -_MIN_X:
                                push = max(push, ox + _MIN_X)
                    if push <= 0:
                        break
                    d = math.ceil((push + 4) / GRID) * GRID
                    for c in side:
                        c['x'] = round2(c['x'] + (d if sign > 0 else -d))

        # ⑫ 电源/地轨（第二趟）：x 都定下来了，再建竖直引线与轨道连线。
        #    连接点的 x 必须取自「最终」的引脚 x，否则引线会拐弯（实测紧凑把
        #    器件移走而连接点留在原地，MN3 的源/衬底引线全歪了）。
        for rname in sorted(top | bot):
            eps = net_endpoints.get(rname, [])
            if len(eps) < 2 or rname not in rail_axis:
                continue
            horiz, axis_t = rail_axis[rname]
            pos = [ppos(c, i) for c, i in eps]
            nodes, stubs = [], []
            for k, (cid, idx) in enumerate(eps):
                px, py = pos[k]
                off = abs(py - axis_t) if horiz else abs(px - axis_t)
                if off <= 2:
                    nodes.append(((cid, idx), px if horiz else py))
                    continue
                jx = round2(px) if horiz else axis_t
                jy = axis_t if horiz else round2(py)
                jid = new_cid()
                components.append({'id': jid, 'type': 'junction', 'name': '',
                                   'value': '', 'x': jx, 'y': jy,
                                   'rotation': 0, 'flip': ''})
                comp_by_id[jid] = components[-1]
                stubs.append(((cid, idx), (jid, 0)))
                nodes.append(((jid, 0), px if horiz else py))
            nodes.sort(key=lambda it: it[1])
            rail_plan[rname] = {'stubs': stubs, 'chain': [it[0] for it in nodes]}
        rail_info['stubs'] = sum(len(v['stubs']) for v in rail_plan.values())

        # ⑬ 衬底的引线要是会横穿别的器件，也退回三端符号（bulk 按默认处理）。
        #    四端符号的 B 脚长在器件右侧中部，在一行行排好的版图里斜穿过去很难看。
        #    换符号不影响位置：分层只看 D-S 通路脚，B 不参与。
        if not keep_bulk:
            for _pass in range(3):
                boxes = {c['id']: comp_box(catalog, c)
                         for c in comp_by_id.values() if c['type'] != 'junction'}
                dropped_now = 0
                for c in list(comp_by_id.values()):
                    if c['type'] not in ('nmos-bulk', 'pmos-bulk'):
                        continue
                    pins = comp_pins(catalog, c)
                    bidx = next((i for i, (nm, _, _) in enumerate(pins)
                                 if nm.upper() == 'B'), None)
                    nb = pnet.get((c['id'], bidx)) if bidx is not None else None
                    mates = [ep for ep in net_endpoints.get(nb, []) if ep[0] != c['id']]
                    if bidx is None or not nb or not mates:
                        continue
                    bpos = pin_canvas_pos(c, bidx)
                    mcid, midx = min(
                        mates, key=lambda ep: abs(ppos(*ep)[0] - bpos[0])
                        + abs(ppos(*ep)[1] - bpos[1]))
                    mpos = ppos(mcid, midx)
                    path = wire_points(bpos, mpos, wire_mode(
                        bpos, pin_face(c, bidx), mpos, pin_face(comp_by_id[mcid], midx)))
                    if any(crosses_box(path, boxes[bid]) for bid in boxes
                           if bid not in (c['id'], mcid)):
                        c['type'] = {'nmos-bulk': 'nmos',
                                     'pmos-bulk': 'pmos'}[c['type']]
                        net_endpoints[nb] = [ep for ep in net_endpoints[nb]
                                             if ep[0] != c['id']]
                        pnet.pop((c['id'], bidx), None)
                        dropped_now += 1
                        bulk_dropped += 1
                if not dropped_now:
                    break
        rail_info['bulk3'] = bulk_dropped

    # ── 真实走线几何 ──────────────────────────────────────────────────────
    # 原理图里的导线是设计师一段段画的（对称、笔直都是人排出来的）。与其用引脚
    # 位置重新猜走线，不如把这些折线原样搬过来 —— 画出来就和自己画的原理图一致。
    # 只有「线段端点」会被吸附到我们符号的引脚上（我们的符号尺寸与 Virtuoso 的
    # 不完全相同），中间拐点一律不动，所以走线形状保持原样。
    SNAP_TOL = 56                       # 端点吸附到引脚的容差（画布单位 ≈ 0.35in）
    residual, covered = [], set()
    shape_segments = []
    real_wires = real_wires and layout != 'textbook'
    if real_wires:
        for w in (data.get('wireShapes') or []):
            pts = [place(*pt) for pt in (w.get('points') or [])]
            if len(pts) < 2:
                continue
            net_name = w.get('net')
            covered.add(net_name)
            same_net_pins = [pin_canvas_pos(comp_by_id[cid], idx)
                             for cid, idx in net_endpoints.get(net_name, [])]
            for k in (0, -1):           # 首尾端点吸到本网络的引脚上
                if not same_net_pins:
                    break
                px, py = pts[k]
                best = min(same_net_pins,
                           key=lambda q: (q[0] - px) ** 2 + (q[1] - py) ** 2)
                if (best[0] - px) ** 2 + (best[1] - py) ** 2 <= SNAP_TOL ** 2:
                    pts[k] = best
            # 端点吸附后常常只剩几像素的偏差，这种直接拉成水平/垂直
            for k in range(len(pts) - 1):
                ax, ay = pts[k]
                bx, by = pts[k + 1]
                if 0 < abs(ay - by) <= 8 and abs(ax - bx) > 8:
                    pts[k + 1] = (bx, ay)
                elif 0 < abs(ax - bx) <= 8 and abs(ay - by) > 8:
                    pts[k + 1] = (ax, by)
            shape_segments.append(pts)      # path 字符串等整体平移后再生成

    # 三线交汇、或有线段端点落在另一条线段中间 → 补一个连接点，看起来才像原理图
    if real_wires and shape_segments:
        def key_of(pt):
            return (round(pt[0]), round(pt[1]))

        def on_seg(pt, a, b, tol=1.5):
            if abs(a[0] - b[0]) < tol:
                return (abs(pt[0] - a[0]) < tol
                        and min(a[1], b[1]) - tol <= pt[1] <= max(a[1], b[1]) + tol)
            if abs(a[1] - b[1]) < tol:
                return (abs(pt[1] - a[1]) < tol
                        and min(a[0], b[0]) - tol <= pt[0] <= max(a[0], b[0]) + tol)
            return False

        counts = {}
        for pts in shape_segments:
            for pt in (pts[0], pts[-1]):
                counts[key_of(pt)] = counts.get(key_of(pt), 0) + 1
        jkeys = {k for k, n in counts.items() if n >= 3}
        for pts in shape_segments:
            for pt in (pts[0], pts[-1]):
                if key_of(pt) in jkeys:
                    continue
                hit = False
                for seg in shape_segments:
                    if seg is pts:
                        continue
                    for k in range(len(seg) - 1):
                        if on_seg(pt, seg[k], seg[k + 1]):
                            jkeys.add(key_of(pt))
                            hit = True
                            break
                    if hit:
                        break
        for jx, jy in sorted(jkeys):
            components.append({'id': new_cid(), 'type': 'junction',
                               'name': '', 'value': '', 'x': jx, 'y': jy,
                               'rotation': 0, 'flip': ''})
        comp_by_id = {c['id']: c for c in components}

    for net in nets:
        endpoints = net_endpoints[net['name']]
        hide = net['name'] in covered
        cur_net = net['name']

        if len(endpoints) < 2:
            if len(endpoints) == 1:
                dangling.append(net['name'])
            continue
        pos = [pin_canvas_pos(comp_by_id[cid], idx) for cid, idx in endpoints]
        pairs = []

        if net['name'] in rail_plan:
            # 电源/地轨：每个成员一根竖直短线接到轨道，轨道本身连成一条直线。
            # 这是教科书里最上面的 VDD 横线与最下面的 GND 横线。
            plan = rail_plan[net['name']]
            for pin, junc in plan['stubs']:
                add_wire(pin, junc, hide)
                pairs.append([pin, junc])
            chain = plan['chain']
            for k in range(len(chain) - 1):
                add_wire(chain[k], chain[k + 1], hide)
                pairs.append([chain[k], chain[k + 1]])
        elif len(endpoints) == 2:
            add_wire(endpoints[0], endpoints[1], hide)
            pairs = [endpoints]
        elif (max(p[1] for p in pos) - min(p[1] for p in pos) <= 2
              or max(p[0] for p in pos) - min(p[0] for p in pos) <= 2):
            # 共线的多点网络（偏置母线等）：按顺序串成一条直线，比从中间
            # 一点向两边发散好 —— 发散会在轴上叠出重复的线段。
            flat_h = max(p[1] for p in pos) - min(p[1] for p in pos) <= 2
            key = (lambda i: pos[i][0]) if flat_h else (lambda i: pos[i][1])
            order = sorted(range(len(endpoints)), key=key)
            for k in range(len(order) - 1):
                a, b = endpoints[order[k]], endpoints[order[k + 1]]
                add_wire(a, b, hide)
                pairs.append([a, b])
        else:
            hub = min(range(len(endpoints)),
                      key=lambda i: sum(abs(pos[i][0] - p[0]) + abs(pos[i][1] - p[1])
                                        for p in pos))
            for i, ep in enumerate(endpoints):
                if i != hub:
                    add_wire(ep, endpoints[hub], hide)
                    pairs.append([ep, endpoints[hub]])
        if not pairs:                      # 长度 1 的网络不该走到这里，保险
            pairs = [[endpoints[0], endpoints[0]]]
        # 网络名标注贴在最长那条导线的中点旁；原理图里已有同名 label 就不重复
        name = net['name']
        if net_labels and name not in label_texts and not AUTO_NET.match(name) \
                and not name.endswith('!') and not name.isdigit():
            def dist(pr):
                pa = pin_canvas_pos(comp_by_id[pr[0][0]], pr[0][1])
                pb = pin_canvas_pos(comp_by_id[pr[1][0]], pr[1][1])
                return abs(pa[0] - pb[0]) + abs(pa[1] - pb[1])
            a, b = max(pairs, key=dist)
            pa = pin_canvas_pos(comp_by_id[a[0]], a[1])
            pb = pin_canvas_pos(comp_by_id[b[0]], b[1])
            mx, my = (pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2
            if abs(pa[0] - pb[0]) >= abs(pa[1] - pb[1]):
                texts.append({'id': f't{len(texts) + 1}', 'x': mx, 'y': my - 8,
                              'text': name[:60], 'size': 12,
                              'color': '#4f81a8', 'anchor': 'middle'})
            else:
                texts.append({'id': f't{len(texts) + 1}', 'x': mx + 10, 'y': my + 4,
                              'text': name[:60], 'size': 12,
                              'color': '#4f81a8', 'anchor': 'start'})

    # ── 连接点：三条以上导线交汇、或有端点落在另一条导线中间 ──────────────
    # 原理图里只有真正「T 形三通」才画实心点；两条线对接（拐角）不画。
    if layout == 'textbook' and wires:
        def pt_on_seg(pt, a, b, tol=1.5):
            if abs(a[0] - b[0]) < tol:
                return (abs(pt[0] - a[0]) < tol
                        and min(a[1], b[1]) + tol < pt[1] < max(a[1], b[1]) - tol)
            if abs(a[1] - b[1]) < tol:
                return (abs(pt[1] - a[1]) < tol
                        and min(a[0], b[0]) + tol < pt[0] < max(a[0], b[0]) - tol)
            return False

        segs = []
        for w in wires:
            if w.get('hidden'):
                continue
            ca = comp_by_id.get(w['from']['component'])
            cb = comp_by_id.get(w['to']['component'])
            if not ca or not cb:
                continue
            segs.append((w.get('net'), wire_points(
                pin_canvas_pos(ca, w['from']['pin']),
                pin_canvas_pos(cb, w['to']['pin']), w.get('mode'))))
        dots, cnt = set(), {}
        for net, pts in segs:
            for pt in (pts[0], pts[-1]):
                k = (round(pt[0]), round(pt[1]))
                cnt[k] = cnt.get(k, 0) + 1
        for k, v in cnt.items():
            if v >= 3:
                dots.add(k)
        for i, (ni, pi) in enumerate(segs):
            for j, (nj, pj) in enumerate(segs):
                if i == j or ni != nj:
                    continue
                for pt in (pi[0], pi[-1]):
                    for k in range(len(pj) - 1):
                        if pt_on_seg(pt, pj[k], pj[k + 1]):
                            dots.add((round(pt[0]), round(pt[1])))
        for jx, jy in sorted(dots):
            components.append({'id': new_cid(), 'type': 'junction',
                               'name': '', 'value': '', 'x': jx, 'y': jy,
                               'rotation': 0, 'flip': ''})
        comp_by_id = {c['id']: c for c in components}

    # ── 原理图上真实存在的文字标注 ────────────────────────────────────────
    # 教科书里节点名统一小一号字号，紧贴导线但不压线；能找到同名网络的，就重新
    # 贴到那条网络导线的中点（重排后原坐标已无意义，留着会飘在半空）。
    label_anchor = {}
    if layout == 'textbook':
        for net in nets:
            eps = net_endpoints.get(net['name'], [])
            if len(eps) < 2:
                continue
            pts = [pin_canvas_pos(comp_by_id[c], i) for c, i in eps]
            pts.sort(key=lambda p: (p[0], p[1]))
            label_anchor[net['name']] = (pts[0], pts[-1])
    for l in labels:
        txt = str(l.get('text', '')).strip()
        if not txt:
            continue
        if layout == 'textbook':
            anchor = label_anchor.get(txt)
            if anchor:
                (ax, ay), (bx, by) = anchor
                mx, my = (ax + bx) / 2, (ay + by) / 2
                if abs(ax - bx) >= abs(ay - by):
                    texts.append({'id': f't{len(texts) + 1}', 'x': round2(mx),
                                  'y': round2(my - 9), 'text': txt[:200],
                                  'size': 13, 'color': '#4f81a8',
                                  'anchor': 'middle'})
                else:
                    texts.append({'id': f't{len(texts) + 1}', 'x': round2(mx + 11),
                                  'y': round2(my + 4), 'text': txt[:200],
                                  'size': 13, 'color': '#4f81a8',
                                  'anchor': 'start'})
                continue
        x, y = place(*l['xy'])
        size = max(9.0, min(48.0,
                            float(l.get('height') or 0.0625) * scale * 2.0 * label_scale))
        if layout == 'textbook':
            size = min(size, 13.0)          # 重排后原坐标已不准，统一小号字体
        texts.append({'id': f't{len(texts) + 1}', 'x': x, 'y': y, 'text': txt[:200],
                      'size': round(size, 1), 'color': '#263934', 'anchor': 'middle'})

    # ── 器件标注就位：位号/参数不许压在导线上 ──────────────────────────────
    # app.js 默认把标注画在符号正下方，重排后那一片常常正好有横向导线穿过。
    # 这里按实际走线在 下 / 右 / 左 / 上 四个方向里挑一个不压线的（教科书里
    # 位号总是贴着器件、让开走线）。
    if layout == 'textbook' and wires:
        segs = []
        for w in wires:
            if w.get('hidden'):
                continue
            ca = comp_by_id.get(w['from']['component'])
            cb = comp_by_id.get(w['to']['component'])
            if not ca or not cb:
                continue
            segs.append(wire_points(pin_canvas_pos(ca, w['from']['pin']),
                                    pin_canvas_pos(cb, w['to']['pin']),
                                    w.get('mode')))
        all_boxes = [(c['id'], comp_box(catalog, c)) for c in components]

        def zone_hits(cid, x0, y0, x1, y1):
            hits = 0
            for pts in segs:
                for k in range(len(pts) - 1):
                    ax, ay = pts[k]
                    bx, by = pts[k + 1]
                    if max(ax, bx) < x0 or min(ax, bx) > x1:
                        continue
                    if max(ay, by) < y0 or min(ay, by) > y1:
                        continue
                    hits += 1
            for oid, (ox, oy, ow, oh) in all_boxes:
                if oid == cid:
                    continue
                if ox < x1 and ox + ow > x0 and oy < y1 and oy + oh > y0:
                    hits += 2
            return hits

        for c in components:
            if c['type'] in ('junction', 'ground', 'vdd-port', 'port'):
                continue
            try:
                bx, by, sw, sh = symbol_box(catalog, c['type'])
            except KeyError:
                continue
            hh = sh / 2.0
            tw = 8.5 * max(len(c.get('name') or ''), len(c.get('value') or '')) + 10
            l_edge, r_edge = c['x'] + bx, c['x'] + bx + sw
            cands = (
                ('below', (c['x'] - tw / 2, c['y'] + hh + 4, c['x'] + tw / 2, c['y'] + hh + 42), 0.0),
                ('right', (r_edge + 6, c['y'] - 14, r_edge + 6 + tw, c['y'] + 18), 0.3),
                ('left', (l_edge - 6 - tw, c['y'] - 14, l_edge - 6, c['y'] + 18), 0.3),
                ('above', (c['x'] - tw / 2, c['y'] - hh - 42, c['x'] + tw / 2, c['y'] - hh - 4), 0.6),
            )
            scored = [(zone_hits(c['id'], *box) + penalty, name)
                      for name, box, penalty in cands]
            scored.sort()
            if scored[0][1] != 'below':
                c['labelPos'] = scored[0][1]

    # ── 画布范围：按最终实际内容取（去重叠可能把器件推出去），再整体平移进边距 ──
    xs, ys = [], []
    for c in components:
        x0, y0, w0, h0 = comp_box(catalog, c)
        xs += [x0, x0 + w0]
        ys += [y0, y0 + h0]
    for pts in shape_segments:
        for px, py in pts:
            xs.append(px)
            ys.append(py)
    for t in texts:
        half = len(str(t['text'])) * (t['size'] or 14) * 0.55
        xs += [t['x'] - half, t['x'] + half]
        ys += [t['y'] - (t['size'] or 14), t['y'] + 6]
    dx = MARGIN - min(xs)
    dy = MARGIN - min(ys)
    for c in components:
        c['x'] = round2(c['x'] + dx)
        c['y'] = round2(c['y'] + dy)
    for t in texts:
        t['x'] = round2(t['x'] + dx)
        t['y'] = round2(t['y'] + dy)
    width = snap(max(xs) - min(xs)) + 2 * MARGIN
    height = snap(max(ys) - min(ys)) + 2 * MARGIN + 50

    # 原图走线：平移到位后再生成 path，保证和器件一起动
    for pts in shape_segments:
        residual.append({'d': 'M ' + ' L '.join(
            f'{round2(px + dx)} {round2(py + dy)}' for px, py in pts),
            'f': None, 's': '#3b7565', 'w': 2.2, 'da': None, 'ae': None, 'ab': None})

    texts.insert(0, {'id': 'tt0', 'x': width / 2, 'y': 46, 'text': title,
                     'size': 24, 'color': '#263934', 'anchor': 'middle'})

    draft = {'name': title[:60], 'components': components, 'wires': wires,
             'texts': texts, 'shapes': []}
    # 构建指纹：内容一变就变。浏览器里的 localStorage 草稿会拿它做比对，
    # 避免“重新导出后刷新页面，看到的还是上一次的电路”。
    build = hashlib.sha1(json.dumps(draft, sort_keys=True, ensure_ascii=False)
                         .encode('utf-8')).hexdigest()[:12]
    payload = {
        'meta': {'name': title, 'source': f"{src.get('lib', '')}/{src.get('cell', '')}",
                 'page': src.get('view', 'schematic'), 'width': width, 'height': height,
                 'scale': scale, 'build': build},
        # residual = 原图走线（像素级忠实），由画布的“原图走线”层绘制
        'draft': draft, 'residual': residual, 'snap': [],
    }
    if residual:
        payload['residualLabel'] = '原图走线'
    stats = {'components': len(components), 'wires': len(wires),
             'hidden': sum(1 for w in wires if w.get('hidden')),
             'residual': len(residual),
             'junctions': sum(1 for c in components if c['type'] == 'junction'),
             'skipped': skipped, 'dangling': dangling, 'unrouted': unrouted,
             'blocks': blocks_made,
             'tally': tally, 'layout': layout, 'rail': rail_info,
             # 供 --report 用
             '_components': components, '_catalog': catalog, '_wires': wires,
             '_comp_by_id': comp_by_id}
    return payload, stats


# ---------------------------------------------------------------- 输出

def symbol_box(catalog, ptype):
    """画布符号的视图框 [x, y, w, h]（与 app.js objectBox 的口径一致）。"""
    src = _PART_SOURCE.get(ptype)
    if src is None:
        if ptype in catalog:
            src = ptype
        elif ptype in _BUILTIN_PINS:
            return (-4, -4, 8, 8)
        else:
            raise KeyError(ptype)
    sym_id = src[0] if isinstance(src, tuple) else src
    return tuple(catalog[sym_id]['vb'])


def comp_box(catalog, comp):
    """器件在画布坐标里的外接矩形 (x, y, w, h)。"""
    if comp.get('w') and comp.get('h'):
        bx, by, bw, bh = -comp['w'] / 2, -comp['h'] / 2, comp['w'], comp['h']
    else:
        bx, by, bw, bh = symbol_box(catalog, comp['type'])
    a = math.radians(comp['rotation'])
    cos, sin = math.cos(a), math.sin(a)
    mirror = -1 if comp['flip'] == 'x' else 1
    xs, ys = [], []
    for px, py in ((bx, by), (bx + bw, by), (bx, by + bh), (bx + bw, by + bh)):
        xs.append(comp['x'] + px * mirror * cos - py * sin)
        ys.append(comp['y'] + px * mirror * sin + py * cos)
    return min(xs), min(ys), max(xs) - min(xs), max(ys) - min(ys)


def report_layout(stats):
    """布局体检：器件遮挡 / 导线折弯 / 镜像对称 / 真实走线覆盖率。"""
    catalog = stats['_catalog']
    comps = [c for c in stats['_components'] if c['type'] != 'junction']
    wires = stats['_wires']
    print('  ── 布局体检 ──')

    # 器件遮挡（真遮挡才算：图元天然会叠 8 单位的装饰边不算）
    boxes = [(c, comp_box(catalog, c)) for c in comps]
    overlaps = []
    for i in range(len(boxes)):
        for j in range(i + 1, len(boxes)):
            (ca, a), (cb, b) = boxes[i], boxes[j]
            ox = min(a[0] + a[2], b[0] + b[2]) - max(a[0], b[0])
            oy = min(a[1] + a[3], b[1] + b[3]) - max(a[1], b[1])
            if ox > 1 and oy > _OVL_TOL:
                overlaps.append((ca['name'], cb['name'], round(min(ox, oy), 1)))
    if overlaps:
        print(f"  ⚠ 器件互相遮挡 {len(overlaps)} 处：" +
              '、'.join(f'{a}/{b}({d})' for a, b, d in overlaps[:8]))
    else:
        print('  ✓ 器件无互相遮挡')

    # 导线折弯（只看可见的）
    vis = [w for w in wires if not w.get('hidden')]
    t = stats.get('tally') or {}
    if vis:
        n_straight = t.get('直线', 0)
        n_one = t.get('单拐', 0)
        n_two = t.get('双拐', 0)
        total = n_straight + n_one + n_two or 1
        print(f"  可见导线 {len(vis)} 条：直线 {n_straight}（{n_straight * 100 // total}%）"
              f" · 单拐 {n_one} · 双拐 {n_two}"
              f" · 平均折角 {(n_one + 2 * n_two) / total:.2f} 个/条")
    else:
        print(f"  可见导线 0 条（画面用原图走线，隐藏自动走线 {stats['hidden']} 条）")

    # 教科书重排的结果
    rail = stats.get('rail') or {}
    if rail:
        print(f"  电平层 {rail.get('levels', '?')} 层"
              f" · 电源轨 {'、'.join(rail.get('top') or ['—'])}"
              f" · 地轨 {'、'.join(rail.get('bot') or ['—'])}")
        print(f"  电源/地轨竖直引线 {rail.get('stubs', 0)} 根"
              f" · 合并重复电源/地符号 {rail.get('merged', 0)} 个"
              f" · 强制精确镜像 {rail.get('sym', 0)} 对"
              f" · 横向压缩系数 {rail.get('compact', 1.0)}")
        if rail.get('bulk3'):
            print(f"  衬底接源/漏或引线会横穿器件 → {rail['bulk3']} 只 MOS 改用三端符号"
                  f"（bulk 按默认处理）")

    # 镜像对称：同名同参器件对，到重心的距离是否互为相反数
    axis = sum(c['x'] for c in comps) / len(comps) if comps else 0
    groups = {}
    for c in comps:
        groups.setdefault((c['type'], c['value']), []).append(c)
    sym_pairs, asym = 0, 0
    for items in groups.values():
        if len(items) < 2:
            continue
        used = set()
        for i, a in enumerate(items):
            if a['id'] in used:
                continue
            for b in items[i + 1:]:
                if b['id'] in used:
                    continue
                if abs((a['x'] - axis) + (b['x'] - axis)) <= GRID / 2 and \
                        abs(a['y'] - b['y']) <= GRID / 2:
                    used.add(a['id']); used.add(b['id'])
                    sym_pairs += 1
                    break
    print(f"  镜像对称器件对 {sym_pairs} 对")

    # 真实走线覆盖
    if stats['residual']:
        print(f"  ✓ 使用原图走线几何 {stats['residual']} 段（端点已吸附到画布引脚）")
    elif stats.get('layout') == 'textbook':
        print("  走线由电平层自动生成（教科书重排不搬原图走线）")
    else:
        print("  走线为按引脚位置自动生成（上游 JSON 没有 wireShapes）")


def make_portable(html):
    """把 styles.css / symbols.generated.js / app.js / LICENSE 内联进 HTML，
    做成单文件零依赖版本（做法与 tools/build-portable.py 一致）。"""
    def read(name):
        with open(os.path.join(REPO, name), encoding='utf-8') as f:
            return f.read()

    def safe(text):
        return text.replace('</script', '<\\/script').replace('</style', '<\\/style')

    css, symbols, app, lic = (read('styles.css'), read('symbols.generated.js'),
                              read('app.js'), read('LICENSE'))
    link_tag = '  <link rel="stylesheet" href="./styles.css">'
    script_tags = ['  <script defer src="./symbols.generated.js"></script>',
                   '  <script defer src="./app.js"></script>']
    for needle in [link_tag, *script_tags]:
        if needle not in html:
            sys.exit(f'index.html 外壳变了，找不到预期标签：{needle!r}')
    html = html.replace(link_tag, '  <style>\n' + css.rstrip() + '\n  </style>')
    for tag in script_tags:
        html = html.replace(tag + '\n', '').replace(tag, '')
    bundle = ('  <script>\n' + safe(symbols.rstrip()) + '\n  </script>\n'
              '  <script>\n' + safe(app.rstrip()) + '\n  </script>\n'
              '  <script type="text/plain" id="agpl-license">\n'
              + safe(lic.rstrip()) + '\n  </script>\n')
    return html.replace('</body>', bundle + '</body>')


def write_outputs(payload, canvas_id, title, out_html, also_js=True, portable=False):
    spec = importlib.util.spec_from_file_location(
        'build_canvas_file', os.path.join(REPO, 'tools', 'build-canvas-file.py'))
    bcf = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(bcf)
    html = bcf.build_shell(REPO, payload, canvas_id, title)
    if portable:
        html = make_portable(html)
    with open(out_html, 'w', encoding='utf-8') as f:
        f.write(html)
    if also_js:
        os.makedirs(os.path.join(REPO, 'assets'), exist_ok=True)
        var = re.sub(r'[^A-Za-z0-9]+', '_', canvas_id).upper()
        js = ('/* 由 tools/virtuoso-to-canvas.py 生成，请勿手改 */\n'
              f'window.{var} = '
              + json.dumps(payload, ensure_ascii=False, separators=(',', ':')) + ';\n')
        with open(os.path.join(REPO, 'assets', f'{canvas_id}-canvas.js'), 'w',
                  encoding='utf-8') as f:
            f.write(js)
    return len(html)


def main():
    ap = argparse.ArgumentParser(description='Virtuoso schematic JSON → circuit-canvas HTML')
    ap.add_argument('input', help='cc_export.il / schematic_to_json.il 导出的 JSON')
    ap.add_argument('--out', required=True, help='输出 HTML 文件名（放在 circuit-canvas/ 下）')
    ap.add_argument('--id', default=None, help='画布 id（默认取输出文件名）')
    ap.add_argument('--title', default=None, help='画布标题')
    ap.add_argument('--scale', type=float, default=160.0,
                    help='Virtuoso 坐标单位 → 画布单位的比例（默认 160，即 0.0625in 栅格 = 10）')
    ap.add_argument('--label-scale', type=float, default=1.0,
                    help='原理图文字标注的字号缩放（默认 1.0）')
    ap.add_argument('--no-net-labels', action='store_true', help='不生成网络名标注')
    ap.add_argument('--no-real-wires', action='store_true',
                    help='不用原理图里的真实走线几何，改为按引脚位置自动走线')
    ap.add_argument('--layout', choices=('textbook', 'keep'), default='textbook',
                    help='排版方式：textbook（默认）按 Razavi/Gray/Allen 的教科书规矩'
                         '重排成水平电平层 + 电源地轨，导线自然变直；'
                         'keep 保留原图坐标、原图走线几何（忠实但不好看）')
    ap.add_argument('--keep-bulk', action='store_true',
                    help='衬底接在源/漏上的 MOS 也保留四端符号（默认改用三端符号，'
                         'bulk 按默认处理，画出来更干净）')
    ap.add_argument('--report', action='store_true',
                    help='额外打印布局体检：器件遮挡、导线折弯、对称性、走线几何')
    ap.add_argument('--no-js', action='store_true', help='不额外写 assets/<id>-canvas.js')
    ap.add_argument('--portable', action='store_true',
                    help='强制输出单文件、零依赖的 HTML（内联 CSS / 元件几何 / 逻辑 / 许可文本）')
    ap.add_argument('--no-embed', action='store_true',
                    help='强制多文件模式（HTML 里引用 ./styles.css 等；只有当 HTML 放在 '
                         'circuit-canvas/ 目录里时才能用）')
    args = ap.parse_args()

    with open(args.input, encoding='utf-8') as f:
        data = json.load(f)
    canvas_id = args.id or re.sub(r'\.html$', '', os.path.basename(args.out))
    src = data.get('source', {})
    title = args.title or f"{src.get('lib', '')}/{src.get('cell', '')}"
    out_html = args.out if os.path.isabs(args.out) else os.path.join(REPO, args.out)

    # 多文件模式（HTML 里写 ./styles.css / ./symbols.generated.js / ./app.js）只在 HTML
    # 就在 circuit-canvas/ 目录里时成立。放到别处（比如 ~/circuit_canvas_out/）会因为
    # 找不到这三个文件而变成一张没有样式、没有符号库、画不出电路图的白页，
    # 所以默认「输出目录 != 仓库目录」时自动改成单文件内联版。
    out_dir = os.path.dirname(os.path.realpath(out_html))
    portable = args.portable or (not args.no_embed and out_dir != os.path.realpath(REPO))
    if args.no_embed and out_dir != os.path.realpath(REPO):
        print('  ⚠ --no-embed 生成的 HTML 引用 ./styles.css 等相对路径，')
        print('    但它不在 circuit-canvas/ 目录里，浏览器打开会没样式、画不出电路图。')
        print('    要么去掉 --no-embed，要么把它拷到 circuit-canvas/ 目录里。')

    payload, stats = convert(data, canvas_id, title, args.scale,
                             net_labels=not args.no_net_labels,
                             label_scale=args.label_scale,
                             real_wires=not args.no_real_wires,
                             layout=args.layout,
                             keep_bulk=args.keep_bulk)
    size = write_outputs(payload, canvas_id, title, out_html,
                         also_js=not args.no_js and not portable,
                         portable=portable)
    print(f"器件 {stats['components'] - stats['junctions']} · 导线 {stats['wires']} · "
          f"标注 {len(payload['draft']['texts'])} · "
          f"画布 {payload['meta']['width']}×{payload['meta']['height']}")
    print(f"  排版：{'教科书重排（电平层 + 电源/地轨）' if args.layout == 'textbook' else '保持原图坐标'}")
    if stats['residual']:
        print(f"  原图走线 {stats['residual']} 段 · 连接点 {stats['junctions']} 个"
              f" · 隐藏的自动走线 {stats['hidden']} 条")
    print(f"  模式：{'单文件（CSS/符号库/逻辑已内联，可任意拷贝）' if portable else '多文件（依赖同目录 styles.css 等）'}")
    if args.report:
        report_layout(stats)
    for label, items in (('未识别实例（已画成黑盒矩形）', stats.get('blocks') or []),
                         ('跳过未识别实例', stats['skipped']),
                         ('悬空网络', stats['dangling']),
                         ('端子未匹配', stats['unrouted'])):
        if items:
            print(f'  ⚠ {label} {len(items)}：' + '、'.join(items[:12])
                  + (' …' if len(items) > 12 else ''))
    print(f'  -> {out_html} ({size / 1024:.0f} KB)')


if __name__ == '__main__':
    main()
