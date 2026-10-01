/**
 * dsh-calendar client half (browser). Root-scoped, all-slot presentation: the
 * calendar panel lives in the `shell.overlay` slot (a stable frame-wide
 * overlay) and a calendar entry lives in `sidebar.footer.action` (root, beside
 * Settings). Being root-scoped, both work without opening any session.
 *
 * Failure policy: registration problems are logged, never thrown; an external
 * plugin must not take the GUI down.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { calendarClientController, initialState } from './controller.ts'
import { HTTP_PREFIX_DEFAULT, HttpcalendarHostTransport } from './host-api.ts'
import { createCalendarOverlay } from './calendar-overlay.tsx'
import { CalendarEntry } from './calendar-entry.tsx'
import { isCalendarOpen, setCalendarOpen, subscribeCalendarOpen } from './root-open.ts'
import { closeOnSessionNavigation } from './navigation-watch.ts'
import { watchCatalogRefresh } from './catalog-refresh.ts'
import { claimApply, releaseApply } from './apply-guard.ts'
import { en, t, zh, type calendarKey } from './locales.ts'
import { CalendarSettingsCard, type CalendarSettingsValue } from './components/CalendarSettingsCard.tsx'

/** Locale namespace this plugin owns. */
const NS = 'calendar'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'calendar': calendarKey
  }
}

/** Required services: locale, slots, the shared config-form store, and sessions
 * only for navigation. Calendar domain state comes from the Host over HTTP. */
export const inject = ['locale', 'slots', 'sessions', 'configForms', 'uiWorkspace']

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

  // The sessions service is typed by the runtime's Context merge; read it once
  // so both the navigation watcher and the session jump share the same handle.
  const sessions = (ctx as unknown as { sessions: ISessions }).sessions

  // DSH 0.2 keeps session selection in the UI workspace navigation service.
  ctx.effect(() => closeOnSessionNavigation(
    ctx.uiWorkspace,
    () => setCalendarOpen(false),
  ), 'dsh-calendar: close calendar on session navigation')

  // The catalog is fetched once at boot; sessions created afterwards (or cold
  // sessions attached from disk) must still appear in the task-detail session
  // dropdown. Re-pull the catalog when the sessions list changes or the
  // calendar opens (debounced; see catalog-refresh.ts).
  ctx.effect(() => watchCatalogRefresh({
    list: sessions.list,
    subscribeOpen: subscribeCalendarOpen,
    isOpen: isCalendarOpen,
    refresh: () => { void refreshCatalog(controller) },
  }), 'dsh-calendar: refresh catalog on session changes')

  // Session jump: opening an execution's session in the GUI is a deliberate
  // leave-the-calendar action, so the calendar overlay is closed first; the
  // session then opens below the now-visible conversation surface.
  const openSession = (sessionId: string): void => {
    try {
      // Execution-record ids are plain strings; the branded SessionId is a
      // structural subtype, so the cast is a pure narrowing.
      ctx.uiWorkspace.openSession(sessionId as SessionId)
    } catch {
      // The session may not be listed yet; ignore. The calendar is already
      // closed: the click was an explicit leave intent.
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

  // DSH 0.2 settings are keyed by the profile entry id from cordis.patch.yml.
  const configForm = ctx.configForms.get<CalendarSettingsValue>('ui-calendar')
  ctx.slots.inject('settings.plugins.tab' as never, () => ctx.slots.register({
    name: 'settings.plugins.tab',
    id: 'ui-calendar',
    order: 0,
    label: () => t('settings.title'),
    locale: NS,
    inject: () => ({ configForm }),
  } as never, CalendarSettingsCard as never))

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
