/**
 * Month view: weekday header + day cells with task chips; clicking a day jumps
 * to week view. Days from the adjacent months (the leading/trailing padding)
 * are dimmed to keep the current month obvious; today gets a filled circle.
 */
import type { calendarClientController } from '../controller.ts'
import { blockOnDay, monthDays, sameMonth } from '../../core/calendar.ts'
import { quadrantOf, taskMatchesQuery } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../calendar.module.css'

const ACCENT: Record<string, string> = {
  do: css.quadrantDo,
  schedule: css.quadrantSchedule,
  delegate: css.quadrantDelegate,
  eliminate: css.quadrantEliminate,
}

interface MonthGridProps {
  controller: calendarClientController
  /** Free-text task filter (blank matches everything). */
  query?: string
}

/** The 7 weekday headers, Monday-first or Sunday-first per weekStart. */
function weekdayLabels(weekStart: 0 | 1): string[] {
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
  const d = new Date(2026, 0, 4 + (weekStart === 0 ? 1 : 0))
  const labels: string[] = []
  for (let i = 0; i < 7; i++) {
    labels.push(fmt.format(new Date(d.getTime() + i * 86_400_000)))
  }
  return labels
}

/** Short month name (e.g. "9月" / "Sep") for the 1st-of-month cells. */
function monthShortLabel(dateMs: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(dateMs))
}

export function MonthGrid({ controller, query = '' }: MonthGridProps) {
  const snap = controller.getSnapshot()
  const days = monthDays(snap.cursor, snap.weekStart)
  const todayKey = new Date().toDateString()
  const weekdays = weekdayLabels(snap.weekStart)
  return (
    <div className={css.monthWrap} data-dsh-calendar-month="">
      <div className={css.monthWeekHeader} aria-hidden="true">
        {weekdays.map((label, i) => <span key={i} className={css.monthWeekDay}>{label}</span>)}
      </div>
      <div className={css.monthGrid}>
        {days.map(day => {
          const dayEnd = day.dateMs + 24 * 60 * 60_000
          const dayTasks = snap.snapshot.tasks.filter(task => !task.archivedAt && taskMatchesQuery(task, query) && blockOnDay(task.startAt, task.endAt, day.dateMs, dayEnd))
          const isToday = new Date(day.dateMs).toDateString() === todayKey
          const inMonth = sameMonth(day.dateMs, snap.cursor)
          const isFirstOfMonth = new Date(day.dateMs).getDate() === 1
          return (
            <button
              type="button"
              key={day.key}
              className={css.monthCell}
              data-today={isToday || undefined}
              data-outside={!inMonth || undefined}
              onClick={() => { controller.setCursor(day.dateMs); controller.setView('week') }}
            >
              <span className={css.monthCellDateRow}>
                {isFirstOfMonth && <span className={css.monthCellMonthLabel}>{monthShortLabel(day.dateMs)}</span>}
                <span className={css.monthCellDay}>{new Date(day.dateMs).getDate()}</span>
              </span>
              <span className={css.monthChips}>
                {dayTasks.slice(0, 4).map(task => (
                  <span key={task.id} className={`${css.taskChip} ${ACCENT[quadrantOf(task.urgency, task.importance)]}`}>
                    {task.title}
                  </span>
                ))}
                {dayTasks.length > 4 && <span className={css.monthMore}>+{dayTasks.length - 4}</span>}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
