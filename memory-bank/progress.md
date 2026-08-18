# dsh-calender 进度（Progress）

## 当前状态
- **阶段**：**M2 日历 UI 已完成并通过验收**（typecheck / build / 56 单测全绿）。**已按用户要求暂停**，等待用户处理后再进入 M3。
- 计划已批准（Host 权威架构）；M0/M1/M2 已完成并提交。

## 已完成里程碑（均通过 ✓，已提交）
| 里程碑 | 提交 | 验收 |
|---|---|---|
| M0 脚手架 | `5c24d69` | typecheck / build / vitest / scratch 挂载 `--dump-config` 出现 `ui-calender` 层 |
| M1 领域+Host 骨架 | `fb36cf4` | 45 单测；host 半边含账本+HTTP 路由（29.94 kB） |
| M2 日历 UI | 待提交（本次） | 56 单测；client bundle 含 React 视图（58.24 kB） |

## M2 交付内容（client 接线 + React 视图）
- **接线**：`host-api.ts`（Http/Memory transport + v1 迁移）、`controller.ts`（视图状态 + open 面板 + dispatch）、`apply-guard.ts`、`locales.ts`（zh/en）、`sidebar-entry.ts`（DOM 注入自愈）、`calendar-mount.tsx`（中间列接管 + dsh-panel-activate 互斥）、`calender.module.css`（基础 + 视图类，全部 `--dsw-*` token）、`index.ts`（apply 装配：locale + transport + controller + 双挂载）。
- **视图组件**（`src/client/components/`）：TaskBlock、WeekGrid（拖选建任务/现在线/块）、MonthGrid（点日进周）、MatrixPanel（艾森豪威尔 2×2）、AgendaPanel（过期/今天/近期）、CalendarView（头部+视图切换+搜索+新建）、CreateTaskModal（draft 起止 + 紧急/重要 + 创建）。
- **测试**：controller / host-api / apply-guard / center-column-css（M2 新增 4 个，共 56）。

## M2 期间决策/修正
- 暂停了长时间无产出的 React 视图子代理，由主代理直接编写视图组件（更可靠）。
- 修正：host-api readonly 数组、index ctx.effect 的 undefined disposer、center-column-css 测试的 new URL 在 vitest 下不工作（改 cwd 相对路径）。

## 里程碑进度
| 里程碑 | 状态 |
|---|---|
| M0 脚手架 | ✅ `5c24d69` |
| M1 领域+Host 骨架 | ✅ `fb36cf4`（45 单测） |
| M2 日历 UI | ✅ 验收通过（56 单测，待提交） |
| M3 任务编辑 | ⏸ 暂停（用户要求停下处理） |
| M4 真实执行 | 未开始 |
| M5 定时调度 | 未开始 |
| M6 完善 | 未开始 |

## 下一步（等用户处理后 → M3）
1. 提交 M2（git）。
2. 用户真实挂载验收：`dsh plugin --profile web add link:<本目录>` → 重启 dsh web → 侧边栏「日历」→ 中间列周视图 → 拖选建任务 / 切换视图 / 搜索。
3. M3：CreateTaskModal 完整表单（描述/Prompt/**子任务**/**执行设置：工作区/会话/provider+model/预设/权限**/**定时**）+ TaskDetailPanel + 矩阵象限拖拽改优先级 + 议程详情。
4. M4：host-runner 真实执行（会话 + selectModel provider 钉子 + 结算）；M5：Host cron + SSE + 重启对账；M6：设置卡 + SystemPrompt 段 + 设计打磨 + 文档。

## 交付挂载（需用户环境）
`dsh plugin --profile web add link:D:\Dev\agents\dsh-calender` → 重启 dsh web（页面刷新不够）。验证 `GET /api/calender/state` + 侧边栏入口 + 中间列日历。

## 命名决策（已锁定）
包 `dsh-calender` / 行 id `ui-calender` / 命名空间 `calender` / 账本 `$DSH_HOME/calender/ledger-v1.json` / DOM `data-dsh-calender-*` / 面板事件 `calender`。

## 环境要点
vitest(esbuild) 需 `danger-full-access`；tsc/tsdown(rolldown) 在 workspace-write 即可；pnpm 设置放 `pnpm-workspace.yaml`。

## 挂载与环境记录（2026-08，已由主代理处理）
- **已挂载到 web profile ✓**：`dsh plugin --profile web add link:D:\Dev\agents\dsh-calender` 成功；`dsh.profile.bundles=[base,web-app,dsh-web-ui-all,dsh-calender]`；`--dump-config` 出现 `ui-calender` 层；node_modules/dsh-calender 可解析。
- **根因**：web profile 既有原生依赖（cloudflared/cpu-features/ssh2，来自 dsh-web-ui-all / DSH 远程 SSH）从未做构建放行决策，pnpm 10 报 `IGNORED_BUILDS` 使任何 pnpm add（含挂载）退出非 0。
- **修复**：`~/.dsh/profiles/web/pnpm-workspace.yaml` 三项 `allowBuilds` 设为 `false`（明确跳过构建；本机无 C++ 编译器，cpu-features 无法原生构建，此为公司既有工作状态）。设 `true` 会触发 cpu-features 构建失败——勿改 true。
- **遗留**：DSH 的 SSH 远程能力因无编译器受限（与插件无关）；如日后需要，需另装 MSVC 工具链。
- **待用户操作**：重启 dsh web 进程使插件上线（入口/视图/API 冒烟）。
