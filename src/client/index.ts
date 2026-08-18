/**
 * dsh-calender client half (browser). Wires the same-origin transport to the
 * view controller and mounts the two DOM surfaces — the sidebar entry row and
 * the calendar view in the center column.
 *
 * Failure policy: DOM mounting problems are logged, never thrown; an external
 * plugin must not take the GUI down.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { CalenderClientController, initialState } from './controller.ts'
import { HTTP_PREFIX_DEFAULT, HttpCalenderHostTransport } from './host-api.ts'
import { overlaySessionTitles } from '../core/exec-catalog.ts'
import { claimApply, releaseApply } from './apply-guard.ts'
import { mountSidebarEntry } from './sidebar-entry.ts'
import { mountCalender } from './calendar-mount.tsx'
import { en, zh } from './locales.ts'

/** Locale namespace this plugin owns. */
const NS = 'calender'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'calender': Record<string, string>
  }
}

/** Required services. */
export const inject = ['locale']

/** Client plugin body. */
export function apply(ctx: ClientContext): void {
  if (!claimApply()) return
  ctx.effect(() => releaseApply, 'dsh-calender: apply claim')

  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-calender: dictionaries')

  // The transport + controller are wired eagerly so the sidebar entry can open
  // the panel as soon as the frame mounts.
  const transport = new HttpCalenderHostTransport(HTTP_PREFIX_DEFAULT)
  const controller = new CalenderClientController(transport, initialState(Date.now(), 0))
  void controller.start()
  void refreshCatalog(ctx, controller)

  let uiDisposer: (() => void) | undefined
  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(controller))
    disposers.push(mountCalender(controller))
  } catch (error) {
    console.error('[dsh-calender] mount failed:', error)
  }

  uiDisposer = () => {
    for (const dispose of disposers.splice(0)) dispose()
    controller.dispose()
    uiDisposer = undefined
  }

  ctx.effect(() => uiDisposer ?? (() => {}), 'dsh-calender: ui dispose')
}

/**
 * Pull the execution-settings catalog (workspaces / sessions / LLM
 * providers+models) from the Host over HTTP, then overlay the real per-session
 * titles from the browser runtime (ctx.sessions owns the durable-title
 * projection the GUI itself shows). Best-effort: any gap degrades gracefully.
 */
async function refreshCatalog(ctx: ClientContext, controller: CalenderClientController): Promise<void> {
  try {
    const catalog = await controller.transportOptions()
    controller.setCatalog(overlaySessionTitles(catalog, runtimeSessionTitles(ctx)))
  } catch {
    // Degrade to free-text inputs; never take the GUI down.
  }
}

/** Read session id → display title from the browser runtime, when available. */
function runtimeSessionTitles(ctx: ClientContext): Map<string, string> | undefined {
  try {
    const sessions = (ctx as unknown as { sessions?: { list?: { getSnapshot?: () => { byId?: Record<string, { displayTitle?: string }> } } } }).sessions
    const byId = sessions?.list?.getSnapshot?.()?.byId
    if (byId === undefined) return undefined
    const map = new Map<string, string>()
    for (const id of Object.keys(byId)) {
      const t = byId[id]?.displayTitle
      if (t !== undefined && t !== '') map.set(id, t)
    }
    return map.size > 0 ? map : undefined
  } catch {
    return undefined
  }
}

