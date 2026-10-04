;; cc_export.il -- 把 Virtuoso schematic cellview 导出成 JSON，交给
;; circuit-canvas/tools/virtuoso-to-canvas.py 转成 HTML 电路图。
;;
;; 已在 IC25.10 上实测（aExamples/diffamp、aExamples/vcvsOpampTest、
;; training/inv 等真实 cellview）。
;;
;; 对外接口：
;;   ccExportSchematicJson(l_libCell_s_outPath)  -> 输出路径 / nil
;;   ccExportCurrentCellView(s_outPath)          -> 输出路径 / nil
;;
;; 输出 JSON 结构：
;;   { "source": {lib, cell, view, bBox:[[x1 y1] [x2 y2]]},
;;     "instances": [{name, lib, cell, view, xy:[x y], orient, ninst, props:{...}}],
;;     "nets":      [{name, conns:[[instName termName] ...]}],
;;     "pins":      [{name, dir, net, xy:[x y]}],
;;     "labels":    [{text, xy:[x y], orient, height}] }
;;
;; 坐标是 Virtuoso 原始用户单位（一般英寸），y 轴向上；y 翻转 / 缩放 / 网格
;; 吸附都在 Python 端做。

;; 一个 1 字节字符的 ASCII 码；取不到（多字节 UTF-8 的高位字节）返回 0。
;; IC25 实测：charToInt 收的是 symbol，所以要 stringToSymbol 转一下。
procedure( ccCharCode(c)
  let( ( code )
    code = errset(charToInt(stringToSymbol(c)) t)
    if( code && car(code) car(code) 0 )
  )
)

;; ── JSON 字符串转义（反斜杠 / 引号 / 控制字符）────────────────────────────
;; 用 strlen/substring/strcat 逐字节处理（IC25 没有可用的 explode）。
;; 注意 substring(str start LENGTH) —— 第三个参数是长度，不是结束位置！
;; 多字节 UTF-8 字节原样透传，保证中文 label 不乱码。
procedure( ccJsonEscape(s)
  let( ( out c code n i )
    out = ""
    n = strlen(s)
    for( i 1 n
      c = substring(s i 1)
      code = ccCharCode(c)
      cond(
        ( code == 34  out = strcat(out "\\\"") )                  ;; "
        ( code == 92  out = strcat(out "\\\\") )                  ;; \
        ( code == 10  out = strcat(out "\\n")  )
        ( code == 13  out = strcat(out "\\r")  )
        ( code == 9   out = strcat(out "\\t")  )
        ( (code > 0) && (code < 32)  out = strcat(out sprintf(nil "\\u%04x" code)) )
        ( t           out = strcat(out c) )
      )
    )
    out
  )
)

;; 任意 SKILL 值（字符串 / symbol / 数字）→ JSON 字符串字面量。
;; 用 %s 打印：字符串原样、symbol 打名字（不带引号），两种都能吃。
procedure( ccJsonStr(v)
  let( (s)
    s = errset(sprintf(nil "%s" v) t)
    s = if( s car(s) "" )
    sprintf(nil "\"%s\"" ccJsonEscape(s))
  )
)

;; 任意 SKILL 值 → JSON 文本
procedure( ccJsonValue(v)
  cond(
    ( numberp(v)  sprintf(nil "%g" v) )
    ( null(v)     "null" )
    ( t           ccJsonStr(v) )
  )
)

;; 字符串列表用分隔符拼起来（IC25 没有 implode）
procedure( ccJoin(l_items s_sep)
  let( ( out first )
    out = ""
    first = t
    foreach( x l_items
      unless( first out = strcat(out s_sep) )
      first = nil
      out = strcat(out x)
    )
    out
  )
)

;; bBox : ((llx lly) (urx ury)) → [[llx,lly],[urx,ury]]
procedure( ccJsonBBox(bb)
  let( ( ll ur )
    ll = car(bb)
    ur = cadr(bb)
    sprintf(nil "[[%g, %g], [%g, %g]]" car(ll) cadr(ll) car(ur) cadr(ur))
  )
)

;; 安全取二维点（失败返回 nil）
procedure( ccSafeXY(f)
  let( (pt)
    pt = errset(f~>xy t)
    when( pt && listp(car(pt)) && length(car(pt)) >= 2 && numberp(cadr(car(pt))) car(pt) )
  )
)

;; ── 导出主函数 ──────────────────────────────────────────────────────────
;; l_libCell : list(libName cellName [viewName])，viewName 默认 schematic
;; s_outPath : 输出 JSON 路径
procedure( ccExportSchematicJson(l_libCell s_outPath)
  let( ( lib cell viewName cv out first firstProp firstConn firstPin firstLbl
         xy termName nInst nNet nPin nLbl nSkip nWire wCount props skipped
         wNet )
    lib  = car(l_libCell)
    cell = cadr(l_libCell)
    viewName = if( caddr(l_libCell) caddr(l_libCell) "schematic" )

    cv = dbOpenCellViewByType(lib cell viewName "schematic" "r")
    unless( cv
      warn("ccExportSchematicJson: cannot open %s/%s/%s" lib cell viewName)
      return(nil)
    )
    out = outfile(s_outPath "w")
    unless( out
      dbClose(cv)
      warn("ccExportSchematicJson: cannot write %s" s_outPath)
      return(nil)
    )

    nInst = 0  nNet = 0  nPin = 0  nLbl = 0  nSkip = 0  wCount = 0
    skipped = nil

    fprintf(out "{\n")
    fprintf(out "  \"source\": {\"lib\": %s, \"cell\": %s, \"view\": %s, \"bBox\": %s},\n"
      ccJsonStr(lib) ccJsonStr(cell) ccJsonStr(viewName) ccJsonBBox(cv~>bBox))

    ;; ── 实例 ──────────────────────────────────────────────────────────
    fprintf(out "  \"instances\": [\n")
    first = t
    foreach( inst cv~>instances
      ;; 主视图打不开的实例（缺库/缺 cell）直接跳过，别让下游画出一个空盒子
      if( errset(inst~>cellName t) then
        xy = errset(inst~>xy t)
        xy = if( xy && listp(car(xy)) && numberp(cadr(car(xy))) car(xy) nil )
        if( xy then
          unless( first fprintf(out ",\n") )
          first = nil
          nInst = nInst + 1
          fprintf(out "    {\"name\": %s, \"lib\": %s, \"cell\": %s, \"view\": %s, \"xy\": [%g, %g], \"orient\": %s, \"ninst\": %L"
            ccJsonStr(inst~>name)
            ccJsonStr(inst~>libName)
            ccJsonStr(inst~>cellName)
            ccJsonStr(inst~>viewName)
            car(xy) cadr(xy)
            ccJsonStr(inst~>orient)
            inst~>numInst)
          ;; 端子名列表：下游用它给 port 元件起名、并判断器件是 3 端还是 4 端
          termName = errset(inst~>instTerms t)
          termName = if( termName car(termName) nil )
          fprintf(out ", \"terms\": [%s]"
            ccJoin( mapcar( lambda((it) ccJsonStr(it~>name)) termName ) ", " ) )
          firstProp = t
          fprintf(out ", \"props\": {")
          foreach( p inst~>prop
            unless( firstProp fprintf(out ", ") )
            firstProp = nil
            fprintf(out "%s: %s" ccJsonStr(p~>name) ccJsonValue(p~>value))
          )
          fprintf(out "}}")    ;; 闭合 props + 实例对象
        else
          nSkip = nSkip + 1
          skipped = cons(inst~>name skipped)
        )
      else
        nSkip = nSkip + 1
        skipped = cons(inst~>name skipped)
      )
    )
    fprintf(out "\n  ],\n")

    ;; ── 网络（实例引脚级连接关系）───────────────────────────────────────
    fprintf(out "  \"nets\": [\n")
    first = t
    foreach( net cv~>nets
      unless( first fprintf(out ",\n") )
      first = nil
      nNet = nNet + 1
      fprintf(out "    {\"name\": %s, \"conns\": [" ccJsonStr(net~>name))
      firstConn = t
      foreach( it net~>instTerms
        termName = errset(it~>name t)
        termName = if( termName car(termName) "" )
        unless( firstConn fprintf(out ", ") )
        firstConn = nil
        fprintf(out "[%s, %s]" ccJsonStr(it~>inst~>name) ccJsonStr(termName))
      )
      fprintf(out "]}")
    )
    fprintf(out "\n  ],\n")

    ;; ── 顶层 I/O 引脚（转成 port 元件）────────────────────────────────
    ;; 注意：IC25 里 cv~>pins 恒为 nil（至少对 schematic 如此），pin 是挂在
    ;; net 上的：net~>pins。这是实测出来的，别改成 cv~>pins。
    fprintf(out "  \"pins\": [\n")
    firstPin = t
    foreach( net cv~>nets
      foreach( pin net~>pins
        xy = errset(if(car(pin~>figs) car(pin~>figs)~>xy nil) t)
        xy = if( xy car(xy) nil )
        when( xy
          unless( firstPin fprintf(out ",\n") )
          firstPin = nil
          nPin = nPin + 1
          fprintf(out "    {\"name\": %s, \"dir\": %s, \"net\": %s, \"xy\": [%g, %g]}"
            ccJsonStr(pin~>term~>name)
            ccJsonStr(if( pin~>term~>direction pin~>term~>direction "inputOutput" ))
            ccJsonStr(net~>name)
            car(xy) cadr(xy))
        )
      )
    )
    fprintf(out "\n  ],\n")

    ;; ── 真实导线几何 ─────────────────────────────────────────────────
    ;; schematic 里的导线是 objType=="line" 的 dbLine 实体（逐段的折线），
    ;; 每段带自己的 net。原样搬过去，画出来就和人手画的原理图一致
    ;; （对称、笔直都是设计师排好的），下游不必再去"猜"走线。
    fprintf(out "  \"wireShapes\": [\n")
    first = t
    foreach( sh cv~>shapes
      when( sh~>objType == "line"
        nWire = errset(sh~>points t)
        nWire = if( nWire car(nWire) nil )
        when( nWire && listp(nWire) && length(nWire) >= 2
          unless( first fprintf(out ",\n") )
          first = nil
          wCount = wCount + 1
          wNet = errset(sh~>net~>name t)
          wNet = if( wNet car(wNet) nil )
          fprintf(out "    {\"net\": %s, \"points\": [%s]}"
            ccJsonStr(wNet)
            ccJoin( mapcar( lambda((pt)
              sprintf(nil "[%g, %g]" car(pt) cadr(pt)) ) nWire ) ", " ) ) ) ) )
    fprintf(out "\n  ],\n")

    ;; ── 图上真实存在的 label 形状（网络名 / 引脚名标注）─────────────────
    fprintf(out "  \"labels\": [\n")
    firstLbl = t
    foreach( sh cv~>shapes
      when( sh~>objType == "label"
        xy = errset(sh~>xy t)
        xy = if( xy && listp(car(xy)) car(xy) nil )
        when( xy
          unless( firstLbl fprintf(out ",\n") )
          firstLbl = nil
          nLbl = nLbl + 1
          fprintf(out "    {\"text\": %s, \"xy\": [%g, %g], \"orient\": %s, \"height\": %s}"
            ccJsonStr(if(sh~>theLabel sh~>theLabel ""))
            car(xy) cadr(xy)
            ccJsonStr(if(sh~>orient sh~>orient "R0"))
            ccJsonValue(if(sh~>height sh~>height 0.0625)))
        )
      )
    )
    fprintf(out "\n  ]\n")
    fprintf(out "}\n")
    close(out)

    printf("[circuit-canvas] exported %s/%s/%s -> %s  (inst=%d net=%d pin=%d label=%d wire=%d skip=%d)\n"
      lib cell viewName s_outPath nInst nNet nPin nLbl wCount nSkip)
    when( skipped
      printf("[circuit-canvas] WARNING skipped instances: %L\n" reverse(skipped)) )
    dbClose(cv)
    s_outPath
  )
)

;; 导出当前被编辑的 schematic（从窗口拿，nograph 下拿不到就报错）
procedure( ccExportCurrentCellView(s_outPath)
  let( (cv)
    cv = errset(geGetEditCellView() t)
    cv = if( cv car(cv) nil )
    unless( cv
      warn("ccExportCurrentCellView: no schematic being edited (open a schematic first)")
      return(nil)
    )
    ccExportSchematicJson(list(cv~>libName cv~>cellName cv~>viewName) s_outPath)
  )
)
