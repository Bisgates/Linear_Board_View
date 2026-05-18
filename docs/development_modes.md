# Development Modes — 浏览器 vs Tauri

> 临时状态。2026-05-16 起项目同时跑两个 runtime；最终目标是单 Tauri stack。本 doc 解释为什么、怎么用、什么时候能甩掉 dual-stack。

## TL;DR

写代码用 `npm run dev`（浏览器，hot reload + Chrome devtools，体验最好）。
日常用产品双击 `Linear Board.app`（Tauri 壳）。
新功能 ship 进 .app 跑 `npm run tauri:build`。

每加一个 `/api/*` endpoint 要在**三处**实现 —— 这是 dual-stack 的代价，迁完 Linear API + agent 到 Rust 后这个税自动消失。

---

## 三种姿势 — 为什么选 dual-stack

| 模式 | 描述 | 优点 | 缺点 |
|---|---|---|---|
| A. 纯浏览器 | 只跑 `npm run dev`，没有 .app | 最简单 | 失去原生壳：Cmd+Tab、tray、global hotkey、独立 dock 图标都没了 |
| **B. Dual-stack（当前）** | 浏览器是主开发环境，Tauri 是 packaging + 实际使用 | 享受浏览器开发体验 + 享受原生壳；现有架构天然支持 | 后端每个 endpoint 写三遍 |
| C. 纯 Tauri | 只跑 `tauri:dev`，没有 vite 浏览器开发模式 | 单一 stack 最干净 | 现阶段 Rust 后端还没覆盖全部功能；Tauri webview devtools 比 Chrome 差一档 |

**为什么不直接跳 C？** Rust 后端目前还缺 Linear API + agent (`node-pty`) 的实现 —— 那两块迁完才能切。在那之前强行 C 等于砍掉一半功能。

**A 不考虑** —— han 想要"个人管理中枢"，原生壳是核心体验。

---

## 命令清单

### 浏览器开发（主力）
```bash
npm run dev              # vite + 完整 Node 后端 (linearApiPlugin)
                         # 包括 agent_tmp tab + node-pty agent poller
                         # localhost:5173
```

### Tauri 开发
```bash
npm run tauri:dev        # vite (vite.tauri.config.ts) + Rust 后端 + Tauri 窗口
                         # 不挂 linearApiPlugin (避免 node-pty 进 module graph)
                         # 没有 agent_tmp 功能 (Rust 端 stub)
                         # localhost:1420 (Tauri 内部用)
```

### Tauri 打包
```bash
npm run tauri:build      # 产 .app 到:
                         # src-tauri/target/release/bundle/macos/Linear Board.app
```

完整路径示例：`/Users/han/project/life/linear_board_view/src-tauri/target/release/bundle/macos/Linear Board.app`

---

## Release flow

> 加于 2026-05-16（arc `260516d_release_flow`）。日常 ship 走这两条命令，别直接 `tauri:build`。

实际产品 `.app` 装到 `~/Applications/`；并行 worktree 上跑出来的实验性 `.app` 只待在 `target/`，自带独立 productName + identifier + data dir，**不污染主 install**。

### `npm run release`（prod）

```bash
npm run release
```

走的是：
1. `npm run tauri:build`（用 canonical `src-tauri/tauri.conf.json`，productName=`Linear Board`, identifier=`com.han.linearboard`）
2. 如果 `~/Applications/Linear Board.app` 已存在，先 `mv` 到 `Linear Board.app.bak-YYYYMMDD-HHMMSS`（不删，可回滚）
3. `cp -R` 新 bundle 到 `~/Applications/Linear Board.app`
4. 数据继续走现有 symlink `~/Library/Application Support/com.han.linearboard/data/` → `<repo>/public/data/`（**不动**）

### `npm run release:dev <suffix> [-- --reset-data]`（worktree dev）

```bash
npm run release:dev agent-mgmt              # 第一次 build：seed data fixture
npm run release:dev agent-mgmt              # 再 build：保留 dev data 改动
npm run release:dev agent-mgmt -- --reset-data   # 强制刷 data fixture
```

走的是：
1. 写一份 partial-override 到 `src-tauri/tauri.dev.conf.json`（gitignored）：
   - `productName` = `Linear Board <suffix>`（窗口标题 + .app 文件名 + CFBundleName 同步改）
   - `identifier` = `com.han.linearboard.dev.<slug>`（slug = 小写 + 非字母数字转 `-`）
2. `npx tauri build --config src-tauri/tauri.dev.conf.json`（Tauri 2.x 自动 merge 到主 conf 上）
3. 产物在 `src-tauri/target/release/bundle/macos/Linear Board <suffix>.app`
4. **不**复制到 `~/Applications/`（避免与 prod 抢图标）
5. 数据 dir 走独立路径 `~/Library/Application Support/com.han.linearboard.dev.<slug>/data/`：
   - 不存在 → `cp -RL` 从 prod data fixture 复制一份（`cp -RL` 跟着 symlink，所以拿到的是真文件而不是 broken link）
   - 已存在 → 默认保留（dev 期间在 .app 里改的东西不丢）
   - 加 `--reset-data` → 删掉重新 cp，回到 prod fixture 状态

### 为什么这么分

- **prod 装到 `~/Applications/`**：用户级目录（不是 `/Applications/`，不要 sudo），dock / Cmd+Tab 直接出现。
- **dev 留在 `target/`**：worktree 同时跑多个分支时，每个分支可以自己 build 出独占 .app，不互相覆盖，也不污染 dock。
- **dev identifier 必须不同于 prod**：macOS LaunchServices 用 bundle id 做 routing，重了的话 Cmd+Tab / `open -b` 行为不可预期。
- **dev data 完全隔离**：每个 dev identifier 对应自己的 Application Support 子目录（Tauri 的 `app_data_dir()` 由 identifier 派生），prod data 不受任何 dev 实验影响。
- **第一次 seed 用 prod data 做 fixture**：dev .app 一打开就有现成的 board / issues / notes 可看，不用从空状态调试。
- **后续 build 默认 skip data seed**：测试期间在 dev .app 里改了 NoteCard 或拖了卡片，下次 build 不会被冲掉；要回零再加 `--reset-data`。

### worktree convention

每个 worktree 用 branch / 分支名做 suffix，例：

```bash
# 在 worktrees/agent-mgmt/ 里
cd worktrees/agent-mgmt
npm run release:dev agent-mgmt
open "src-tauri/target/release/bundle/macos/Linear Board agent-mgmt.app"
```

完事后 worktree 删掉，对应的 dev `.app` 跟 `target/` 一起没了；`~/Library/Application Support/com.han.linearboard.dev.agent-mgmt/` 要手动清（不影响 prod）。

### 实现细节

- 临时 conf 路径：`src-tauri/tauri.dev.conf.json`（gitignored；每次 dev release 重写，不需要手清）。
- 主 conf 文件 (`src-tauri/tauri.conf.json`) **从不被脚本写**，永远是 prod truth。
- Cargo PATH：脚本顶 prepend `$HOME/.cargo/bin`，npm 跑的 shell 没继承也能找到 cargo。
- prod 旧 .app 永远 `mv` 到 timestamped backup（`*.bak-YYYYMMDD-HHMMSS`），不 `rm -rf`，方便回滚或拿旧版本比对。

---

## 三处同步约定 —— dual-stack 的代价

每加一个 `/api/*` endpoint，下面三处都要改。漏哪处，那个 runtime 就缺这个功能。**最容易漏 Rust 端**。

### 1. Node 端 route handler（给浏览器）
`src/server/linearApiPlugin.ts`
```ts
// 加路由匹配 + 业务逻辑
if (req.url === "/api/your-endpoint" && req.method === "GET") {
  // ...
}
```

### 2. Rust 端 command（给 Tauri）
`src-tauri/src/lib.rs`
```rust
#[tauri::command]
async fn your_endpoint(app: AppHandle) -> AppResult<YourType> {
    // ...
}

// 注册到 invoke_handler:
.invoke_handler(tauri::generate_handler![
    // ...其他 commands...
    your_endpoint,
])
```

### 3. Bridge dispatch（给前端，透明路由）
`src/lib/tauriBridge.ts`
```ts
if (path === "/api/your-endpoint" && method === "GET") {
  const data = await invoke<YourType>("your_endpoint");
  return { status: 200, body: data };
}
```

前端代码继续用 `fetch("/api/your-endpoint")` —— 在浏览器走 Node route，在 Tauri 走 Rust command。前端无感知。

---

## 数据存储路径

| Runtime | 名义路径 | 实际位置 |
|---|---|---|
| 浏览器开发 (`npm run dev`) | `public/data/` | `<repo>/public/data/` |
| Tauri (`tauri:dev` / `.app`) | `~/Library/Application Support/com.han.linearboard/data/` | symlink → `<repo>/public/data/` |

**两边读写同一份数据**（2026-05-16 起）。Tauri 端的 `data/` 是 symlink 指向 web 端 `public/data/`，所以无论从哪个 runtime 改 NoteCard / board layout / views，对方立刻看到。

如果在别的机器上跑 `.app` 或者 symlink 不见了，Rust 端会在 `~/Library/Application Support/com.han.linearboard/data/` 自动创建空目录走 first-run —— 数据要从这台机器 cp 过去。

之前 cp 过去的 Tauri 副本备份在 `~/Library/Application Support/com.han.linearboard/data.bak/`，确认稳定运行几天后可以删。

---

## Agent-first 协作的考量

这个项目目前只通过 agent (Claude Code) 开发。两个 stack 对 agent 的友好度不一样，结论跟"人类自己写"的体感不一致 —— 值得分开说。

### Agent 在 web stack 的舒适区
- TS / React / Node 是 agent 母语（训练数据巨量），fabricate API 的概率最低
- iteration 快：vite HMR + tsc 反馈秒级
- 单文件 fix 一个 bug 的工作很多，agent 不容易迷失

### Agent 在 .app / Rust stack 的劣势
- Rust 训练数据少于 TS，agent 偶尔 fabricate crate API（实际踩过：reqwest 0.13 的 feature 名 `rustls-tls` → 实际叫 `rustls`，sub-agent 一次失败重试才对）
- cargo compile 慢（每次 verify 30s-1min），agent 迭代节奏被拖
- 三处同步税 → agent 写新 endpoint 时**最容易漏 Rust 端**。实际 fail mode：sub-agent 把 ".app 进程活着 5s 无 stderr" 当成功验过，但 webview 实际白屏（main.tsx 顶层 import 就 crash 了）

### 但 .app 反过来对 agent 有几个 unique 优势
- **编译期 enforce schema**：Rust 的 `serde` struct + `Result` 让 agent 写错 shape 直接 compiler 拦住；TS 的 `any` / `unknown` 漂移 agent 容易没察觉
- **`cargo run --example` 是可证伪的验证手段**：sub-agent 迁 Linear API 时写了 `examples/linear_smoke.rs` 离线验 GraphQL —— 比"启 vite dev server + 在 webview 模拟点 button"可靠得多
- **更少 false success**：cargo 编译不过就是不过；web 容易出"看起来跑了实际 broken"
- **更 hermetic**：cargo workspace + Cargo.lock 比 npm 链路稳，agent 不会被 transitive dep upgrade 搞乱

### Verdict by phase

| 阶段 | Agent 开发难度 vs web |
|---|---|
| dual-stack 期（现在） | 比 web 略难 ~20%，主要是三处同步税 + Rust 偶尔 fabricate |
| dual-stack 退役后（终态 C） | 跟 web 持平甚至略简单：单一 stack 没同步税；Rust 编译期保护让 agent fabricate 更难得逞；example binary 验证比启 server 干净 |

### 核心 insight

> Web 是 agent 的**舒适区** —— 训练数据多、写得快，但容易 cut corner 出 false success。
>
> Rust 是 agent 的**约束区** —— 训练数据少、写得慢，但编译器和 example binary 让 agent 的"自欺欺人"难得多。

对 agent-first 项目，**Rust-only 终态 actually 是 agent 协作的 sweet spot** —— agent 报"做完了"时你信得过的概率更高。这是当前 dual-stack 过渡期承担的复杂性，长期会以"更可信的 agent 输出"还回来。

### Agent 工作的注意事项（实操）
- 新加 `/api/*` endpoint 时，**主 agent 必须自检三处同步**（Node route / Rust command / tauriBridge dispatch），别让 sub-agent 自己判断
- sub-agent 报"build 通过 + 进程活着" ≠ 功能正常。带 UI 的功能要么主 agent 接管验，要么 sub-agent 通过 `cargo run --example` / 文件 mtime 变化等可证伪手段验
- Rust 端写新 crate dependency 时，让 sub-agent 先 `cargo search <crate>` 拿 latest version + feature 列表，再写到 `Cargo.toml`，减少 fabricate

## 切换到单一 Tauri stack 的触发条件

当下面两块都迁完 Rust，`linearApiPlugin.ts` 整个删掉，浏览器开发模式退役：

| 模块 | 状态 (2026-05-16) |
|---|---|
| `boardStore` (卡片位置 / NoteCard / view manifest) | ✅ 已迁 Rust (`src-tauri/src/lib.rs::read_*_board` etc.) |
| Linear API (`fetchIssues` / `updateIssue` / `createComment` / `fetchWorkflowStates`) | 🚧 进行中 — arc `260516c_migrate_linear_to_rust`<br>当前前端调 `@linear/sdk`，SDK 在 webview 兼容性差（stream/http/crypto 等 Node 模块被 externalise）—— 是迁的直接动因 |
| Agent (`node-pty` / `agentPoller` / `agentSessions`) | 📋 待起 arc<br>spike `260516b_spike_rust_pty` 已验证 `portable-pty` 能等价驱动 `claude` CLI，无技术阻塞 |

迁完后的姿势：
- 写代码：`npm run tauri:dev`（Tauri 2.x 可以开 devtools）
- 用产品：还是双击 `.app`
- 不再有"浏览器 vs Tauri"的同步税

---

## 历史背景

- v0.23.0（2026-05-15）之前：纯浏览器 + Vite Node server，`linearApiPlugin` 是唯一后端
- arc `260516a_tauri_mac_app`（2026-05-16）：bridge 架构搭起来，dual-stack 模式上线，`.app` 第一次出来
- arc `260516b_spike_rust_pty`（2026-05-16）：portable-pty 驱动 claude TUI 验通，agent 迁 Rust 之路 de-risk
- arc `260516c_migrate_linear_to_rust`（2026-05-16）：Linear API 迁 Rust，解 `@linear/sdk` webview 兼容性问题
