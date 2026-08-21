/** Agenda list grouped by overdue / today / upcoming / done. Each row is a
 * rich card: time range, quadrant stripe, status chips, description snippet
 * and a subtask progress track.
 */
import type { calendarClientController } from '../controller.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { isTaskOccurrenceVisible, isTaskOverdue, isTaskVisibleInOverview, quadrantOf, collapseRepeatSeries } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import { TaskDoneCheckbox, TaskTime, TaskBadges, SubtaskTrack } from './TaskExtras.tsx'
import css from '../calendar.module.css'

interface AgendaPanelProps {
  controller: calendarClientController
}

type Bucket = 'overdue' | 'today' | 'upcoming' | 'done'

const ACCENT: Record<string, string> = {
  do: css.quadrantDo,
  schedule: css.quadrantSchedule,
  delegate: css.quadrantDelegate,
  eliminate: css.quadrantEliminate,
}

function bucket(task: TaskRecord, now: number): Bucket {
  if (task.done) return 'done'
  const todayEnd = new Date(now); todayEnd.setHours(23, 59, 59, 999)
  if (isTaskOverdue(task, now)) return 'overdue'
  if (task.startAt <= todayEnd.getTime()) return 'today'
  return 'upcoming'
}

export function AgendaPanel({ controller }: AgendaPanelProps) {
  const snap = controller.getSnapshot()
  const now = Date.now()
  const collapsed = collapseRepeatSeries(
    snap.snapshot.tasks.filter(task => !task.archivedAt && isTaskOccurrenceVisible(task) && isTaskVisibleInOverview(task, now)),
    'oldest',
    now,
  )
  const groups: Array<{ key: Bucket; label: string; tasks: TaskRecord[] }> = [
    { key: 'overdue', label: t('agenda.overdue'), tasks: [] },
    { key: 'today', label: t('agenda.today'), tasks: [] },
    { key: 'upcoming', label: t('agenda.upcoming'), tasks: [] },
    { key: 'done', label: t('agenda.done'), tasks: [] },
  ]
  for (const task of collapsed) {
    const b = bucket(task, now)
    const g = groups.find(g => g.key === b)!
    g.tasks.push(task)
  }
  for (const g of groups) g.tasks.sort((a, b) => a.startAt - b.startAt)
  return (
    <div className={css.agendaPanel} data-dsh-calendar-agenda="">
      {groups.map(g => (
        <section key={g.key} className={css.agendaGroup} data-group={g.key}>
          <div className={css.agendaGroupHeader}>
            <span className={css.agendaGroupDot} aria-hidden="true" />
            <h3 className={css.agendaTitle}>{g.label}</h3>
            <span className={css.agendaGroupLine} aria-hidden="true" />
            {g.tasks.length > 0 && <span className={css.agendaCount}>{g.tasks.length}</span>}
          </div>
          {g.tasks.length === 0
            ? <p className={css.agendaEmpty}>{t('agenda.empty')}</p>
            : g.tasks.map(task => {
              const acc = ACCENT[quadrantOf(task.urgency, task.importance)]
              return (
                <div key={task.id} role="button" tabIndex={0} className={css.agendaItem + ' ' + acc}
                  data-overdue={g.key === 'overdue' ? 'true' : undefined}
                  data-done={task.done || undefined}
                  onClick={() => controller.selectTask(task.id)}
                  onKeyDown={e => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); controller.selectTask(task.id) }
                  }}
                  aria-label={task.title}>
                  <span className={css.agendaItemHead}>
                    <TaskTime task={task} />
                    <span className={css.agendaBadges}><TaskBadges task={task} /></span>
                  </span>
                  <span className={css.agendaTextRow}>
                    <TaskDoneCheckbox task={task} onToggle={done => { void controller.dispatch({ kind: 'setDone', id: task.id, done }) }} />
                    <span className={css.agendaText} data-done={task.done || undefined}>{task.title}</span>
                  </span>
                  {task.description !== '' && <span className={css.agendaDesc}>{task.description}</span>}
                  <SubtaskTrack task={task} />
                </div>
              )
            })}
        </section>
      ))}
    </div>
  )
}
