/** One timed task rendered on the week grid, with optional drag-to-move and
 * top/bottom edge resize (delegated to the grid via callbacks).
 */
import type { TaskRecord } from '../../core/tasks.ts'
import { quadrantOf, completedSubtaskCount } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../calendar.module.css'

export type TaskEditKind = 'move' | 'resize-start' | 'resize-end'

export interface TaskBlockProps {
  task: TaskRecord
  topPct: number
  heightPct: number
  leftPct: number
  widthPct: number
  onSelect: (id: string) => void
  /** Begin a drag edit; the grid owns pointer capture + time math. */
  onEditStart?: (e: React.PointerEvent<HTMLElement>, kind: TaskEditKind) => void
  /** True while this task is being dragged/resized (raise z-index). */
  editing?: boolean
}

const ACCENT: Record<string, string> = {
  do: css.quadrantDo,
  schedule: css.quadrantSchedule,
  delegate: css.quadrantDelegate,
  eliminate: css.quadrantEliminate,
}

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TaskBlock({ task, topPct, heightPct, leftPct, widthPct, onSelect, onEditStart, editing }: TaskBlockProps) {
  const q = quadrantOf(task.urgency, task.importance)
  const subCount = task.subtasks.length
  const subDone = completedSubtaskCount(task)
  const hasProvider = task.provider !== undefined && task.model !== undefined
  const scheduled = task.schedule?.enabled === true
  const running = task.executions.some(e => e.endedAt === undefined)

  const editable = onEditStart !== undefined

  const startMove = (e: React.PointerEvent<HTMLElement>): void => {
    if (onEditStart === undefined) return
    e.stopPropagation()
    onEditStart(e, 'move')
  }
  const startEdge = (kind: 'resize-start' | 'resize-end') => (e: React.PointerEvent<HTMLElement>): void => {
    if (onEditStart === undefined) return
    e.stopPropagation()
    onEditStart(e, kind)
  }

  return (
    <button
      type="button"
      className={`${css.taskBlock} ${ACCENT[q]} ${editing ? css.taskBlockEditing : ''}`}
      data-dsh-calendar-block=""
      style={{ top: `${topPct}%`, height: `${heightPct}%`, left: `${leftPct}%`, width: `${widthPct}%` }}
      onClick={() => onSelect(task.id)}
      onPointerDown={editable ? startMove : undefined}
      aria-label={task.title}
    >
      <span className={css.taskBlockHeader}>
        <span className={css.taskBlockTitle} data-done={task.done || undefined}>{task.title}</span>
        <span className={css.taskBlockTime}>{fmtTime(task.startAt)}–{fmtTime(task.endAt)}</span>
      </span>
      {(scheduled || running || subCount > 0 || hasProvider) && (
        <span className={css.taskBlockMeta}>
          {running && <span className={css.taskBadge} title={t('task.running')}>{t('task.running')}</span>}
          {scheduled && <span className={css.taskBadge} title={t('task.scheduled')}>🕐</span>}
          {subCount > 0 && <span className={css.taskBadge}>{t('task.progress', { done: subDone, total: subCount })}</span>}
          {hasProvider && (
            <span className={css.taskBadge}>{t('task.provider', { provider: task.provider!, model: task.model! })}</span>
          )}
        </span>
      )}
      {editable && (
        <>
          <span className={css.resizeHandleTop} onPointerDown={startEdge('resize-start')} aria-hidden="true" />
          <span className={css.resizeHandleBottom} onPointerDown={startEdge('resize-end')} aria-hidden="true" />
        </>
      )}
    </button>
  )
}
