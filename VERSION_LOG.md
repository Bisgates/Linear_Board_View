# Version Log

格式：`vX.Y.Z — <一句话功能介绍>`，时间倒序。规则见 `CLAUDE.md` → Pride Versioning。

- v0.6.0 — Note body 内 URL / 绝对文件路径 (Mac/Linux 常见 root) 自动识别为链接，点击直通：http(s) 走 `target=_blank`，本地路径 POST /api/open 让 OS opener (`open` / `xdg-open` / `start`) 启动；nodrag/nopan + stopPropagation 隔离 xyflow drag 与 note dblclick 编辑。
- v0.5.0 — Note 调色板 (8 莫兰迪色，默认 sage) + Cmd/Ctrl+Enter 提交 note 编辑 + 顶栏 ☰ 菜单 (Refresh / Shortcuts dialog) + 全局快捷键 X (链接模式, 点 source→target 或→空白即创建并连 note) / C (50 步 undo) / Esc 取消 + edge 双击中点编辑 label + floating edge 跟随节点拖动重路由 + edge 主轴吸附最少转弯 + 吸附对齐辅助线 (edge 对齐 + 相等 gap 两轴各一条暖红 1px 指示) + 边色调改 #7a7060 暖灰褐 + selectionOnDrag/partial select 共享到 All Issues
- v0.4.0 — All Issues 视图按 team › project 自动分组（teams 横向相邻，project 一行 max 3 列 wrap，无 header label）+ 共享 board 行为 (`lib/boardProps.ts`) 让框选 / partial-overlap / pan-on-scroll 在所有 view 一致 + IssuePicker popover 按 team › project sticky 分组
- v0.3.0 — Working On 视图：顶栏 view 切换器 + Add-issue popover 点击加入（6 列网格平铺）+ 自建 note 节点（双击空白创建、单输入框、首行作标题）+ 四向 handle + 任意方向 loose 连接 + 加粗暖红箭头 + edge 中点可编辑 label + 框选（touch-to-select）+ 服务端 `working_on.json` 持久化（GET/PUT /api/working-on，200ms debounce）
- v0.2.0 — Linear Board v1：Vite/React/@xyflow 自由画布 + 顶栏 Refresh + 过滤搜索 + 项目色 + 父子连线 + 详情面板 + 8 字段写回 Linear
- v0.0.1 — 初始化仓库与 README
