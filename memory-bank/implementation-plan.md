# dsh-calender 实施计划（Implementation Plan）

> 状态：已批准。正式交付版见 `docs/development-plan.md`。本文件为执行进度与里程碑的持久记忆。

## 验收标准（成功定义）
1. `dsh plugin --profile web add link:<本目录>` 挂载后重启 GUI，侧边栏出现「日历」入口，点击后中间列显示日历视图；卸载恢复原状。
2. 周视图拖选时间段 → 新建任务预填起止；点空白格快捷新建；拖动/拉伸任务块改时间。
3. 紧急/重要三级 + 矩阵四象限 + 象限拖拽改优先级。
4. 主任务挂子任务（勾选完成、进度汇总）。
5. 任务钉住工作区/会话/provider+model/预设/权限；执行前应用，失败即关闭（不发 Prompt）。
6. Host cron 定时真实执行并结算，浏览器关闭仍生效；Host 重启按会话现状对账。
7. 设计符合 `docs/DESIGN.md`，随 `--dsw-*` token 自适应深浅/皮肤。
8. `pnpm typecheck && pnpm test && pnpm build` 通过；`--dump-config` 出现插件层；GUI 人工验证通过。

## 里程碑

### M0 脚手架
package.json（双面包 + dsh.bundle.patch + dsh.client）、tsconfig.json/tsconfig.build.json、tsdown.config.ts、build/tsdown.client.ts + build/web-platform.ts（官方预设）、cordis.patch.yml、src/invariant.ts、空 host+client apply、css-modules.d.ts、.gitignore、README 骨架。
**验收**：`pnpm install && pnpm typecheck && pnpm build` 通过；产物 `lib/index.js`+`lib/client.js` 存在；挂载到 scratch profile 后 `--dump-config` 出现 `ui-calender`。

### M1 领域 + Host 骨架
core（tasks/calendar/schedule/store）、protocol、host-ledger（原子+锁+幂等）、host-routes（state/action）、host-service 空转、dsh-home。
**验收**：core 单测通过；API 冒烟（curl state 空账本）；账本原子/损坏/幂等测试通过。

### M2 日历 UI
WeekGrid（拖选/移动/拉伸/现在线）、MonthGrid、client host-api transport、sidebar-entry、calendar-mount、CalendarView。
**验收**：GUI 手测拖选建任务；jsdom DOM 挂载测试。

### M3 任务编辑
CreateTaskModal、TaskDetailPanel、MatrixPanel（象限拖拽）、AgendaPanel、ExecutionSettings。
**验收**：GUI 手测全表单与矩阵拖拽；tasks 状态机测试。

### M4 真实执行
host-runner（会话/LLM provider/预设/权限 钉子 + 结算）、执行记录、会话跳转、provider 徽标。
**验收**：host-runner fake ApiProxy 测试（会话选择/失败关闭/结算）。

### M5 定时调度
Host cron + 到期触发 + 重启对账 + SSE 广播 + v1 迁移。
**验收**：host-service 测试（tick/滚动/跳过/对账）；真机定时触发一次。

### M6 完善
设置卡、SystemPrompt 段、设计打磨、全量测试、docs/DESIGN.md、README、scripts/dsh-calender.js。
**验收**：全量验证矩阵通过；文档齐备。

### M7（新增，用户提出）日历 Tool 集成
把日历暴露为供对话中 LLM 直接调用的 **tool**：通过 dsh 的 tool/命令机制，让 agent 在对话里「创建 / 删除 / 修改 / 查询」任务（含子任务与执行钉子）。浏览器半边复用现有 action 协议，Host 半边把 tool 调用映射到同一 HostLedger.apply，保证与 UI 同一份账本与幂等。
**验收**：对话中 LLM（或用户发指令）能创建/改/删/查任务，且变动即时反映到日历视图；与 UI 操作共享账本与幂等；tool schema 齐全、文档化。

## 验证矩阵
- 单元：calendar/schedule/tasks/store（纯函数）
- Host：host-ledger（串行/原子/锁/幂等/损坏）、protocol（校验/载荷）、host-service（tick/滚动/跳过/对账）、host-runner（fake ApiProxy）
- Client（jsdom）：host-api、apply-guard、sidebar-entry-dom-guard、center-column-css
- 真实组合：scratch profile add → `--dump-config`；headless 冒烟；GUI 人工清单
- 基线：`pnpm typecheck && pnpm build && pnpm test`

## 执行纪律（用户要求）
- **严格按计划执行、每步测试、验收后才进入下一里程碑**
- **每个里程碑用 git 管理**：`feature/<m>` 分支或 main 直接提交；Conventional Commits；里程碑完成附带测试通过记录
- **小模块可委派 subagent 开发**（独立、自包含、给出契约与验收标准的任务）
