# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Single-user web app that pulls open issues from one Linear workspace onto a freeform pan/zoom canvas (`@xyflow/react`). Drag changes spatial position only; field edits go through inline controls in the detail panel and are written back via Linear's GraphQL API. Authoritative scope/non-goals: `PROJECT_STATEMENT.md`.

## Commands

- `npm run dev` — start Vite dev server. Vite plugin `linearApiPlugin` mounts `/api/refetch` (GET) and `/api/issue/:id` (PATCH) middleware that talks to Linear using `LINEAR_API_KEY` from `.env`. Without that key, `/api/*` returns 500 but the static UI still loads from the existing snapshot.
- `npm run build` — `tsc -b` (project references) then `vite build`. Both `tsconfig.app.json` and `tsconfig.node.json` must typecheck.
- `npm run preview` — serve the production build. Note: no API middleware here, so mutations and refresh won't work in preview.
- `npm run fetch` — standalone `tsx scripts/fetchSnapshot.ts`; same Linear pull as `/api/refetch`, writes to `public/data/issues.json`. Run this once before `dev` if the snapshot doesn't exist yet (the browser fetches `/data/issues.json` on load and will error otherwise).
- `npm run tauri:dev` — Tauri 窗口 + vite (`vite.tauri.config.ts`) + Rust 后端。**不挂** `linearApiPlugin`，靠 `src/lib/tauriBridge.ts` 把 `/api/*` 路由到 Tauri commands。agent 功能在此 runtime 下线（占位）。
- `npm run tauri:build` — 产 `.app` 到 `src-tauri/target/release/bundle/macos/Linear Board.app`。
- `npm run release` — prod release：跑 `tauri:build` 然后把 .app 装到 `~/Applications/Linear Board.app`（旧的 mv 成 `*.bak-YYYYMMDD-HHMMSS` 备份）。日常 ship 走这条，不要直接 `tauri:build` 后手动 cp。
- `npm run release:dev <suffix> [-- --reset-data]` — worktree dev release：partial-override conf 把 productName / identifier 改成 `Linear Board <suffix>` / `com.han.linearboard.dev.<slug>`，产物留在 `src-tauri/target/release/bundle/macos/` 不进 `~/Applications/`，data dir 独立 (`~/Library/Application Support/com.han.linearboard.dev.<slug>/data/`) 且默认保留改动；细节见 [`docs/development_modes.md`](docs/development_modes.md) 的 "Release flow" 段。
- No test runner, linter, or formatter is configured. Don't invent commands.

## Runtime Targets (临时 dual-stack)

> 2026-05-16 起项目同时跑两个 runtime — 浏览器 (`npm run dev`) 和 macOS Tauri 壳 (`tauri:dev` / `.app`)。详见 [`docs/development_modes.md`](docs/development_modes.md)。

**当前姿势**：浏览器是主开发环境（hot reload + Chrome devtools），Tauri 是 packaging + 日常使用目标。`npm run dev` 必须始终保留完整功能 —— 任何 Tauri 化改动都不能破坏浏览器开发流。

**三处同步约定**（dual-stack 的税）：每加一个 `/api/*` endpoint，下面三处都要写：
1. `src/server/linearApiPlugin.ts` — Node 端 route handler，给浏览器
2. `src-tauri/src/lib.rs` — `#[tauri::command]` + 注册到 `invoke_handler`，给 Tauri
3. `src/lib/tauriBridge.ts` 的 `dispatch()` — path 匹配 + `invoke()` 调 Rust command，给前端透明路由

**最易漏**：Rust 端。每写完一个新 endpoint 自检三处都有。

**数据路径差异**：浏览器读写 `public/data/`，Tauri 读写 `~/Library/Application Support/com.han.linearboard/data/`。两份数据不自动同步。

**何时退役 dual-stack**：Linear API + agent (`node-pty`) 都迁完 Rust 后，`linearApiPlugin.ts` 整个删掉。当前迁移进度：
- ✅ `boardStore` 已 Rust
- 🚧 Linear API (arc `260516c_migrate_linear_to_rust` 进行中) — 直接动因是 `@linear/sdk` 在 webview 跑不起来（Node 模块被 externalise）
- 📋 Agent (`node-pty` / `agentPoller`) — spike `260516b_spike_rust_pty` 已 de-risk，待起 arc

## Architecture

### Snapshot is the source of truth on the client
- Server writes `public/data/issues.json` (an entire `SnapshotFile`: `issues`, `pages`, `elapsedMs`, `fetchedAt`, plus `meta.workflowStates`). The browser fetches this file directly — no streaming, no incremental sync.
- `fetchAllIssues` filters to open state types only (`backlog | unstarted | started`); "Done"/"Cancelled" issues never enter the snapshot. `fetchAllWorkflowStates` is fetched separately and stored under `meta.workflowStates` so the state-picker can offer states (e.g. "Done") whose issues aren't in the snapshot.
- `src/App.tsx` holds the single `snapshot` state. `IssueRecord` (`src/linear/types.ts`) is the canonical shape; `fetchIssues.ts` and `updateIssue.ts` both transform raw Linear GraphQL into this exact shape via `toRecord`-style mappers — keep them in sync or optimistic UI breaks.

### Optimistic mutation + rollback
- `App.mutate(id, patch)` (`src/App.tsx`) is the one path for field writes. It (1) builds an optimistic `IssueRecord` by looking up referenced entities (states, projects, cycles, assignees, labels) from the in-memory snapshot, augmenting `states` with `meta.workflowStates` for cross-snapshot picks; (2) applies it locally; (3) `PATCH /api/issue/:id`; (4) replaces with the server's authoritative record, or rolls back to `prevIssue` on failure and surfaces a toast.
- `IssuePatch` (`src/linear/updateIssue.ts`) is the wire format. To add a new editable field, extend `IssuePatch`, the lookup block in `mutate`, the GraphQL mutation input, and `toRecord`.

### Canvas, positions, layout
- `Board.tsx` wraps `ReactFlow` and treats every issue as a `type: "issue"` node rendered by `IssueCard`. Edges are derived purely from `parentId`/`childrenIds` within the filtered set.
- Initial layout: deterministic 6-col grid with seeded per-issue jitter (`src/lib/layout.ts`).
- Persistence: `localStorage` key `linear_board_view:positions:v1` (`src/lib/persistence.ts`). Hydration order on every issue-list change: compute grid → load stored → prune orphans (ids no longer in the snapshot) → `{ ...initial, ...stored }`. Saves are debounced 200ms after drag settles. There is no server-side position store.
- Selection uses xyflow's built-in `selected` flag, driven from `App.selectedId`.

### Filter / detail / synthetic
- `FilterState` + `applyFilter` + `deriveOptions` live in `src/lib/filter.ts`. `App` keeps `allIssues` (full snapshot, optionally padded) and `filtered` (post-filter) separately — the detail panel reads from `allIssues` so the inspected card doesn't vanish when filtered out.
- `DetailPanel` is where every inline editor lives; it calls `onMutate` with a single-field `IssuePatch` per save.
- `?perf=1` in the URL clones existing issues up to 200 (`src/lib/synthetic.ts`) for the 200-card perf target from `PROJECT_STATEMENT.md`. Synthetic ids are suffixed `__syn_<n>` — be aware when debugging.

### Dev-time API plugin
- `src/server/linearApiPlugin.ts` is a Vite plugin (`apply: "serve"` only) that injects connect-style middleware. It instantiates one `LinearClient` per process from `process.env.LINEAR_API_KEY` and uses `client.client.rawRequest` for all GraphQL calls — there is no schema-typed SDK usage. The snapshot file path is resolved relative to `__dirname`, so don't move the plugin without updating it.
- The API key never reaches the browser; the client only sees `/api/*` and `/data/issues.json`.

## Development Mode
- **默认 worktree 模式**：任何新功能开发都在新 worktree 里进行，不直接在主仓库 / `main` 分支动手。
  - 流程：主窗口只调度 → 派 background agent 在新 worktree 起分支 + 独立 dev server → agent 自报端口 → user 在浏览器里验收 → user 明确 "ok / merge" 后再开 PR → 合并 → 清理 worktree。
  - User 没确认前**绝不**开 PR，也不要 push 到远端。
  - 同时最多 ~8 个并行 worktree。
  - 例外：纯 docs / chore / 改 CLAUDE.md / 单文件配置改动这类零风险编辑，可以直接在主仓库改。

## Pride Versioning
- 版本号格式 `x.y.z`：
  - `x` = **proud**：值得骄傲的里程碑（大型完成、重要发布、关键能力解锁）。
  - `y` = **新功能**：新增任何用户可感知的功能或显著改进。
  - `z` = **shame**：修 bug、回滚、补丁、可耻的修正。
- 每次 `git commit` 由 agent 根据 diff/commit message 自动判定要 bump 哪一位：
  - 引入新功能 → `y += 1`，`z = 0`。
  - 修 bug / regression / 回滚 → `z += 1`。
  - proud 级里程碑（由 commit message 显式声明 `[proud]` 或用户明示）→ `x += 1`，`y = 0`，`z = 0`。
  - 纯 docs / chore / 格式化：不 bump，不写 log（除非用户要求）。
- 维护 `VERSION_LOG.md`（仓库根目录）：每个版本号一行，格式 `vX.Y.Z — <一句话功能介绍>`，按时间倒序。
- 首次提交版本号 `0.0.1`。
- agent 在执行 commit 前**先更新 `VERSION_LOG.md`**，把版本条目与代码改动放进**同一个 commit**，commit message 首行带上 `vX.Y.Z`。
- `package.json` 的 `version` 字段也要同步到当前 `vX.Y.Z`。

## Arc Protocol
- 任务管理协议：~/.claude/skills/arc/SKILL.md。
- agent **不主动**读 arcs/index.md；仅在用户显式触发 /arc-* skill 或 `arc <subcmd>` CLI 时进入任务流程。
- 触发 skill：/arc-new, /arc-objective, /arc-plan, /arc-execute, /arc-resume, /arc-spawn, /arc-finalize。
- 触发 CLI：arc {new,spawn,pause,resume,status,abandon,delete,touch,log,output,list,cd,rebuild,init}。
- ID 永远 7 字符 YYMMDDx；canonical 路径 `arcs/all/<id>_*`；状态权威在 `0_meta.md`。
- `done` 必须存在 `9_*.md`；`abandoned` 必须有 `--reason`；`delete` 是硬删（直接全删，不留 trace）。
