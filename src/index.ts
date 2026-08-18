/**
 * dsh-calender host half (node). Loader entry for the plugin's host face:
 * owns the ledger + HTTP/SSE routes. The cron scheduler (M5) and the
 * real-execution runner (M4) and the SystemPrompt announcement (M6) build on
 * this service.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the service Context augmentations.
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-host-apiproxy'
import { CalenderHostService } from './host-service.ts'
import { mountCalenderRoutes } from './host-routes.ts'
import { acquireLedgerLock } from './host-ledger.ts'
import { HostExecutionRunner, type HostExecutionEnv } from './host-runner.ts'
import { HostScheduleService } from './host-scheduler.ts'
import { dshHome } from './dsh-home.ts'
import type { CatalogApiFace } from './host-options.ts'

/** Required services: the web server to register the calender routes on, and
 * the ApiProxy to read the live execution-settings catalog (workspaces,
 * sessions, LLM providers/models). */
export const inject = ['webServer', 'apiProxy']

/** Host plugin body. */
export function apply(ctx: Context): void {
  const releaseLock = acquireLedgerLock(dshHome())

  const service = new CalenderHostService()
  const api = ctx.apiProxy as unknown as CatalogApiFace
  // The real-execution runner drives dsh sessions through the same ApiProxy
  // (sessions.create/selectModel/prompt, workspace.list, agentPresets.select).
  const runner = new HostExecutionRunner(service.ledger, ctx.apiProxy as unknown as HostExecutionEnv)
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
  const disposers = mountCalenderRoutes(ctx.webServer, service.ledger, api, runner)

  ctx.effect(() => {
    return () => {
      scheduler.dispose()
      for (const dispose of disposers.splice(0)) dispose()
      service.dispose()
      releaseLock()
    }
  }, 'dsh-calender: host dispose')
}
