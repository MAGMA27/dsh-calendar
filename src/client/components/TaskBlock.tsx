/** One timed task rendered on the week grid. */
import type { TaskRecord } from '../../core/tasks.ts'
import { quadrantOf } from '../../core/tasks.ts'
import { completedSubtaskCount } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../calender.module.css'

export interface TaskBlockProps {
  task: TaskRecord
  topPct: number
  heightPct: number
  leftPct: number
  widthPct: number
  onSelect: (id: string) => void
}

const ACCENT: Record<string, string> = {
  do: css.quadrantDo,
  schedule: css.quadrantSchedule,
  delegate: css.quadrantDelegate,
  eliminate: css.quadrantEliminate,
}

export function TaskBlock({ task, topPct, heightPct, leftPct, widthPct, onSelect }: TaskBlockProps) {
  const q = quadrantOf(task.urgency, task.importance)
  const subCount = task.subtasks.length
  const subDone = completedSubtaskCount(task)
  const hasProvider = task.provider !== undefined && task.model !== undefined
  const scheduled = task.schedule?.enabled === true
  return (
    <button
      type="button"
      className={`${css.taskBlock} ${ACCENT[q]}`}
      data-dsh-calender-block=""
      style={{ top: `${topPct}%`, height: `${heightPct}%`, left: `${leftPct}%`, width: `${widthPct}%` }}
      onClick={() => onSelect(task.id)}
      aria-label={task.title}
    >
      <span className={css.taskBlockTitle} data-done={task.done || undefined}>{task.title}</span>
      {(scheduled || subCount > 0 || hasProvider) && (
        <span className={css.taskBlockMeta}>
          {scheduled && <span className={css.taskBadge} title={t('task.scheduled')}>🕐</span>}
          {subCount > 0 && <span className={css.taskBadge}>{t('task.progress', { done: subDone, total: subCount })}</span>}
          {hasProvider && (
            <span className={css.taskBadge}>{t('task.provider', { provider: task.provider!, model: task.model! })}</span>
          )}
        </span>
      )}
    </button>
  )
}
