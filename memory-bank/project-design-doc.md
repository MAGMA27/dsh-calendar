# dsh-calendar 项目设计文档（Product & Design Doc）

> 状态：已批准（计划阶段）+ 伴随里程碑演进。本文件为产品需求的持久记忆；正式设计规范见 `docs/DESIGN.md`（含实现状态标注）。

## 1. 产品定位

在 DeepSeek Harness (DSH) Web GUI 中新增**日历待办插件**：侧边栏「日历」入口 → 中间列日历视图；**拖选时间段**建任务；任务有**紧急/重要**（艾森豪威尔）、**子任务**、可**钉住执行会话与 LLM provider**、支持 **Host 定时让 LLM 响应**。

## 2. 功能需求（含实现状态）

| 功能 | 说明 | 状态 |
|---|---|---|
| 日历入口 | 侧边栏「新会话」下方入口；折叠 rail 纯图标 | ✅ M2 |
| 周视图拖选 | 7×24 网格 pointer 拖选 → 预填起止建任务；点空白格快捷新建 | ✅ M2 |
| 月视图 | 任务块+计数；点日进周视图 | ✅ M2 |
| 矩阵视图 | 2×2 象限分组展示 | ✅ M2 |
| 议程视图 | 过期/今天/近期分组列表 | ✅ M2 |
| 艾森豪威尔 | 紧急/重要各三级 → 四象限配色；象限拖拽改优先级 | ✅ M2（展示）+ ✅ M3（拖拽） |
| 子任务 | 主任务挂子任务清单（勾选/进度/折叠） | ✅ M3（列表/勾选/进度）；折叠为增强 |
| 执行会话标记 | 任务钉住工作区 + 执行会话（新建/复用） | ✅ M3（UI） |
| LLM provider 标记 | 任务钉住 provider + model + reasoningEffort；执行前 selectModel | ✅ M3（UI）+ M4（执行） |
| 定时执行 | 绝对时间（拖选时段）或 5 段 cron；Host 调度到点真实执行 | ✅ M3（UI）+ M5（调度） |
| 任务详情面板 | 右侧 320px：编辑/子任务/执行设置/定时/执行记录 | ✅ M3（执行记录展示） |
| 执行记录 | sessionId/起止/结果/错误；跳转会话 transcript | 🔜 M4 |
| 设置 | 插件设置卡（enabled/announceToAgent/snapInterval/weekStart/defaultView） | 🔜 M6 |

## 3. 用户旅程（关键路径）

1. 点击侧边栏「日历」→ 周视图（今天所在周，现在线）。
2. 在周二 09:00–11:00 拖选 → 弹新建弹窗（预填时段）→ 填标题 + 紧急/重要 → 创建。
3. 卡片出现在时段上；点卡片选中（M3 右侧详情面板滑出）。
4. 详情面板：编辑描述/Prompt、勾选子任务、设置执行钉子（工作区/会话/provider+model/预设/权限）、配置定时。
5. 到定时点 → Host 自动开新会话 → 应用钉住的 provider/预设/权限 → 发 Prompt → 结算回写。
6. 点执行记录「查看会话」→ 跳转真实 transcript。

## 4. 设计规范（Design Spec，详见 docs/DESIGN.md）

**Design Read**：嵌入 DSH 聊天 GUI 的效率工具，面向重度用户；calm minimalist（Linear 风格），全量使用 DSH `--dsw-*` token，无第三方 UI 框架。三旋钮：`VARIANCE 5 / MOTION 3 / DENSITY 5`。规避 AI 默认病。

### 4.1 布局
- 头部：标题 / 视图切换 week↔month↔matrix↔agenda / 今天 / 搜索 / 新建。
- 主体：左日历 + 右 320px 详情面板（选中任务展开；calendarBodyWithPanel flex）。

### 4.2 周网格（M2 已实现）
7 列（周一起始、周末淡色）× 24h；30 分钟吸附；拖选 `setDraft` → 创建弹窗；现在线；今日强调；任务块镶象限色条 + 徽标（子任务/provider·model/定时）。

### 4.3 象限配色语言（艾森豪威尔）
- do=deepseek-500/-100；schedule=blue-500/-100；delegate=amber-500/-100；eliminate=label-tertiary/bg-layer-2。
- 块左缘 3px 色条；矩阵四象限同色系；M3 象限拖拽改优先级。

### 4.4 组件细节
- 任务块徽标（M2）：`✓ done/total`、`provider·model`、定时钟；议程含子任务进度与定时徽标。
- TaskDetailPanel（M3）：标题+完成、描述/Prompt、艾森豪威尔 knobs、子任务 checklist+进度条、ExecutionSettings（工作区/会话/provider+model/预设/权限）、定时（cron+预设）、执行记录+会话跳转、删除/归档。
- CreateTaskModal（M3 已实现）：完整表单——起止/标题/描述/Prompt/紧急·重要/子任务/定时/执行设置。
- 文字/圆角/边框/输入/按钮：见 docs/DESIGN.md §5.4。

### 4.5 借鉴的 UX 模式（调研）
拖选即建块（Timeslice）；点槽弹创建弹窗（WeekToDo）；2D 象限拖拽（ToDo-Matrix）；AI 建议-确认排程为后续增强（un-schedule / ai-daily-planner）。
