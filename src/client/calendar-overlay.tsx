/**
 * The calendar panel rendered into the `shell.overlay` slot.
 *
 * A root-scoped overlay (reachable without opening a session) that covers the
 * area to the RIGHT of the sidebar, leaving the sidebar visible and clickable —
 * the "task board" look. It rides the shell's frame-wide overlay layer for
 * stability; we just offset its left edge to the sidebar's right edge. When
 * the root open store is closed it renders nothing.
 */
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react'
import { CalendarView } from './components/CalendarView.tsx'
import type { calendarClientController } from './controller.ts'
import { isCalendarOpen, subscribeCalendarOpen } from './root-open.ts'
import css from './calendar.module.css'

const SIDEBAR_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"]'

/** Distance from the viewport left edge to the sidebar's right edge (px). */
function sidebarRightEdge(): number {
  const sb = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR)
  return sb ? sb.getBoundingClientRect().right : 0
}

/** Build the shell.overlay occupant, bound to a shared controller. */
export function createCalendarOverlay(
  controller: calendarClientController,
  onOpenSession?: (sessionId: string) => void,
): (props: object) => ReactNode {
  return function CalendarOverlay(_props: object): ReactNode {
    const open = useSyncExternalStore(subscribeCalendarOpen, isCalendarOpen)
    const [left, setLeft] = useState<number>(sidebarRightEdge)

    useEffect(() => {
      const measure = (): void => { setLeft(sidebarRightEdge()) }
      measure()
      const sb = document.querySelector<HTMLElement>(SIDEBAR_SELECTOR)
      const ro = typeof ResizeObserver !== 'undefined' && sb !== null
        ? new ResizeObserver(measure)
        : undefined
      if (ro !== undefined && sb !== null) ro.observe(sb)
      window.addEventListener('resize', measure)
      return () => {
        ro?.disconnect()
        window.removeEventListener('resize', measure)
      }
    }, [])

    if (!open) return null
    return (
      <div className={css.calendarOverlay} style={{ left }}>
        <CalendarView controller={controller} onOpenSession={onOpenSession} />
      </div>
    )
  }
}
