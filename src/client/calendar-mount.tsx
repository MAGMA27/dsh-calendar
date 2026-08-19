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
import { Component, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { calendarClientController } from './controller.ts'
import { CalendarView } from './components/CalendarView.tsx'
import { t } from './locales.ts'
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

/**
 * Error boundary around the calendar tree. A render exception must surface as
 * a readable message (and a console log), never as a silently blank column —
 * the original blank-screen failure mode.
 */
class CalendarBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state: { error: string | null } = { error: null }
  static getDerivedStateFromError(error: unknown): { error: string | null } {
    return { error: String(error) }
  }
  componentDidCatch(error: unknown): void {
    console.error('[dsh-calendar] calendar view render error:', error)
  }
  render(): ReactNode {
    if (this.state.error !== null) {
      return <div className={css.statusLine}>{t('status.error', { error: this.state.error })}</div>
    }
    return this.props.children
  }
}

/**
 * Mount the calendar React tree into the center column and bind visibility.
 *
 * The calendar container's show/hide and full-column sizing are driven by
 * INLINE STYLES here — the source of truth, immune to stylesheet injection
 * order and specificity. The attribute-scoped rule in calendar.module.css is
 * kept as reinforcement (it also hides the conversation beneath), but the
 * plugin no longer depends on it for the basics:
 *  - closed  => inline `display:none`, so it can never crowd/cover the chat;
 *  - open    => inline `display:block` + full-bleed absolute sizing, so it
 *    always occupies the column instead of rendering blank.
 */
export function mountcalendar(controller: calendarClientController, onOpenSession?: (sessionId: string) => void): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const applyActive = (): void => {
    const open = controller.getSnapshot().open
    if (open) {
      // Single-occupant center column: opening this panel evicts sibling
      // panels (task board / ssh), both html attribute and controller state.
      for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
    // Inline display is authoritative for presence in the column.
    if (container !== undefined) container.style.display = open ? 'block' : 'none'
  }

  const ensure = (): void => {
    if (container !== undefined) return
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.dshcalendarView = ''
    if (css.calendarView) container.className = css.calendarView
    // Inline styles: authoritative hard guarantees.
    container.style.position = 'absolute'
    container.style.top = '0'
    container.style.left = '0'
    container.style.right = '0'
    container.style.bottom = '0'
    container.style.zIndex = '60'
    container.style.background = 'var(--dsw-alias-bg-base)'
    container.style.display = 'none'
    column.appendChild(container)
    root = createRoot(container)
    root.render(
      <CalendarBoundary>
        <CalendarView controller={controller} onOpenSession={onOpenSession} />
      </CalendarBoundary>,
    )
    applyActive()
  }

  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })
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
