/** Agenda list grouped by overdue / today / upcoming / done. Each row is a
 * rich card: time range, quadrant stripe, status chips, description snippet
 * and a subtask progress track.
 */
import type { CalenderClientController } from '../controller.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { quadrantOf } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import { TaskTime, TaskBadges, SubtaskTrack } from './TaskExtras.tsx'
import css from '../calender.module.css'

interface AgendaPanelProps { controller: CalenderClientController }

type Bucket = 'overdue' | 'today' | 'upcoming' | 'done'

const ACCENT: Record<string, string> = {
  do: css.quadrantDo,
  schedule: css.quadrantSchedule,
  delegate: css.quadrantDelegate,
  eliminate: css.quadrantEliminate,
}

function bucket(task: TaskRecord, now: number): Bucket {
  if (task.done) return 'done'
  const todayStart = new Date(now); todayStart.setHours(0, 0, 0, 0)
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999)
  if (task.startAt < todayStart.getTime()) return 'overdue'
  if (task.startAt <= todayEnd.getTime()) return 'today'
  return 'upcoming'
}

export function AgendaPanel({ controller }: AgendaPanelProps) {
  const snap = controller.getSnapshot()
  const now = Date.now()
  const groups: Array<{ key: Bucket; label: string; tasks: TaskRecord[] }> = [
    { key: 'overdue', label: t('agenda.overdue'), tasks: [] },
    { key: 'today', label: t('agenda.today'), tasks: [] },
    { key: 'upcoming', label: t('agenda.upcoming'), tasks: [] },
    { key: 'done', label: t('agenda.done'), tasks: [] },
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
          <h3 className={css.agendaTitle}>
            {g.label}
            {g.tasks.length > 0 && <span className={css.agendaCount}>{g.tasks.length}</span>}
          </h3>
          {g.tasks.length === 0
            ? <p className={css.agendaEmpty}>{t('agenda.empty')}</p>
            : g.tasks.map(task => {
              const acc = ACCENT[quadrantOf(task.urgency, task.importance)]
              return (
                <button type="button" key={task.id} className={css.agendaItem + ' ' + acc}
                  data-overdue={g.key === 'overdue' ? 'true' : undefined}
                  data-done={task.done || undefined}
                  onClick={() => controller.selectTask(task.id)}>
                  <span className={css.agendaItemHead}>
                    <TaskTime task={task} />
                    <span className={css.agendaBadges}><TaskBadges task={task} /></span>
                  </span>
                  <span className={css.agendaText} data-done={task.done || undefined}>{task.title}</span>
                  {task.description !== '' && <span className={css.agendaDesc}>{task.description}</span>}
                  <SubtaskTrack task={task} />
                </button>
              )
            })}
        </section>
      ))}
    </div>
  )
}
