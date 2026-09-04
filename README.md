<div align="center">
  <h1>📅 dsh-calendar</h1>
  <p><strong>Host-authoritative calendar and scheduled Agent runs for DSH Web</strong></p>

  <p>
    <a href="https://www.npmjs.com/package/@magma27/dsh-calendar"><img src="https://img.shields.io/npm/v/%40magma27%2Fdsh-calendar?color=5c6bc0&logo=npm" alt="npm version"></a>
    <a href="https://www.npmjs.com/package/@magma27/dsh-calendar"><img src="https://img.shields.io/npm/dm/%40magma27%2Fdsh-calendar?color=5c6bc0&logo=npm" alt="npm downloads"></a>
    <a href="LICENSE"><img src="https://img.shields.io/npm/l/%40magma27%2Fdsh-calendar" alt="license"></a>
  </p>

  <p><a href="README.zh-CN.md">简体中文</a></p>
</div>

> [!NOTE]
> `dsh-calendar` is a DSH Web plugin, not a standalone calendar app. Install it into a DSH profile so the Host can own the task ledger, schedule Agents, and settle execution records.

> [!NOTE]
> The current source targets DSH `0.1.2-rc.1`. This release no longer provides the legacy `apiProxy`; the plugin adapts the current Host services (`sessionController`, `workspaceRegistry`, `agentPresets`, `commands`) at its Host boundary.

> **Update log — 2026-09-04:** Documented the DSH `0.1.2-rc.1` Host-service adapter migration and refreshed the related install, build, and runtime notes.

`dsh-calendar` is a DSH Web calendar and Agent task plugin. Use it to plan todos, arrange time, schedule one-off or recurring Agent runs, and let Agents create and manage tasks through `calendar_task`. Agents can also review your calendar tasks and execution history to help reflect on your plans and progress.

## Preview

<table>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/MAGMA27/dsh-calendar/main/resource/weekly_Panel.gif" alt="Week view" width="420"><br><sub>Week view</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/MAGMA27/dsh-calendar/main/resource/monthly.png" alt="Month view" width="420"><br><sub>Month view</sub></td>
  </tr>
  <tr>
    <td align="center"><img src="https://raw.githubusercontent.com/MAGMA27/dsh-calendar/main/resource/matrix.png" alt="Matrix view" width="420"><br><sub>Matrix view</sub></td>
    <td align="center"><img src="https://raw.githubusercontent.com/MAGMA27/dsh-calendar/main/resource/agenda.png" alt="Agenda view" width="420"><br><sub>Agenda view</sub></td>
  </tr>
</table>

## Features

- Create and arrange timed tasks with drag-and-drop calendar views.
- Week, month, agenda, and Eisenhower matrix views.
- Set urgency and importance levels, manage subtasks, and complete tasks directly with a checkbox.
- Schedule one-off or daily/weekly Agent runs, with optional weekend and holiday skipping.
- Configure each Agent run with a workspace, session, provider/model, Agent preset, and permission preset.
- The `calendar_task` tool lets Agents create, query, update, delete, and schedule tasks through the same Host ledger.
- Host-authoritative task ledger and execution records that stay consistent across browser refreshes.

## Agent tool: `calendar_task`

`calendar_task` is the model-facing interface for managing calendar tasks. Pass one `action` per call; all mutations use the same Host ledger as the calendar UI.

Time fields are intentionally separate: `startAt`/`endAt` define the calendar block, `dueAt` is a one-off absolute Agent trigger, and `repeat` with `triggerAgent` and optional `triggerAt` defines recurring triggers. There is no `scheduleAt` parameter.

| Action | Purpose |
| --- | --- |
| `options` | List available workspaces, sessions, providers, models, and modes. |
| `create` | Create a task, optionally with execution settings and a schedule. |
| `get` | Read one task and its execution summary. |
| `list` | Query and filter tasks or execution records. |
| `update` | Edit a task's title, time, content, or execution settings. |
| `setQuadrant` | Set the task's urgency and importance. |
| `setDone` | Mark a task complete or incomplete. |
| `addSubtask` | Add a checklist subtask. |
| `setSubtaskDone` | Mark a subtask complete or incomplete. |
| `removeSubtask` | Remove a subtask. |
| `setSchedule` | Add, change, or clear a one-off or daily/weekly schedule. |
| `run` | Start an Agent run immediately. |
| `delete` | Delete a task. |

## Install from npm

This is a DSH plugin, not a standalone calendar app. Install it into the DSH Web profile so DSH can load its Host and client bundle:

~~~sh
# DSH delegates profile plugin management to pnpm; install it once if needed
npm install --global pnpm

# Install the published package into the DSH Web profile
dsh plugin --profile web add '@magma27/dsh-calendar'

# Restart the Web profile after installation or upgrade
dsh web
~~~

Check the composed profile:

~~~sh
dsh --profile web --dump-config
~~~

Upgrade or remove it with:

~~~sh
dsh plugin --profile web update '@magma27/dsh-calendar'
dsh plugin --profile web remove '@magma27/dsh-calendar'
~~~

## Install from source

~~~sh
pnpm install
pnpm typecheck
pnpm test
pnpm build

# Mount the local checkout into the DSH Web profile
dsh plugin --profile web add link:<path-to-dsh-calendar>

# Restart DSH Web; a browser refresh does not replace the Host bundle
dsh web
~~~

## Runtime model and safety

- The calendar UI submits actions and renders Host snapshots; it does not own or mutate the task ledger directly.
- `calendar_task` is available to Agents for creating, querying, updating, and deleting calendar tasks. `sessionId: "current"` pins a task to the calling Agent session.
- A blank `triggerAt` follows the task block start; an explicit absolute trigger time remains decoupled from later block moves.
- On Host recovery, missed one-off due times are marked failed and not replayed. Missed repeat dates are not materialized for catch-up execution.
- Scheduled execution consumes real LLM API quota. The Host rejects incomplete provider/model pins and child auto-run schedules beyond the configured recursion depth.
- The default ledger path is `$DSH_HOME/calendar/ledger-v1.json`. Keep local ledgers, logs, and profile directories out of Git.

## Development

~~~sh
pnpm typecheck
pnpm test
pnpm build
~~~

The repository is organized as follows:

~~~text
src/core/       pure domain models and repeat-rule logic
src/host-*.ts   Host ledger, routes, scheduler, and runner
src/client/     calendar views, forms, and Host transport
tests/          core, Host, and client tests
~~~

## License

Apache-2.0 © 2026 MAGMA27. See [LICENSE](LICENSE).
