/**
 * The calendar conversation-view slot body.
 *
 * The calendar is registered into the `conversation.view` ring (a session view
 * tab beside chat/trajectory). The view slot passes session-focused standard
 * props to each occupant, but the calendar is its own self-contained view, so
 * this body ignores those props and renders the controller-backed calendar
 * tree. The controller is created once at apply time and shared across session
 * view mounts (the Host ledger is a single source of truth).
 */
import type { ReactNode } from 'react'
import { CalendarView } from './components/CalendarView.tsx'
import type { calendarClientController } from './controller.ts'

/** Build the slot-view component bound to a shared controller. */
export function createCalendarSlotView(
  controller: calendarClientController,
  onOpenSession?: (sessionId: string) => void,
): (props: object) => ReactNode {
  return function CalendarSlotView(_props: object): ReactNode {
    return <CalendarView controller={controller} onOpenSession={onOpenSession} />
  }
}
