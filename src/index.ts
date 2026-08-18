/**
 * dsh-calender host half (node). Loader entry for the plugin's host face:
 * owns the ledger + HTTP/SSE routes. The cron scheduler (M5) and the
 * real-execution runner (M4) and the SystemPrompt announcement (M6) build on
 * this service.
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-only: pulls the web-server service's Context augmentation (ctx.webServer).
import type {} from '@deepseek-ai/dsh-host-webserver'
import { CalenderHostService } from './host-service.ts'
import { mountCalenderRoutes } from './host-routes.ts'
import { acquireLedgerLock } from './host-ledger.ts'
import { dshHome } from './dsh-home.ts'

/** Required services: the web server to register the calender routes on. */
export const inject = ['webServer']

/** Host plugin body. */
export function apply(ctx: Context): void {
  const releaseLock = acquireLedgerLock(dshHome())

  const service = new CalenderHostService()
  const disposers = mountCalenderRoutes(ctx.webServer, service.ledger)

  ctx.effect(() => {
    return () => {
      for (const dispose of disposers.splice(0)) dispose()
      service.dispose()
      releaseLock()
    }
  }, 'dsh-calender: host dispose')
}
