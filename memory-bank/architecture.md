# dsh-calender 技术架构（Architecture）

> 状态：已批准。全部结论基于本机 rc.6 已安装包的 exports/types 逐层取证；关键参考：官方仓库 task-board 0.2.0（Host 权威模式）。

## 1. DSH 插件运行模型（已取证）

- **Bundle/Profile**：bundle = 作者分发包，`package.json.dsh.bundle.patch` 指向配置层 `cordis.patch.yml`（顶层数组 `- insert: {id, name}`）；profile = 用户运行组合，`$DSH_HOME/profiles/<name>/package.json.dsh.profile.bundles` 保存有序 bundle 列表。生效顺序：profile bundles → profile cordis.patch.yml → `$DSH_HOME/cordis.patch.yml` → `--patch`。
- **挂载**：`dsh plugin --profile web add link:<path>` = 在 profile 目录跑 `pnpm add`，成功后**自动对账 bundles**（依赖声明 `dsh.bundle` 即加入层）。无需手改 profile manifest。重启 dsh web 生效。
- **双面包**：host 半边 `exports "."`（节点进程，可注册 SystemPrompt 段、settings、HTTP route）；浏览器半边 `exports "./client"`（服务端扫 `dsh.client` 元数据后构建 hash 写入 `window.__DSH_BOOT__`，以 `/plugins/<id>/client.js` 提供）。`dsh.client.inject` 为信息性元数据；真正的依赖等待来自 client bundle 导出的 `export const inject`。
- **客户端 bundle 格式**：`window.__ModuleLoader__.load({ id, factory: (require) => {...} })`；CSS Modules 经 lightningcss 内联为 `<style data-plugin>`；外部化平台模块表（react/react-dom/cordis/ui-slots/web-react/ui-primitives/schema-form + `dsh-client-runtime/client` 豁免）。
- **构建**：tsdown + 官方 client bundle 预设（deepseek-harness `packages/client/tsdown.client.ts` = dsh-web-ui `shared/tsdown.client.ts`）；client purity gate 拒绝 `@deepseek-ai/*` 非平台模块的值导入。

## 2. 运行时 API（rc.6 签名）

- 浏览器：`ctx.sessions.list/binding(id).session.{rename,prompt,command,getSnapshot,subscribe}`、`ctx.workspaces.connectWorkspace`、`connection.api.sessions.{models,selectModel,history}`、`connection.api.agentPresets.{list,select}`。
- **客户端防御规则（重点）**：客户端 `apply(ctx)` 只能使用 `inject` 声明的服务 + 纯 DOM/transport；访问未声明的服务（如 `ctx.sessions` 等）会抛 `cannot get property X without inject` 导致整包加载失败、GUI 无法进入。因此所有 DSH 域数据（会话标题、工作区、模型目录等）一律由 Host 半边读取并经 `/api/calender/*` HTTP 暴露，浏览器只 fetch。
- Host（`ApiProxy` from `@deepseek-ai/dsh-host-apiproxy`）：`api.sessions.{list,create({workspaceId?,cwd?,sessionId?,agentPreset?}),prompt({sessionId,mode:'queue',content}),rename,models,selectModel({sessionId,provider,model,reasoningEffort?}),history}`、`api.workspaces.{list,create}`。
- 模型目录：`api.sessions.models({sessionId})` → `SessionModels{current:ModelSelection,routable,groups}`；`selectModel` → `{selected:ModelSelection}`（`ModelSelection={provider,model,reasoningEffort?}`）。
- UI 接缝：外部插件无可用槽位（sidebar/conversation 均单占），侧边栏入口与中间列接管走 **DOM 注入 + MutationObserver 自愈**；跨面板互斥用 `dsh-panel-activate` 事件。

## 3. 本插件架构（Host 权威，用户已确认）

```
浏览器（同源异步视图）                Host（权威）
┌──────────────────────────┐   HTTP   ┌──────────────────────────────┐
│ React 视图（周网格/矩阵/…） │ ────────▶ │ host-routes: /api/calender/*   │
│ HttpHostTransport        │ ◀──────── │  state(GET) events(SSE) action(POST) │
│ sidebar-entry/mount      │  snapshot │ HostCalenderService            │
│ 设置卡 / locales          │          │  ├ host-ledger  ($DSH_HOME/calender/ledger-v1.json, 原子+锁+幂等) │
└──────────────────────────┘          │  ├ host-service (cron tick 30s + 会话轮询 5s + 对账 + SSE) │
                                      │  ├ host-runner  (ApiProxy: 建会话→钉子→prompt→结算) │
                                      │  └ SystemPrompt.section(plugin:calender) │
                                      └──────────────────────────────┘
```

- **Host 为权威**：账本/调度/结算全部在 Host；浏览器动作只提交 `action`（判别联合 + requestId 幂等），UI 状态 = 最近 Host snapshot。
- **共享纯层**：`src/core/`（tasks/calendar/schedule/store）与 `src/protocol.ts` 为纯 TS，host/client 共用；client 不得值导入 host 包。
- **执行（host-runner）**：手动/定时共用 host-runner；步骤：`ledger.openExecution` 开记录 → 建/复用会话（sessionId 或 workspaceId 钉子 → 否则 `workspace.list` 首个工作区）→ `sessions.selectModel`（provider/model 钉子；缺一即失败关闭）→ `agentPresets.select`（复用且钉预设时）→ `/permission <id>` 斜杠命令 → `sessions.rename`（装饰性）→ `sessions.prompt('queue')` → **结算**。结算=轮询 `sessions.list`：会话消失→cancelled、停止且 `updatedAt>startedAt`（有 prompt 证据）→succeeded、超时→cancelled；写回 `ledger.settleExecution`（附带会话 id）并通知浏览器。路由 `kind:'run'` fire-and-forget 交给 runner。失败即关闭：任一钉子无法按任务声明应用即 fail，不发 Prompt。
- **执行设置目录（/api/calender/options）**：Host 经 `ctx.apiProxy`（llm.models / workspace.list / sessions.list）组装 ExecutionCatalog 供浏览器下拉：工作区→会话二级分组、隐藏归档会话、provider→model 联动。**会话标题**从 `sessions.list` 的 `projections.values.title` 读取（真实持久标题，未命名回退 cwd 基名→id）。
- **调度（HostScheduleService，M5）**：Host cron（30s tick + start 时立即 catch-up + 重启对账）；nextRunAt<=now 触发 → runner.run（fire-and-forget）→ **仅 run 被接受后** `advanceSchedule` 滚动到下一 cron 匹配点；已 running（被拒）保留到期槽下个 tick 重试；错过不补；`enabled=false` 暂停；单次 dueAt 触发即结束。index.ts 里 runner 与 scheduler 一并构造、start 于 apply、dispose 于卸载。
- **SSE 广播（M5）**：`/api/calender/events` 经 `ledger.subscribe` 在账本变更（浏览器动作/定时触发/执行结算/滚动写回）时向每个已连 EventSource 推送 `{revision, ledgerId}`；浏览器收到提示即重拉 `/state`。
- **设置卡 + SystemPrompt（M6）**：Host 经 `installSettingsSection(ctx, settingsNamespace('calender'), Config, ...)` 注册 `calender` 设置命名空间（`announceToAgent`/`enabled`，schemastery）；`ctx.systemPrompt.section('plugin:calender', order 160)` 向 agent 宣告日历，受设置实时门控（关开关即撤销段、无需重启）。host `apply(ctx, config?)` 带 Config schema。
- **日历 Tool（M7）**：`ctx.tools.register(defineCalendarTool(...))` 注册 `calender_task` tool（inject 增加 `tools`；`@deepseek-ai/dsh-tools` devDep）。单一 tool，`action` 枚举 create/get/list/update/setQuadrant/setDone/addSubtask/setSubtaskDone/removeSubtask/setSchedule/delete/archive/restore/run；参数 schema 化；每个动作以 minted requestId 映射到**同一 HostLedger.apply**（与浏览器共享账本与幂等），读走 snapshot，`run` 委托 host-runner。defineTool 在 execute 前做参数/枚举校验。

## 4. 协议（protocol.ts）

- `GET /api/calender/state`（no-store）→ `Snapshot{schemaVersion,revision,tasks,scheduler}`
- `GET /api/calender/events`（SSE）→ revision/scheduler 变更提示（断线重连+页面恢复可见重拉）
- `GET /api/calender/options` → 执行设置目录（工作区/会话(含标题,归档已滤)/provider+模型）
- `POST /api/calender/action` → `{requestId, action}` → Snapshot；action：create/update/delete/archive/restore/setSchedule/run/import（`setSchedule` 的 cron/dueAt 用 `null` 清除、`undefined` 不动）
- 安全：loopback 同源 + 严格校验；POST 仅 JSON；普通 ≤64KiB / import ≤2MiB；action 无命令/可执行路径/shell 文本

## 5. 命名约定

包 `dsh-calender` / 行 id `ui-calender` / 设置命名空间 `calender` / 存储键 `dsh.calender.v1`（localStorage 迁移源）/ 账本 `$DSH_HOME/calender/ledger-v1.json` / DOM `data-dsh-calender-*` / 面板事件名 `calender`。

## 6. 与既有插件共存

独立 DOM 属性/命名空间/存储键；与 task-board/ssh 面板经 `dsh-panel-activate` 互斥（打开本面板 evict 对方 html 属性与状态）；侧边栏入口落在 family 块相对顺序稳定位置。