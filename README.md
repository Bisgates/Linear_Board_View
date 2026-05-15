# Linear Board View

> 单用户、本地跑的 Linear issue 自由摆位画布。把一个 Linear workspace 的 open issues 平铺在一张可缩放、可平移的暖色画布上，拖动只改空间位置（不改 Linear 数据），字段编辑走卡片上的 inline 控件并写回 Linear。除 Linear issue 卡之外，也支持纯 note 卡作为思维笔记 / TODO，note 之间和 note↔issue 之间可手动连线，整张 board 是一棵自由生长的 mindmap。

![Linear Board View — 主画面](docs/screenshot.png)

设计取向：**一眼看清全局 + 流畅愉悦的编辑**，而非 Linear 原生的列表+表格。详细范围与非目标见 [`PROJECT_STATEMENT.md`](./PROJECT_STATEMENT.md)。

---

## 快速开始

```bash
# 1. 依赖
npm install

# 2. .env 里放 Linear API key
echo 'LINEAR_API_KEY=lin_api_xxx' >> .env

# 3. 首次拉一份 issue 快照（写到 public/data/issues.json）
npm run fetch

# 4. 起 dev server
npm run dev
# 默认在 http://localhost:5173
```

没有 `LINEAR_API_KEY` 也能跑——UI 会读现有的 `public/data/issues.json` 静态快照；但 `/api/refetch`（顶栏的 Refetch 按钮）和 inline 编辑写回 Linear 会 500。

---

## 主要交互

### Issue 卡（来自 Linear）

- **拖动**：改 canvas 上的位置（持久化在浏览器 `localStorage`，跨设备不同步）。
- **点击**：右侧弹 DetailPanel，可以 inline 改 title / description / status / priority / assignee / labels / project / cycle，编辑乐观提交，失败回滚并出 toast。
- **过滤器**：顶栏可按 status / priority / assignee / project / cycle / label 临时隐藏。

### Note 卡（本地）

- 双击空白画布建一张 note；第一行视觉上加粗当作标题，下面是正文，本质是同一段文本（一个 textarea）。
- 三态 todo 复选框：未做 → working on（蓝描边内辉光）→ done（划线 + 灰）。
- 选中卡片右上浮出 8 色调色板换 frame 色。
- **粘贴图片**：剪贴板里有图直接 `⌘V`：选中某张 note 时贴进它，否则在视口中心新建一张抱图 note。图片可拖四角缩放，shift 锁比例；× 删图。一张 note 内文本和图片可交替（图片上下都能再写文字）。
- **Tab / Shift+Tab**：在选中卡片基础上一键生成子 / 兄弟 note，自动连线 + 摆位。

### 连线（mindmap edges）

- 按 `c` 进 connect 模式 → 两两配对点卡片连线（a→b, c→d, …），点空白退出。线本身是本地的视觉关系，不写回 Linear。
- 双击 edge 改 label。

### 工作流视图（Working On Views）

- 顶栏切「All Issues」和「Working On」。Working On 是若干独立 board，每张 board 有自己的成员集合 + 位置 + 笔记 + 边——比如「2026-05-15 周四」一张，「Q2 launch」一张。
- 默认启动开**最新创建的 Working On view**（适合"每天建一张"的工作流）。
- 同一份剪贴板 buffer 跨 view，`⌘C` / `⌘V` 整组复制粘贴卡 + 内部 edges。

### Group（移动作用域）

- 选 ≥2 张卡按 `g` 成组：整组同移，但 edit / panel / edge 各自独立；对整组再按 `g` 解散。

---

## 快捷键

| 键 | 作用 |
| --- | --- |
| `c` | 进入连线模式；点 a → 点 b 连 a→b；继续点 c → d、e → f……空白处点击 / Esc / 再按 c 退出 |
| `u` | undo |
| `⇧u` | redo |
| `g` | 多选成组 / 整组解散 |
| `x` | 已废弃（旧的连线键，现合并到 `c`） |
| `Tab` | 在选中卡基础上生成子 note |
| `⇧Tab` | 生成兄弟 note |
| `Space` | note → 进入编辑；issue → 打开 DetailPanel |
| `Esc` | 退连线模式 / 退 note 编辑 |
| `⌘C` / `⌘V` | 复制 / 粘贴选中卡片 + 它们之间的 edges |
| `↑↓←→` | 在卡片之间空间最近邻跳焦点 |
| `Delete` / `Backspace` | 删选中的卡 / edge |
| `?` | 弹快捷键速查表 |

---

## 架构速览

详细见 [`CLAUDE.md`](./CLAUDE.md)。一句话总结：

- **客户端权威**：`public/data/issues.json` 是 Linear issue 的快照，浏览器直接读；位置走 `localStorage`；working_on view 状态走 `public/data/working_on/<view-id>.json`。
- **Dev-time 服务**：`src/server/linearApiPlugin.ts` 是 Vite plugin，挂 `/api/refetch`（拉快照）、`/api/issue/:id` PATCH（写回 Linear）、`/api/working-on/views*`（view 元数据 + 单 view 状态）。
- **画布**：`@xyflow/react`。每张 issue 是一个 `type: "issue"` node，note 是 `type: "note"`，edges 来自 Linear 的 parent / child 关系或用户手动连线。
- **乐观编辑**：`App.mutate(id, patch)` 是 issue 字段写回的唯一路径——本地立刻应用、`PATCH /api/issue/:id`、收到响应后用服务端权威记录替换；失败回滚到 `prevIssue` 并 toast。

---

## 文件结构（核心）

```
src/
├── App.tsx                     # 顶层 state，issue 数据 + 视图切换
├── components/
│   ├── CanvasBoard.tsx         # ReactFlow 包装 + 全局键位 + 选区 / 连线 / 组 / 复制粘贴
│   ├── IssueCard.tsx           # Linear issue 卡片
│   ├── NoteCard.tsx            # 本地 note 卡片 + 图片渲染缩放
│   ├── DetailPanel.tsx         # 右侧 inline 编辑面板
│   ├── FilterBar.tsx           # 顶栏过滤
│   └── ShortcutsDialog.tsx     # ? 键速查表
├── lib/
│   ├── useBoardState.ts        # board 数据持久化 + undo / redo
│   ├── useWorkingOnViews.ts    # working_on 多 view 管理（启动挑最新）
│   ├── workingOn.ts            # NoteNode / NoteImage / GroupBox 数据形
│   ├── filter.ts               # 顶栏过滤逻辑
│   ├── mindmapLayout.ts        # Tab/Shift+Tab 子/兄弟摆位算法
│   └── synthetic.ts            # ?perf=1 时把 issue 复刻到 200 张用于性能基线
├── linear/
│   ├── fetchIssues.ts          # Linear GraphQL → IssueRecord
│   └── updateIssue.ts          # IssuePatch → Linear GraphQL
└── server/
    ├── linearApiPlugin.ts      # Vite plugin 注入的 dev-time middleware
    └── boardStore.ts           # working_on view + manifest 的服务端读写
```

---

## 版本

[Pride versioning](./CLAUDE.md#pride-versioning)：`x.y.z` 中 `x = proud`、`y = 新功能`、`z = shame`。每个版本一行简介在 [`VERSION_LOG.md`](./VERSION_LOG.md)。

## License

私有项目，无 license。
