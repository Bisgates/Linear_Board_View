# Version Log

格式：`vX.Y.Z — <一句话功能介绍>`，时间倒序。规则见 `CLAUDE.md` → Pride Versioning。

- v0.4.0 — All Issues 视图按 team › project 自动分组（teams 横向相邻，project 一行 max 3 列 wrap，无 header label）+ 共享 board 行为 (`lib/boardProps.ts`) 让框选 / partial-overlap / pan-on-scroll 在所有 view 一致 + IssuePicker popover 按 team › project sticky 分组
- v0.3.0 — Working On 视图：顶栏 view 切换器 + Add-issue popover 点击加入（6 列网格平铺）+ 自建 note 节点（双击空白创建、单输入框、首行作标题）+ 四向 handle + 任意方向 loose 连接 + 加粗暖红箭头 + edge 中点可编辑 label + 框选（touch-to-select）+ 服务端 `working_on.json` 持久化（GET/PUT /api/working-on，200ms debounce）
- v0.2.0 — Linear Board v1：Vite/React/@xyflow 自由画布 + 顶栏 Refresh + 过滤搜索 + 项目色 + 父子连线 + 详情面板 + 8 字段写回 Linear
- v0.0.1 — 初始化仓库与 README
