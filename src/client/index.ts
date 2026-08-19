/**
 * dsh-calendar client half (browser). Wires the same-origin transport to the
 * view controller and mounts the two DOM surfaces — the sidebar entry row and
 * the calendar view in the center column.
 *
 * Failure policy: DOM mounting problems are logged, never thrown; an external
 * plugin must not take the GUI down.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { calendarClientController, initialState } from './controller.ts'
import { HTTP_PREFIX_DEFAULT, HttpcalendarHostTransport } from './host-api.ts'
import { claimApply, releaseApply } from './apply-guard.ts'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { mountcalendar } from './calendar-mount.tsx'
import { en, zh } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'calendar'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'calendar': Record<string, string>
  }
}

/** Required services. `sessions` is injected only to perform the session
 * jump (open an execution's session in the GUI); all domain state still comes
 * from the Host over HTTP. */
export const inject = ['locale', 'sessions']

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  if (!claimApply()) return
  ctx.effect(() => releaseApply, 'dsh-calendar: apply claim')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-calendar: dictionaries')

  // The transport + controller are wired eagerly so the sidebar entry can open
  // the panel as soon as the frame mounts.
  const transport = new HttpcalendarHostTransport(HTTP_PREFIX_DEFAULT)
  const controller = new calendarClientController(transport, initialState(Date.now(), 0))
  void controller.start()

  // The execution-settings catalog (workspaces / sessions with their real
  // titles / LLM providers+models) is assembled on the Host and fetched here.
  void refreshCatalog(controller)

  // Session jump: open an execution's session in the GUI. The session may not
  // be in the list snapshot yet right after a run, so failures are ignored.
  const openSession = (sessionId: string): void => {
    const sessions = (ctx as unknown as { sessions?: { open(id: string): void } }).sessions
    try {
      sessions?.open(sessionId)
    } catch {
      // The session may not be listed yet; ignore and keep the panel open.
    }
  }

  let uiDisposer: (() => void) | undefined
  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(controller))
    disposers.push(mountcalendar(controller, openSession))
  } catch (error) {
    console.error('[dsh-calendar] mount failed:', error)
  }

  uiDisposer = () => {
    for (const dispose of disposers.splice(0)) dispose()
    controller.dispose()
    uiDisposer = undefined
  }

  ctx.effect(() => uiDisposer ?? (() => {}), 'dsh-calendar: ui dispose')
}

/**
 * Pull the execution-settings catalog (workspaces / sessions / LLM
 * providers+models) from the Host over HTTP. Best-effort: a failure degrades
 * to free-text inputs inside the form.
 */
async function refreshCatalog(controller: calendarClientController): Promise<void> {
  try {
    const catalog = await controller.transportOptions()
    controller.setCatalog(catalog)
  } catch {
    // Degrade to free-text inputs; never take the GUI down.
  }
}

