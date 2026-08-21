/** One timed task rendered on the week grid, with optional drag-to-move and
 * top/bottom edge resize (delegated to the grid via callbacks).
 */
import type { TaskRecord } from '../../core/tasks.ts'
import { quadrantOf, completedSubtaskCount, taskOccurrenceTriggersAgent } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import { TaskDoneCheckbox } from './TaskExtras.tsx'
import css from '../calendar.module.css'

export type TaskEditKind = 'move' | 'resize-start' | 'resize-end'

export interface TaskBlockProps {
  task: TaskRecord
  topPct: number
  heightPct: number
  leftPct: number
  widthPct: number
  onSelect: (id: string) => void
  /** Toggle completion without opening the detail panel. */
  onToggleDone?: (id: string, done: boolean) => void
  /** Toggle a visible subtask directly from a spacious time block. */
  onToggleSubtask?: (taskId: string, subtaskId: string, done: boolean) => void
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
const COMPACT_DURATION_MS = 30 * 60_000

function fmtTime(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TaskBlock({ task, topPct, heightPct, leftPct, widthPct, onSelect, onToggleDone, onToggleSubtask, onEditStart, editing }: TaskBlockProps) {
  const q = quadrantOf(task.urgency, task.importance)
  const subCount = task.subtasks.length
  const subDone = completedSubtaskCount(task)
  const hasProvider = task.provider !== undefined && task.model !== undefined
  const scheduled = taskOccurrenceTriggersAgent(task)
  const isCopy = task.originTaskId !== undefined
  const running = task.executions.some(e => e.endedAt === undefined)
  const latest = task.executions[task.executions.length - 1]
  const failed = latest?.result === 'failed'
  const compact = task.endAt - task.startAt <= COMPACT_DURATION_MS
  const bodyText = task.description.trim() !== '' ? task.description.trim() : task.prompt.trim()
  const showBody = !compact && heightPct >= 7 && (bodyText !== '' || subCount > 0)
  const visibleSubtasks = task.subtasks.slice(0, 4)
  const hiddenSubtaskCount = Math.max(0, subCount - visibleSubtasks.length)
  const hasInlineSignals = isCopy || scheduled || running || failed || (compact && (subCount > 0 || hasProvider))

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

  const stopSubtaskEvent = (e: React.SyntheticEvent<HTMLElement>): void => {
    e.stopPropagation()
  }

  return (
    <div
      role="button"
      tabIndex={0}
      className={`${css.taskBlock} ${ACCENT[q]} ${editing ? css.taskBlockEditing : ''}`}
      data-dsh-calendar-block=""
      data-done={task.done || undefined}
      style={{ top: `${topPct}%`, height: `${heightPct}%`, left: `${leftPct}%`, width: `${widthPct}%` }}
      onClick={() => onSelect(task.id)}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(task.id) }
      }}
      onPointerDown={editable ? startMove : undefined}
      aria-label={task.title}
    >
      <span className={`${css.taskBlockHeader} ${compact ? css.taskBlockHeaderCompact : ''}`}>
        {onToggleDone !== undefined && <TaskDoneCheckbox task={task} compact onToggle={done => onToggleDone(task.id, done)} />}
        <span className={css.taskBlockTitle} data-done={task.done || undefined}>{task.title}</span>
        {hasInlineSignals && (
          <span className={css.taskBlockSignalSlot}>
            {isCopy && <span className={`${css.taskBadge} ${css.taskBadgeCompact}`} title={t('task.repeatCopy')}>↻</span>}
            {scheduled && <span className={`${css.taskBadge} ${css.taskBadgeCompact}`} title={t('task.scheduled')}>🕐</span>}
            {running && <span className={`${css.taskBadge} ${css.taskBadgeCompact}`} title={t('task.running')}>●</span>}
            {failed && <span className={`${css.taskBadge} ${css.taskBadgeCompact}`} title={t('task.failed')}>!</span>}
            {compact && subCount > 0 && <span className={`${css.taskBadge} ${css.taskBadgeCompact}`} title={t('task.progress', { done: subDone, total: subCount })}>{subDone}/{subCount}</span>}
            {compact && hasProvider && <span className={`${css.taskBadge} ${css.taskBadgeCompact}`} title={t('task.provider', { provider: task.provider!, model: task.model! })}>LLM</span>}
          </span>
        )}
        <span className={css.taskBlockTime}>{fmtTime(task.startAt)}–{fmtTime(task.endAt)}</span>
      </span>
      {!compact && (running || failed || subCount > 0 || hasProvider) && (
        <span className={css.taskBlockMeta}>
          {running && <span className={css.taskBadge} title={t('task.running')}>{t('task.running')}</span>}
          {failed && <span className={css.taskBadge} title={t('task.failed')}>{t('task.failed')}</span>}
          {subCount > 0 && <span className={css.taskBadge}>{t('task.progress', { done: subDone, total: subCount })}</span>}
          {hasProvider && (
            <span className={css.taskBadge}>{t('task.provider', { provider: task.provider!, model: task.model! })}</span>
          )}
        </span>
      )}
      {showBody && (
        <span className={css.taskBlockBody} data-dsh-calendar-task-body="">
          {bodyText !== '' && <span className={css.taskBlockDescription}>{bodyText}</span>}
          {subCount > 0 && (
            <span className={css.taskBlockSubtasks}>
              {visibleSubtasks.map(subtask => (
                <span key={subtask.id} className={css.taskBlockSubtask}>
                  {onToggleSubtask !== undefined ? (
                    <span className={`${css.doneCheckbox} ${css.taskBlockSubtaskToggle}`} data-checked={subtask.done || undefined}
                      onPointerDown={stopSubtaskEvent} onClick={stopSubtaskEvent} onKeyDown={stopSubtaskEvent}>
                      <input type="checkbox" checked={subtask.done} aria-label={subtask.title}
                        onChange={e => { e.stopPropagation(); onToggleSubtask(task.id, subtask.id, e.currentTarget.checked) }} />
                    </span>
                  ) : (
                    <span className={css.taskBlockSubtaskMarker} aria-hidden="true">{subtask.done ? '✓' : '○'}</span>
                  )}
                  <span className={subtask.done ? css.taskBlockSubtaskDone : css.taskBlockSubtaskText}>{subtask.title}</span>
                </span>
              ))}
              {hiddenSubtaskCount > 0 && <span className={css.taskBlockMore}>+{hiddenSubtaskCount}</span>}
            </span>
          )}
        </span>
      )}
      {editable && (
        <>
          <span className={css.resizeHandleTop} onPointerDown={startEdge('resize-start')} aria-hidden="true" />
          <span className={css.resizeHandleBottom} onPointerDown={startEdge('resize-end')} aria-hidden="true" />
        </>
      )}
    </div>
  )
}
