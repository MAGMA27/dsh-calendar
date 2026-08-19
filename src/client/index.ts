/**
 * dsh-calendar client half (browser). Root-scoped, all-slot presentation: the
 * calendar panel lives in the `shell.overlay` slot (a stable frame-wide
 * overlay) and a calendar entry lives in `sidebar.footer.action` (root, beside
 * Settings). Being root-scoped, both work without opening any session.
 *
 * Failure policy: registration problems are logged, never thrown; an external
 * plugin must not take the GUI down.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { calendarClientController, initialState } from './controller.ts'
import { HTTP_PREFIX_DEFAULT, HttpcalendarHostTransport } from './host-api.ts'
import { createCalendarOverlay } from './calendar-overlay.tsx'
import { CalendarEntry } from './calendar-entry.tsx'
import { claimApply, releaseApply } from './apply-guard.ts'
import { en, zh } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'calendar'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'calendar': Record<string, string>
  }
}

/** Required services: locale for copy, slots for the two registrations, and
 * sessions only for the session jump. All calendar domain state comes from the
 * Host over HTTP. */
export const inject = ['locale', 'slots', 'sessions']

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  if (!claimApply()) return
  ctx.effect(() => releaseApply, 'dsh-calendar: apply claim')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-calendar: dictionaries')

  // The transport + controller are wired eagerly so the overlay is ready the
  // moment the entry toggles it open.
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
      // The session may not be listed yet; ignore and keep the overlay open.
    }
  }

  // Calendar panel: a root-scoped, frame-wide overlay (stable, no DOM fiddling).
  const CalendarOverlay = createCalendarOverlay(controller, openSession)
  ctx.slots.inject('shell.overlay' as never, () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'calendar-overlay',
    order: 0,
  } as never, CalendarOverlay as never))

  // Entry: a root-scoped button beside Settings at the sidebar foot.
  ctx.slots.inject('sidebar.footer.action' as never, () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'calendar-entry',
    order: 0,
    label: () => '日历',
  } as never, CalendarEntry as never))

  ctx.effect(() => () => controller.dispose(), 'dsh-calendar: dispose controller')
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
