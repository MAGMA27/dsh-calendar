# dsh-calendar 验收清单（Acceptance Checklist）

> 用途：一项功能/一个里程碑交付后，按本清单逐项验收。验收基线、挂载、GUI 与 Host/工具行为全部列出；每项通过打 ✓ 并记日期。
> 里程碑代码：M0 脚手架 / M1 领域+Host 骨架 / M2 日历 UI / M3 任务编辑 / M4 真实执行 / M5 Host cron 定时调度 / M6 完善 / M7 日历 Tool。
> 交付提交：M4 d3f8660 · M5 660b6f5 · M6 61f6f28 · M7 15a5a6d（另有各档 docs 提交）。
> 重命名：970d53b（dsh-calender→dsh-calendar，验收之前全部改为新拼写）；后续 UI 迭代见 progress.md「M7 之后的 UI 迭代提交表」。

---

## 0. 基线（每次改动后必跑）
- [x] `pnpm typecheck` 通过
- [x] `pnpm build` 通过（产出 lib/index.js 与 lib/client.js）
- [x] `pnpm test` 全绿 = **214 单测**（vitest run，24 个测试文件）
- [x] 工作树 git 干净，提交信息遵循 Conventional Commits

## 1. 挂载 / 生效 / 数据位置
- [x] `dsh plugin --profile web add link:D:\Dev\agents\dsh-calendar` 成功（自动对账 dsh.profile.bundles）
- [x] `dsh --profile web --dump-config` 出现 ui-calendar 层
- [x] **重启 dsh web 进程**后插件上线（页面刷新不够；host/client 改动都需重启）
- [x] 侧边栏出现「日历」入口，点击后中间列切换为日历视图
- [x] 卸载（`dsh plugin --profile web remove dsh-calendar`）后 GUI 恢复原状、无崩溃
- [x] 账本 $DSH_HOME/calendar/ledger-v1.json 存在且随操作更新
- [x] API 冒烟：GET /api/calendar/state 返回带 schemaVersion/revision/tasks/scheduler 的 snapshot

## 2. M0–M3 日历与任务编辑（GUI 手测）
- [x] 周视图**拖选时间段**新建任务，起止自动预填
- [x] 周视图：任务块**移动 / 拉伸**调时间；顶部 sticky 表头（周几+日期）；**重叠任务并排**不遮盖
- [x] 周/月视图已完成任务与未完成任务有明确视觉区分（灰化、降低透明度、虚线边框、删除线）
- [x] 周/月视图「今天」按钮可用；矩阵/议程视图正确分组（含「已完成」组）
- [x] 矩阵任务卡显示日期；重复系列取最旧未完成项，过期项显示红色「已过期」标记
- [x] 议程重复系列按最旧未完成项正确归入「已过期 / 今天 / 近期」
- [x] 主任务挂**子任务**：添加/勾选完成/删除 + 进度汇总
- [x] **艾森豪威尔矩阵**四象限显示 + 象限间**拖拽改紧急/重要**
- [x] 详情面板：改标题/描述/Prompt、象限 knobs、定时（受限重复：每日/每周 + 跳过节假日，或一次到时 + 下次运行显示）、保存
- [x] 执行设置下拉：**provider→model 联动**、工作区→会话**二级分组 + 级联**、隐藏归档会话、会话显示**真实标题**
- [x] 归档/恢复/删除、定时清除（周视图定时徽标随之消失）

## 3. M4 真实执行
- [x] 任务块出现 **provider/model 徽标**；有未结算执行时出现**「执行中」徽标**
- [x] 详情面板「立即执行」真正驱动 host-runner（建/复用会话 → 应用钉子 → prompt）
- [x] 执行钉子**失败即关闭**：无效会话忙碌 / provider 缺 model 等 → 记 enforced failed，不发 Prompt
- [x] **执行记录**写回任务（时间 + result: succeeded/failed/cancelled）并即时刷新视图
- [x] 执行记录里 **「打开会话」**跳转到对应 dsh 会话

## 4. M5 定时调度（2026 已由「受限重复 + 一次性」模型替换 cron，见 §7.7）
- [x] **一次性** dueAt 到点**自动触发**真实执行并结算；执行完成后调度整体清除（徽标消失）
- [x] 执行中任务**不被重复触发**（被拒=保留到期槽，下一周期重试，不漏跑）
- [x] **浏览器/标签页关闭后仍生效**（Host 调度）
- [x] **Host 重启对账**：遗留 running 执行按会话现状结算（消失→cancelled / 已停→succeeded）
- [x] 账本变更经 **SSE 广播**（/events），打开的日历视图 /state 自动刷新（含定时触发与执行结算）

## 5. M6 完善
- [ ] 设置里出现「插件」区 **calendar 设置卡**（announceToAgent / enabled 两个开关）
- [ ] 关闭 announceToAgent 后 **SystemPrompt 段实时消失**（无需重启）
- [ ] agent system prompt 能看到 plugin:calendar 宣告段
- [ ] `node scripts/dsh-calendar.js status|mount|unmount` 可用
- [ ] README / DESIGN / 进度 / 架构文档与当前实现一致

## 6. M7 日历 Tool
- [ ] Host 已注册 calendar_task tool（ctx.tools.register），命令区/对话中 agent 可见 schema
- [ ] 对话里让 agent（或用户指令）**创建任务** → 日历视图即时出现（账本同步）
- [ ] 查（list/get）、改（update/优先级/完成）、**子任务**增改删、**定时**（每日/每周重复或一次到时）
- [ ] 执行钉子（provider/model/预设/权限）随 create/update 生效
- [ ] `run` 触发真实执行（经 host-runner）
- [ ] 与 UI 操作**共享同一账本与幂等**（无分身数据源）
- [ ] 非法 action（enum 外）被 schema 校验**在 execute 前拒绝**

## 7.5 重命名与 UI/交互迭代（dsh-calender→dsh-calendar 之后）
- [x] 仓库/包/文档全部 `dsh-calendar` 拼写；文件夹位于 `D:\Dev\agents\dsh-calendar`
- [x] 账本已迁移 `~/.dsh/calender` → `~/.dsh/calendar`；profile 重挂 `ui-calendar`；重启 dsh web 生效
- [x] 周视图任务块显示时间段（右上角、与标题并排、标题优先）
- [x] 周视图网格加深、整点横线可见
- [x] 可折叠「显示时段」+ 支持跨午夜时段（如 11:00–02:00），窗口放大铺满网格
- [x] 矩阵四象限「立即做」红色；矩阵/议程任务卡片含时间/徽标/进度条/描述
- [x] 议程分组卡片化（色点+计数）、阴影加深
- [x] 月视图任务条上下左右边框齐全
- [x] 周视图拖拽**跟手**：抓取点保持相对位置（不飘在块上方）

## 7.6 分支 `feature/calendar-slot-view` 尾段（近期 UI/宿主修复）
- [x] 入口样式 1:1 对齐 Settings 触发按钮；rail 圆钮走 `wide` prop
- [x] 会话跳转自动关日历；侧边栏点会话（含**点当前会话**）自动关日历（`navigation-watch.ts` 两层）
- [x] 搜索栏**整体移除**（曾实现 `taskMatchesQuery` 过滤，复测无用后删除）
- [x] 月视图日期样式：日期 18px/700、每月 1 号旁标月份短名（`label-secondary`）、今天品牌蓝圆底白字
- [x] 矩阵标题 18px/700 黑色 + 3px 象限色横条 + 计数徽标
- [x] 执行设置「预设」为下拉：Host 读 `agentPresets.list` 投影 `catalog.modes`（name 标签、剔除 broken）；用户已能选中 preset 钉进任务
- [x] 执行任务**可复用现有会话**：runner face 修正 `agentPresets`（复数）域名后，钉会话任务不再误报「deployment does not support agent presets」
- [x] 权限钉子经**命令注册表**执行（`/permission <preset>` 不再作为普通消息发给模型）
- [x] 会话目录**实时刷新**（`watchCatalogRefresh` 修复后待重启复测：新建会话应即时出现在下拉）
- [x] one-shot 定时完成后**自动清除调度**（修复后待复测：徽标/清除按钮/到时消失）

## 7.7 受限重复规则替代 cron（2026，分支 `feature/calendar-slot-view`）
- [x] **无自由 cron 输入**：定时面板只有「不重复 / 每日 / 每周」+ 周几多选 + 「跳过周末与节假日」开关 + 「到点触发 Agent」（+ 不重复模式的一次到时）
- [x] 设了重复后，任务被**拷贝到各匹配日期**（副本是普通任务，↻ 徽标标记；模板当天不产生副本）
- [x] **取消定时（清除重复规则）→ 全部副本消失**；删除模板亦然；**重启后**旧的孤儿副本被自动清理（当前账本 50 个孤儿副本应消失）
- [ ] **副本与原任务保持同步**：改模板的标题/描述/Prompt/象限/执行钉子/子任务结构 → 所有副本跟着更新；各副本的完成态与执行记录独立；改单个副本只影响它自己
- [x] **减少重复日清除副本**：重复规则从宽改窄（每日→每周 1-5、或开启跳过节假日）后，不再匹配日期的已物化副本被清除（`alignSeries`，含归档副本），重新勾回这些天会重新物化；增加重复日（变宽）不受影响
- [x] **副本定时区与原版一致**：副本详情「定时」区显示系列规则（每日/每周+触发），提示「作用于整个重复系列」；**在任一副本上取消重复 → 取消未来所有重复**（系列规则清除 + 全部副本消失，含当前副本）
- [ ] **触发 Agent 开关联动**：在副本上关掉/改「触发时间」→ 已物化未来副本的 🕐/到时随之更新；已过去的副本不受影响
- [ ] 副本时间（拖拽移动/缩放）改动**必弹确认**：「只改这一个并解绑」（↻ 消失、独立于模板）或「改所有副本」（模板+全部副本同步平移）；**模板**拖拽同样弹确认（同步所有副本 / 只改模板）
- [ ] **触发 Agent**：勾选后每个副本带 🕐，到点（默认任务时间段开始，可设「触发时间」覆盖）自动执行并结算、跑完该副本调度清除；不勾则副本只是日历条目
- [ ] **跳过节假日**生效：周末 + 中国法定节假日（内置 2025 官方 / 2026 预估）不物化
- [ ] 删除某一天的副本后**不会被重新补回**；删除重复**模板**级联删除仍绑定的副本（解绑副本保留）
- [ ] **取消定时弹确认**：「取消这一天」（带触发到时的副本清掉该到时并保留；普通副本移除当天；系列不动）或「取消整个系列」；模板只提供后者

## 7. 安全 / 回归 / 边界
- [ ] 客户端 apply **未访问任何未 inject 的 Cordis 服务**（避免 cannot get property 崩溃回归）
- [ ] 账本原子写入 + 锁 + request-id 幂等；损坏文件改名保留、以空账本启动
- [ ] POST 仅 JSON、普通 ≤64KiB / import ≤2MiB；action 无 shell 命令/可执行路径
- [ ] 定时执行真实消耗 LLM 额度——验收时先用一两次手动 run / 短周期验证，避免昂贵的定时全集
- [ ] 与 dsh-web-ui-all 共存（独立命名/DOM/存储；面板互斥）无冲突

---

### 验收记录
| 日期 | 条目 | 结果 | 备注 |
|---|---|---|---|
|  |  |  |  |
