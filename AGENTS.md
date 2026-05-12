
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

## Arc Protocol
- 任务管理协议：~/.claude/skills/arc/SKILL.md。
- agent **不主动**读 arcs/index.md；仅在用户显式触发 /arc-* skill 或 `arc <subcmd>` CLI 时进入任务流程。
- 触发 skill：/arc-new, /arc-objective, /arc-plan, /arc-execute, /arc-resume, /arc-spawn, /arc-finalize。
- 触发 CLI：arc {new,spawn,pause,resume,status,abandon,delete,touch,log,output,list,cd,rebuild,init}。
- ID 永远 7 字符 YYMMDDx；canonical 路径 `arcs/all/<id>_*`；状态权威在 `0_meta.md`。
- `done` 必须存在 `9_*.md`；`abandoned` 必须有 `--reason`；`delete` 是硬删（直接全删，不留 trace）。
