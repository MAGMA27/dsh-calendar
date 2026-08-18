# dsh-calender

一个可热插拔的 DeepSeek Harness (DSH) Web GUI 日历待办插件：侧边栏「日历」入口 → 中间列日历视图；**拖选时间段**建任务；**艾森豪威尔紧急/重要矩阵**；**子任务**；任务可**钉住执行会话与 LLM provider**；**定时让 LLM 响应**（Host 权威调度，浏览器关闭仍生效）。

> 开发中。文档见 `docs/development-plan.md`（计划）与 `docs/DESIGN.md`（设计规范）。

## 功能

- 周视图时间网格**拖选/点击**创建任务，块可移动/拉伸。
- 紧急/重要三级 → 四象限配色；矩阵面板象限拖拽改优先级。
- 主任务挂子任务（进度汇总）。
- 任务钉住执行目标：工作区、执行会话（新建/复用）、LLM provider+model、agent 预设、权限；执行前应用、失败即关闭。
- **Host cron 定时执行**：绝对时间或 5 段 cron；到点经真实 dsh 会话运行并结算；浏览器关闭仍生效；Host 重启按会话现状对账。
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
