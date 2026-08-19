/**
 * dsh-calendar client half (browser). Wires the same-origin transport to the
 * view controller and registers the calendar as a session view tab through the
 * official `conversation.view` slot — the shell renders it (stable lifecycle),
 * instead of DOM-injecting into the React-owned center column.
 *
 * Failure policy: problems are logged, never thrown; an external plugin must
 * not take the GUI down.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { calendarClientController, initialState } from './controller.ts'
import { HTTP_PREFIX_DEFAULT, HttpcalendarHostTransport } from './host-api.ts'
import { createCalendarSlotView } from './calendar-view-slot.tsx'
import { claimApply, releaseApply } from './apply-guard.ts'
import { en, zh } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'calendar'

/** The conversation-view tab id this plugin owns. */
export const CALENDAR_VIEW_ID = 'calendar'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'calendar': Record<string, string>
  }
}

/** Required services: locale for copy, slots to register the calendar view tab,
 * and sessions for the session jump. Calendar domain state always comes from
 * the Host over HTTP. */
export const inject = ['locale', 'slots', 'sessions']

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  if (!claimApply()) return
  ctx.effect(() => releaseApply, 'dsh-calendar: apply claim')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-calendar: dictionaries')

  // The transport + controller are wired eagerly so the view is ready when the
  // tab is shown.
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
      // The session may not be listed yet; ignore and keep the view open.
    }
  }

  // The calendar view body. The conversation.view slot passes session-focused
  // props; the calendar is its own view so it ignores those and renders its own
  // controller-backed tree.
  const CalendarSlotView = createCalendarSlotView(controller, openSession)

  // Register the calendar as one tab in the conversation view ring, beside the
  // shipped chat and trajectory tabs. register disposal rides the caller's
  // fiber, so plugin unload removes the tab.
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: CALENDAR_VIEW_ID,
    order: 20,
    locale: NS,
    label: () => '日历',
  }, CalendarSlotView as never))

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
