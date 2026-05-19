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

## Development Mode (orchestrator / implementer / tester 三角)

**主 agent 永远不直接写代码**，所有需求都派给 subagent。只有纯 docs / chore / 改 CLAUDE.md / 单文件配置这类零风险编辑可以在主仓库直接动；其他全部走 worktree。

### 三个角色

- **主 agent (orchestrator)**：常驻 user 主窗口。收需求 → 路由（见下）→ 派 implementer / tester subagent。**自己不动代码、不跑 dev、不开 PR 前不 push**。
- **implementer subagent**：在 worktree 里写代码（每个 worktree 一个独立分支）。允许的自检：`tsc -b` / `npm run tauri:build`（仅当需要）/ 读文件 diff 自己实现的逻辑。**不跑 Quartz E2E，不起 dev app**。完成后写 ready 信号入队列，等 tester 验。
- **tester subagent**：唯一持有 `com.han.linearboard.dev` 标识 + 共享 dev data dir（`~/Library/Application Support/com.han.linearboard.dev/data/`）的角色。串行处理队列，每次起 `npm run tauri:dev:shared` → Quartz `CGEventPostToPid` 驱动 E2E（套路见下面 Agent Self-Test）→ 写报告 → kill dev → 处理下一个。

### 路由规则（主 agent 收到新需求时）

1. 先看在跑的 implementer subagent 列表 + 各自 scope。
2. 新需求**逻辑上属于某个 in-flight implementer 的范围** → `SendMessage` 把任务加派给该 agent，**不要**开新 worktree。
3. 新需求是独立 feature → 起新 worktree + 新 implementer subagent。
4. 同一 implementer 的多个任务**作为一组**进 tester 队列 —— 一次 tester run 覆盖整组，不是用户每发一条消息就排一次。
5. 上限：同时 ~8 个并行 worktree。

### Ready 队列（跨 worktree 共享，绝对路径）

- 根目录：`~/.linear_board_test_queue/`
  - `pending/<unix_ts>__<worktree-slug>.md` — implementer 完成时写入
  - `processing/` — tester 接到后 `mv` 进来
  - `done/` / `failed/` — tester 跑完按结果归档
- 队列文件内容（implementer 写）：worktree 绝对路径、分支名、本次提交点（`git rev-parse HEAD`）、要 tester 验证的行为清单（"按 U 后 issue X 的 state 应回到 Backlog" 这种可机器判定的断言）。
- 失败回弹：主 agent 发现 `failed/` 有新文件 → `SendMessage` 把报告递给原 implementer 修 → 修完重新写 `pending/`，**不要**新起 implementer。

### 共享 dev runtime

- `npm run tauri:dev:shared [-- --reset-data]` — `tauri dev` + override conf (`src-tauri/tauri.dev-shared.conf.json`)，identifier = `com.han.linearboard.dev`，数据目录 = `~/Library/Application Support/com.han.linearboard.dev/data/`，首次自动从 prod data dir seed。
- 用户主 app (`~/Applications/Linear Board.app`) 在用 `com.han.linearboard` + 它自己的数据目录，**两条线物理隔离**，agent 在 dev 里怎么折腾都污染不到用户活数据。
- tester 跑完一组任务后**不主动** `--reset-data`；要重置时再加 flag。
- 因为 tester 是**串行单实例**，不存在多 dev app 抢同一 identifier 的并发问题。

### 验收 → 聚合 dev → merge → 清理（默认走聚合路径）

**多个 worktree 都 tester 全绿后，默认走"聚合 dev 一次性验收"**，不要让 user 一个 worktree 一个 worktree 单独 `open` 测。

聚合步骤（主 agent 在主仓库执行，不进任何 worktree）：
1. `git checkout main && git checkout -b agg-pending-review`（已存在就删了重建）。
2. 按版本号升序顺序 `git merge --no-ff --no-edit worktree-agent-<id>` 把每个绿了的分支合进来。**VERSION_LOG.md 和 package.json 几乎必然冲突**：手动取所有 entry 按版本倒序排，`package.json` version 取最高那个。其他冲突要看具体 hunk 判断（一般同文件里两个 agent 改了不同段就 auto-merge 干净）。
3. 聚合分支上跑 `npx tsc --noEmit -p tsconfig.app.json` + `cd src-tauri && cargo check --quiet` 双 check，任何 fail 都不要丢给 user。
4. 直接在主仓库（不是 worktree）起 `npm run tauri:dev:shared`（**后台跑，会自动开窗口**，shared identifier 跟 user 主 app 物理隔离）。
5. 通知 user："聚合 dev 起来了，请验这些点：…"，给一份**按 worktree 分组的简短测试清单**（每个 worktree 3-5 行人能记住的关键点，不是把 tester 的完整 assertion 列表复制过来）。也列出 tester 标了 `unable_to_self_test` 的项，这些必须 user 亲眼看。
6. user 一句 "ok / merge" → 主 agent 在主仓库 `git checkout main && git merge --no-ff agg-pending-review`（fast-forward 或一个 merge commit 都行），然后 `git push`，**push 成功后自动 `npm run release`**（CLAUDE.md → Pride Versioning 已有这条规则；聚合 push 必然带版本号 bump）。
7. 清理：`pkill -f "target/debug/linear-board"` 杀聚合 dev → `git branch -d agg-pending-review` → 每个 worktree `git worktree remove <path>` + `git branch -D worktree-agent-<id>` → `mv ~/.linear_board_test_queue/done/<那些>.md` 删掉。

**user 没说 "ok / merge" 之前，绝不 merge 到 main、绝不 push、绝不 release。** 聚合 dev 是为了让 user 一次验完，不是默认通过的信号。

退化路径（只 1 个 worktree 待验收）：直接 `cd <worktree> && npm run tauri:dev:shared` 起 dev，跳过聚合分支步骤。user ok 后该 worktree 直接 merge 进 main。

## Agent Self-Test (HARD RULE)
- **凡是改了 user-visible 行为的功能/修 bug，必须 tester subagent 跑通端到端再说"done"**，不能把"麻烦你测一下"扔回给 user。Implementer 自己只做 typecheck/build smoke，不跑 Quartz E2E —— E2E 走 tester（见上面 Development Mode 三角）。仅当某个验证项物理上无法自动化（e.g. 主观视觉判断、外部服务联调）才回退到 user 手测，tester 在报告里明确标"X 我测了，Y 没法自动测，请你看一下"。
- **标准 loop**（v0.26.x undo/redo bug 调试时验证过）：
  1. **加临时 file log**：在 `src-tauri/src/lib.rs` 临时加一个 `debug_log_append(msg)` command（写到 `<data_root>/debug.log`），在 `tauriInvoke.ts` 加 `debugLogAppend()` wrapper，在被调试的代码路径里调用，让内部状态跨过 IPC 边界落到磁盘，Bash 端 `tail -f` 就能看。
  2. **Python + Quartz 直接发输入到 Tauri PID**：`pgrep -f "target/debug/linear-board"` 拿 PID，`Quartz.CGEventCreateKeyboardEvent` / `CGEventCreateMouseEvent` 造事件，**`Quartz.CGEventPostToPid(pid, ev)`** 投递。常用 virtual keycode：Esc=53, Tab=48, U=32, F=3, Space=49, Return=36；modifier flags `kCGEventFlagMaskShift` / `kCGEventFlagMaskCommand`；双击靠 `CGEventSetIntegerValueField(ev, kCGMouseEventClickState, n)`。
  3. **loop**：发输入 → `sleep 0.3–0.5s`（给 200ms debounced save + RAF tidy 留时间）→ 读 `debug.log` / 数据文件 mtime → diff 预期 → 迭代。
  4. **绿了就把临时调试 infra 拆掉**（debug_log_append command + JS wrapper + dlog 调用都删），别让它跟着 ship。
- **后台执行约束（不能影响 user 用电脑）**：
  - **绝对不用** `osascript "set frontmost to true"` 抢焦点，也别用全局 `CGEventPost`（会被 WindowServer 路由到当前 key window，clobber user 的输入）。
  - **只用 `CGEventPostToPid(pid, ev)`**：事件直发到目标进程，user 当前 frontmost 是 ghostty / browser / 任何东西都不受影响。
  - **Tauri 窗口可以被盖住、推到别的 Space、移到屏幕角落，但不能 minimized**（WebKit 在 AXMinimized=true 时暂停事件处理，事件会被静默丢弃 —— spike 2026-05-18 已验证）。
  - tester 用 `npm run tauri:dev:shared`（identifier = `com.han.linearboard.dev`，独立 data dir，HMR），不要碰用户主 app 的 `com.han.linearboard`。`release:dev <suffix>` 留给"需要一份独立产物 + 隔离 data 的 long-running 验证"场景，不是日常 tester 流程。
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
- 维护 `VERSION_LOG.md`（仓库根目录）：每条 `- vX.Y.Z [YYYY-MM-DD HH:MM] — <一句话功能介绍>`，时间倒序。**只记用户可感知的功能/行为变化**，不写代码层面实现细节（文件名 / 函数 / 算法 / 行数都不写 —— 想看 diff 自己 `git show`）。需要补"为什么这么改"或非显然上下文（如"在哪个版本撤回"、"沟通失误"），下挂一条缩进 bullet，仍一句话写完；没必要就不加。
- 首次提交版本号 `0.0.1`。
- agent 在执行 commit 前**先更新 `VERSION_LOG.md`**，把版本条目与代码改动放进**同一个 commit**，commit message 首行带上 `vX.Y.Z`。
- `package.json` 的 `version` 字段也要同步到当前 `vX.Y.Z`。
- **`git push` 后自动 `npm run release`**：只要这次 push 包含至少一个 `vX.Y.Z` 前缀的 commit（即版本有 bump），push 成功后 agent 必须接着跑 `npm run release` —— prod 打包 + 装 `~/Applications/Linear Board.app` + 发 GitHub Release，user 收到旧版的 in-app updater 提示一键升级。如果这次推的全是 chore/docs（没 bump 版本），则跳过 release。

## Arc Protocol
- 任务管理协议：~/.claude/skills/arc/SKILL.md。
- agent **不主动**读 arcs/index.md；仅在用户显式触发 /arc-* skill 或 `arc <subcmd>` CLI 时进入任务流程。
- 触发 skill：/arc-new, /arc-objective, /arc-plan, /arc-execute, /arc-resume, /arc-spawn, /arc-finalize。
- 触发 CLI：arc {new,spawn,pause,resume,status,abandon,delete,touch,log,output,list,cd,rebuild,init}。
- ID 永远 7 字符 YYMMDDx；canonical 路径 `arcs/all/<id>_*`；状态权威在 `0_meta.md`。
- `done` 必须存在 `9_*.md`；`abandoned` 必须有 `--reason`；`delete` 是硬删（直接全删，不留 trace）。
