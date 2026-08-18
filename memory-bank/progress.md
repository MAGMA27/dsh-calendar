# dsh-calender 进度（Progress）

## 当前状态
- **阶段**：**M1 领域 + Host 骨架已完成并通过验收**（typecheck/build/test 全绿，42→45 单测）。进入 **M2 日历 UI**。
- 计划已批准（Host 权威架构）；文档已落盘（AGENTS.md + memory-bank + docs/DESIGN.md + docs/development-plan.md）。

## M0 验收结果（通过 ✓）
- `pnpm typecheck` ✓（tsc --noEmit）
- `pnpm build` ✓ → `lib/index.js`（ESM node 面）+ `lib/client.js`（browser bundle，`window.__ModuleLoader__.load({id:"dsh-calender"})`）+ `lib/types/*.d.ts`
- `pnpm test` ✓（vitest 运行，暂无线索测试，passWithNoTests）
- 挂载验收 ✓：scratch profile（`dsh plugin --profile calender-scratch add link:<本目录>`）后 `dsh --profile calender-scratch --dump-config` 显示 `# == dsh-calender` 层 + `id: ui-calender, name: dsh-calender`；scratch profile 已删除。

### M0 关键文件
- package.json（双面包 + `dsh.bundle.patch` + `dsh.client`）、cordis.patch.yml（`insert: ui-calender`）
- tsconfig.json / tsconfig.build.json（declaration → lib/types）
- tsdown.config.ts（`clientBundle`）+ build/tsdown.client.ts（官方预设，修了一处单引号转义 bug）+ build/web-platform.ts（PLATFORM_MODULES）
- src/index.ts（空 host apply）、src/client/index.ts（空 client apply）、src/invariant.ts、src/client/css-modules.d.ts
- vitest.config.ts、pnpm-workspace.yaml（allowBuilds.esbuild: false）、.gitignore、README.md

### M0 环境要点（后续沿用）
- 沙箱限制：`pnpm run` / vitest(esbuild) 需 `danger-full-access` 才能真正执行（esbuild 需 spawn 原生进程，workspace-write 下 EPERM）；tsc/tsdown(rolldown) 在 workspace-write 即可。
- build 中 `external` /`noExternal` 有 deprecation（新版 tsdown 用 `deps.neverBundle`/`deps.alwaysBundle`）——暂不处理。
- pnpm 设置放在 `pnpm-workspace.yaml`（新版不读 package.json 的 `pnpm.` 字段）。

## M1 验收结果（通过 ✓）
- `pnpm typecheck` ✓；`pnpm build` ✓（host 半边 29.94 kB 已含账本+路由；client 0.58 kB 待 M2）
- `pnpm test` ✓ **45/45**：tasks(12) calendar(11) schedule(7) store(5) host-ledger(7，幂等/分发/持久化) host-routes(3，GET state 空账本 + POST action + 400)
- M1 期间修正的真实 bug：startOfWeek 周起始编码、snapFloor/Ceil 非法吸附默认 30、normalizeDrag 端点语义（双 floor+扩展）、store 逐条修复坏 execution 而非丢弃整行。

### M1 文件
- src/core/tasks.ts（任务模型+状态机+艾森豪威尔+子任务+执行迁移，纯函数）
- src/core/calendar.ts（周/月网格数学 + 拖选吸附）、src/core/schedule.ts（cron+nextRun）、src/core/store.ts（账本解析/修复）
- src/protocol.ts（action/snapshot 判别联合 + 幂等信封）
- src/host-ledger.ts（原子 file persist + requestId 幂等 + action 分发 + 锁）、src/dsh-home.ts、src/host-routes.ts（state/action/events）、src/host-service.ts、src/index.ts（装配 + webServer 挂载）

## 已确认决策
- 架构：**Host 权威**（账本/cron/执行结算在 Host，浏览器为同源异步视图）。
- 命名：包 `dsh-calender`、行 id `ui-calender`、命名空间 `calender`、账本 `$DSH_HOME/calender/ledger-v1.json`、DOM `data-dsh-calender-*`、面板事件 `calender`。

## 里程碑进度
| 里程碑 | 状态 |
|---|---|
| M0 脚手架 | ✅ 完成（验收通过，已提交） |
| M1 领域+Host 骨架 | ✅ 完成（验收通过，待提交） |
| M2 日历 UI | 进行中（下一项）：WeekGrid 拖选/移动/拉伸 + MonthGrid + client host-api transport + sidebar-entry + calendar-mount + CalendarView |
| M3 任务编辑 | 未开始 |
| M4 真实执行 | 未开始 |
| M5 定时调度 | 未开始 |
| M6 完善 | 未开始 |

## 下一步（M2）
1. client host-api.ts（HTTP transport：state/action/bootstrap v1 迁移）。
2. sidebar-entry.ts（DOM 注入侧边栏入口，MutationObserver 自愈）+ calendar-mount.tsx（中间列接管 + dsh-panel-activate 互斥）。
3. 视图：CalendarView + WeekGrid（拖选建任务/块/现在线）+ MonthGrid。
4. 设置卡接线 + locales。
5. 验收：GUI 挂载后拖选建任务（依赖真实 web 挂载）+ jsdom DOM 测试 + core 复用。
