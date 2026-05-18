# Version Log

格式：`- vX.Y.Z — <一句话标题>`，时间倒序。非平凡条目下挂缩进子弹列出细节。规则见 `CLAUDE.md` → Pride Versioning。

- v0.26.2 — `scripts/release.sh` 自动 source `.env`
  - 之前 `npm run release` 启动时 env 没有 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`，导致签名步骤直接 die；用户得手动 `set -a && source .env && set +a` 或写进 shell rc
  - 修：release.sh 在 cd 到 repo root 后立刻 `set -a; . "$REPO_ROOT/.env"; set +a`（如果文件存在）。一行 if-fi 块，无外部依赖（不需要 dotenv-cli）
  - 顺手把 `dist/` 之外的工作流瑕疵补齐——以后新机器只要 `~/.tauri/board_updater.key` 和 `.env` 都到位，`npm run release` 一条命令直通 GitHub

- v0.26.1 — 修 dev mac 数据被 baked 进 .app bundle（长期 leak）
  - `public/data/` 在 dev 机器上有真实 issues / working_on / custom / agent_sessions 数据；vite build 把它拷到 `dist/data/`，Tauri 通过 `frontendDist: "../dist"` 把 dist 整个 embed 进 Rust binary —— 于是每次发版的 .app 装到别的 mac 上都自带 dev 机器的数据
  - 长期 bug，0.25.x 各版本都中招；0.26.0 也漏修
  - 修：`rm -rf public/`（dual-stack 时代浏览器 fetch `/data/issues.json` 才需要的，单一 Tauri runtime 完全不用）
  - 验证：rebuild 后 `dist/` 只剩 `assets/ + index.html`，6.3MB binary 里只残留 Rust struct field name（`issueMembers` / `noteNodes`），无真实数据；裸装 .app 到新机会读 Rust 端 fallback empty placeholder

- v0.26.0 — 删 web，独留 Tauri runtime
  - 放弃 dual-stack：browser dev server + `linearApiPlugin` 整条路径全部退役，仓库只剩一个 Tauri runtime
  - 删 `src/server/` (linearApiPlugin / agentPoller / agentSessions / boardStore / node-pty.d.ts) + `scripts/{fetchSnapshot,agent_post}.ts` + `src/linear/{createComment,fetchIssues}.ts` —— ~1700 LOC 净减
  - 删 `src/lib/tauriBridge.ts` (global-fetch monkey-patch) + `linearSdkStub.ts`；新增 `src/lib/tauriInvoke.ts` 集中所有 Tauri command typed wrapper
  - 前端 8 处 `fetch("/api/...")` / `fetch("/data/...")` 全改为直 `invoke()`；`useBoardState` 接口从 endpoint 字符串改成 `BoardSource` 判别联合
  - 合并 `vite.config.ts` + `vite.tauri.config.ts` → 单一 `vite.config.ts`；`tauri.conf.json` `beforeDev/Build` 直接调 `vite` / `tsc -b && vite build`
  - 删 npm scripts：`dev` / `build` / `preview` / `fetch` / `tauri:frontend-dev` / `tauri:frontend-build`；保留 `tauri` / `tauri:dev` / `tauri:build` / `release` / `release:dev`
  - 删 npm deps：`@linear/sdk` / `dotenv` / `tsx` / `node-pty`
  - Agent 功能 UI 保留 placeholder（option A）—— `useAgentSessions` stub 返回常量 disabled；Rust pty 实现等将来另起 arc
  - 删 `docs/development_modes.md`；`CLAUDE.md` 去掉 "Runtime Targets / 三处同步约定 / Dev-time API plugin" 整段
  - Bundle 443.63KB / 265 modules（v0.25.2 是 447KB / 同等模块数）

- v0.25.2 — Check Update 菜单项显示当前版本号
  - 菜单 hint 区位显示 `v0.25.2`（取自 `package.json`），跟 Refresh 的 "synced 1d ago" 风格一致
  - 顺手作为真实更新流的首次端到端测试：v0.25.1 装机 → 点 Check Update → 抓到 v0.25.2 → 自动装 + 重启

- v0.25.1 — Updater 走 Clash proxy + check 加 30s timeout
  - `.app` 进程不继承 shell `HTTPS_PROXY`，本机直连 github.com 走不通，导致 v0.25.0 的 Check Update 点了无限转
  - `src/lib/updater.ts` 给 `check()` 硬传 `proxy: "http://127.0.0.1:7890"`（localhost 写死，未来若 dev 不再用 Clash 再抽象）
  - 同时套 `Promise.race` + 30s timeout，避免 plugin 静默挂起

- v0.25.0 — App 内自动更新（Tauri + GitHub Releases）
  - Hamburger menu 新增 "Check Update" 项（仅 Tauri runtime 出现，浏览器隐藏）
  - 接 `tauri-plugin-updater` v2 + `@tauri-apps/plugin-updater` / `plugin-process`，私钥 `~/.tauri/board_updater.key`，公钥嵌入 `tauri.conf.json`
  - 三态 UI：toast "已是最新"（3 秒自消失）／modal "发现 vX.Y.Z" 提示安装／modal 下载进度 → `relaunch()`
  - `scripts/release.sh prod` 扩成签名 + 生成 `latest.json` + `gh release create` 一条龙
  - 顺手对齐版本号：`Cargo.toml` 从 0.23.0 提到与 `package.json` 一致
  - **首次升级断层**：≤ v0.24.1 装机必须手动重装 v0.25.0 才能享 updater；之后 self-serve
  - 私钥本体 + 密码已存密码管理器；丢失 = 永远无法发新版

- v0.24.1 — 撤掉 Edge 样式选择器（v0.22.0 引入的）
  - 删除 `EdgeStylePicker.tsx` 和 `lib/edgeStyles.ts`，TopBar 不再有箭头风格下拉
  - 沟通失误导致这个功能被留了下来 —— 原本只是 review，不该 ship
  - `buildEdges` 改回硬编码 classic 样式（var(--edge)、1.6 stroke、ArrowClosed、size 16、border-radius 10），无运行时差异
  - App 清理 `edgeStyleId` state / localStorage hook（旧的 `linear_board_view:edge_style:v1` key 会自然失效）

- v0.24.0 — Tab 键位调整 + 新卡片落位优化
  - `F` ↔ `Shift+F` 互换：`F` 现为全局整理（tidyAllRoots，常用），`Shift+F` 改成只整理 focused 子树（tidySubtree，少用）
  - Tab / Shift+Tab 插入新 card 后通过 `requestAnimationFrame` 自动跑全局 tidy，新卡片落到 mindmap 布局位置而非仅靠 parent-local 插入
  - `computeSiblingPos`：取 parent 所有 sibling 中最大 Y + `siblingDy` 作为新卡片 Y，保证 tidy 后排在所有兄弟下方（而非仅 focused 下方）
  - Toast 文案同步更新；`g`（编组/解组）保留不动

- v0.23.0 — Agent_tmp tab: board 内启动 / 监控 / 对话 OPUS team agent
  - 新 tab `Agent_tmp`：自动列 OPUS team open issue，每张卡换成 `AgentIssueCard`（▶ 启动 / 状态徽章 / comment thread / 输入框；输入含 `merge` 关键字自动归 `[user:merge]`，否则 `[user:reply]`）
  - PTY agent runtime：dev plugin 起 long-lived `claude --dangerously-skip-permissions`（OAuth, 非 `-p`）per session，跑在独立 worktree；bracketed-paste 喂初始 prompt + 500ms 间隔单发 Enter 提交
  - Poller 5s tick：拉 Linear comments，过滤 `[user:*]` 转 PTY；遇 `[agent:done]` graceful `/exit\r` + grace kill；bootstrap 把孤儿 session 标 error
  - Comment 协议：body 首行 `[<role>:<kind>] <summary>`（agent → status/question/waiting-merge/done；user → reply/queue/merge），`agentProtocol.ts` 提供 format/parse，无前缀的人写 comment 自动忽略
  - 新 API：`POST /api/issue/:id/comment`、`GET /api/agent/sessions`、`POST /api/agent/start`、`POST /api/agent/:id/stop`
  - 数据层：`IssueRecord` 扩 `comments[]`，`fetchIssues` / `updateIssue` 的 GraphQL + `toRecord` 同步带上
  - 修：Linear `orderBy: createdAt` 实际返回 DESC（代码当 ASC 导致 `lastCommentId` 取最老→后续 user 消息全卡住）→ `fetchIssueDetail` 强排序升序；fetch 抖动（ECONNRESET / ETIMEDOUT / ENOTFOUND / EAI_AGAIN）加 1 次重试
  - 工程：`vite.config.ts` `server.watch.ignored: ['**/worktrees/**']` 防 agent 在 worktree 内 build 触发主 board reload；新依赖 `node-pty`（注意 npm prebuild 可能丢 spawn-helper 可执行位，需 `chmod +x node_modules/node-pty/prebuilds/*/spawn-helper`）

- v0.22.0 — Edge 样式选择器
  - TopBar 左侧新增 Edge Style 下拉菜单，点击可预览并切换连接线样式
  - 8 种预设样式：Classic（默认）、Minimal、Bold、Elegant、Warm、Cool、Dashed、Dotted
  - 样式设置自动保存到 localStorage，刷新后恢复
  - 每种样式可定制：线条颜色、粗细、虚线、箭头类型/大小、圆角半径

- v0.21.2 — 修 day view week-of-year 算法（Sunday-based）
  - 旧算法以 Jan 1 为周边界，导致 2026 年周边界落在周四（5-13 是 week 19 而 5-14 是 week 20）
  - 新算法以周日为周边界：`floor((dayOfYear + jan1.getDay() - 1) / 7) + 1`
  - 迁移再跑一次，把已用新格式但 week 错的名字一并修正

- v0.21.1 — 迁移存量 day view 名称到 `WW.D` 新格式
  - 服务端 `readManifest` 读取 day manifest 时一次性识别老格式 `YYYY-MM-DD 周X` 并改写为 `YYYY-MM-DD WW.D`
  - 保留 collision 后缀 `(N)` 等尾部内容；不匹配老格式的名字保持不动
  - 迁移幂等；无任何 name 需要改时不刷盘（保留 mtime）；custom manifest 完全不动

- v0.21.0 — 新增 Custom view 类别 + Day view 命名/改名规则更新
  - **顶栏第三个 tab `Custom`**：与 Working On 并排，结构 mirror（split ▾ 按钮 + dropdown + create / pick / rename / delete + per-view IssuePicker），但 view 可任意命名；首次创建从 `Custom 1` 起步，被占就递增最小未用编号。
  - **Day view 命名格式改为 `YYYY-MM-DD WW.D`**：`WW = floor((dayOfYear-1)/7)+1`（Jan 1 落 week 1），`D = Date.getDay()`（周日=0），例如 2026-05-15（周四）→ `2026-05-15 20.4`。client `formatDefaultViewName` + server-side legacy migration 同步换实现。
  - **Day view 禁止 rename**：TopBar 的 Working On tab 不再有双击改名，dropdown 内 day kind 也屏蔽双击 → 编辑态，create 按钮文案改成 `+ 新建 day view`；custom kind 保留 rename + `+ 新建 custom view`。
  - **后端**：`/api/custom/views` (GET/PUT) + `/api/custom/views/:id` (GET/PUT/DELETE)，存储到 `public/data/custom/<id>.json` + `public/data/custom/views.json`；boardStore 把 manifest / view-board / delete 逻辑抽成 `*At(dir, …)` helper，day 保留 legacy `working_on.json` migration，custom 无 legacy 路径。
  - **前端**：`workingOnViews.ts` 抽出 `createViewsClient`，导出 `dayViewsClient` / `customViewsClient` + `nextCustomName`；`useWorkingOnViews` 拆成通用 `useViewsList`，导出 `useWorkingOnViews` + `useCustomViews`。App 加 `customBoard` state、`customDisplayed` / `customIds`、`addToCustom`、`handleCreateCustom` / `handlePickCustom` / `handleRenameActiveCustom`，以及对应 cardId 迁移 effect。

- v0.20.0 — Mindmap tidy 快捷键 + 干净 edge 路由
  - **F = 整理选中卡片所在 subtree**：focused card 本身钉住，仅其后代按 d3-hierarchy Reingold-Tilford 重排（左→右展开）。原 `findRoot` 爬到全局 root 的语义砍掉——深单 root 树里点叶子按 F 会拽动整画布的反直觉行为没了。没 focus 时 toast 提示 "请先选中一张卡片…" 然后 no-op。
  - **Shift+F = 整理全画布**：每个 root 各跑一次 tidySubtree，按当前 Y 排序后用累计 cursorY 把 bbox 顺序堆叠，相邻 root 间留 `rootGapY = 100` 的 gap，跨 root 不交叉。
  - **Tab 改成 dumb-insert**：原本 `computeChildPos` / `computeSiblingPos` 里的 `resolveOverlaps` 连锁推下逻辑全删——新 child 只放到 parent 最末 sibling 的 `+ siblingDy`，撞了就撞了，让用户用 F 收拾。Tab 也是单次 setData，整步 1 个 undo entry。
  - **Tidy 算法**：`tidySubtree` 用 d3-hierarchy `tree()` + 自定义 `separation((a,b) => (ha+hb)/2 + vSpacing)`（cousin 跨 parent 时再 ×1.25），多行高 NoteCard 不会压邻居。`nodeSize([1, hSpacing])` 让 separation 直接以像素为单位生效。emit 时把 d3 的中心坐标转成 xyflow 期望的 top-left（`flow.y = layout.x - h/2 + dy`）——之前没转所以高卡会向下溢出 `(h - defaultH) / 2` 撞下方兄弟。`DEFAULT_TIDY_CONFIG = { hSpacing: 420, vSpacing: 60, rootGapY: 100 }` 配 280×110 默认 NoteCard 留 ~140px 列间气口。
  - **Edge 路由换 shared stem**：`LabeledEdge.getEdgeParams` 原来按 dominant-axis flip，children 散开后部分 sibling 翻成 Bottom→Top 出 → 同 parent 多面出线乱成一团（image #7）。改成只要 target 在 source 右就强制 Right→Left；并给 `getSmoothStepPath` 传共享的 `centerX = source.right + STEM_OFFSET(64)`——同源所有 edge 第一段在同一 X 汇合形成视觉 stem（image #8）。`borderRadius` 从默认 5 调到 10。
  - **撤回**：tidy 一次 setData 一个 history entry，`u` 一步回滚整次重排（既有 `useBoardState` undo stack 不动）。tidy-animating CSS class 在 wrapper 上挂 ~480ms，反向也能滑回去。
  - **依赖**：新增 `d3-hierarchy@^3.1.2` + `@types/d3-hierarchy`。
  - 新增文件：`src/lib/mindmapLayout.ts`（pure layout helpers + tidy + findRoot/findAllRoots）。改动：CanvasBoard.tsx（hotkey + applyTidyMoves 写回 issueMembers/noteNodes）、LabeledEdge.tsx（边 routing）、ShortcutsDialog.tsx（F/⇧F + Tab 文案）、index.css（tidy-animating transition）。

- v0.19.0 — NoteCard 双向链接 `[[YYMMDDxx]]` + 右键扩展菜单
  - **cardId 字段**：`NoteNode` 加可选 `cardId`（格式 `YYMMDDxx`：6 位本地日期 + 2 位随机 a–z 字母，单日 676 槽位足够单用户用）；纯函数生成器 `lib/cardId.ts` 先随机采样后落到 26×26 穷举扫，单日满了才返回 null（fail-loud 不静默碰撞）；`server/boardStore.ts` validator 用同一正则强校验，乱写的 cardId 在持久层就被拒。
  - **首启动迁移**：App 在两块 board（active working_on view + all_issues_board）loaded 后扫一遍 noteNodes，缺 `cardId` 的用今天日期前缀生成、批内去重、写回 store；幂等——重复 load 自动短路；新建 / 粘贴的 note 也走同一 effect 自动补 ID（依赖数组监听 noteNodes 变化）。
  - **wiki 链接渲染**：NoteCard 的 token 解析合成单条 `[[YYMMDDxx]] | http(s)// | /Users…/` 联合正则一次扫，避免 span 重叠；命中 `[[id]]` 时通过 `resolveCardLink(cardId)→nodeId|null`（来自 CanvasBoard 的 `cardIdToNodeId` Map）渲染成 chip：固定 `WIKI_LINK_COLOR = #5b8def`（**不**跟主题 accent 走，全局 wiki 引用要全卡色一致），无下划线，hover 加 `${color}1f` ≈12% alpha 背景 tint，`padding: 0 2px / borderRadius: 3 / transition: 0.1s`；编辑态（textarea 内）保留原文方便编辑。
  - **broken / cross-board**：`var(--warm-red)` + `cursor: not-allowed` + 0.85 opacity + tooltip 解释，hover tint 用固定红色 fallback。当前实现只解析当前 board 内的 cardId，跨 view 显示为 broken（后续要扩可以把 lookup map 抬到 App 层）。
  - **跳转动画**：点 chip → CanvasBoard 的 `jumpToNode` 取 `reactFlow.getViewport().zoom` + 目标 node 的几何中心（`position + measured size / 2`），调 `setCenter(cx, cy, { zoom, duration: 400 })`——**保持当前 zoom 只 pan**；同步 `setFocusedCardId(nodeId)` 让 halo glow 落到目标卡，键盘 nav 接得上。
  - **右键扩展菜单**：`BoardContextMenu` 重写成 data-driven `items: MenuItem[]`（`{id, label, onSelect, tone?: 'default'|'danger', disabled?}`），暖纸 bg / hairline border / soft shadow / hover tint，danger 行 warm-red，Esc / 外点 / 二次右键（capture-phase contextmenu listener）都关；NoteCard 自己的 onContextMenu 拆掉只保留编辑态 stopPropagation 让 textarea 拿原生菜单（spellcheck/paste），右键转交 xyflow 的 `onNodeContextMenu` → CanvasBoard 按 target 类型构 items：note → `[Copy ID [[xxx]], Delete note]`、issue → `[Remove from board]`、edge → `[Delete connection]`，每行自闭包它的 callback，没有中央 dispatcher。
  - **Copy ID 行为**：点菜单项 → `navigator.clipboard.writeText(\`[[${cardId}]]\`)`（连方括号一起复制，下张卡 paste 即用）+ 绿色 toast「已复制 [[xxx]]」4s；clipboard 写失败回退红色 error toast。

- v0.18.0 — 背景色调淡为 warm-softer-1 + 颜色 token 全面语义化
  - **背景三层换色**：canvas / panel / card 由 `#f4ecdd` / `#ede2cc` / `#ede2cc` 调到 `#f7f6f1` / `#f1eee8` / `#fcfbf8`，本质是 warm-soft 基色 S×0.65、L+1.5pp（饱和度做主驱动，亮度只微调，避免三层压平成纯白）。整页"奶油黄"明显退一档但仍带暖意；前景文字 / accent / status / project 色不动，跟原 warm 系一致。
  - **颜色 token 语义化**：原本散落在 IssueCard / FilterBar / DetailPanel / NoteCard / Toast / CanvasBoard / projectColor.ts 里的硬编码 hex（priority / state / 12 色 project palette / edge / dashed selection / done frame / working indicator / toast 三色）全部抽进 `src/index.css` 的 `:root`，用 `--canvas` / `--panel` / `--card` / `--ink*` / `--prio-*` / `--status-*` / `--proj-1..12` / `--note-done` / `--note-working` / `--edge` / `--selection-dash` / `--toast-*` 命名约定。`projectColor()` 改返回 `var(--proj-N)`。
  - **hex+alpha 拼接 → color-mix**：原来的 `${color}1f` / `${color}40` / `${color}99` 在 `color` 变成 `var(--…)` 后失效，全部换成 `color-mix(in srgb, X N%, transparent)`（Chrome 111+ / Safari 16.4+ / Firefox 113+ 已稳）。selected glow 因此能跟卡片自身 frame 色（项目色或用户挑的 note 色）对齐。
  - **流程**：本次走的是 worktree 探索 PR——先给 6 个候选主题 + 临时 ThemeSwitcher 让用户在浏览器里挑，挑中 warm-soft 后再延伸 3 个"更淡"变体（softer-1/2/3），用户选 softer-1。最终化时 switcher / themes.ts / 其他 5 个候选主题块全部删除，单一主题直接合进 `:root`，backwards-compat alias（`--paper` / `--paper-soft` / `--paper-deep` / `--warm-red`）保留以免 churn 未触及组件。

- v0.17.1 — 修 Tab 新建子 note 把 parent 一起拖进多选
  - 起因：rebuild effect 为了保 box-select / g group 多选，会把上一次 nodes 里所有 `selected:true` flag 跨 data 写回保留下来。
  - Tab 之前 parent 是 focused+selected，rebuild 把 parent 保留 + `buildNodes` 又给 newId 按 `focusedCardId` 加 selected → 双选 → 浮出 NoteSelectionPalette 共享颜色 + 整组同移。
  - 修法：`insertCardWithLayout` 在 setData / setFocusedCardId / setEditingNoteId 之后挂一句 `setNodes(curr => curr.map(n => n.selected ? {...n, selected:false} : n))` 把旧 selected 全清掉，rebuild 落回 focusedCardId 单选分支。
  - 影响：点击 / 箭头切焦点的其他路径不动。

- v0.17.0 — 快捷键重新分配 + redo + connect 配对语义 + 启动默认最新 working_on view
  - **按键重排**：`c` 从 undo 改成 connect 模式切换（原 `x` 取消）；`u` 接 undo；`shift+u` 接新的 redo。CanvasBoard 全局 keydown 仍 metaKey/ctrlKey/altKey 早退避免和 ⌘C/⌘V 冲突，shift 在 fallthrough 放行所以 Shift+U 能进 redo 分支。
  - **redo**：`useBoardState` 加 `redoStack`。setData（任何用户动作）清空 redo 栈匹配标准编辑器语义；undo 把 `latestRef.current` 推 redoStack 再恢复栈顶；新增对称 `redo`——pop redoStack，把当前态推回 undoStack。endpoint 切换 / 重置时两个栈一起清。`UseBoardState` 接口加 `redo: () => boolean`，App 把 `allIssuesBoard.redo` / `workingOn.redo` 透传到 CanvasBoard。
  - **connect 配对语义**：进 source → 点 A → 进 target(source=A) → 点 B → 连 A→B 后回到 source 模式（不是 fan-out），下一对 C→D、F→E 一直按对连。空白 pane click 直接退连接（统一作"停止"手势）。原"linking 模式下空白点击自动建抱图 note"流程拿掉，配套删 `linkJustFinishedRef` 防抖 ref + onWrapperDoubleClick 里的 400ms 抑制。
  - **默认视图**：App 默认 `activeView` 从 `"all"` 改 `"working_on"`；`useWorkingOnViews` 加载 manifest 时按 `createdAt.localeCompare` 倒序挑最新作为本次会话 activeId（不写回磁盘，setActiveId 的会话内切换仍 persist），匹配"每天建一个 view、启动默认到今天"的工作流。
  - **快捷键弹窗**：ShortcutsDialog 拿掉 X 条目，加 C（pair connect）/ U / ⇧U 三条。

- v0.16.0 — NoteCard 支持粘贴剪贴板图片 + 文本图片可交替
  - **粘贴**：window `paste` 监听抓 `clipboardData.items` 里第一个 `image/*`，读成 data URL 后用 `Image` 探一次自然尺寸，按 `min(natural, 248)` 等比缩成初始显示尺寸（248 = 卡 280 − 外层 padding 8 − 内层 padding 24，即内容区宽）。
  - 目标决策：(1) 正在编辑的 note → 加进它；(2) 没编辑但单选了某张 note → 加进它；(3) 空白处粘 → viewport 中心新建一张抱图 note 并 setFocusedCardId。
  - **数据模型**：从「单 body + 图片永远末尾」改成 `textSegments: string[]`（长度始终 = `images.length + 1`，`textSegments[i]` 在 `images[i]` 之前，最后一段是末尾文本）让图片上下都能有文字。`body` 保留为 `textSegments.join('\n')` 给 filter / 链接 label 等老消费者用。粘到现有 note 自动追加空 segment（图片下方多一个空 textarea 可输入），空白粘新建用 `textSegments: ['', '']` 保证上下都能写。删图把前后 segment 合并回一个保持长度一致。
  - 服务端 validator 接 `textSegments` 时强校验数组长度 = `images.length + 1`，否则丢弃；客户端 `deriveSegments` 兜底从旧数据 `[body, '', '', ...]` 迁移。
  - **编辑态合并**：从「`<input>` 标题 + `<textarea>` 正文」两段式合并成「每段一个 `<textarea>`」单一文本流，blur 检查覆盖所有 textareas，Esc/⌘Enter 行为不变。展示态 segments[0] 第一行加粗（14px / 600 / `--ink`），其余 12px `--ink-soft`——本质一段内容，仅显示有 emphasis。`data-note-textarea` 挂在 segment 0 上保留外部 `focusNoteTextarea` 入口。
  - **布局**：卡片永远固定 280 宽，统一布局（不为图片单独走 image-fill 收紧）：内层 paper 永远 `padding: 10px 12px`，NOTE 头永远在 flow 里，图片渲染为正常 block。图片显示宽度通过 `maxW` 在 `NoteImageView` 里 render-time 等比 clamp 到 248，超出的存储宽度只是被压缩显示不会撑卡。`buildNodes` / `commitNote` / `decoratedNodes` patch type 全部加 `textSegments?: string[]`。
  - **图片缩放**：选中卡片浮出 4 个 10px 角 handle（`var(--paper)` 底 + 1.5px accent 描边 + nwse/nesw cursor）+ 右上角 ×（`nodrag nopan` + `onPointerDown stopPropagation`，老的 `onMouseDown` 在 ReactFlow pointer-event 体系里挡不住所以换 pointer）。pointerdown 设 capture，pointermove 算 dx/dy（TL/BL 翻 dx 符号、TL/TR 翻 dy）→ clamp 横向到 `maxW`、纵向到 1200；shift 锁原始 aspect，按 dx/dy 绝对值大的轴决定主轴另一轴按 aspect 推导（也走 `maxW` 重新 clamp）；release 才一次 `onCommit({ images })` 落盘。
  - **图片属于卡内容**：NoteImageView 外层 wrapper 不再 `nodrag nopan`，`<img>` 撤掉 `pointerEvents:'none'`，ReactFlow 从图片上的 pointerdown 接得到能直接拖整张卡；resize handles / × 按钮通过自己的 stopPropagation 隔离不受影响。

- v0.15.1 — Working on 复选框视觉换装
  - v0.15.0 的"蓝填 + 居中白条"换成"蓝描边空框 + 强内辉"——1.5px `WORKING_COLOR` 描边 + `inset 0 0 6px 2px ${WORKING_COLOR}99` 内辉，整体读起来像"空盒在向内发蓝光"，比之前的实心填充更克制、更像 todo 而非 done。
  - 配套挑选阶段在 CanvasBoard 临时挂了一个 4 变体（A 微辉 / B 强辉 / C 微辉+中心点 / D 微辉脉冲呼吸）的顶部预览条对比选型，选定 B 后预览条 + 变体抽象 + `working-pulse` keyframe 一并删除，最终代码只保留 B 的内联样式。

- v0.15.0 — Note 加 working on 三态 + 调色板单选/多选都浮到选区右上角
  - **三态 todo**：checkbox 从 todo / done 两态扩成 todo → working on → done 三态循环。
  - 新增 `WORKING_COLOR = #3b6fb8`（暖纸面板上读起来明确"在做"且不撞 NOTE_COLORS 里的 slate blue 选项），working 态显示填充蓝底 + 居中 7×2 白色横条（Things 3 in-progress 语义）；working 不让卡片变灰（保留用户选的 frame 色），只有 done 才把 frame 退成 `DONE_FRAME_COLOR` + 文字 muted/strikethrough。
  - `NoteNode` / clipboard `ClipboardItemNote` / 服务端 `validate` 加 optional `working` 字段，buildNodes/复制粘贴都带上。
  - **调色板上浮**：删 NoteCard 内嵌调色板，单选与多选行为统一。board 级 `NoteSelectionPalette` 阈值从 ≥2 放宽到 ≥1，根据所有选中 note 算 bbox 右上角并固定屏幕坐标定位；active 色仅在选区颜色完全一致时高亮，混合选区不显示 active。`decoratedNodes` 不再注入 `multiSelected`（连同 NoteData.multiSelected 一并删），逻辑全部收敛到浮层。

- v0.14.0 — NoteCard 编辑态所见即所得 + 多选共享调色板
  - **编辑态 WYSIWYG**：把单一 textarea 拆成 `<input>` 标题（14px / 600）+ `<textarea>` 正文（12px / `--ink-soft`），样式与展示态 1:1 对齐，不再"展开变大"。正文 `resize:none` + `overflow:hidden`，监听 rest 用 scrollHeight 自适应，卡片随内容自然撑高，无滚动条。
  - `data-note-textarea` 动态绑定到当前应被聚焦的字段（rest 非空挂 textarea，否则挂 title input），`focusNoteTextarea` 选择器从 `textarea[...]` 放宽到 `[...]`。blur 走 RAF 检查 activeElement，title↔body 切换不触发误提交；title 内 Enter 跳正文起始，⌘/Ctrl+Enter 仍 commit。
  - **调色板挪位**：从独立一行挪到 NOTE 同行右侧；14×14 圆角矩形；条件 `editing || (selected && !multiSelected)`——单卡选中/编辑显示，多选让位给共享浮层。
  - **多选共享浮层**：选中 ≥2 张 note 时显示 board 级 `MultiNoteSelectionPalette`，渲染在 `<ReactFlow>` 子层，用 `useStore` 订阅 `transform`+`nodes` 算选区 bbox 右上角，按 `screen = flow·zoom + tx/ty` 屏幕坐标定位（恒定像素尺寸，不随缩放变化）。点击颜色走 `commitNotesColor(ids, c)` 一次 setData 把所有选中 note 同步换色。
  - `decoratedNodes` 在选中 note 总数 ≥2 时把 `multiSelected:true` 注入各张选中卡 data；浮层挂 `nodrag nopan` + `stopPropagation` 防止点击冒泡触发 pane click 清空选择。

- v0.13.2 — 修 group 两个细节
  - **解散后下一拖仍整组同移**：`g` 解散只清了 `data.groups`，xyflow 自家 multi-drag 按它内部那份 `selected=true` 快照工作（不看 `data.groups`），点别处才被它接到的下一帧 select-change 清掉。改成解散时把成员 `selected: false` 同步推进 `nodes` state，React 18 在 key handler 回返时 flush，xyflow store 下一帧 sync 就和 data 一致。
  - **整个 group 区域可拖动**（边框 + 卡片之间的空白都能拖）：把 dashed frame 从 `pointer-events: none` 装饰改成 `pointer-events: auto` + `zIndex: -1`，cards 仍在 z=0 之上抢 click，frame 只在"无 card 覆盖的像素"接到事件。frame 自己挂 `onPointerDown`（stopPropagation 防 ReactFlow 把它当 pane 框选）→ 用 window 级 `pointermove/pointerup` 直接平移成员，绕开 xyflow drag 系统，避免和 v0.13.1 的 position-cohesion 重复派发。起始坐标读 `data`（不读 `nodes`），让 All Issues 视图被过滤掉的成员也跟着平移；释放后一次性写回 `issueMembers`/`noteNodes`。

- v0.13.1 — 修 v0.13.0 成组后拖动"时好时坏"
  - 根因：xyflow 在 `pointerdown` 那一帧从其内部 store 快照"该跟拖的 node 集合"，而我们用 `onNodesChange` 级联出的 `selected=true` 要走 React state → 下次 render → xyflow store sync，赶不上当帧 drag-start。
  - 改成把 group 的移动同步从"select 级联间接驱动"换成"position-change 级联直接驱动"：把整段级联挪进 `setNodes(current => ...)` 闭包内，组内任一成员一旦有 `position` change，按 primary 的 dx/dy 给其余可见成员合成同步 position change（dragging 标志一并复制，drag-end 也同步派发以触发 settle 落盘）。
  - selection 级联同时保留，仅用于 halo / box-select 的视觉一致。`positionChangeIds` 去重避免和 xyflow 自身已识别的 multi-drag 重叠发事件。

- v0.13.0 — Card 分组（移动作用域）
  - 多选 ≥2 张 card 按 `g` 成组，再次精确选中整组按 `g` 解散。group 渲染为 1.5px 暖 sage 虚线圆角框 + 极淡 sage 底（zIndex 1，在 cards 后、Background 前）紧贴成员包围盒，跟随 drag 实时刷新。
  - group 仅约束移动：点击任一成员经 `onNodesChange` 的 select 级联把整组 `selected=true`，xyflow 内置 multi-drag 自动整组同移；其他行为（DetailPanel、edit、edge、Tab 子 note）保持独立。
  - snap 对齐在 `liveDragCount > 1` 时跳过以保持成员相对偏移刚性；删 / 右键删 / 成员被裁后 `memberIds < 2` 的 group 自动剔除。每张 card 最多 1 组，新组形成时把成员从旧组扯出。
  - `BoardData.groups: GroupBox[]` 落到服务端 JSON（`boardStore` validate 同步），useWorkingOnViews 新建空 view 时初始化 `groups: []`；nodes rebuild effect 学 edges 一样把旧 selected 集合贴回，避免 g/拖动/edit 中途 data 写回吞掉多选。ShortcutsDialog 加 G 条目。

- v0.12.1 — 修 Tab / Shift+Tab 新建的 note 不进入 edit 状态、Space 把 note 切到 edit 时光标随机不进 textarea
  - `focusNewNote` 这个 rAF + 30ms + 100ms 三段重试的强抢焦点 helper 之前只接到双击空白建 note 和 linking-mode 建 note 两条路径，Tab / Shift+Tab 的 `insertCardWithLayout` 和 Space → 进 edit 的 hotkey 分支只靠 NoteCard 内部那个会被 ReactFlow pane focus 抢走的 rAF。
  - 把 helper 提名为 `focusNoteTextarea` 并上移到 `insertCardWithLayout` 之前，让 Tab 创建后和 Space 切 edit 后都调一次，赢下和 ReactFlow / StrictMode 的焦点竞速。

- v0.12.0 — NoteCard 加 done 状态
  - 右上角 LOCAL 文字换成 Things 3 风格 todo 框：15×15 圆角方形 + 1px hairline + inset 阴影"压进纸面"，勾选后整框填充为静音灰、内置 2.2px 粗细 / -6° 倾斜的对角 check。
  - done=true 时整张 note 框退成静音灰、内 paper 加深、标题与正文 strikethrough + 字色 muted。
  - `NoteNode` / `BoardData.noteNodes` 加 optional `done`，`commitNote` patch 扩展，clipboard `ClipboardItemNote` 也带上 done 让 ⌘C/⌘V 跨 view 保留状态；server `validate` 落盘 done 字段。

- v0.11.0 — Working On 多 view 第一波打磨
  - 顶栏 Working On tab 双击当前 view 名进入 inline 改名（Enter 提交 / Esc 取消 / blur 也提交）。
  - ▾ 下拉里 views 按 createdAt 倒序，新建的在最上面。
  - 切 view 自动 `fitView({padding:0.2, duration:0})`，瞬间跳到包含 cards 的视野，不再停在空白区。
  - `findNextSlotNear(center, taken)` 新增：picker 加 issue 时从当前 viewport 中心向外螺旋搜空位，新 card 落在视野内。CanvasBoard 改 `forwardRef` 暴露 `getViewportCenter`。
  - 修 setActiveId 在 React useState updater 里 fire-and-forget 的 StrictMode 反模式（updater 内副作用会被 double-invoke）。
  - 服务端 `PUT /views` 加 console.error，client `saveManifest` 把 server error body 提取到 toast 文案。

- v0.10.0 — Working On 升级成多 view 集合
  - 顶栏 Working On tab 加 ▾ 下拉，可新建（默认名 `YYYY-MM-DD 周X`）、双击重命名、删除（至少保留 1 个）。同一 issue 可同时在多 view，位置各自独立。
  - 服务端从单文件 `working_on.json` 改成 `working_on/<viewId>.json` + `views.json` manifest，启动时自动迁移旧文件。
  - 新增 ⌘C / ⌘V 跨 view 复制粘贴（圈选 cards + notes + 它们的 edges 一起搬，落到目标 view 视口中央，issue id 共享、note id 重生成，重复 issue 自动跳过并 toast 提示）。

- v0.9.1 — 修 v0.9.0 两个 board 共用 CanvasBoard 后的两条交互回归
  - **edge 删除回归**：edges 从 `useMemo` 改成 `useState` + `onEdgesChange`（applyEdgeChanges），让 xyflow 内部能挂 `selected` 标记，点边后按 Delete/Backspace 才能触发 `onEdgesDelete`。`deleteKeyCode={["Backspace","Delete"]}` 显式两个键都收。
  - **C 键 undo 兜底**：增 `evt.code === "KeyC"` + console.log，方便排查布局/IME 时回放路径。
  - data → 本地 edges 同步时保留旧的 selected id 集合，重建后回贴。

- v0.9.0 — 两个 board (All Issues / Working On) 操作逻辑统一
  - 抽出共享组件 `CanvasBoard`（继承原 WorkingOnBoard 的全部连线 / 链接模式 / 框选 / 吸附 / note / 右键 / undo / Delete 行为），通过 `displayedIssues` + `initialPositions` 两个 prop 适配两种 view。
  - All Issues 现在也能 drag handle / X 模式连线、双击空白建 note、按 Delete 删边——边/note 纯本地视觉，不再写回 Linear parent。
  - 新增 `/api/all-issues-board` 端点 + `public/data/all_issues_board.json` 持久化；server 端 `boardStore.ts` 用 `STORE_PATHS` 表统一两个 store；client 端 `useBoardState(endpoint)` 工厂统一两个 hook。
  - 删除 `Board.tsx` / `persistence.ts` / `useWorkingOnState.ts` / `workingOnStore.ts`，把 v0.8.0 的 IssuePatch.parentId 写回路径回滚（连线不再是 Linear 父子关系）。

- v0.8.0 — All Issues 视图 edge 可点击选中（暖红高亮）后按 Delete / Backspace 清除父子链接
  - edge click → 本地 selectedEdge state，按键路由到 `mutate(childId, { parentId: null })`。
  - IssuePatch 新增 `parentId` 字段并写回 Linear `issueUpdate`；optimistic 同步把 child.parentId 置 null、并剥掉前任 parent 的 `childrenIds`，失败时一并回滚。

- v0.7.0 — NoteCard 改 Apple HIG 同心圆角
  - 外层 div 作色框（padding 2 2 2 6）+ radius 10，内层 paper-soft div radius `4 8 8 4`（outer−offset）。
  - 左竖条沿角部以恒定 6px 宽度收口，去掉旧设计在角内出现的硬切边。

- v0.6.0 — Note body 内 URL / 绝对文件路径自动识别为链接
  - 匹配 http(s) URL 和 Mac/Linux 常见 root 的绝对路径，点击直通：http(s) 走 `target=_blank`，本地路径 POST /api/open 让 OS opener（`open` / `xdg-open` / `start`）启动。
  - nodrag/nopan + stopPropagation 隔离 xyflow drag 与 note dblclick 编辑。

- v0.5.0 — Note 调色板 + Cmd/Ctrl+Enter + ☰ 菜单 + 全局快捷键 + edge 重路由 / 吸附
  - Note 调色板：8 莫兰迪色，默认 sage。
  - Cmd/Ctrl+Enter 提交 note 编辑。
  - 顶栏 ☰ 菜单：Refresh / Shortcuts dialog。
  - 全局快捷键 X（链接模式：点 source→target 或→空白即创建并连 note）/ C（50 步 undo）/ Esc 取消。
  - edge 双击中点编辑 label；floating edge 跟随节点拖动重路由；主轴吸附最少转弯；吸附对齐辅助线（edge 对齐 + 相等 gap 两轴各一条暖红 1px 指示）。
  - 边色调改 #7a7060 暖灰褐；selectionOnDrag / partial select 共享到 All Issues。

- v0.4.0 — All Issues 视图按 team › project 自动分组
  - teams 横向相邻，project 一行 max 3 列 wrap，无 header label。
  - 共享 board 行为（`lib/boardProps.ts`）让框选 / partial-overlap / pan-on-scroll 在所有 view 一致。
  - IssuePicker popover 按 team › project sticky 分组。

- v0.3.0 — Working On 视图
  - 顶栏 view 切换器 + Add-issue popover 点击加入（6 列网格平铺）。
  - 自建 note 节点：双击空白创建、单输入框、首行作标题。
  - 四向 handle + 任意方向 loose 连接 + 加粗暖红箭头 + edge 中点可编辑 label。
  - 框选（touch-to-select）；服务端 `working_on.json` 持久化（GET/PUT /api/working-on，200ms debounce）。

- v0.2.0 — Linear Board v1
  - Vite/React/@xyflow 自由画布 + 顶栏 Refresh + 过滤搜索 + 项目色 + 父子连线 + 详情面板 + 8 字段写回 Linear。

- v0.0.1 — 初始化仓库与 README
