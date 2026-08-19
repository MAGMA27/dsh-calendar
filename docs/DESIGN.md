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

- **头部**：标题（16px/700）· 视图切换（week / month / matrix / agenda，segmented 控件）· 今天 · 搜索 · 新建按钮（primary）。
- **主体（M2 现状）**：整块日历区（无右侧常驻面板）；新建走浮层弹窗；选中任务通过 `controller.selectTask` 记录（供 M3 详情面板消费）。
- **主体（M3 已实现）**：左日历（flex:1）+ 右侧 320px **TaskDetailPanel**（选中任务时展开于 calendarBodyWithPanel 右侧，flex 布局、内部滚动）。宽屏常驻、窄屏仍为右列面板（内置滚动，宽度 340px）。

## 3. 周视图（WeekGrid）**[M2 已实现]**

- 顶部 sticky 表头行：周一~周日 + 日期数字，今日圆形高亮；然后 7 列（周一开头；周末列 `bg-layer-2` 淡色）+ 24h 时间轴；30 分钟吸附（可配 15/60）。
- **重叠任务并排**：同列重合的任务按 `layoutDayTasks` 分配到并排子列，互不遮盖（保留 2px 间隙）。
- 拖选（pointerdown→move→up）→ `controller.setDraft` 打开创建弹窗；选中态 `--dsw-static-deepseek-200` 底 + deepseek-500 2px 边框 + 圆角 6px。
- 现在线 `--dsw-static-red-500`（今日列）；今日日期数字 `brand-primary` 圆形强调。
- 任务块：圆角 8px、`bg-layer-1` 底、1px `border-l1`；左缘 3px 象限色条；标题 + 徽标行。M2 单列块（leftPct=0,widthPct=100）；同列并排、块移动/拉伸为增强项。

## 4. 艾森豪威尔象限配色语言

| 象限 | 语义 | 主色 | 底色 | 用途 |
|---|---|---|---|---|
| do | 紧急×重要 | `--dsw-static-deepseek-500` | `--dsw-static-deepseek-100` | 立即做 |
| schedule | 重要 | `--dsw-static-blue-500` | `--dsw-static-blue-100` | 排期 |
| delegate | 紧急 | `--dsw-static-amber-500` | `--dsw-static-amber-100` | 委托 |
| eliminate | 低优先 | `--dsw-alias-label-tertiary` | `--dsw-alias-bg-layer-2` | 丢弃 |

- **矩阵面板（M2 已实现）**：2×2 象限格，边框用主色；按 `quadrantOf` 分组展示；点任务选中。
- **象限拖拽改优先级（M3 已实现）**：任务块 draggable，拖放到另一象限（dataTransfer 携带任务 id）→ dispatch setQuadrant；悬停象限高亮 matrixOver。

## 5. 组件细节

### 5.1 任务块徽标 **[M2 已实现]**
小徽标行：子任务 `✓ 2/5`（12px tertiary）；可选 `provider·model`（`--dsw-alias-state-business-tertiary` 底，10-11px）；定时钟形（amber）。

### 5.2 任务详情面板 TaskDetailPanel **[M3 已实现；第 6/7 项增强]**
选中任务滑出的右侧 320px 面板：
1. 标题 + 完成勾选（`brand-primary` 勾选态）。
2. 描述 / Prompt：只读展示 + 编辑入口。
3. 艾森豪威尔 knobs：紧急/重要选择，改即 `setQuadrant`。
4. 子任务 checklist：勾选 `setSubtaskDone`；新增/删除；父任务进度条（3px 圆角、`state-success-primary` 填充）。
5. 执行设置 ExecutionSettings：工作区 / 执行会话（新建或复用）/ **provider + model + reasoningEffort** / agent 预设 / 权限；下拉 + 徽标预览；留空 = 运行时默认。
6. 定时：启用开关 + 5 段 cron + 预设按钮组（每天09:00/每小时/每10分钟/每周一09:00）+ 下次运行。
7. 执行记录 + 会话跳转（M4）：sessionId/起止/结果/错误；「查看会话」跳 transcript。
8. 删除 / 归档（danger 按钮）。

### 5.3 创建/编辑弹窗 CreateTaskModal **[M3 已实现]**
拖选或"新建"触发的居中弹窗（`bg-layer-2` 底、`border-l2` 边、圆角 12px、阴影 `bg-mask-3`、Escape 关闭）：预填起止、标题、紧急/重要、创建/取消。已扩展为完整表单：标题、描述、Prompt、紧急/重要、子任务（回车添加）、定时（cron + 一次到时）、执行设置、创建/取消。

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

## 10. 视图增强（commit `c5ec7b1`）

- **任务搜索**：顶栏搜索框真正可用——`core/tasks.ts` 的 `taskMatchesQuery(task, query)`（大小写不敏感匹配 title/description/prompt，空串匹配全部）；周/月/矩阵/议程四个视图均接 `query` prop 过滤各自任务源。
- **周/月日期导航 `DateNav`**：`‹ 期标签 › + 今天`。core `calendar.ts` 新增 `addDays / addMonths / sameMonth / monthLabel / weekRangeLabel`；`addMonths` 按目标月天数钳制日（1月31日+1月→2月28/29）。周视图步进 ±7 天、月视图 ±1 月；期标签带年份，`aria-live` 播报。
- **月视图**：顶部 sticky 周几表头（随 `weekStart` 周一起始）；`sameMonth` 判当前月，相邻月单元格 `data-outside` 变淡（背景 `bg-layer-1`、任务 chips 半透明）；`.monthWrap`（表头 + 可滚动 `.monthGrid`）替代原单一网格。**日期色带（commit `a003320`→`1659aa1`）**：横穿整格宽度的圆角横条 `.monthCellDateRow`、日期数字浮在其上——当前月品牌色（`brand-primary`）、相邻月灰色（`label-tertiary` 75%）、今天加品牌色外环，一眼区分本月与上月/下月。