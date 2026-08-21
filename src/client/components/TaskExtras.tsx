/** Shared meta pieces for rich task rows (matrix / agenda): the date/time
 * chips and the status badges (running / scheduled / subtasks / pinned LLM).
 */
import type { ReactNode } from 'react'
import type { TaskRecord } from '../../core/tasks.ts'
import { completedSubtaskCount, isTaskOverdue, taskOccurrenceTriggersAgent } from '../../core/tasks.ts'
import { hhmm } from '../../core/calendar.ts'
import { t } from '../locales.ts'
import css from '../calendar.module.css'

/** "09:00–10:30" chip for a timed task block. */
export function TaskTime({ task }: { task: TaskRecord }): ReactNode {
  return <span className={css.taskTime}>{hhmm(task.startAt)}–{hhmm(task.endAt)}</span>
}

/** Local calendar date chip for list-style task cards. */
export function TaskDate({ task }: { task: TaskRecord }): ReactNode {
  return <span className={css.taskDate}>{new Date(task.startAt).toLocaleDateString()}</span>
}

/** Red marker for an unfinished task whose calendar date has passed. */
export function TaskOverdue({ task, now = Date.now() }: { task: TaskRecord; now?: number }): ReactNode {
  if (!isTaskOverdue(task, now)) return null
  return <span className={`${css.taskBadge} ${css.taskBadgeOverdue}`} title={t('agenda.overdue')}>{t('agenda.overdue')}</span>
}

/** Status chips for one task: running / scheduled / subtask progress / pinned LLM. */
export function TaskBadges({ task }: { task: TaskRecord }): ReactNode {
  const subCount = task.subtasks.length
  const subDone = completedSubtaskCount(task)
  const running = task.executions.some(e => e.endedAt === undefined)
  const scheduled = taskOccurrenceTriggersAgent(task)
  const latest = task.executions[task.executions.length - 1]
  const failed = latest?.result === 'failed'
  const isCopy = task.originTaskId !== undefined
  const hasProvider = task.provider !== undefined && task.model !== undefined
  const chips: ReactNode[] = []
  if (running) {
    chips.push(
      <span key="run" className={css.taskBadge} title={t('task.running')}>
        <span className={css.badgeDot} aria-hidden="true" />{t('task.running')}
      </span>,
    )
  }
  if (failed) chips.push(<span key="failed" className={css.taskBadge} title={t('task.failed')}>{t('task.failed')}</span>)
  if (scheduled) chips.push(<span key="sched" className={css.taskBadge} title={t('task.scheduled')}>🕐</span>)
  if (isCopy) chips.push(<span key="copy" className={css.taskBadge} title={t('task.repeatCopy')}>↻</span>)
  if (subCount > 0) chips.push(<span key="sub" className={css.taskBadge}>{t('task.progress', { done: subDone, total: subCount })}</span>)
  if (hasProvider) chips.push(<span key="prov" className={css.taskBadge}>{t('task.provider', { provider: task.provider!, model: task.model! })}</span>)
  return <>{chips}</>
}

/** A slim subtask progress track; renders nothing without subtasks. */
export function SubtaskTrack({ task }: { task: TaskRecord }): ReactNode {
  const total = task.subtasks.length
  if (total === 0) return null
  const done = completedSubtaskCount(task)
  const pct = Math.round((done / total) * 100)
  return (
    <span className={css.subtaskTrack} role="progressbar" aria-valuenow={done} aria-valuemin={0} aria-valuemax={total} title={t('task.progress', { done, total })}>
      <span className={css.subtaskTrackFill} style={{ width: pct + '%' }} />
    </span>
  )
}
