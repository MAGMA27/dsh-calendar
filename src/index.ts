/**
 * dsh-calendar host half (node). Loader entry for the plugin's host face:
 * owns the ledger + HTTP/SSE routes. The scheduler (repeat materialization +
 * first repeat occurrence + one-shot runs), the real-execution runner (M4) and the SystemPrompt
 * announcement (M6) build on this service.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the service Context augmentations.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { defineCalendarTool } from './host-tool.ts'
import { calendarHostService } from './host-service.ts'
import { mountcalendarRoutes } from './host-routes.ts'
import { acquireLedgerLock } from './host-ledger.ts'
import { HostExecutionRunner } from './host-runner.ts'
import { HostScheduleService } from './host-scheduler.ts'
import { dshHome } from './dsh-home.ts'
import { buildCatalogFromApi } from './host-options.ts'
import { catalogApiFromRuntime, calendarRuntimeFromContext, executionEnvFromRuntime } from './host-runtime.ts'
import { MAX_SCHEDULED_RECURSION_DEPTH } from './core/tasks.ts'

/** Required services: the web server, current Session/Workspace services used
 * for the live execution-settings catalog and runner, and the shared
 * system-prompt/tools/settings registries. The SystemPrompt announcement is
 * gated on the settings service, and the `tools` registry serves the
 * model-callable calendar tool (M7). */
export const inject = ['webServer', 'sessionController', 'workspaceRegistry', 'systemPrompt', 'tools', 'settings']

/** Settings namespace of the calendar's announcement capability (the web
 * settings surface edits it; the browser half never depends on this Host
 * package and spells its own copy). */
export const calendar_SETTINGS_NAMESPACE = 'calendar' as const

/** Model-facing announcement: the calendar plugin's presence and capabilities. */
export const calendar_GUIDANCE =
  'The user has a calendar todo plugin (dsh-calendar) exposed as the calendar_task tool. When the user asks to create or schedule work, use calendar_task rather than shell, source inspection, or the calendar HTTP routes. Call action=options first when you need exact provider/model/session ids or labels; sessionId="current" pins the task to the session of the calling Agent. action=create is atomic: include the task fields and either dueAt for a one-off Agent trigger or repeat for a daily/weekly series. Provider and model must be set together or both left blank; the Host rejects an incomplete pin while saving create/update. Leave mode blank to use the deployment default for a new session or inherit the current mode of a reused session; an explicit mode is only applied to a new or still-blank session, is skipped when it already matches a started session, and is rejected when it differs. A one-off dueAt automatically runs the Agent; when a repeat rule matches the template date, repeat.triggerAgent also arms that template date as the first occurrence, and later matching dates are materialized copies with the same trigger setting. Blank triggerAt means the task block start. If a one-off dueAt or matching repeat first occurrence has already passed when the Host resumes, it is recorded as failed and not replayed. Failed setup attempts are retried at most three total times, then the current occurrence is stopped; repeat rules materialize only current/future occurrences, and missed occurrences are not replayed. A Host-scheduled Agent may create ordinary todo tasks; creating or arming an auto-run child is allowed only up to the configured maximum recursion depth in Settings → Plugins → calendar (default 0, maximum 3). Times accept ISO-8601 datetimes with timezone offsets or millisecond epochs. Tasks carry a start/end block, an Eisenhower urgency/importance quadrant, subtasks, pinned execution settings (workspace / session / provider+model / preset / permission), and an optional schedule. The Host is the source of truth and settles execution records; the calendar UI is an eventually consistent observer.'

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** When true (default), a system-prompt section announces the calendar to every agent. */
  announceToAgent?: boolean
  /** Master switch for the host half (announcement + scheduler/runner run). */
  enabled?: boolean
  /** Maximum nested auto-run schedule depth created by a scheduled Agent. */
  maxScheduledDepth?: number
}

export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(true),
  enabled: z.boolean().default(true),
  maxScheduledDepth: z.number().step(1).min(0).max(MAX_SCHEDULED_RECURSION_DEPTH).default(0)
    .description('定时 Agent 创建自动触发任务的最大嵌套深度；0 表示禁止递归，最大允许值为 3。'),
})

const DEFAULT_ANNOUNCE = true
const DEFAULT_MAX_SCHEDULED_DEPTH = 0

/** Host plugin body. */
export function apply(ctx: Context, config?: Config): void {
  const releaseLock = acquireLedgerLock(dshHome())

  const service = new calendarHostService()
  // DSH 0.1.2 removed the old `apiProxy` service. Keep the adapter at the
  // Host boundary so the runner/catalog remain plain and easy to test.
  const runtime = calendarRuntimeFromContext(ctx)
  const api = catalogApiFromRuntime(runtime)
  const runner = new HostExecutionRunner(service.ledger, executionEnvFromRuntime(runtime))
  // Host scheduler: fires due one-shot tasks through the runner, materializes
  // repeat copies, and reconciles executions left running across a restart.
  const scheduler = new HostScheduleService(service.ledger, runner)
  scheduler.start()

  // Settings card + SystemPrompt announcement, gated on the `calendar`
  // settings namespace (editable in the web settings Plugins section). The
  // section re-registers on settings change (live, no restart).
  let current: () => Config = () => config ?? {}
  let disposeSection: (() => void) | undefined
  const sync = (): void => {
    if (disposeSection !== undefined) { disposeSection(); disposeSection = undefined }
    if ((current().enabled ?? true) === false) return
    if ((current().announceToAgent ?? DEFAULT_ANNOUNCE) === false) return
    disposeSection = ctx.systemPrompt.section({
      name: 'plugin:calendar',
      order: 160,
      text: `${calendar_GUIDANCE} Current configured maximum scheduled-Agent recursion depth: ${current().maxScheduledDepth ?? DEFAULT_MAX_SCHEDULED_DEPTH}; 0 disables nested auto-run schedule creation.`,
    })
  }
  ctx.settings.installSection(ctx, calendar_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: (source: () => Config) => { current = source },
    onChange: sync,
  })
  sync()

  // M7: expose the calendar as a real, model-callable tool on the same ledger.
  const disposeTool = ctx.tools.register(defineCalendarTool({
    ledger: service.ledger,
    run: id => runner.run(id),
    catalog: () => buildCatalogFromApi(api),
    getActiveScheduledExecution: sessionId => service.ledger.activeScheduledExecution(sessionId),
    maxScheduledDepth: () => current().maxScheduledDepth ?? DEFAULT_MAX_SCHEDULED_DEPTH,
  }))

  const disposers = mountcalendarRoutes(ctx.webServer, service.ledger, api, runner)

  ctx.effect(() => {
    return () => {
      scheduler.dispose()
      if (disposeSection !== undefined) disposeSection()
      disposeTool()
      for (const dispose of disposers.splice(0)) dispose()
      service.dispose()
      releaseLock()
    }
  }, 'dsh-calendar: host dispose')
}
