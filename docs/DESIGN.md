# dsh-calender 设计规范（Design Spec）

> 现代、美观、克制。嵌入 DSH 聊天 GUI 的效率工具，全量使用 DSH `--dsw-*` 语义 token，无第三方 UI 框架。

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

## 2. 布局

- **头部**：标题（16px/700）· 视图切换（week / month / matrix / agenda，segmented 控件）· 今天 · 搜索 · 新建按钮（primary）。
- **主体**：左日历区域（flex:1，最小宽度约束）+ 右侧 320px 面板（任务详情 / 议程；选中任务时滑出）。窄屏（<720px）右侧面板降为 overlay，宽度 ≤ 视口，内部滚动。

## 3. 周视图（WeekGrid）

- 7 列（周一开头；周末列用 `bg-layer-2` 淡色区分）+ 时间轴（00:00–24:00，30 分钟吸附，可配 15/60）。
- 时隙 hover：`--dsw-alias-interactive-bg-hover`；拖选区间：`--dsw-static-deepseek-200` 底 + `deepseek-500` 2px 边框 + 圆角 6px。
- 现在线：`--dsw-static-red-500` 1px 实线 + 红点。
- 今日列：日期数字用 `--dsw-alias-brand-primary` 圆形强调。
- 任务块：圆角 8px、背景 `--dsw-alias-bg-layer-1`、1px 边框 `border-l1`；左缘 3px 象限色条 + 顶部 2px 细色条；悬停阴影 `--dsw-alias-bg-mask-1`；支持移动（pointer drag）与上下拉伸（top/bottom handle）。
- 同列冲突：块按时间分段并排（不重叠）。

## 4. 艾森豪威尔象限配色语言

| 象限 | 语义 | 主色 | 底色 | 用途 |
|---|---|---|---|---|
| do | 紧急×重要 | `--dsw-static-deepseek-500` | `--dsw-static-deepseek-100` | 立即做 |
| schedule | 重要 | `--dsw-static-blue-500` | `--dsw-static-blue-100` | 排期 |
| delegate | 紧急 | `--dsw-static-amber-500` | `--dsw-static-amber-100` | 委托 |
| eliminate | 低优先 | `--dsw-alias-label-tertiary` | `--dsw-alias-bg-layer-2` | 丢弃 |

- 矩阵面板（MatrixPanel）：2×2 象限格，象限边框用主色（1px，悬停 2px）；**象限内拖拽即改优先级**（pointer 拖放，释放后提交 update action）。
- 四象限在网格块上以色条呈现，色彩语言全局一致。

## 5. 组件细节

- **任务块徽标**：右上角可选 `provider·model` 微徽标（`--dsw-alias-state-business-tertiary` 底，10-11px）；定时钟形图标（amber）；子任务进度 `✓ 2/5`（12px tertiary）。
- **子任务**：详情面板折叠 checklist；勾选用自定义 checkbox（`--dsw-alias-brand-primary` 勾选态），勾选动画 200ms；父任务进度条（3px 圆角，`state-success-primary` 填充）。
- **表单控件**：输入 `--dsw-specific-input-major` 底、`border-l2` 边、圆角 8px、focus `--dsw-alias-brand-primary` 2px 描边；选择器（工作区/会话/provider/预设/权限）为下拉 + 徽标预览；定时 cron 输入 + 预设按钮组（每天09:00/每小时/每10分钟/每周一09:00）。
- **弹窗/抽屉**：`--dsw-alias-bg-layer-2` 底、`border-l2` 边、圆角 12px、阴影 `--dsw-alias-bg-mask-3`；Escape 关闭。
- **按钮**：primary = `--dsw-alias-button-primary-fill`（hover `-hover`）；ghost = 透明 + `border-l2`；danger = `--dsw-alias-state-error-primary`。

## 6. 动效与可访问性

- 动画仅用于 hover/focus/展开/状态切换，200ms + `--ds-ease-in-out`；`prefers-reduced-motion: reduce` 时全部关闭。
- 键盘：网格方向键移动选区、Enter 打开、Escape 关浮层；`:focus-visible` 可见焦点；所有图标按钮 `aria-label`。
- 语义：任务块 `role="button"` 或真实 button；象限为 `role="group"` + `aria-label`。
- 对比度：文字用 label 语义 token（保证当前主题下可读），不自行调色。

## 7. 响应式

- 宽屏（≥720px）：网格 + 右面板。
- 窄屏（<720px）：右面板 overlay；月视图为网格的补充视图；议程列表兜底。
- 侧边栏折叠 rail：入口纯图标（16px 居中），宽度自适应 `[data-dsh-frame][data-sidebar-collapsed]`。

## 8. 样式归属

所有样式在 `src/client/calender.module.css`（CSS Modules，由 build 预设内联注入 `<style data-plugin>`）；全局规则仅限中间列接管（`[data-dsh-calender-view]`、`html[data-dsh-calender-active]` 遮蔽对话子树），全部以插件自有 data 属性作用域，不泄漏到 GUI。
