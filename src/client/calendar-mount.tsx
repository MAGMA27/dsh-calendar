/**
 * Calendar overlay mounting into the center column.
 *
 * The original, session-independent entry: a sidebar icon toggles a calendar
 * overlay that fills the whole center column, so it works even with no active
 * session (a blank / new-conversation window). The overlay is mounted by
 * appending a container inside the center column; the shell's own React
 * renderer fully owns that column and can tear our container down on a
 * re-render, so mounting is self-healing: the container is recreated whenever
 * it is missing or detached, as long as this fiber stays alive.
 */
import { Component, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { calendarClientController } from './controller.ts'
import { CalendarView } from './components/CalendarView.tsx'
import css from './calendar.module.css'

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const ACTIVE_ATTR = 'data-dsh-calendar-active'

function conversationColumn(): HTMLElement | undefined {
  const el = document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR)
  return el ?? undefined
}

/** Error boundary: a render exception surfaces as text, never a silent blank. */
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
      return <div className={css.statusLine}>{this.state.error}</div>
    }
    return this.props.children
  }
}

/**
 * Mount the calendar overlay into the center column. The overlay is
 * root-level (does not depend on an active session), fills the column, and is
 * shown/hidden by the controller's open flag. Self-healing: recreates the
 * container whenever the shell's re-renders detach it.
 */
export function mountcalendar(controller: calendarClientController, onOpenSession?: (sessionId: string) => void): () => void {
  let root: Root | undefined
  let container: HTMLElement | undefined

  const createContainer = (): void => {
    if (container !== undefined && container.isConnected) return
    if (container !== undefined) {
      root?.unmount()
      root = undefined
      container.remove()
      container = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.dshcalendarView = ''
    if (css.calendarView) container.className = css.calendarView
    // Inline styles are authoritative and immune to stylesheet ordering.
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
  }

  const applyActive = (): void => {
    const open = controller.getSnapshot().open
    if (open) {
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
    // A live, connected container is required before display can mean anything.
    if (container === undefined || !container.isConnected) createContainer()
    if (container !== undefined) container.style.display = open ? 'block' : 'none'
  }

  const reassert = (): void => {
    if (container === undefined || !container.isConnected) createContainer()
    if (container !== undefined) container.style.display = controller.getSnapshot().open ? 'block' : 'none'
  }

  const waitObserver = new MutationObserver(reassert)
  waitObserver.observe(document.body, { childList: true, subtree: true })
  const selfHealTimer = globalThis.setInterval ? globalThis.setInterval(reassert, 1000) : undefined

  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  createContainer()

  return () => {
    if (selfHealTimer !== undefined) globalThis.clearInterval(selfHealTimer)
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
