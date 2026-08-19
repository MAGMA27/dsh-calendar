/**
 * dsh-calendar host half (node). Loader entry for the plugin's host face:
 * owns the ledger + HTTP/SSE routes. The cron scheduler (M5) and the
 * real-execution runner (M4) and the SystemPrompt announcement (M6) build on
 * this service.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the service Context augmentations.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-host-apiproxy'
import type {} from '@deepseek-ai/dsh-system-prompt'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import z from 'schemastery'
import { defineCalendarTool } from './host-tool.ts'
import { calendarHostService } from './host-service.ts'
import { mountcalendarRoutes } from './host-routes.ts'
import { acquireLedgerLock } from './host-ledger.ts'
import { HostExecutionRunner, type HostExecutionEnv, type RunnerAgentsFace, type RunnerCommandsFace } from './host-runner.ts'
import { HostScheduleService } from './host-scheduler.ts'
import { dshHome } from './dsh-home.ts'
import type { CatalogApiFace } from './host-options.ts'

/** Required services: the web server to register the calendar routes on, and
 * the ApiProxy to read the live execution-settings catalog (workspaces,
 * sessions, LLM providers/models). The settings surface is attached through
 * installSettingsSection (its own settings inject), the SystemPrompt
 * announcement is gated on it, and the `tools` registry serves the
 * model-callable calendar tool (M7). */
export const inject = ['webServer', 'apiProxy', 'systemPrompt', 'tools']

/** Settings namespace of the calendar's announcement capability (the web
 * settings surface edits it; the browser half never depends on this Host
 * package and spells its own copy). */
export const calendar_SETTINGS_NAMESPACE = settingsNamespace('calendar')

/** Model-facing announcement: the calendar plugin's presence and capabilities. */
export const calendar_GUIDANCE =
  'The user has a calendar todo plugin (dsh-calendar): tasks carry a start/end block, an Eisenhower urgency/importance quadrant, subtasks, pinned execution settings (workspace / session / provider+model / preset / permission) and an optional recurring cron or one-off due schedule. Scheduled tasks run automatically in the Host and settle their execution records. When the user asks about tasks, appointments or scheduling, the calendar is the source of truth.'

/** Plugin config, validated by the same-named schemastery schema. */
export interface Config {
  /** When true (default), a system-prompt section announces the calendar to every agent. */
  announceToAgent?: boolean
  /** Master switch for the host half (announcement + scheduler/runner run). */
  enabled?: boolean
}

export const Config: z<Config> = z.object({
  announceToAgent: z.boolean().default(true),
  enabled: z.boolean().default(true),
})

const DEFAULT_ANNOUNCE = true

/** Host plugin body. */
export function apply(ctx: Context, config?: Config): void {
  const releaseLock = acquireLedgerLock(dshHome())

  const service = new calendarHostService()
  const api = ctx.apiProxy as unknown as CatalogApiFace
  // The real-execution runner drives dsh sessions through the same ApiProxy
  // (sessions.create/selectModel/prompt, workspace.list, agentPresets.select).
  // Permission pins need the host slash-command registry + agents registry;
  // both are optional (ctx.get, not inject) so a deployment without them
  // degrades the permission pin to a clear failure instead of blocking apply.
  const env: HostExecutionEnv = { ...(ctx.apiProxy as unknown as HostExecutionEnv) }
  const commands = ctx.get('commands')
  const agents = ctx.get('agents')
  if (commands !== undefined) env.commands = commands as unknown as RunnerCommandsFace
  if (agents !== undefined) env.agents = agents as unknown as RunnerAgentsFace
  const runner = new HostExecutionRunner(service.ledger, env)
  // Host cron scheduler: fires due scheduled tasks through the runner and
  // reconciles executions left running across a restart.
  const scheduler = new HostScheduleService(
    {
      tasks: () => service.ledger.getSnapshot().tasks,
      advanceSchedule: (id, next, last) => service.ledger.advanceSchedule(id, next, last),
    },
    runner,
  )
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
      text: calendar_GUIDANCE,
    })
  }
  installSettingsSection(ctx, calendar_SETTINGS_NAMESPACE, Config, config ?? {}, {
    setSource: source => { current = source },
    onChange: sync,
  })
  sync()

  // M7: expose the calendar as a real, model-callable tool on the same ledger.
  const disposeTool = ctx.tools.register(defineCalendarTool({
    ledger: service.ledger,
    run: id => runner.run(id),
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
