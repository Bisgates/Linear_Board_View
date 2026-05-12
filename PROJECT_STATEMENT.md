# Linear Board View — Project Statement

> 第一份正式产物。本文件由 arc `260512a_create_project_statement` 产出，作为后续所有 arc（技术选型 / UI / 实施）的引用源。改动以新 arc 形式登记，不直接覆盖。

## Vision

一个**只给本人用**的网页 app：把 Linear 工作区内的 issues 平铺在一张**可自由摆位的画布**上，每张卡片支持原地快捷编辑核心字段，回写 Linear。

设计取向是**「一眼看清全局 + 流畅愉悦的编辑」**，而不是 Linear 原生那种列表+表格的密度优先体验。区别于 Kanban 应用（列式拖拽改状态），本 app 的拖拽**只改空间位置**，不改 Linear 数据；状态等字段改动走卡片上的 inline 控件。

## Target User

- 主理人本人，**single-user**。
- 不引入：登录系统、多 workspace 切换、权限模型、多人协作。
- 假设：使用者本人拥有目标 Linear workspace 的 API 访问权限，API token 通过本地配置注入。

## In-scope

1. **数据接入**：从单一 Linear workspace 拉取 issues 及其常用字段。
2. **画布展示**：所有 issue 以卡片形式渲染到一张可缩放 / 平移的画布上；卡片可拖到画布任意位置。
3. **Inline 快捷编辑**（无需打开详情页即可改）：
   - 标题、描述
   - Status、Priority、Assignee
   - Labels、Project、Cycle
4. **写回 Linear**：任一 inline 编辑通过 Linear API 同步回 Linear，刷新 Linear web 端即可见。
5. **视觉层级**：卡片设计让**优先级 + 负责人**在 3 秒内可辨识。
6. **性能基线**：≥ 200 张卡片同屏渲染时，拖拽 / 过场动画稳定 ≥ 60fps，inline 编辑响应延迟 < 100ms。
7. **桌面浏览器优先**：以 Chrome 为基准环境调优。

## Non-goals

- ❌ **不做 Kanban 列式拖拽**（与画布形态互斥）。
- ❌ **不内联编辑 Due date / Estimate**（频率低，按需打开详情即可）。
- ❌ **不做多人协作 / 评论 / @mention / Reactions / 通知** —— 这些在 Linear 原生用就好。
- ❌ **不做登录系统 / 权限 / 多 workspace 切换** —— single-user 直接走本地 token。
- ❌ **不做移动端 / 触屏专属交互**（首版桌面优先；不主动适配 iPad / 手机）。
- ❌ **不复刻 Linear 既有页面**（完整 issue 详情页、子任务树、Roadmap、Insights）。
- ❌ **不做 issue 创建流程的「精雕」**（首版即便有创建入口也是极简形式，重点在「看与改」）。

## Success Criteria

至少这四条要能验：

1. **认知速度可测**：外人首次打开一张装满卡片的 board，能在 3 秒内指出指定 issue 的**优先级**与**负责人**。
2. **动画帧率可测**：Chrome DevTools Performance 面板下，拖拽 + 过场动画稳定 ≥ 60fps。
3. **容量与响应可测**：渲染 200 张卡片状态下，单次拖动无掉帧，inline 编辑从触发到 UI 反馈 < 100ms。
4. **数据一致性可测**：八类 inline 编辑（标题 / 描述 / Status / Priority / Assignee / Labels / Project / Cycle）任一改完，刷新 Linear web 端均可见对应变更。

## Open Questions

后续 arc 需要决定的事，先列出来不做：

- **位置持久化** —— 画布坐标存哪里？localStorage / IndexedDB / Linear 自定义字段 / 自建后端？跨设备是否同步？
- **初次布局** —— 第一次进入时按什么排（按更新时间网格 / 按 status 聚类 / 按 priority 分层 / 随机）？
- **workspace 绑定** —— 写死在配置里，还是首次启动让用户选？
- **过滤能力** —— 是否需要按 status / cycle / project / label 临时隐藏卡片？这与「自由摆位」的画布感如何兼容？
- **渲染选型** —— 200 卡片同屏到底要不要虚拟化（virtualized DOM / canvas 渲染 / WebGL）？还是普通 DOM + CSS transform 已经够？
- **失败处理** —— API 写回失败时的回滚 / 重试 / 提示策略？
- **离线** —— 是否要本地缓冲 + 上行同步，还是强制在线？
- **暗色模式** —— 默认就有，还是后置？
