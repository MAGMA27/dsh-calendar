<div align="center">
  <h1>📅 dsh-calendar</h1>
  <p><strong>DSH Web 的 Host 权威日历与定时 Agent 任务插件</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/@magma27/dsh-calendar"><img src="https://img.shields.io/npm/v/%40magma27%2Fdsh-calendar?color=5c6bc0&logo=npm" alt="npm 版本"></a>
    <a href="https://www.npmjs.com/package/@magma27/dsh-calendar"><img src="https://img.shields.io/npm/dm/%40magma27%2Fdsh-calendar?color=5c6bc0&logo=npm" alt="npm 下载量"></a>
    <a href="LICENSE"><img src="https://img.shields.io/npm/l/%40magma27%2Fdsh-calendar" alt="许可证"></a>
  </p>

  <p><a href="README.md">English</a></p>
</div>

`dsh-calendar` 是 DSH Web 的日历与 Agent 任务插件。你可以用它管理待办、安排时间、设置一次性或重复的 Agent 任务，也可以让 Agent 通过 `calendar_task` 创建和管理任务；还可以基于日历任务和执行记录，让 Agent 帮你复盘工作安排与完成情况。

## 预览

<table>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/MAGMA27/dsh-calendar/main/resource/weekly_Panel.gif" alt="周视图" width="420"><br><sub>周视图</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/MAGMA27/dsh-calendar/main/resource/monthly.png" alt="月视图" width="420"><br><sub>月视图</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/MAGMA27/dsh-calendar/main/resource/matrix.png" alt="矩阵视图" width="420"><br><sub>矩阵视图</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/MAGMA27/dsh-calendar/main/resource/agenda.png" alt="议程视图" width="420"><br><sub>议程视图</sub></td>
  </tr>
</table>

## 功能

- 通过日历视图拖拽创建和安排定时任务。
- 支持周视图、月视图、议程视图和艾森豪威尔矩阵视图。
- 支持紧急度/重要度分级、子任务和直接勾选完成。
- 支持一次性或每日/每周触发 Agent，可选择跳过周末与节假日。
- 执行 Agent 时，可指定工作区、session、provider/model、Agent preset 和权限 preset。
- 提供 `calendar_task` 工具，让 Agent 通过同一个 Host 账本创建、查询、更新、删除和设置定时任务。
- Host 权威账本与执行记录，浏览器刷新后状态仍保持一致。

## Agent 工具：`calendar_task`

`calendar_task` 是 Agent 管理日历任务的统一接口。每次调用传入一个 `action`；所有修改都使用与日历 UI 相同的 Host 权威账本。

时间字段是有意区分的：`startAt`/`endAt` 表示日历时间块，`dueAt` 表示一次性的绝对触发时间，`repeat` 配合 `triggerAgent` 和可选的 `triggerAt` 表示重复触发；接口中没有 `scheduleAt` 参数。

| action | 功能 |
| --- | --- |
| `options` | 查询可用的工作区、session、provider、模型和模式。 |
| `create` | 创建任务，可同时设置执行目标和定时规则。 |
| `get` | 查询单个任务及其执行摘要。 |
| `list` | 按时间、状态、session、模型等条件查询任务或执行记录。 |
| `update` | 修改任务标题、时间、内容或执行设置。 |
| `setQuadrant` | 设置任务的紧急度和重要度。 |
| `setDone` | 标记任务完成或未完成。 |
| `addSubtask` | 添加子任务清单项。 |
| `setSubtaskDone` | 标记子任务完成或未完成。 |
| `removeSubtask` | 删除子任务。 |
| `setSchedule` | 添加、修改或清除一次性/每日/每周定时。 |
| `run` | 立即启动一次 Agent 执行。 |
| `delete` | 删除任务。 |

## 从 npm 安装

不要把它安装到普通 Node 项目里；应当让 DSH 把 npm 包安装到目标 profile：

~~~sh
# DSH 的 profile 插件管理会调用 pnpm；没有 pnpm 时先安装一次
npm install --global pnpm

# 安装到 DSH Web profile
dsh plugin --profile web add '@magma27/dsh-calendar'

# 首次安装或升级后重启 Web profile
dsh web
~~~

验证插件是否进入 profile：

~~~sh
dsh --profile web --dump-config
~~~

升级或卸载：

~~~sh
dsh plugin --profile web update '@magma27/dsh-calendar'
dsh plugin --profile web remove '@magma27/dsh-calendar'
~~~

## 从源码安装

~~~sh
pnpm install
pnpm typecheck
pnpm test
pnpm build

# 用本地目录挂载到 DSH Web profile
dsh plugin --profile web add link:<path-to-dsh-calendar>

# 重启 DSH Web；仅刷新浏览器不会替换已加载的 Host bundle
dsh web
~~~

## 使用与安全边界

- 日历入口位于 DSH Web 侧边栏；任务详情中的执行设置可以选择当前 session、已有 session 或新建 session。
- Agent 可以通过 `calendar_task` 创建、查询、更新和删除任务；`sessionId: "current"` 表示当前调用 Agent 的 session。
- 空白 `triggerAt` 使用任务块开始时间；已设定的绝对触发时间与任务块移动解耦。
- Host 恢复时会把错过的到期任务标记为失败，不会追赶执行；重复规则也不会补跑错过的日期。
- 定时执行会真实消耗 LLM API 额度。Host 会拒绝不完整的 provider/model 绑定和超出递归深度的自动触发子任务。
- 任务账本默认位于 `$DSH_HOME/calendar/ledger-v1.json`。不要把本地账本、日志或 profile 目录提交到 Git。

## 开发命令

~~~sh
pnpm typecheck
pnpm test
pnpm build
~~~

主要目录：

~~~text
src/core/       纯函数领域模型与重复规则
src/host-*.ts   Host 账本、路由、调度器和执行器
src/client/     日历视图、表单和 Host transport
tests/          core、Host、client 测试
~~~

## 许可证

Apache-2.0 © 2026 MAGMA27，详见 [LICENSE](LICENSE)。
