# dsh-calender 进度（Progress）

## 当前状态
- **阶段**：**M3 任务编辑已完成并通过验收**；本轮修复 5 个问题（加载/归档/详情面板/拖拽编辑/执行设置下拉）+ 计划新增 M7 日历 Tool。**60 单测全绿（63 含新增）**。
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
| M2 日历 UI | ✅ `83e1599` + `213a43b`（56 单测） |
| M3 任务编辑 | ✅ 验收通过（60 单测） |
| M4 真实执行 | 未开始 |
| M5 定时调度 | 未开始 |
| M6 完善 | 未开始 |
| M7 日历 Tool | 🔜 已入计划；待 M6 后实施 |

## 下一步
1. 用户真实挂载验收 M3（重启 dsh web 后侧边栏「日历」→ 点任务开详情面板 / 全表单新建 / 矩阵拖拽）。
2. M4：host-runner 真实执行（会话 + provider/model 选择 + 结算 + 执行记录 + 会话跳转）。
3. M5：Host cron + 到期触发 + SSE 广播 + 重启对账 + v1 迁移。
4. M6：设置卡 + SystemPrompt 段 + 设计打磨 + 文档 + scripts/dsh-calender.js。

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