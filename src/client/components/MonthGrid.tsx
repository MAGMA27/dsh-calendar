/** Month view: day cells with task chips; clicking a day jumps to week view. */
import type { calendarClientController } from '../controller.ts'
import { blockOnDay, monthDays } from '../../core/calendar.ts'
import { quadrantOf } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../calendar.module.css'

const ACCENT: Record<string, string> = {
  do: css.quadrantDo,
  schedule: css.quadrantSchedule,
  delegate: css.quadrantDelegate,
  eliminate: css.quadrantEliminate,
}

interface MonthGridProps { controller: calendarClientController }

export function MonthGrid({ controller }: MonthGridProps) {
  const snap = controller.getSnapshot()
  const days = monthDays(snap.cursor, snap.weekStart)
  const todayKey = new Date().toDateString()
  return (
    <div className={css.monthGrid} data-dsh-calendar-month="">
      {days.map(day => {
        const dayEnd = day.dateMs + 24 * 60 * 60_000
        const dayTasks = snap.snapshot.tasks.filter(task => !task.archivedAt && blockOnDay(task.startAt, task.endAt, day.dateMs, dayEnd))
        const isToday = new Date(day.dateMs).toDateString() === todayKey
        return (
          <button
            type="button"
            key={day.key}
            className={css.monthCell}
            data-today={isToday || undefined}
            onClick={() => { controller.setCursor(day.dateMs); controller.setView('week') }}
          >
            <span className={css.monthCellDay}>{new Date(day.dateMs).getDate()}</span>
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
  )
}
