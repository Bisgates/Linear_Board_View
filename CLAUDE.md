# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Single-user macOS app (Tauri) that pulls open issues from one Linear workspace onto a freeform pan/zoom canvas (`@xyflow/react`). Drag changes spatial position only; field edits go through inline controls in the detail panel and are written back via Linear's GraphQL API (Rust side). Authoritative scope/non-goals: `PROJECT_STATEMENT.md`.

## Commands

- `npm run tauri:dev` — Tauri 窗口 + vite + Rust 后端，热重载。前端走 `vite` (port 1420)，后端 commands 见 `src-tauri/src/lib.rs` / `linear.rs`。日常开发就这一条。
- `npm run tauri:build` — 产 `.app` 到 `src-tauri/target/release/bundle/macos/Linear Board.app`。
- `npm run release` — prod release：跑 `tauri:build` 然后把 .app 装到 `~/Applications/Linear Board.app`（旧的 mv 成 `*.bak-YYYYMMDD-HHMMSS` 备份）。日常 ship 走这条，不要直接 `tauri:build` 后手动 cp。
- `npm run release:dev <suffix> [-- --reset-data]` — worktree dev release：partial-override conf 把 productName / identifier 改成 `Linear Board <suffix>` / `com.han.linearboard.dev.<slug>`，产物留在 `src-tauri/target/release/bundle/macos/` 不进 `~/Applications/`，data dir 独立 (`~/Library/Application Support/com.han.linearboard.dev.<slug>/data/`) 且默认保留改动。
- No test runner, linter, or formatter is configured. Don't invent commands.

## Runtime

Single Tauri runtime. 浏览器开发模式（`npm run dev` + Node-side `linearApiPlugin`）已于 v0.26.0 退役 —— dual-stack 时期遗留的 `tauriBridge.ts` shim / `linearApiPlugin.ts` / 双份 vite config / `@linear/sdk` + `dotenv` + `tsx` + `node-pty` deps 全部清掉。新增 endpoint = 写一个 `#[tauri::command]` 注册到 `src-tauri/src/lib.rs::invoke_handler`，然后在 `src/lib/tauriInvoke.ts` 加一个 typed wrapper 调 `invoke()`。

数据路径：`~/Library/Application Support/com.han.linearboard/data/`（生产）或 `…/com.han.linearboard.dev.<slug>/data/`（dev release）。

Webview devtools：右键 → Inspect Element（Tauri 自带 inspector，没有 Chrome devtools）。

## Architecture

### Snapshot is the source of truth on the client
- Rust 写入 `<data>/issues.json` (an entire `SnapshotFile`: `issues`, `pages`, `elapsedMs`, `fetchedAt`, plus `meta.workflowStates`)；前端通过 `invoke("read_issues_snapshot")` 读。
- `linear_fetch_all_issues` (Rust) filters to open state types only (`backlog | unstarted | started`); "Done"/"Cancelled" issues never enter the snapshot. `linear_fetch_workflow_states` is invoked separately and stored under `meta.workflowStates` so the state-picker can offer states (e.g. "Done") whose issues aren't in the snapshot.
- `src/App.tsx` holds the single `snapshot` state. `IssueRecord` (`src/linear/types.ts`) is the canonical shape; both the Rust GraphQL client (`src-tauri/src/linear.rs`) and frontend optimistic updates produce this exact shape — keep them in sync or optimistic UI breaks.

### Optimistic mutation + rollback
- `App.mutate(id, patch)` (`src/App.tsx`) is the one path for field writes. It (1) builds an optimistic `IssueRecord` by looking up referenced entities (states, projects, cycles, assignees, labels) from the in-memory snapshot, augmenting `states` with `meta.workflowStates` for cross-snapshot picks; (2) applies it locally; (3) calls `updateIssue(id, patch)` from `tauriInvoke.ts` → `linear_update_issue` Rust command; (4) replaces with the authoritative record, or rolls back to `prevIssue` on failure and surfaces a toast.
- `IssuePatch` (`src/linear/updateIssue.ts`) is the wire format. To add a new editable field, extend `IssuePatch`, the lookup block in `mutate`, the Rust mutation input, and the Rust `toRecord` mapper.

### Canvas, positions, layout
- `Board.tsx` wraps `ReactFlow` and treats every issue as a `type: "issue"` node rendered by `IssueCard`. Edges are derived purely from `parentId`/`childrenIds` within the filtered set.
- Initial layout: deterministic 6-col grid with seeded per-issue jitter (`src/lib/layout.ts`).
- Persistence: `localStorage` key `linear_board_view:positions:v1` (`src/lib/persistence.ts`). Hydration order on every issue-list change: compute grid → load stored → prune orphans (ids no longer in the snapshot) → `{ ...initial, ...stored }`. Saves are debounced 200ms after drag settles. There is no server-side position store.
- Selection uses xyflow's built-in `selected` flag, driven from `App.selectedId`.

### Filter / detail / synthetic
- `FilterState` + `applyFilter` + `deriveOptions` live in `src/lib/filter.ts`. `App` keeps `allIssues` (full snapshot, optionally padded) and `filtered` (post-filter) separately — the detail panel reads from `allIssues` so the inspected card doesn't vanish when filtered out.
- `DetailPanel` is where every inline editor lives; it calls `onMutate` with a single-field `IssuePatch` per save.
- `?perf=1` in the URL clones existing issues up to 200 (`src/lib/synthetic.ts`) for the 200-card perf target from `PROJECT_STATEMENT.md`. Synthetic ids are suffixed `__syn_<n>` — be aware when debugging.

### Tauri command surface
- `src-tauri/src/lib.rs` registers ~21 `#[tauri::command]`s (snapshot R/W, day / custom view manifests + board files, all-issues board, `open_path`, Linear key resolution).
- `src-tauri/src/linear.rs` owns the Rust GraphQL client (`reqwest` + handwritten queries) + 4 Linear commands: `linear_fetch_all_issues` / `linear_fetch_workflow_states` / `linear_update_issue` / `linear_create_issue_comment`.
- Frontend never `invoke()`s directly; everything routes through `src/lib/tauriInvoke.ts` so the call sites stay typed and the command names live in one file.

## Agent management (placeholder)
- Agent UI tab + per-issue badges are kept in the codebase but **disabled** (`useAgentSessions()` returns an empty no-op stub; see `src/lib/useAgentSessions.ts` → `AGENT_DISABLED_MSG`).
- 真实实现等 Rust pty 落地后再接回 —— spike `arcs/all/260516b_spike_rust_pty` 已 de-risk，待起 arc。

## Development Mode
- **默认 worktree 模式**：任何新功能开发都在新 worktree 里进行，不直接在主仓库 / `main` 分支动手。
  - 流程：主窗口只调度 → 派 background agent 在新 worktree 起分支 + 独立 dev server → agent 自报端口 → user 在浏览器里验收 → user 明确 "ok / merge" 后再开 PR → 合并 → 清理 worktree。
  - User 没确认前**绝不**开 PR，也不要 push 到远端。
  - 同时最多 ~8 个并行 worktree。
  - 例外：纯 docs / chore / 改 CLAUDE.md / 单文件配置改动这类零风险编辑，可以直接在主仓库改。

## Agent Self-Test (HARD RULE)
- **凡是改了 user-visible 行为的功能/修 bug，agent 必须自己跑通端到端测试再说"done"**，不能把"麻烦你测一下"扔回给 user。仅当某个验证项物理上无法自动化（e.g. 主观视觉判断、外部服务联调）才回退到 user 手测，并明确告知"X 我测了，Y 我没法自动测，你帮我看一下"。
- **标准 loop**（v0.26.x undo/redo bug 调试时验证过）：
  1. **加临时 file log**：在 `src-tauri/src/lib.rs` 临时加一个 `debug_log_append(msg)` command（写到 `<data_root>/debug.log`），在 `tauriInvoke.ts` 加 `debugLogAppend()` wrapper，在被调试的代码路径里调用，让内部状态跨过 IPC 边界落到磁盘，Bash 端 `tail -f` 就能看。
  2. **Python + Quartz 直接发输入到 Tauri PID**：`pgrep -f "target/debug/linear-board"` 拿 PID，`Quartz.CGEventCreateKeyboardEvent` / `CGEventCreateMouseEvent` 造事件，**`Quartz.CGEventPostToPid(pid, ev)`** 投递。常用 virtual keycode：Esc=53, Tab=48, U=32, F=3, Space=49, Return=36；modifier flags `kCGEventFlagMaskShift` / `kCGEventFlagMaskCommand`；双击靠 `CGEventSetIntegerValueField(ev, kCGMouseEventClickState, n)`。
  3. **loop**：发输入 → `sleep 0.3–0.5s`（给 200ms debounced save + RAF tidy 留时间）→ 读 `debug.log` / 数据文件 mtime → diff 预期 → 迭代。
  4. **绿了就把临时调试 infra 拆掉**（debug_log_append command + JS wrapper + dlog 调用都删），别让它跟着 ship。
- **后台执行约束（不能影响 user 用电脑）**：
  - **绝对不用** `osascript "set frontmost to true"` 抢焦点，也别用全局 `CGEventPost`（会被 WindowServer 路由到当前 key window，clobber user 的输入）。
  - **只用 `CGEventPostToPid(pid, ev)`**：事件直发到目标进程，user 当前 frontmost 是 ghostty / browser / 任何东西都不受影响。
  - **Tauri 窗口可以被盖住、推到别的 Space、移到屏幕角落，但不能 minimized**（WebKit 在 AXMinimized=true 时暂停事件处理，事件会被静默丢弃 —— spike 2026-05-18 已验证）。
  - 长跑测试要彻底隔离的话，`npm run release:dev <suffix>` 起一份独立 identifier + data dir 的 app，agent 驱动那个，user 主 app 一根头发不动。
- **HMR 提示**：改了 `useBoardState` 之类的 hook，HMR 会让 App 重挂、所有 ref（含 undoStack / redoStack）清零；测之前先做几个新动作填栈，否则一上来按 U 全是 EMPTY。
- **存在 memory**：`feedback_agent_self_test_loop.md` 有更详细的 spike 数据和边界条件。

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
