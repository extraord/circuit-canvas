/*
  回路 · 电路绘图 (Huilu Circuit Canvas)
  Copyright (C) 2026 回路 contributors

  This program is free software: you can redistribute it and/or modify
  it under the terms of the GNU Affero General Public License as published by
  the Free Software Foundation, version 3 of the License.

  This program is distributed in the hope that it will be useful,
  but WITHOUT ANY WARRANTY; without even the implied warranty of
  MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
  GNU Affero General Public License for more details.

  You should have received a copy of the GNU Affero General Public License
  along with this program.  If not, see <https://www.gnu.org/licenses/>.

  SPDX-License-Identifier: AGPL-3.0-only

  Modified 2026: created this project; component library expanded to 107 parts;
  symbol coordinate grid and pin anchors unified.
*/
(() => {
  'use strict';

  const NS = 'http://www.w3.org/2000/svg';
  // ── 画布文件（canvas file）────────────────────────────────────────────
  // 一张具体图纸（如 UCIe PHY 框图）有两种来源：
  //   1. 独立 HTML 画布文件：tools/build-canvas-file.py 把图纸数据内嵌成
  //      window.CANVAS_FILE，整个文件可以单独拷到别的机器，只依赖公用库
  //      （styles.css / symbols.generated.js / app.js）；
  //   2. 旧入口 index.html?ucie=sheet：从 assets/ucie-canvas.js 载入。
  // 下面把两种来源归一到同一个 canvasFile 对象，其余逻辑只认它。
  const ucieCanvas = new URLSearchParams(location.search).get('ucie') && window.UCIE_CANVAS ? window.UCIE_CANVAS : null;
  // 旧入口：index.html?ucie=sheet 时读 assets/ucie-canvas.js；独立画布文件不经过这里
  const canvasFile = window.CANVAS_FILE
    ? window.CANVAS_FILE
    : (ucieCanvas
      ? {
        id: 'ucie-sheet',
        title: ucieCanvas.meta.name,
        sheet: ucieCanvas.meta.page,
        source: ucieCanvas.meta.source,
        width: ucieCanvas.meta.width,
        height: ucieCanvas.meta.height,
        draft: ucieCanvas.draft,
        residual: ucieCanvas.residual,
        snap: ucieCanvas.snap
      }
      : null);
  const CANVAS_W = canvasFile ? Math.round(canvasFile.width) : 1200;
  const CANVAS_H = canvasFile ? Math.round(canvasFile.height) : 800;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const draftStorageKey = canvasFile ? `huilu-canvas-${canvasFile.id}-local-draft` : 'huilu-local-draft';
  const canvas = $('#circuit-canvas');
  const canvasBg = $('.canvas-bg');
  const shapeLayer = $('#shape-layer');
  const wireLayer = $('#wire-layer');
  const textLayer = $('#text-layer');
  const componentLayer = $('#component-layer');
  const interactionLayer = $('#interaction-layer');
  const workspace = $('.workspace');
  const inspector = $('#inspector-content');
  const netlistPane = $('#netlist-pane');
  const netlistCode = $('#netlist-code');

  const partSpecs = {
    resistor: { title: '电阻', english: 'Resistor', glyph: 'R', width: 20, height: 48, value: '10 kΩ', pins: [{ name: '1', x: 0, y: -20 }, { name: '2', x: 0, y: 20 }] },
    'variable-resistor': { title: '可变电阻', english: 'Variable resistor', glyph: 'R↗', width: 20, height: 48, value: '10 kΩ', pins: [{ name: '1', x: 0, y: -20 }, { name: '2', x: 0, y: 20 }] },
    capacitor: { title: '电容', english: 'Capacitor', glyph: 'C', width: 32, height: 48, value: '100 nF', pins: [{ name: '1', x: 0, y: -20 }, { name: '2', x: 0, y: 20 }] },
    'variable-capacitor': { title: '可变电容', english: 'Variable capacitor', glyph: 'C↗', width: 32, height: 48, value: '100 pF', pins: [{ name: '1', x: 0, y: -20 }, { name: '2', x: 0, y: 20 }] },
    inductor: { title: '电感', english: 'Inductor', glyph: 'L', width: 48, height: 48, value: '1 mH', pins: [{ name: '1', x: 0, y: -20 }, { name: '2', x: 0, y: 20 }] },
    'variable-inductor': { title: '可变电感', english: 'Variable inductor', glyph: 'L↗', width: 48, height: 48, value: '1 mH', pins: [{ name: '1', x: 0, y: -20 }, { name: '2', x: 0, y: 20 }] },
    voltage: { title: '电压源', english: 'Voltage source', glyph: 'V', width: 40, height: 48, value: '1 V', pins: [{ name: '+', x: 0, y: -20 }, { name: '−', x: 0, y: 20 }] },
    current: { title: '电流源', english: 'Current source', glyph: 'I', width: 40, height: 48, value: '1 mA', pins: [{ name: '1', x: 0, y: -20 }, { name: '2', x: 0, y: 20 }] },
    diode: { title: '二极管', english: 'Diode', glyph: 'D', width: 48, height: 32, value: 'D1', pins: [{ name: 'A', x: -20, y: 0 }, { name: 'K', x: 20, y: 0 }] },
    nmos: { title: 'NMOS', english: 'N-channel MOSFET', glyph: 'M', width: 48, height: 48, value: 'W/L = 10/1 μm', pins: [{ name: 'G', x: -20, y: 0 }, { name: 'D', x: 10, y: -20 }, { name: 'S', x: 10, y: 20 }] },
    pmos: { title: 'PMOS', english: 'P-channel MOSFET', glyph: 'M', width: 48, height: 48, value: 'W/L = 10/1 μm', pins: [{ name: 'G', x: -20, y: 0 }, { name: 'D', x: 10, y: -20 }, { name: 'S', x: 10, y: 20 }] },
    npn: { title: 'NPN 三极管', english: 'NPN BJT', glyph: 'Q', width: 48, height: 48, value: 'model QN', pins: [{ name: 'B', x: -20, y: 0 }, { name: 'C', x: 10, y: -20 }, { name: 'E', x: 10, y: 20 }] },
    pnp: { title: 'PNP 三极管', english: 'PNP BJT', glyph: 'Q', width: 48, height: 48, value: 'model QP', pins: [{ name: 'B', x: -20, y: 0 }, { name: 'C', x: 10, y: -20 }, { name: 'E', x: 10, y: 20 }] },
    dff: { title: 'D 触发器', english: 'D Flip-Flop', glyph: 'DFF', width: 104, height: 76, value: '', pins: [{ name: 'D', x: -50, y: -14 }, { name: 'CLK', x: -50, y: 14 }, { name: 'Q', x: 50, y: -14 }, { name: 'QN', x: 50, y: 14 }] },
    xor: { title: '异或门', english: 'XOR gate', glyph: 'XOR', width: 88, height: 48, value: '', pins: [{ name: 'A', x: -30, y: -10 }, { name: 'B', x: -30, y: 10 }, { name: 'Y', x: 20, y: 0 }] },
    and: { title: '与门', english: 'AND gate', glyph: 'AND', width: 88, height: 48, value: '', pins: [{ name: 'A', x: -30, y: -10 }, { name: 'B', x: -30, y: 10 }, { name: 'Y', x: 20, y: 0 }] },
    or: { title: '或门', english: 'OR gate', glyph: 'OR', width: 88, height: 48, value: '', pins: [{ name: 'A', x: -30, y: -10 }, { name: 'B', x: -30, y: 10 }, { name: 'Y', x: 20, y: 0 }] },
    nand: { title: '与非门', english: 'NAND gate', glyph: 'NAND', width: 88, height: 48, value: '', pins: [{ name: 'A', x: -30, y: -10 }, { name: 'B', x: -30, y: 10 }, { name: 'Y', x: 20, y: 0 }] },
    nor: { title: '或非门', english: 'NOR gate', glyph: 'NOR', width: 88, height: 48, value: '', pins: [{ name: 'A', x: -30, y: -10 }, { name: 'B', x: -30, y: 10 }, { name: 'Y', x: 20, y: 0 }] },
    not: { title: '非门', english: 'Inverter', glyph: 'NOT', width: 88, height: 48, value: '', pins: [{ name: 'A', x: -30, y: 0 }, { name: 'Y', x: 20, y: 0 }] },
    'variable-resistor': { title: '可变电阻', english: 'Variable resistor', glyph: 'R↗', width: 84, height: 32, value: '10 kΩ', pins: [{ name: '1', x: -42, y: 0 }, { name: '2', x: 42, y: 0 }] },
    'variable-capacitor': { title: '可变电容', english: 'Variable capacitor', glyph: 'C↗', width: 44, height: 72, value: '100 pF', pins: [{ name: '1', x: 0, y: -36 }, { name: '2', x: 0, y: 36 }] },
    'variable-inductor': { title: '可变电感', english: 'Variable inductor', glyph: 'L↗', width: 88, height: 32, value: '1 mH', pins: [{ name: '1', x: -44, y: 0 }, { name: '2', x: 44, y: 0 }] },
    battery: { title: '电池', english: 'Battery', glyph: 'BAT', width: 44, height: 88, value: '1.5 V', pins: [{ name: '+', x: 0, y: -44 }, { name: '−', x: 0, y: 44 }] },
    'pulse-voltage': { title: '脉冲电压源', english: 'Pulse voltage source', glyph: 'VP', width: 50, height: 88, value: 'PULSE', pins: [{ name: '+', x: 0, y: -44 }, { name: '−', x: 0, y: 44 }] },
    'digital-clock': { title: '数字时钟', english: 'Digital clock', glyph: 'CLK', width: 48, height: 88, value: '1 MHz', pins: [{ name: '1', x: 0, y: -44 }, { name: '2', x: 0, y: 44 }] },
    'zener-diode': { title: '齐纳二极管', english: 'Zener diode', glyph: 'ZD', width: 84, height: 38, value: 'DZ1', pins: [{ name: 'A', x: -42, y: 0 }, { name: 'K', x: 42, y: 0 }] },
    'ideal-switch': { title: '理想开关', english: 'Ideal switch', glyph: 'SW', width: 84, height: 40, value: '', pins: [{ name: '1', x: -42, y: 0 }, { name: '2', x: 42, y: 0 }] },
    'closed-switch': { title: '闭合开关', english: 'Closed switch', glyph: 'SW', width: 84, height: 40, value: '', pins: [{ name: '1', x: -42, y: 0 }, { name: '2', x: 42, y: 0 }] },
    'controlled-switch': { title: '受控开关', english: 'Controlled switch', glyph: 'CSW', width: 88, height: 72, value: '', pins: [{ name: 'P', x: 18, y: -28 }, { name: 'N', x: 18, y: 28 }, { name: 'CTRL+', x: -42, y: -14 }, { name: 'CTRL-', x: -42, y: 14 }] },
    'nmos-bulk': { title: '四端 NMOS', english: 'Four-terminal NMOS', glyph: 'M4', width: 72, height: 92, value: 'W/L = 10/1 μm', pins: [{ name: 'G', x: -34, y: 0 }, { name: 'D', x: 13, y: -36 }, { name: 'S', x: 13, y: 36 }, { name: 'B', x: -13, y: 48 }] },
    'pmos-bulk': { title: '四端 PMOS', english: 'Four-terminal PMOS', glyph: 'M4', width: 72, height: 92, value: 'W/L = 10/1 μm', pins: [{ name: 'G', x: -34, y: 0 }, { name: 'D', x: 13, y: -36 }, { name: 'S', x: 13, y: 36 }, { name: 'B', x: -13, y: 48 }] },
    'nmos-depletion': { title: '耗尽型 NMOS', english: 'Depletion NMOS', glyph: 'DM', width: 72, height: 72, value: 'W/L = 10/1 μm', pins: [{ name: 'G', x: -34, y: 0 }, { name: 'D', x: 13, y: -36 }, { name: 'S', x: 13, y: 36 }] },
    'pmos-depletion': { title: '耗尽型 PMOS', english: 'Depletion PMOS', glyph: 'DM', width: 72, height: 72, value: 'W/L = 10/1 μm', pins: [{ name: 'G', x: -34, y: 0 }, { name: 'D', x: 13, y: -36 }, { name: 'S', x: 13, y: 36 }] },
    'dff-reset': { title: '异步复位 D 触发器', english: 'D Flip-Flop with reset', glyph: 'DFF R', width: 104, height: 92, value: '', pins: [{ name: 'D', x: -50, y: -22 }, { name: 'CLK', x: -50, y: 0 }, { name: 'RST', x: -50, y: 22 }, { name: 'Q', x: 50, y: -14 }, { name: 'QN', x: 50, y: 14 }] },
    xnor: { title: '同或门', english: 'XNOR gate', glyph: 'XNOR', width: 104, height: 76, value: '', pins: [{ name: 'A', x: -52, y: -15 }, { name: 'B', x: -52, y: 15 }, { name: 'Y', x: 52, y: 0 }] },
    buffer: { title: '缓冲器', english: 'Buffer', glyph: 'BUF', width: 104, height: 64, value: '', pins: [{ name: 'A', x: -52, y: 0 }, { name: 'Y', x: 52, y: 0 }] },
    'delay-cell': { title: '延迟单元', english: 'Delay cell', glyph: 'Δt', width: 104, height: 64, value: '', pins: [{ name: 'IN', x: -52, y: 0 }, { name: 'OUT', x: 52, y: 0 }] },
    opamp: { title: '运算放大器', english: 'Operational amplifier', glyph: 'OP', width: 104, height: 76, value: '', pins: [{ name: '+', x: -52, y: -15 }, { name: '−', x: -52, y: 15 }, { name: 'OUT', x: 52, y: 0 }] },
    'fd-amp': { title: '全差分放大器', english: 'Fully differential amplifier', glyph: 'FDA', width: 104, height: 76, value: '', pins: [{ name: 'IN+', x: -52, y: -15 }, { name: 'IN-', x: -52, y: 15 }, { name: 'OUT+', x: 52, y: -15 }, { name: 'OUT-', x: 52, y: 15 }] },
    'voltage-amp': { title: '电压放大器', english: 'Voltage amplifier', glyph: 'VA', width: 104, height: 76, value: '', pins: [{ name: '+', x: -52, y: -15 }, { name: '−', x: -52, y: 15 }, { name: 'OUT', x: 52, y: 0 }] },
    comparator: { title: '比较器', english: 'Comparator', glyph: 'CMP', width: 104, height: 76, value: '', pins: [{ name: '+', x: -52, y: -15 }, { name: '−', x: -52, y: 15 }, { name: 'OUT', x: 52, y: 0 }] },
    'comparator-unmarked': { title: '比较器（无极性）', english: 'Comparator, unmarked', glyph: 'CMP', width: 104, height: 76, value: '', pins: [{ name: '1', x: -52, y: -15 }, { name: '2', x: -52, y: 15 }, { name: 'OUT', x: 52, y: 0 }] },
    transconductance: { title: '跨导放大器', english: 'Transconductance amplifier', glyph: 'gm', width: 104, height: 76, value: '', pins: [{ name: '+', x: -52, y: -15 }, { name: '−', x: -52, y: 15 }, { name: 'OUT', x: 52, y: 0 }] },
    'differential-transconductance': { title: '差分跨导放大器', english: 'Differential transconductance amplifier', glyph: 'gm', width: 104, height: 76, value: '', pins: [{ name: 'IN+', x: -52, y: -15 }, { name: 'IN-', x: -52, y: 15 }, { name: 'OUT+', x: 52, y: -15 }, { name: 'OUT-', x: 52, y: 15 }] },
    port: { title: '端口', english: 'Port', glyph: 'P', width: 54, height: 36, value: 'PORT', pins: [{ name: 'P', x: -36, y: 0 }] },
    'port-filled': { title: '实心端口', english: 'Filled port', glyph: 'P+', width: 54, height: 36, value: 'PORT', pins: [{ name: 'P', x: -36, y: 0 }] },
    transformer: { title: '变压器', english: 'Transformer', glyph: 'T', width: 100, height: 76, value: 'L1/L2 = 1:1', pins: [{ name: 'P+', x: -48, y: -20 }, { name: 'P-', x: -48, y: 20 }, { name: 'S+', x: 48, y: -20 }, { name: 'S-', x: 48, y: 20 }] },
    tcoil: { title: 'T 型线圈', english: 'T-coil', glyph: 'TC', width: 100, height: 76, value: 'L1=L2=1 nH', pins: [{ name: 'IN', x: -48, y: -20 }, { name: 'OUT', x: 48, y: -20 }, { name: 'GND', x: 0, y: 38 }, { name: 'B', x: 0, y: -38 }] },
    ground: { title: '接地', english: 'Ground', glyph: 'GND', width: 42, height: 28, value: '', pins: [{ name: '0', x: 0, y: -18 }] },
    junction: { title: '连接点', english: 'Junction', glyph: '●', width: 8, height: 8, value: '', pins: [{ name: '1', x: 0, y: 0 }] },
    // 标尺：不画固定符号，尺寸由「长度 × 比例」决定（见 rulerMarkup）。
    ruler: { title: '标尺', english: 'Ruler', glyph: '⊢⊣', width: 200, height: 26, value: '', box: [-100, -20, 200, 44], pins: [] },
    // 可调矩形：不是元件，落子时转成「图形」对象，尺寸可在属性里直接填。
    'rect-block': { title: '可调矩形', english: 'Adjustable rectangle', glyph: '▭', width: 160, height: 100, value: '', box: [-80, -50, 160, 100], pins: [] },
    'variable-octagon': { title: '可变八边形', english: 'Variable octagon', glyph: '8', width: 120, height: 120, value: '', box: [-60, -60, 120, 120], pins: [], variableShape: 'octagon' },
    'variable-circle': { title: '可变圆形', english: 'Variable circle', glyph: '○', width: 120, height: 120, value: '', box: [-60, -60, 120, 120], pins: [], variableShape: 'ellipse' },
    // 黑盒单元：矩形 + 每实例自定义的引脚（component.pins），引脚名写在框内。
    // 从 Virtuoso 导入时，未识别的 cell 就用它代替，不再是「跳过 + 警告」。
    block: { title: '黑盒单元', english: 'Black box cell', glyph: 'BOX', width: 160, height: 100, value: '', box: [-80, -50, 160, 100], pins: [] },
    // 参数化图元：函数曲线 / 概率分布 / 数字波形（几何由参数算出，见 curveMarkup 等）
    'math-curve': { title: '函数曲线', english: 'Function curve', glyph: 'ƒ', width: 150, height: 96, value: '', box: [-75, -48, 150, 96], pins: [] },
    'prob-curve': { title: '概率分布', english: 'Probability distribution', glyph: '℘', width: 150, height: 96, value: '', box: [-75, -48, 150, 96], pins: [] },
    'digital-wave': { title: '数字波形', english: 'Digital waveform', glyph: '⊓', width: 180, height: 64, value: '', box: [-90, -32, 180, 64], pins: [] },
    // 元件库里拆成三个入口，共用同一个渲染器，默认 kind 不同
    'digital-wave-clock': { title: '时钟波形', english: 'Clock waveform', glyph: '⊓', width: 180, height: 64, value: '', box: [-90, -32, 180, 64], pins: [], waveKind: 'clock' },
    'digital-wave-signal': { title: '数据波形', english: 'Data waveform', glyph: '⊓', width: 180, height: 64, value: '', box: [-90, -32, 180, 64], pins: [], waveKind: 'signal' },
    'digital-wave-bus': { title: '总线波形', english: 'Bus waveform', glyph: '⊓', width: 180, height: 64, value: '', box: [-90, -32, 180, 64], pins: [], waveKind: 'bus' }
  };

  function registerExtendedParts() {
    const gateLevels = arity => (arity === 3 ? [-10, 0, 10] : [-12, -4, 4, 12]);
    for (const family of ['and', 'or', 'nand', 'nor', 'xor', 'xnor']) {
      const bubble = family === 'nand' || family === 'nor' || family === 'xnor';
      for (const arity of [3, 4]) {
        const names = arity === 3 ? ['A', 'B', 'C'] : ['A', 'B', 'C', 'D'];
        const pins = gateLevels(arity).map((y, index) => ({ name: names[index], x: -30, y }));
        pins.push({ name: 'Y', x: bubble ? 30 : 20, y: 0 });
        partSpecs[`${family}-${arity}`] = {
          title: `${family.toUpperCase()} 门 · ${arity} 输入`,
          english: `${family.toUpperCase()} gate, ${arity}-input`,
          glyph: family.toUpperCase(), width: 88, height: 48, value: '', pins
        };
      }
    }
    const depPins = [{ name: 'OUT+', x: 0, y: -30 }, { name: 'OUT-', x: 0, y: 30 }, { name: 'CTL+', x: -30, y: 0 }, { name: 'CTL-', x: 30, y: 0 }];
    partSpecs.vcvs = { title: '压控电压源', english: 'Voltage-controlled voltage source', glyph: 'VCVS', width: 60, height: 60, value: '', pins: depPins };
    partSpecs.vccs = { title: '压控电流源', english: 'Voltage-controlled current source', glyph: 'VCCS', width: 60, height: 60, value: '', pins: depPins };
    partSpecs.ccvs = { title: '流控电压源', english: 'Current-controlled voltage source', glyph: 'CCVS', width: 60, height: 60, value: '', pins: depPins };
    partSpecs.cccs = { title: '流控电流源', english: 'Current-controlled current source', glyph: 'CCCS', width: 60, height: 60, value: '', pins: depPins };
    partSpecs['simple-switch'] = { title: '单刀开关', english: 'Simple switch', glyph: 'SW', width: 48, height: 32, value: '', pins: [{ name: '1', x: -20, y: 0 }, { name: '2', x: 20, y: 0 }] };
    partSpecs['voltage-controlled-switch'] = { title: '压控开关', english: 'Voltage-controlled switch', glyph: 'SW', width: 88, height: 48, value: '', pins: [{ name: 'P', x: 20, y: -14 }, { name: 'N', x: 20, y: 14 }, { name: 'CTRL', x: -30, y: 0 }] };
    partSpecs['spdt-switch'] = { title: '单刀双掷开关', english: 'SPDT switch', glyph: 'SPDT', width: 76, height: 72, value: '', pins: [{ name: 'COM', x: -30, y: 0 }, { name: 'NC', x: 30, y: -16 }, { name: 'NO', x: 30, y: 16 }] };
    partSpecs['vdd-port'] = { title: '电源端口', english: 'VDD port', glyph: 'VDD', width: 40, height: 48, value: 'VDD', pins: [{ name: 'VDD', x: 0, y: 20 }] };
    partSpecs['dff-q'] = { title: 'D 触发器 · 单输出', english: 'D flip-flop, Q only', glyph: 'DFF', width: 88, height: 48, value: '', pins: [{ name: 'D', x: -30, y: -12 }, { name: 'CLK', x: -30, y: 12 }, { name: 'Q', x: 30, y: 0 }] };
    partSpecs['opamp-wide'] = { title: '宽间距运放', english: 'Op amp · wide', glyph: 'OP', width: 88, height: 80, value: '', pins: [{ name: '+', x: -40, y: 20 }, { name: '-', x: -40, y: -20 }, { name: 'OUT', x: 30, y: 0 }] };
    partSpecs['opamp-lettered'] = { title: '带标注运放', english: 'Op amp · lettered', glyph: 'OP', width: 88, height: 68, value: '', pins: [{ name: '+', x: -40, y: 10 }, { name: '-', x: -40, y: -10 }, { name: 'OUT', x: 30, y: 0 }] };
    partSpecs['opamp-inputs-swapped'] = { title: '运放 · 输入反转', english: 'Op amp · inputs swapped', glyph: 'OP', width: 88, height: 68, value: '', pins: [{ name: '+', x: -40, y: -10 }, { name: '-', x: -40, y: 10 }, { name: 'OUT', x: 30, y: 0 }] };
    partSpecs['comparator-inputs-swapped'] = { title: '比较器 · 输入反转', english: 'Comparator · inputs swapped', glyph: 'CMP', width: 88, height: 68, value: '', pins: [{ name: '+', x: -40, y: -10 }, { name: '-', x: -40, y: 10 }, { name: 'OUT', x: 30, y: 0 }] };
    const behavioral = [
      ['adder', '加法器', 'Adder', [{ name: 'A', x: -40, y: -14 }, { name: 'B', x: -40, y: 0 }, { name: 'CIN', x: -40, y: 14 }, { name: 'S', x: 30, y: -10 }, { name: 'COUT', x: 30, y: 10 }]],
      ['multiplier', '乘法器', 'Multiplier', [{ name: 'X', x: -40, y: -12 }, { name: 'Y', x: -40, y: 12 }, { name: 'OUT', x: 30, y: 0 }]],
      ['integrator', '积分器', 'Integrator', [{ name: 'IN', x: -40, y: 0 }, { name: 'OUT', x: 30, y: 0 }]],
      ['unit-delay', '单位延迟', 'Unit delay', [{ name: 'IN', x: -30, y: -12 }, { name: 'CLK', x: -30, y: 12 }, { name: 'OUT', x: 30, y: 0 }]],
      ['dt-integrator', '离散时间积分器', 'Discrete-time integrator', [{ name: 'IN', x: -40, y: 0 }, { name: 'CLK', x: -40, y: 18 }, { name: 'OUT', x: 30, y: 0 }]],
      ['quantizer', '量化器', 'Quantizer', [{ name: 'IN', x: -40, y: 0 }, { name: 'CLK', x: -40, y: 18 }, { name: 'OUT', x: 30, y: 0 }]],
      ['adc', '模数转换器', 'ADC', [{ name: 'AIN', x: -40, y: 0 }, { name: 'CLK', x: -40, y: 18 }, { name: 'D', x: 30, y: 0 }]],
      ['dac', '数模转换器', 'DAC', [{ name: 'D', x: -40, y: 0 }, { name: 'CLK', x: -40, y: 18 }, { name: 'AOUT', x: 30, y: 0 }]]
    ];
    for (const [type, title, english, pins] of behavioral) {
      partSpecs[type] = { title, english, glyph: 'U', width: 88, height: 68, value: '', pins };
    }
  }
  registerExtendedParts();

  // ── 上游几何接线 ──────────────────────────────────────────────────────────
  // 绘图数据来自 symbols.generated.js，逐字取自 Analog Canvas 的元件定义。
  // 这里只负责「元件类型 → 上游符号」的对应，以及把图元翻译成 SVG。
  const ANALOG = window.ANALOG_CANVAS_SYMBOLS || {};

  // 上游没有的两个符号由本应用自备，图元格式与上游完全一致。
  const LOCAL_SYMBOLS = {
    'digital-clock': {
      vb: [-19.5, -24, 39, 48],
      pins: [{ n: '1', x: 0, y: -20, d: 'north', l: 10 }, { n: '2', x: 0, y: 20, d: 'south', l: 10 }],
      prim: [
        { t: 'circle', cx: 0, cy: 0, r: 10.755814, s: 'normal' },
        { t: 'polyline', p: [[-6, 4], [-3, 4], [-3, -4], [0, -4], [0, 4], [3, 4], [3, -4], [6, -4]], s: 'normal' },
        { t: 'line', x1: 0, y1: -10.755814, x2: 0, y2: -20, s: 'normal' },
        { t: 'line', x1: 0, y1: 10.755814, x2: 0, y2: 20, s: 'normal' }
      ]
    },
    junction: {
      vb: [-8, -8, 16, 16],
      pins: [{ n: '1', x: 0, y: 0, d: 'east', l: 0 }],
      prim: [{ t: 'circle', cx: 0, cy: 0, r: 3.77907, fill: 'foreground', stroke: 'none' }]
    }
  };

  const CATALOG = Object.assign({}, ANALOG, LOCAL_SYMBOLS);

  // 描边宽度取自上游 razavi-textbook-v1 样式档，单位与坐标一致。
  const STROKE_WIDTH = { normal: 1.6, emphasis: 2.4, ground: 2.906977, supply: 1.8, powerRail: 3.24, annotation: 1.6 };
  const STROKE_FALLBACK = 1.6;
  const PIN_NAME_SIZE = 14;
  const OUTWARD = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };

  const trim = value => String(Math.round(value * 1000) / 1000);

  function strokeWidthOf(primitive) {
    if (typeof primitive.w === 'number') return primitive.w;
    return STROKE_WIDTH[primitive.s] || STROKE_FALLBACK;
  }

  /** 一个上游图元 → 一个 SVG 元素；填充与描边语义与上游一致。 */
  function primitiveMarkup(primitive) {
    const solid = primitive.fill === 'foreground';
    const outlined = primitive.stroke !== 'none';
    const cls = solid ? (outlined ? 'symbol-fill' : 'symbol-solid') : 'symbol';
    const stroke = solid && !outlined ? '' : ` stroke-width="${trim(strokeWidthOf(primitive))}"`;
    let geometry = '';
    if (primitive.t === 'line') geometry = `x1="${trim(primitive.x1)}" y1="${trim(primitive.y1)}" x2="${trim(primitive.x2)}" y2="${trim(primitive.y2)}"`;
    else if (primitive.t === 'circle') geometry = `cx="${trim(primitive.cx)}" cy="${trim(primitive.cy)}" r="${trim(primitive.r)}"`;
    else if (primitive.t === 'path') geometry = `d="${primitive.d}"`;
    else if (primitive.t === 'polyline' || primitive.t === 'polygon') geometry = `points="${primitive.p.map(point => `${trim(point[0])},${trim(point[1])}`).join(' ')}"`;
    else return '';
    return `<${primitive.t} class="${cls}" ${geometry}${stroke}/>`;
  }

  /** 上游用富文本写公式，这里把 a_b / a^b 转成下标与上标。 */
  function formulaMarkup(symbol) {
    const formula = symbol.formula;
    if (!formula || !formula.text) return '';
    const body = escapeHtml(formula.text).replace(/([_^])(\{[^}]*\}|[^\s_^{}]+)/g, (match, marker, part) =>
      `<tspan class="${marker === '_' ? 'formula-sub' : 'formula-sup'}">${part.replace(/^\{|\}$/g, '')}</tspan>`);
    return `<text class="formula-label" x="${trim(formula.cx)}" y="${trim(formula.cy)}" dominant-baseline="central" font-size="${trim(formula.size || 12)}">${body}</text>`;
  }

  /** 需要显示引脚名的符号（触发器一类），把名字排在元件内部。 */
  function pinNameMarkup(symbol, hidden) {
    return symbol.pins.filter(pin => pin.show && !hidden.has(pin.n)).map(pin => {
      const outward = OUTWARD[pin.d] || [0, 0];
      const distance = (pin.l || 0) + 4;
      const x = pin.x - outward[0] * distance;
      const y = pin.y - outward[1] * distance;
      const anchor = outward[0] > 0 ? 'end' : outward[0] < 0 ? 'start' : 'middle';
      return `<text class="pin-name" x="${trim(x)}" y="${trim(y)}" text-anchor="${anchor}" dominant-baseline="central" font-size="${trim(PIN_NAME_SIZE * (pin.scale || 1))}">${escapeHtml(pin.dn || pin.n)}</text>`;
    }).join('');
  }

  function registerOpampFamily() {
    for (const differential of [false, true]) {
      for (const wide of [false, true]) {
        for (const crossed of differential ? [false, true] : [false]) {
          for (const lettered of [false, true]) {
            for (const swapped of [false, true]) {
              const id = ['opamp'];
              if (differential) id.push('differential');
              if (wide) id.push('wide');
              if (crossed) id.push('crossed');
              if (lettered) id.push('lettered');
              if (swapped) id.push('inputs-swapped');
              const type = id.join('-');
              const traits = { differential, wide, crossed, lettered, swapped };
              const labels = [];
              if (differential) labels.push('差分');
              if (wide) labels.push('宽间距');
              if (crossed) labels.push('输出交叉');
              if (lettered) labels.push('带标注');
              if (swapped) labels.push('输入反转');
              partSpecs[type] = {
                title: `运放 · ${labels.length ? labels.join(' ') : '标准'}`,
                english: `Op amp${differential ? ', differential' : ''}${wide ? ', wide' : ''}${crossed ? ', crossed' : ''}${lettered ? ', lettered' : ''}${swapped ? ', inputs swapped' : ''}`,
                glyph: 'OP', width: 88, height: wide ? 80 : 68, value: '',
                pins: [], opamp: traits
              };
            }
          }
        }
      }
    }
    partSpecs['comparator-unmarked-inputs-swapped'] = { title: '比较器（无极性）· 输入反转', english: 'Comparator, unmarked, inputs swapped', glyph: 'CMP', width: 88, height: 68, value: '', pins: [{ name: '1', x: -40, y: -10 }, { name: '2', x: -40, y: 10 }, { name: 'OUT', x: 30, y: 0 }] };
    partSpecs['differential-transconductance-inputs-swapped'] = { title: '差分跨导 · 输入反转', english: 'Differential gm, inputs swapped', glyph: 'gm', width: 88, height: 68, value: '', pins: [{ name: 'IN-', x: -40, y: -10 }, { name: 'IN+', x: -40, y: 10 }, { name: 'OUT+', x: 30, y: -10 }, { name: 'OUT-', x: 30, y: 10 }] };
    partSpecs['inductor-compact'] = { title: '电感（紧凑）', english: 'Inductor, compact', glyph: 'L', width: 40, height: 48, value: '1 mH', pins: [{ name: '1', x: 0, y: -20 }, { name: '2', x: 0, y: 20 }] };
    partSpecs['externally-controlled-switch'] = { title: '外部受控开关', english: 'Externally controlled switch', glyph: 'CSW', width: 88, height: 72, value: '', pins: [{ name: 'P', x: 18, y: -28 }, { name: 'N', x: 18, y: 28 }, { name: 'CTRL+', x: -42, y: -14 }, { name: 'CTRL-', x: -42, y: 14 }] };
    partSpecs['voltage-amplifier-lettered'] = { title: '电压放大器 · 带标注', english: 'Voltage amplifier, lettered', glyph: 'VA', width: 88, height: 68, value: '', pins: [{ name: '+', x: -40, y: 10 }, { name: '-', x: -40, y: -10 }, { name: 'OUT', x: 30, y: 0 }] };
    partSpecs.ndmos = { title: '高压 NMOS (DMOS)', english: 'High-voltage NMOS', glyph: 'M', width: 48, height: 48, value: 'W/L = 10/1 μm', pins: [{ name: 'G', x: -20, y: 0 }, { name: 'D', x: 10, y: -20 }, { name: 'S', x: 10, y: 20 }, { name: 'B', x: 20, y: 0 }] };
    partSpecs.pdmos = { title: '高压 PMOS (DMOS)', english: 'High-voltage PMOS', glyph: 'M', width: 48, height: 48, value: 'W/L = 10/1 μm', pins: [{ name: 'G', x: -20, y: 0 }, { name: 'D', x: 10, y: -20 }, { name: 'S', x: 10, y: 20 }, { name: 'B', x: 20, y: 0 }] };
  }
  registerOpampFamily();

  const starterProject = () => ({
    name: 'RC 低通滤波器',
    components: [
      { id: 'v1', type: 'voltage', name: 'V1', value: '1 V', x: 210, y: 390, rotation: 0 },
      { id: 'r1', type: 'resistor', name: 'R1', value: '10 kΩ', x: 465, y: 350, rotation: 0 },
      { id: 'j1', type: 'junction', name: 'N1', value: '', x: 650, y: 350, rotation: 0 },
      { id: 'c1', type: 'capacitor', name: 'C1', value: '100 nF', x: 650, y: 485, rotation: 0 },
      { id: 'g1', type: 'ground', name: 'GND', value: '', x: 650, y: 620, rotation: 0 },
      { id: 'g2', type: 'ground', name: 'GND', value: '', x: 210, y: 535, rotation: 0 }
    ],
    wires: [
      { id: 'w1', from: { component: 'v1', pin: 0 }, to: { component: 'r1', pin: 0 } },
      { id: 'w2', from: { component: 'r1', pin: 1 }, to: { component: 'j1', pin: 0 } },
      { id: 'w3', from: { component: 'j1', pin: 0 }, to: { component: 'c1', pin: 0 } },
      { id: 'w4', from: { component: 'c1', pin: 1 }, to: { component: 'g1', pin: 0 } },
      { id: 'w5', from: { component: 'v1', pin: 1 }, to: { component: 'g2', pin: 0 } }
    ],
    texts: [
      { id: 't1', x: 132, y: 302, text: '输入  ·  Vin', size: 18 },
      { id: 't2', x: 690, y: 342, text: '输出  ·  Vout', size: 18 },
      { id: 't3', x: 130, y: 170, text: '一阶 RC 低通滤波器', size: 24 },
      { id: 't4', x: 130, y: 196, text: '截止频率  fc = 1 / (2πRC)', size: 13 }
    ],
    shapes: [
      { id: 's1', kind: 'rounded-rect', x: 118, y: 146, width: 424, height: 60, fill: '#eaf3ef' }
    ]
  });

  let project = starterProject();
  let tool = 'select';
  let selected = null;
  let selection = [];      // 多选（框选 / Shift 加选）：[{ kind, id }]，selected 是其中的主对象
  let marquee = null;      // 正在拖出的框选矩形 { x0, y0, x1, y1, additive, moved }
  let hintedContainer = false;  // 「单击框内文字选中框图」的提示只弹一次
  let drag = null;
  let panDrag = null;      // 中键 / 空格 + 拖动 平移视图
  let spaceDown = false;
  let wireStart = null;
  let pointerPosition = { x: 0, y: 0 };
  let zoom = 1;
  let viewBox = { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H };
  let undoStack = [];
  let redoStack = [];
  let staleDraftDropped = false;   // 本地草稿比 HTML 文件旧（重新导出过）而被丢弃
  let idCounter = 20;
  let savedSnapshot = '';
  let toastTimer = null;

  // 「原图走线」层是否可见。导入 schematic 时，导线会同时以两种形式存在：
  //   * residual 层：从原理图原样搬过来的走线（忠实、漂亮，默认显示）
  //   * project.wires 里带 hidden 标记的自动走线（可选中/可编辑/参与网表）
  // 两者只显示其一，靠顶栏那个开关切换。
  let residualShown = true;

  function configureCanvasFile() {
    if (!canvasFile) return;
    document.body.classList.add('ucie-edit-mode');
    const htmlExportButton = $('#save-html');
    if (htmlExportButton) htmlExportButton.hidden = !window.CANVAS_FILE;
    // 残余几何：没有被拆成画布对象的线条 / 括号 / 曲线，垫在最底层
    const layer = $('#ucie-residual-layer');
    if (layer) {
      const NS_SVG = NS;
      for (const item of canvasFile.residual) {
        const path = document.createElementNS(NS_SVG, 'path');
        path.setAttribute('d', item.d);
        let style = `fill:${item.f || 'none'}`;
        if (item.s) style += `;stroke:${item.s};stroke-width:${item.w};stroke-linejoin:round;stroke-linecap:round`;
        if (item.da) style += `;stroke-dasharray:${item.da}`;
        path.setAttribute('style', style);
        if (item.ae) path.setAttribute('marker-end', 'url(#ucie-arrow)');
        if (item.ab) path.setAttribute('marker-start', 'url(#ucie-arrow)');
        layer.append(path);
      }
    }
    canvas.setAttribute('aria-label', `${canvasFile.title} 可编辑画布`);
    document.querySelector('.statusbar b').textContent = `${CANVAS_W} × ${CANVAS_H}`;
    // 来源信息挂在项目名上做成 tooltip（状态栏文字会被“保存状态”复用）
    const nameField = $('#project-name');
    if (nameField && canvasFile.source) nameField.title = `${canvasFile.source} · ${canvasFile.sheet || ''}`.trim();
    const paper = $('.canvas-paper');
    if (paper) paper.style.aspectRatio = `${CANVAS_W} / ${CANVAS_H}`;
    const toggle = $('#toggle-ucie-reference');
    toggle.hidden = !canvasFile.residual?.length;
    toggle.querySelector('span:last-child').textContent =
      `隐藏${canvasFile.residualLabel || '残余几何'}`;
    toggle.title = canvasFile.residualLabel
      ? `原图里的走线（忠实搬运）；关掉后可看到由引脚位置自动生成的走线`
      : 'Visio 里没被拆成画布对象的线条';
    // 打开别的画布 / 回到通用画布：独立画布文件可能不叫 ucie.html
    const sheetLink = $('#open-ucie-sheet');
    if (sheetLink) {
      sheetLink.href = './index.html';
      sheetLink.title = '返回通用电路画布';
      sheetLink.querySelector('span:last-child').textContent = '通用画布';
    }
    document.title = `${canvasFile.title} · 回路`;
    residualShown = toggle.getAttribute('aria-pressed') === 'true';
    toggle.addEventListener('click', () => {
      const visible = toggle.getAttribute('aria-pressed') === 'true';
      residualShown = !visible;
      if (layer) layer.style.display = visible ? 'none' : '';
      toggle.setAttribute('aria-pressed', String(!visible));
      const noun = canvasFile.residualLabel || '残余几何';
      toggle.querySelector('span:last-child').textContent = visible ? `显示${noun}` : `隐藏${noun}`;
      // 关掉原图走线后，要把隐藏的自动走线画出来（反之亦然）
      renderScene();
    });
  }

  /** 画布文件的初始图纸（Visio sheet 拆出来的可编辑对象）。 */
  const ucieDraft = () => validateProject(clone(canvasFile.draft));

  // 残余连线的端点 / 矩形角点：作为拖拽吸附点，让新元件能对齐到既有走线上。
  const ucieSnapPoints = canvasFile && Array.isArray(canvasFile.snap)
    ? canvasFile.snap.map(point => ({ x: point[0], y: point[1] }))
    : [];

  const clone = value => JSON.parse(JSON.stringify(value));
  const newId = prefix => `${prefix}${++idCounter}`;
  const snapshot = () => JSON.stringify({ project, idCounter, build: canvasFile ? canvasFile.build || '' : '' });
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  function saveHistory() {
    undoStack.push(snapshot());
    if (undoStack.length > 100) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $('#undo').disabled = undoStack.length === 0;
    $('#redo').disabled = redoStack.length === 0;
    $('#undo').classList.toggle('disabled', undoStack.length === 0);
    $('#redo').classList.toggle('disabled', redoStack.length === 0);
  }

  function undo() {
    if (!undoStack.length) return;
    redoStack.push(snapshot());
    restoreSnapshot(undoStack.pop());
    updateHistoryButtons();
    toast('已撤销');
  }

  function redo() {
    if (!redoStack.length) return;
    undoStack.push(snapshot());
    restoreSnapshot(redoStack.pop());
    updateHistoryButtons();
    toast('已重做');
  }

  function restoreSnapshot(raw) {
    const data = JSON.parse(raw);
    project = data.project;
    idCounter = data.idCounter;
    labelPreview = null;
    clearSelection();
    wireStart = null;
    renderAll();
    try { localStorage.setItem(draftStorageKey, snapshot()); } catch (_) { /* optional browser recovery */ }
  }

  function markSaved() {
    savedSnapshot = snapshot();
    updateSaveState();
    try { localStorage.setItem(draftStorageKey, savedSnapshot); } catch (_) { /* file:// storage may be unavailable */ }
  }

  function updateSaveState() {
    const unsaved = snapshot() !== savedSnapshot;
    $('#save-state').classList.toggle('unsaved', unsaved);
    $('#save-state span:last-child').textContent = unsaved ? '有未保存更改' : '本地草稿';
    $('#status-message').textContent = unsaved ? '记得导出项目 JSON 以保留更改' : '所有更改仅保存在此设备';
  }

  function changed() {
    renderAll();
    updateSaveState();
    try { localStorage.setItem(draftStorageKey, snapshot()); } catch (_) { /* optional browser recovery */ }
  }

  function toast(message) {
    const region = $('#toast-region');
    region.replaceChildren();
    const item = document.createElement('div');
    item.className = 'toast';
    item.textContent = message;
    region.append(item);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => item.remove(), 2300);
  }

  function svgElement(name, attrs = {}) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, String(value));
    return node;
  }

  // ── 选择集 ──────────────────────────────────────────────────────────────
  // selected 仍然是「主对象」（检查器、控制点用它），selection 是全部选中的对象，
  // 支持拖框多选、Shift 加选、整组拖动与批量删除（与 Visio 的框选一致）。
  const isSelected = (kind, id) => selection.some(item => item.kind === kind && item.id === id);

  /** 只选中一个对象。是否重绘由调用方决定（调用方通常紧接着就 renderAll）。 */
  function selectOne(kind, id) {
    selection = [{ kind, id }];
    selected = selection[0];
  }

  function setSelection(items) {
    selection = items;
    selected = selection[0] || null;
  }

  function clearSelection() {
    selection = [];
    selected = null;
  }

  /** Shift + 点选：已选中就取消，否则加进选择集。 */
  function toggleSelectOne(kind, id) {
    if (isSelected(kind, id)) setSelection(selection.filter(item => !(item.kind === kind && item.id === id)));
    else setSelection([...selection, { kind, id }]);
  }

  /**
   * 对象在画布坐标里的包围盒：框选命中判与整体轮廓线都用它。
   * 纯模型计算（不量 DOM），所以拖动时每帧调也不卡。
   */
  function objectBox(kind, id) {
    if (kind === 'shape') {
      const shape = project.shapes.find(item => item.id === id);
      return shape ? { x: shape.x, y: shape.y, width: Math.abs(shape.width), height: Math.abs(shape.height) } : null;
    }
    if (kind === 'text') {
      const text = project.texts.find(item => item.id === id);
      if (!text) return null;
      const size = Number(text.size) || 18;
      const width = Math.max(size, String(text.text || '').length * size * 0.6);
      const anchor = text.anchor === 'middle' ? -0.5 : text.anchor === 'end' ? -1 : 0;
      return { x: text.x + width * anchor, y: text.y - size * 0.9, width, height: size * 1.3 };
    }
    if (kind === 'component') {
      const component = project.components.find(item => item.id === id);
      if (!component) return null;
      const spec = partSpecs[component.type];
      let box;
      if (component.type === 'ruler') {
        const span = rulerSpanOf(component);
        box = [-span / 2 - 6, -26, span + 12, 52];
      } else if (FIGURE_TYPES.has(component.type)) {
        const { w, h } = figureSize(component);
        box = [-w / 2 - 5, -h / 2 - 5, w + 10, h + 10];
      } else if (Number(component.w) > 0 && Number(component.h) > 0) {
        // 黑盒单元：尺寸随实例（引脚多的就高）
        box = [-component.w / 2, -component.h / 2, component.w, component.h];
      } else if (spec?.box) {
        box = spec.box;
      } else {
        box = [-(spec?.width || 40) / 2, -(spec?.height || 40) / 2, spec?.width || 40, spec?.height || 40];
      }
      // 四角按旋转 + 镜像变换到画布坐标，再取外接矩形
      const angle = (component.rotation || 0) * Math.PI / 180;
      const mirror = component.flip === 'x' ? -1 : 1;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      const points = [
        [box[0], box[1]], [box[0] + box[2], box[1]],
        [box[0], box[1] + box[3]], [box[0] + box[2], box[1] + box[3]]
      ].map(([bx, by]) => ({
        x: component.x + bx * mirror * cos - by * sin,
        y: component.y + bx * mirror * sin + by * cos
      }));
      const xs = points.map(point => point.x);
      const ys = points.map(point => point.y);
      return {
        x: Math.min(...xs), y: Math.min(...ys),
        width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys)
      };
    }
    return null;
  }

  const boxesOverlap = (a, b) => !(a.x + a.width < b.x || b.x + b.width < a.x || a.y + a.height < b.y || b.y + b.height < a.y);

  /** 若干包围盒的合并范围。 */
  function unionBox(boxes) {
    const list = boxes.filter(Boolean);
    if (!list.length) return null;
    const left = Math.min(...list.map(box => box.x));
    const top = Math.min(...list.map(box => box.y));
    const right = Math.max(...list.map(box => box.x + box.width));
    const bottom = Math.max(...list.map(box => box.y + box.height));
    return { x: left, y: top, width: right - left, height: bottom - top };
  }

  /** 框选：与选框相交的元件 / 图形 / 文字（keep 里的对象保持不变，用于 Shift 加选）。 */
  function itemsInBox(box, keep = []) {
    const found = keep.map(item => ({ kind: item.kind, id: item.id }));
    const add = (kind, id) => {
      if (!found.some(item => item.kind === kind && item.id === id)) found.push({ kind, id });
    };
    for (const component of project.components) {
      const box2 = objectBox('component', component.id);
      if (box2 && boxesOverlap(box2, box)) add('component', component.id);
    }
    for (const shape of project.shapes) {
      const box2 = objectBox('shape', shape.id);
      if (box2 && boxesOverlap(box2, box)) add('shape', shape.id);
    }
    for (const text of project.texts) {
      const box2 = objectBox('text', text.id);
      if (box2 && boxesOverlap(box2, box)) add('text', text.id);
    }
    return found;
  }

  const marqueeBox = () => (marquee ? {
    x: Math.min(marquee.x0, marquee.x1),
    y: Math.min(marquee.y0, marquee.y1),
    width: Math.abs(marquee.x1 - marquee.x0),
    height: Math.abs(marquee.y1 - marquee.y0)
  } : null);

  const pointInBox = (point, box) => point.x >= box.x && point.x <= box.x + box.width && point.y >= box.y && point.y <= box.y + box.height;

  /**
   * 光标下所有可选对象，从最上层到最下层：元件 > 文字 > 图形。
   * 用于 Ctrl+点击的「穿透选择」——Visio 里可以用 Alt+点击选到被挡住的对象，
   * 我们这里用 Ctrl（Alt 已被平移占用）。
   */
  function candidatesAt(point) {
    const list = [];
    const collect = (kind, items) => {
      for (const item of items) {
        const box = objectBox(kind, item.id);
        if (box && pointInBox(point, box)) list.push({ kind, id: item.id });
      }
    };
    collect('component', project.components);
    collect('text', project.texts);
    collect('shape', project.shapes);
    return list;
  }

  /** Ctrl / Cmd + 点击：每点一次就穿到下层去，循环。 */
  function cycleSelectionAt(point) {
    const list = candidatesAt(point);
    if (!list.length) { clearSelection(); return; }
    const labels = { component: '元件', shape: '图形', text: '文字' };
    const index = list.findIndex(item => isSelected(item.kind, item.id));
    const atEnd = index === list.length - 1;
    const next = list[(index + 1) % list.length];
    setSelection([next]);
    toast(atEnd ? `已回到最上层：${labels[next.kind]}` : `已穿透选中下方${labels[next.kind]} · 继续 Ctrl+点击往下`);
  }

  /** 图形拖动时，框内文字跟着走（Visio 里框图与框内文字属于同一个形状）。 */
  function containedTextSnapshot(shape) {
    const box = objectBox('shape', shape.id);
    if (!box) return [];
    return project.texts.reduce((list, text) => {
      const b = objectBox('text', text.id);
      if (b && pointInBox({ x: b.x + b.width / 2, y: b.y + b.height / 2 }, box)) list.push({ id: text.id, x: text.x, y: text.y });
      return list;
    }, []);
  }

  /** 文字落在哪个图形里（取最上面那个包含它中心的图形）。
   * Visio 里框图与框内文字是同一个形状，所以单击框内文字优先选中该框图。
   */
  function containerShapeFor(box) {
    if (!box) return null;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    let found = null;
    for (const shape of project.shapes) {
      if (shape.kind === 'line') continue;
      const b = objectBox('shape', shape.id);
      if (b && cx >= b.x && cx <= b.x + b.width && cy >= b.y && cy <= b.y + b.height) found = shape;
    }
    return found;
  }

  /** 记下当前选中对象的初始坐标：整组拖动时统一加同一个位移。 */
  function groupSnapshot() {
    return selection.map(item => {
      const list = item.kind === 'component' ? project.components
        : item.kind === 'shape' ? project.shapes : project.texts;
      const found = list.find(entry => entry.id === item.id);
      return found ? { kind: item.kind, id: item.id, x: found.x, y: found.y } : null;
    }).filter(Boolean);
  }

  function pinPosition(component, index) {
    const pin = effectivePins(component)[index];
    if (!pin) return { x: component.x, y: component.y };
    const angle = (component.rotation || 0) * Math.PI / 180;
    // 水平镜像作用在旋转之前：先翻引脚横坐标，再整体旋转。
    const px = component.flip === 'x' ? -pin.x : pin.x;
    return {
      x: component.x + px * Math.cos(angle) - pin.y * Math.sin(angle),
      y: component.y + px * Math.sin(angle) + pin.y * Math.cos(angle)
    };
  }

  // 走线折法由 wire.mode 决定（导入的图纸会带这个字段，手画的默认 'h'）：
  //   'h'   横平优先（先横后竖，中间拐两次 = Z 形）—— 默认
  //   'v'   竖直优先（先竖后横，Z 形）
  //   'hl'  一个拐角：先横到 b 的列、再竖到 b（L 形，最像手画）
  //   'lv'  一个拐角：先竖到 b 的行、再横到 b（L 形）
  //   'h-'/'h+'  先横走再上下绕行（两端本来就同排、必须让开元件时用）
  //   'v-'/'v+'  先竖走再左右绕行
  const WIRE_JOG = 30;
  function pathBetween(a, b, mode) {
    const flatX = Math.abs(a.x - b.x) < 2;
    const flatY = Math.abs(a.y - b.y) < 2;
    if (flatX && flatY) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    if (mode === 'hl') return `M ${a.x} ${a.y} L ${b.x} ${a.y} L ${b.x} ${b.y}`;
    if (mode === 'lv') return `M ${a.x} ${a.y} L ${a.x} ${b.y} L ${b.x} ${b.y}`;
    if (mode === 'h-' || mode === 'h+') {
      const x0 = Math.round(mode === 'h-' ? Math.min(a.x, b.x) - WIRE_JOG : Math.max(a.x, b.x) + WIRE_JOG);
      return `M ${a.x} ${a.y} L ${x0} ${a.y} L ${x0} ${b.y} L ${b.x} ${b.y}`;
    }
    if (mode === 'v-' || mode === 'v+') {
      const y0 = Math.round(mode === 'v-' ? Math.min(a.y, b.y) - WIRE_JOG : Math.max(a.y, b.y) + WIRE_JOG);
      return `M ${a.x} ${a.y} L ${a.x} ${y0} L ${b.x} ${y0} L ${b.x} ${b.y}`;
    }
    if (flatX || flatY) return `M ${a.x} ${a.y} L ${b.x} ${b.y}`;
    if (mode === 'v') {
      const midY = Math.round((a.y + b.y) / 2);
      return `M ${a.x} ${a.y} L ${a.x} ${midY} L ${b.x} ${midY} L ${b.x} ${b.y}`;
    }
    const midX = Math.round((a.x + b.x) / 2);
    return `M ${a.x} ${a.y} L ${midX} ${a.y} L ${midX} ${b.y} L ${b.x} ${b.y}`;
  }

  // ── 落点吸引与对齐参考线 ─────────────────────────────────────────────────
  // UCIe 模式按 Visio 的 1/8 英寸网格（0.125 in × 72 = 9）落点，便于手工微调。
  const GRID = canvasFile ? 9 : 10;
  const ZOOM_MIN = canvasFile ? 0.2 : 0.35;
  const ZOOM_MAX = canvasFile ? 6 : 2.4;
  const GUIDE_TOLERANCE = 6; // 屏幕像素：对齐另一元件的磁性范围
  const PIN_TOLERANCE = 15;  // 屏幕像素：连线时引脚磁吸范围
  const DRAG_THRESHOLD = 3;  // 屏幕像素：小于该位移视为点击
  let guides = [];

  const snapToGrid = value => Math.round(value / GRID) * GRID;

  /** 一个屏幕像素等于多少画布单位，把磁吸范围换算到当前视图比例。 */
  const canvasUnitsPerPixel = () => {
    const rect = canvas.getBoundingClientRect();
    return rect.width ? viewBox.width / rect.width : 1;
  };

  /** 元件的对齐锚点：原点 + 每个引脚在画布上的位置。 */
  function alignmentAnchors(component, x, y, rotation, flip) {
    const type = component.type;
    const spec = partSpecs[type];
    if (!spec) return [{ x, y }];
    const turned = rotation === undefined ? (component.rotation || 0) : rotation;
    const mirrored = flip === undefined ? component.flip : flip;
    const angle = (turned || 0) * Math.PI / 180;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const mirror = mirrored === 'x' ? -1 : 1;
    return [{ x, y }, ...effectivePins(component).map(pin => ({
      x: x + pin.x * mirror * cos - pin.y * sin,
      y: y + pin.x * mirror * sin + pin.y * cos
    }))];
  }

  /** 图形的对齐锚点：四角、四边中点与中心。 */
  function shapeAnchors(shape) {
    const { x, y, width: w, height: h } = shape;
    return [
      { x, y }, { x: x + w / 2, y }, { x: x + w, y },
      { x, y: y + h / 2 }, { x: x + w / 2, y: y + h / 2 }, { x: x + w, y: y + h / 2 },
      { x, y: y + h }, { x: x + w / 2, y: y + h }, { x: x + w, y: y + h }
    ];
  }

  /** 画布上所有可对齐的锚点：其它元件、其它图形，以及画布中线。 */
  function sceneAnchors(skipId) {
    const points = [];
    for (const component of project.components) {
      if (component.id === skipId) continue;
      points.push(...alignmentAnchors(component, component.x, component.y));
    }
    for (const shape of project.shapes) {
      if (shape.id === skipId) continue;
      points.push(...shapeAnchors(shape));
    }
    // UCIe 编辑模式：残余连线的端点 / 矩形角点也能吸附，方便新元件接到既有线上
    if (ucieSnapPoints.length) points.push(...ucieSnapPoints);
    points.push({ x: CANVAS_W / 2, y: CANVAS_H / 2 });
    return points;
  }

  /**
   * 把一组锚点吸到场景里的对齐线上，并把参考线写进 guides。
   * anchorsAt 用于在吸附后的位置重新取锚点，以便算出参考线的跨度。
   */
  function resolveAlignment(moving, others, x, y, anchorsAt) {
    const tolerance = GUIDE_TOLERANCE * canvasUnitsPerPixel();
    const pick = key => {
      let best = null;
      for (const anchor of moving) {
        for (const target of others) {
          const delta = target[key] - anchor[key];
          if (Math.abs(delta) <= tolerance && (!best || Math.abs(delta) < Math.abs(best.delta))) {
            best = { delta, value: target[key] };
          }
        }
      }
      return best;
    };

    const onX = pick('x');
    const onY = pick('y');
    const alignedX = onX ? x + onX.delta : x;
    const alignedY = onY ? y + onY.delta : y;

    guides = [];
    const all = [...anchorsAt(alignedX, alignedY), ...others];
    const span = (key, value) => {
      const cross = key === 'x' ? 'y' : 'x';
      const hits = all.filter(point => Math.abs(point[key] - value) < 0.5);
      if (hits.length < 2) return null;
      const offsets = hits.map(point => point[cross]);
      const from = Math.min(...offsets) - 18;
      const to = Math.max(...offsets) + 18;
      return key === 'x'
        ? { x1: value, y1: from, x2: value, y2: to }
        : { x1: from, y1: value, x2: to, y2: value };
    };
    if (onX) { const line = span('x', onX.value); if (line) guides.push(line); }
    if (onY) { const line = span('y', onY.value); if (line) guides.push(line); }
    return { x: alignedX, y: alignedY, guidedX: !!onX, guidedY: !!onY };
  }

  /** 元件吸附。 */
  function alignComponent(component, x, y) {
    const at = (px, py) => alignmentAnchors(component, px, py);
    return resolveAlignment(at(x, y), sceneAnchors(component.id), x, y, at);
  }

  /** 图形吸附。 */
  function alignShape(shape, x, y) {
    const at = (px, py) => shapeAnchors(Object.assign({}, shape, { x: px, y: py }));
    return resolveAlignment(at(x, y), sceneAnchors(shape.id), x, y, at);
  }

  /** 距离给定画布坐标最近的引脚，用于连线磁吸。 */
  function nearestPin(point, skip) {
    const tolerance = PIN_TOLERANCE * canvasUnitsPerPixel();
    let best = null;
    for (const component of project.components) {
      effectivePins(component).forEach((pin, index) => {
        if (skip && skip.component === component.id && skip.pin === index) return;
        const position = pinPosition(component, index);
        const distance = Math.hypot(position.x - point.x, position.y - point.y);
        if (distance <= tolerance && (!best || distance < best.distance)) {
          best = { component, index, x: position.x, y: position.y, distance };
        }
      });
    }
    return best;
  }

  /** 高亮将被吸附的引脚。 */
  function highlightSnapPin(target) {
    $$('.pin.snap').forEach(node => node.classList.remove('snap'));
    if (!target) return;
    const node = componentLayer.querySelector(`[data-component-id="${target.component.id}"] [data-pin="${target.index}"] .pin`);
    if (node) node.classList.add('snap');
  }

  // ── 图形标注 ─────────────────────────────────────────────────────────────
  // 图形用包围盒描述：x/y 是左上角，width/height 是尺寸（拖绘时已归一为正）。
  // 缩放只改这四个数，所以任意多边形都能自由拉伸。
  const SHAPE_MIN = 12;
  const SHAPE_HANDLES = [
    ['nw', 0, 0], ['n', 0.5, 0], ['ne', 1, 0],
    ['w', 0, 0.5], ['e', 1, 0.5],
    ['sw', 0, 1], ['s', 0.5, 1], ['se', 1, 1]
  ];
  const SHAPE_KINDS = {
    rectangle: ['矩形', 'Rectangle'],
    image: ['图片', 'Image'],
    'rounded-rect': ['圆角矩形', 'Rounded rectangle'],
    'dashed-rect': ['虚线框', 'Dashed frame'],
    freeform: ['自由路径', 'Freeform path'],
    'free-line': ['自由直线', 'Free line'],
    'free-curve': ['自由曲线', 'Free curve'],
    ellipse: ['椭圆 / 圆', 'Ellipse / circle'],
    triangle: ['三角形', 'Triangle'],
    'right-triangle': ['直角三角形', 'Right triangle'],
    diamond: ['菱形', 'Diamond'],
    parallelogram: ['平行四边形', 'Parallelogram'],
    trapezoid: ['梯形', 'Trapezoid'],
    pentagon: ['五边形', 'Pentagon'],
    hexagon: ['六边形', 'Hexagon'],
    octagon: ['八边形', 'Octagon'],
    star: ['五角星', 'Star'],
    cross: ['十字', 'Cross'],
    arrow: ['箭头', 'Arrow'],
    'arrow-double': ['双向箭头', 'Double-headed arrow'],
    line: ['直线', 'Line']
  };
  let shapeKind = 'rectangle';
  const nextShapeOrder = () => project.shapes.reduce((order, shape) => Math.max(order, Number(shape.order) || 0), 0) + 1;

  // 图形填充：'none' 表示无填充（透明），其余是十六进制色值。
  // 用内联 style 写 fill，而不是 fill 属性——presentation 属性优先级最低，
  // 会被 styles.css 里的 `.shape-group .shape{fill:none}` 覆盖。
  const SHAPE_FILL_NONE = 'none';
  const SHAPE_FILLS = [
    ['none', '无填充（透明）'], ['#ffffff', '白色'], ['#eef2ef', '浅灰'], ['#cfd9d3', '灰色'],
    ['#eaf3ef', '浅绿'], ['#c9e3d7', '浅青绿'], ['#7fbea5', '青绿'], ['#246e5b', '深绿'],
    ['#f7ece3', '浅橙'], ['#eed3c0', '浅砖'], ['#c8734a', '砖红'], ['#8d4a2c', '深棕'],
    ['#e8eff5', '浅蓝'], ['#c8dcea', '浅钢蓝'], ['#4f81a8', '钢蓝'], ['#26496b', '深蓝'],
    ['#faf1d6', '浅黄'], ['#f0e0ae', '米黄'], ['#f6e4e2', '浅红'], ['#dfb3ae', '浅玫红'],
    ['#b6473f', '正红'], ['#4a6157', '墨绿灰'], ['#2b3330', '近黑']
  ];
  const isHexColor = value => typeof value === 'string' && /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(value);
  const sanitizeShapeFill = value => (value === SHAPE_FILL_NONE || isHexColor(value) ? String(value).toLowerCase() : SHAPE_FILL_NONE);
  const shapeFillStyle = (kind, fill) => (kind === 'line' || sanitizeShapeFill(fill) === SHAPE_FILL_NONE ? '' : ` style="fill:${sanitizeShapeFill(fill)}"`);
  /**
   * 图形内联样式：填充之外还支持可选的描边色 (stroke) 与线宽 (sw)，
   * UCIe 编辑模式用它们还原 Visio 里的黑色 / 蓝色细线。
   */
  function shapeStyleAttr(shape) {
    const parts = [];
    if (shape.kind !== 'line' && sanitizeShapeFill(shape.fill) !== SHAPE_FILL_NONE) parts.push(`fill:${sanitizeShapeFill(shape.fill)}`);
    if (isHexColor(shape.stroke)) parts.push(`stroke:${String(shape.stroke).toLowerCase()}`);
    else if (shape.strokeNone) parts.push('stroke:none');
    const sw = Number(shape.sw);
    if (Number.isFinite(sw) && sw > 0) parts.push(`stroke-width:${sw}`);
    return parts.length ? ` style="${parts.join(';')}"` : '';
  }
  let shapeFill = SHAPE_FILL_NONE; // 记住上次用过的填充色，新建图形沿用
  let fillPreview = null; // 取色器拖拽中的原始填充色（仅在首次 input 时记一次撤销点）
  let labelPreview = null;

  const round2 = value => Math.round(value * 100) / 100;

  function polygonPath(cx, cy, rx, ry, sides, startAngle) {
    const points = [];
    for (let index = 0; index < sides; index += 1) {
      const angle = startAngle + (index * 2 * Math.PI) / sides;
      points.push(`${round2(cx + rx * Math.cos(angle))} ${round2(cy + ry * Math.sin(angle))}`);
    }
    return `M ${points.join(' L ')} Z`;
  }

  function starPath(cx, cy, rx, ry, points = 5) {
    const list = [];
    for (let index = 0; index < points * 2; index += 1) {
      const angle = -Math.PI / 2 + (index * Math.PI) / points;
      const scale = index % 2 ? 0.382 : 1;
      list.push(`${round2(cx + rx * scale * Math.cos(angle))} ${round2(cy + ry * scale * Math.sin(angle))}`);
    }
    return `M ${list.join(' L ')} Z`;
  }

  function arrowPath(x, y, w, h, both) {
    const middle = y + h / 2;
    const shaft = h * 0.42;
    const top = y + (h - shaft) / 2;
    const bottom = y + (h + shaft) / 2;
    const head = Math.min(w * (both ? 0.34 : 0.42), h * 0.85);
    if (!both) {
      return `M ${round2(x)} ${round2(top)} L ${round2(x + w - head)} ${round2(top)} L ${round2(x + w - head)} ${round2(y)} L ${round2(x + w)} ${round2(middle)} L ${round2(x + w - head)} ${round2(y + h)} L ${round2(x + w - head)} ${round2(bottom)} L ${round2(x)} ${round2(bottom)} Z`;
    }
    const leftBase = x + head;
    const rightBase = x + w - head;
    return `M ${round2(x)} ${round2(middle)} L ${round2(leftBase)} ${round2(y)} L ${round2(leftBase)} ${round2(top)} L ${round2(rightBase)} ${round2(top)} L ${round2(rightBase)} ${round2(y)} L ${round2(x + w)} ${round2(middle)} L ${round2(rightBase)} ${round2(y + h)} L ${round2(rightBase)} ${round2(bottom)} L ${round2(leftBase)} ${round2(bottom)} L ${round2(leftBase)} ${round2(y + h)} Z`;
  }

  function crossPath(x, y, w, h) {
    const halfW = w * 0.17;
    const halfH = h * 0.17;
    const left = x + w / 2 - halfW;
    const right = x + w / 2 + halfW;
    const top = y + h / 2 - halfH;
    const bottom = y + h / 2 + halfH;
    return `M ${round2(left)} ${round2(y)} L ${round2(right)} ${round2(y)} L ${round2(right)} ${round2(top)} L ${round2(x + w)} ${round2(top)} L ${round2(x + w)} ${round2(bottom)} L ${round2(right)} ${round2(bottom)} L ${round2(right)} ${round2(y + h)} L ${round2(left)} ${round2(y + h)} L ${round2(left)} ${round2(bottom)} L ${round2(x)} ${round2(bottom)} L ${round2(x)} ${round2(top)} L ${round2(left)} ${round2(top)} Z`;
  }

  /** 图形轮廓；所有形状都画在同一个包围盒里，便于统一缩放。 */
  function shapePath(kind, x, y, w, h) {
    const cx = x + w / 2;
    const cy = y + h / 2;
    switch (kind) {
      case 'triangle': return `M ${round2(cx)} ${round2(y)} L ${round2(x + w)} ${round2(y + h)} L ${round2(x)} ${round2(y + h)} Z`;
      case 'right-triangle': return `M ${round2(x)} ${round2(y)} L ${round2(x)} ${round2(y + h)} L ${round2(x + w)} ${round2(y + h)} Z`;
      case 'diamond': return `M ${round2(cx)} ${round2(y)} L ${round2(x + w)} ${round2(cy)} L ${round2(cx)} ${round2(y + h)} L ${round2(x)} ${round2(cy)} Z`;
      case 'parallelogram': {
        const skew = w * 0.2;
        return `M ${round2(x + skew)} ${round2(y)} L ${round2(x + w)} ${round2(y)} L ${round2(x + w - skew)} ${round2(y + h)} L ${round2(x)} ${round2(y + h)} Z`;
      }
      case 'trapezoid': {
        const inset = w * 0.22;
        return `M ${round2(x + inset)} ${round2(y)} L ${round2(x + w - inset)} ${round2(y)} L ${round2(x + w)} ${round2(y + h)} L ${round2(x)} ${round2(y + h)} Z`;
      }
      case 'pentagon': return polygonPath(cx, cy, w / 2, h / 2, 5, -Math.PI / 2);
      case 'hexagon': return polygonPath(cx, cy, w / 2, h / 2, 6, 0);
      case 'octagon': return polygonPath(cx, cy, w / 2, h / 2, 8, Math.PI / 8);
      case 'star': return starPath(cx, cy, w / 2, h / 2, 5);
      case 'cross': return crossPath(x, y, w, h);
      case 'arrow': return arrowPath(x, y, w, h, false);
      case 'arrow-double': return arrowPath(x, y, w, h, true);
      case 'line': return `M ${round2(x)} ${round2(y)} L ${round2(x + w)} ${round2(y + h)}`;
      default: return '';
    }
  }

  // ── 标尺 ────────────────────────────────────────────────────────────────
  // 标尺的画布长度 = 长度 × 比例；属性面板里可改「长度 / 比例 / 单位」。
  const RULER_LENGTH = 100;
  const RULER_SCALE = 1.5;
  const RULER_MIN_LENGTH = 0.001;
  const RULER_STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 50000];

  const rulerLengthOf = component => clamp(Number(component?.length) || RULER_LENGTH, RULER_MIN_LENGTH, 100000);
  const rulerScaleOf = component => Math.max(0.01, Number(component?.scale) || RULER_SCALE);
  const rulerSpanOf = component => Math.max(0.000001, rulerLengthOf(component) * rulerScaleOf(component));
  const rulerUnitOf = component => (component?.unit ? String(component.unit).slice(0, 8) : '');

  /** 刻度步长：保证相邻刻度在画布上至少间隔 7 个单位。 */
  function rulerStepOf(component) {
    const scale = rulerScaleOf(component);
    for (const step of RULER_STEPS) if (step * scale >= 7) return step;
    return RULER_STEPS[RULER_STEPS.length - 1];
  }

  /** 标尺图形：细基线 + 主次刻度 + 数值标注。 */
  function rulerMarkup(component) {
    const span = rulerSpanOf(component);
    const half = span / 2;
    const scale = rulerScaleOf(component);
    const total = rulerLengthOf(component);
    const step = rulerStepOf(component);
    const unit = rulerUnitOf(component);
    const displayTotal = Number.isInteger(total) ? String(total) : String(Number(total.toPrecision(8)));
    const out = [];
    const hitSpan = Math.max(span, 16 * canvasUnitsPerPixel());
    out.push(`<rect class="ruler-hit" x="${round2(-hitSpan / 2)}" y="-12" width="${round2(hitSpan)}" height="24"/>`);
    out.push(`<line class="ruler-axis" x1="${round2(-half)}" y1="0" x2="${round2(half)}" y2="0"/>`);
    let index = 0;
    for (let value = 0; value <= total + step * 1e-3 && index < 400; value += step) {
      const x = round2(-half + value * scale);
      const major = index % 5 === 0;
      out.push(`<line class="ruler-tick${major ? ' major' : ''}" x1="${x}" y1="0" x2="${x}" y2="${major ? 8 : 4}"/>`);
      index += 1;
    }
    out.push(`<line class="ruler-tick major" x1="${round2(half)}" y1="0" x2="${round2(half)}" y2="8"/>`);
    out.push(`<text class="ruler-label" x="0" y="-8" text-anchor="middle">${escapeHtml(`${displayTotal}${unit ? ' ' + unit : ''}`)}</text>`);
    return out.join('');
  }

  /** 标尺两端各有一个引脚，便于把尺子对齐/挂到别的元件上。 */
  function effectivePins(component) {
    if (!component) return [];
    if (component.type === 'ruler') {
      const half = rulerSpanOf(component) / 2;
      return [{ name: '1', x: -half, y: 0 }, { name: '2', x: half, y: 0 }];
    }
    // 黑盒单元：引脚随实例（每个 cell 的端子名和数量都不同）
    if (Array.isArray(component.pins)) return component.pins;
    return partSpecs[component.type]?.pins || [];
  }

  // 标尺拖拽缩放：拖任一端的手柄，另一端固定不动，鼠标在尺身轴线上的投影
  // 就是新的画布长度，再按「比例」换算回刻度值写进 length。
  const RULER_MAX_SPAN = 100000;
  /** 选中标尺时，在尺身两端各画一个方形控制点。 */
  function appendRulerHandles(component) {
    const size = 9 * canvasUnitsPerPixel();
    [0, 1].forEach(index => {
      const point = pinPosition(component, index);
      const node = svgElement('rect', {
        x: round2(point.x - size / 2), y: round2(point.y - size / 2),
        width: round2(size), height: round2(size),
        class: 'ruler-handle', 'data-ruler-handle': index, 'data-component-id': component.id
      });
      node.addEventListener('pointerdown', event => beginRulerResize(event, component, index));
      // 竖尺用上下箭头光标，横尺用左右箭头
      const angle = ((component.rotation || 0) % 180 + 180) % 180;
      node.style.cursor = angle > 45 && angle < 135 ? 'ns-resize' : 'ew-resize';
      interactionLayer.append(node);
    });
  }

  /** 开始拖拽标尺端点：记下固定端与尺身方向向量。 */
  function beginRulerResize(event, component, index) {
    if (tool !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    selectOne('component', component.id);
    saveHistory();
    const angle = (component.rotation || 0) * Math.PI / 180;
    const mirror = component.flip === 'x' ? -1 : 1;
    // 1 号引脚在局部 +half，乘 sign 后得到「从中心指向被拖那一端」的方向
    const sign = index === 1 ? 1 : -1;
    const dirX = mirror * Math.cos(angle) * sign;
    const dirY = mirror * Math.sin(angle) * sign;
    const half = rulerSpanOf(component) / 2;
    drag = {
      kind: 'ruler-resize', id: component.id, moved: false,
      dirX, dirY,
      fixed: { x: component.x - dirX * half, y: component.y - dirY * half },
      scale: rulerScaleOf(component)
    };
    canvas.setPointerCapture(event.pointerId);
    renderScene();
  }

  // ── 函数曲线 / 概率分布 / 数字波形 ──────────────────────────────────────
  // 这三种是「参数化图元」：几何完全由参数算出来，不依赖上游符号数据，
  // 和标尺一样在 symbolMarkup 里单独分支。
  const FIGURE_TYPES = new Set(['math-curve', 'prob-curve', 'digital-wave',
    'digital-wave-clock', 'digital-wave-signal', 'digital-wave-bus']);
  const isWaveType = type => String(type).startsWith('digital-wave');

  /** 数学函数：输入 x ∈ [0,1]，输出归一到 [-1,1]；k 是频率 / 陡度参数。 */
  const CURVE_FUNCS = {
    sin: { label: 'sin', f: (x, k) => Math.sin(2 * Math.PI * k * x) },
    cos: { label: 'cos', f: (x, k) => Math.cos(2 * Math.PI * k * x) },
    square: { label: '方波 sq', f: (x, k) => (((x * k) % 1) + 1) % 1 < 0.5 ? 1 : -1 },
    triangle: { label: '三角波', f: (x, k) => 4 * Math.abs((((x * k + 0.25) % 1) + 1) % 1 - 0.5) - 1 },
    saw: { label: '锯齿波', f: (x, k) => 2 * ((((x * k + 0.5) % 1) + 1) % 1) - 1 },
    expdecay: { label: '指数衰减', f: (x, k) => Math.exp(-3 * k * x) },
    logistic: { label: 'S 形 logistic', f: (x, k) => 1 / (1 + Math.exp(-10 * k * (x - 0.5))) },
    sinc: { label: 'sinc', f: (x, k) => { const t = (x - 0.5) * 8 * k; return Math.abs(t) < 1e-6 ? 1 : Math.sin(t) / t; } },
    parabola: { label: '抛物线', f: (x, k) => 1 - 2 * Math.pow((x - 0.5) * 2, 2) / Math.max(k, 0.5) },
    step: { label: '阶跃', f: x => (x < 0.5 ? -1 : 1) },
    ramp: { label: '斜坡', f: x => 2 * x - 1 },
    dampsin: { label: '衰减振荡', f: (x, k) => Math.exp(-3.5 * x) * Math.sin(2 * Math.PI * k * 2 * x) }
  };

  /** 概率分布：输入 t ∈ [-1,1]；含离散分布（画竖棒）。 */
  const DIST_FUNCS = {
    normal: { label: '正态 / 高斯', f: (t, k) => Math.exp(-Math.pow(t * 3 * k, 2) / 2) },
    uniform: { label: '均匀分布', f: t => (Math.abs(t) <= 0.6 ? 1 : 0) },
    exponential: { label: '指数分布', f: (t, k) => Math.exp(-(t + 1) * 2.2 * k) },
    rayleigh: { label: '瑞利分布', f: (t, k) => { const u = (t + 1) / 2; return u * Math.exp(-u * u * k * k * 2); } },
    lognormal: { label: '对数正态', f: (t, k) => { const u = (t + 1) / 2; return u < 1e-6 ? 0 : Math.exp(-Math.pow(Math.log(u * 4 + 0.02), 2) * k * k * 3) / (u * 4 + 0.02); } },
    binomial: { label: '二项分布 n=8', discrete: 9, f: (i, k) => { const n = 8; const p = clamp(0.5 + (k - 1) * 0.12, 0.05, 0.95); const c = [1, 8, 28, 56, 70, 56, 28, 8, 1][i]; return c * Math.pow(p, i) * Math.pow(1 - p, n - i); } },
    poisson: { label: '泊松分布 λ=3', discrete: 9, f: (i, k) => { const lam = clamp(3 * k, 0.3, 8); let fact = 1; for (let j = 2; j <= i; j += 1) fact *= j; return Math.pow(lam, i) * Math.exp(-lam) / fact; } }
  };

  const WAVE_KINDS = {
    clock: '时钟 clock',
    signal: '信号 data',
    bus: '总线 bus',
    strobe: '脉冲 strobe'
  };

  const figureSize = component => ({
    w: clamp(Number(component?.w) || partSpecs[component?.type]?.width || 150, 40, 2000),
    h: clamp(Number(component?.h) || partSpecs[component?.type]?.height || 96, 30, 1200)
  });

  /** 参数化图元落到画布时先填好默认参数。 */
  function applyFigureDefaults(target) {
    if (!FIGURE_TYPES.has(target.type)) return target;
    const spec = partSpecs[target.type];
    target.w = Number(target.w) || spec.width;
    target.h = Number(target.h) || spec.height;
    target.k = Number(target.k) || 1;
    if (target.type === 'math-curve') target.fn = CURVE_FUNCS[target.fn] ? target.fn : 'sin';
    if (target.type === 'prob-curve') target.dist = DIST_FUNCS[target.dist] ? target.dist : 'normal';
    if (isWaveType(target.type)) {
      target.kind = WAVE_KINDS[target.kind] ? target.kind : (spec.waveKind || 'clock');
      target.cycles = Number(target.cycles) || 4;
      target.duty = Number(target.duty) || 50;
      target.pattern = String(target.pattern || (target.kind === 'bus' ? 'D0 D1 D2' : '1011'));
    }
    return target;
  }

  /** 采样成 SVG 折线。 */
  function curvePoints(sample, left, w, top, h) {
    const out = [];
    for (let i = 0; i <= 120; i += 1) {
      const x = i / 120;
      const value = clamp(sample(x), -1.15, 1.15);
      out.push(`${round2(left + x * w)} ${round2(top + h * (1 - (value + 1) / 2))}`);
    }
    return out.join(' ');
  }

  /** 函数曲线：图框 + 中轴 + 采样折线。 */
  function curveMarkup(component) {
    const { w, h } = figureSize(component);
    const fn = CURVE_FUNCS[component?.fn] ? component.fn : 'sin';
    const k = clamp(Number(component?.k) || 1, 0.2, 8);
    const left = -w / 2;
    const top = -h / 2;
    const out = [];
    out.push(`<rect class="figure-frame" x="${round2(left)}" y="${round2(top)}" width="${round2(w)}" height="${round2(h)}"/>`);
    out.push(`<line class="figure-axis" x1="${round2(left)}" y1="${round2(top + h / 2)}" x2="${round2(left + w)}" y2="${round2(top + h / 2)}"/>`);
    out.push(`<line class="figure-axis" x1="${round2(left)}" y1="${round2(top)}" x2="${round2(left)}" y2="${round2(top + h)}"/>`);
    out.push(`<polyline class="figure-curve" points="${curvePoints(x => CURVE_FUNCS[fn].f(x, k), left, w, top, h)}"/>`);
    out.push(`<text class="figure-label" x="${round2(left + 6)}" y="${round2(top + 13)}">${escapeHtml(CURVE_FUNCS[fn].label)}</text>`);
    return out.join('');
  }

  /** 概率分布：连续分布画密度曲线，离散分布画竖棒。 */
  function distMarkup(component) {
    const { w, h } = figureSize(component);
    const key = DIST_FUNCS[component?.dist] ? component.dist : 'normal';
    const dist = DIST_FUNCS[key];
    const k = clamp(Number(component?.k) || 1, 0.2, 8);
    const left = -w / 2;
    const top = -h / 2;
    const base = top + h * 0.9;
    const out = [];
    out.push(`<rect class="figure-frame" x="${round2(left)}" y="${round2(top)}" width="${round2(w)}" height="${round2(h)}"/>`);
    out.push(`<line class="figure-axis" x1="${round2(left)}" y1="${round2(base)}" x2="${round2(left + w)}" y2="${round2(base)}"/>`);
    if (dist.discrete) {
      const n = dist.discrete;
      const values = Array.from({ length: n }, (_, i) => dist.f(i, k));
      const peak = Math.max(...values) || 1;
      const cw = w / n;
      const barW = Math.min(cw * 0.28, 10);
      for (let i = 0; i < n; i += 1) {
        const x = left + (i + 0.5) * cw;
        const barH = h * 0.75 * (values[i] / peak);
        out.push(`<line class="figure-stem" x1="${round2(x)}" y1="${round2(base)}" x2="${round2(x)}" y2="${round2(base - barH)}"/>`);
        out.push(`<circle class="figure-dot" cx="${round2(x)}" cy="${round2(base - barH)}" r="${round2(Math.max(1.6, barW / 3))}"/>`);
      }
    } else {
      const values = [];
      for (let i = 0; i <= 120; i += 1) values.push(dist.f(i / 120 * 2 - 1, k));
      const peak = Math.max(...values) || 1;
      const points = values.map((value, i) => `${round2(left + (i / 120) * w)} ${round2(base - (value / peak) * h * 0.78)}`).join(' ');
      // 曲线下方淡填充，更像密度图
      out.push(`<polygon class="figure-area" points="${round2(left)} ${round2(base)} ${points} ${round2(left + w)} ${round2(base)}"/>`);
      out.push(`<polyline class="figure-curve" points="${points}"/>`);
    }
    out.push(`<text class="figure-label" x="${round2(left + 6)}" y="${round2(top + 13)}">${escapeHtml(dist.label)}</text>`);
    return out.join('');
  }

  /** 把每格 0/1 电平变成阶梯折线（含垂直跳变）。 */
  function steppedPoints(levels, left, w, high, low) {
    const n = levels.length || 1;
    const cw = w / n;
    const y = level => (level ? high : low);
    const points = [[left, y(levels[0])]];
    for (let i = 0; i < n; i += 1) {
      const end = left + (i + 1) * cw;
      points.push([end, y(levels[i])]);
      if (i + 1 < n && levels[i + 1] !== levels[i]) points.push([end, y(levels[i + 1])]);
    }
    return points.map(([x, y2]) => `${round2(x)} ${round2(y2)}`).join(' ');
  }

  /** 数字波形：时钟 / 数据 / 总线 / 脉冲，WaveDrom 风格。 */
  function waveMarkup(component) {
    const { w, h } = figureSize(component);
    const kind = WAVE_KINDS[component?.kind] ? component.kind : 'clock';
    const cycles = clamp(Math.round(Number(component?.cycles) || 4), 1, 32);
    const duty = clamp(Number(component?.duty) || 50, 5, 95) / 100;
    const left = -w / 2;
    const top = -h / 2;
    const high = top + h * 0.24;
    const low = top + h * 0.76;
    const out = [];
    out.push(`<rect class="figure-frame" x="${round2(left)}" y="${round2(top)}" width="${round2(w)}" height="${round2(h)}"/>`);
    if (kind === 'bus') {
      const labels = String(component?.pattern || 'D0 D1 D2').trim().split(/[\s,]+/).filter(Boolean).slice(0, 16);
      const n = labels.length || 1;
      const cw = w / n;
      const midY = (high + low) / 2;
      const bandH = Math.min(h * 0.46, 30);
      const y0 = midY - bandH / 2;
      const y1 = midY + bandH / 2;
      for (let i = 0; i < n; i += 1) {
        const x0 = left + i * cw;
        const tip = Math.min(cw * 0.18, 11);
        const tipRight = Math.min(tip, cw / 2);
        const d = `M ${round2(x0)} ${round2(y0)} L ${round2(x0 + cw - tipRight)} ${round2(y0)} L ${round2(x0 + cw)} ${round2(midY)} L ${round2(x0 + cw - tipRight)} ${round2(y1)} L ${round2(x0)} ${round2(y1)} L ${round2(x0 + tipRight)} ${round2(midY)} Z`;
        out.push(`<path class="figure-bus" d="${d}"/>`);
        out.push(`<text class="figure-wire-label" x="${round2(x0 + cw / 2)}" y="${round2(midY + 3.5)}" text-anchor="middle">${escapeHtml(labels[i])}</text>`);
      }
    } else {
      let levels;
      if (kind === 'signal') {
        const bits = String(component?.pattern || '1011').replace(/[^01]/g, '');
        levels = (bits || '1011').split('').slice(0, 32).map(ch => ch === '1');
      } else {
        const dutyCell = kind === 'strobe' ? Math.min(duty, 0.4) : duty;
        const sub = clamp(Math.round(1 / Math.max(0.1, Math.min(dutyCell, 1 - dutyCell))), 2, 10);
        const highCount = Math.max(1, Math.round(sub * dutyCell));
        levels = [];
        for (let i = 0; i < cycles; i += 1) {
          for (let j = 0; j < sub; j += 1) levels.push(j < highCount);
        }
      }
      out.push(`<polyline class="figure-wave" points="${steppedPoints(levels, left, w, high, low)}"/>`);
      // 每格底部的刻度，方便数周期
      if (kind !== 'signal') {
        for (let i = 0; i <= cycles; i += 1) {
          const x = left + (i / cycles) * w;
          out.push(`<line class="figure-tick" x1="${round2(x)}" y1="${round2(low)}" x2="${round2(x)}" y2="${round2(low + 4)}"/>`);
        }
      }
    }
    out.push(`<text class="figure-label" x="${round2(left + 6)}" y="${round2(top + 13)}">${escapeHtml(kind === 'bus' ? 'bus' : kind)}</text>`);
    return out.join('');
  }

  /** 一个图形 → SVG 元素。矩形与椭圆用原生元素，其余统一走路径。 */
  function shapeMarkup(shape) {
    const x = shape.x;
    const y = shape.y;
    const w = Math.abs(shape.width);
    const h = Math.abs(shape.height);
    const dashed = shape.kind === 'dashed-rect';
    const cls = dashed ? 'shape shape-dashed' : 'shape';
    const box = `x="${round2(x)}" y="${round2(y)}" width="${round2(w)}" height="${round2(h)}"`;
    const paint = shapeStyleAttr(shape);
    if (shape.kind === 'image') {
      const source = /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(shape.imageData || '') ? shape.imageData : '';
      const positioning = `translate(${x} ${y}) scale(${w / shape.imageBoundsWidth} ${h / shape.imageBoundsHeight}) translate(${-shape.imageOriginX} ${-shape.imageOriginY})`;
      const transform = shape.imageTransform ? ` transform="${positioning} ${escapeHtml(shape.imageTransform)}"` : '';
      const imageBox = shape.imageTransform ? `x="0" y="0" width="${shape.imageWidth}" height="${shape.imageHeight}"` : box;
      return `<image ${imageBox} href="${source}" preserveAspectRatio="none"${transform}/>`;
    }
    if (shape.kind === 'free-line') return `<path class="${cls}" d="M ${x} ${y} L ${x + w} ${y + h}"${paint}/>`;
    if (shape.kind === 'free-curve') return `<path class="${cls}" d="M ${x} ${y} C ${x + w * 0.25} ${y} ${x + w * 0.75} ${y + h} ${x + w} ${y + h}"${paint}/>`;
    if (shape.kind === 'freeform') {
      const dash = shape.dash ? ` stroke-dasharray="${shape.dash}"` : '';
      const begin = shape.beginArrow ? ' marker-start="url(#ucie-arrow)"' : '';
      const end = shape.endArrow ? ' marker-end="url(#ucie-arrow)"' : '';
      return `<path class="${cls}" d="${escapeHtml(shape.path || '')}"${paint}${dash}${begin}${end}/>`;
    }
    if (shape.kind === 'rectangle' || dashed) {
      const rectangle = `<rect class="${cls}" ${box}${paint}/>`;
      return `${rectangle}${shape.blockLabel ? shapeLabelMarkup(shape) : ''}`;
    }
    if (shape.kind === 'rounded-rect') return `<rect class="${cls}" ${box} rx="${round2(Math.min(w, h) * 0.16)}"${paint}/>`;
    if (shape.kind === 'ellipse') return `<ellipse class="${cls}" cx="${round2(x + w / 2)}" cy="${round2(y + h / 2)}" rx="${round2(w / 2)}" ry="${round2(h / 2)}"${paint}/>${shape.blockLabel ? shapeLabelMarkup(shape) : ''}`;
    const data = shapePath(shape.kind, x, y, w, h);
    return data ? `<path class="${cls}" d="${data}"${paint}/>${shape.blockLabel ? shapeLabelMarkup(shape) : ''}` : '';
  }

  function shapeLabelMarkup(shape) {
    const label = String(shape.label || '').trim();
    const variableDiameter = shape.kind === 'octagon' || shape.variableDiameter;
    const width = variableDiameter ? widthOf(shape) * 0.78 : widthOf(shape) - 24;
    const height = variableDiameter ? heightOf(shape) * 0.7 : heightOf(shape) - 20;
    if (!label || width < 12 || height < 12) return '';
    const fontFamily = '"Aptos", "Microsoft YaHei", sans-serif';
    const metrics = shapeLabelMarkup.metrics || (shapeLabelMarkup.metrics = document.createElement('canvas').getContext('2d'));
    if (!metrics) return '';
    let sourceLines = Array.isArray(shape.labelLines) && shape.labelLines.length
      ? shape.labelLines.map(line => String(line || '').trim()).filter(Boolean)
      : label.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    if (sourceLines.length > 2) sourceLines = [sourceLines[0], sourceLines.slice(1).join(' ')];
    if (!sourceLines.length) return '';
    if (shape.labelDimension && sourceLines.length > 1) {
      const dimension = shape.labelDimension;
      const precision = value => Number(value).toFixed(0);
      const scaledWidth = dimension.width * widthOf(shape) / dimension.baseWidth;
      const scaledHeight = dimension.height * heightOf(shape) / dimension.baseHeight;
      sourceLines[1] = `${precision(scaledWidth)}${dimension.separator}${precision(scaledHeight)}`;
    } else if (shape.labelScaleBaseDiameter > 0 && sourceLines.length > 1) {
      const scale = widthOf(shape) / shape.labelScaleBaseDiameter;
      sourceLines[1] = sourceLines[1].replace(/\d+(?:\.\d+)?/g, value => {
        const decimals = value.split('.')[1]?.length || 0;
        const scaled = Number(value) * scale;
        return decimals ? String(Number(scaled.toFixed(decimals))) : String(Math.round(scaled));
      });
    }
    let fontSize = Math.min(36, width * 0.22, height * 0.28);
    let lines = sourceLines;
    let lineHeight = fontSize * 1.28;
    while (fontSize >= 5) {
      metrics.font = `600 ${fontSize}px ${fontFamily}`;
      lines = sourceLines.length > 1 ? sourceLines : splitLabelInTwo(sourceLines[0], metrics, width);
      lineHeight = fontSize * 1.28;
      const widestLine = Math.max(...lines.map(line => metrics.measureText(line).width));
      if (widestLine <= width && lines.length * lineHeight <= height) break;
      fontSize -= 0.5;
    }
    fontSize = Math.max(5, fontSize);
    metrics.font = `600 ${fontSize}px ${fontFamily}`;
    lines = sourceLines.length > 1 ? sourceLines : splitLabelInTwo(sourceLines[0], metrics, width);
    lineHeight = fontSize * 1.28;
    const centerX = round2(shape.x + shape.width / 2);
    const centerY = round2(shape.y + shape.height / 2);
    const firstDy = round2(-((lines.length - 1) * lineHeight) / 2);
    const tspans = lines.map((line, index) => {
      const measuredWidth = metrics.measureText(line).width;
      const fit = measuredWidth > width ? ` textLength="${round2(width)}" lengthAdjust="spacingAndGlyphs"` : '';
      return `<tspan x="${centerX}" dy="${index === 0 ? firstDy : round2(lineHeight)}"${fit}>${escapeHtml(line)}</tspan>`;
    }).join('');
    return `<text class="shape-label" x="${centerX}" y="${centerY}" style="font-size:${round2(fontSize)}px;fill:${shapeLabelColor(shape)}">${tspans}</text>`;
  }

  function widthOf(shape) { return Math.abs(Number(shape.width) || 0); }
  function heightOf(shape) { return Math.abs(Number(shape.height) || 0); }

  function splitLabelInTwo(label, metrics, maxWidth) {
    if (metrics.measureText(label).width <= maxWidth) return [label];
    const characters = Array.from(label);
    let split = 1;
    while (split < characters.length && metrics.measureText(characters.slice(0, split + 1).join('')).width <= maxWidth) split += 1;
    const wordBoundary = characters.slice(0, split).join('').lastIndexOf(' ');
    if (wordBoundary > 0) split = Array.from(characters.slice(0, split).join('').slice(0, wordBoundary + 1)).length;
    return [characters.slice(0, split).join('').trimEnd(), characters.slice(split).join('').trimStart()];
  }

  function shapeLabelColor(shape) {
    const fill = sanitizeShapeFill(shape.fill);
    if (!isHexColor(fill)) return '#33483e';
    const channels = [1, 3, 5].map(offset => parseInt(fill.slice(offset, offset + 2), 16) / 255);
    const luminance = channels.map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
    return luminance < 0.38 ? '#ffffff' : '#33483e';
  }

  function updateOctagonLabel(shape) {
    const lines = String(shape.label || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    shape.labelLines = lines.length > 2 ? [lines[0], lines.slice(1).join(' ')] : lines;
    const dimension = shape.labelLines.length > 1
      ? shape.labelLines[1].match(/^\s*(\d+(?:\.\d+)?)\s*([*x×])\s*(\d+(?:\.\d+)?)\s*$/i)
      : null;
    shape.labelScaleBaseDiameter = shape.width;
    if (!dimension || shape.width <= 0 || shape.height <= 0) {
      delete shape.labelDimension;
      return;
    }
    shape.labelDimension = {
      width: Number(dimension[1]),
      height: Number(dimension[3]),
      baseWidth: shape.width,
      baseHeight: shape.height,
      separator: dimension[2]
    };
  }

  /** 修改当前选中图形的填充色；色板与取色器共用。 */
  function setShapeFill(value) {
    if (selected?.kind !== 'shape') return;
    const shape = project.shapes.find(item => item.id === selected.id);
    if (!shape || shape.kind === 'line') return;
    const next = sanitizeShapeFill(value);
    if (sanitizeShapeFill(shape.fill) === next) return;
    saveHistory();
    shape.fill = next;
    shapeFill = next;
    changed();
  }

  /**
   * 一个元件 → SVG 图元。几何完全由 symbols.generated.js 提供：
   * 先画符号本体（跳过变体点名隐藏的部件），再叠加变体追加的部件，
   * 最后是公式标注与引脚名。这里不做任何坐标改写。
   */
  function symbolMarkup(type, component) {
    if (type === 'ruler') return rulerMarkup(component);
    if (type === 'math-curve') return curveMarkup(component);
    if (type === 'prob-curve') return distMarkup(component);
    if (isWaveType(type)) return waveMarkup(component);
    if (type === 'rect-block') return '<rect class="symbol" x="-70" y="-46" width="140" height="92"/>';
    if (type === 'block') {
      const w = Number(component?.w) || 160;
      const h = Number(component?.h) || 100;
      const out = [`<rect class="symbol-fill" x="${round2(-w / 2)}" y="${round2(-h / 2)}" width="${round2(w)}" height="${round2(h)}"/>`];
      for (const pin of (component?.pins || [])) {
        const onSide = Math.abs(pin.y) <= h / 2 + 1;
        const ex = onSide ? (pin.x < 0 ? -w / 2 : w / 2) : pin.x;
        const ey = onSide ? pin.y : (pin.y < 0 ? -h / 2 : h / 2);
        out.push(`<line class="symbol" x1="${round2(ex)}" y1="${round2(ey)}" x2="${round2(pin.x)}" y2="${round2(pin.y)}"/>`);
        let tx = pin.x; let ty = pin.y; let anchor = 'start';
        if (onSide) {
          anchor = pin.x < 0 ? 'start' : 'end';
          tx = pin.x < 0 ? -w / 2 + 7 : w / 2 - 7;
        } else {
          anchor = 'middle';
          ty = pin.y < 0 ? -h / 2 + 13 : h / 2 - 13;
        }
        out.push(`<text class="pin-name" x="${round2(tx)}" y="${round2(ty)}" text-anchor="${anchor}" dominant-baseline="central" font-size="${PIN_NAME_SIZE}">${escapeHtml(pin.dn || pin.n)}</text>`);
      }
      return out.join('');
    }
    const spec = partSpecs[type];
    if (!spec) return '';
    const symbol = CATALOG[spec.sym];
    if (!symbol) return '';
    const variant = spec.variant ? (symbol.var || []).find(item => item.id === spec.variant) : null;
    const hidden = new Set(variant ? variant.hide || [] : []);
    const hiddenParts = new Set(variant ? variant.hideParts || [] : []);
    const markup = [];
    const draw = primitive => {
      if (primitive.part && hiddenParts.has(primitive.part)) return;
      const output = primitiveMarkup(primitive);
      if (output) markup.push(output);
    };
    symbol.prim.forEach(draw);
    (variant ? variant.add || [] : []).forEach(draw);
    const formula = formulaMarkup(symbol);
    if (formula) markup.push(formula);
    const names = pinNameMarkup(symbol, hidden);
    if (names) markup.push(names);
    return markup.join('');
  }

  // 本应用的类型 → 上游符号；数组形式表示还要选定变体。
  const PART_SOURCE = {
    resistor: 'resistor',
    'variable-resistor': 'variable-resistor',
    capacitor: 'capacitor',
    'variable-capacitor': 'variable-capacitor',
    inductor: 'inductor',
    'inductor-compact': 'inductor-compact',
    'variable-inductor': 'variable-inductor',
    transformer: 'xfmr',
    tcoil: 'tcoil',
    voltage: 'voltage-source',
    'pulse-voltage': 'pulse-voltage-source',
    current: 'current-source',
    battery: 'battery',
    'digital-clock': 'digital-clock',
    ground: 'ground',
    junction: 'junction',
    'vdd-port': 'vdd-port',
    diode: 'diode',
    'zener-diode': 'zener-diode',
    nmos: ['nmos', 'textbook-3terminal'],
    pmos: ['pmos', 'textbook-3terminal'],
    'nmos-bulk': 'nmos',
    'pmos-bulk': 'pmos',
    'nmos-depletion': ['depletion-nmos', 'textbook-3terminal'],
    'pmos-depletion': ['depletion-pmos', 'textbook-3terminal'],
    ndmos: ['ndmos', 'standard-3terminal'],
    pdmos: ['pdmos', 'standard-3terminal'],
    npn: 'npn',
    pnp: 'pnp',
    'ideal-switch': 'ideal-switch',
    'closed-switch': 'closed-switch',
    'simple-switch': 'simple-switch',
    'voltage-controlled-switch': 'voltage-controlled-switch',
    'controlled-switch': 'voltage-controlled-switch',
    'externally-controlled-switch': 'externally-controlled-switch',
    'spdt-switch': 'spdt-switch',
    vcvs: 'vcvs',
    vccs: 'vccs',
    ccvs: 'ccvs',
    cccs: 'cccs',
    and: 'and-gate',
    or: 'or-gate',
    nand: 'nand-gate',
    nor: 'nor-gate',
    xor: 'xor-gate',
    xnor: 'xnor-gate',
    not: 'inverter',
    buffer: 'buffer',
    dff: 'd-flip-flop',
    'dff-q': 'd-flip-flop-q',
    'dff-reset': 'd-flip-flop-reset',
    'delay-cell': 'delay-cell',
    comparator: 'comparator',
    'comparator-unmarked': 'comparator-unmarked',
    'comparator-inputs-swapped': 'comparator-inputs-swapped',
    'comparator-unmarked-inputs-swapped': 'comparator-unmarked-inputs-swapped',
    'voltage-amp': 'voltage-amplifier',
    'voltage-amplifier-lettered': 'voltage-amplifier-lettered',
    transconductance: 'transconductance',
    'differential-transconductance': 'differential-transconductance',
    'differential-transconductance-inputs-swapped': 'differential-transconductance-inputs-swapped',
    'fd-amp': 'opamp-differential',
    adder: 'adder',
    multiplier: 'multiplier',
    integrator: 'integrator',
    'unit-delay': 'unit-delay',
    'dt-integrator': 'discrete-time-integrator',
    quantizer: 'quantizer',
    adc: 'adc',
    dac: 'dac',
    port: 'port',
    'port-filled': 'port-filled'
  };
  // 3 / 4 输入门在上游是一族独立符号。
  for (const family of ['and', 'or', 'nand', 'nor', 'xor', 'xnor']) {
    for (const arity of [3, 4]) PART_SOURCE[`${family}-${arity}`] = `${family}-gate-${arity}`;
  }
  // 运放家族在上游与本应用中同名，逐个对应即可。
  for (const id of Object.keys(ANALOG)) if (/^opamp(-|$)/.test(id)) PART_SOURCE[id] = id;

  /** 用上游定义覆盖本应用里的尺寸、引脚与视图框。 */
  function applyUpstreamGeometry() {
    if (applyUpstreamGeometry.applied) return;
    for (const [type, spec] of Object.entries(partSpecs)) {
      const source = PART_SOURCE[type];
      if (!source) continue;
      const [symbolId, variantId] = Array.isArray(source) ? source : [source, null];
      const symbol = CATALOG[symbolId];
      if (!symbol) continue;
      const variant = variantId ? (symbol.var || []).find(item => item.id === variantId) : null;
      const hidden = new Set(variant ? variant.hide || [] : []);
      spec.sym = symbolId;
      spec.variant = variantId;
      spec.box = symbol.vb;
      spec.width = symbol.vb[2];
      spec.height = symbol.vb[3];
      spec.pins = symbol.pins.filter(pin => !hidden.has(pin.n)).map(pin => ({ name: pin.n, x: pin.x, y: pin.y }));
    }
    applyUpstreamGeometry.applied = true;
  }

  function renderPaletteIcons() {
    if (renderPaletteIcons.rendered) return;
    $$('.part-button[data-type]').forEach(button => {
      const spec = partSpecs[button.dataset.type];
      const icon = button.querySelector('.part-icon');
      const svg = svgElement('svg', { viewBox: spec.box.join(' '), preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
      // 参数化图元（曲线 / 波形）先用它自己的默认参数生成一个临时对象，图标才画得出来
      const preview = FIGURE_TYPES.has(button.dataset.type) ? applyFigureDefaults({ type: button.dataset.type }) : undefined;
      svg.innerHTML = symbolMarkup(button.dataset.type, preview);
      icon.replaceChildren(svg);
    });
    renderPaletteIcons.rendered = true;
  }

  /** 图形按钮的图标用同一套 shapeMarkup 画，保证与画布上一致。 */
  function renderShapeIcons() {
    if (renderShapeIcons.rendered) return;
    $$('.shape-part').forEach(button => {
      const svg = svgElement('svg', { viewBox: '0 0 30 22', preserveAspectRatio: 'xMidYMid meet', 'aria-hidden': 'true' });
      svg.innerHTML = shapeMarkup({ kind: button.dataset.shape, x: 3, y: 3, width: 24, height: 16 });
      button.querySelector('.part-icon').replaceChildren(svg);
    });
    renderShapeIcons.rendered = true;
  }

  function renderScene() {
    shapeLayer.replaceChildren();
    wireLayer.replaceChildren();
    textLayer.replaceChildren();
    componentLayer.replaceChildren();
    interactionLayer.replaceChildren();
    const byId = new Map(project.components.map(component => [component.id, component]));

    // 图形画在最底层，当作框图 / 分组框使用。
    const orderedShapes = [...project.shapes].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    for (const shape of orderedShapes) {
      const group = svgElement('g', {
        'data-shape-id': shape.id,
        class: `shape-group${isSelected('shape', shape.id) ? ' selected' : ''}`
      });
      if (shape.kind === 'freeform') {
        group.setAttribute('transform', `translate(${round2(shape.x - shape.pathX)} ${round2(shape.y - shape.pathY)})`);
      }
      group.innerHTML = shapeMarkup(shape);
      if (shape.kind === 'freeform') {
        group.append(svgElement('path', {
          d: shape.path,
          class: 'shape-hit',
          style: `fill:#fff;fill-opacity:0;stroke:#fff;stroke-opacity:0;stroke-width:${Math.max(Number(shape.sw) || 0, 8 * canvasUnitsPerPixel())};pointer-events:${shape.fill && shape.fill !== 'none' ? 'all' : 'stroke'}`
        }));
      } else {
        // 描边很细，另叠一个透明命中矩形，让图形任意位置都能拖动。
        group.append(svgElement('rect', {
          x: shape.x, y: shape.y, width: shape.width, height: shape.height, class: 'shape-hit'
        }));
      }
      group.addEventListener('pointerdown', event => beginShapePointer(event, shape));
      shapeLayer.append(group);
    }

    for (const wire of project.wires) {
      const fromComponent = byId.get(wire.from.component);
      const toComponent = byId.get(wire.to.component);
      if (!fromComponent || !toComponent) continue;
      // hidden：导入时如果已经有「原图走线」几何，自动生成的这条只用于网表推导，
      // 与 residual 层二者只显示其一（见 residualShown 的说明）。
      if (wire.hidden && residualShown) continue;
      const a = pinPosition(fromComponent, wire.from.pin);
      const b = pinPosition(toComponent, wire.to.pin);
      const group = svgElement('g', { 'data-wire-id': wire.id });
      const hit = svgElement('path', { d: pathBetween(a, b, wire.mode), class: 'wire-hit' });
      const line = svgElement('path', { d: pathBetween(a, b, wire.mode), class: `wire${isSelected('wire', wire.id) ? ' selected' : ''}` });
      group.append(hit, line);
      group.addEventListener('pointerdown', event => {
        if (tool !== 'select') return;
        event.stopPropagation();
        if (event.shiftKey) toggleSelectOne('wire', wire.id);
        else selectOne('wire', wire.id);
        renderAll();
      });      wireLayer.append(group);
    }

    for (const text of project.texts) {
      const group = svgElement('g', { 'data-text-id': text.id, class: 'annotation-group' });
      const attrs = { x: text.x, y: text.y, 'font-size': text.size || 18, class: `annotation${isSelected('text', text.id) ? ' selected' : ''}` };
      if (text.anchor) attrs['text-anchor'] = text.anchor;
      const textStyle = [];
      if (isHexColor(text.color)) textStyle.push(`fill:${String(text.color).toLowerCase()}`);
      // 内联字号：.annotation 的 font 简写会盖掉 font-size 属性
      if (Number(text.size) > 0) textStyle.push(`font-size:${Number(text.size)}px`);
      if (text.bold) textStyle.push('font-weight:700');
      if (project.preserveVisioOrder && text.angle) attrs.transform = `rotate(${text.angle} ${text.x} ${text.y})`;
      if (textStyle.length) attrs.style = textStyle.join(';');
      const label = svgElement('text', attrs);
      label.textContent = text.text;
      group.append(label);
      group.addEventListener('pointerdown', beginTextDrag);
      group.addEventListener('dblclick', event => {
        event.stopPropagation();
        selectOne('text', text.id);
        renderAll();
        const field = $('#text-content');
        if (field) field.focus();
      });
      textLayer.append(group);
    }

    if (project.preserveVisioOrder) {
      const orders = new Map([...project.shapes, ...project.texts].map(item => [item.id, item.order ?? 0]));
      const nodes = [...shapeLayer.children, ...textLayer.children];
      nodes.sort((first, second) => orders.get(first.dataset.shapeId || first.dataset.textId) - orders.get(second.dataset.shapeId || second.dataset.textId));
      shapeLayer.append(...nodes);
    }

    for (const component of project.components) {
      const spec = partSpecs[component.type];
      const group = svgElement('g', {
        class: `component${isSelected('component', component.id) ? ' selected' : ''}`,
        transform: `translate(${component.x} ${component.y})`,
        'data-component-id': component.id,
        tabindex: '0',
        'aria-label': `${component.name} ${spec.title}`
      });
      const artwork = svgElement('g', { transform: `rotate(${component.rotation || 0})${component.flip === 'x' ? ' scale(-1 1)' : ''}` });
      artwork.innerHTML = symbolMarkup(component.type, component);
      group.append(artwork);
      // 标尺自带数值标注，不再画位号/参数
      if (component.type !== 'junction' && component.type !== 'ruler') {
        // 位号 / 参数位置：默认在符号正下方。教科书画法要求文字躲开导线，所以
        // 转换器会按实际走线在 下/右/左/上 里挑一个不压线的方向（component.labelPos）。
        const box = FIGURE_TYPES.has(component.type)
          ? [-figureSize(component).w / 2, -figureSize(component).h / 2,
             figureSize(component).w, figureSize(component).h]
          : (component.w && component.h
            ? [-component.w / 2, -component.h / 2, component.w, component.h]
            : (spec.box || [0, 0, spec.width || 0, spec.height || 0]));
        const halfHeight = box[3] / 2;
        const pos = component.labelPos || 'below';
        const anchor = pos === 'right' ? 'start' : (pos === 'left' ? 'end' : null);
        const place = (cls, text, dy) => {
          const attrs = { class: cls };
          if (pos === 'above') {
            attrs.x = 0;
            attrs.y = -halfHeight - 30 + dy;
          } else if (pos === 'right' || pos === 'left') {
            attrs.x = pos === 'right' ? box[0] + box[2] + 8 : box[0] - 8;
            attrs.y = -4 + dy;
            if (anchor) attrs.style = `text-anchor:${anchor}`;
          } else {
            attrs.x = 0;
            attrs.y = halfHeight + 20 + dy;
          }
          const node = svgElement('text', attrs);
          node.textContent = text;
          return node;
        };
        group.append(place('part-name', component.name, 0));
        if (component.value) group.append(place('part-value', component.value, 17));
      }
      effectivePins(component).forEach((pin, index) => {
        const node = svgElement('g', { 'data-pin': index, 'data-component-id': component.id, tabindex: '0' });
        node.setAttribute('aria-label', `${component.name} 引脚 ${pin.name}`);
        node.append(
          svgElement('circle', { cx: pin.x, cy: pin.y, r: 12, class: 'pin-hit' }),
          svgElement('circle', { cx: pin.x, cy: pin.y, r: 4.5, class: 'pin' })
        );
        artwork.append(node);
      });
      group.addEventListener('pointerdown', beginComponentPointer);
      group.addEventListener('click', event => {
        // 选中已在 pointerdown / pointerup 里处理，这里只防止冒泡到画布
        if (event.target.closest('[data-pin]')) return;
        event.stopPropagation();
      });
      group.addEventListener('dblclick', event => {
        event.stopPropagation();
        selectOne('component', component.id);
        renderAll();
        const field = $('#property-name');
        if (field) field.focus();
      });
      componentLayer.append(group);
    }

    if (wireStart) {
      const component = byId.get(wireStart.component);
      if (component) {
        const start = pinPosition(component, wireStart.pin);
        const line = svgElement('path', { d: pathBetween(start, pointerPosition), class: 'draft-wire' });
        interactionLayer.append(line);
      }
    }

    for (const guide of guides) {
      interactionLayer.append(svgElement('line', { x1: guide.x1, y1: guide.y1, x2: guide.x2, y2: guide.y2, class: 'guide' }));
    }

    if (selection.length === 1 && selected?.kind === 'shape') {
      const shape = project.shapes.find(item => item.id === selected.id);
      if (shape && shape.kind !== 'freeform') appendShapeHandles(shape);
    } else if (selection.length === 1 && selected?.kind === 'component') {
      const component = byId.get(selected.id);
      if (component?.type === 'ruler') appendRulerHandles(component);
    }
    // 多选：圈一圈虚线轮廓，整组范围一目了然
    if (selection.length > 1) {
      const box = unionBox(selection.map(item => objectBox(item.kind, item.id)));
      if (box) {
        interactionLayer.append(svgElement('rect', {
          x: round2(box.x - 4), y: round2(box.y - 4),
          width: round2(box.width + 8), height: round2(box.height + 8),
          class: 'selection-outline'
        }));
      }
    }
    // 框选中的选框
    const selecting = marqueeBox();
    if (selecting) {
      interactionLayer.append(svgElement('rect', {
        x: round2(selecting.x), y: round2(selecting.y),
        width: round2(selecting.width), height: round2(selecting.height),
        class: 'marquee'
      }));
    }

    canvas.setAttribute('viewBox', `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`);
    // 背景网格始终盖住可视区域，缩小时不会露出空白纸面（多留 2% 防止取整缝隙）
    if (canvasBg) {
      const padX = viewBox.width * 0.02;
      const padY = viewBox.height * 0.02;
      canvasBg.setAttribute('x', round2(viewBox.x - padX));
      canvasBg.setAttribute('y', round2(viewBox.y - padY));
      canvasBg.setAttribute('width', round2(viewBox.width + padX * 2));
      canvasBg.setAttribute('height', round2(viewBox.height + padY * 2));
    }
    $('#zoom-value').textContent = `${Math.round(zoom * 100)}%`;
    const shapeCount = project.shapes.length;
    $('#object-count').textContent = `${project.components.filter(item => item.type !== 'junction').length} 个元件 · ${project.wires.length} 条导线${shapeCount ? ` · ${shapeCount} 个图形` : ''}`;
    $('#empty-hint').hidden = project.components.length > 0;
    updateCoordinates(pointerPosition);
    updateScrollbars();
  }

  // ── 滚动条 ───────────────────────────────────────────────────────────────
  // 画布用 viewBox 做缩放/平移，所以滚动条得自己画（位置、滑块长度都跟 viewBox 联动）：
  // 拖滑块 / 点轨道 → 改 viewBox；缩放到装得下时自动隐藏。
  // ⚠️ app.js 是所有外壳共用的运行期（index.html / ucie.html / 生成的画布文件），
  //    老外壳里没有这套 DOM，**缺了必须静默跳过** —— 曾经因为没判空，一个
  //    null.addEventListener 就把整个 app.js 打断，页面看着“被破坏了”。
  const scrollAxis = {
    x: { bar: $('#scrollbar-x'), thumb: $('#scrollbar-thumb-x') },
    y: { bar: $('#scrollbar-y'), thumb: $('#scrollbar-thumb-y') }
  };

  function updateScrollbars() {
    const wrap = $('#canvas-wrap');
    const paper = document.querySelector('.canvas-paper');
    const wrapRect = wrap ? wrap.getBoundingClientRect() : null;
    const rect = paper ? paper.getBoundingClientRect() : wrapRect;
    const gap = 7;
    for (const axis of ['x', 'y']) {
      const item = scrollAxis[axis];
      if (!item.bar || !item.thumb) continue;            // 外壳没有滚动条 → 不管
      if (!wrapRect || !rect || !rect.width || !rect.height) { item.bar.hidden = true; continue; }
      const span = axis === 'x' ? CANVAS_W : CANVAS_H;
      const extent = axis === 'x' ? viewBox.width : viewBox.height;
      const track = axis === 'x' ? rect.width : rect.height;
      const frac = extent / span;
      if (frac >= 0.999) { item.bar.hidden = true; continue; }
      const size = Math.max(32, track * frac);
      const t = clamp((axis === 'x' ? viewBox.x : viewBox.y) / Math.max(span - extent, 1), 0, 1);
      item.bar.hidden = false;
      if (axis === 'x') {
        item.bar.style.left = `${round2(rect.left - wrapRect.left)}px`;
        item.bar.style.width = `${round2(rect.width)}px`;
        item.bar.style.top = `${round2(Math.min(rect.bottom - wrapRect.top + gap, wrapRect.height - 13))}px`;
        item.thumb.style.width = `${round2(size)}px`;
        item.thumb.style.transform = `translateX(${round2(t * (track - size))}px)`;
      } else {
        item.bar.style.top = `${round2(rect.top - wrapRect.top)}px`;
        item.bar.style.height = `${round2(rect.height)}px`;
        item.bar.style.left = `${round2(Math.min(rect.right - wrapRect.left + gap, wrapRect.width - 13))}px`;
        item.thumb.style.height = `${round2(size)}px`;
        item.thumb.style.transform = `translateY(${round2(t * (track - size))}px)`;
      }
    }
  }

  function bindScrollbar(bar, thumb, axis) {
    const span = axis === 'x' ? CANVAS_W : CANVAS_H;
    const extent = axis === 'x' ? 'width' : 'height';
    let drag = null;
    const setT = t => {
      const off = clamp(t, 0, 1) * Math.max(span - viewBox[extent], 0);
      viewBox = axis === 'x' ? { ...viewBox, x: off } : { ...viewBox, y: off };
      renderScene();
    };
    bar.addEventListener('pointerdown', event => {
      if (bar.hidden) return;
      const rect = bar.getBoundingClientRect();
      const box = thumb.getBoundingClientRect();
      const pos = axis === 'x' ? event.clientX - rect.left : event.clientY - rect.top;
      const tOff = axis === 'x' ? box.left - rect.left : box.top - rect.top;
      const tSize = axis === 'x' ? box.width : box.height;
      const travel = Math.max((axis === 'x' ? rect.width : rect.height) - tSize, 1);
      if (pos >= tOff && pos <= tOff + tSize) {          // 按住滑块 → 跟随鼠标
        drag = { pos, t: clamp((axis === 'x' ? viewBox.x : viewBox.y)
                               / Math.max(span - viewBox[extent], 1), 0, 1) };
      } else {                                           // 点轨道 → 跳过去
        drag = null;
        setT((pos - tSize / 2) / travel);
      }
      bar.setPointerCapture(event.pointerId);
      event.preventDefault();
      event.stopPropagation();
    });
    bar.addEventListener('pointermove', event => {
      if (!drag) return;
      const rect = bar.getBoundingClientRect();
      const box = thumb.getBoundingClientRect();
      const pos = axis === 'x' ? event.clientX - rect.left : event.clientY - rect.top;
      const tSize = axis === 'x' ? box.width : box.height;
      const travel = Math.max((axis === 'x' ? rect.width : rect.height) - tSize, 1);
      setT(drag.t + (pos - drag.pos) / travel);
    });
    const stop = () => { drag = null; };
    bar.addEventListener('pointerup', stop);
    bar.addEventListener('pointercancel', stop);
  }
  // 外壳没带滚动条 DOM 就直接不绑（老画布文件 / ucie.html 都属这种情况）
  for (const axis of ['x', 'y']) {
    const item = scrollAxis[axis];
    if (item.bar && item.thumb) bindScrollbar(item.bar, item.thumb, axis);
  }

  // ── 网表（SPICE） ────────────────────────────────────────────────────────
  // 侧栏「网表」页：由画布实时推导一份可读的 SPICE 网表（对应 Analog Canvas 的
  // live netlist 面板）。只读、可复制、可导出；悬空引脚、缺失数值、无法按标准
  // 元件卡输出的器件都在下方提示里列出，相当于一个轻量 ERC。
  const NETLIST_MOS_TYPES = ['nmos', 'pmos', 'nmos-bulk', 'pmos-bulk', 'nmos-depletion', 'pmos-depletion', 'ndmos', 'pdmos'];
  const NETLIST_TERMINALS = new Set(['port', 'port-filled', 'vdd-port']);
  // 不参与网表的类型：接地/连接点/端口在别处单独处理，标尺只是标注工具
  const NETLIST_SKIP = new Set(['ground', 'junction', 'ruler', 'port', 'port-filled', 'vdd-port',
    'math-curve', 'prob-curve', 'digital-wave', 'digital-wave-clock', 'digital-wave-signal', 'digital-wave-bus']);

  /** 元件类型 → SPICE 元件卡；nodes 是候选引脚名序列（大小写不敏感，按顺序回落）。 */
  const NETLIST_CARDS = {
    resistor: { prefix: 'R', nodes: [['1', '2'], ['P1', 'P2']], value: true },
    'variable-resistor': { prefix: 'R', nodes: [['P1', 'P2'], ['1', '2']], value: true },
    capacitor: { prefix: 'C', nodes: [['1', '2']], value: true },
    'variable-capacitor': { prefix: 'C', nodes: [['1', '2']], value: true },
    inductor: { prefix: 'L', nodes: [['1', '2']], value: true },
    'variable-inductor': { prefix: 'L', nodes: [['1', '2']], value: true },
    'inductor-compact': { prefix: 'L', nodes: [['1', '2']], value: true },
    voltage: { prefix: 'V', nodes: [['+', '-']], value: true },
    'pulse-voltage': { prefix: 'V', nodes: [['+', '-']], value: true },
    battery: { prefix: 'V', nodes: [['+', '-']], value: true },
    current: { prefix: 'I', nodes: [['+', '-']], value: true },
    diode: { prefix: 'D', nodes: [['A', 'K']], model: 'DMOD' },
    'zener-diode': { prefix: 'D', nodes: [['A', 'K']], model: 'DZENER' },
    npn: { prefix: 'Q', nodes: [['C', 'B', 'E']], model: 'QNPN' },
    pnp: { prefix: 'Q', nodes: [['C', 'B', 'E']], model: 'QPNP' },
    'voltage-controlled-switch': { prefix: 'S', nodes: [['P', 'N', 'CP', 'CN']], model: 'SWMOD' }
  };

  function netlistCard(type) {
    if (NETLIST_CARDS[type]) return NETLIST_CARDS[type];
    if (NETLIST_MOS_TYPES.includes(type)) {
      const pmos = type.startsWith('pmos') || type === 'pdmos';
      // 默认 nmos/pmos 变体隐去了衬底 B，缺 B 时按惯例把衬底接到源端。
      return { prefix: 'M', nodes: [['D', 'G', 'S', 'B'], ['D', 'G', 'S']], model: pmos ? 'PMOS' : 'NMOS', bulk: true };
    }
    return null;
  }

  const netlistSubckt = type => String(type || '').toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'BLOCK';

  /** "10 kΩ" → "10k"，"1 mH" → "1m"，"100 nF" → "100n"；识别不了（算式/比例式）返回 '?'。 */
  function spiceValue(raw) {
    const text = String(raw ?? '').trim().replace(/\s+/g, '');
    if (!text) return '?';
    const match = text.match(/^([+-]?(?:\d+\.?\d*|\.\d+))([^0-9]*)$/);
    if (!match) return '?';
    const suffix = match[2]
      .replace(/[Ωω]/g, 'ohm')
      .replace(/[µμ]/g, 'u')
      .toLowerCase()
      .replace(/ohm/g, '')
      .replace(/hz/g, '')
      .replace(/[fhvaf]/g, '');
    const scale = { '': '', r: '', k: 'k', meg: 'meg', m: 'm', u: 'u', n: 'n', p: 'p', g: 'g', t: 't' };
    return scale[suffix] === undefined ? '?' : `${match[1]}${scale[suffix]}`;
  }

  /** 节点名必须是合法的 SPICE 标识符，而名字来自用户输入，因此过一道白名单。 */
  function spiceIdent(value, fallback) {
    const clean = String(value ?? '').replace(/[^0-9A-Za-z_]/g, '');
    return /^[A-Za-z_]/.test(clean) ? clean : String(fallback ?? 'X');
  }

  /** 按引脚名取出节点下标；所有候选序列都对不上时返回 null。 */
  function netlistNodeIndexes(spec, options) {
    const byName = new Map(spec.pins.map((pin, index) => [String(pin.name).toUpperCase(), index]));
    for (const names of options) {
      const indexes = [];
      for (const name of names) {
        const index = byName.get(name.toUpperCase());
        if (index === undefined) { indexes.length = 0; break; }
        indexes.push(index);
      }
      if (indexes.length) return indexes;
    }
    return null;
  }

  /**
   * 原理图 → SPICE 网表。用并查集把导线连起来的引脚合并成节点，再按
   * 元件顺序输出器件卡；接地引脚所在节点固定叫 0。
   */
  function buildNetlist() {
    const pinKey = (componentId, pin) => `${componentId}\u0000${pin}`;
    const parent = new Map();
    const find = start => {
      let root = start;
      while (parent.get(root) !== root) root = parent.get(root);
      let cursor = start;
      while (parent.get(cursor) !== root) { const next = parent.get(cursor); parent.set(cursor, root); cursor = next; }
      return root;
    };
    const union = (a, b) => { const ra = find(a); const rb = find(b); if (ra !== rb) parent.set(ra, rb); };
    const order = project.components.filter(component => partSpecs[component.type]);

    for (const component of order) {
      effectivePins(component).forEach((_, index) => { const id = pinKey(component.id, index); parent.set(id, id); });
    }
    for (const wire of project.wires) {
      const a = pinKey(wire.from.component, wire.from.pin);
      const b = pinKey(wire.to.component, wire.to.pin);
      if (parent.has(a) && parent.has(b)) union(a, b);
    }

    const groups = new Map();
    for (const component of order) {
      effectivePins(component).forEach((_, index) => {
        const root = find(pinKey(component.id, index));
        if (!groups.has(root)) groups.set(root, []);
        groups.get(root).push({ component, pin: index });
      });
    }

    // 命名：接地 → 0；电源/端口 → 元件名；剩下按出现顺序 net1、net2…
    const used = new Set(['0']);
    const netNames = new Map();
    const unique = base => {
      let name = base;
      let suffix = 2;
      while (used.has(name.toLowerCase())) { name = `${base}_${suffix}`; suffix += 1; }
      used.add(name.toLowerCase());
      return name;
    };
    for (const [root, pins] of groups) {
      if (pins.some(item => item.component.type === 'ground')) { netNames.set(root, '0'); continue; }
      const terminal = pins.find(item => NETLIST_TERMINALS.has(item.component.type));
      if (!terminal) continue;
      const base = spiceIdent(terminal.component.name, 'NODE');
      netNames.set(root, unique(/^[0-9_]/.test(base) ? `n${base}` : base));
    }
    let counter = 0;
    for (const root of groups.keys()) {
      if (netNames.has(root)) continue;
      counter += 1;
      netNames.set(root, unique(`net${counter}`));
    }
    const netOf = (componentId, pin) => netNames.get(find(pinKey(componentId, pin)));

    const cards = [];
    const dangling = [];
    const missing = [];
    const fallback = [];
    const subckts = new Set();
    const models = new Set();
    let devices = 0;

    for (const [root, pins] of groups) {
      if (pins.length > 1) continue;
      const only = pins[0];
      if (NETLIST_SKIP.has(only.component.type)) continue;
      dangling.push(`${only.component.name || only.component.type}:${effectivePins(only.component)[only.pin]?.name || ''}`);
    }

    for (const component of order) {
      if (NETLIST_SKIP.has(component.type)) continue;
      const spec = partSpecs[component.type];
      const label = spiceIdent(component.name, 'X');
      const card = netlistCard(component.type);
      let indexes = card ? netlistNodeIndexes(spec, card.nodes) : null;
      if (card && card.bulk && indexes && indexes.length === 3) indexes = [...indexes, indexes[2]];
      if (!card || !indexes) {
        const name = netlistSubckt(component.type);
        cards.push(`${/^X/i.test(label) ? '' : 'X'}${label} ${effectivePins(component).map((_, index) => netOf(component.id, index)).join(' ')} ${name}`);
        subckts.add(name);
        fallback.push(`${label}（${spec.title}）`);
        devices += 1;
        continue;
      }
      const nodes = indexes.map(index => netOf(component.id, index));
      // 位号本身已带前缀（R1、C1…）时不再重复加一个字母。
      const designator = new RegExp(`^${card.prefix}`, 'i').test(label) ? label : `${card.prefix}${label}`;
      if (card.value) {
        const value = spiceValue(component.value);
        if (value === '?') missing.push(label);
        cards.push(`${designator} ${nodes.join(' ')} ${value}`);
      } else {
        models.add(card.model);
        cards.push(`${designator} ${nodes.join(' ')} ${card.model}`);
      }
      devices += 1;
    }

    const lines = [
      '* 回路 · 电路绘图 · SPICE 网表',
      `* 项目：${project.name || '未命名电路'}`,
      `* 由画布自动推导：${devices} 个器件 · ${groups.size} 个节点`
    ];
    lines.push('', ...cards);
    if (devices === 0) lines.push('* 画布上还没有元件');
    const comments = [];
    if (dangling.length) comments.push(`* 悬空引脚（只有 1 个连接）：${dangling.join('、')}`);
    if (missing.length) comments.push(`* 缺少参数值（已用 ? 占位）：${missing.join('、')}`);
    if (fallback.length) comments.push(`* 下列器件按子电路调用输出：${fallback.join('、')}`);
    if (subckts.size) comments.push(`* 需要对应定义：.subckt ${[...subckts].join(' / ')}`);
    if (models.size) comments.push(`* 器件模型名需要自行声明：.model ${[...models].join(' / ')}`);
    if (comments.length) lines.push('', ...comments);
    lines.push('', '.end');

    return {
      text: lines.join('\n'),
      devices,
      nets: groups.size,
      dangling,
      missing,
      fallback,
      subckts: [...subckts],
      models: [...models]
    };
  }

  function renderNetlist() {
    const data = buildNetlist();
    netlistCode.textContent = data.text;
    const notes = [{ level: 'info', text: `器件 ${data.devices} 个 · 节点 ${data.nets} 个` }];
    if (data.dangling.length) notes.push({ level: 'warn', text: `悬空引脚 ${data.dangling.length} 处：${data.dangling.join('、')}` });
    if (data.missing.length) notes.push({ level: 'warn', text: `缺少参数值 ${data.missing.length} 处：${data.missing.join('、')}` });
    if (data.fallback.length) notes.push({ level: 'warn', text: `按子电路调用输出：${data.fallback.join('、')}` });
    if (data.subckts.length) notes.push({ level: 'info', text: `需要 .subckt 定义：${data.subckts.join('、')}` });
    if (data.models.length) notes.push({ level: 'info', text: `需要 .model 声明：${data.models.join('、')}` });
    if (!data.devices) notes.push({ level: 'info', text: '画布上还没有元件' });
    $('#netlist-note').replaceChildren(...notes.map(item => {
      const line = document.createElement('p');
      line.className = `netlist-note-item ${item.level}`;
      line.textContent = item.text;
      return line;
    }));
  }

  let inspectorTab = 'properties';

  function setInspectorTab(tab) {
    inspectorTab = tab === 'netlist' ? 'netlist' : 'properties';
    $$('[data-inspector-tab]').forEach(button => {
      const active = button.dataset.inspectorTab === inspectorTab;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', String(active));
    });
    inspector.hidden = inspectorTab !== 'properties';
    netlistPane.hidden = inspectorTab !== 'netlist';
    if (inspectorTab === 'netlist') renderNetlist();
  }

  async function copyNetlist() {
    const text = netlistCode.textContent;
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // file:// 下剪贴板 API 常被拒绝，退回到旧的选择 + execCommand 方案。
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.append(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (__) { ok = false; }
      area.remove();
      if (!ok) { toast('复制失败，请在网表里手动选中'); return; }
    }
    toast('网表已复制到剪贴板');
  }

  function exportNetlist() {
    updateProjectName();
    const filename = (project.name || 'circuit').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'circuit';
    download(`${filename}.sp`, `${buildNetlist().text}\n`, 'text/plain;charset=utf-8');
    toast('SPICE 网表已导出');
  }

  /** 参数化图元（函数曲线 / 概率分布 / 数字波形）的属性字段。 */
  function figureFieldsFor(component) {
    if (!FIGURE_TYPES.has(component.type)) return '';
    const { w, h } = figureSize(component);
    const selectField = (id, property, options, current) => `<div class="field"><label for="${id}">类型</label><select id="${id}" data-property="${property}">${options.map(([value, label]) => `<option value="${value}"${value === current ? ' selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></div>`;
    const sizeFields = `<div class="field"><span class="unit">绘制尺寸 ${Math.round(w)} × ${Math.round(h)}</span></div>
      <div class="field"><label for="figure-w">宽度</label><input id="figure-w" data-property="w" type="number" min="40" max="2000" step="1" value="${round2(w)}"></div>
      <div class="field"><label for="figure-h">高度</label><input id="figure-h" data-property="h" type="number" min="30" max="1200" step="1" value="${round2(h)}"></div>`;
    if (component.type === 'math-curve') {
      return `${selectField('figure-fn', 'fn', Object.entries(CURVE_FUNCS).map(([value, item]) => [value, item.label]), component.fn || 'sin')}
        <div class="field"><label for="figure-k">参数 k</label><input id="figure-k" data-property="k" type="number" min="0.2" max="8" step="0.1" value="${round2(Number(component.k) || 1)}"><span class="field-note">周期数 / 陡度，默认 1</span></div>
        ${sizeFields}`;
    }
    if (component.type === 'prob-curve') {
      return `${selectField('figure-dist', 'dist', Object.entries(DIST_FUNCS).map(([value, item]) => [value, item.label]), component.dist || 'normal')}
        <div class="field"><label for="figure-k">参数 k</label><input id="figure-k" data-property="k" type="number" min="0.2" max="8" step="0.1" value="${round2(Number(component.k) || 1)}"><span class="field-note">方差 / 衰减 / 概率参数的形状因子</span></div>
        ${sizeFields}`;
    }
    const { kind } = component;
    const shape = kind === 'bus'
      ? `<div class="field"><label for="figure-pattern">分组标签</label><input id="figure-pattern" data-property="pattern" maxlength="60" value="${escapeHtml(String(component.pattern || 'D0 D1 D2'))}" placeholder="D0 D1 D2"><span class="field-note">空格分隔，每段画一个总线菱形</span></div>`
      : kind === 'signal'
        ? `<div class="field"><label for="figure-pattern">数据序列</label><input id="figure-pattern" data-property="pattern" maxlength="60" value="${escapeHtml(String(component.pattern || '1011'))}" placeholder="1011"><span class="field-note">只取 0 / 1，每位一格</span></div>`
        : `<div class="field"><label for="figure-cycles">周期数</label><input id="figure-cycles" data-property="cycles" type="number" min="1" max="32" step="1" value="${Math.round(Number(component.cycles) || 4)}"></div>
           <div class="field"><label for="figure-duty">占空比 %</label><input id="figure-duty" data-property="duty" type="number" min="5" max="95" step="1" value="${round2(Number(component.duty) || 50)}"></div>`;
    return `${selectField('figure-kind', 'kind', Object.entries(WAVE_KINDS), kind || 'clock')}
      ${shape}
      ${sizeFields}`;
  }

  function renderInspector() {
    fillPreview = null;
    if (!selected) {
      inspector.innerHTML = '<div class="selection-empty" id="selection-empty"><div class="selection-art"><span></span><span></span><span></span></div><strong>选择一个元件</strong><p>元件属性会显示在这里。<br>你也可以选择导线或文字。</p></div>';
      return;
    }
    if (selection.length > 1) {
      const tally = { component: 0, shape: 0, text: 0, wire: 0 };
      selection.forEach(item => { if (tally[item.kind] !== undefined) tally[item.kind] += 1; });
      const summary = [['component', '元件'], ['shape', '图形'], ['text', '文字'], ['wire', '导线']]
        .filter(([kind]) => tally[kind])
        .map(([kind, label]) => `${label} ${tally[kind]}`)
        .join(' · ');
      inspector.innerHTML = `<div class="property-form multi-selection">
        <div class="property-type"><span class="property-symbol">▣</span><div><strong>已选中 ${selection.length} 个对象</strong><small>Multi-selection</small></div></div>
        <div class="field"><span class="unit">${escapeHtml(summary)}</span></div>
        <span class="field-note">拖动其中任意一个即可整组移动；按住 Shift 点选可加选 / 减选；框选后按 Delete 删除。</span>
        <button class="delete-button" data-action="delete"><span>删除所选</span><span>×</span></button>
      </div>`;
      return;
    }
    if (selected.kind === 'component') {
      const component = project.components.find(item => item.id === selected.id);
      if (!component) { clearSelection(); renderInspector(); return; }
      const spec = partSpecs[component.type];
      // 标尺：长度 / 比例 / 单位 三个专属字段
      const rulerFields = component.type === 'ruler'
        ? `<div class="field"><label for="property-length">长度</label><input id="property-length" data-property="length" type="number" min="${RULER_MIN_LENGTH}" step="0.0001" value="${rulerLengthOf(component)}"><span class="field-note">标尺表示的数值，例如 0.5；可拖端点按比例连续调整</span></div>
        <div class="field"><label for="property-scale">比例</label><input id="property-scale" data-property="scale" type="number" min="0.01" step="0.1" value="${round2(rulerScaleOf(component))}"><span class="field-note">1 个单位 = 多少画布单位；当前绘制 ${Math.round(rulerSpanOf(component))} 单位</span></div>
        <div class="field"><label for="property-unit">单位</label><input id="property-unit" data-property="unit" maxlength="8" value="${escapeHtml(rulerUnitOf(component))}" placeholder="μm / ps / mm"></div>`
        : '';
      inspector.innerHTML = `<div class="property-form">
        <div class="property-type"><span class="property-symbol">${escapeHtml(spec.glyph)}</span><div><strong>${escapeHtml(spec.title)}</strong><small>${escapeHtml(spec.english)}</small></div></div>
        <div class="field"><label for="property-name">标号</label><input id="property-name" data-property="name" value="${escapeHtml(component.name)}" maxlength="20"></div>
        ${spec.value ? `<div class="field"><label for="property-value">参数 / 数值</label><input id="property-value" data-property="value" value="${escapeHtml(component.value)}" maxlength="40"><span class="field-note">例如 10 kΩ、100 nF 或 W/L = 10/1 μm</span></div>` : ''}
        ${rulerFields}
        ${figureFieldsFor(component)}
        <div class="field"><label for="property-rotation">旋转角度</label><div class="value-row"><input id="property-rotation" data-property="rotation" type="number" step="90" value="${Number(component.rotation || 0)}"><select id="rotation-preset" aria-label="选择常用角度"><option value="">常用角度</option><option value="0">0°</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></div></div>
        <div class="field"><span class="unit">位置 X ${Math.round(component.x)} · Y ${Math.round(component.y)}</span></div>
        <button class="delete-button" data-action="delete"><span>删除元件</span><span>×</span></button>
      </div>`;
    } else if (selected.kind === 'text') {
      const text = project.texts.find(item => item.id === selected.id);
      if (!text) { clearSelection(); renderInspector(); return; }
      inspector.innerHTML = `<div class="property-form"><div class="property-type"><span class="property-symbol">T</span><div><strong>文字标注</strong><small>Annotation</small></div></div>
        <div class="field"><label for="text-content">内容</label><textarea id="text-content" data-property="text" maxlength="120">${escapeHtml(text.text)}</textarea><span class="field-note">双击画布上的文字也可以编辑</span></div>
        <div class="field"><label for="text-size">字号</label><input id="text-size" data-property="size" type="number" min="10" max="48" step="1" value="${text.size || 18}"></div>
        <button class="delete-button" data-action="delete"><span>删除标注</span><span>×</span></button></div>`;
    } else if (selected.kind === 'shape') {
      const shape = project.shapes.find(item => item.id === selected.id);
      if (!shape) { clearSelection(); renderInspector(); return; }
      const [title, english] = SHAPE_KINDS[shape.kind] || ['图形', 'Shape'];
      const currentFill = sanitizeShapeFill(shape.fill);
      const swatches = SHAPE_FILLS.map(([value, label]) => `<button type="button" class="fill-swatch${value === SHAPE_FILL_NONE ? ' fill-none' : ''}${value === currentFill ? ' active' : ''}" data-shape-fill="${value}" title="${escapeHtml(label)}" aria-label="填充色 ${escapeHtml(label)}"${value === SHAPE_FILL_NONE ? '' : ` style="background:${value}"`}></button>`).join('');
      const fillField = shape.kind === 'image'
        ? '<div class="field"><span class="field-note">Visio 原始图片</span></div>'
        : shape.kind === 'line'
        ? '<div class="field"><label>填充颜色</label><span class="field-note">直线没有内部区域，因此不填充。想画色块可以改用矩形。' + '</span></div>'
        : `<div class="field"><label>填充颜色</label>
          <div class="fill-swatches">${swatches}</div>
          <div class="value-row fill-custom"><input id="shape-fill" type="color" value="${currentFill === SHAPE_FILL_NONE ? '#ffffff' : currentFill}" aria-label="自定义填充颜色"><span class="field-note">第一格是「无填充（透明）」，其余为常用色；点击左边小方块可用取色器选任意颜色。</span></div></div>`;
      const isVariableDiameter = shape.kind === 'octagon' || shape.variableDiameter;
      const dimensionFields = isVariableDiameter
        ? `<div class="field"><label for="shape-diameter">直径</label><input id="shape-diameter" data-property="diameter" type="number" min="${SHAPE_MIN}" step="1" value="${round2(shape.width)}"><span class="field-note">${shape.kind === 'octagon' ? '八边形保持正形' : '圆形保持等径'}；拖动控制点会同步调整直径。</span></div>`
        : `<div class="field"><label for="shape-width">宽度</label><input id="shape-width" data-property="width" type="number" min="1" step="1" value="${round2(shape.width)}"></div>
        <div class="field"><label for="shape-height">高度</label><input id="shape-height" data-property="height" type="number" min="1" step="1" value="${round2(shape.height)}"><span class="field-note">也可以直接拖四角或四边控制点缩放。</span></div>`;
      inspector.innerHTML = `<div class="property-form"><div class="property-type"><span class="property-symbol">▱</span><div><strong>${escapeHtml(title)}</strong><small>${escapeHtml(english)}</small></div></div>
        <div class="field"><span class="unit">位置 X ${Math.round(shape.x)} · Y ${Math.round(shape.y)}</span></div>
        ${shape.blockLabel ? `<div class="field"><label for="shape-label">框内文字</label><textarea id="shape-label" data-property="label" maxlength="120" placeholder="输入要显示在${isVariableDiameter ? (shape.kind === 'octagon' ? '八边形' : '圆形') : '矩形'}中的文字">${escapeHtml(shape.label || '')}</textarea><span class="field-note">${isVariableDiameter ? '最多两行；第二行数字会按直径同比例变化。' : '文字居中换行，字号会随矩形大小自动适配。'}</span></div>` : ''}
        ${shape.kind === 'freeform'
          ? `<div class="field"><span class="unit">原始轮廓 · ${Math.round(shape.width)} × ${Math.round(shape.height)}</span></div>${fillField}<span class="field-note">拖动自由路径可移动；原始轮廓保持不变。</span>`
          : `${dimensionFields}
        ${fillField}
        <span class="field-note">拖动图形可移动；拖四角或四边的控制点可缩放，两者都会吸附网格与其它对象。</span>`}
        <button class="delete-button" data-action="delete"><span>删除图形</span><span>×</span></button></div>`;
    } else {
      const wire = project.wires.find(item => item.id === selected.id);
      if (!wire) { clearSelection(); renderInspector(); return; }
      const byId = new Map(project.components.map(item => [item.id, item]));
      const a = byId.get(wire.from.component);
      const b = byId.get(wire.to.component);
      inspector.innerHTML = `<div class="property-form"><div class="property-type"><span class="property-symbol">⌁</span><div><strong>导线</strong><small>Wire segment</small></div></div>
        <div class="wire-detail">起点　${escapeHtml(a?.name || '未知')} · ${escapeHtml(a ? (effectivePins(a)[wire.from.pin]?.name || '') : '')}<br>终点　${escapeHtml(b?.name || '未知')} · ${escapeHtml(b ? (effectivePins(b)[wire.to.pin]?.name || '') : '')}</div>
        <span class="field-note">导线跟随元件引脚移动。要修改路径，可删除后重新连接。</span>
        <button class="delete-button" data-action="delete"><span>删除导线</span><span>×</span></button></div>`;
    }
  }

  function renderAll() {
    applyUpstreamGeometry();
    renderPaletteIcons();
    renderShapeIcons();
    renderScene();
    renderInspector();
    if (inspectorTab === 'netlist') renderNetlist();
    updateHistoryButtons();
    updateSaveState();
  }

  function setTool(nextTool) {
    tool = nextTool;
    wireStart = null;
    guides = [];
    $$('.tool-button').forEach(button => button.classList.toggle('active', button.dataset.tool === nextTool));
    const hints = {
      select: '点击选中 · 空白处拖框多选（Shift 加减选）· Ctrl+点击穿透下层',
      wire: '依次点击两个引脚完成连接 · Esc 取消',
      text: '点击画布任意位置放置文字标注',
      'free-line': '拖动绘制自由直线 · 松开后可选中和移动',
      'free-curve': '按住鼠标自由绘制平滑曲线 · 松开后可选中和移动',
      shape: shapeKind === 'free-curve' ? '按住鼠标自由绘制平滑曲线 · 松开后可选中和移动'
        : shapeKind === 'free-line' ? '拖动绘制自由直线 · 松开后可选中和移动'
          : `在画布上拖动绘制${(SHAPE_KINDS[shapeKind] || SHAPE_KINDS.rectangle)[0]} · 选中后可在右侧改填充色`
    };
    $('#canvas-hint').textContent = hints[nextTool] || '';
    canvas.style.cursor = nextTool === 'wire' ? 'crosshair' : nextTool === 'text' ? 'text' : ['shape', 'free-line', 'free-curve'].includes(nextTool) ? 'crosshair' : 'default';
    renderScene();
  }

  /** 选中一种图形并切到绘制模式。 */
  function setShapeTool(kind, drawTool = 'shape') {
    if (SHAPE_KINDS[kind]) shapeKind = kind;
    setTool(drawTool);
    toast(`${SHAPE_KINDS[shapeKind][0]}：在画布上拖动绘制`);
  }

  function svgPoint(event) {
    const point = canvas.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = canvas.getScreenCTM();
    if (!matrix) return { x: 0, y: 0 };
    const transformed = point.matrixTransform(matrix.inverse());
    return { x: transformed.x, y: transformed.y };
  }

  function updateCoordinates(point) {
    $('#coordinate-readout').textContent = `X ${String(Math.round(point.x)).padStart(3, '0')} · Y ${String(Math.round(point.y)).padStart(3, '0')}`;
  }

  function updateProjectName() {
    project.name = $('#project-name').value.trim() || '未命名电路';
    updateSaveState();
  }

  function nextRef(type) {
    const letter = ({ resistor: 'R', 'variable-resistor': 'R', capacitor: 'C', 'variable-capacitor': 'C', inductor: 'L', 'variable-inductor': 'L', voltage: 'V', 'pulse-voltage': 'V', 'digital-clock': 'V', current: 'I', battery: 'B', diode: 'D', 'zener-diode': 'D', nmos: 'M', pmos: 'M', 'nmos-bulk': 'M', 'pmos-bulk': 'M', 'nmos-depletion': 'M', 'pmos-depletion': 'M', npn: 'Q', pnp: 'Q', 'ideal-switch': 'S', 'closed-switch': 'S', 'controlled-switch': 'S', dff: 'U', 'dff-reset': 'U', xor: 'U', xnor: 'U', and: 'U', or: 'U', nand: 'U', nor: 'U', not: 'U', buffer: 'U', 'delay-cell': 'U', opamp: 'X', 'fd-amp': 'X', 'voltage-amp': 'X', comparator: 'X', 'comparator-unmarked': 'X', transconductance: 'X', 'differential-transconductance': 'X', port: 'P', 'port-filled': 'P', transformer: 'T', tcoil: 'T', 'inductor-compact': 'L', 'externally-controlled-switch': 'S', ndmos: 'M', pdmos: 'M', 'and-3': 'U', 'and-4': 'U', 'or-3': 'U', 'or-4': 'U', 'nand-3': 'U', 'nand-4': 'U', 'nor-3': 'U', 'nor-4': 'U', 'xor-3': 'U', 'xor-4': 'U', 'xnor-3': 'U', 'xnor-4': 'U', vcvs: 'E', vccs: 'G', ccvs: 'H', cccs: 'F', 'simple-switch': 'S', 'voltage-controlled-switch': 'S', 'spdt-switch': 'S', 'vdd-port': 'VDD', 'dff-q': 'U', 'opamp-wide': 'X', 'opamp-lettered': 'X', 'opamp-inputs-swapped': 'X', 'comparator-inputs-swapped': 'X', adder: 'U', multiplier: 'U', integrator: 'U', 'unit-delay': 'U', 'dt-integrator': 'U', quantizer: 'U', adc: 'U', dac: 'U', ground: 'GND', junction: 'N', ruler: 'RUL', 'math-curve': 'F', 'prob-curve': 'PDF', 'digital-wave': 'W', 'digital-wave-clock': 'CLK', 'digital-wave-signal': 'DQ', 'digital-wave-bus': 'BUS' })[type] || 'X';
    let count = project.components.filter(item => item.name.startsWith(letter)).length + 1;
    let name = `${letter}${count}`;
    while (project.components.some(item => item.name === name)) name = `${letter}${++count}`;
    return name;
  }

  function addComponent(type, x, y) {
    const spec = partSpecs[type];
    if (!spec) return;
    // 可调矩形落到画布上是「图形」对象，尺寸可以在属性里直接填
    if (type === 'rect-block') { addBlockShape(x, y); return; }
    if (spec.variableShape) { addVariableDiameterShape(spec.variableShape, x, y); return; }
    saveHistory();
    const gridX = snapToGrid(clamp(x, 24, CANVAS_W - 24));
    const gridY = snapToGrid(clamp(y, 24, CANVAS_H - 24));
    const draft = { id: '\u0000pending', type, x: gridX, y: gridY, rotation: 0, flip: '' };
    if (type === 'ruler') { draft.length = RULER_LENGTH; draft.scale = RULER_SCALE; draft.unit = ''; }
    applyFigureDefaults(draft);
    const aligned = alignComponent(draft, gridX, gridY);
    guides = [];
    const component = { id: newId('p'), type, name: nextRef(type), value: spec.value, x: aligned.guidedX ? aligned.x : gridX, y: aligned.guidedY ? aligned.y : gridY, rotation: 0 };
    if (type === 'ruler') { component.length = RULER_LENGTH; component.scale = RULER_SCALE; component.unit = ''; }
    if (FIGURE_TYPES.has(type)) {
      component.w = draft.w;
      component.h = draft.h;
      component.k = draft.k;
      if (draft.fn) component.fn = draft.fn;
      if (draft.dist) component.dist = draft.dist;
      if (draft.kind) component.kind = draft.kind;
      if (draft.cycles) component.cycles = draft.cycles;
      if (draft.duty) component.duty = draft.duty;
      if (draft.pattern) component.pattern = draft.pattern;
    }
    project.components.push(component);
    selectOne('component', component.id);
    setTool('select');
    changed();
    if (type === 'ruler') toast('已放置标尺，拖动两端手柄改变长度');
  }

  /** 从元件库放置一个可调矩形（以落点为中心）。 */
  function addBlockShape(x, y) {
    saveHistory();
    const width = 160;
    const height = 100;
    const cx = snapToGrid(clamp(x, 24, CANVAS_W - 24));
    const cy = snapToGrid(clamp(y, 24, CANVAS_H - 24));
    const shape = {
      id: newId('s'), kind: 'rectangle',
      x: cx - width / 2, y: cy - height / 2, width, height,
      fill: shapeFill, order: nextShapeOrder(), blockLabel: true, label: ''
    };
    project.shapes.push(shape);
    selectOne('shape', shape.id);
    setTool('select');
    changed();
    toast('已放置可调矩形，可在右侧填写宽度 / 高度');
  }

  function addVariableDiameterShape(kind, x, y) {
    saveHistory();
    const diameter = 120;
    const cx = snapToGrid(clamp(x, 24, CANVAS_W - 24));
    const cy = snapToGrid(clamp(y, 24, CANVAS_H - 24));
    const shape = {
      id: newId('s'), kind, x: cx - diameter / 2, y: cy - diameter / 2,
      width: diameter, height: diameter, fill: shapeFill, order: nextShapeOrder(),
      blockLabel: true, variableDiameter: true, label: '', labelLines: []
    };
    project.shapes.push(shape);
    selectOne('shape', shape.id);
    setTool('select');
    changed();
    toast(`已放置${kind === 'octagon' ? '可变八边形' : '可变圆形'}，可编辑直径与框内文字`);
  }

  function addText(x, y) {
    saveHistory();
    const text = { id: newId('t'), x: snapToGrid(x), y: snapToGrid(y), text: '双击编辑说明', size: 18 };
    project.texts.push(text);
    selectOne('text', text.id);
    setTool('select');
    changed();
    setTimeout(() => { const field = $('#text-content'); if (field) { field.focus(); field.select(); } }, 0);
  }

  /** 删除选中的全部对象（框选出来的整组一起删）。 */
  function removeSelection() {
    if (!selection.length) return;
    saveHistory();
    const ids = { component: new Set(), shape: new Set(), text: new Set(), wire: new Set() };
    selection.forEach(item => { if (ids[item.kind]) ids[item.kind].add(item.id); });
    if (ids.component.size) {
      project.components = project.components.filter(item => !ids.component.has(item.id));
      // 元件没了，挂在它引脚上的导线一起删
      project.wires = project.wires.filter(wire => !ids.component.has(wire.from.component) && !ids.component.has(wire.to.component));
    }
    if (ids.shape.size) project.shapes = project.shapes.filter(item => !ids.shape.has(item.id));
    if (ids.text.size) project.texts = project.texts.filter(item => !ids.text.has(item.id));
    if (ids.wire.size) project.wires = project.wires.filter(item => !ids.wire.has(item.id));
    const count = selection.length;
    clearSelection();
    changed();
    if (count > 1) toast(`已删除 ${count} 个对象`);
  }

  function beginComponentPointer(event) {
    const pin = event.target.closest('[data-pin]');
    const group = event.currentTarget;
    const componentId = group.dataset.componentId;
    if (pin) {
      event.preventDefault();
      event.stopPropagation();
      if (tool === 'wire') { connectPin(pin.dataset.componentId, Number(pin.dataset.pin)); return; }
    }
    if (tool !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const component = project.components.find(item => item.id === componentId);
    if (!component) return;
    const point = svgPoint(event);
    if (event.ctrlKey || event.metaKey) {
      cycleSelectionAt(point);
      renderAll();
      return;
    }
    if (event.shiftKey) {
      toggleSelectOne('component', componentId);
      renderAll();
      return;
    }
    // 已经在一组多选里：保留整组，一起拖走
    if (!isSelected('component', componentId) || selection.length === 1) selectOne('component', componentId);
    saveHistory();
    drag = {
      kind: 'component', id: componentId, dx: point.x - component.x, dy: point.y - component.y,
      moved: false, originX: component.x, originY: component.y, group: groupSnapshot()
    };
    canvas.setPointerCapture(event.pointerId);
    renderInspector();
    renderScene();
  }

  function beginTextDrag(event) {
    if (tool !== 'select' || event.button !== 0) return;
    event.stopPropagation();
    event.preventDefault();
    const text = project.texts.find(item => item.id === event.currentTarget.dataset.textId);
    if (!text) return;
    const point = svgPoint(event);
    if (event.ctrlKey || event.metaKey) {
      cycleSelectionAt(point);
      renderAll();
      return;
    }
    // 单击压在框图上的文字：先选中它所属的图形（和 Visio 的容器行为一致）。
    // 要单独抓文字：双击进入编辑，或 Ctrl+点击穿透到文字本身。
    if (!event.shiftKey && !isSelected('text', text.id)) {
      const container = containerShapeFor(objectBox('text', text.id));
      if (container) {
        if (!hintedContainer) {
          hintedContainer = true;
          toast('已选中文字所属的框图 · 要单独选文字请双击或 Ctrl+点击');
        }
        beginShapePointer(event, container);
        return;
      }
    }
    if (event.shiftKey) {
      toggleSelectOne('text', text.id);
      renderAll();
      return;
    }
    if (!isSelected('text', text.id) || selection.length === 1) selectOne('text', text.id);
    saveHistory();
    drag = {
      kind: 'text', id: text.id, dx: point.x - text.x, dy: point.y - text.y,
      moved: false, originX: text.x, originY: text.y, group: groupSnapshot()
    };
    canvas.setPointerCapture(event.pointerId);
    renderInspector();
    renderScene();
  }

  /** 选中图形的八个缩放控制点。 */
  function appendShapeHandles(shape) {
    const size = 8 * canvasUnitsPerPixel();
    for (const [handle, fx, fy] of SHAPE_HANDLES) {
      const x = shape.x + shape.width * fx;
      const y = shape.y + shape.height * fy;
      const node = svgElement('rect', {
        x: round2(x - size / 2), y: round2(y - size / 2),
        width: round2(size), height: round2(size),
        class: `shape-handle handle-${handle}`, 'data-handle': handle, 'data-shape-id': shape.id
      });
      node.addEventListener('pointerdown', event => beginShapeResize(event, shape, handle));
      interactionLayer.append(node);
    }
  }

  /** 在画布上拖出一个新图形。 */
  function beginShapeDraw(point) {
    if (shapeKind === 'free-line' || shapeKind === 'free-curve') {
      saveHistory();
      const shape = {
        id: newId('s'), kind: 'freeform', x: point.x, y: point.y, width: 0, height: 0,
        path: 'M 0 0 L 0 0', pathX: 0, pathY: 0, fill: 'none',
        stroke: '#4a6157', sw: 2.4, order: nextShapeOrder()
      };
      project.shapes.push(shape);
      selectOne('shape', shape.id);
      drag = {
        kind: 'freeform-draw', id: shape.id, mode: shapeKind,
        points: shapeKind === 'free-line'
          ? [{ x: point.x, y: point.y }, { x: point.x, y: point.y }]
          : [{ x: point.x, y: point.y }],
        originX: point.x, originY: point.y, moved: false
      };
      renderScene();
      return;
    }
    const x = snapToGrid(point.x);
    const y = snapToGrid(point.y);
    saveHistory();
    const shape = { id: newId('s'), kind: shapeKind, x, y, width: 0, height: 0, fill: shapeFill, order: nextShapeOrder(), ...(shapeKind === 'octagon' ? { blockLabel: true, label: '' } : {}) };
    project.shapes.push(shape);
    selectOne('shape', shape.id);
    drag = { kind: 'shape-draw', id: shape.id, originX: x, originY: y, moved: false };
    renderScene();
  }

  function updateFreeformShape(shape, points, mode) {
    const minX = Math.min(...points.map(point => point.x));
    const minY = Math.min(...points.map(point => point.y));
    const local = points.map(point => ({ x: point.x - minX, y: point.y - minY }));
    let path = `M ${round2(local[0].x)} ${round2(local[0].y)}`;
    if (mode === 'free-line' || local.length === 2) {
      path += ` L ${round2(local[local.length - 1].x)} ${round2(local[local.length - 1].y)}`;
    } else {
      for (let index = 0; index < local.length - 1; index += 1) {
        const p0 = local[Math.max(0, index - 1)];
        const p1 = local[index];
        const p2 = local[index + 1];
        const p3 = local[Math.min(local.length - 1, index + 2)];
        const c1x = p1.x + (p2.x - p0.x) / 6;
        const c1y = p1.y + (p2.y - p0.y) / 6;
        const c2x = p2.x - (p3.x - p1.x) / 6;
        const c2y = p2.y - (p3.y - p1.y) / 6;
        path += ` C ${round2(c1x)} ${round2(c1y)} ${round2(c2x)} ${round2(c2y)} ${round2(p2.x)} ${round2(p2.y)}`;
      }
    }
    const xs = points.map(point => point.x);
    const ys = points.map(point => point.y);
    shape.x = minX;
    shape.y = minY;
    shape.width = Math.max(...xs) - minX;
    shape.height = Math.max(...ys) - minY;
    shape.pathX = 0;
    shape.pathY = 0;
    shape.path = path;
  }

  /** 拖动整个图形。 */
  function beginShapePointer(event, shape) {
    if (tool !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = svgPoint(event);
    if (event.ctrlKey || event.metaKey) {
      cycleSelectionAt(point);
      renderAll();
      return;
    }
    if (event.shiftKey) {
      toggleSelectOne('shape', shape.id);
      renderAll();
      return;
    }
    if (!isSelected('shape', shape.id) || selection.length === 1) selectOne('shape', shape.id);
    saveHistory();
    drag = {
      kind: 'shape-move', id: shape.id, dx: point.x - shape.x, dy: point.y - shape.y,
      moved: false, originX: shape.x, originY: shape.y, group: groupSnapshot(),
      followers: containedTextSnapshot(shape)
    };
    canvas.setPointerCapture(event.pointerId);
    renderInspector();
    renderScene();
  }

  /** 拖控制点缩放图形：只改包围盒，因而任意多边形都能自由拉伸。 */
  function beginShapeResize(event, shape, handle) {
    if (tool !== 'select' || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const point = svgPoint(event);
    selectOne('shape', shape.id);
    saveHistory();
    drag = {
      kind: 'shape-resize', id: shape.id, handle, moved: false,
      originX: shape.x, originY: shape.y, originW: shape.width, originH: shape.height,
      pointerX: point.x, pointerY: point.y
    };
    canvas.setPointerCapture(event.pointerId);
    renderScene();
  }

  function connectPin(componentId, pinIndex) {
    if (!wireStart) {
      wireStart = { component: componentId, pin: pinIndex };
      toast('已选起点，再点一个引脚');
      renderScene();
      return;
    }
    if (wireStart.component === componentId && wireStart.pin === pinIndex) {
      wireStart = null;
      renderScene();
      return;
    }
    saveHistory();
    const wire = { id: newId('w'), from: wireStart, to: { component: componentId, pin: pinIndex } };
    project.wires.push(wire);
    selectOne('wire', wire.id);
    wireStart = null;
    changed();
    toast('导线已连接');
  }

  function download(filename, contents, mimeType) {
    const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportProject() {
    updateProjectName();
    const filename = (project.name || 'circuit').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'circuit';
    const content = JSON.stringify({ format: 'huilu-circuit', version: 1, ...clone(project) }, null, 2);
    download(`${filename}.circuit.json`, content, 'application/json');
    markSaved();
    toast('项目 JSON 已导出');
  }

  function exportCanvasHtml() {
    if (!window.CANVAS_FILE) return;
    updateProjectName();
    const exportedData = {
      ...window.CANVAS_FILE,
      build: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      draft: clone(project)
    };
    const htmlDocument = document.documentElement.cloneNode(true);
    for (const layerId of ['ucie-residual-layer', 'shape-layer', 'wire-layer', 'text-layer', 'component-layer', 'interaction-layer']) {
      htmlDocument.querySelector(`#${layerId}`)?.replaceChildren();
    }
    const dataScript = [...htmlDocument.querySelectorAll('script')]
      .find(script => script.textContent.trimStart().startsWith('window.CANVAS_FILE ='));
    if (!dataScript) {
      toast('没有找到独立画布数据，无法导出 HTML');
      return;
    }
    const dataJson = JSON.stringify(exportedData).replace(/</g, '\\u003c');
    dataScript.textContent = `window.CANVAS_FILE = ${dataJson};`;
    const contents = `<!doctype html>\n${htmlDocument.outerHTML}`;
    const filename = (canvasFile.title || project.name || 'floorplan')
      .replace(/[\\/:*?"<>|]+/g, '-').trim() || 'floorplan';
    download(`${filename}.html`, contents, 'text/html;charset=utf-8');
    markSaved();
    toast('独立 HTML 已导出，可直接打开并继续编辑');
  }

  function exportSvg() {
    const copy = canvas.cloneNode(true);
    copy.removeAttribute('role');
    $('#interaction-layer', copy)?.remove();
    copy.setAttribute('xmlns', NS);
    copy.setAttribute('width', String(CANVAS_W));
    copy.setAttribute('height', String(CANVAS_H));
    const style = svgElement('style');
    style.textContent = '.symbol{stroke:#263934;stroke-width:2;stroke-linecap:butt;stroke-linejoin:miter;fill:none}.symbol-fill{fill:#fbfcfa;stroke:#263934;stroke-width:2}.part-name{font:14px monospace;fill:#344941;text-anchor:middle}.part-value{font:12px monospace;fill:#84918a;text-anchor:middle}.pin{fill:#fbfcfa;stroke:#719c8d;stroke-width:1.7}.wire{fill:none;stroke:#3b7565;stroke-width:2.2;stroke-linejoin:round;stroke-linecap:round}.annotation{font:18px sans-serif;fill:#72847b}.shape{fill:none;stroke:#4a6157;stroke-width:1.6;stroke-linejoin:miter;stroke-linecap:butt}.shape-dashed{stroke-dasharray:8 5}';
    copy.insertBefore(style, copy.firstChild);
    const filename = (project.name || 'circuit').replace(/[\\/:*?"<>|]+/g, '-').trim() || 'circuit';
    download(`${filename}.svg`, new XMLSerializer().serializeToString(copy), 'image/svg+xml;charset=utf-8');
    toast('矢量图 SVG 已导出');
  }

  function validateProject(data) {
    // 引脚来自上游几何，必须在校验导线之前先套用一次：
    // 否则运放家族的 pins 还是空的，任何接到运放的导线都会被判为无效。
    applyUpstreamGeometry();
    if (!data || !Array.isArray(data.components) || !Array.isArray(data.wires) || !Array.isArray(data.texts)) throw new Error('项目文件格式不正确');
    if (data.components.length > 1000 || data.wires.length > 4000 || data.texts.length > 20000) throw new Error('项目内容超出支持上限');
    const shapes = Array.isArray(data.shapes) ? data.shapes : [];
    if (shapes.length > 20000) throw new Error('项目内容超出支持上限');
    const ids = new Set();
    for (const component of data.components) {
      if (!partSpecs[component.type] || typeof component.id !== 'string' || ids.has(component.id)) throw new Error('元件类型或编号无效');
      ids.add(component.id);
      component.x = clamp(Number(component.x) || 0, -10000, 10000);
      component.y = clamp(Number(component.y) || 0, -10000, 10000);
      component.rotation = Number(component.rotation) || 0;
      component.flip = component.flip === 'x' ? 'x' : '';
      if (component.type === 'ruler') {
        component.length = clamp(Number(component.length) || RULER_LENGTH, RULER_MIN_LENGTH, 100000);
        component.scale = clamp(Number(component.scale) || RULER_SCALE, 0.01, 1000);
        component.unit = String(component.unit || '').slice(0, 8);
      }
      if (FIGURE_TYPES.has(component.type)) applyFigureDefaults(component);
      component.name = String(component.name || '').slice(0, 20);
      component.value = String(component.value || '').slice(0, 40);
    }
    for (const wire of data.wires) {
      const start = data.components.find(item => item.id === wire.from?.component);
      const end = data.components.find(item => item.id === wire.to?.component);
      if (!start || !end || !effectivePins(start)[wire.from.pin] || !effectivePins(end)[wire.to.pin]) throw new Error('项目含有无效导线');
    }
    data.texts.forEach(text => { text.text = String(text.text || '').slice(0, 200); text.size = clamp(Number(text.size) || 18, 10, 48); });
    shapes.forEach(shape => {
      shape.kind = SHAPE_KINDS[shape.kind] ? shape.kind : 'rectangle';
      shape.id = String(shape.id || `s${ids.size + 1}`);
      shape.x = clamp(Number(shape.x) || 0, -10000, 10000);
      shape.y = clamp(Number(shape.y) || 0, -10000, 10000);
      shape.width = clamp(Number(shape.width) || 0, 0, 10000);
      shape.height = clamp(Number(shape.height) || 0, 0, 10000);
      shape.variableDiameter = shape.variableDiameter === true;
      if (shape.kind === 'octagon' || shape.variableDiameter) {
        const diameter = clamp(Math.min(shape.width || SHAPE_MIN, shape.height || SHAPE_MIN), SHAPE_MIN, 10000);
        shape.width = diameter;
        shape.height = diameter;
      }
      if (Number.isFinite(Number(shape.labelScaleBaseDiameter)) && Number(shape.labelScaleBaseDiameter) > 0) {
        shape.labelScaleBaseDiameter = clamp(Number(shape.labelScaleBaseDiameter), 0.001, 10000);
      } else delete shape.labelScaleBaseDiameter;
      shape.fill = sanitizeShapeFill(shape.fill);
      shape.stroke = isHexColor(shape.stroke) ? String(shape.stroke).toLowerCase() : '';
      shape.sw = clamp(Number(shape.sw) || 0, 0, 40);
      shape.blockLabel = shape.blockLabel === true;
      shape.label = String(shape.label || '').slice(0, 120);
      if (Array.isArray(shape.labelLines)) shape.labelLines = shape.labelLines.slice(0, 12).map(line => String(line || '').slice(0, 120));
      else delete shape.labelLines;
      const dimension = shape.labelDimension;
      if (dimension && [dimension.width, dimension.height, dimension.baseWidth, dimension.baseHeight].every(value => Number.isFinite(Number(value)) && Number(value) > 0)) {
        shape.labelDimension = {
          width: clamp(Number(dimension.width), 0.001, 100000),
          height: clamp(Number(dimension.height), 0.001, 100000),
          baseWidth: clamp(Number(dimension.baseWidth), 0.001, 10000),
          baseHeight: clamp(Number(dimension.baseHeight), 0.001, 10000),
          separator: /^[*x×]$/.test(dimension.separator) ? dimension.separator : '*'
        };
      } else delete shape.labelDimension;
      if (shape.kind === 'freeform') {
        shape.path = /^[MLCZ0-9eE+.,\s-]+$/i.test(String(shape.path || '')) ? String(shape.path) : '';
        shape.pathX = clamp(Number(shape.pathX) || 0, -10000, 10000);
        shape.pathY = clamp(Number(shape.pathY) || 0, -10000, 10000);
        shape.dash = /^[0-9 .]+$/.test(String(shape.dash || '')) ? shape.dash : '';
        shape.strokeNone = Boolean(shape.strokeNone);
        shape.beginArrow = Boolean(shape.beginArrow);
        shape.endArrow = Boolean(shape.endArrow);
        shape.order = Number(shape.order) || 0;
      }
    });
    return { name: String(data.name || '导入的电路').slice(0, 60), components: data.components, wires: data.wires, texts: data.texts, shapes,
      preserveVisioOrder: data.preserveVisioOrder === true };
  }

  function restoreLocalDraft() {
    try {
      const raw = localStorage.getItem(draftStorageKey);
      if (!raw) return false;
      const saved = JSON.parse(raw);
      // 文件被重新生成过（构建指纹变了）→ 旧草稿已过期，不能拿它盖掉新导出的电路。
      // 否则「在 Virtuoso 里重导一次 → 刷新页面」看到的还是上一次的画面。
      // 没有 build 字段的是本次改动之前存下的旧草稿，同样按过期处理。
      if (canvasFile && canvasFile.build && saved.build !== canvasFile.build) {
        localStorage.removeItem(draftStorageKey);
        staleDraftDropped = true;
        return false;
      }
      project = validateProject(saved.project || saved);
      idCounter = Math.max(idCounter, Number(saved.idCounter) || 20);
      return true;
    } catch (_) {
      return false;
    }
  }

  function importFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(String(reader.result));
        const nextProject = validateProject(raw.project || raw);
        saveHistory();
        project = nextProject;
        idCounter = Math.max(idCounter, project.components.length + project.texts.length + project.wires.length + 20);
        clearSelection();
        $('#project-name').value = project.name;
        changed();
        markSaved();
        toast('项目已从本地文件打开');
      } catch (error) { toast(error.message || '无法读取项目文件'); }
      $('#file-input').value = '';
    };
    reader.onerror = () => toast('读取文件失败');
    reader.readAsText(file);
  }

  function updateZoom(nextZoom, anchor) {
    zoom = clamp(nextZoom, ZOOM_MIN, ZOOM_MAX);
    const width = CANVAS_W / zoom;
    const height = CANVAS_H / zoom;
    if (anchor) {
      const relativeX = (anchor.x - viewBox.x) / viewBox.width;
      const relativeY = (anchor.y - viewBox.y) / viewBox.height;
      viewBox = { x: anchor.x - relativeX * width, y: anchor.y - relativeY * height, width, height };
    } else {
      const centerX = viewBox.x + viewBox.width / 2;
      const centerY = viewBox.y + viewBox.height / 2;
      viewBox = { x: centerX - width / 2, y: centerY - height / 2, width, height };
    }
    renderScene();
  }

  function fitView() {
    // UCIe 编辑模式：画布尺寸就是图纸尺寸，整页适配即可。
    if (canvasFile || (!project.components.length && !project.texts.length)) {
      zoom = 1;
      viewBox = { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H };
      renderScene();
      return;
    }
    const xs = project.components.map(item => item.x).concat(project.texts.map(item => item.x));
    const ys = project.components.map(item => item.y).concat(project.texts.map(item => item.y));
    const minX = Math.min(...xs) - 120;
    const maxX = Math.max(...xs) + 120;
    const minY = Math.min(...ys) - 100;
    const maxY = Math.max(...ys) + 110;
    const width = Math.max(maxX - minX, 500);
    const height = Math.max(maxY - minY, width * 2 / 3);
    const fitScale = Math.min(CANVAS_W / width, CANVAS_H / height, 1.6);
    zoom = clamp(fitScale, ZOOM_MIN, ZOOM_MAX);
    const viewWidth = CANVAS_W / zoom;
    const viewHeight = CANVAS_H / zoom;
    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;
    viewBox = { x: centerX - viewWidth / 2, y: centerY - viewHeight / 2, width: viewWidth, height: viewHeight };
    renderScene();
  }

  function setBlankProject() {
    const resetLabel = canvasFile ? '重置为 Visio 原始框图？未保存的更改会被替换。' : '新建图纸？未保存的更改会被替换。';
    if (!confirm(resetLabel)) return;
    saveHistory();
    project = canvasFile ? ucieDraft() : { name: '未命名电路', components: [], wires: [], texts: [], shapes: [] };
    $('#project-name').value = project.name;
    clearSelection();
    zoom = 1;
    viewBox = { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H };
    changed();
    toast(canvasFile ? '已重置为 Visio 原始框图' : '已新建空白图纸');
  }

  function loadExample() {
    saveHistory();
    project = starterProject();
    $('#project-name').value = project.name;
    clearSelection();
    zoom = 1;
    viewBox = { x: 0, y: 0, width: CANVAS_W, height: CANVAS_H };
    changed();
    toast('RC 示例电路已载入');
  }

  function updateInspectorProperty(event) {
    const field = event.target.closest('[data-property]');
    if (!field) return;
    const property = field.dataset.property;
    const target = selected?.kind === 'component'
      ? project.components.find(item => item.id === selected.id)
      : selected?.kind === 'text' ? project.texts.find(item => item.id === selected.id)
        : selected?.kind === 'shape' ? project.shapes.find(item => item.id === selected.id) : null;
    if (!target) return;
    if (property === 'fill') { setShapeFill(field.value); return; }
    const numeric = ['rotation', 'size', 'width', 'height', 'diameter', 'length', 'scale', 'w', 'h', 'k', 'cycles', 'duty'].includes(property);
    const nextValue = numeric ? Number(field.value) : field.value;
    const variableDiameter = target.kind === 'octagon' || target.variableDiameter === true;
    if (target[property] === nextValue || (property === 'diameter' && variableDiameter && target.width === nextValue && target.height === nextValue)) return;
    saveHistory();
    if (property === 'rotation') target.rotation = ((Math.round((nextValue || 0) / 90) * 90) % 360 + 360) % 360;
    else if (property === 'diameter' && variableDiameter) target.width = target.height = clamp(nextValue || SHAPE_MIN, SHAPE_MIN, 10000);
    else if (property === 'size') target.size = clamp(nextValue || 18, 10, 48);
    else if (property === 'width') { target.width = clamp(nextValue || 1, 1, 10000); if (variableDiameter) target.height = target.width; }
    else if (property === 'height') { target.height = clamp(nextValue || 1, 1, 10000); if (variableDiameter) target.width = target.height; }
    else if (property === 'length') target.length = clamp(nextValue || RULER_MIN_LENGTH, RULER_MIN_LENGTH, 100000);
    else if (property === 'scale') target.scale = clamp(nextValue || 1, 0.01, 1000);
    else if (property === 'w') target.w = clamp(nextValue || 40, 40, 2000);
    else if (property === 'h') target.h = clamp(nextValue || 30, 30, 1200);
    else if (property === 'k') target.k = clamp(nextValue || 1, 0.2, 8);
    else if (property === 'cycles') target.cycles = Math.round(clamp(nextValue || 4, 1, 32));
    else if (property === 'duty') target.duty = clamp(nextValue || 50, 5, 95);
    else if (property === 'pattern') target.pattern = String(nextValue || '').slice(0, 60);
    else if (property === 'fn') target.fn = CURVE_FUNCS[nextValue] ? nextValue : 'sin';
    else if (property === 'dist') target.dist = DIST_FUNCS[nextValue] ? nextValue : 'normal';
    else if (property === 'kind') target.kind = WAVE_KINDS[nextValue] ? nextValue : 'clock';
    else target[property] = nextValue;
    changed();
  }

  canvas.addEventListener('pointermove', event => {
    const point = svgPoint(event);
    pointerPosition = point;
    updateCoordinates(point);
    if (panDrag) {
      const scale = canvasUnitsPerPixel();
      viewBox = {
        x: panDrag.view.x - (event.clientX - panDrag.x) * scale,
        y: panDrag.view.y - (event.clientY - panDrag.y) * scale,
        width: panDrag.view.width,
        height: panDrag.view.height
      };
      renderScene();
      return;
    }
    // 框选：拖动中实时刷新选框
    if (marquee) {
      marquee.x1 = point.x;
      marquee.y1 = point.y;
      if (Math.hypot(marquee.x1 - marquee.x0, marquee.y1 - marquee.y0) > DRAG_THRESHOLD * canvasUnitsPerPixel()) marquee.moved = true;
      renderScene();
      return;
    }
    if (drag && drag.kind === 'freeform-draw') {
      const shape = project.shapes.find(item => item.id === drag.id);
      if (!shape) return;
      const distance = Math.hypot(point.x - drag.originX, point.y - drag.originY);
      if (drag.mode === 'free-line') {
        drag.points[1] = point;
      } else if (distance >= 3 * canvasUnitsPerPixel()) {
        const last = drag.points[drag.points.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) >= 2 * canvasUnitsPerPixel()) drag.points.push(point);
      }
      updateFreeformShape(shape, drag.points, drag.mode);
      drag.moved = distance >= DRAG_THRESHOLD * canvasUnitsPerPixel();
      renderScene();
      return;
    }

    if (drag && drag.kind === 'freeform-draw') {
      const shape = project.shapes.find(item => item.id === drag.id);
      if (!shape) return;
      const distance = Math.hypot(point.x - drag.originX, point.y - drag.originY);
      if (drag.mode === 'free-line') {
        drag.points[1] = point;
      } else if (distance >= 3 * canvasUnitsPerPixel()) {
        const last = drag.points[drag.points.length - 1];
        if (Math.hypot(point.x - last.x, point.y - last.y) >= 2 * canvasUnitsPerPixel()) drag.points.push(point);
      }
      updateFreeformShape(shape, drag.points, drag.mode);
      drag.moved = distance >= DRAG_THRESHOLD * canvasUnitsPerPixel();
      renderScene();
      return;
    }

    if (drag && drag.kind === 'shape-draw') {
      const shape = project.shapes.find(item => item.id === drag.id);
      if (!shape) return;
      const edgeX = snapToGrid(point.x);
      const edgeY = snapToGrid(point.y);
      if (shape.kind === 'octagon') {
        const diameter = Math.min(Math.abs(edgeX - drag.originX), Math.abs(edgeY - drag.originY));
        shape.x = edgeX < drag.originX ? drag.originX - diameter : drag.originX;
        shape.y = edgeY < drag.originY ? drag.originY - diameter : drag.originY;
        shape.width = diameter;
        shape.height = diameter;
      } else {
        shape.x = Math.min(drag.originX, edgeX);
        shape.y = Math.min(drag.originY, edgeY);
        shape.width = Math.abs(edgeX - drag.originX);
        shape.height = Math.abs(edgeY - drag.originY);
      }
      drag.moved = true;
      renderScene();
      return;
    }

    if (drag && drag.kind === 'ruler-resize') {
      const component = project.components.find(item => item.id === drag.id);
      if (!component) return;
      const projected = (point.x - drag.fixed.x) * drag.dirX + (point.y - drag.fixed.y) * drag.dirY;
      const span = clamp(projected, Math.max(0.000001, RULER_MIN_LENGTH * drag.scale), RULER_MAX_SPAN);
      const half = span / 2;
      component.x = drag.fixed.x + drag.dirX * half;
      component.y = drag.fixed.y + drag.dirY * half;
      component.length = Number((span / drag.scale).toPrecision(6));
      drag.moved = true;
      renderScene();
      return;
    }

    if (drag && drag.kind === 'shape-resize') {
      const shape = project.shapes.find(item => item.id === drag.id);
      if (!shape) return;
      const dx = point.x - drag.pointerX;
      const dy = point.y - drag.pointerY;
      if (shape.kind === 'octagon' || shape.variableDiameter) {
        const horizontal = drag.handle.includes('e') ? drag.originW + dx : drag.handle.includes('w') ? drag.originW - dx : drag.originW;
        const vertical = drag.handle.includes('s') ? drag.originH + dy : drag.handle.includes('n') ? drag.originH - dy : drag.originH;
        const changedWidth = drag.handle.includes('e') || drag.handle.includes('w');
        const changedHeight = drag.handle.includes('n') || drag.handle.includes('s');
        const diameter = clamp(snapToGrid(changedWidth && changedHeight
          ? (Math.abs(horizontal - drag.originW) >= Math.abs(vertical - drag.originH) ? horizontal : vertical)
          : changedWidth ? horizontal : vertical), SHAPE_MIN, 10000);
        shape.x = drag.handle.includes('w') ? drag.originX + drag.originW - diameter
          : drag.handle.includes('e') ? drag.originX : drag.originX + (drag.originW - diameter) / 2;
        shape.y = drag.handle.includes('n') ? drag.originY + drag.originH - diameter
          : drag.handle.includes('s') ? drag.originY : drag.originY + (drag.originH - diameter) / 2;
        shape.width = diameter;
        shape.height = diameter;
        drag.moved = true;
        renderScene();
        return;
      }
      let left = drag.originX;
      let top = drag.originY;
      let right = drag.originX + drag.originW;
      let bottom = drag.originY + drag.originH;
      if (drag.handle.includes('w')) left = snapToGrid(drag.originX + dx);
      if (drag.handle.includes('e')) right = snapToGrid(drag.originX + drag.originW + dx);
      if (drag.handle.includes('n')) top = snapToGrid(drag.originY + dy);
      if (drag.handle.includes('s')) bottom = snapToGrid(drag.originY + drag.originH + dy);
      // 保底最小尺寸：宁可停住，也不让包围盒翻转。
      if (right - left < SHAPE_MIN) { if (drag.handle.includes('w')) left = right - SHAPE_MIN; else right = left + SHAPE_MIN; }
      if (bottom - top < SHAPE_MIN) { if (drag.handle.includes('n')) top = bottom - SHAPE_MIN; else bottom = top + SHAPE_MIN; }
      shape.x = left;
      shape.y = top;
      shape.width = right - left;
      shape.height = bottom - top;
      drag.moved = true;
      renderScene();
      return;
    }

    if (drag) {
      const target = drag.kind === 'component'
        ? project.components.find(item => item.id === drag.id)
        : drag.kind === 'shape-move'
          ? project.shapes.find(item => item.id === drag.id)
          : project.texts.find(item => item.id === drag.id);
      if (!target) return;
      const rawX = point.x - drag.dx;
      const rawY = point.y - drag.dy;
      // 微小位移视为点击，避免仅仅选中时就把对象挪到网格上。
      if (!drag.moved && Math.hypot(rawX - drag.originX, rawY - drag.originY) < DRAG_THRESHOLD) return;
      drag.moved = true;
      const gridX = snapToGrid(rawX);
      const gridY = snapToGrid(rawY);
      if (drag.group && drag.group.length > 1) {
        // 整组拖动：按被拖对象的位移统一平移，组内相对位置不变
        const deltaX = gridX - drag.originX;
        const deltaY = gridY - drag.originY;
        for (const member of drag.group) {
          const entry = member.kind === 'component' ? project.components.find(item => item.id === member.id)
            : member.kind === 'shape' ? project.shapes.find(item => item.id === member.id)
              : project.texts.find(item => item.id === member.id);
          if (entry) { entry.x = member.x + deltaX; entry.y = member.y + deltaY; }
        }
      } else if (drag.kind === 'component' || drag.kind === 'shape-move') {
        // 有对齐线时优先对齐场景里的其它对象，否则回落到网格。
        const aligned = drag.kind === 'component' ? alignComponent(target, gridX, gridY) : alignShape(target, gridX, gridY);
        target.x = aligned.guidedX ? aligned.x : gridX;
        target.y = aligned.guidedY ? aligned.y : gridY;
        // 图形里面的文字跟着一起走，别把标签落下
        if (drag.followers && drag.followers.length) {
          const moveX = target.x - drag.originX;
          const moveY = target.y - drag.originY;
          for (const follower of drag.followers) {
            const label = project.texts.find(item => item.id === follower.id);
            if (label) { label.x = follower.x + moveX; label.y = follower.y + moveY; }
          }
        }
      } else {
        target.x = gridX;
        target.y = gridY;
      }
      renderScene();
    } else if (wireStart) {
      const component = project.components.find(item => item.id === wireStart.component);
      const draft = interactionLayer.querySelector('.draft-wire');
      if (component && draft) {
        const target = nearestPin(point, wireStart);
        const end = target ? { x: target.x, y: target.y } : { x: snapToGrid(point.x), y: snapToGrid(point.y) };
        draft.setAttribute('d', pathBetween(pinPosition(component, wireStart.pin), end));
        highlightSnapPin(target);
      }
    }
  });

  canvas.addEventListener('pointerup', () => {
    if (panDrag) { panDrag = null; canvas.classList.remove('panning'); return; }
    // 框选结束：选中与选框相交的元件 / 图形 / 文字
    if (marquee) {
      const finished = marquee;
      const box = marqueeBox();
      marquee = null;
      if (finished.moved && box) {
        const hits = itemsInBox(box, finished.additive ? selection : []);
        setSelection(hits);
        if (hits.length > 1) toast(`已选中 ${hits.length} 个对象，可直接拖动整组`);
      } else if (!finished.additive) {
        clearSelection();
      }
      renderAll();
      return;
    }
    if (!drag) return;
    const finished = drag;
    drag = null;
    guides = [];
    if (finished.kind === 'freeform-draw') {
      const shape = project.shapes.find(item => item.id === finished.id);
      if (!shape || !finished.moved) {
        project.shapes = project.shapes.filter(item => item.id !== finished.id);
        if (undoStack.length) undoStack.pop();
        updateHistoryButtons();
        renderScene();
        return;
      }
      selectOne('shape', shape.id);
      setTool('select');
      changed();
      return;
    }
    if (finished.kind === 'freeform-draw') {
      const shape = project.shapes.find(item => item.id === finished.id);
      if (!shape || !finished.moved) {
        project.shapes = project.shapes.filter(item => item.id !== finished.id);
        if (undoStack.length) undoStack.pop();
        updateHistoryButtons();
        renderScene();
        return;
      }
      selectOne('shape', shape.id);
      setTool('select');
      changed();
      return;
    }
    if (finished.kind === 'shape-draw') {
      const shape = project.shapes.find(item => item.id === finished.id);
      // 只是点了一下：撤掉这个空图形与对应的历史记录。
      if (!shape || shape.width < SHAPE_MIN || shape.height < SHAPE_MIN) {
        project.shapes = project.shapes.filter(item => item.id !== finished.id);
        if (undoStack.length) undoStack.pop();
        updateHistoryButtons();
        renderScene();
        return;
      }
      selectOne('shape', shape.id);
      setTool('select');
      changed();
      return;
    }
    if (finished.moved) {
      renderAll();
      updateSaveState();
      try { localStorage.setItem(draftStorageKey, snapshot()); } catch (_) { /* optional */ }
    } else {
      // 只是点了一下（没有拖动）：把多选收敛为这一个对象，与 Visio 一致
      const kind = finished.kind === 'shape-move' ? 'shape' : finished.kind;
      if (selection.length > 1 && ['component', 'shape', 'text'].includes(kind) && isSelected(kind, finished.id)) {
        selectOne(kind, finished.id);
      }
      if (undoStack.length) undoStack.pop();
      updateHistoryButtons();
      renderAll();
    }
  });

  canvas.addEventListener('pointerdown', event => {
    // 平移视图：中键拖动，或按住空格 / Alt 拖动
    if (event.button === 1 || spaceDown || event.altKey) {
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      panDrag = { x: event.clientX, y: event.clientY, view: { ...viewBox } };
      canvas.classList.add('panning');
      return;
    }
    const drawingShape = ['shape', 'free-line', 'free-curve'].includes(tool);
    if (!drawingShape && (event.target.closest('[data-component-id]') || event.target.closest('[data-text-id]') || event.target.closest('[data-wire-id]') || event.target.closest('[data-shape-id]'))) return;
    const point = svgPoint(event);
    pointerPosition = point;
    if (tool === 'text') { addText(point.x, point.y); return; }
    if (drawingShape) {
      canvas.setPointerCapture(event.pointerId);
      beginShapeDraw(point);
      return;
    }
    if (tool === 'wire') {
      // 点空处也能落在附近引脚上，不必精确击中。
      const target = nearestPin(point, wireStart);
      if (target) connectPin(target.component.id, target.index);
      else if (wireStart) { wireStart = null; guides = []; renderScene(); }
      return;
    }
    // 选择工具：空白处按下 = 拉框多选（按住 Shift 为加选）
    if (tool === 'select') {
      if (!event.shiftKey) clearSelection();
      marquee = { x0: point.x, y0: point.y, x1: point.x, y1: point.y, additive: event.shiftKey, moved: false };
      canvas.setPointerCapture(event.pointerId);
      renderAll();
      return;
    }
    clearSelection();
    renderAll();
  });

  canvas.addEventListener('pointercancel', () => { drag = null; panDrag = null; marquee = null; canvas.classList.remove('panning'); });
  canvas.addEventListener('wheel', event => {
    event.preventDefault();
    const point = svgPoint(event);
    updateZoom(zoom * (event.deltaY < 0 ? 1.1 : 0.9), point);
  }, { passive: false });

  // ── 元件库拖放 ───────────────────────────────────────────────────────────
  // 浏览器原生 HTML5 拖放在 VS Code 内嵌浏览器里拖不出东西，这里改用
  // pointerdown/move/up + 跟随光标的幽灵图标自己实现，任何环境都能拖。
  const libraryGhost = document.createElement('div');
  libraryGhost.className = 'library-ghost';
  libraryGhost.hidden = true;
  document.body.append(libraryGhost);
  let libDrag = null;
  let libDragMoved = false;

  /** 客户端坐标 -> 画布坐标；落在画布之外返回 null。 */
  function canvasPointFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom) return null;
    return {
      x: viewBox.x + ((clientX - rect.left) / rect.width) * viewBox.width,
      y: viewBox.y + ((clientY - rect.top) / rect.height) * viewBox.height
    };
  }

  function moveLibraryGhost(event) {
    libraryGhost.style.left = `${event.clientX}px`;
    libraryGhost.style.top = `${event.clientY}px`;
  }

  function stopLibraryGhost() {
    libraryGhost.hidden = true;
    libraryGhost.innerHTML = '';
    document.body.classList.remove('library-dragging');
  }

  $$('.part-button[data-type]').forEach(button => {
    // 交给下面的指针拖放，避免原生拖放抢走指针事件
    button.removeAttribute('draggable');
    button.addEventListener('click', () => {
      if (libDragMoved) { libDragMoved = false; return; }
      addComponent(button.dataset.type, 600 + (Math.random() * 80 - 40), 380 + (Math.random() * 70 - 35));
    });
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      libDragMoved = false;
      libDrag = { type: button.dataset.type, x: event.clientX, y: event.clientY, started: false, pointerId: event.pointerId };
      try { button.setPointerCapture(event.pointerId); } catch (_) { /* 某些环境不支持，忽略 */ }
    });
    button.addEventListener('pointermove', event => {
      if (!libDrag || event.pointerId !== libDrag.pointerId) return;
      if (!libDrag.started) {
        if (Math.hypot(event.clientX - libDrag.x, event.clientY - libDrag.y) < 5) return;
        libDrag.started = true;
        libDragMoved = true;
        libraryGhost.innerHTML = button.querySelector('.part-icon')?.innerHTML || '';
        libraryGhost.hidden = false;
        document.body.classList.add('library-dragging');
      }
      moveLibraryGhost(event);
    });
    const finishLibraryDrag = event => {
      if (!libDrag || event.pointerId !== libDrag.pointerId) return;
      const drag = libDrag;
      libDrag = null;
      if (!drag.started) return;   // 没有移动过：按普通点击处理
      stopLibraryGhost();
      const point = canvasPointFromClient(event.clientX, event.clientY);
      if (point) addComponent(drag.type, point.x, point.y);
    };
    button.addEventListener('pointerup', finishLibraryDrag);
    button.addEventListener('pointercancel', () => { libDrag = null; stopLibraryGhost(); });
  });

  $$('.shape-part').forEach(button => {
    button.addEventListener('click', () => setShapeTool(button.dataset.shape));
  });

  canvas.addEventListener('dragover', event => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; });
  canvas.addEventListener('drop', event => {
    event.preventDefault();
    const type = event.dataTransfer.getData('application/x-huilu-component');
    if (!type) return;
    const point = svgPoint(event);
    addComponent(type, point.x, point.y);
  });

  $$('.tool-button').forEach(button => button.addEventListener('click', () => {
    if (button.dataset.tool === 'free-line' || button.dataset.tool === 'free-curve') {
      setShapeTool(button.dataset.tool, button.dataset.tool);
    } else {
      setTool(button.dataset.tool);
    }
  }));
  $$('[data-tool="text"]').forEach(button => button.addEventListener('click', () => setTool('text')));
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  $('#zoom-in').addEventListener('click', () => updateZoom(zoom * 1.15));
  $('#zoom-out').addEventListener('click', () => updateZoom(zoom / 1.15));
  $('#fit-view').addEventListener('click', fitView);
  $('#new-project').addEventListener('click', setBlankProject);
  $('#load-example').addEventListener('click', loadExample);
  $('#open-project').addEventListener('click', () => $('#file-input').click());
  $('#file-input').addEventListener('change', event => importFile(event.target.files[0]));
  $('#save-project').addEventListener('click', exportProject);
  $('#save-html')?.addEventListener('click', exportCanvasHtml);
  $('#export-svg').addEventListener('click', exportSvg);
  $('#license-open').addEventListener('click', () => { $('#license-overlay').hidden = false; });
  $('#license-close').addEventListener('click', () => { $('#license-overlay').hidden = true; });
  $('#license-overlay').addEventListener('click', event => { if (event.target.id === 'license-overlay') $('#license-overlay').hidden = true; });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !$('#license-overlay').hidden) { $('#license-overlay').hidden = true; }
  });
  $('#project-name').addEventListener('change', () => { saveHistory(); updateProjectName(); changed(); });
  $('#collapse-library').addEventListener('click', () => workspace.classList.toggle('library-collapsed'));
  $('#collapse-inspector').addEventListener('click', () => workspace.classList.toggle('inspector-collapsed'));
  $$('[data-inspector-tab]').forEach(button => button.addEventListener('click', () => setInspectorTab(button.dataset.inspectorTab)));
  $('#netlist-copy').addEventListener('click', copyNetlist);
  $('#netlist-export').addEventListener('click', exportNetlist);
  $('#part-search').addEventListener('input', event => {
    const query = event.target.value.trim().toLowerCase();
    $$('.part-group').forEach(group => {
      let shown = 0;
      $$('.part-button', group).forEach(button => {
        const match = !query || button.textContent.toLowerCase().includes(query) || button.dataset.type?.includes(query);
        button.hidden = !match;
        if (match) shown++;
      });
      group.hidden = shown === 0;
    });
  });

  inspector.addEventListener('change', event => {
    if (event.target.id === 'shape-label') labelPreview = null;
    updateInspectorProperty(event);
  });
  document.addEventListener('keyup', event => {
    if (event.code === 'Space') { spaceDown = false; canvas.classList.remove('pannable'); }
  });
  window.addEventListener('blur', () => { spaceDown = false; canvas.classList.remove('pannable'); });
  inspector.addEventListener('keydown', event => {
    if (event.target.matches('[data-property]') && event.key === 'Enter' && event.target.tagName !== 'TEXTAREA') {
      event.preventDefault();
      event.target.blur();
    }
  });
  inspector.addEventListener('click', event => {
    const swatch = event.target.closest('[data-shape-fill]');
    if (swatch) { setShapeFill(swatch.dataset.shapeFill); return; }
    if (event.target.closest('[data-action="delete"]')) removeSelection();
  });
  inspector.addEventListener('input', event => {
    if (event.target.id === 'shape-label') {
      const shape = selected?.kind === 'shape' ? project.shapes.find(item => item.id === selected.id) : null;
      if (!shape) return;
      if (labelPreview === null) { labelPreview = shape.label || ''; saveHistory(); }
      shape.label = event.target.value.slice(0, 120);
      if (shape.kind === 'octagon' || shape.variableDiameter) updateOctagonLabel(shape);
      else {
        delete shape.labelLines;
        delete shape.labelDimension;
        delete shape.labelScaleBaseDiameter;
      }
      renderScene();
      updateSaveState();
      try { localStorage.setItem(draftStorageKey, snapshot()); } catch (_) { /* optional browser recovery */ }
      return;
    }
    if (event.target.id !== 'shape-fill') return;
    const shape = selected?.kind === 'shape' ? project.shapes.find(item => item.id === selected.id) : null;
    if (!shape || shape.kind === 'line') return;
    if (fillPreview === null) { fillPreview = sanitizeShapeFill(shape.fill); saveHistory(); }
    shape.fill = sanitizeShapeFill(event.target.value);
    shapeFill = shape.fill;
    renderScene();
  });
  inspector.addEventListener('change', event => {
    if (event.target.id === 'shape-fill') {
      const shape = selected?.kind === 'shape' ? project.shapes.find(item => item.id === selected.id) : null;
      if (shape && shape.kind !== 'line') { shape.fill = sanitizeShapeFill(event.target.value); shapeFill = shape.fill; }
      fillPreview = null;
      changed();
      return;
    }
    if (event.target.id === 'rotation-preset' && event.target.value !== '') {
      const rotation = $('#property-rotation');
      rotation.value = event.target.value;
      rotation.dispatchEvent(new Event('change', { bubbles: true }));
    }
  });

  document.addEventListener('keydown', event => {
    const editing = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
    if (event.code === 'Space' && !editing) { spaceDown = true; canvas.classList.add('pannable'); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') { event.preventDefault(); exportProject(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') { event.preventDefault(); event.shiftKey ? redo() : undo(); return; }
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return; }
    if (editing) return;
    if (event.key === 'Escape') { clearSelection(); wireStart = null; setTool('select'); renderAll(); }
    else if (event.key === 'Delete' || event.key === 'Backspace') removeSelection();
    else if (event.key.toLowerCase() === 'w') setTool('wire');
    else if (event.key.toLowerCase() === 't') setTool('text');
    else if (event.key.toLowerCase() === 's') setTool('shape');
    else if (event.key.toLowerCase() === 'r') addComponent('resistor', 600, 380);
    else if (event.key.toLowerCase() === 'c') addComponent('capacitor', 600, 380);
    else if (event.key.toLowerCase() === 'l') addComponent('inductor', 600, 380);
    else if (event.key.toLowerCase() === 'v') addComponent('voltage', 600, 380);
    else if (event.key.toLowerCase() === 'g') addComponent('ground', 600, 380);
    else if (event.key.toLowerCase() === 'j') addComponent('junction', 600, 380);
    else if (event.key.toLowerCase() === 'd') addComponent('diode', 600, 380);
    else if (event.key.toLowerCase() === 'm') addComponent('nmos', 600, 380);
    else if (event.key.toLowerCase() === 'p') addComponent('pmos', 600, 380);
    else if (event.key.toLowerCase() === 'q') addComponent('npn', 600, 380);
    else if (event.key.toLowerCase() === 'b') addComponent('pnp', 600, 380);
    else if (event.key.toLowerCase() === 'f') addComponent('dff', 600, 380);
    else if (event.key.toLowerCase() === 'x') addComponent('xor', 600, 380);
    else if (event.key.toLowerCase() === 'a') addComponent('and', 600, 380);
    else if (event.key.toLowerCase() === 'o') addComponent('or', 600, 380);
    else if (event.key.toLowerCase() === 'n') addComponent('nand', 600, 380);
    else if (event.key.toLowerCase() === 'z') addComponent('nor', 600, 380);
    else if (event.key === '!') addComponent('not', 600, 380);
  });

  $('#rotation-preset')?.addEventListener('change', () => {});
  const restoredDraft = restoreLocalDraft();
  // 画布文件：本地草稿优先，其次是文件自带的初始图纸
  if (!restoredDraft && canvasFile) project = ucieDraft();
  $('#project-name').value = project.name;
  configureCanvasFile();
  setInspectorTab('properties');
  renderAll();
  markSaved();
  updateHistoryButtons();
  if (restoredDraft) toast('已恢复上次本地草稿');
  else if (staleDraftDropped) toast('画布文件已更新，已丢弃过期的本地草稿');
})();
