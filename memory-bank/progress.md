# dsh-calender 进度（Progress）

## 当前状态
- **阶段**：**M0–M7 全部完成并通过测试**，经历 9 轮验收反馈与 M4–M7（真实执行 / Host cron 定时调度 / 完善 / 日历 Tool）落地；**113 单测全绿**。
- 计划已批准（Host 权威架构）。

## 已完成里程碑（均通过 ✓，已提交）
| 里程碑 | 提交 | 验收 |
|---|---|---|
| M0 脚手架 | `5c24d69` | typecheck / build / vitest / scratch 挂载 `--dump-config` 出现 `ui-calender` 层 |
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
| M5 定时调度 | ✅ `660b6f5`（Host cron 到期触发 + 只接受后滚动 + 重启对账 + SSE 广播；105 单测） |
| M6 完善 | ✅ `61f6f28`（设置卡 calender 命名空间 + SystemPrompt 段（可开关）+ scripts/dsh-calender.js CLI + 文档；105 单测） |
| M7 日历 Tool | ✅ `M7` 提交（`calender_task` tool：建/查/改/删/子任务/执行钉子/run，经同一 HostLedger.apply；113 单测） |

## M4 交付内容（真实执行）
- **host-runner.ts**：打开执行记录 → 建/复用会话 → 应用钉子（provider+model 经 `sessions.selectModel`、agent 预设经 `agentPresets.select`、权限经 `/permission` 斜杠命令）→ rename → prompt('queue') → 结算执行记录。依赖注入的窄 ApiProxy face，测试用 fake 驱动。
- **HostLedger** 新增 `openExecution`/`settleExecution`/`taskById`：运行中拒开第二条、结算附带会话 id、写回账本并通知浏览器；`run` action 现在要求任务存在。
- **路由接线**：`POST /action` 遇到 `kind:'run'` 把任务交给 HostExecutionRunner（fire-and-forget，结算异步）。
- **结算策略**：轮询 `sessions.list`；会话消失→cancelled、停止且带 prompt 证据→succeeded、超时→cancelled。
- **UI**：任务块 **运行徽标**（有未结算执行时）+ provider/model 徽标（已有）；执行记录显示 **「打开会话」跳转**（`ctx.sessions.open`，客户端 `inject` 增加 `sessions`）。
- **测试**：host-runner.spec（10）、host-ledger 执行记录、host-routes run→runner 接线；**92 单测全绿**（原 76 + 16）。

## M5 交付内容（Host cron 定时调度）
- **host-scheduler.ts（HostScheduleService）**：tick 扫描账本里 enabled 且 `nextRunAt<=now` 的调度 → 交给 host-runner 触发真实执行 → **只在 run 被接受后**才 `advanceSchedule` 滚动到下一 cron 匹配点（被拒绝=已在运行=保留下一个到期槽，下个 tick 重试，绝不漏跑）。错过不补、`enabled=false` 暂停、单次 dueAt 触发后结束。
- **HostLedger.advanceSchedule**：滚动 nextRunAt/lastTriggeredAt 并写回账本 + 通知。
- **重启对账**：`runner.reconcile(taskId)`（会话消失→cancelled / 停止且有 prompt 证据→succeeded / 仍在 run→保留）+ `scheduler.reconcileAll()` 在 start 时对被遗留为 running 的执行结算。
- **SSE 广播**：`/events` 经 `ledger.subscribe` 在账本变更（动作/定时触发/执行结算/滚动）时推送 `{revision, ledgerId}`，浏览器 EventSource 收到即重拉 /state。
- **runner.run 重构**：返回 `{accepted, settleFinished?}`，不阻塞结算（HTTP 路由与调度器 fire-and-forget），可 await settleFinished 观察。
- **测试**：host-scheduler.spec（6）+ host-reconcile.spec（4）+ host-routes SSE（1）+ host-ledger advanceSchedule（2）；**105 单测全绿**（原 92 + 13）。

## M6 交付内容（完善）
- **设置卡**：Host 经 `installSettingsSection(ctx, settingsNamespace('calender'), Config, ...)` 注册 `calender` 设置命名空间（`announceToAgent`/`enabled` 两个布尔，schema 由 schemastery 定义），在 web 设置「插件」区呈现可编辑表单。
- **SystemPrompt 段**：`ctx.systemPrompt.section('plugin:calender', order 160)` 向每个 agent 宣告日历能力；受设置开关实时门控（关 `announceToAgent`/`enabled` 即撤销段，无需重启）。参考 task-board 的 installSettingsSection + sync 模式。
- **CLI `scripts/dsh-calender.js`**：`status` / `mount` / `unmount`（`--profile`），只依赖 Node stdlib；mount 用 `dsh plugin add link:<dir>`。
- **host `apply(ctx, config?)` + Config schema**；文档（DESIGN/README/进度）补齐。
- **验证**：typecheck + build + 105 单测全绿。

## M7 交付内容（日历 Tool）
- **`src/host-tool.ts`（defineCalendarTool → `calender_task`）**：单一 model-callable tool，action 枚举覆盖 create / get / list / update / setQuadrant / setDone / addSubtask / setSubtaskDone / removeSubtask / setSchedule / delete / archive / restore / run；参数 schema（defineTool 的 ValueSchemaSpec）含标题/描述/Prompt/起止/紧急·重要/执行钉子（workspace/session/provider/model/mode/permission）/子任务/cron/dueAt。
- **同账本同幂等**：每个动作以 minted requestId 映射到**同一 HostLedger.apply**（与浏览器 share 同一 authoritative ledger + request-id 幂等）；读走 snapshot；`run` 委托给 host-runner。defineTool 对 enum/必填做参数校验（非法 action 在 execute 前拒绝）。
- **注册**：host index `ctx.tools.register(...)`（inject 增加 `tools`），`apply` 里接线并 dispose。
- **依赖**：追加 devDep `@deepseek-ai/dsh-tools@0.1.0-rc.6`（host 侧 bundle）。
- **测试**：host-tool.spec（8）覆盖建/查/列/改/象限/完成/子任务/定时/归档恢复删除/run/非法输入；**113 单测全绿**（原 105 + 8）。

## 下一步
全部里程碑（M0–M7）已完成。后续可按需：合并交付 / 更多 tool 细化（如按日期范围查询）/ 真实组合验证。

## 交付挂载（需用户环境）
`dsh plugin --profile web add link:D:\Dev\agents\dsh-calender` → 重启 dsh web（页面刷新不够）。验证 `GET /api/calender/state` + 侧边栏入口 + 中间列日历。

## 命名决策（已锁定）
包 `dsh-calender` / 行 id `ui-calender` / 命名空间 `calender` / 账本 `$DSH_HOME/calender/ledger-v1.json` / DOM `data-dsh-calender-*` / 面板事件 `calender`。

## 环境要点
vitest(esbuild) 需 `danger-full-access`；tsc/tsdown(rolldown) 在 workspace-write 即可；pnpm 设置放 `pnpm-workspace.yaml`。pwsh 里带 `2>&1` 的管道会触发 pnpm/node 的编码包装报错——改用重定向到文件或直接 `pnpm <cmd>; echo $LASTEXITCODE`。

## 挂载与环境记录（2026-08，已由主代理处理）
- **已挂载到 web profile ✓**：`dsh plugin --profile web add link:D:\Dev\agents\dsh-calender` 成功；`dsh.profile.bundles=[base,web-app,dsh-web-ui-all,dsh-calender]`；`--dump-config` 出现 `ui-calender` 层。
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
2. provider/模型/工作区/会话仍是填空框：客户端用 fragile 类型断言读 ctx 且只在 apply 跑一次，常静默失败 → 目录空 → 回退文本框。修复：改为 Host 权威——新增 Host 路由 GET /api/calender/options（经 ctx.apiProxy 读 LLM 模型目录/工作区/会话，buildCatalogFromApi 投影）；客户端 HttpCalenderHostTransport.options() fetch；exec-catalog.ts 移到 src/core（host/client 共享）；host index 注入 apiProxy。
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