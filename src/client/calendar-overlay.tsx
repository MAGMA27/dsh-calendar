/**
 * The calendar panel rendered into the `shell.overlay` slot.
 *
 * A root-scoped, frame-wide overlay: it appears above every column and outside
 * their scroll containers, and it is reachable without opening a session. When
 * the root open store is closed it renders nothing.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { CalendarView } from './components/CalendarView.tsx'
import type { calendarClientController } from './controller.ts'
import { isCalendarOpen, subscribeCalendarOpen } from './root-open.ts'
import css from './calendar.module.css'

/** Build the shell.overlay occupant, bound to a shared controller. */
export function createCalendarOverlay(
  controller: calendarClientController,
  onOpenSession?: (sessionId: string) => void,
): (props: object) => ReactNode {
  return function CalendarOverlay(_props: object): ReactNode {
    const open = useSyncExternalStore(subscribeCalendarOpen, isCalendarOpen)
    if (!open) return null
    return (
      <div className={css.calendarOverlay}>
        <CalendarView controller={controller} onOpenSession={onOpenSession} />
      </div>
    )
  }
}
