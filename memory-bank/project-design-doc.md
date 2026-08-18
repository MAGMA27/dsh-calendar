# dsh-calender 项目设计文档（Product & Design Doc）

> 状态：已批准（2026 计划阶段）。本文件为产品需求 + 设计规范的持久记忆；正式交付版见 `docs/DESIGN.md`。

## 1. 产品定位

在 DeepSeek Harness (DSH) Web GUI 中新增**日历待办插件**：侧边栏「日历」入口 → 中间列日历视图；**拖选时间段**建任务；任务有**紧急/重要**（艾森豪威尔）、**子任务**、可**钉住执行会话与 LLM provider**、支持 **Host 定时让 LLM 响应**。

## 2. 功能需求

| 功能 | 说明 |
|---|---|
| 日历入口 | 侧边栏「新会话」下方入口，点击切换中间列；折叠 rail 纯图标 |
| 周视图拖选 | 7×24 时间网格，pointer 拖选时间段 → 预填起止时间新建任务；点空白格快捷新建；拖动/拉伸任务块改时间 |
| 月视图 | 任务块 + 计数；点日进周视图 |
| 艾森豪威尔 | 紧急/重要各三级 → 四象限（做/排期/委托/丢弃）；矩阵面板象限间拖拽改优先级；象限配色语义化 |
| 子任务 | 主任务挂子任务清单（勾选完成、进度汇总、可折叠） |
| 执行会话标记 | 任务可钉住工作区 + 执行会话（新建/复用指定会话） |
| LLM provider 标记 | 任务可钉住 provider + model + reasoningEffort；执行前 selectModel |
| 定时执行 | 绝对时间（来自拖选时段）或 5 段 cron；Host 调度器到点真实执行并结算；浏览器关闭仍生效 |
| 执行记录 | 每次运行记录 sessionId/起止/结果/错误；可跳转会话 transcript |
| 设置 | 插件设置卡（enabled/announceToAgent/snapInterval/weekStart/defaultView） |

## 3. 用户旅程（关键路径）

1. 点击侧边栏「日历」→ 周视图（今天所在周，现在线）。
2. 在周二 09:00–11:00 拖选 → 弹新建弹窗（预填时段）→ 填标题 + 紧急/重要 + 可选执行设置 → 创建。
3. 卡片出现在时段上；右下面板可展开详情：子任务、执行设置、定时、执行记录。
4. 勾选子任务 → 块上进度标签更新。
5. 到定时点 → Host 自动开新会话 → 应用钉住的 provider/预设/权限 → 发 Prompt → 结算回写。
6. 点执行记录「查看会话」→ 跳转真实 transcript。

## 4. 设计规范（Design Spec）

**Design Read**：嵌入 DSH 聊天 GUI 的效率工具，面向重度用户；calm minimalist（Linear 风格），全量使用 DSH `--dsw-*` token，无第三方 UI 框架。三旋钮：`VARIANCE 5`（干净网格 + 克制的层级差异）、`MOTION 3`（200ms 缓动，仅 hover/focus/展开）、`DENSITY 5`（日历网格需要密度，用留白与 8px 网格保证呼吸感）。规避 AI 默认病（无紫渐变、无泛玻璃拟态、无漂浮 3D 卡）。

### 4.1 布局
- 头部：标题 / 视图切换 week↔month↔matrix↔agenda / 今天 / 搜索 / 新建。
- 主体：左日历（flex:1）+ 右侧 320px 面板（详情/议程）；窄屏面板降为 overlay、内部滚动。

### 4.2 周网格
- 7 列（周一开头，周末列淡色）、垂直 24h、30 分钟吸附（可配 15/60）。
- 时隙 hover 高亮；`pointerdown→drag→pointerup` 选中区间（`--dsw-static-deepseek-200` 底 + deepseek-500 边）。
- 现在线；今日列强调；块移动/上下拉伸；块宽=列宽，同列冲突并排分段。

### 4.3 象限配色语言（艾森豪威尔）
| 象限 | 主色 | 底色 |
|---|---|---|
| do（紧急×重要） | `--dsw-static-deepseek-500` | `-100` |
| schedule（重要） | `--dsw-static-blue-500` | `-100` |
| delegate（紧急） | `--dsw-static-amber-500` | `-100` |
| eliminate | `--dsw-alias-label-tertiary` | `bg-layer-2` |

块左缘 3px 色条 + 顶部细色条；矩阵面板四象限同色系，象限间拖拽改优先级。

### 4.4 组件细节
- 子任务：详情面板折叠 checklist；块上 `✓ 2/5` 微标签。
- 徽标：块上可选 `provider·model` 微徽标（`--dsw-alias-state-business-tertiary` 底）、定时钟形（amber）。
- 文字：标题 16px/700、列头 13px/600、次级 12px；圆角 8px 控件 / 12px 卡片；间隙 8-12px；边框 `--dsw-alias-border-l1/l2`；输入 `--dsw-specific-input-major`；侧边栏入口 `--dsw-specific-sidebar-nav-item-*`。
- 动效/可访问性：仅 `--ds-transition-duration` + `--ds-ease-in-out`；`prefers-reduced-motion` 关闭；`:focus-visible`、`aria-label`、Escape 关浮层、网格键盘导航（方向键移动、Enter 打开）；深色随 `body[data-ds-dark-theme]` 自动。

### 4.5 借鉴的 UX 模式（调研）
- 拖选即建块：Timeslice。
- 点槽位弹创建弹窗：WeekToDo（手写 7×24 网格，无日历库）。
- 2D 象限拖拽改优先级：ToDo-Matrix。
- 后续增强：AI 建议-确认排程（un-schedule / ai-daily-planner）。
