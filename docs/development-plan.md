# dsh-calendar 开发计划（Development Plan）

> 状态：已批准。架构选型：**Host 权威**（用户确认）。本文是执行本文件；进度跟踪见 `memory-bank/progress.md`。

## 1. 目标与验收标准

在 DSH Web GUI 新增**日历待办插件**：侧边栏「日历」入口 → 中间列日历视图；**拖选时间段**建任务；**紧急/重要**（艾森豪威尔）；**子任务**；任务**钉住执行会话与 LLM provider**；**定时让 LLM 响应**（Host 调度，浏览器关闭仍生效）。

**验收标准**：见 `memory-bank/implementation-plan.md` §验收标准（8 条）。

## 2. 调研结论（摘要）

- **GitHub 参考**：Timeslice（拖选即建块）、WeekToDo（手写 7×24 网格、点槽弹创建）、ToDo-Matrix（2D 象限拖拽）、Super Productivity / un-schedule / ai-daily-planner（AI 调度，后续增强）。库：手写网格 + date-fns 为基线；react-big-calendar/FullCalendar 太重。
- **DSH 架构**（rc.6 已取证）：bundle/profile 机制；`dsh plugin --profile web add link:<path>` 自动对账 bundles；双面包（`exports "."` + `./client`）；client bundle = `window.__ModuleLoader__.load({id,factory})`（tsdown 官方预设）；运行时 API（浏览器 sessions/workspaces/connection；Host ApiProxy sessions/workspaces）；UI 接缝走 DOM 注入 + MutationObserver + `dsh-panel-activate` 互斥。
- **最直接参考**：task-board 0.2.0（Host 权威：ledger / cron / HTTP(state,events,action) / SSE / v1→v2 迁移 / 幂等 / 同源安全门）——本插件的 Host 权威模式蓝本。

## 3. 架构决策（已确认）

Host 权威架构：
- Host：任务账本（`$DSH_HOME/calendar/ledger-v1.json`，原子+锁+幂等）、cron 调度、执行 runner、HTTP/SSE 路由、SystemPrompt 段、设置命名空间。
- 浏览器：同源异步视图（React 渲染 + HTTP transport + DOM 挂载），零业务逻辑，一切经 action 提交。
- 共享纯层：`src/core/` + `src/protocol.ts`。
- 执行：建/复用会话 → selectModel（provider 钉子，失败即关闭）→ agent 预设 → /permission → prompt('queue') → 结算；重启按会话现状对账。

## 4. 包结构

```
D:\Dev\agents\dsh-calendar\
├── package.json  cordis.patch.yml  tsconfig.json  tsconfig.build.json  tsdown.config.ts
├── build/   tsdown.client.ts（官方预设）  web-platform.ts（PLATFORM_MODULES）
├── src/
│   ├── index.ts  invariant.ts  protocol.ts  dsh-home.ts
│   ├── host-ledger.ts  host-service.ts  host-runner.ts  host-routes.ts
│   ├── core/   tasks.ts  calendar.ts  schedule.ts  store.ts
│   └── client/ index.ts  apply-guard.ts  host-api.ts  sidebar-entry.ts  calendar-mount.tsx
│              locales.ts  calendar.module.css  components/*.tsx
├── tests/   docs/   scripts/dsh-calendar.js
```

## 5. 领域模型（TaskRecord 核心）

```ts
type Urgency='high'|'medium'|'low'; type Importance='high'|'medium'|'low'
// 象限：high×high→do, low×high→schedule, high×low→delegate, low×low→eliminate
interface SubtaskRecord { id; title; done }
interface ExecutionRecord { id; triggeredBy?; sessionId?; startedAt; endedAt?; result?; error? }
interface ScheduleRule { enabled; cron?; dueAt?; nextRunAt?; lastTriggeredAt? }
interface TaskRecord {
  id; title; description; prompt; startAt; endAt; allDay?
  urgency; importance; done; completedAt?; subtasks[]; executions[]
  schedule?; workspaceId?; sessionId?; provider?; model?; reasoningEffort?
  permission?; mode?; archivedAt?; createdAt; updatedAt
}
```

## 6. 里程碑（M0–M6）

| 里程碑 | 内容 | 验收 |
|---|---|---|
| **M0 脚手架** | package/tsconfig/tsdown+预设/cordis.patch.yml/invariant/空 host+client | typecheck+build 通过；lib 产物存在；scratch 挂载 `--dump-config` 出现 `ui-calendar` |
| **M1 领域+Host 骨架** | core 四模块 + protocol + host-ledger + host-routes + host-service 空转 | core 单测；state 冒烟；账本原子/损坏/幂等测试 |
| **M2 日历 UI** ✅ | WeekGrid 拖选/移动/跨日/拉伸/表头/重叠并排 + MonthGrid + transport + 挂载 | GUI 拖选建任务；jsdom 挂载测试 |
| **M3 任务编辑** ✅ | CreateTaskModal + TaskDetailPanel + MatrixPanel + AgendaPanel + ExecutionSettings | GUI 全表单/矩阵拖拽；tasks 状态机测试 |
| **M4 真实执行** ✅ | host-runner（会话/provider/预设/权限 钉子 + 结算）+ 执行记录 + 会话跳转 + 运行/会话徽标 | fake ApiProxy 测试（选择/失败关闭/结算）——92 单测 |
| **M5 定时调度** ✅ | Host cron + 到期触发（只接受后滚动）+ 重启对账 + SSE 广播 + v1 迁移 | host-scheduler/runner 测试——105 单测 |
| **M6 完善** ✅ | 设置卡（calendar 命名空间）+ SystemPrompt 段（可开关）+ 设计打磨 + 全量测试 + 文档 + scripts/dsh-calendar.js CLI | 全量验证矩阵通过——105 单测 |
| **M7 日历 Tool** ✅ | 把日历暴露为对话中 LLM 可调用的 `calendar_task` tool（创建/删除/修改/查询任务，含子任务与执行钉子）；Host 侧把 tool 调用映射到同一 HostLedger.apply；输出 DTO 遵守 lossless JSON 契约；list 支持时间、完成状态、session、project/workspace、provider/model、LLM 参与度过滤，并返回 completedAt、scheduled/autoRun 与按查询窗口裁剪的执行记录；执行记录标记 manual/schedule 来源 | host-tool/runner/scheduler/store/tasks 测试（过滤、窗口裁剪、来源标记、定时/run、含 schedule 的输出校验） |

## 7. 测试与验证

- 单元：calendar/schedule/tasks/store（纯函数）
- Host：host-ledger、protocol、host-service、host-runner（fake ApiProxy）
- Client（jsdom）：host-api、apply-guard、sidebar-entry-dom-guard、center-column-css
- 真实组合：scratch profile add → `--dump-config`；headless 冒烟；GUI 人工清单
- 基线：`pnpm typecheck && pnpm build && pnpm test`

## 8. 执行纪律

- **严格按计划执行；每步测试；验收通过才进入下一里程碑。**
- **每里程碑用 git 管理**（Conventional Commits；里程碑完成附测试通过记录）。
- **小模块可委派 subagent 开发**（给自包含任务与验收标准）。

## 9. 风险与假设

- SDK 以本机 rc.6 已装包 exports/types 为边界；SSE 若缺则轮询 state 兜底。
- 同源安全门 MVP 仅 loopback；反向代理白名单留配置位。
- 与已装 dsh-web-ui-all 独立共存（独立命名/DOM/存储；面板互斥协同）。
- 网络：Node fetch 可达 npm registry 与 raw.githubusercontent（已实测）。
