# dsh-calender 进度（Progress）

## 当前状态
- **阶段**：**M0 脚手架已完成并通过验收**（typecheck/build/test/挂载四项全绿）。进入 **M1 领域 + Host 骨架**。
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

## 已确认决策
- 架构：**Host 权威**（账本/cron/执行结算在 Host，浏览器为同源异步视图）。
- 命名：包 `dsh-calender`、行 id `ui-calender`、命名空间 `calender`、账本 `$DSH_HOME/calender/ledger-v1.json`、DOM `data-dsh-calender-*`、面板事件 `calender`。

## 里程碑进度
| 里程碑 | 状态 |
|---|---|
| M0 脚手架 | ✅ 完成（验收通过，已提交） |
| M1 领域+Host 骨架 | 进行中（下一项）：core(tasks/calendar/schedule/store) + protocol + host-ledger + host-routes(state/action) + host-service 空转 + dsh-home |
| M2 日历 UI | 未开始 |
| M3 任务编辑 | 未开始 |
| M4 真实执行 | 未开始 |
| M5 定时调度 | 未开始 |
| M6 完善 | 未开始 |

## 下一步（M1）
1. core：tasks.ts（任务模型+状态机+艾森豪威尔+子任务）、calendar.ts（网格数学+拖选）、schedule.ts（cron）、store.ts（账本解析）。
2. protocol.ts（action/snapshot 判别联合）。
3. host-ledger.ts（原子+锁+幂等）、dsh-home.ts、host-routes.ts（state/action）、host-service.ts 空转。
4. 单测：calendar/schedule/tasks/store；host-ledger 原子/损坏/幂等。
5. 验收：core 单测通过 + state 冒烟 + git 提交 M1。
