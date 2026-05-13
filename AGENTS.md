# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Single-user web app that pulls open issues from one Linear workspace onto a freeform pan/zoom canvas (`@xyflow/react`). Drag changes spatial position only; field edits go through inline controls in the detail panel and are written back via Linear's GraphQL API. Authoritative scope/non-goals: `PROJECT_STATEMENT.md`.

## Commands

- `npm run dev` — start Vite dev server. Vite plugin `linearApiPlugin` mounts `/api/refetch` (GET) and `/api/issue/:id` (PATCH) middleware that talks to Linear using `LINEAR_API_KEY` from `.env`. Without that key, `/api/*` returns 500 but the static UI still loads from the existing snapshot.
- `npm run build` — `tsc -b` (project references) then `vite build`. Both `tsconfig.app.json` and `tsconfig.node.json` must typecheck.
- `npm run preview` — serve the production build. Note: no API middleware here, so mutations and refresh won't work in preview.
- `npm run fetch` — standalone `tsx scripts/fetchSnapshot.ts`; same Linear pull as `/api/refetch`, writes to `public/data/issues.json`. Run this once before `dev` if the snapshot doesn't exist yet (the browser fetches `/data/issues.json` on load and will error otherwise).
- No test runner, linter, or formatter is configured. Don't invent commands.

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
