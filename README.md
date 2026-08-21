# dsh-calendar

> Host 调度相关代码修改后，需要重新构建并重启 dsh web；仅刷新浏览器不会替换已加载的 Host bundle。runner 兼容 dsh-commands rc.6/rc.7 的三参数和 rc.8 的四参数命令签名；setup 失败会写入执行失败记录，不会静默运行。

一个可热插拔的 DeepSeek Harness (DSH) Web GUI 日历待办插件：侧边栏「日历」入口 → 中间列日历视图；**拖选时间段**建任务；**艾森豪威尔紧急/重要矩阵**；**子任务**；任务可**钉住执行会话与 LLM provider**；**定时让 LLM 响应**（Host 权威调度，浏览器关闭仍生效）。

> 开发中。文档见 [`memory-bank/development-plan.md`](memory-bank/development-plan.md)（计划）与 [`memory-bank/DESIGN.md`](memory-bank/DESIGN.md)（设计规范）。

## 功能

- 周视图时间网格**拖选/点击**创建任务，块可移动/拉伸。
- 紧急/重要三级 → 四象限配色；矩阵面板象限拖拽改优先级。
- 主任务挂子任务（进度汇总）。
- 任务钉住执行目标：工作区、执行会话（新建/复用）、LLM provider+model、agent 预设、权限；provider 与 model 必须同时填写或同时留空，保存时由 Host 拒绝不完整配置；执行前应用、失败即关闭。
- **Host 定时调度**：受限重复（**每日/每周周几** + 跳过周末与节假日开关）把模板日期作为首个 occurrence，之后把任务**拷贝到各匹配日期**（副本可单独完成/解绑），或**一次性到时**自动执行并结算；浏览器关闭仍生效；Host 重启按会话现状对账。无自由 cron 输入。
- **调度安全与可观测性**：定时 Agent 可以创建普通待办；自动触发子任务受「设置 → 插件 → calendar」中的 `maxScheduledDepth` 限制，默认 `0`（禁止递归），最大 `3`，设置变更实时由 Host 生效。Host 将自动触发任务的深度写入账本，重启后仍按同一深度判断；勾选 `triggerAgent` 时，匹配的模板首日和后续副本都会触发，留空 `triggerAt` 使用任务块开始时间；错过的一次性 dueAt 或重复首日记录为失败，不补跑。执行 setup 失败最多尝试 3 次（首次 + 2 次重试），耗尽后停止当前 occurrence；重复规则只物化当前/未来实例，错过的实例不补跑。执行 session 在 prompt 前写入 ledger，失败/重试会显示在任务状态与执行记录中。
- **拖动与定时解耦**：移动任务会提交 Host `reschedule`。重复模板/副本按重复规则重算触发时间；普通一次性任务保留已有绝对 `dueAt`，已经完成或失败的一次性定时不会因为拖动而隐式重新武装。拖到过去只移动日历块，不补跑、不新增失败记录；重复规则的固定 `triggerAt` 与任务块时间解耦，改块只改变对应日期，空白 `triggerAt` 才跟随块开始。重复任务选择「改所有副本」时只改未来副本，过去副本和历史执行不重写；Host 快照中的 schedule、`nextRunAt`、重试计数和 executions 是展示与运行的同一来源。
- **重复 occurrence 级取消**：点击重复任务的「清除定时」可选择「取消这一天」或「取消整个系列」；取消模板当天会保留重复规则并记录该日期为跳过，取消副本当天则清除其触发或移除普通副本，未来 occurrence 不受影响。模板当天的 🕐 徽标也会随 occurrence 一起消失，未来副本的定时状态保留；Host/client 代码更新后需要重启 dsh web 才会同时生效。
- **重复系列操作范围一致**：点击「删除」同样会选择「删除本条」或「删除整个系列」；副本级删除只移除当天副本，模板级删除只记录当天 `deletedDates` 并保留未来系列，系列级删除才级联移除模板与绑定副本。完成/立即执行/归档/恢复仍是 occurrence 级，模板内容/象限/子任务结构按既有同步规则传播，时间与清除定时继续使用同一套范围确认。
- **Host/UI 一致性**：Host ledger 是唯一执行真相；`revision` 随账本持久化，Host 正常重启后不会重置，浏览器经 SSE/轮询读取快照并只接受不下降的 revision。页面刷新只会清空客户端内存基线，首次 Host 快照会重新建立基线。页面断线或当前日期视图不匹配时，UI 可能暂时看不到任务，但不会阻止后台调度；可用 `calendar_task list/get` 核对 Host 状态。
- 「设置 → 插件 → 日历」配置卡（默认收起，点击标题展开；当前提供 `maxScheduledDepth`，默认 `0`、范围 `0..3`）+ SystemPrompt 播报，随 `--dsw-*` token 适配深浅/皮肤。

## 安装

```sh
# 从工作区挂载（自动注册为 profile bundle）
dsh plugin --profile web add link:<本目录>
# 重启 dsh web 后生效（页面刷新不够）
```

## 构建与测试

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build   # → lib/index.js + lib/client.js + lib/types
```

## 目录结构

见 `AGENTS.md`。
## 开发进度
M0–M6 已完成：日历 UI / 任务编辑 / 真实执行（host-runner）/ Host 定时调度（host-scheduler + SSE）/ 完善（设置卡 `calendar` 命名空间 + SystemPrompt 段 + `scripts/dsh-calendar.js` CLI）。M7 日历 Tool 已交付；M7 后多轮 UI 迭代与定时模型重构（受限重复替代 cron）见 `memory-bank/progress.md`。

## CLI
`node scripts/dsh-calendar.js status|mount|unmount [--profile P]`

## 日历 Tool（M7）

执行模式留空时，新建 session 使用部署默认模式，复用已有 session 沿用 session 当前模式；显式模式只允许新建或仍为空白的 session，已开始 session 若模式一致则跳过切换，不一致则拒绝执行。递归自动触发上限直接在「设置 → 插件 → calendar」配置，默认深度 `0`、最大 `3`，无需新增日历页面设置入口。

`calendar_task`：对话中 LLM 可直接建/查/改/删任务、管理子任务、设置每日/每周重复或一次到时、钉执行钉子或触发真实 run，与日历视图共享同一 authoritative ledger（HostLedger.apply，request-id 幂等）。`create` 可在同一调用中原子携带 schedule；provider 与 model 必须同时填写或同时留空，Host 在 create/update 保存时拒绝不完整配置；`options` 返回实时 provider/model/session 目录，`sessionId:"current"` 指向当前 Agent 会话；时间支持毫秒时间戳或带时区的 ISO-8601。一次性 `dueAt` 自动触发 Agent；重复规则勾选 `triggerAgent` 时，匹配的模板日期是首个触发点，后续物化副本也会触发，留空 `triggerAt` 按任务块开始；Host 恢复时若一次性 dueAt 或重复首日已过，会记录失败并不补跑；执行 setup 失败最多尝试 3 次（首次 + 2 次重试），耗尽后停止当前 occurrence；重复规则只物化当前/未来实例，错过的重复实例不补跑。由定时触发的 Agent 可以创建普通待办；创建或通过 `setSchedule` 武装自动触发子任务时，Host 按「设置 → 插件 → calendar」的 `maxScheduledDepth` 判定，深度 `0` 默认拒绝，最多允许到深度 `3`，拒绝不会产生隐藏任务或后台执行。`list` 支持 `fromAt/toAt` 时间范围（半开区间）、`dateBy`（scheduled/completed/created/updated/executed）、完成状态、session、project/workspace、provider/model 和 `llm`（any/only/none）过滤；结果包含 `completedAt`、`scheduled`、`autoRun`、`hasLlm` 与执行记录，便于查询今日安排、今日完成和指定会话/模型的工作。`scheduled=true` 只表示启用了日历调度；`autoRun=true` 才表示到点会实际触发 Agent，因此普通重复提醒可以是 `scheduled=true, autoRun=false`。带 `fromAt/toAt` 的 `list` 只返回时间窗内的 executions，同时用 `executionCount/totalExecutionCount` 区分窗口结果与历史总数；每条记录的 `triggeredBy` 标记 `manual` 或 `schedule`，旧记录可能为 `null`。`llm:none` 表示没有 Prompt、执行记录、Agent 触发或执行钉子，是布置给自己的任务。工具返回的任务摘要会将 schedule/repeat 的可选字段规范化为严格 JSON，带重复规则的任务也可以正常 list/get；schedule 摘要包含 `maxAttempts` 与当前 `retryCount`（如有）。依赖 `@deepseek-ai/dsh-tools`。
