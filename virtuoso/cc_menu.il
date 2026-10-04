;; cc_menu.il -- 把「一键生成 HTML 电路图」挂到 Virtuoso Schematic Editor。
;;
;; 入口（都是"点一下"）：
;;   1. 图标栏：schematic 窗口固定菜单最前面的一组【回路】按钮（官方 API
;;      schRegisterFixedMenu，只读模式也能用）
;;   2. 菜单栏：每个 schematic 窗口右下角的【回路】下拉菜单
;;      （靠 fixed menu 的 enable 触发器在每个窗口打开时装上）
;;   3. 快捷键：Ctrl+Shift+G
;;   4. 右键菜单：画布空白处 / 默认对象上
;;   5. CIW：Tools 菜单里的「回路：生成 HTML 电路图」
;;   6. CIW 命令行：ccGenerateHtml() / ccGenerateHtmlQuiet(list("lib" "cell"))
;;
;; 依赖同目录的 cc_export.il 与 <repo>/tools/virtuoso-to-canvas.py
;;
;; 全部 API 用法都用 arglist() 核对过签名。

;; ══════════════════════════════════════════════════════════════════════
;; 配置（在 .cdsinit 里 load 本文件之前设置即可覆盖）
;; ══════════════════════════════════════════════════════════════════════
unless( boundp('ccRepoPath)      ccRepoPath = strcat(getShellEnvVar("HOME") "/circuit-canvas") )
unless( boundp('ccOutputDir)     ccOutputDir = nil )         ;; nil → ~/circuit_canvas_out
unless( boundp('ccPythonBin)     ccPythonBin = nil )         ;; nil → 自动探测
unless( boundp('ccAutoOpenBrowser) ccAutoOpenBrowser = t )
unless( boundp('ccBrowserCmd)    ccBrowserCmd = "xdg-open" )
unless( boundp('ccExtraArgs)     ccExtraArgs = "" )
unless( boundp('ccLabelScale)    ccLabelScale = 1.0 )
;; 排版："textbook"（默认，按教科书规矩重排成电平层 + 电源/地轨，直线好看）
;;       "keep"（保留原图坐标与原图走线几何，忠实但显得空、不美观）
unless( boundp('ccLayout)        ccLayout = 'textbook )
unless( boundp('ccQuiet)         ccQuiet = nil )              ;; t → 连对话框都不弹
unless( boundp('ccFixedMenuOn)   ccFixedMenuOn = nil )        ;; t → 装图标栏（会替换默认图标栏）

;; ══════════════════════════════════════════════════════════════════════
;; 小工具
;; ══════════════════════════════════════════════════════════════════════
procedure( ccRunShell(s_cmd)
  let( (rc)
    rc = errset(system(s_cmd) t)
    if( rc car(rc) 127 )
  )
)

;; 调用外部程序时统一清掉 EDA 环境注入的库路径：
;; LD_LIBRARY_PATH 里是 Cadence 的老 libstdc++/libcrypto，会把系统 python3 / xdg-open 带崩。
procedure( ccCleanEnv(s_cmd)
  sprintf(nil "env -u LD_LIBRARY_PATH -u LD_PRELOAD -u CDS_LIB_PATH %s" s_cmd)
)

procedure( ccFindRepo()
  let( (cands p)
    cands = list( getShellEnvVar("CC_REPO") ccRepoPath
                  strcat(getShellEnvVar("HOME") "/circuit-canvas") )
    p = nil
    foreach( c cands
      when( c && !p when( isFile(strcat(c "/tools/virtuoso-to-canvas.py")) p = c ) ) )
    p
  )
)

procedure( ccFindPython()
  let( (cands p)
    ;; 注意：EDA 环境下 PATH 上的 python3 可能是 Mentor 自带的，所以优先绝对路径
    cands = list( getShellEnvVar("CC_PYTHON") ccPythonBin
                  "/usr/bin/python3" "/usr/bin/python3.12" "/usr/bin/python" )
    p = nil
    foreach( c cands when( c && !p when( isFile(c) p = c ) ) )
    if( p p "python3" )
  )
)

procedure( ccOutDir()
  if( ccOutputDir ccOutputDir strcat(getShellEnvVar("HOME") "/circuit_canvas_out") )
)

;; 文件名白名单化：[A-Za-z0-9._-] 之外都换成 _
;; 注意 substring(str start LENGTH) —— 第三个参数是长度
procedure( ccSafeName(s)
  let( ( out c code n i )
    out = ""
    n = strlen(s)
    for( i 1 n
      c = substring(s i 1)
      code = errset(charToInt(stringToSymbol(c)) t)
      code = if( code && car(code) car(code) 0 )
      out = strcat(out if( (code >= 48 && code <= 57)
                        || (code >= 65 && code <= 90)
                        || (code >= 97 && code <= 122)
                        || code == 45 || code == 95 || code == 46
                        c "_" ))
    )
    out
  )
)

;; ══════════════════════════════════════════════════════════════════════
;; 一键命令
;; ══════════════════════════════════════════════════════════════════════
;; 静默版：只往 CIW 打印，不弹对话框；返回生成的 HTML 路径 / nil
;; l_libCell 为 list(lib cell [view]) 时直接导出该 cellview，否则用当前编辑窗口
procedure( ccGenerateHtmlQuiet(@optional l_libCell)
  let( (cv lib cell view json html repo py outdir cmd rc base)
    if( l_libCell then
      lib  = car(l_libCell)
      cell = cadr(l_libCell)
      view = if( caddr(l_libCell) caddr(l_libCell) "schematic" )
    else
      cv = errset(geGetEditCellView() t)
      cv = if( cv car(cv) nil )
      unless( cv
        printf("[circuit-canvas] ERROR: 当前没有正在编辑的 schematic（先打开一个原理图）\n")
        return(nil)
      )
      lib  = cv~>libName
      cell = cv~>cellName
      view = cv~>viewName
    )

    repo = ccFindRepo()
    unless( repo
      printf("[circuit-canvas] ERROR: 找不到 circuit-canvas 仓库，请设置 ccRepoPath 或 CC_REPO\n")
      return(nil)
    )

    outdir = ccOutDir()
    ccRunShell(sprintf(nil "mkdir -p '%s'" outdir))
    base = sprintf(nil "%s_%s" ccSafeName(lib) ccSafeName(cell))
    json = sprintf(nil "%s/%s.json" outdir base)
    html = sprintf(nil "%s/%s.html" outdir base)

    ;; 1) 导出 JSON（纯 SKILL，不经过 shell）
    unless( ccExportSchematicJson(list(lib cell view) json)
      printf("[circuit-canvas] ERROR: 导出 JSON 失败（%s/%s/%s）\n" lib cell view)
      return(nil)
    )

    ;; 2) 调 Python 转 HTML
    ;;    --no-js：数据已经内嵌在 HTML 里，不需要再往仓库的 assets/ 写一份
    ;;    （ccExtraArgs 里可以加 --portable 生成单文件零依赖版本）
    py  = ccFindPython()
    cmd = sprintf(nil "%s '%s/tools/virtuoso-to-canvas.py' '%s' --out '%s' --id '%s' --title '%s/%s' --label-scale %L --layout %s --no-js %s"
      py repo json html base lib cell ccLabelScale ccLayout ccExtraArgs)
    rc = ccRunShell(sprintf(nil "%s > '%s/%s.log' 2>&1" cmd outdir base))
    unless( rc == 0
      printf("[circuit-canvas] ERROR: Python 转换失败（exit=%d），日志 %s/%s.log\n" rc outdir base)
      return(nil)
    )

    ;; 3) 打开浏览器
    when( ccAutoOpenBrowser
      ccRunShell(sprintf(nil "%s '%s' >/dev/null 2>&1 &" ccBrowserCmd html)) )

    printf("[circuit-canvas] OK  %s\n" html)
    html
  )
)

;; 交互版：静默版 + 结果对话框（菜单 / 快捷键都走这里）
procedure( ccGenerateHtml(@optional l_libCell)
  let( (html)
    html = ccGenerateHtmlQuiet(l_libCell)
    if( html then
      unless( ccQuiet
        hiDisplayAppDBox(?name 'ccDoneDBox ?dboxBanner "回路 · HTML 电路图"
          ?dboxText sprintf(nil
            "已生成：\n%s\n\n【单文件】样式/符号库/逻辑都内联在里面，\n可以直接拷给别人、双击就能看。\n\n再次点击会覆盖；打开后仍可继续编辑、导出 SVG。\n输出目录：%s"
            html ccOutDir())
          ?buttonLayout 'Close) )
    else
      unless( ccQuiet
        hiDisplayAppDBox(?name 'ccFailDBox ?dboxBanner "回路 · 生成失败"
          ?dboxText "没能生成 HTML 电路图。\n请看 CIW 窗口里的 [circuit-canvas] 提示。"
          ?dialogType hicErrorDialog ?buttonLayout 'Close) )
    )
    html
  )
)

;; ══════════════════════════════════════════════════════════════════════
;; 菜单构造（5 个入口各自一组 item，名字必须互不相同）
;; ══════════════════════════════════════════════════════════════════════

;; —— 图标栏（固定菜单）：一个"生成"按钮 + 设置/关于 ——
procedure( ccFixedMenuItems()
  list(
    hiCreateMenuItem(?name 'ccGenItemF ?itemText "生成 HTML 电路图"
                     ?callback "ccGenerateHtml()")
    hiCreateMenuItem(?name 'ccDirItemF ?itemText "打开输出目录"
                     ?callback "ccOpenOutputDir()")
    hiCreateMenuItem(?name 'ccSetItemF ?itemText "设置"
                     ?callback "ccSettings()")
  )
)

;; —— 菜单栏下拉 ——
procedure( ccPulldownMenu()
  hiCreatePulldownMenu('ccPulldown "回路"
    list(
      hiCreateMenuItem(?name 'ccGenItemP ?itemText "生成 HTML 电路图"
                       ?callback "ccGenerateHtml()")
      hiCreateMenuItem(?name 'ccGenSelItemP ?itemText "生成 HTML（另存为…）"
                       ?callback "ccGenerateHtmlAs()")
      hiCreateSeparatorMenuItem(?name 'ccSepP)
      hiCreateMenuItem(?name 'ccDirItemP ?itemText "打开输出目录"
                       ?callback "ccOpenOutputDir()")
      hiCreateMenuItem(?name 'ccSetItemP ?itemText "设置…"
                       ?callback "ccSettings()")
      hiCreateMenuItem(?name 'ccAboutItemP ?itemText "关于 回路"
                       ?callback "ccAbout()")
    ))
)

;; —— 右键菜单 ——
procedure( ccPopupMenu()
  hiCreatePulldownMenu('ccPopUp "回路"
    list(
      hiCreateMenuItem(?name 'ccGenItemX ?itemText "生成 HTML 电路图"
                       ?callback "ccGenerateHtml()")
      hiCreateMenuItem(?name 'ccSetItemX ?itemText "设置…"
                       ?callback "ccSettings()")
    ))
)

;; ══════════════════════════════════════════════════════════════════════
;; 辅助命令
;; ══════════════════════════════════════════════════════════════════════
procedure( ccOpenOutputDir()
  let( (d)
    d = ccOutDir()
    ccRunShell(sprintf(nil "%s '%s' >/dev/null 2>&1 &" ccBrowserCmd d))
    t
  )
)

procedure( ccAbout()
  hiDisplayAppDBox(?name 'ccAboutDBox ?dboxBanner "回路 · 关于"
    ?dboxText sprintf(nil
      "回路 · 电路绘图 —— Virtuoso 一键导出\n\n仓库：%s\n输出目录：%s\n转换器：tools/virtuoso-to-canvas.py\n\n图标栏/菜单栏【回路】· Ctrl+Shift+G · 右键菜单\n命令行：ccGenerateHtml()"
      ccFindRepo() ccOutDir())
    ?buttonLayout 'Close)
  t
)

procedure( ccSettings()
  let( (form)
    form = hiCreateAppForm(?name 'ccSettingsForm ?formTitle "回路 · 设置"
      ?fields list(
        list("outdir"   "输出目录"             "string"  60 40 (ccOutDir()))
        list("repo"     "circuit-canvas 仓库"   "string"  60 40 (ccFindRepo() || ""))
        list("labelScale" "文字缩放"            "string"  10 10 sprintf(nil "%L" ccLabelScale))
        list("autoopen" "生成后自动打开浏览器"   "boolean" 20 2  ccAutoOpenBrowser)
        list("quiet"    "静默（不弹对话框）"     "boolean" 20 2  ccQuiet)
      )
      ?callback "ccSettingsApply(hiGetCurrentForm())"
    )
    hiDisplayForm(form)
    t
  )
)

procedure( ccSettingsApply(form)
  let( (v)
    v = errset(form->outdir t)     when( v car(v) ccOutputDir = car(v) )
    v = errset(form->repo t)       when( v && car(v) != "" ccRepoPath = car(v) )
    v = errset(form->labelScale t) when( v car(v) ccLabelScale = atof(car(v)) )
    v = errset(form->autoopen t)   when( v ccAutoOpenBrowser = car(v) )
    v = errset(form->quiet t)      when( v ccQuiet = car(v) )
    printf("[circuit-canvas] 设置已更新（仅本次会话；永久生效请写进 ~/.cdsinit）\n")
    t
  )
)

;; 换个名字 / 换目录导出（"另存为"）
procedure( ccGenerateHtmlAs()
  let( (form)
    form = hiCreateAppForm(?name 'ccSaveAsForm ?formTitle "回路 · 另存为"
      ?fields list(
        list("outdir" "输出目录" "string" 60 40 (ccOutDir()))
        list("name"   "文件名"   "string" 40 40
             sprintf(nil "%s_%s" ccSafeName(ccCurrentLib()) ccSafeName(ccCurrentCell())))
      )
      ?callback "ccGenerateHtmlAsApply(hiGetCurrentForm())"
    )
    hiDisplayForm(form)
    t
  )
)

procedure( ccGenerateHtmlAsApply(form)
  let( (outdir name saved html)
    outdir = errset(form->outdir t)  outdir = if(outdir car(outdir) ccOutDir())
    name   = errset(form->name t)    name   = if(name car(name) "schematic")
    saved  = ccOutputDir
    ccOutputDir = outdir
    html = ccGenerateHtmlQuiet(nil)
    ccOutputDir = saved
    when( html printf("[circuit-canvas] 另存为 -> %s\n" html) )
    t
  )
)

procedure( ccCurrentLib()
  let( (cv) cv = errset(geGetEditCellView() t)
    if( cv && car(cv) car(cv)~>libName "" ) )
)
procedure( ccCurrentCell()
  let( (cv) cv = errset(geGetEditCellView() t)
    if( cv && car(cv) car(cv)~>cellName "" ) )
)

;; ══════════════════════════════════════════════════════════════════════
;; 安装
;; ══════════════════════════════════════════════════════════════════════

;; fixed menu 的 enable 触发器：每个 schematic 窗口进入编辑模式时都会被调用，
;; 顺便把【回路】下拉菜单装到那个窗口的菜单栏上（否则只能手动装）。
procedure( ccGoodMenu(menu window)
  hiEnableMenuItem(menu 'ccGenItemF window)
  hiEnableMenuItem(menu 'ccDirItemF window)
  hiEnableMenuItem(menu 'ccSetItemF window)
  when( window errset(ccInstallBannerMenu(window) t) )
  t
)

procedure( ccReadOnlyMenu(menu window)
  ;; 只读模式也允许导出（导出本来就只是读），所以不做禁用
  t
)

;; 已经装过【回路】下拉菜单的窗口（hiGetBannerMenus 对某些窗口返回空，
;; 光靠它查重会重复插入，所以自己再记一份）
unless( boundp('ccBannerWindows) ccBannerWindows = nil )

;; 给指定窗口插【回路】下拉菜单；重复调用安全
procedure( ccInstallBannerMenu(win)
  let( (menus existing)
    when( win
      menus = errset(hiGetBannerMenus(win) t)
      menus = if( menus car(menus) nil )
      existing = nil
      foreach( m menus
        when( errset(m~>title t) && car(errset(m~>title t)) == "回路" existing = m ) )
      when( member(win ccBannerWindows) existing = t )
      unless( existing
        errset(hiInsertBannerMenu(win ccPulldownMenu() hiGetNumMenus(win)) t)
        ccBannerWindows = cons(win ccBannerWindows) )
    )
    t
  )
)

;; 给当前所有 schematic 窗口装上行下拉菜单
procedure( ccRefreshAllWindows()
  let( (cv)
    foreach( w hiGetWindowList()
      cv = errset(w~>cellView t)
      when( cv && car(cv) && car(cv)~>viewName == "schematic"
        ccInstallBannerMenu(w) )
    )
    t
  )
)

;; 注册 schematic 固定菜单（图标栏）。
;;
;; ⚠️ 注意：这是官方唯一开放的接口，但它是「替换」而不是「追加」——注册之后
;;    schematic 窗口左侧/顶部的默认图标按钮会变成下面这三个。所以默认不启用，
;;    想用图标栏就显式调 ccInstallFixedMenu() 或在 .cdsinit 里 (ccInstallFixedMenu)。
;;    要恢复默认图标栏：schUnregisterFixedMenu("schematic")
procedure( ccInstallFixedMenu()
  let( (items win defaults)
    items = ccFixedMenuItems()
    ;; 能读到当前窗口固定菜单的条目就追加在后面（部分版本可能读不到，读不到就只放我们的）
    win = errset(hiGetCurrentWindow() t)
    win = if( win car(win) nil )
    defaults = nil
    when( win
      defaults = errset(hiGetMenuItems(hiGetWindowMenu(win)) t)
      defaults = if( defaults && listp(car(defaults)) && car(defaults) car(defaults) nil ) )
    when( defaults items = append(items defaults) )
    ;; arg5 doneCB 必须给 symbol/string（不能用 nil），arg6 是 showTextWithIcon
    errset(hiCreateVerticalFixedMenu('ccFixedMenu items 1 4 'CDS_DUMMY 'none) t)
    errset(schRegisterFixedMenu("schematic" ccFixedMenu 'ccReadOnlyMenu 'ccGoodMenu) t)
    printf("[circuit-canvas] 已注册 schematic 图标栏（原默认图标被替换，恢复用 schUnregisterFixedMenu(\"schematic\")）\n")
    t
  )
)

procedure( ccUninstallFixedMenu()
  errset(schUnregisterFixedMenu("schematic") t)
  printf("[circuit-canvas] 已恢复 schematic 默认图标栏\n")
  t
)

procedure( ccInstallBindKeys()
  errset(hiSetBindKey("Schematics" "Ctrl<Key>G" "ccGenerateHtml()") t)
  errset(hiSetBindKey("Schematics" "Shift<Key>G" "ccGenerateHtml()") t)
  t
)

procedure( ccRegisterPopUpMenus()
  ;; schRegisterPopUpMenu(category menuHandle mode) —— mode 必填且要字符串：
  ;; "edit" = 编辑模式，"read" = 只读模式。两种都注册上。
  ;; 注意：该函数内部依赖 Schematic Editor 建好的 schOSMCategories 全局变量，
  ;; 没有 schematic 窗口时（纯 CIW / nograph）会报 unbound，所以先探一下。
  if( boundp('schOSMCategories) then
    foreach( mode list("edit" "read")
      errset(schRegisterPopUpMenu("schematic" ccPopupMenu() mode) t)
      errset(schRegisterPopUpMenu("schDefault" ccPopupMenu() mode) t)
      errset(schRegisterPopUpMenu("schSelSet"   ccPopupMenu() mode) t) )
  else
    printf("[circuit-canvas] 提示：还没开过 schematic 窗口，右键菜单本次跳过\n")
    printf("[circuit-canvas]       打开一个 schematic 后调 ccRegisterPopUpMenus() 即可补上\n")
  )
  t
)

;; CIW 菜单栏里的 Tools / 工具 菜单，按标题找（没有固定属性名）
procedure( ccCiwToolsMenu()
  let( (menus found title)
    menus = errset(hiGetBannerMenus(hiGetCIWindow()) t)
    menus = if( menus car(menus) nil )
    found = nil
    foreach( m menus
      title = errset(m~>title t)
      title = if( title car(title) "" )
      when( !found && (title == "Tools" || title == "工具") found = m ) )
    found
  )
)

procedure( ccRegisterCIWMenu()
  let( (item menu)
    item = hiCreateMenuItem(?name 'ccCiwItem ?itemText "回路：生成 HTML 电路图"
                            ?callback "ccGenerateHtml()")
    menu = ccCiwToolsMenu()
    if( menu then
      errset(hiInsertMenuItem(menu item 0) t)
    else
      ;; 找不到 Tools 菜单就退一步：给 CIW 菜单栏插一个独立下拉（带重复检查）
      ccInstallBannerMenu(hiGetCIWindow())
    )
    t
  )
)

;; 打印当前注册状态（排查用：检查菜单到底装上没有）
procedure( ccMenuReport()
  let( (win menus)
    printf("---- circuit-canvas 集成状态 ----\n")
    printf("  repo       : %L\n" ccFindRepo())
    printf("  python     : %L\n" ccFindPython())
    printf("  outputDir  : %L\n" ccOutDir())
    printf("  bindKey    : %L\n" errset(hiGetBindKey("Schematics" "Ctrl<Key>G") t))
    win = errset(hiGetCurrentWindow() t)
    win = if( win car(win) nil )
    menus = if( win errset(hiGetBannerMenus(win) t) nil )
    menus = if( menus car(menus) nil )
    printf("  当前窗口菜单栏 (%d): %L\n" length(menus)
      mapcar(lambda((m) if(errset(m~>title t) car(errset(m~>title t)) "?")) menus))
    printf("---------------------------------\n")
    t
  )
)

;; 总安装入口：装的是「不破坏原界面」的那几项。
;; 图标栏（会替换默认图标）需要额外调 (ccInstallFixedMenu)。
procedure( ccInstall()
  ccInstallBindKeys()
  ccRegisterPopUpMenus()
  ccRegisterCIWMenu()
  ccRefreshAllWindows()
  when( ccFixedMenuOn (ccInstallFixedMenu) )
  printf("[circuit-canvas] 已安装：菜单栏【回路】/ Ctrl+Shift+G / 右键菜单 / ccGenerateHtml()\n")
  printf("[circuit-canvas] 状态自检：ccMenuReport()   想要图标栏按钮：ccInstallFixedMenu()\n")
  t
)

;; ══════════════════════════════════════════════════════════════════════
;; 自检（装完想知道到底通不通，就调 ccSelfTest()）
;; ══════════════════════════════════════════════════════════════════════
procedure( ccSelfTest(@optional l_libCell)
  let( (repo py conv ok items html n kb cb fn)
    ok = t
    printf("========== circuit-canvas 自检 ==========\n")

    ;; 1) SKILL 侧函数是否都在
    foreach( f list('ccExportSchematicJson 'ccExportCurrentCellView 'ccGenerateHtmlQuiet
                    'ccGenerateHtml 'ccInstallFixedMenu)
      if( errset(arglist(f) t)
        then printf("  [ok]   函数 %s\n" f)
        else printf("  [FAIL] 缺函数 %s\n" f) ok = nil ) )

    ;; 2) 仓库与转换器
    repo = ccFindRepo()
    if( repo
      then printf("  [ok]   仓库 %s\n" repo)
      else printf("  [FAIL] 找不到 circuit-canvas 仓库（设 ccRepoPath 或 CC_REPO）\n") ok = nil )
    when( repo
      conv = strcat(repo "/tools/virtuoso-to-canvas.py")
      if( isFile(conv)
        then printf("  [ok]   转换器 %s\n" conv)
        else printf("  [FAIL] 缺 %s\n" conv) ok = nil ) )

    ;; 3) python
    py = ccFindPython()
    if( py && isFile(py) && ccRunShell(sprintf(nil "'%s' -c 'pass'" py)) == 0
      then printf("  [ok]   python %s\n" py)
      else printf("  [FAIL] python 不可用：%L\n" py) ok = nil )

    ;; 4) 菜单/图标栏能不能构造出来（构造本身就会校验 name / itemText / callback）
    ;;    注：hiMenuItem 是 defstruct，槽位名没有公开，读不回来，所以这里只验构造。
    items = errset(ccFixedMenuItems() t)
    items = if( items car(items) nil )
    if( items && listp(items)
      then printf("  [ok]   图标栏条目 %d 个构造成功\n" length(items))
      else printf("  [FAIL] ccFixedMenuItems() 构造失败\n") ok = nil )
    unless( errset(ccPulldownMenu() t)
      printf("  [FAIL] ccPulldownMenu() 构造失败\n") ok = nil )
    unless( errset(ccPopupMenu() t)
      printf("  [FAIL] ccPopupMenu() 构造失败\n") ok = nil )

    ;; 5) 绑定键
    kb = errset(hiGetBindKey("Schematics" "Ctrl<Key>G") t)
    kb = if( kb car(kb) nil )
    if( kb
      then printf("  [ok]   Ctrl+Shift+G -> %L\n" kb)
      else printf("  [FAIL] Ctrl+Shift+G 未绑定\n") ok = nil )

    ;; 6) 真跑一遍（给了 lib/cell 才算）
    if( l_libCell
      then
        html = ccGenerateHtmlQuiet(l_libCell)
        if( html && isFile(html)
          then printf("  [ok]   端到端导出 %s/%s -> %s\n" car(l_libCell) cadr(l_libCell) html)
          else printf("  [FAIL] 端到端导出失败 %L\n" html) ok = nil )
      else printf("  [--]   跳过端到端导出（想看就调 ccSelfTest(list(\"lib\" \"cell\"))）\n") )

    printf("========== 自检结果：%s ==========\n" if(ok "全部通过" "**有失败项**"))
    ok
  )
)

;; 卸载：尽可能恢复原样（SKILL 没有「移除 banner 菜单」的接口，
;; 已装上的【回路】下拉菜单会留到该窗口关闭为止）
procedure( ccUninstall()
  errset(hiSetBindKey("Schematics" "Ctrl<Key>G" "") t)
  errset(hiSetBindKey("Schematics" "Shift<Key>G" "") t)
  foreach( mode list("edit" "read")
    when( boundp('schOSMCategories)
      errset(schUnregisterPopUpMenu("schematic" mode) t)
      errset(schUnregisterPopUpMenu("schDefault" mode) t)
      errset(schUnregisterPopUpMenu("schSelSet" mode) t) ) )
  errset(schUnregisterFixedMenu("schematic") t)
  printf("[circuit-canvas] 已卸载（已打开的窗口里【回路】菜单会保留到窗口关闭）\n")
  t
)
