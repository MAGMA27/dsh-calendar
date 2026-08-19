/**
 * Calendar view mounting into the center column.
 *
 * The `conversation` slot is single-occupant (ui-conversation) and external
 * plugins cannot declare slots, so the calendar takes over the center column
 * at the DOM level: a container is appended inside the center column as an
 * extra trailing child React never manages, and a stylesheet rule hides the
 * conversation content while the calendar is active. Toggling is a data
 * attribute on <html> — no React involvement, so the conversation subtree
 * underneath stays mounted and stateful.
 */
import { createRoot, type Root } from 'react-dom/client'
import type { calendarClientController } from './controller.ts'
import { CalendarView } from './components/CalendarView.tsx'
import css from './calendar.module.css'

export const calendar_VIEW_SELECTOR = '[data-dsh-calendar-view]'

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const ACTIVE_ATTR = 'data-dsh-calendar-active'
const OTHER_ACTIVE_ATTRS = ['data-dsh-taskboard-active', 'data-dsh-ssh-active']
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'calendar'

function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

/** Mount the calendar React tree into the center column and bind visibility. */
export function mountcalendar(controller: calendarClientController, onOpenSession?: (sessionId: string) => void): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const ensure = (): void => {
    if (container !== undefined) return
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.dshcalendarView = ''
    container.className = css.calendarView
    column.appendChild(container)
    root = createRoot(container)
    root.render(<CalendarView controller={controller} onOpenSession={onOpenSession} />)
  }

  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (controller.getSnapshot().open) {
      // Single-occupant center column: opening this panel evicts sibling
      // panels (task board / ssh), both html attribute and controller state.
      for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }
  const onOtherActivate = (event: Event): void => {
    const detail = (event as CustomEvent).detail
    if (detail !== PANEL_NAME && controller.getSnapshot().open) controller.closePanel()
  }
  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="newSession"]'
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!controller.getSnapshot().open) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.closePanel()
  }
  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
