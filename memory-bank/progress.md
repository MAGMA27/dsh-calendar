# dsh-calender 进度（Progress）

## 当前状态
- **阶段**：计划已批准（用户确认 Host 权威架构），进入 **M0 脚手架**。
- **已完成调研（证据已取证）**：
  - DSH 插件运行模型（bundle/profile/双面包/客户端 bundle 格式/tsdown 预设）——基于本机 rc.6 已装包。
  - 运行时 API 签名（浏览器 sessions/workspaces/connection；Host ApiProxy sessions/workspaces）。
  - 官方 client-bundle 预设源码（deepseek-harness `packages/client/tsdown.client.ts` = dsh-web-ui `shared/tsdown.client.ts` + `web-platform.ts`）——已抓取完整文本，M0 直接落地。
  - 参考实现：本机 task-board 0.1.18（浏览器模式）+ 官方 task-board 0.2.0（Host 权威：ledger/cron/HTTP/SSE/迁移）——0.2.0 host 侧源码已抓取。
  - GitHub 同类项目：Timeslice / WeekToDo / ToDo-Matrix / Super Productivity / un-schedule / ai-daily-planner（设计参考）。
  - 网络：沙箱 PowerShell 无外网，但 **Node fetch 可达 npm registry 与 raw.githubusercontent**（已实测）→ pnpm 安装与官方预设拉取可行。
- **文档落盘（本里程碑）**：AGENTS.md、memory-bank（project-design-doc/architecture/implementation-plan/progress）、docs（待写 DESIGN.md/development-plan.md）。

## 已确认决策
- 架构：**Host 权威**（账本/cron/执行结算在 Host，浏览器为同源异步视图）。
- 命名：包 `dsh-calender`、行 id `ui-calender`、命名空间 `calender`、账本 `$DSH_HOME/calender/ledger-v1.json`、DOM `data-dsh-calender-*`、面板事件 `calender`。
- MVP 范围不含 AI 自动排程与空闲睡眠保护（后续增强）。

## 里程碑进度
| 里程碑 | 状态 |
|---|---|
| M0 脚手架 | 未开始（下一项） |
| M1 领域+Host 骨架 | 未开始 |
| M2 日历 UI | 未开始 |
| M3 任务编辑 | 未开始 |
| M4 真实执行 | 未开始 |
| M5 定时调度 | 未开始 |
| M6 完善 | 未开始 |

## 下一步
1. 写 docs/DESIGN.md、docs/development-plan.md、.gitignore。
2. git 首次提交（docs 落盘）。
3. 开始 M0：脚手架文件 → pnpm install → typecheck/build → scratch profile 挂载验证。
