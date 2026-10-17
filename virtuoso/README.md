# Virtuoso 一键导出 —— 把原理图变成可编辑的 HTML 电路图

在 **Virtuoso Schematic Editor** 里对着原理图点一下（图标栏按钮 / 菜单 / 快捷键），
就把当前 schematic 导出成 [circuit-canvas](../README.md) 的可编辑 HTML 电路图：
元件换成回路元件库里的符号、导线按真实连接关系重画、网络名与图上标注一并带过来。

```mermaid
graph LR
  A[Virtuoso Schematic Editor<br/>当前 cellview] -->|cc_export.il<br/>纯 SKILL| B[schematic.json<br/>实例/网络/引脚/label]
  B -->|tools/virtuoso-to-canvas.py| C[可编辑 HTML 电路图<br/>+ 实时 SPICE 网表]
  C --> D[浏览器 / 分享 / 继续编辑]
```

## 安装（一次）

在 `~/.cdsinit` 里加三行：

```skill
ccRepoPath = "/work/agent_cowork/circuit-canvas"
;; ccOutputDir = "/home/me/circuit_html"     ; 默认 ~/circuit_canvas_out
load(strcat(ccRepoPath "/virtuoso/circuit_canvas.il"))
```

重启 Virtuoso 即可，CIW 会打印：

```
[circuit-canvas] 已安装：菜单栏【回路】/ Ctrl+Shift+G / 右键菜单 / ccGenerateHtml()
```

想再要一个**图标栏按钮**（真正的一键），把下面这行也加上：

```skill
ccFixedMenuOn = t
```

> ⚠️ `ccFixedMenuOn = t` 会在 schematic 图标栏加一排【回路】按钮，但 Cadence 的
> `schRegisterFixedMenu` 是**替换**语义，默认图标会换成这几颗。想还原随时执行
> `schUnregisterFixedMenu("schematic")`，或 `ccInstallFixedMenu()` / `ccUninstallFixedMenu()` 切换。

## 用法

| 入口 | 操作 |
|------|------|
| 菜单栏 | schematic 窗口菜单栏【回路】→ 生成 HTML 电路图 |
| 图标栏 | （需 `ccFixedMenuOn = t`）点【生成 HTML 电路图】 |
| 快捷键 | `Ctrl+Shift+G`（Schematics 工具下） |
| 右键 | 画布空白处 / 选中对象 → 回路 → 生成 HTML 电路图 |
| CIW | Tools → 回路：生成 HTML 电路图 |
| 命令行 | `ccGenerateHtml()` / `ccGenerateHtmlQuiet(list("myLib" "myCell"))` |
| 另存为 | 菜单栏【回路】→ 生成 HTML（另存为…），可指定目录/文件名 |

生成的文件（默认 `~/circuit_canvas_out/`）：
```
<lib>_<cell>.json    中间数据（实例/网络/引脚/标注，可复查）
<lib>_<cell>.html    电路图，浏览器打开即可编辑
<lib>_<cell>.log     转换器日志（出错时看这个）
```

> **HTML 是单文件、零依赖的**：CSS / 元件符号库 / 逻辑 / 许可文本全部内联在里面，
> 拷到任何地方（甚至别的机器）双击就能看。
>
> 原因见下：“多文件模式”原理上要求 HTML 和 `styles.css` / `symbols.generated.js` / `app.js`
> 在同一个目录里，而输出目录在仓库外面，所以转换器会自动改成单文件内联版
> （输出目录就是 `circuit-canvas/` 时则用多文件模式）。想强制单文件加 `--portable`，
> 想强制多文件加 `--no-embed`（必须把 HTML 放在 circuit-canvas/ 里）。

## 观感：为什么它像一本教科书里的插图

默认**不照搬原图坐标**，而是按 Razavi / Gray & Meyer / Allen & Holberg / Abidi 插图
的规矩把电路重画一遍：

1. 电路压成若干**水平电平层**，同层引脚严格共线 → 导线天生是直线（示例电路做到 100% 直线、0 拐角）；   层高 = 引脚跨度 + 一个元件的高度，器件之间会留出一段可见的短线；2. 最上面一条**电源轨**、最下面一条**地轨**，器件竖直挂在两轨之间；
   源图里散落各处的重复电源/地符号**合并成一个**；
3. 差分对 / 电流镜**关于共同轴严格镜像**，误差为 0；
4. 器件朝向统一（NMOS 漏上源下、PMOS 源上漏下、NPN 集上射下）；
5. 位号/参数在 下/右/左/上 里自动挑一个**不压导线**的方向；
6. 同层器件留等距间隙，器件之间不遮挡；电路整体再按比例**横向紧凑**，
   两侧的端口/电源/地贴回电路旁边（`coagent/opamp` 从 1930×440 收到 1080×440）。
7. 认不出来的 cell 画成**矩形黑盒**（引脚名就是 Virtuoso 的端子名，左右按原图走线方向摆），
   报告里会列出哪些单元被画成了黑盒。
8. 衬底（bulk）默认不画：接在源/漏上、或引线会横穿其它器件时改用**三端 MOS 符号**
   （工程上 bulk 接源就是默认做法）；想保留四端用 `--keep-bulk`。

> 为什么不能「照搬原图坐标 + 原图走线」就完事？因为 Virtuoso 的符号尺寸比回路画布的
> 符号大 3~5 倍（`aExamples/diffamp` 里一个电阻跨 1.25in，回路电阻只有 0.25in），
> 线长是按大符号算的，套到小符号上就是一堆又长又空的残线 —— 怎么调都不像人画的。
> 所以默认重排；想保留原图坐标 + 原图走线，用 `--layout keep`：
>
> 重新导出后如果页面还显示上一次的电路，那是浏览器里存的**本地草稿**盖住了新文件。
> 导出时会写入内容指纹，指纹不一致会自动丢弃旧草稿并提示；若看到
> 「已恢复上次本地草稿」而画面不对，清一下站点数据即可。

```bash
# 默认：教科书重排
ccGenerateHtml()
# 想忠实原图（保留原图走线几何与「显示/隐藏原图走线」开关）
ccExtraArgs = "--layout keep"
```

`--layout keep` 时顶栏会出现【显示/隐藏原图走线】开关，在「从 schematic 原样搬来的走线」
和「可选中/可拖拽的自动走线」之间切换；两种情况下右侧 **SPICE 网表都是从真实连接关系
推导的**（隐藏的走线也参与）。

想体检一下排得好不好：

```bash
/usr/bin/python3 tools/virtuoso-to-canvas.py out/foo.json --out /tmp/x.html --report
#   ✓ 器件无互相遮挡
#   可见导线 13 条：直线 13（100%） · 单拐 0 · 双拐 0 · 平均折角 0.00 个/条
#   电平层 4 层 · 电源轨 1 · 地轨 gnd!
#   电源/地轨竖直引线 2 根 · 合并重复电源/地符号 2 个 · 强制精确镜像 2 对
```

## 设置与自检

```skill
ccSettings()                       ; 图形化设置：输出目录 / 仓库 / 文字缩放 / 自动开浏览器
ccMenuReport()                     ; 打印当前安装状态
ccSelfTest(list("training" "inv")) ; 全链路自检（含真跑一遍导出）
```

可配置变量（在 `.cdsinit` 里 load 之前设）：

| 变量 | 默认 | 说明 |
|------|------|------|
| `ccRepoPath` | `/work/agent_cowork/circuit-canvas` | circuit-canvas 仓库路径（也可用环境变量 `CC_REPO`） |
| `ccOutputDir` | `~/circuit_canvas_out` | HTML 输出目录 |
| `ccPythonBin` | 自动探测 | 转换器用的 python3（默认优先 `/usr/bin/python3`） |
| `ccAutoOpenBrowser` | `t` | 生成后自动开浏览器 |
| `ccBrowserCmd` | `xdg-open` | 打开 HTML / 目录的命令 |
| `ccLabelScale` | `1.0` | 原理图文字标注的字号缩放 |
| `ccExtraArgs` | `""` | 传给 `virtuoso-to-canvas.py` 的额外参数，如 `"--no-net-labels"` |
| `ccLayout` | `'textbook` | 排版：`'textbook` 教科书重排（默认）/ `'keep` 保留原图坐标与原图走线 |
| `ccQuiet` | `nil` | `t` 时连结果对话框都不弹 |
| `ccFixedMenuOn` | `nil` | `t` 时装 schematic 图标栏按钮（会替换默认图标栏） |

## 单元映射（想加自己的 PDK 看这里）

转换器 `tools/virtuoso-to-canvas.py` 用**三级匹配**把 Virtuoso 单元换成回路符号：

1. `FULL_MAP`：`lib/cell` 精确（大小写不敏感），如 `analoglib/nmos4`、`basic/gnd`
2. `CELL_MAP`：只看 cell 名，如 `res` / `cap` / `nmos` / `vdc` / `ipin`
3. `PATTERN_RULES`：cell 名正则，如 `^(qnmos|nmos|nch|…)` → NMOS

已覆盖：`analogLib`（res/cap/ind/nmos4/pmos4/npn/pnp/diode/vdc/vsin/vpulse/idc/vdd/gnd/vss）、
`basic`（gnd/ipin/opin/iopin）、`aExamples`（RPLR/TNSA）、`GPDK045`（`nmos1v`/`pmos1v`/`mimicap`/
`resm*`/`npn5`/`vpnp*`/`ind_*`/`ndio`/`pdio` 等）。

加自己的单元：在 `FULL_MAP` 或 `CELL_MAP` 里加一行
`'<lib>/<cell 小写>': ('<回路元件类型>', {'<Virtuoso 端子>': '<回路引脚名>'}, 取值函数)`，
`circuit-canvas/app.js` 的 `PART_SOURCE` 里要能查到该回路类型。取值函数可以复用
`_v_key('r')`（读属性 r）、`_v_wl`（拼 `W/L = w/l`）、`_v_r`（电阻优先读 Rnom）。

## 实测记录（IC25.10 / 本机）

| 验证项 | 结果 |
|--------|------|
| `ccSelfTest(list("training" "inv"))` | **全部通过**（含端到端导出） |
| `schematic_to_json` 导出真实 cellview | `aExamples/diffamp` 10 实例 / 6 网络 / 5 标注；`training/PLL` 含 2 个 pin；`training/inv`、`aExamples/vcvsOpampTest` 均通过 |
| 生成的 HTML | 元件/连线/网络名/引脚名与原理图逐项核对一致 |
| 层次化模块（`training/VCO`、`LF`、`PD`、`aExamples/vcvsOpamp*`） | 按设计**跳过并告警**（映射表里没有的 cell 不猜） |
| `python3` | 必须用 `/usr/bin/python3`；EDA 环境下 PATH 上的 `python3` 是 Mentor 自带的 |

## 已知限制与踩坑

- **SKILL 侧**：导出是只读打开 cellview，不会改动原图。层次化子模块不会递归展开，需要的话
  在映射表里补上对应回路元件，或先对子模块单独导出一张图。
- **网络名标注**：Virtuoso 自动生成的 `net12`、纯数字名、`vdd!`/`gnd!` 这类全局网不标，
  其余会标；原理图上已有的 label 一律原样带过来。
- **图标栏是替换语义**（见上文安装说明）。
- **右键菜单**依赖 Schematic Editor 已经初始化过（`schOSMCategories`），纯 CIW 启动时
  会提示跳过 —— 打开任意一个 schematic 后执行 `ccRegisterPopUpMenus()` 即可补上。
- **`/usr/bin/Xvfb` 缺失**时 `virtuoso -nograph` 起不来（本机就是这样）。headless 跑脚本要
  `export CDS_XVFB_PATH=/eda/matlab/R2025b/sys/Xvfb/glnxa64/bin` 借用 MATLAB 自带的 Xvfb，
  或直接不要 `-nograph`。`.test/run.sh` 里就是这么干的。
- 更多 SKILL 语言坑（`substring` 第三参是长度、没有 `explode`/`implode`、
  `cv~>pins` 对 schematic 是 nil 等）见
  [`.github/skills/cadence-analog-ic/reference/ic25-skill-gotchas.md`](../../.github/skills/cadence-analog-ic/reference/ic25-skill-gotchas.md)。

## 测试

`.test/` 里是把整套东西跑起来用的脚手架（headless，不用开 GUI）：

```bash
cd circuit-canvas/virtuoso/.test
./run.sh test_self.il                                  # 自检 + 端到端导出（推荐先跑这个）
./run.sh probe_api.il                                  # 查 SKILL/OA API 签名与语义
CC_LIB=aExamples CC_CELL=diffamp ./run.sh inspect_cellview.il   # 看某个 cellview 的结构
python3 check_json.py out/*.json                       # 校验导出的 JSON
python3 show.py out/training_inv.json                  # 看实例/端子/网络
```

`run.sh` 已经把 headless 需要的环境铺垫好了（`CDS_XVFB_PATH` 指向 MATLAB 自带的 Xvfb、
`-cdslib` 指向测试用 `cds.lib`、stdin 接 `/dev/null`）。`cds.lib` 里定义了
`analogLib` / `basic` / `aExamples` / `training` / `gpdk045` 五个库。

`tools/examples/virtuoso_real/` 里存了 4 个真实导出样本（aExamples/diffamp、training/inv、
training/PLL、aExamples/vcvsOpampTest）当回归数据，不用开 Virtuoso 也能验转换器：

```bash
cd circuit-canvas
for f in tools/examples/virtuoso_real/*.json; do
  /usr/bin/python3 tools/virtuoso-to-canvas.py "$f" --out /tmp/x.html --id t --no-js
done
```
