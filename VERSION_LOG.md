# Version Log

- [2026-05-20 14:50] v0.35.6 — paste 路径合一走 native 事件，去掉 WKWebView 的 "Paste" 系统按钮 + 修粘图后双指变缩放
  - ⌘V keydown 分支之前调 `navigator.clipboard.read()`，Tauri WKWebView 安全策略会弹 macOS 系统 "Paste" 大按钮要点一下；并且这个按钮抢焦点导致后续 wheel 事件 ctrlKey 状态混乱，两指 pan 变 pinch zoom
  - 删 keydown 拦截，统一走 native `paste` 事件（同步拿 clipboardData，无权限提示），image/cards 信封/纯文本三条分支都通过 evt.clipboardData 路由

- [2026-05-20 14:39] v0.35.5 — 图片粘贴自动 resize + JPEG 重编码，修单卡 5 MB 拖卡死的性能问题
  - 之前 paste image 只把 `w`/`h` 改成渲染尺寸，原始 base64 PNG 整张存进 BoardData，2000×2200 截图 ≈ 5 MB → 每次 drag tick 都过 React state、save 文件、跳转 board 第一次 paint 都卡
  - canvas 缩到 max 800 px 宽（兼顾 2x zoom 清晰）+ `toDataURL("image/jpeg", 0.85)`，典型 screenshot 5 MB → 50-300 KB
  - 已存在的卡不动（user 说 ignore existing）

- [2026-05-20 14:26] v0.35.4 — 顶栏 tab + pinned chip 也禁止右键选文字
  - v0.35.3 只处理了下拉行，顶栏 CUSTOM · INVES 那段 + pinned chip "3DGS" 还会被右键选中弹 macOS 查询菜单；在 tabBtnStyle helper + PinnedTabsStrip chip style 加 `user-select: none`，一次覆盖所有 tab 按钮

- [2026-05-20 14:22] v0.35.3 — 删 stride slider 开发组件 + dropdown 行禁止右键选中文字
  - 底部 ↕ STRIDE 滑块是开发期调参用的，不该 ship；删 UI 但保留 240 作为 mindmapLayout 默认值
  - WORKING ON / CUSTOM dropdown 里 view 行右键时 WebKit 会先选中文字再弹菜单（preventDefault 拦不住选择层），给行加 `user-select: none`（编辑态例外）

- [2026-05-20 12:20] v0.35.2 — codex review 抓的 3 个 race / 死代码修干净
  - paste 自动选中：删掉残留的 RAF setNodes（会跟 nodes-rebuild useEffect 抢，造成选中被立刻擦掉），改用 `pendingSelectionRef` 一条路
  - pinned tab 启动 race：之前 cv.manifest 还没 load 时 existingIds=[]，reconcile pass 会把磁盘上 pinned 全当 orphan 抹了；usePinnedTabs 加 `existingIdsLoaded` 参数，未 load 不 reconcile
  - day view 新建 TOCTOU：连点 "New" 两次能绕过去重检查；handleCreate 加 in-flight ref，第一次没 resolve 之前 drop 第二次

- [2026-05-20 11:57] v0.35.1 — pinned tab 跨版本持久化 + 右键 Unpin + day view 当日去重 + × delete 真删
  - pinned tabs 从 localStorage 迁到 `<data>/pinned_tabs.json`（带一次性迁移），升级 app 不再清空；右键 chip 出 "Unpin tab"
  - 当日已有 day view 时再点 "New" 落到已有那个，不新建重复；历史的多个同日 view 不动
  - WORKING ON 下拉的 × 之前调 `window.confirm()` 在 Tauri WKWebView 里恒 false 所以从来没真删过，改成两次点击 inline 确认（第一次变红 "确认?"，第二次提交，3 秒超时自动 disarm）

- [2026-05-20 10:38] v0.35.0 — up/down 纵向间距滑块 + 复制粘贴改进 + 画布最大缩放 1.2→2 + 切方向整画布 tidy
  - 画布底部滑块（160-700 px，默认 240，存 localStorage），只在存在 up/down 树时显示；拖动实时重 tidy，长卡片自动加 40 px clearance 避免重叠
  - 复制 up/down 树粘贴后保留 direction；位置算法优先视野内不重叠的候选偏移，找不到就视野中心；粘贴自动多选整组方便拖动
  - 切 root 方向后跑 tidyAllRoots 而不是单树，邻居树跟着重排不重叠
  - 画布最大缩放从 1.2 提到 2（zoom in 看长 note 内容更清楚）

- [2026-05-19 19:29] v0.34.0 — mindmap 根节点 4 向生长 (右/左/上/下)
  - 每棵树根节点可独立设方向，右键 root 选 Right/Left/Up/Down；Tab 插入、F/Shift+F tidy、edge stem 全部跟着方向走；旧 board 缺字段默认 right

- [2026-05-19 16:49] v0.33.7 — ADD ISSUE / WORKING ON / CUSTOM 的 ▾ 换成 stroke chevron
  - unicode "▾" 是黑色实心三角，跟旁边 uppercase 11px label 视觉权重不搭；改成 10px 矩形 viewBox 内 1.4px stroke chevron，opacity 0.65 跟 paper 颜色调和

- [2026-05-19 16:47] v0.33.6 — WORKING ON / CUSTOM tab 中间分隔点单独画大一号
  - middle dot 跟 label 拆成两个 span，dot fontSize 10 → 14、垂直对中、opacity 0.45，跟 uppercase title 视觉上对齐

- [2026-05-19 16:46] v0.33.5 — WORKING ON 后缀宽度 140 → 100，原本留太多空白

- [2026-05-19 16:45] v0.33.4 — pinned chip 拖排序换 pointer events 实现
  - HTML5 DnD 在 Tauri WebKit 上被 OS-level 文件拖入服务拦截不工作；改成 setPointerCapture + 4px threshold 自己实现拖动，单击仍 activate，超过阈值才进 drag

- [2026-05-19 16:44] v0.33.3 — issue count 固定宽度，0/1/N 切换不再带着中部 chip 抖动

- [2026-05-19 16:39] v0.33.2 — 顶栏 tab 不再随 d / 1-9 切 view 抖动 + pinned chip 拖排序修复
  - WORKING ON / CUSTOM 后缀从 maxWidth → 固定 width，按钮外宽锁定；AGENT_TMP 和 ☰ 钉死在右边不再左右滑
  - PinnedTabsStrip 拖动逻辑用 ref 镜像 dragIdx，React 异步 state 批处理引起的"首个 dragover 没 preventDefault" race 修了，chip 现在真的能拖换位

- [2026-05-19 16:35] v0.33.1 — drop 判定调成"放松"而非"收紧"
  - 上一版 0.33.0 把判定 bbox 缩到 60% 中心区，跟 user 要的"放松"方向相反；改 1.2 倍向外扩，蹭边也能 reparent

- [2026-05-19 16:09] v0.33.0 — 粘图卡更干净 + drop 光晕染目标色 + 拖判定收紧
  - 只有图片没文字的 note 不再显示顶部 "NOTE" 标识，粘图即图卡
  - drop-target 光晕颜色跟随目标 note 自己 swatch（issue 仍走暖红 fallback），不再永远红
  - 拖判定从整张 target bbox 收紧到中心 60% 区域，蹭边不再误触发 reparent

- [2026-05-19 15:52] v0.32.0 — ⌘V 走 OS clipboard 单一路径 + 空格聚焦视觉中心 + drag-reparent 自动 tidy + drop cue 改光晕
  - ⌘C 把卡片打包成 `linear-board-cards:<base64>` envelope 写进系统剪贴板；⌘V 只看系统剪贴板：图片→图，envelope→卡，纯文本→新建 note，空→不动；内存 buffer 整条退役
  - 没焦点时按空格自动把 halo 落到 viewport 视觉中心最近的卡，并 pan 进舒适区（不进 edit，也不开 DetailPanel）
  - 拖一张卡丢到另一张上完成 reparent：edge 重连 + 同帧整理 A 子树到 B 右侧；落到自己 descendant 上识别为 cycle，只移位置不 reparent；空白处 drop 只移位置不整理
  - drag 时悬停 target 的视觉反馈从 2px 红边换成两层暖红光晕（rgba 0.18 + 0.35），读起来是"卡在发光"不是"卡被画框"

- [2026-05-19 14:38] v0.31.0 — UI 调（zoom / 方向键 pan / ADD ISSUE 固定位）+ Shift+Tab 顺序 fix 二次修
  - 缩放上限从 200% 收到 120%，再怎么 pinch 也不会把卡片放成全屏怪兽
  - 方向键换 halo 后顺手把新焦点 pan 到 viewport 舒适区（25%–75%），靠边的卡也居中露脸
  - ADD ISSUE 按钮永远显示在右侧 ViewSwitcher 左边；不在 Working On / Custom 时按钮 disable + tooltip 提示，再不让顶栏 chip 左右滑动
  - Shift+Tab 在 [A,B,C] 兄弟里选 B 新建终于真的回到 [A,B,N,C]（v0.29.0 那一波只改了 Y 没改 edges 顺序也没处理 ReactFlow 测量未到位的情况）

- [2026-05-19 11:56] v0.30.0 — 拖卡到另一张卡上 → reparent
  - 拖动中目标卡边框出现暖红 cue；旧 parent edge 自动清掉，多选拖整组改嫁同一 target，按 U 一步还原 edge + 位置

- [2026-05-19 11:57] v0.29.0 — iCloud Drive 自动备份 + 一堆 bug 修
  - 每天 00:00/12:00/15:00/18:00/21:00 把整个 data 目录拷到 `~/Library/Mobile Documents/com~apple~CloudDocs/LinearBoardBackup/<时间戳>/`，保留最近 30 天；iCloud Drive 没开就静默跳过
  - Shift+Tab 在 [A,B,C] 兄弟里选 B 新建，顺序回到 [A,B,N,C]（之前 N 总掉到最末尾）
  - ⌘V：剪贴板里有图片优先粘图片，没图片才粘内存里的卡片 buffer（之前粘卡片永远赢，截屏后 ⌘V 也是粘旧卡片）
  - Esc：依次退连线模式 → 退编辑 → 清选中（halo + DetailPanel 一起清空），不再被 WebKit 默认行为捎带退出 app 全屏
  - 方向键换 halo 时清空其他多选，不再把多张卡同时高亮成"全选"
  - dropdown 里 × 删 view 真的能删，最后一个 view 删完会自动新建空白 view，操作完弹 toast
  - 给 backupNow() Tauri 命令供 tester / 手动触发

- [2026-05-19 11:44] v0.28.0 — Custom view 可右键 pin 到顶栏 chip 条 + 单键切换视图（A/S/D/1–9）
  - chip 支持拖拽排序，顺序持久化；右键 Custom 下拉行出现 Pin/Unpin 菜单

- [2026-05-18 20:55] v0.27.2 — F tidy 换成 slot-based 布局，浅叶子不再被深叶子兄弟挤同一行
  - 兄弟子树深浅不等时旧算法允许深叶子"溜"到浅叶子旁边，视觉上不像树

- [2026-05-18 20:28] v0.27.1 — 修 U / Shift+U 死循环 + 写入 Agent Self-Test 开发规范
  - 之前每按一次 U 状态都被 echo 压回栈顶，undo/redo 永远原地打转

- [2026-05-18 20:03] v0.27.0 — Tab 新卡自动 pan 到视觉舒适区
  - 之前新卡常落到屏幕外（尤其链路一路向右），需要手动 pan 找

- [2026-05-18 17:52] v0.26.4 — canvas 背景换成跟随 viewport 的暖灰小圆点

- [2026-05-18 17:44] v0.26.3 — F tidy 间距/排序微调

- [2026-05-18 16:47] v0.26.2 — release.sh 启动时自动 source .env
  - 之前 npm run release 拿不到 TAURI_SIGNING_PRIVATE_KEY_PASSWORD 会直接 die

- [2026-05-18 15:40] v0.26.1 — 修 dev mac 数据被 baked 进 .app bundle（长期 leak）
  - 0.25.x 各版本都中招；发版的 .app 装别的 mac 自带 dev 机的真实数据

- [2026-05-18 15:17] v0.26.0 — 删 web，独留 Tauri runtime
  - Agent UI 保留 placeholder，等 Rust pty 落地再接回

- [2026-05-18 14:34] v0.25.2 — Check Update 菜单项显示当前版本号

- [2026-05-18 11:48] v0.25.1 — Updater 走 Clash proxy + check 加 30s timeout
  - .app 进程不继承 shell HTTPS_PROXY，本机直连 github.com 走不通

- [2026-05-18 11:25] v0.25.0 — App 内自动更新（Tauri + GitHub Releases）
  - 首次升级断层：≤ v0.24.1 装机必须手动重装 v0.25.0 才能享 updater，之后 self-serve

- [2026-05-16 15:01] v0.24.1 — 撤掉 Edge 样式选择器（v0.22.0 引入的）
  - 沟通失误导致这个功能被留了下来 —— 原本只是 review，不该 ship

- [2026-05-16 14:29] v0.24.0 — Tab 键位调整 + 新卡片自动落位
  - F / Shift+F 互换；Tab/Shift+Tab 出来的新卡片自动全局 tidy

- [2026-05-15 23:18] v0.23.0 — Agent_tmp tab：board 内启动 / 监控 / 对话 OPUS team agent
  - 后已 placeholder 化（v0.26.0），等 Rust pty 落地再接回

- [2026-05-15 22:45] v0.22.0 — Edge 样式选择器
  - 后已撤回（v0.24.1），原本只是 review 不该 ship

- [2026-05-15 20:58] v0.21.2 — 修 day view week-of-year 算法（改成 Sunday-based）

- [2026-05-15 20:53] v0.21.1 — 迁移存量 day view 名称到 `WW.D` 新格式

- [2026-05-15 20:44] v0.21.0 — 新增 Custom view 类别 + Day view 命名/改名规则更新
  - day view 禁止 rename，custom view 可任意命名

- [2026-05-15 17:34] v0.20.0 — Mindmap tidy 快捷键 (F / Shift+F) + 干净 edge 路由
  - F 整理 focused subtree、Shift+F 整画布；同源 edge 在 shared stem 处汇合

- [2026-05-15 16:52] v0.19.0 — NoteCard 双向链接 `[[YYMMDDxx]]` + 右键扩展菜单
  - 右键 Copy ID 把 `[[xxx]]` 写剪贴板，下张卡 paste 即用

- [2026-05-15 16:18] v0.18.0 — 背景色调淡为 warm-softer-1 + 颜色 token 全面语义化

- [2026-05-15 15:28] v0.17.1 — 修 Tab 新建子 note 把 parent 一起拖进多选

- [2026-05-15 14:53] v0.17.0 — 快捷键重排 + redo + connect 配对语义 + 启动默认最新 working_on view
  - C 切 connect / U undo / Shift+U redo；空白点击退出连接

- [2026-05-15 11:41] v0.16.0 — NoteCard 支持粘贴剪贴板图片 + 文本图片可交替
  - 单选/编辑中 note 直接粘进去，空白处粘则新建抱图 note；图片选中后 4 角 handle 缩放

- [2026-05-14 19:43] v0.15.1 — Working on 复选框视觉换装
  - 蓝填居中白条换成蓝描边空框 + 强内辉，更像 todo 而非 done

- [2026-05-14 17:39] v0.15.0 — Note 加 working on 三态 + 调色板单选/多选都浮到选区右上角
  - checkbox 由 todo / done 扩成 todo → working on → done 循环

- [2026-05-14 17:34] v0.14.0 — NoteCard 编辑态所见即所得 + 多选共享调色板
  - 编辑态字体大小与展示态 1:1，多选 ≥2 时浮层颜色一键同步

- [2026-05-14 16:55] v0.13.2 — 修 group 解散后下一拖仍整组同移 + frame 区域可拖

- [2026-05-14 16:55] v0.13.1 — 修 v0.13.0 成组后拖动"时好时坏"

- [2026-05-14 16:55] v0.13.0 — Card 分组（移动作用域）
  - 多选 ≥2 张按 g 成组、再按 g 解散；group 只约束移动，其他行为各自独立

- [2026-05-14 15:17] v0.12.1 — 修 Tab/Shift+Tab 新建 note 不进入 edit、Space 切 edit 光标随机不进 textarea

- [2026-05-14 15:10] v0.12.0 — NoteCard 加 done 状态
  - 右上角 Things 3 风格 todo 框；done 后整卡静音灰 + 文字 strikethrough

- [2026-05-14 14:56] v0.11.0 — Working On 多 view 第一波打磨
  - 双击改名、下拉按 createdAt 倒序、切 view 自动 fitView、picker 加 issue 落视野内

- [2026-05-14 14:34] v0.10.0 — Working On 升级成多 view 集合
  - 同一 issue 可同时在多 view 位置独立；新增 ⌘C/⌘V 跨 view 复制粘贴

- [2026-05-13 17:13] v0.9.1 — 修 v0.9.0 共用 CanvasBoard 后的边删除 / C 键回归

- [2026-05-13 17:13] v0.9.0 — 两个 board（All Issues / Working On）操作逻辑统一
  - All Issues 也能 connect / 建 note / 删边

- [2026-05-13 17:13] v0.8.0 — All Issues edge 可点击 + Delete 解除父子链接
  - 后已回滚（v0.9.0）：连线不再写 Linear parent

- [2026-05-13 16:36] v0.7.0 — NoteCard 改 Apple HIG 同心圆角

- [2026-05-13 16:12] v0.6.0 — Note body 内 URL / 绝对文件路径自动识别为链接
  - http(s) 新窗口打开，本地路径走 OS opener

- [2026-05-13 16:10] v0.5.0 — Note 调色板 + Cmd/Ctrl+Enter + ☰ 菜单 + 全局快捷键 + edge 重路由 / 吸附

- [2026-05-13 14:58] v0.4.0 — All Issues 视图按 team › project 自动分组

- [2026-05-13 14:19] v0.3.0 — Working On 视图
  - 顶栏 view 切换 + add issue popover；自建 note 节点 + 双向连接 + 边 label

- [2026-05-12 14:44] v0.2.0 — Linear Board v1
  - 自由画布 + 顶栏 Refresh + 过滤搜索 + 父子连线 + 详情面板 + 8 字段写回 Linear

- [2026-05-12 14:28] v0.0.1 — 初始化仓库与 README
