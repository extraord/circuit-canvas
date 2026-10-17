;; circuit_canvas.il -- Virtuoso 集成入口（.cdsinit 里只 load 这一个文件）
;;
;; 推荐在 ~/.cdsinit 里这样写（显式给出路径最稳）：
;;
;;   ccRepoPath     = "/work/agent_cowork/circuit-canvas"
;;   ; ccOutputDir  = "/home/me/circuit_html"   ; 默认 ~/circuit_canvas_out
;;   ; ccAutoOpenBrowser = t                    ; 默认 t
;;   ; ccFixedMenuOn = t                        ; 默认 nil；t 会在 schematic 图标栏加一排【回路】按钮
;;   load(strcat(ccRepoPath "/virtuoso/circuit_canvas.il"))
;;
;; 功能：在 Schematic Editor 里一键把当前原理图导出成 circuit-canvas 的
;;       可编辑 HTML 电路图（元件换成回路元件库的符号、导线重画、网络名标注）。
;;
;; 菜单 / 快捷键：
;;   菜单栏【回路】→ 生成 HTML 电路图        （每个 schematic 窗口自动装上）
;;   Ctrl+Shift+G                            （Schematics 工具下）
;;   右键 → 回路 → 生成 HTML 电路图
;;   CIW → Tools → 回路：生成 HTML 电路图
;;   命令行：ccGenerateHtml() / ccGenerateHtmlQuiet(list("lib" "cell"))
;;
;; 卸载：ccUninstall()（恢复绑定/菜单）

;; 本文件所在目录 —— SKILL 没有可靠的「当前文件路径」接口
;; （hiGetCurrentFileName 在 IC25 里不存在），所以按下面的顺序找：
;;   1) 用户显式设置的 ccRepoPath / CC_REPO
;;   2) 常见默认位置
let( (cands repo vdir)
  cands = list( getShellEnvVar("CC_REPO")
                if(boundp('ccRepoPath) ccRepoPath nil)
                "/work/agent_cowork/circuit-canvas"
                strcat(getShellEnvVar("HOME") "/circuit-canvas") )
  repo = nil
  foreach( c cands
    when( c && !repo
      when( isFile(strcat(c "/virtuoso/cc_export.il"))
            && isFile(strcat(c "/virtuoso/cc_menu.il"))
        repo = c ) )
  )
  if( repo then
    ccRepoPath = repo
    vdir = strcat(repo "/virtuoso")
    load(strcat(vdir "/cc_export.il"))
    load(strcat(vdir "/cc_menu.il"))
    ccInstall()
  else
    printf("*ERROR* circuit_canvas.il: 找不到 circuit-canvas 仓库。\n")
    printf("        请在 .cdsinit 里先设置 ccRepoPath，或设环境变量 CC_REPO。\n")
    printf("        例如: ccRepoPath = \"/work/agent_cowork/circuit-canvas\"\n")
  )
)
