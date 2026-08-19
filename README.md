# dsh-calendar

一个可热插拔的 DeepSeek Harness (DSH) Web GUI 日历待办插件：侧边栏「日历」入口 → 中间列日历视图；**拖选时间段**建任务；**艾森豪威尔紧急/重要矩阵**；**子任务**；任务可**钉住执行会话与 LLM provider**；**定时让 LLM 响应**（Host 权威调度，浏览器关闭仍生效）。

> 开发中。文档见 `docs/development-plan.md`（计划）与 `docs/DESIGN.md`（设计规范）。

## 功能

- 周视图时间网格**拖选/点击**创建任务，块可移动/拉伸。
- 紧急/重要三级 → 四象限配色；矩阵面板象限拖拽改优先级。
- 主任务挂子任务（进度汇总）。
- 任务钉住执行目标：工作区、执行会话（新建/复用）、LLM provider+model、agent 预设、权限；执行前应用、失败即关闭。
- **Host 定时调度**：受限重复（**每日/每周周几** + 跳过周末与节假日开关）把任务**拷贝到各匹配日期**（副本可单独完成/解绑），或**一次性到时**自动执行并结算；浏览器关闭仍生效；Host 重启按会话现状对账。无自由 cron 输入。
- 设置卡 + SystemPrompt 播报，随 `--dsw-*` token 适配深浅/皮肤。

## 安装

```sh
# 从工作区挂载（自动注册为 profile bundle）
dsh plugin --profile web add link:<本目录>
# 重启 dsh web 后生效（页面刷新不够）
```

## 构建与测试

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build   # → lib/index.js + lib/client.js + lib/types
```

## 目录结构

见 `AGENTS.md`。
## 开发进度
M0–M6 已完成：日历 UI / 任务编辑 / 真实执行（host-runner）/ Host 定时调度（host-scheduler + SSE）/ 完善（设置卡 `calendar` 命名空间 + SystemPrompt 段 + `scripts/dsh-calendar.js` CLI）。M7 日历 Tool 已交付；M7 后多轮 UI 迭代与定时模型重构（受限重复替代 cron）见 `memory-bank/progress.md`。

## CLI
`node scripts/dsh-calendar.js status|mount|unmount [--profile P]`

## 日历 Tool（M7）
`calendar_task`：对话中 LLM 可直接建/查/改/删任务、管理子任务、设置每日/每周重复或一次到时、钉执行钉子或触发真实 run，与日历视图共享同一 authoritative ledger（HostLedger.apply，request-id 幂等）。依赖 `@deepseek-ai/dsh-tools`。
