# dsh-calendar 设计规范（Design Spec）

> 现代、美观、克制。嵌入 DSH 聊天 GUI 的效率工具，全量使用 DSH `--dsw-*` 语义 token，无第三方 UI 框架。
> 实现状态标注：**[M2 已实现]** = 已落地；**[规划 M3+]** = 设计已定、待对应里程碑实现。文档与代码以此保持对齐。

## 0. Design Read

**Reading this as:** a productivity tool embedded in a chat GUI for heavy users, with a calm-minimalist (Linear-style) language, grounded in the DSH design-token system, MOTION 3 / DENSITY 5 / VARIANCE 5.

**Anti-default discipline**（规避 AI 默认病）：无紫渐变、无泛玻璃拟态、无漂浮 3D 卡、无无限循环微动画。一切视觉来自真实 token 与精确网格。

## 1. 设计 token 基础

- 背景/层级：`--dsw-alias-bg-base`、`bg-layer-1/2/3`、`bg-overlay`
- 文字：`--dsw-alias-label-primary` / `secondary` / `tertiary`
- 边框：`--dsw-alias-border-l1/l2/l3/l4`
- 交互态：`--dsw-alias-interactive-bg-hover` / `interactive-bg-active`
- 状态色：`--dsw-alias-state-success/business/warn/error-*`
- 侧边栏：`--dsw-specific-sidebar-nav-item` / `-hover` / `-active`；输入 `--dsw-specific-input-major`
- 字体：`--dsw-font-family`；动效：`--ds-transition-duration`(200ms) / `-fast`(100ms) / `-slow`(300ms)、`--ds-ease-in-out`
- 深色模式：`body[data-ds-dark-theme]` 自动切换

## 2. 布局 **[M2 已实现主体；右侧面板规划 M3]**

- **头部**：标题（16px/700）· 视图切换（week / month / matrix / agenda，segmented 控件）· 今天 · 日期导航 · 新建按钮（primary）。
- **主体（M2 现状）**：整块日历区（无右侧常驻面板）；新建走浮层弹窗；选中任务通过 `controller.selectTask` 记录（供 M3 详情面板消费）。
- **主体（M3 已实现）**：左日历（flex:1）+ 右侧 320px **TaskDetailPanel**（选中任务时展开于 calendarBodyWithPanel 右侧，flex 布局、内部滚动）。宽屏常驻、窄屏仍为右列面板（内置滚动，宽度 340px）。

## 3. 周视图（WeekGrid）**[M2 已实现]**

- 顶部 sticky 表头行：周一~周日 + 日期数字，今日圆形高亮；然后 7 列（周一开头；周末列 `bg-layer-2` 淡色）+ 24h 时间轴；默认 15 分钟吸附（可传入 `snapMinutes` 调整）。
- **重叠任务并排**：同列重合的任务按 `layoutDayTasks` 分配到并排子列，互不遮盖（保留 2px 间隙）。
- 拖选（pointerdown→move→up）→ `controller.setDraft` 打开创建弹窗；选中态 `--dsw-static-deepseek-200` 底 + deepseek-500 2px 边框 + 圆角 6px。
- 现在线 `--dsw-static-red-500`（今日列）；今日日期数字 `brand-primary` 圆形强调。
- 任务块：圆角 8px、`bg-layer-1` 底、1px `border-l1`；左缘 3px 象限色条；标题 + 徽标行。已完成任务使用 `bg-layer-2`、降低透明度、虚线边框和删除线，未完成任务保持实线与主文字色；左缘象限色保留。M2 单列块（leftPct=0,widthPct=100）；同列并排、块移动/拉伸为增强项。

## 4. 艾森豪威尔象限配色语言

| 象限 | 语义 | 主色 | 底色 | 用途 |
|---|---|---|---|---|
| do | 紧急×重要 | `--dsw-static-deepseek-500` | `--dsw-static-deepseek-100` | 立即做 |
| schedule | 重要 | `--dsw-static-blue-500` | `--dsw-static-blue-100` | 排期 |
| delegate | 紧急 | `--dsw-static-amber-500` | `--dsw-static-amber-100` | 委托 |
| eliminate | 低优先 | `--dsw-alias-label-tertiary` | `--dsw-alias-bg-layer-2` | 丢弃 |

- **矩阵面板（M2 已实现）**：2×2 象限格，边框用主色；按 `quadrantOf` 分组展示；点任务选中。列表卡显示本地日期和时间；重复系列取最旧未完成 occurrence；未完成且日期早于今天的任务以红色边框和「已过期」徽标标记。**标题美化（commit `017467c`→`343c1cd`）**：象限标题放大到 18px/700（主文字色 `label-primary`），标题行底部加 3px 象限色横条；计数徽标同步放大。
- **议程面板**：重复系列同样取最旧未完成 occurrence 后再按本地日期归入「已过期 / 今天 / 近期」；完成项单独进入「已完成」。
- **象限拖拽改优先级（M3 已实现）**：任务块 draggable，拖放到另一象限（dataTransfer 携带任务 id）→ dispatch setQuadrant；悬停象限高亮 matrixOver。

## 5. 组件细节

### 5.1 任务块徽标 **[M2 已实现]**
小徽标行：子任务 `✓ 2/5`（12px tertiary）；可选 `provider·model`（`--dsw-alias-state-business-tertiary` 底，10-11px）；定时钟形（amber）。

### 5.2 任务详情面板 TaskDetailPanel **[M3 已实现；第 6/7 项增强]**
选中任务滑出的右侧 320px 面板：
1. 标题 + 完成勾选（`brand-primary` 勾选态）。
2. 描述 / Prompt：只读展示 + 编辑入口。
3. 任务时间：开始日期使用日期输入，开始时刻使用固定的 15 分钟选项（`00/15/30/45`）；持续时间输入完成后吸附到最近的 15 分钟档位，范围为 15 分钟至 24 小时。结束时间由开始时间 + 持续时间计算，保存普通任务时可直接移动到其他日期或周并支持跨日。重复系列时间改动沿用已有的「仅此项 / 整个系列」确认。
4. 艾森豪威尔 knobs：紧急/重要选择，改即 `setQuadrant`。
5. 子任务 checklist：勾选 `setSubtaskDone`；新增/删除；父任务进度条（3px 圆角、`state-success-primary` 填充）。
6. 执行设置 ExecutionSettings：工作区 / 执行会话（新建或复用）/ **provider + model + reasoningEffort** / agent 预设 / 权限；下拉 + 徽标预览；留空 = 运行时默认。**agent 预设是下拉**：Host 经 `agentPreset.list`（ApiProxy）读 preset roster 投影为 `catalog.modes`（`name ?? id` 作标签、剔除 `broken`），有 roster 渲染 `<select>`，无则回退自由文本。
7. 定时：**受限重复规则**（不重复/每日/每周 + 周几多选 + 跳过周末与节假日开关）或**一次性到时**（datetime-local）。**不再有自由 cron 输入**（曾因权限过高/崩溃被移除）。规则模型：`ScheduleRule { enabled, repeat?: {kind:'daily'|'weekly', weekdays?, skipHolidays?}, dueAt?, nextRunAt?, materialized? }`——重复模板**不会自动执行**，Host 把它**物化为各匹配日期的普通副本**（见 §11）；一次性 dueAt 到点自动执行，完成后由 `advanceSchedule` 整体清除调度（徽标/清除按钮/到时全部消失）。
8. 执行记录 + 会话跳转（M4）：sessionId/起止/结果/错误；「查看会话」跳 transcript。
9. 删除 / 归档（danger 按钮）。

### 5.3 创建/编辑弹窗 CreateTaskModal **[M3 已实现]**
拖选或"新建"触发的居中弹窗（`bg-layer-2` 底、`border-l2` 边、圆角 12px、阴影 `bg-mask-3`、Escape 关闭）：预填起止、标题、紧急/重要、创建/取消。已扩展为完整表单：标题、描述、Prompt、紧急/重要、子任务（回车添加）、定时（每日/每周重复 + 一次到时，共享 `ScheduleSettings` 组件）、执行设置、创建/取消。

### 5.4 表单控件 / 按钮
输入 `--dsw-specific-input-major` 底、`border-l2` 边、圆角 8px、focus `brand-primary` 2px 描边；选择器为下拉 + 徽标预览；primary = `button-primary-fill`（hover `-hover`）；ghost = 透明 + `border-l2`；danger = `state-error-primary`。

## 6. 动效与可访问性

- 动画仅 hover/focus/展开/状态切换，200ms + `--ds-ease-in-out`；`prefers-reduced-motion: reduce` 关闭。
- 键盘：网格方向键、Enter 打开、Escape 关弹窗；`:focus-visible`；图标按钮 `aria-label`。
- 语义：任务块真实 button；象限 `role="group"` + `aria-label`；弹窗 `role="dialog"` + `aria-modal`。
- 对比度：用 label 语义 token，不自行调色。

## 7. 响应式

- 宽屏（≥720px）：日历 + 右侧详情面板（M3）。
- 窄屏（<720px）：详情面板 overlay；月视图为补充视图；议程兜底。
- 侧边栏折叠 rail：入口纯图标（16px 居中），自适应 `[data-dsh-frame][data-sidebar-collapsed]`。

## 8. 样式归属

所有样式在 `src/client/calendar.module.css`（CSS Modules，build 预设内联注入 `<style data-plugin>`）；以插件自有 data 属性作用域，不泄漏。

## 9. 挂载（2026-08 后期重构）

日历的浏览器呈现改用 DSH **官方 Slot**，不再向 React 托管的中间列做 DOM 注入（早期做法在 dsh-client rc.6 下「容器挂不上/内容空白」反复出现）：
- **面板**→`shell.overlay` 槽位（root、`replaceRisk:none`）渲染 `<CalendarView>`；根级 → 无需打开会话即可进入日历；
- **入口**→`sidebar.footer.action` 槽位（root、左下角 Settings 旁）——侧边栏唯一的 root 级 additive 槽位，左上角无 additive 位置；
- 覆盖层动态测量侧边栏右缘收窄到侧栏右侧（保留侧栏可见）；
- **入口样式 1:1 复刻 Settings 触发按钮**（ui-settings-general `SettingsRoot.module.css` `.trigger`）：宽栏为通栏 42px 行（`width:calc(100%+4px)`、`height:42px`、`margin:4px -2px`、`padding:0 10px 0 8px`、`border-radius:12px`、主文字色、14px/行高22）；收窄为 36×36 圆形（半径 50%）。rail 判定走 slot 传入的 **`wide` prop**（与 SettingsRoot 一致），不依赖 CSS 属性。
渲染链：`CalendarEntry` → `root-open.ts` 开关 store → `CalendarOverlay` → `CalendarView`。
**会话跳转关日历（两层）**：
- 日历页内执行记录「打开会话」（`onOpenSession` → index.ts `openSession`）先 `setCalendarOpen(false)` 再 `ctx.sessions.open`（commit `8d520ef`）；
- 侧边栏点会话/新建会话（日历仍开着）由 `navigation-watch.ts` 处理，两层：`watchSessionNavigation` 订阅 `ctx.sessions.list` 的 `current`，变化即关日历（基线随每次打开重种）；`closeOnSessionOpen` 包装共享 `sessions.open`——**点当前会话**不改变 `current`，但任何 open 调用（含点当前会话）都关日历（dispose 还原）。提交 `139c42f` + `51ca679`。
client 依赖已对齐 rc.7（`@deepseek-ai/dsh-*@0.1.0-rc.7` + `dsh-client-ui-conversation`）。
**执行设置目录实时刷新（`catalog-refresh.ts`）**：目录在 apply 时拉一次，之后新建的会话要靠 `watchCatalogRefresh` 保持实时——订阅 `ctx.sessions.list`（任何变更防抖 300ms 重拉 `/api/calendar/options`）+ 日历关→开时也重拉（覆盖冷会话）。dispose 取消订阅与挂起计时器。

## 10. 视图增强（commit `c5ec7b1` 起）

- **周/月日期导航 `DateNav`**：`‹ 期标签 › + 今天`。core `calendar.ts` 新增 `addDays / addMonths / sameMonth / monthLabel / weekRangeLabel`；`addMonths` 按目标月天数钳制日（1月31日+1月→2月28/29）。周视图步进 ±7 天、月视图 ±1 月；期标签带年份，`aria-live` 播报。
- **任务搜索**：曾实现 `taskMatchesQuery` 过滤四视图（`c5ec7b1`），用户复测认为无用后**整体移除**（`28a99cc`）——无搜索栏。
- **月视图**：顶部 sticky 周几表头（随 `weekStart` 周一起始）；`sameMonth` 判当前月，相邻月单元格 `data-outside` 变淡（背景 `bg-layer-1`、任务 chips 半透明）；`.monthWrap`（表头 + 可滚动 `.monthGrid`）替代原单一网格。已完成任务条使用 `bg-layer-1`、降低透明度、虚线边框和删除线，未完成任务保持实线与主文字色。**日期样式（commit `a003320` 系列→`78f027d`）**：色带方案反复迭代后**弃用**，改为干净的日期行——日期数字 **18px/700**，**每月 1 号在数字旁标月份短名（字号与日期一致，如「9月 1」，月份 `label-secondary` 主次区分）**；相邻月日期 `label-tertiary`；今天数字套品牌蓝圆底白字（`--dsw-static-deepseek-500`，勿用亮色下近黑的 `--dsw-alias-brand-primary`）。

## 11. 执行与定时运行（M4/M5 宿主行为，host-runner / host-scheduler / host-ledger）

- **会话**：钉了 `sessionId` → 复用（须存在且非 busy）；否则在目标/最近工作区新建。新建时 `sessions.create` 直接带 `agentPreset`；复用会话钉了预设 → `agentPresets.select` 重组（**仅空白会话合法**，已开聊的会话会 `agent-preset-locked` 失败关闭）。
- **钉子顺序（全部在 prompt 前应用，失败即关闭，绝不在错误设置下运行）**：预设 → provider+model（`sessions.selectModel`，缺一即拒）→ **权限经命令注册表**（`ctx.commands.execute(agent, '/permission <preset>')`，`agent = ctx.agents.get(sessionId)`；`commands`/`agents` 为可选 `ctx.get`，缺失时权限钉子明确失败）→ rename（纯装饰，失败不阻断）→ `sessions.prompt`（任务 prompt 或标题）。
- **坑（必读）**：① 进程内 ApiProxy 域对象是 **`agentPresets`（复数）**、wire 路径是 `agentPreset.*`（单数）——目录与 runner 的 face 都按复数命名；② **`sessions.prompt` 不路由斜杠命令**（文档注释声称支持，当前 build 未实现）——权限必须走命令注册表，经 prompt 会把 `/permission …` 当普通消息发给模型。
- **定时**：`HostScheduleService` tick 每 30s 干两件事——① **一次性**：扫描 `nextRunAt<=now` 的 enabled 调度 → 交 runner → **只接受后**才 `advanceSchedule` 清除（被拒保留到期槽下轮重试；错过不补）；② **重复物化**：调 ledger `materializeRepeats(now, 60天)`，把每个 enabled 且未归档的重复模板按规则补出副本（见下）。**物化在保存/创建重复的瞬间就做**（`create`/`setSchedule` 分发内联 `sweepRepeats`，返回快照已带副本，无需等 30s tick）；tick 仅作重启兜底与日期滚动。
- **重复规则 = 物化副本**：模板自身的块就是当天的那个任务；副本从「模板日期/今天 较晚者的次日」起、到「今天 + 60 天」为止，按规则（周几过滤 + 可选跳过周末/节假日）逐日物化。副本是**普通任务**（`originTaskId` 指回模板、时间=模板时刻/时长、继承内容与执行钉子、done=false）。`schedule.materialized`（YYYY-MM-DD）记录已物化日期——**删掉某一天的副本后不会被重新补回**；模板自身的日期不产生副本。**规则变窄也同步清副本**：`sweepRepeats` 每轮先调 `alignSeries`——把不再匹配当前规则日期的绑定副本（含归档）删除、并从 `materialized` 去掉这些键（以后重新勾回会重新物化），故「每日 → 每周 1-5」或开启「跳过节假日」后，周六日副本即时消失（内联 sweep 覆盖 60 天；30s tick 也自愈）。
- **副本与原任务保持同步（用户选定，commit 本轮）**：改**模板**的标题/描述/Prompt/象限/子任务结构（增删）/执行钉子 → 所有仍绑定且未归档的副本自动跟着更新；**每副本的「完成」态、子任务勾选态、执行记录、时间段独立**（互不覆盖）。改**副本**只改它自己（本地化后不再被模板改动波及——除「改所有」外）。`update`/`setQuadrant`/`addSubtask`/`removeSubtask` 在目标为模板时按此传播；`setDone`/`setSubtaskDone`/`startAt`/`endAt` 永不传播。
- **副本的定时区 = 整个系列的定时（commit 本轮）**：副本详情面板的「定时」区读取并编辑**模板的重复规则**（副本自身无 schedule，显示与原版一致，不再出现「不重复」空态）；对副本的 `setSchedule` 在账本里**路由到模板**——在任一副本上**取消重复 = 取消整个系列**（模板规则清除 + 全部绑定副本级联删除，包括当前这个）。规则仍活跃时，`triggerAgent`/`triggerAt` 的改动会**重新推导已物化未来副本的一次性到时**（关掉触发 → 未来副本失去 🕐 变普通任务；改时间 → 未来副本的 dueAt 跟随）。已解绑副本的定时只作用于它自己。
- **取消定时/删模板 → 级联删副本**：清掉重复规则（`setSchedule repeat:null`）或删除模板，连带删除其仍绑定的副本；删除单个副本只删它自己（日期仍在 `materialized` 里，不会被补回）。账本**加载时**还会清理孤儿副本（模板已无重复规则的副本，`pruneOrphanCopies`）——覆盖 Host 宕机期间清掉的场景。
- **取消定时的确认（commit 本轮）**：对重复系列成员点「清除定时」（或把重复改成「不重复」保存）会先弹确认——「**取消这一天**」（仅当天副本：仍带触发到时则清除之、副本保留为普通任务；无到时的普通副本则移除当天 occurrence，该日期不再补回；系列不动，`clearInstanceSchedule`/`delete` 不路由）或「**取消整个系列**」（现行为：规则清除 + 全部副本级联删除）。模板不提供「取消这一天」；普通任务的清除照旧直接执行。
- **副本时间改动的确认**：对重复系列的任意成员（副本**或模板**）做时间改动（周视图拖拽移动/缩放或详情面板编辑）都会弹确认。副本：「只改这一个并解绑」（`update` + `originTaskId:null`）或「改所有副本」；模板：「同步所有副本（含模板）」（`shiftRepeatTimes` 以模板 id 为系列根）或「只改模板」（现有副本不动、未来新副本用新时间）。普通任务直接提交。
- **触发 Agent（可选，commit 本轮）**：重复规则可勾「到点触发 Agent」——物化的每个副本带一次性 `dueAt`（默认=任务时间段开始；规则可再设 `triggerAt` HH:MM 覆盖），到点经现有一次性调度自动执行、跑完自动清除该副本的调度（🕐 徽标消失）。不勾则副本只是日历条目，可手动「立即执行」。
- **节假日**：`src/core/repeat.ts` 内置「周末 + 中国法定节假日（2025 官方 / 2026 预估）」集合，`skipHolidays` 开启时跳过（周六周日照跳，周几自选的场景也受此约束——选了周末又开跳过 = 永不物化）。
- **执行设置目录**：Host `/api/calendar/options` 聚合 workspaces / sessions（项目分组、归档排除）/ providers+models / **modes**（`agentPresets.list` → `name ?? id`，剔除 `broken`）；客户端经 `watchCatalogRefresh` 在会话列表变更或日历打开时防抖重拉（见 §9）。
