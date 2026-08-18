/** Agenda list grouped by overdue / today / upcoming. */
import type { CalenderClientController } from '../controller.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../calender.module.css'

interface AgendaPanelProps { controller: CalenderClientController }

function bucket(task: TaskRecord, now: number): 'overdue' | 'today' | 'upcoming' {
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999)
  if (task.startAt < new Date(now).setHours(0, 0, 0, 0)) return 'overdue'
  if (task.startAt <= todayEnd.getTime()) return 'today'
  return 'upcoming'
}

export function AgendaPanel({ controller }: AgendaPanelProps) {
  const snap = controller.getSnapshot()
  const now = Date.now()
  const groups: Array<{ key: 'overdue' | 'today' | 'upcoming'; label: string; tasks: TaskRecord[] }> = [
    { key: 'overdue', label: t('agenda.overdue'), tasks: [] },
    { key: 'today', label: t('agenda.today'), tasks: [] },
    { key: 'upcoming', label: t('agenda.upcoming'), tasks: [] },
  ]
  for (const task of snap.snapshot.tasks) {
    if (task.archivedAt !== undefined) continue
    const b = bucket(task, now)
    const g = groups.find(g => g.key === b)!
    g.tasks.push(task)
  }
  for (const g of groups) g.tasks.sort((a, b) => a.startAt - b.startAt)
  return (
    <div className={css.agendaPanel} data-dsh-calender-agenda="">
      {groups.map(g => (
        <section key={g.key} className={css.agendaGroup}>
          <h3 className={css.agendaTitle}>{g.label}</h3>
          {g.tasks.length === 0
            ? <p className={css.agendaEmpty}>{t('agenda.empty')}</p>
            : g.tasks.map(task => (
              <button type="button" key={task.id} className={css.agendaItem} onClick={() => controller.selectTask(task.id)}>
                <span className={css.agendaTime}>{new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(task.startAt)}</span>
                <span className={css.agendaText}>{task.title}</span>
              </button>
            ))}
        </section>
      ))}
    </div>
  )
}
