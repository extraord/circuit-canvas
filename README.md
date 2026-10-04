# 回路 · 电路绘图（Huilu Circuit Canvas）

本地优先的电路原理图绘图工具。双击 `index.html` 即可在浏览器中打开，无需安装依赖或启动服务器。

## 功能

- 107 种可放置元件：无源器件、信号源、半导体、受控源、开关、模拟模块、数字逻辑、运放家族、端口与磁性器件；「端口与标注」组里的**连接点（Junction，快捷键 `J`）**就是导线上那个实心小圆点（T 型三通）
- **从 Cadence Virtuoso schematic 直接导入**：导出 JSON → 自动换成元件库符号、连好导线、标上网络名（见下文）
- 拖放放置、引脚连线、旋转、文字标注
- 落点吸引：元件与文字对齐到 10 单位网格
- 对齐参考线：拖动时把引脚或中心对齐到其它元件（含画布中线），并显示虚线提示
- 引脚磁吸：连线时线头吸到附近引脚，目标引脚高亮；点空处也能落在附近引脚上
- 17 种可缩放图形：矩形、圆角矩形、虚线框、椭圆 / 圆、三角形、直角三角形、菱形、平行四边形、梯形、五边形、六边形、八边形、五角星、十字、箭头、双向箭头、直线
- 图形可填充常用色板或任意自选颜色，也可设为**无填充（透明）**
- **函数曲线 / 概率分布 / 数字波形**：参数化图元，参数改了图形立刻重画（见下文）
- 撤销 / 重做、缩放与适配视图
- **滚动条**：放大到画布装不下时，画布下方与右侧会浮出细滚动条（拖滑块跟随鼠标、点轨道直接跳过去）；装得下时自动隐藏。平移也支持中键 / 空格 / Alt 拖拽
- 右侧侧栏可切换「**属性 / 网表**」：属性编辑 + 由画布实时推导的 SPICE 网表（可复制、可导出 `.sp`，并列出悬空引脚等提示）
- 项目导出为 JSON，图纸导出为 SVG 矢量图
- 浏览器本地草稿自动恢复

### 选择（支持框选多选）

- 空白处**按住左键拖一个框**：与选框相交的元件 / 图形 / 文字一起选中，右侧显示「已选中 N 个对象」；
- **Shift + 点选**可加选 / 减选；**Shift + 拖框**在现有选择上加选；
- 选中多个后：**拖其中任意一个即可整组移动**（保持组内相对位置），`Delete` 一次删完（删元件时挂在它引脚上的导线一并删掉），`Esc` 取消选择；
- 单击其中一个对象（不拖动）会把选择收敛为这一个，与 Visio 一致；
- 多选时画布上会画一圈虚线轮廓，缩放控制点只在单选时出现（目前不支持整组缩放）。

### 点到被压住的对象（穿透选择）

框图（图形）与框内文字在 Visio 里是同一个形状，而这里拆成了两个对象（文字层在图形层上面），
所以点击行为按 Visio 的习惯处理：

- **单击框图内的文字 → 选中它所属的那个框图**（第一次会弹提示），拖动框图时框内文字一起走；
- 要单独选中/移动文字：**双击**它（进入编辑并选中），或者 **Ctrl + 点击** 穿透；
- **Ctrl + 点击 = 逐层往下穿透**：同一个位置每点一次就换一层（元件 → 文字 → 图形 循环），
  用来选中被别的对象完全盖住的东西，右下角会提示当前选到了哪一层。

### 对齐与吸附行为

- 磁性范围按**屏幕像素**计算（对齐 6 px、引脚 15 px），因此不同窗口尺寸与缩放级别下手感一致。
- 拖动时：**有对齐线的轴吸到另一元件，没有的轴落到 10 单位网格**。
- 位移小于 3 像素视为点击，不会把元件磮到网格。
- 在选中工具下，从引脚上按下也能拖动整个元件（方便连接点这类单引脚元件）。

### 图形

左侧「图形与标注」里选一种，在画布上**拖动**即可画出；画完自动回到选择工具。

- 选中后出现八个控制点（四角 + 四边），拖动即可**自由缩放**，任意多边形都能拉伸（不是整体等比放大）。
- 拖图形本体可移动，拖控制点可缩放，两者都会吸附网格与其它对象。
- 选中图形后在右侧检查器里选**填充颜色**：第一格是「无填充（透明）」，其余是常用色，
  也可以用取色器选任意颜色；新建图形会沿用上一次用过的填充色（直线无内部区域，不填充）。
- 图形画在电路**下方**，适合当框图或分组框；描边很细时靠隐藏的命中矩形保证好拖。
- 快捷键 `S` 切到图形工具，`Esc` 退出。

当前版本用于**绘制原理图**，不包含网表生成或电路仿真。

### 函数曲线 / 概率分布 / 数字波形

左侧「函数曲线与波形」里的三组图元都是**参数化画出来的**，不占用元件符号数据：
放下去以后在右侧属性面板里改参数，图会立刻重画；宽度 / 高度也能直接填，或拖角点缩放。

- **函数曲线**：`sin`、`cos`、方波、三角波、锯齿波、指数衰减、S 形 logistic、`sinc`、抛物线、
  阶跃、斜坡、衰减振荡；`参数 k` 控制周期数 / 陡度。
- **概率分布**：正态（高斯）、均匀、指数、瑞利、对数正态画密度曲线（带淡填充）；
  二项（n=8）、泊松画竖棒 + 圆点（离散分布）。
- **数字波形**（WaveDrom 风格）：
  - 时钟 / 脉冲：填`周期数`与`占空比 %`，底部带数周期用的刻度；
  - 数据：填`数据序列`（如 `1011`），每位一格，相邻不同电平自动画竖直跳变；
  - 总线：填`分组标签`（如 `D0 D1 D2`），每段画一个带标签的总线菱形。
- 这三类都是**标注类图元**：不参与网表推导，引脚为空（因此不能接线、也不会破坏 ERC 提示）；
  位号前缀分别是 `F` / `PDF` / `CLK` `DQ` `BUS`，可用 `标号` 字段改成自己的名字。

### 网表

右侧侧栏切到「网表」，就能看到由画布**实时推导**的 SPICE 网表（对应 Analog Canvas 的 live netlist 面板）。

- 导线用并查集合并成节点；接地引脚所在节点固定叫 `0`，电源/端口元件所在节点用元件名，
  其余按出现顺序叫 `net1`、`net2`…
- R/C/L/V/I/D/Q/M 输出标准元件卡，数值会做单位换算（`10 kΩ` → `10k`、`100 nF` → `100n`）；
  运放、门电路、触发器、ADC/DAC 等模块按**子电路调用**输出 `X<位号> … <模块名>`，
  需要你自己补上对应的 `.subckt` 定义。
- 悬空引脚、缺少数值（输出 `?`）、需要 `.model` / `.subckt` 的器件都会在代码下方列出，
  相当于一个轻量 ERC。
- 可一键**复制**或导出 `.sp`；网表只作为阅读与仿真起点，不含仿真卡（`.op` / `.tran` 等）。

## 从 Cadence Virtuoso 导出（schematic → 画布 HTML）

把 Virtuoso 原理图里的实例、网络、引脚导出来，用**本项目的元件库符号**重画成一张
可编辑的画布 HTML。

### 用法一（推荐）：在 Virtuoso Schematic Editor 里一键导出

在 `~/.cdsinit` 里加一次，然后对着原理图点【回路 → 生成 HTML 电路图】或按 `Ctrl+Shift+G`：

```skill
ccRepoPath = "~/circuit-canvas"          ; 改成你的克隆路径
load(strcat(ccRepoPath "/virtuoso/circuit_canvas.il"))
```

安装细节、可配置项、自检命令、踩坑记录都在 **[`virtuoso/README.md`](virtuoso/README.md)**，
真实 cellview 的回归样本在 `tools/examples/virtuoso_real/`。

### 用法二：脚本化两步走

```skill
;; 1) 在 CIW 里把 cellview 导成 JSON（只读打开，不改原图）；
;;    schematic_to_json.il 是配合本项目的导出脚本，路径按你的环境替换
load("/path/to/schematic_to_json.il")
s2jExportSchematic("myLib" "two_stage_miller" "/tmp/opamp.json")
```

```bash
python3 tools/virtuoso-to-canvas.py /tmp/opamp.json \
    --out opamp.html --id opamp-sheet --title "Two-stage Miller Opamp"
# 元件 15 · 导线 29 · 画布 900×890
#   -> opamp.html (46 KB)

# 想知道排得好不好看，加 --report：
#   器件无互相遮挡 / 直线 13（100%） · 单拐 0 · 双拐 0 / 电平层 4 层 · 电源轨 · 地轨 …
python3 tools/virtuoso-to-canvas.py /tmp/opamp.json --out opamp.html --report

# 想保留原图坐标和原图走线（忠实优先），用 --layout keep
python3 tools/virtuoso-to-canvas.py /tmp/opamp.json --out opamp.html --layout keep
```

导出脚本遍历 `cv~>instances` / `cv~>nets` / `net~>pins` / label 形状，输出实例位号、
库单元名、坐标、方位、CDF 参数、端子名，以及**引脚级**的网络连接关系
（而不是只给网络名），这样转换器才能知道导线该连到哪个引脚。

转换器做的事：

- **符号替换**：三级匹配把 `analogLib` / `basic` / `GPDK045` / 自定义 PDK 的单元映射成元件库符号
  （`res→电阻`、`cap→电容`、`nmos4→四端 NMOS`、`vdc→电压源`、`gnd→接地`、
  `vdd→电源端口`、`basic/ipin→端口`……），参数落到「参数 / 数值」字段
  （`w/l → W/L = 40u/0.18u`）。带 bulk 端子的 MOS 自动换成四端符号。
- **端子对齐**：把 `PLUS/MINUS`、`S/D/G/B` 等端子名映射到画布符号的引脚
  （`nmos4` 的 4 个引脚下标是 D/G/S/B，`res` 的 `PLUS/MINUS` → `1/2`），
  并做 y 轴翻转 + 比例缩放 + 10 单位网格吸附。
- **排版（默认 `--layout textbook`）**：不做「原图坐标照搬」，而是按 Razavi / Gray & Meyer /
  Allen & Holberg / Abidi 教科书插图的六条硬规矩**重画**：

  1. 电路压成若干水平**电平层**，同一层的引脚严格共线 → 导线天生是直线，不会出现台阶；
     层高 = 引脚跨度（40）+ 一个元件的高度（48），所以器件之间会留出一段可见的
     短线，不会贴在一起；
  2. 最上面一条**电源轨**、最下面一条**地轨**，器件竖直挂在两轨之间；散落各处的
     重复电源/地符号会**合并成一个**（一个网络只画一个）；
  3. 差分对 / 电流镜等匹配对**关于共同轴严格镜像**（误差 = 0，不是「差不多」）；
  4. 只用水平段和垂直段，拐角能 1 个就不 2 个，不横穿器件本体；
  5. 器件朝向统一（NMOS 漏上源下、PMOS 源上漏下、NPN 集上射下）；
  6. 同层器件留等距间隙、位号/参数在「下/右/左/上」里挑一个不压导线的方向。

  分层靠连通性 BFS（只走器件的**通路端子**：MOS 的 D-S、BJT 的 C-E、两端元件的两脚，
  栅/基极不参与），并用原图的**对齐意图**（源图里画成竖直的网络说明那几个引脚同列）
  重新解一次 x —— 因为我们的符号引脚偏移和 Virtuoso 的不一样，直接搬实例坐标会整体错开半格。

  想保留原图坐标 + 原图走线几何（忠实但不好看），用 `--layout keep`。

  重排完还会做一轮**横向紧凑**：源图的横向间距常常比纵向大一个数量级（折叠共源共栅
  会被画成 4:1 的长条，缩到「适配窗口」后根本看不清），所以电路本体按同一比例向自己
  的中心压缩（等比缩放不破坏「同列」，直线与镜像对称都保持），两侧的端口/电源/地
  装饰再贴回电路旁边 —— `coagent/opamp` 实测从 1930×440 收到 1080×440。

- **走线**：`--layout keep` 时优先搬运原理图里的**真实走线几何**（导线在 schematic 里是
  逐段折线实体，连 T 型分支一起原样导出）；端点会吸附到回路符号自己的引脚上，中间拐点不动。
  注意 Virtuoso 的符号尺寸比画布符号大 3~5 倍（源图一个电阻跨 1.25in，我们只有 0.25in），
  所以「原图坐标照搬」永远画不出教科书效果 —— 线长是按大符号算的，套在小符号上就是一堆
  又长又空的残线。这也是默认用 `textbook` 重排的原因。
- **不互相遮挡**：重排后做一轮水平分离（用**引脚跨度盒**而不是视图框判交叠，
  否则相邻两层的装饰边会被误判成遮挡），`--report` 可以看体检结果。
- **衬底（bulk）默认不画**：衬底接在源/漏上（工程默认做法）、或衬底引线会横穿其它
  器件时，自动改用**三端 MOS 符号**。四端符号的 B 脚长在器件右侧中部，引到下/上面的
  轨上必然拐一下，还容易压穿别的管子；省掉后 `coagent/opamp` 的直线率从 62% 升到 94%。
  想保留四端符号用 `--keep-bulk`。
- **标注**：网络名贴在对应网络的正中；位号/参数会按实际走线挑一个不压线的方向
  （`component.labelPos` = below/right/left/above）。
- **旧草稿不会盖掉新导出**：导出时会写入一个内容指纹（`CANVAS_FILE.build`），
  浏览器里存的本地草稿指纹不一致就自动丢弃并提示 —— 否则「在 Virtuoso 里重导一次
  → 刷新页面」看到的还是上一次的电路。
- **兜底**：未识别的 cell 会画成**矩形黑盒**（`block`）：引脚名照抄 Virtuoso 的端子名，
  左右/上下按原图走线的方向摆，所以 custom cell（VCO / LF / PD …）也看得见、
  连线不会凭空断掉；报告里会列出画成了哪些黑盒。悬空网络、未匹配端子也会打印警告。

生成的 HTML 就是一张**独立画布文件**，可编辑、可继续连线、右侧实时推导 SPICE 网表，
数据内嵌在文件里。

⚠️ 「多文件」形态要求 HTML 与 `styles.css` / `symbols.generated.js` /
`app.js` **在同一个目录**里；只把 HTML 拷到别处会变成一张没样式、画不出电路图的白页。
所以转换器会自动判断：**输出目录不是 `circuit-canvas/` 时，直接产出单文件内联版**
（CSS / 元件几何 / 逻辑 / 许可文本全部内嵌，约 380 KB，拷到哪都能打开）。
想强制指定用 `--portable` / `--no-embed`。

示例：

- `miller_opamp.html` —— 合成数据（`tools/examples/virtuoso_miller_opamp.json`）
- `virtuoso_demo_inv.html` —— **真实 Cadence 导出**（`training/inv`，含 NMOS/PMOS/电源/地）

`tools/examples/virtuoso_real/` 里另存了 4 个真实 cellview 的导出 JSON
（`aExamples/diffamp`、`training/inv`、`training/PLL`、`aExamples/vcvsOpampTest`），
不用开 Virtuoso 也能回归测试转换器。

想直接发给别人一张「双击就能看」的图，加 `--portable`：

```bash
python3 tools/virtuoso-to-canvas.py /tmp/opamp.json --out opamp.html \
    --id opamp-sheet --title "Two-stage Miller Opamp" --portable
# 输出 ~380 KB 的单文件，CSS / 元件几何 / 逻辑 / AGPL 许可文本全部内联
```

> ⚠️ 这个 `.il` 脚本**没有在真实 Cadence 环境验证过**（本仓库无 Cadence 授权）。
> 不同版本 IC6.1.8 / IC23.1 / ICADVM 的部分 API 有差异，首次使用请按报错微调；
> Python 端的映射表与走线算法是纯离线的，已经过示例数据自测。

## 本地使用

直接用浏览器打开 `index.html`。所有数据保存在本机，不会上传。

### 拷到其它机器

本应用没有构建步骤、也没有网络请求，运行时只依赖**四个文件**，放在同一个目录里即可：

```
index.html   styles.css   app.js   symbols.generated.js
```

- 想带上某张示例画布，把对应的 `*.html` 一并拷过去即可（数据已内嵌在文件里）。
- `LICENSE` 建议一并带上（AGPL-3.0-only 要求随程序分发许可文本）。
- `tools/` 只有重新生成元件几何时才需要，普通使用可以不带。
- 拷过去后直接用系统浏览器（Firefox / Chrome / Edge）打开 `index.html` 即可；
  用 VS Code 内置浏览器打开**工作区之外**的 `file://` 会被拒绝（"已禁止，文件不在受信任的文件夹中"）。
- 打包示例：`tar czf huilu.tgz index.html styles.css app.js symbols.generated.js LICENSE README.md`

⚠️ **图纸数据不会跟着文件走**：草稿存在浏览器的 localStorage 里，而且**按目录隔离**
（把目录复制到新路径后，新副本看不到原目录的草稿）。要带走画好的电路，请用顶部
**保存**导出 `.circuit.json`，在新机器上用**打开**载入。

### 想只带一个文件

```bash
python3 tools/build-portable.py          # 生成 dist/huilu.html（约 330 KB）
```

脚本把 `styles.css`、`symbols.generated.js`、`app.js` 以及完整的 **AGPL 许可文本**
全部内联进一个 HTML，输出到 `dist/huilu.html`：

- 单文件、零外部请求（已实测 `file://` 直接双击、`http://` 放到服务器上两种方式都正常）；
- 想放内网/服务器时，直接把它丢进站点目录即可，例如在 `dist/` 里跑 `python3 -m http.server`；
- 许可文本内嵌在文件里（`<script type="text/plain" id="agpl-license">`），
  所以只发这一个文件也满足 AGPL 随附许可的要求。

- `保存` 导出项目 JSON，`打开` 读取本地项目文件
- `导出 SVG` 输出矢量图
- 快捷键：`R`/`C`/`L`/`V`/`M`/`D`/`Q`/`U`/`X`/`A` 等放置元件，`W` 切到导线，`Delete` 删除，`Ctrl+Z` 撤销

### 多张画布 / 子 sheet（独立画布文件）

公用库只有一份（`styles.css` / `symbols.generated.js` / `app.js` / `assets/`），
但每一张具体图纸都是**独立的一个 HTML 文件，数据内嵌在自己身上**：

```
index.html             通用画布（新建 / 打开通用图纸）
miller_opamp.html      示例画布：两级 Miller 运放（合成数据）
virtuoso_demo_inv.html 示例画布：真实 Cadence 导出（反相器）
```

- 打开某个画布文件就直接进入这张图的可编辑画布，不需要任何查询参数；
- 文件可以单独拷贝到别的机器（目标机器只要有同一份 `circuit-canvas` 目录即可），
  顶栏右侧会多出一个「通用画布」按钮返回 `index.html`；
- 每张画布的本地草稿 key 是 `huilu-canvas-<id>-local-draft`（`id` 写在画布文件里），
  所以多张画布之间、以及和通用画布之间**互不覆盖**；
- 想做「子 sheet」，再生成一个画布文件放进同一目录，就能互相跳转。

把一张图纸数据（`assets/*-canvas.js`，可由 `tools/virtuoso-to-canvas.py` 生成）
打包成独立画布文件：

```bash
python3 tools/build-canvas-file.py --data assets/miller-opamp-canvas.js \
    --out miller_opamp.html --id miller-opamp --title "两级 Miller 运放"
```

`build-canvas-file.py` 拿 `index.html` 当外壳模板（顶栏 / 元件库 / 检查器都是同一份），
只把顶部的 `<!-- @@CANVAS_DATA@@ -->` 占位符换成内嵌的 `window.CANVAS_FILE = {...}`，
所以 UI 改动不会分散到多份文件里；改完 `index.html` 后重新跑一次即可同步。
生成出来的文件头有注释标明「请勿手改，改数据请重新生成」。

> ⚠️ `app.js` 是**所有外壳共用的运行期**（`index.html` / 每个画布文件都加载它）。
> 改外壳结构（例如新增滚动条那对 `#scrollbar-x/y`）后，**已有画布文件要重新生成一遍**
> 才能拿到新 UI；`app.js` 里引用 DOM 一律先判空，缺元素只是少个功能，不会让整页白掉。
> 排查时用 `grep -rl 'app.js' --include='*.html' .` 就能列出全部外壳。

## 许可

版权所有 (C) 2026 回路 contributors

本程序是自由软件：你可以依据自由软件基金会发布的 **GNU Affero 通用公共许可证**（第 3 版或你选择的任何更新版本）条款重新发布和/或修改它。

本程序分发时希望其有用，但不提供任何担保，甚至不包含适销性或特定用途适用性的默示担保。详见 GNU Affero 通用公共许可证。

你应已随本程序收到 GNU Affero 通用公共许可证副本；若没有，请见 <https://www.gnu.org/licenses/>。

完整许可文本见 [LICENSE](LICENSE)。许可证为 **AGPL-3.0-only**。

### 网络交互

如果你修改本程序并通过网络提供服务，AGPL 第 13 条要求你向使用者提供 Corresponding Source。仓库根目录的 `LICENSE` 与源码即为此用途保持可获取。

## 第三方来源与署名

元件符号的几何数据**逐字取自**开源项目
[Analog Canvas](https://github.com/cascode-ai/analog-canvas)
（版权所有 © 2026 Zengchun Chen 与 Zhishuai Zhang，AGPL-3.0-only）。

- `symbols.generated.js` 由上游 `packages/components/definitions/<symbol-id>.json` 转换而来，
  未做任何坐标改写：`viewBox`、引脚锚点与方向、图元（line / polyline / polygon / circle / path）
  及其描边角色全部保持原样。
- 描边宽度取自上游 `razavi-textbook-v1` 样式档：普通 1.6、强调 2.4、接地 2.907、
  电源 1.8、电源轨 3.24；接线点半径 3.77907。
- 元件变体（例如 NMOS 的三端接法）同样按上游定义处理：隐藏指定引脚与部件，
  再叠加变体追加的图元。
- 上游没有的 `digital-clock` 与 `junction` 由本项目补充，图元格式与上游一致。

本项目的其余部分（画布、连线、交互、导出）为独立实现。上游部分几何源自其自己标注的
第三方参考资料，若需再分发请自行确认那部分的权利。

### 重新生成符号数据

```bash
python3 tools/build-symbols.py           # 使用 tools/.cache 中已下载的定义
python3 tools/build-symbols.py --fetch   # 先从 GitHub 重新下载
```

修改上游版本或调整映射后重新运行即可，无需手工编辑 `symbols.generated.js`。

### 打包成单文件

```bash
python3 tools/build-portable.py          # 输出 dist/huilu.html
```

详见上文「想只带一个文件」。`dist/` 是构建产物，已加进 `.gitignore`。

## 修改记录

- 2026：创建项目，实现画布、元件库、连线与本地保存；元件库扩展至 107 种。
- 2026：改为 AGPL-3.0-only 发布，加入许可声明界面。
- 2026：元件几何改为直接采用 Analog Canvas 的元件定义（103 个上游符号），
  由 `tools/build-symbols.py` 生成，取代此前手绘的路径与手工归一化坐标。
- 2026：加入网格吸附、对齐参考线与引脚磁吸（范围按屏幕像素换算，缩放下手感一致）。
- 2026：加入 17 种图形标注（矩形、多边形、箭头等），支持拖动绘制与八向自由缩放。
- 2026：图形支持填充 —— 常用色板 / 任意自选颜色 / 无填充透明，导出 SVG 时保留填充。
- 2026：侧栏拆为「属性 / 网表」两页，网表由画布实时推导（并查集求节点 + 元件卡），
  支持复制与导出 `.sp`，并提示悬空引脚与缺失参数；同类问题一并修掉：侧栏收起后
  按钮自己也隐藏导致无法展开、运放符号的导线在导入时被判为无效。
- 2026：新增 `tools/build-portable.py`，可把整个应用打包成一个自包含 HTML，
  便于拷到其它机器或放到内网使用。
- 2026：新增 `tools/virtuoso-to-canvas.py` + skill 侧 `schematic_to_json.il`，
  支持从 Cadence Virtuoso schematic 导出并自动重绘成画布 HTML
  （符号替换、枢纽星形走线、方向感知折线、网络名标注）。
- 2026：导入排版改为**教科书重排**（`--layout textbook`，默认）：电平层 + 电源/地轨
  + 严格镜像对称 + 位号避让导线，示例电路做到 100% 直线、0 拐角、0 遮挡。
  原图坐标为 `--layout keep`。`app.js` 增加 `component.labelPos`
  （below/right/left/above）支持位号/参数换边。
- 2026：导线支持 `mode` 字段（横平优先 / 竖直优先 / 上下左右绕行），
  避免导入的走线横穿元件本体。
- 2026：新增 `virtuoso/` —— 在 **Virtuoso Schematic Editor 里一键导出**的集成
  （菜单栏【回路】/ Ctrl+Shift+G / 可选图标栏按钮 / 右键菜单），
  并在真实 IC25.10 上完成端到端实测；同时修掉一批 SKILL 版本兼容坑
  （`substring` 第三参是长度、没有 `explode/implode`、`cv~>pins` 对 schematic 为 nil 等），
  详见 `virtuoso/README.md` 与 skill 的 `reference/ic25-skill-gotchas.md`。
