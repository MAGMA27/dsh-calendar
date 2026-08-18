# dsh-calender 验收清单（Acceptance Checklist）

> 用途：一项功能/一个里程碑交付后，按本清单逐项验收。验收基线、挂载、GUI 与 Host/工具行为全部列出；每项通过打 ✓ 并记日期。
> 里程碑代码：M0 脚手架 / M1 领域+Host 骨架 / M2 日历 UI / M3 任务编辑 / M4 真实执行 / M5 Host cron 定时调度 / M6 完善 / M7 日历 Tool。
> 交付提交：M4 d3f8660 · M5 660b6f5 · M6 61f6f28 · M7 15a5a6d（另有各档 docs 提交）。

---

## 0. 基线（每次改动后必跑）
- [ ] `pnpm typecheck` 通过
- [ ] `pnpm build` 通过（产出 lib/index.js 与 lib/client.js）
- [ ] `pnpm test` 全绿 = **113 单测**（vitest run）
- [ ] 工作树 git 干净，提交信息遵循 Conventional Commits

## 1. 挂载 / 生效 / 数据位置
- [ ] `dsh plugin --profile web add link:D:\Dev\agents\dsh-calender` 成功（自动对账 dsh.profile.bundles）
- [ ] `dsh --profile web --dump-config` 出现 ui-calender 层
- [ ] **重启 dsh web 进程**后插件上线（页面刷新不够；host/client 改动都需重启）
- [ ] 侧边栏出现「日历」入口，点击后中间列切换为日历视图
- [ ] 卸载（`dsh plugin --profile web remove dsh-calender`）后 GUI 恢复原状、无崩溃
- [ ] 账本 $DSH_HOME/calender/ledger-v1.json 存在且随操作更新
- [ ] API 冒烟：GET /api/calender/state 返回带 schemaVersion/revision/tasks/scheduler 的 snapshot

## 2. M0–M3 日历与任务编辑（GUI 手测）
- [ ] 周视图**拖选时间段**新建任务，起止自动预填
- [ ] 周视图：任务块**移动 / 拉伸**调时间；顶部 sticky 表头（周几+日期）；**重叠任务并排**不遮盖
- [ ] 周/月视图「今天」按钮可用；矩阵/议程视图正确分组（含「已完成」组）
- [ ] 主任务挂**子任务**：添加/勾选完成/删除 + 进度汇总
- [ ] **艾森豪威尔矩阵**四象限显示 + 象限间**拖拽改紧急/重要**
- [ ] 详情面板：改标题/描述/Prompt、象限 knobs、定时（cron/一次到时 + 下次运行显示）、保存
- [ ] 执行设置下拉：**provider→model 联动**、工作区→会话**二级分组 + 级联**、隐藏归档会话、会话显示**真实标题**
- [ ] 归档/恢复/删除、定时清除（周视图定时徽标随之消失）

## 3. M4 真实执行
- [ ] 任务块出现 **provider/model 徽标**；有未结算执行时出现**「执行中」徽标**
- [ ] 详情面板「立即执行」真正驱动 host-runner（建/复用会话 → 应用钉子 → prompt）
- [ ] 执行钉子**失败即关闭**：无效会话忙碌 / provider 缺 model 等 → 记 enforced failed，不发 Prompt
- [ ] **执行记录**写回任务（时间 + result: succeeded/failed/cancelled）并即时刷新视图
- [ ] 执行记录里 **「打开会话」**跳转到对应 dsh 会话

## 4. M5 Host cron 定时调度
- [ ] 任务设 cron（如 `0 9 * * *`）在到期点**自动触发**真实执行并结算
- [ ] 执行中任务**不被重复触发**（被拒=保留到期槽，下一周期重试，不漏跑）
- [ ] **浏览器/标签页关闭后仍生效**（Host 调度）
- [ ] **Host 重启对账**：遗留 running 执行按会话现状结算（消失→cancelled / 已停→succeeded）
- [ ] 账本变更经 **SSE 广播**（/events），打开的日历视图 /state 自动刷新（含定时触发与执行结算）

## 5. M6 完善
- [ ] 设置里出现「插件」区 **calender 设置卡**（announceToAgent / enabled 两个开关）
- [ ] 关闭 announceToAgent 后 **SystemPrompt 段实时消失**（无需重启）
- [ ] agent system prompt 能看到 plugin:calender 宣告段
- [ ] `node scripts/dsh-calender.js status|mount|unmount` 可用
- [ ] README / DESIGN / 进度 / 架构文档与当前实现一致

## 6. M7 日历 Tool
- [ ] Host 已注册 calender_task tool（ctx.tools.register），命令区/对话中 agent 可见 schema
- [ ] 对话里让 agent（或用户指令）**创建任务** → 日历视图即时出现（账本同步）
- [ ] 查（list/get）、改（update/优先级/完成）、**子任务**增改删、**定时**（cron/一次到时）
- [ ] 执行钉子（provider/model/预设/权限）随 create/update 生效
- [ ] `run` 触发真实执行（经 host-runner）
- [ ] 与 UI 操作**共享同一账本与幂等**（无分身数据源）
- [ ] 非法 action（enum 外）被 schema 校验**在 execute 前拒绝**

## 7. 安全 / 回归 / 边界
- [ ] 客户端 apply **未访问任何未 inject 的 Cordis 服务**（避免 cannot get property 崩溃回归）
- [ ] 账本原子写入 + 锁 + request-id 幂等；损坏文件改名保留、以空账本启动
- [ ] POST 仅 JSON、普通 ≤64KiB / import ≤2MiB；action 无 shell 命令/可执行路径
- [ ] 定时执行真实消耗 LLM 额度——验收时先用一两次手动 run / 短周期验证，避免昂贵 cron 全集
- [ ] 与 dsh-web-ui-all 共存（独立命名/DOM/存储；面板互斥）无冲突

---

### 验收记录
| 日期 | 条目 | 结果 | 备注 |
|---|---|---|---|
|  |  |  |  |
