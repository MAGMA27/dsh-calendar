# dsh-calendar 进度（Progress）

> ✏️ **2026 重命名记录**：包名/代码/文档统一由 `dsh-calender` 更正为 `dsh-calendar`（commit `970d53b`，51 文件）。仓库文件夹同步迁移到 **`D:\Dev\agents\dsh-calendar`（本份 memory-bank 即新目录内容，新会话请以它为工作区）**；旧 `dsh-calender` 目录因会话占用无法原位删除，会话结束后手动清除即可。账本数据已从 `~/.dsh/calender` 复制到 `~/.dsh/calendar`；profile 已卸载 `dsh-calender` 并重新挂载 `dsh-calendar`（`ui-calendar`），重启 dsh web 生效。localStorage 旧键 `dsh.calender.*` 已废弃（不触发重复导入）。

## 当前状态
- **阶段**：**M0–M7 全部完成并通过测试**，经历 9 轮验收反馈与 M4–M7（真实执行 / Host 定时调度 / 完善 / 日历 Tool）及 M7 后多轮 UI 迭代与分支 `feature/calendar-slot-view` 修复落地；**183 单测全绿**（24 文件）。**定时模型已从自由 cron 重构为「受限重复规则（每日/每周 + 跳过节假日，物化副本 + 模板同步 + 可选触发 Agent）+ 一次性到时」**（见文末三节）。
- 计划已批准（Host 权威架构）。
- 📋 **验收清单见 [acceptance-checklist.md](memory-bank/acceptance-checklist.md)**：基线 / 挂载 / M0–M7 逐项 GUI 与 Host·工具行为验收。

## 已完成里程碑（均通过 ✓，已提交）
| 里程碑 | 提交 | 验收 |
|---|---|---|
| M0 脚手架 | `5c24d69` | typecheck / build / vitest / scratch 挂载 `--dump-config` 出现 `ui-calendar` 层 |
| M1 领域+Host 骨架 | `fb36cf4` | 45 单测；host 半边含账本+HTTP 路由 |
| M2 日历 UI | `83e1599` | 56 单测；日历周/月/矩阵/议程 + 拖选建任务 |
| M2 加载中修复 | `213a43b` | CalendarView 改用 useSyncExternalStore 订阅控制器（离开 loading）；新增回归测试 |
| 文档对齐 | `08342cb` | DESIGN/设计文档补齐 M3 界面设计；进度记录挂载与环境 |

## M3 交付内容（任务编辑）
- **CreateTaskModal 全表单**：标题 / 起止 / 描述 / Prompt / 紧急·重要 / 子任务（回车添加）/ 定时（cron + 一次到时）/ 执行设置。
- **TaskDetailPanel（右侧 320px 详情面板）**：标题编辑 + 完成切换、象限 knobs、描述/Prompt 编辑、**子任务 checklist**（添加/勾选/删除 + 进度）、**定时**（cron/dueAt + 下次运行显示）、**执行设置**（工作区/会话/provider/model/预设/权限）、**执行记录**列表、立即执行 / 保存 / 归档恢复 / 删除。
- **ExecutionSettings 复用组件**：CreateTaskModal 与 TaskDetailPanel 共用。
- **MatrixPanel 象限拖拽**：把任务从一象限拖到另一象限即改紧急/重要。
- **AgendaPanel**：显示子任务进度 + 定时徽标。
- **CalendarView**：选中任务时右侧展开 TaskDetailPanel。

## M3 期间决策/修正
- 域模型 `TaskRecord`/协议在 M1 已内建子任务/执行记录/定时/执行钉子字段，M3 只补齐 UI 并接线。
- 修复：CalendarView 一次性 getSnapshot 导致永不重渲染（卡加载中）——改用 `useSyncExternalStore` 订阅（`213a43b`）。
- 新增 `tests/setup.ts` 设 `IS_REACT_ACT_ENVIRONMENT`，去除组件测试 act 环境告警。

## 里程碑进度
| 里程碑 | 状态 |
|---|---|
| M0 脚手架 | ✅ `5c24d69` |
| M1 领域+Host 骨架 | ✅ `fb36cf4`（45 单测） |
| M2 日历 UI | ✅ `83e1599` + `213a43b` + 表头/重叠并排（`a1c7cc3`） |
| M3 任务编辑 | ✅ 含 9 轮验收修复（全表单/详情/子任务/执行设置下拉/会话标题/归档/定时清除/象限拖拽） |
| M4 真实执行 | ✅ `d3f8660`（host-runner 真实执行 + 执行记录回写 + 会话跳转 + provider/运行徽标；92 单测） |
| M5 定时调度 | ✅ `660b6f5`（Host cron 到期触发 + 只接受后滚动 + 重启对账 + SSE 广播；105 单测）——**2026 起 cron 已被「受限重复+一次性」模型替换**，见文末 |
| M6 完善 | ✅ `61f6f28`（设置卡 calendar 命名空间 + SystemPrompt 段（可开关）+ scripts/dsh-calendar.js CLI + 文档；105 单测） |
| M7 日历 Tool | ✅ `15a5a6d`（`calendar_task` tool：建/查/改/删/子任务/执行钉子/run，经同一 HostLedger.apply；113 单测） |

## M4 交付内容（真实执行）
- **host-runner.ts**：打开执行记录 → 建/复用会话 → 应用钉子（provider+model 经 `sessions.selectModel`、agent 预设经 `agentPresets.select`、权限经 `/permission` 斜杠命令——**后改为经命令注册表 `ctx.commands.execute` 执行**，见文末「权限钉子改走命令注册表」节；早期用 `sessions.prompt` 发命令行的做法已废弃，那会把 `/permission` 当普通消息发给模型）→ rename → prompt('queue') → 结算执行记录。依赖注入的窄 ApiProxy face，测试用 fake 驱动。
- **HostLedger** 新增 `openExecution`/`settleExecution`/`taskById`：运行中拒开第二条、结算附带会话 id、写回账本并通知浏览器；`run` action 现在要求任务存在。
- **路由接线**：`POST /action` 遇到 `kind:'run'` 把任务交给 HostExecutionRunner（fire-and-forget，结算异步）。
- **结算策略**：轮询 `sessions.list`；会话消失→cancelled、停止且带 prompt 证据→succeeded、超时→cancelled。
- **UI**：任务块 **运行徽标**（有未结算执行时）+ provider/model 徽标（已有）；执行记录显示 **「打开会话」跳转**（`ctx.sessions.open`，客户端 `inject` 增加 `sessions`）。
- **测试**：host-runner.spec（10）、host-ledger 执行记录、host-routes run→runner 接线；**92 单测全绿**（原 76 + 16）。

## M5 交付内容（Host 定时调度；当时为 cron 模型，2026 已替换为受限重复规则——见文末）
- **host-scheduler.ts（HostScheduleService）**：tick 扫描账本里 enabled 且 `nextRunAt<=now` 的调度 → 交给 host-runner 触发真实执行 → **只在 run 被接受后**才 `advanceSchedule` 滚动到下一 cron 匹配点（被拒绝=已在运行=保留下一个到期槽，下个 tick 重试，绝不漏跑）。错过不补、`enabled=false` 暂停、单次 dueAt 触发后结束。
- **HostLedger.advanceSchedule**：滚动 nextRunAt/lastTriggeredAt 并写回账本 + 通知。
- **重启对账**：`runner.reconcile(taskId)`（会话消失→cancelled / 停止且有 prompt 证据→succeeded / 仍在 run→保留）+ `scheduler.reconcileAll()` 在 start 时对被遗留为 running 的执行结算。
- **SSE 广播**：`/events` 经 `ledger.subscribe` 在账本变更（动作/定时触发/执行结算/滚动）时推送 `{revision, ledgerId}`，浏览器 EventSource 收到即重拉 /state。
- **runner.run 重构**：返回 `{accepted, settleFinished?}`，不阻塞结算（HTTP 路由与调度器 fire-and-forget），可 await settleFinished 观察。
- **测试**：host-scheduler.spec（6）+ host-reconcile.spec（4）+ host-routes SSE（1）+ host-ledger advanceSchedule（2）；**105 单测全绿**（原 92 + 13）。

## M6 交付内容（完善）
- **设置卡**：Host 经 `installSettingsSection(ctx, settingsNamespace('calendar'), Config, ...)` 注册 `calendar` 设置命名空间（`announceToAgent`/`enabled` 两个布尔，schema 由 schemastery 定义），在 web 设置「插件」区呈现可编辑表单。
- **SystemPrompt 段**：`ctx.systemPrompt.section('plugin:calendar', order 160)` 向每个 agent 宣告日历能力；受设置开关实时门控（关 `announceToAgent`/`enabled` 即撤销段，无需重启）。参考 task-board 的 installSettingsSection + sync 模式。
- **CLI `scripts/dsh-calendar.js`**：`status` / `mount` / `unmount`（`--profile`），只依赖 Node stdlib；mount 用 `dsh plugin add link:<dir>`。
- **host `apply(ctx, config?)` + Config schema**；文档（DESIGN/README/进度）补齐。
- **验证**：typecheck + build + 105 单测全绿。

## M7 交付内容（日历 Tool）
- **`src/host-tool.ts`（defineCalendarTool → `calendar_task`）**：单一 model-callable tool，action 枚举覆盖 create / get / list / update / setQuadrant / setDone / addSubtask / setSubtaskDone / removeSubtask / setSchedule / delete / archive / restore / run；参数 schema（defineTool 的 ValueSchemaSpec）含标题/描述/Prompt/起止/紧急·重要/执行钉子（workspace/session/provider/model/mode/permission）/子任务/cron/dueAt。
- **同账本同幂等**：每个动作以 minted requestId 映射到**同一 HostLedger.apply**（与浏览器 share 同一 authoritative ledger + request-id 幂等）；读走 snapshot；`run` 委托给 host-runner。defineTool 对 enum/必填做参数校验（非法 action 在 execute 前拒绝）。
- **注册**：host index `ctx.tools.register(...)`（inject 增加 `tools`），`apply` 里接线并 dispose。
- **依赖**：追加 devDep `@deepseek-ai/dsh-tools@0.1.0-rc.6`（host 侧 bundle）。
- **测试**：host-tool.spec（8）覆盖建/查/列/改/象限/完成/子任务/定时/归档恢复删除/run/非法输入；**113 单测全绿**（原 105 + 8）。

## 重命名与近期修复（M7 之后）
- **拼写重命名（commit `970d53b`）**：包/代码/文档 `dsh-calender` → `dsh-calendar`（51 文件：`calender.module.css`→`calendar.module.css`、`scripts/dsh-calender.js`→`dsh-calendar.js`、`ui-calender`→`ui-calendar`、`/api/calender/*`→`/api/calendar/*`、账本 `$DSH_HOME/calendar/ledger-v1.json`、localStorage `dsh.calendar.*`）。
- **导航说明（重要）**：**新会话请以 `D:\Dev\agents\dsh-calendar` 为工作区**。旧目录 `D:\Dev\agents\dsh-calender` 只是被会话占用的残留，可待会话结束后删除。
- **pnpm 离线 store**：缓存留在旧目录 `D:\Dev\agents\dsh-calender\.pnpm-store\v11`；新目录 `pnpm install --store-dir <旧store路径>` 可离线复用。删除旧目录后如需离线，把该 store 复制到新目录 `.pnpm-store\v11`。
- **M7 之后的 UI 迭代提交表**：
  | commit | 内容 |
  |---|---|
  | `8fa7323` | 验收清单录入 memory-bank |
  | `d2d6c98` | 周视图任务块显示时间段 + 网格加深 |
  | `e8c90d5` | 时间放右上角与标题并排、标题优先保留 |
  | `a596cd9` | 可折叠「显示时段」（隐藏睡眠/空闲） |
  | `7a1f690` | 窗口拉伸铺满网格 + 支持跨午夜时段（start>end） |
  | `016b13b` | 矩阵「立即做」改红色 |
  | `1344061` | 矩阵/议程任务卡片丰富化（时间/徽标/进度条/描述摘要） |
  | `d687fa9` | 阴影加深 + 议程分组卡片化现代化表头 |
  | `970d53b` | 拼写重命名 dsh-calender→dsh-calendar |
  | `a27729b` | 重命名记录（docs） |
  | `5966aac` | 月视图任务条补全边框；周视图拖拽保留抓取偏移（跟手） |
- **基线（当时计数）**：`pnpm typecheck` ✅ / `pnpm build` ✅ / **122 单测全绿**（20 个测试文件）。

## 客户端挂载重构（2026-08 后期 · 分支 `feature/calendar-slot-view`）

**问题背景**：原版把日历覆盖层用 `createRoot` + `appendChild` 注入到 React 托管的中间列（`[class*="centerCol"]`）。在 dsh-client rc.6 依赖下该容器频繁「创建→被 shell 重渲染拆走→不重建」，表现为 `view: MISSING` / 整列空白，多轮自愈（`isConnected` + 1s interval + observer）都未能根治。

**本次根因与动作（结论）**：
- 先在分支 `feature/calendar-slot-view` 上把 **client 依赖从 rc.6 对齐到 rc.7**（`@deepseek-ai/dsh-client-*@0.1.0-rc.7`，并补 `dsh-client-ui-conversation` 进 `dsh.client.inject`）——rc.6↔rc.7 不兼容是早期「覆盖层挂不住」的重要嫌疑。
- **放弃对中间列的 DOM 注入**，改走 DSH「官方 Slot」机制（和会话页同源、shell 托管生命周期、稳定）：
  - **面板**：注册进 **`shell.overlay`**（root 级帧层槽位，`replaceRisk:none`）渲染 `CalendarView`；根级 → **无需打开会话即可进日历**（解决前一轮「两个入口都要开会话」的问题）。
  - **入口**：注册进 **`sidebar.footer.action`**（root 级，左下角 Settings 旁）——这是侧边栏唯一的 root 级 additive 槽位，**左上角无 additive 槽位**（`sidebar.workspaces` 单占位），想放左上角只能回到不稳定的 DOM 注入。
  - 覆盖层通过动态测量侧边栏右缘（`ResizeObserver` + resize）**收窄到侧栏右侧**，保留侧栏可见可点（「任务看板」观感）。
  - 入口样式对齐 Settings：展开态「图标 + 日历」、折叠 rail 态按 `[data-dsh-frame][data-sidebar-collapsed]` 收成纯图标。
  - 渲染链：`CalendarEntry`（footer 入口）→ 根级 `root-open.ts` 开关 store → `CalendarOverlay`（shell.overlay 占用组件）→ `<CalendarView>`。

**新增/删除文件**：新增 `src/client/root-open.ts`、`calendar-overlay.tsx`、`calendar-entry.tsx`；删除 `sidebar-entry.ts`、`calendar-mount.tsx`、`calendar-view-slot.tsx`。
**验证**：`pnpm typecheck` ✅ / `pnpm build` ✅ / **122 单测全绿**（20 文件，当时计数）。git：分支 `feature/calendar-slot-view`，提交 `9e16259`(slot 注册)→`4656bc1`(覆盖层)→`ec405a2`(shell.overlay+footer entry)→`432b04f`(收窄到侧栏右缘)→`6064953`/`ec38796`(入口样式对齐 Settings)。
**基线（当时计数）**：`pnpm typecheck` ✅ / `pnpm build` ✅ / **122 单测全绿**（20 个测试文件）。

## 入口与跳转的后续打磨（分支 `feature/calendar-slot-view` 尾段）
- **入口样式 1:1 对齐 Settings 触发按钮（commit `27b6db4`）**：从 ui-settings-general `SettingsRoot.module.css` 挖出 Settings 按钮的确切配方并复刻——宽栏为通栏 42px 行（`width:calc(100%+4px)`、`height:42px`、`margin:4px -2px`、`padding:0 10px 0 8px`、`border-radius:12px`、主文字色 `label-primary`、14px/行高22、hover `interactive-bg-hover`）；收窄为 36×36 圆形（半径 50%、`margin:8px 0 10px`、无文字）。图标由 hand-rolled SVG 跟随 16px(宽)/18px(rail)，描边风格同 Settings。**rail 判定改用 `wide` prop**（`sidebar.footer.action` slot 由 SidebarRoot 以 `{ wide }` 传入），不再依赖 `[data-sidebar-collapsed]` CSS 属性。改动：`calendar-entry.tsx`（改用 wide prop + rail 圆钮）、`calendar.module.css`（`.entry` 复刻 `.trigger` 配方、删除旧 rail 规则）。
- **跳转会话自动关闭日历覆盖层（commit `8d520ef`）**：日历页内「打开会话」（TaskDetailPanel 执行记录按钮 → `onOpenSession` → index.ts `openSession`）原只 `ctx.sessions.open`，覆盖层仍盖在上面。现在 `openSession` 先 `setCalendarOpen(false)` 关闭 `shell.overlay` 日历，再跳转会话，点击会话即回到对话界面。改动：`src/client/index.ts`（引入 `setCalendarOpen`）。
- **侧边栏点会话自动关日历（commit `139c42f`，用户复述真意图后补充）**：用户真正想要的是——日历打开时，点侧边栏工作区里的会话（或新建会话）应关掉日历让会话页可见。实现：新增纯函数 `src/client/navigation-watch.ts`（`watchSessionNavigation`），在 client `apply` 里订阅 `ctx.sessions.list`（快照 store 的 `current` 即当前会话，`open()`→`manager.select` 会更新并通知）；当日历开着且 `current` 变化 → `setCalendarOpen(false)`。基线在每次日历「关→开」时重种，所以打开时若已在某会话不会立即误关。`sessions.open` 需 branded `SessionId`，执行记录的 string 用 `as SessionId` 收窄。新增 `tests/navigation-watch.spec.ts`（6 用例）。
- **点「当前会话」也关日历（commit `51ca679`）**：用户复测反馈——日历开着时点侧边栏里**已经在看的那个会话**，日历不关。原因：`manager.select` 对同 id 也无条件 notify，但 `list.current` 不变，watcher 无法与后台更新（jobs/rename）区分。修复：`navigation-watch.ts` 新增 `closeOnSessionOpen`——包装共享的 `ctx.sessions.open`（侧边栏点击/fork/workflow 子会话全部经它），任何 open 调用（含点当前会话）都先关日历，dispose 还原原方法；`watchSessionNavigation` 保留以覆盖 `clear()` 等 current 变化路径。测试增至 9 用例（新增点当前会话/还原/链式 3 个）。
- **验证**：`pnpm typecheck` ✅ / `pnpm build` ✅ / **131 单测全绿**（21 文件）。

## 日历视图功能增强（commit `c5ec7b1`）
用户三项反馈一并落地：
1. **搜索栏先做可用、后移除（commit `c5ec7b1` 加入 → `28a99cc` 移除）**：用户反馈原 `query` state 只存不用。先实现 `taskMatchesQuery`（`src/core/tasks.ts`，大小写不敏感匹配 title/description/prompt）并接到四视图；用户复测认为搜索栏没啥用 → **整体移除**：删 `query` state/input、各视图 `query` prop、`taskMatchesQuery` 及其 3 个测试、`.search` CSS、`board.search` locale 键。当前搜索栏不存在。
2. **周/月日期导航**：原来只有「今天」按钮，无上一/下一期。新增 `DateNav` 组件（`CalendarView.tsx`）：`‹ 期标签 › + 今天`。core 新增 `addDays/addMonths/sameMonth/monthLabel/weekRangeLabel`（`src/core/calendar.ts`）——addMonths 按目标月天数钳制日（1月31日+1月→2月28/29）；周视图步进 ±7 天、月视图 ±1 月；标签带年份（如「2024年1月15日 – 1月21日」「2024年1月」）。`DateNav` 含 `aria-live` 标签。
3. **月视图信息补全 + 区分相邻月**：原月视图无周几表头、无月份信息、上月/本月无区分。重构 `MonthGrid.tsx`：顶部 sticky 周几表头（随 weekStart 周一起始）、`sameMonth` 判当前月、相邻月单元格 `data-outside` 变淡（背景 `bg-layer-1`、日期 `label-tertiary`、chips 半透明）、今天仍圆形高亮；外层包 `.monthWrap`（表头 + 可滚动 `.monthGrid`）。CSS 新增 `.dateNav*`、`.monthWrap/.monthWeekHeader/.monthWeekDay`、`.monthCell[data-outside]`。
4. **月视图日期样式（commit `a003320` 系列→`78f027d`，用户复测多轮）**：色带方案反复迭代（3px 细线→胶囊→横贯整格→贴边品牌蓝）后**最终弃用**，改为干净方案：日期数字加大到 **18px/700**、**每月 1 号在数字旁标月份短名且字号与日期一致**（`monthShortLabel`，如「9月 1」；月份用 `label-secondary`、日期用 `label-primary` 区分主次）、今天数字套品牌蓝圆底白字（`--dsw-static-deepseek-500`；文档已记 token 坑：亮色下勿用 `--dsw-alias-brand-primary`，它映射近黑 bluish-1000）。改动：`MonthGrid.tsx`、`calendar.module.css`。
- **测试**：`tests/calendar.spec.ts` 新增 date navigation 组（addDays/addMonths/sameMonth/monthLabel/weekRangeLabel）；搜索匹配组已随移除删除。**137 单测全绿**（21 文件，当时计数）。
5. **矩阵标题美化（commit `017467c`→`343c1cd`，用户复测追加）**：象限标题从 13px 放大到 **18px/700**，标题行底部加 3px 象限色横条（do 红 / schedule 蓝 / delegate 琥珀 / eliminate 灰，呼应外框），计数徽标放大到 12px/22px；复测后**标题文字改回主文字色 `label-primary`（黑）**，颜色只保留在横条与边框。改动：`calendar.module.css`。

## 任务详情的预设下拉（执行设置目录补全）
- **问题**：任务详情/新建弹窗的「预设」一直是自由文本输入框，没有下拉选项——`ExecutionCatalog` 从未携带可用 agent preset 列表，只有 workspace/session/provider/model。
- **实现**：Host `/api/calendar/options` 经 ApiProxy 新增 `agentPresets.list` 读取（`src/host-options.ts`）：preset roster 投影为 `catalog.modes`（`{ id, label }`，label = 发布的 `name ?? id`；**剔除 `broken` 的 preset**——选中它只会把失败推迟到执行时）；core `ExecutionCatalog` 增加 `modes` 字段（`src/core/exec-catalog.ts`）；`ExecutionSettings` 有 modes 渲染 `<select>`（复用 `OptionSelect`），无则回退自由文本；空目录/无 roster 部署容错不变。
- **坑（修复前下拉仍为空）**：进程内 ApiProxy 域对象名是 **`agentPresets`（复数）**，而 HTTP wire 方法路径是 `agentPreset.list`（单数）——首次实现 face 用了单数 `agentPreset`，`api.agentPreset` 为 undefined，`?.` 短路 → modes 恒空。已修正为复数并在 face 注释里记录该差异。验证：直连 `POST /api/agentPreset.list`（wire 信封 `{type:'client-request',rpcId,method,payload}`）返回 4 个 preset（standard/code/minimal/cordis）。
- **测试**：`tests/host-options.spec.ts` 断言 modes 映射（name 优先、broken 排除、空 roster 为 []）；`tests/exec-settings-ui.spec.tsx` 新增预设下拉渲染+选中派发用例；`tests/exec-catalog.spec.ts` 空目录 toEqual 兼容。**138 单测全绿**（21 文件）。

## 会话目录实时刷新（启动后新建的会话要能出现在任务详情下拉里）
- **问题**：执行设置 catalog（workspaces/sessions/providers/modes）只在 client apply 时 `refreshCatalog` 拉一次；之后新建的会话不会出现在任务详情的会话下拉，直到刷新页面。
- **实现**：新增纯模块 `src/client/catalog-refresh.ts`（`watchCatalogRefresh`）——①订阅 `sessions.list` store，任何变更（新建/改名/归档）**防抖 300ms** 后重拉 `/api/calendar/options`；②日历从关→开时也重拉（覆盖 list store 不追踪的冷会话/持久化附加）。`src/client/index.ts` 经 `ctx.effect` 挂接，dispose 取消订阅与挂起计时器。已有 `refreshCatalog` 首拉保留。
- **测试**：新增 `tests/catalog-refresh.spec.ts`（5 用例：列表变更重拉、突发合并为一次、关→开触发且持续开不重复、先开后装不误触发、dispose 清理）。**143 单测全绿**（22 文件）。

## 一次定时完成后清除定时（one-shot 跑完不再残留"默认定时"）
> ⚠️ 本节描述的 cron 分支已于 2026 移除（定时模型重构），one-shot 清除语义不变。
- **问题**：一次性 dueAt 定时触发并执行后，`advanceSchedule` 只把 `nextRunAt` 置 undefined，`schedule` 规则原样保留（`enabled:true` + 过期的 `dueAt`）→ 任务块 🕐「定时」徽标、详情面板「清除定时」按钮、已过期的到时时间一直显示，看起来像还有个默认定时没清掉。
- **实现**：`src/host-ledger.ts` `advanceSchedule` 增加 one-shot 完结分支——`nextRunAt === undefined` 且任务无 cron（纯 dueAt）时**整体删除 schedule 规则**（`schedule: undefined`）并移除 `scheduler.nextRuns` 镜像；有 cron 的任务照旧滚进下一次 cron 匹配（即便同时残留过期 dueAt 也保留 cron 规则）。scheduler 侧行为不变（仍以 `undefined` 回调）。
- **测试**：`tests/host-ledger.spec.ts` 新增 2 用例——one-shot 完结后 `schedule` 为 undefined；cron+dueAt 并存时滚进 cron 且 dueAt 保留。**145 单测全绿**（22 文件）。

## 复用现有会话的执行任务修复（runner 的 agentPresets 域名 + 错误透传）
- **问题**：钉了现有会话的任务执行 fail——账本错误为 `this deployment does not support agent presets (task asks for minimal)`。根因与目录一样的命名坑：`HostExecutionEnv` face 声明的是 `presets`，而进程内 ApiProxy 域对象是 **`agentPresets`（复数）** → `env.presets` 恒 undefined → 复用会话路径（`fresh:false` 且钉了预设）直接抛错。新会话路径不受影响（预设走 `sessions.create` 的 `agentPreset` 参数），所以表现为"只能向新会话发信息"。
- **实现**：`src/host-runner.ts` face 改为 `agentPresets`（注释记录单/复数差异）；并把 create/预设/模型/权限/prompt 的拒绝错误改为**透传 ApiProxy 的 `error.message`**（如复用会话非空白时 `agent preset switch to X rejected: session ... has already started; its agent preset is fixed`），不再只有干巴巴的通用文案。fail-closed 语义不变：钉了预设的复用会话若已开聊（非 blank），预设确实无法应用 → 仍失败并说明原因。
- **测试**：`tests/host-runner.spec.ts`、`tests/host-reconcile.spec.ts` fixture 同步改 `agentPresets`（typecheck 强制）。**145 单测全绿**（22 文件）。

## 权限钉子改走命令注册表（不再把 /permission 当普通消息发给模型）
- **问题**：用户切权限后观察会话——`/permission danger-full-access` 被当作普通用户消息发给了模型，然后任务 prompt 跟上。根因：runner 之前用 `sessions.prompt(mode:'queue', '/permission …')` 应用权限钉子，但 **ApiProxy 的 prompt 路径不路由斜杠命令**（文档声称支持，本 build 未实现，`unknown-command` 错误码无人产出）——命令行原样进会话、到达模型。
- **实现**：`src/host-runner.ts` 权限钉子改为**在会话的 live Agent 上执行命令注册表**：`env.commands.execute(agent, '/permission <preset>', signal)`（`agent = env.agents.get(sessionId)`），结果 `kind:'error'` / 命令不存在 / 无命令注册表 / 无 live agent 均按 fail-closed 失败并给出明确原因；不再经 `sessions.prompt`。`src/index.ts` 用 `ctx.get('commands')/ctx.get('agents')`（**可选注入**，不阻塞 apply）接真实服务。
- **测试**：`tests/host-runner.spec.ts` 重构权限组——成功路径断言 `commands=1` 且 `prompt=1`（只有任务 prompt 进模型）；命令被拒（unknown preset）/ 未注册 / 部署无 commands / 会话无 live agent 四种失败路径。**149 单测全绿**（22 文件）。

## 受限重复规则替代 cron（2026；用户：cron 崩溃 + 权限过高 → 约束粒度）
- **问题**：自由 5 段 cron 输入被用户尝试后**直接崩溃**，且任意表达式权限过宽（如每分钟/每小时跑 LLM）。用户要求约束粒度：**每周的周几重复或每日重复 + 跳过节假日的开关**即可；设了重复要**把任务拷贝到对应的日期上**。另要求：**对任何重复副本做时间改动，必须确认「改这一个（解绑）」还是「改所有」**。
- **模型**：`src/core/tasks.ts` `ScheduleRule` 删除 `cron`，改 `repeat?: {kind:'daily'|'weekly', weekdays?, skipHolidays?}`（`materialized?: string[]` 为 Host 物化台账）；`TaskRecord` 新增 `originTaskId`（副本指回模板）。`src/core/schedule.ts`（cron 解析）**整体删除**，新增 `src/core/repeat.ts`（周几匹配 + 周末/中国法定节假日集合（2025 官方/2026 预估）+ 区间枚举 + `buildRepeatCopy`）。
- **物化（Host 权威）**：`HostLedger.materializeRepeats(now, 60天)` 在 scheduler 每个 tick 调用——对 enabled 且未归档的重复模板，从「模板日期/今天较晚者的次日」起至「今天+60天」，按规则逐日补副本；副本是**普通任务**（继承内容/执行钉子、时刻与时长取自模板、无 schedule、`done:false`）。已物化日期记入 `schedule.materialized`，**删除副本后不补回**；重复模板自身不自动执行。
- **副本时间改动确认（commit 本轮）**：周视图拖拽副本（`originTaskId` 存在）松手不再直接 `update`，而是 `controller.requestRepeatTimeEdit` 挂起 → `RepeatTimeConfirm` 弹窗——「**只改这一个并解绑**」（`update` + `originTaskId:null`）或「**改所有副本**」（新协议动作 `shiftRepeatTimes`：模板+全部仍绑定副本按同一 startDelta/endDelta 平移，未来新副本同步）。普通任务照旧直接提交。
- **级联删除**：删模板 → 连带删仍绑定副本；删单个副本只删它自己。详情面板副本显示 ↻ +「查看模板」跳转；任务块/卡片加 ↻ 徽标。
- **Host 侧**：`host-scheduler.ts` tick 改为「先触发到期一次性 dueAt（只接受后 `advanceSchedule(undefined)` 清除）→ 再 `materializeRepeats`」；`host-tool.ts` `setSchedule` 参数 cron → `repeat/kind/weekdays/skipHolidays`；`store.ts` 归一化 repeat + `originTaskId`、**旧账本 cron 规则在加载时丢弃**（清理崩溃现场）。
- **测试**：删 `schedule.spec.ts` → 新增 `repeat.spec.ts`（10）；host-ledger 物化/级联/shift/解绑（7）；host-scheduler 重写（7）；新增 `repeat-time-edit.spec.tsx`（拖拽副本→挂起→this/all 解析，3）与 `schedule-settings.spec.tsx`（模式/周几 chips/节假日开关，3）；tasks/store/host-tool 同步。**168 单测全绿**（24 文件）。

## 副本同步 / 取消定时级联删除 / 触发 Agent（2026；用户复测反馈）
- **问题**：① 用户在模板上取消定时后，已物化的 50 个副本留在账本里不消失；② 副本没有同步原任务的记录和设置（用户选定「保持同步」）；③ 问定时任务的 Agent 触发时间点。
- **实现**：
  - **取消定时/删模板 → 级联删副本**：`setSchedule repeat:null`（清除定时）连带删除仍绑定副本；删除模板亦然；删除单个副本只删它自己。账本**加载时** `pruneOrphanCopies` 清理孤儿副本（模板缺失/已无重复规则）并即时持久化——**当前账本里的 50 个孤儿副本重启后自动清掉**（模板 `test` 本身保留为普通任务）。
  - **保持同步（用户选定）**：模板的 `update`（标题/描述/Prompt/象限/全部执行钉子）→ 传播到仍绑定且未归档的副本；`setQuadrant`、`addSubtask`/`removeSubtask`（子任务结构）同传播；`setDone`/`setSubtaskDone`/时间段**永不**传播（每副本独立）。改副本只改它自己。
  - **触发 Agent**：重复规则新增 `triggerAgent` + `triggerAt`(HH:MM)——物化的每个副本带一次性 `dueAt`（默认=任务时间段开始，`triggerAt` 可覆盖），到点经现有一次性调度自动执行、跑完清除该副本调度；不勾则副本只是日历条目。ScheduleSettings/详情面板加「到点触发 Agent」开关 + 「触发时间」输入（留空=按时间段）。
  - **模板拖拽时间也走确认**：副本弹「只改这一个并解绑 / 改所有副本」；模板弹「同步所有副本（含模板）/ 只改模板（现有副本不动、未来新副本跟随）」；`shiftRepeatTimes` 泛化为系列根（副本或模板均可发起）。
- **测试**：host-ledger +7（清定时级联、加载孤儿清理、模板同步/局部化、象限与子任务结构传播、模板发起 shift、触发物化默认/覆盖）；repeat.spec +3（触发副本 dueAt、parseTriggerTime、孤儿清理）；repeat-time-edit +1（模板拖拽确认）；schedule-settings +1（触发 UI）。**179 单测全绿**（24 文件）。

## 副本定时区 = 系列定时（2026；用户：副本在定时重复上与原版不一致）
- **问题**：副本的「定时」区显示「不重复」空态（副本自身无 schedule），与原版不一致；在副本上取消重复对系列无影响。
- **实现**：
  - **详情面板**：副本（`originTaskId` 存在）的定时区改为读取**模板（系列根）的重复规则**——初始化、摘要（每日/每周+触发）、下次重复、「清除定时」按钮全部以系列规则为准；顶部加提示「定时设置作用于整个重复系列（取消即取消未来所有重复）」。
  - **账本路由**：`setSchedule` 若目标带 `originTaskId` → 应用到**模板**（已解绑副本作用自身）。于是**在任一副本上取消重复 = 取消整个系列**（模板规则清除 + 全部绑定副本级联删除，包括当前副本）。
  - **触发再推导**：系列规则仍活跃时，`triggerAgent`/`triggerAt` 改动会**重新推导已物化未来副本的一次性到时**——关掉触发 → 未来副本失去 🕐 变普通任务；改触发时间 → 未来副本 dueAt 跟随；已过去的日期保持普通任务。
- **测试**：host-ledger +3（副本清定时→系列级联、副本触发开关→未来副本再推导、已解绑副本不路由）；m3-ui +1（副本定时区显示系列规则与提示）。**183 单测全绿**（24 文件）。

## 保存重复后副本即时出现（2026；用户：复制时间有点长）
- **问题**：保存/创建重复后副本要「一阵子」才刷出来——物化只发生在 `HostScheduleService` 的 **30s tick** 上。
- **实现**：`HostLedger` 抽出纯扫描 `sweepRepeats`（只改 state、不落盘）；`create` 与 `setSchedule` 分发在返回前**内联执行**，因此 apply 返回的快照已含全部副本，浏览器即时刷新。`materializeRepeats` 保持 commit 语义给 scheduler；tick 保留为重启兜底 + 日期滚动。测试账本支持 `{ repeatHorizonDays }` 选项以固定物化规模。
- **测试**：host-ledger 首用例改为断言「创建即物化」+ 新增「setSchedule 即物化」；`createWithRepeat` 助手改为取最新模板 id（快照尾部是副本）。**184 单测全绿**（24 文件）。

## 取消定时的确认：一天 vs 整个系列（2026；用户：万一是想取消一天的定时）
- **问题**：清除定时会直接取消整个系列；用户有时只想取消**某一天**的定时（如某天不让 Agent 自动跑），没有退路。
- **实现**：
  - 新协议动作 **`clearInstanceSchedule`**：只清除目标任务自己的调度、**不做系列路由**——副本保留在日历上（仍是绑定副本），仅它的触发到时消失。
  - 详情面板「清除定时」按钮与「改成不重复后保存」都先走 `controller.requestScheduleClear` 弹确认（Promise 化，调用方按选择分发）：「**取消这一天**」（仅当打开的是仍带自待到时的副本时出现）或「**取消整个系列**」（现行为：规则清除 + 级联删全部副本）；模板/无自待到时的副本只提供后者。普通任务清除照旧直接执行。`ScheduleClearConfirm` 弹窗挂载在 CalendarView。
- **测试**：host-ledger +1（clearInstanceSchedule 只清当天、系列/其他副本/绑定关系不动）；controller +1（确认流程 day/all/cancel 解析）；m3-ui +1（副本上点清除定时 → 先挂起确认、不直接分发，选「这一天」→ 派发 clearInstanceSchedule）。**187 单测全绿**（24 文件）。
- **复测修复（commit 本轮）**：弹窗里「取消这一天」此前只在副本**自带触发到时**时才显示，无触发的普通副本看不到。改为**任何绑定副本都显示**——带触发到时的副本清掉该到时（保留为普通任务）；普通副本则移除当天 occurrence（删除，日期不补回）。模板仍只提供「取消整个系列」。m3-ui +1（普通副本 →「这一天」→ 派发 delete）。**188 单测全绿**（24 文件）。

## 下一步
全部里程碑（M0–M7）已完成，M7 后完成拼写重命名与多轮 UI/交互迭代。后续可按需：真实组合验收打勾 / 更多 tool 细化（如按日期范围查询）/ 进一步视觉打磨。

## 交付挂载（需用户环境）
`dsh plugin --profile web add link:D:\Dev\agents\dsh-calendar` → 重启 dsh web（页面刷新不够）。验证 `GET /api/calendar/state` + 侧边栏入口 + 中间列日历。

## 命名决策（已锁定）
包 `dsh-calendar` / 行 id `ui-calendar` / 命名空间 `calendar` / 账本 `$DSH_HOME/calendar/ledger-v1.json` / DOM `data-dsh-calendar-*` / 面板事件 `calendar`。

## 环境要点
- vitest(esbuild) 需 `danger-full-access`；tsc/tsdown(rolldown) 在 workspace-write 即可。当前会话策略已是 `danger-full-access` + approvals 关闭（无需再要求授权）。
- pwsh 里带 `2>&1` 的管道会触发 pnpm/node 的编码包装报错——改用重定向到文件（`*> 文件`）或直接 `pnpm <cmd>; echo $LASTEXITCODE`；`git ... | Select-Object` 之类管道同样会被沙箱拒绝，git 输出一律重定向到文件再读。
- 工具侧重命名后注意**相对路径会解析到会话工作区**：新会话以 `D:\Dev\agents\dsh-calendar` 为工作区后正常；若跨目录编辑请用绝对路径。
- pnpm 设置放 `pnpm-workspace.yaml`；store 位置见上文「pnpm 离线 store」注。

## 挂载与环境记录（2026-08，已由主代理处理）
- **已挂载到 web profile ✓**：`dsh plugin --profile web add link:D:\Dev\agents\dsh-calendar` 成功；`dsh.profile.bundles=[base,web-app,dsh-web-ui-all,dsh-calendar]`；`--dump-config` 出现 `ui-calendar` 层。
- **根因**：web profile 既有原生依赖（cloudflared/cpu-features/ssh2）从未做构建放行决策，pnpm 10 报 `IGNORED_BUILDS` 使任何 pnpm add（含挂载）退出非 0。
- **修复**：`~/.dsh/profiles/web/pnpm-workspace.yaml` 三项 `allowBuilds` 设为 `false`。设 `true` 会触发 cpu-features 构建失败——勿改 true。
- **遗留**：DSH 的 SSH 远程能力因无编译器受限（与插件无关）。
- **待用户操作**：重启 dsh web 进程使插件上线。

## 轮次修复（用户验收反馈，5 项）
1. **详情面板切换标题不更新**：`TaskDetailPanel` 用 `useState(task.title)` 只在挂载初始化；切任务不重挂载 → 标题陈旧。修复：CalendarView 给 `<TaskDetailPanel key={task.id}>`，切任务强制重挂载。
2. **provider/模型/工作区/会话要下拉**：新增 `src/client/exec-catalog.ts`（把运行时 workspaces/sessions/LLM 模型目录转成扁平下拉选项；容错回退自由文本），controller 持有 `catalog`，index.ts 从 `ctx.connection/workpaces/sessions` 异步装载；ExecutionSettings 有数据渲染 `<select>`（provider 联动 model），无则自由文本。
3. **归档报 "unknown or rejected"**：`archiveTask` 原拒绝未完成任务（`!task.done`）→ 报错。改为任意任务可归档；更新 tasks.spec 对应断言。
4. **周视图任务不能拖拽/调时间**：TaskBlock 加 top/bottom resize 把手 + move（`onEditStart`）；WeekGrid 增加 move / resize-start / resize-end 编辑（pointer capture、snap、按天约束、minimum 15min），release 后 dispatch update（startAt/endAt）；抑制拖后误触发的 select。
5. **日历 Tool（M7）**：新增 M7 里程碑——把日历暴露为对话中 LLM 可调用的 tool（建/删/改/查任务），Host 侧映射到同一 HostLedger.apply。已写入 `memory-bank/implementation-plan.md` 与 `docs/development-plan.md`，不打乱 M4–M6。

### 周视图交互回归修复（用户复测反馈）
问题：整块任务框 pointerdown 即捕获指针 → 无法点开详情面板；且 move 被约束在同一天内。
修复（WeekGrid/TaskBlock）：
- **点击 vs 拖拽分离**：框体 pointerdown 只登记候选，不捕获；指针位移超过 4px 阈值才进入拖拽（并捕获指针）。纯点击正常触发 onClick → 打开详情面板。
- **跨日拖拽**：move 用 x 决定目标星期列、y 决定当天时间；渲染浮动 `.movePreview` 跟随指针跨列；松手按 (startAt,endAt) update 提交。
- resize 仍限定在原任务当天。
- 新增 `tests/weekgrid-interaction.spec.tsx`：断言「纯点击选中且不 dispatch update」（PointerEvent 已打 polyfill）。
### 复测反馈第二轮（2 项）
1. 议程完成项仍留在过期栏：AgendaPanel 只按时间分组，未处理 done。修复：新增 agenda.done 组，完成任务归入「已完成」，不再混在过期/今天/近期。
2. provider/模型/工作区/会话仍是填空框：客户端用 fragile 类型断言读 ctx 且只在 apply 跑一次，常静默失败 → 目录空 → 回退文本框。修复：改为 Host 权威——新增 Host 路由 GET /api/calendar/options（经 ctx.apiProxy 读 LLM 模型目录/工作区/会话，buildCatalogFromApi 投影）；客户端 HttpcalendarHostTransport.options() fetch；exec-catalog.ts 移到 src/core（host/client 共享）；host index 注入 apiProxy。
### 复测反馈第三轮（1 项）
定时清除不生效：TaskDetailPanel 的 save 总是发 enabled:true，且 setSchedule 把 undefined 视作「不动该字段」，导致清空 cron/dueAt 后 schedule 仍 enabled、周视图定时徽标不消失。
修复：setSchedule 引入 null 语义（null 清除字段、undefined 不动）；协议 SetScheduleAction.patch 与 host-ledger 校验相应放宽；save 在无 cron 且无 dueAt 时发 enabled:false + cron/dueAt 为 null；新增「清除定时」按钮。新增单测。
### 复测反馈第四轮（1 项）
执行设置的会话选择：改为显示会话「名字」（cwd 末段文件夹名）而非完整路径；隐藏已归档会话；并做了项目→会话二级分组（workspace.list 提供 sessionIds 与 archivedSessionIds，sessions.list 提供 cwd 名字）。
实现：ExecutionCatalog 新增 projects 分组字段；host-options buildCatalogFromApi 直接按 workspace 分组、跳过归档会话、用 cwd 末段命名；客户端 ExecutionSettings 新增 GroupedSessionSelect 渲染 <optgroup>。新增 exec-settings-ui 测试。
### 复测反馈第五轮（1 项）
会话下拉的两个问题：① 选了工作区后仍显示所有工作区会话 → 加「级联」：选中工作区只显示该项目下的会话，并清除原会话选择；② 同一项目内所有会话名相同（sessions.list 只给 cwd，同项目共享目录）→ 对同项目内重名会话追加短 id 后缀（如 p · aaaaaa）保证可区分。
### 复测反馈第六轮（1 项）
会话下拉改用 DSH 会话标题：调查确认 wire session.list 不携带标题（会话标题是每会话 log/projection 的产物），但浏览器端 ctx.sessions.list 已投影出真实 displayTitle（优先用户重命名的持久标题）。
实现：Host /options 继续提供项目分组/归档过滤/结构；客户端 index.ts 在 fetch 目录后调用 overlaySessionTitles 用 ctx.sessions.list 的 displayTitle 覆盖会话显示名（无标题时回退 cwd 目录名；同项目仍去重）。shared uniquifyLabels 从 host-options 移到 core/exec-catalog 复用。新增 overlay 单测。
### 复测反馈第七轮（1 项）
会话标题仍不生效：实测 session.list 的 projections.values 其实携带真实会话标题（如首个 prompt 预览），之前结构化类型没读它。
修复：Host /options 直接读 projections.values.title 作为会话名（真实标题 → cwd 目录名 → id），不再依赖浏览器运行时叠标题；浏览器端保留订阅刷新作为兜底。host-options.spec 新增「优先投影标题」用例；index.ts 顺手清理重复块并做反应式刷新。
### 严重回归修复（第八轮）
卸载后 dsh 无法进入：Failed to load plugins - cannot get property "sessions" without inject。
根因：上一版为叠会话标题在客户端 apply 里读了 ctx.sessions，但客户端插件 inject 只声明 locale，未声明 sessions 服务 → Cordis 访问 ctx.sessions 抛错，整包加载失败。
修复：Host 已在 /options 直接读 projections.values.title 得到真实会话标题（前一轮），浏览器端叠标题是冗余且危险的——彻底移除 ctx.sessions 访问与 overlay（连同其测试），客户端 refreshCatalog 直接 fetch Host 目录。71 单测通过。
### 周视图改进（第九轮，3 项）
1. 周视图顶部加 sticky 表头：周一~周日 + 日期数字，今日圆形高亮。
2. 今天按钮只在周/月视图显示（矩阵/议程里 cursor 无意义，隐藏以免目的不明）。
3. 重叠任务不再互相遮盖：core/calendar 新增 layoutDayTasks（经典日历事件并排布局，同列重叠 → 子列），TaskBlock 按 column 计算 left/width，并排留 2px 间隙；新增纯函数单测 + UI 单测。
约束无回归：客户端仍未访问任何未 inject 服务。