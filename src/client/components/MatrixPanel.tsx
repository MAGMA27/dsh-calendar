/** Eisenhower 2x2 view grouping tasks by quadrant, with drag-to-quadrant to
 * change urgency/importance. Each task is a rich card: time range, status
 * chips, subtask progress, done state.
 */
import { useState } from 'react'
import type { calendarClientController } from '../controller.ts'
import { type Quadrant, type Urgency, type Importance, isTaskOverdue, quadrantOf, collapseRepeatSeries } from '../../core/tasks.ts'
import { t, type calendarKey } from '../locales.ts'
import { TaskDate, TaskOverdue, TaskTime, TaskBadges, SubtaskTrack } from './TaskExtras.tsx'
import css from '../calendar.module.css'

const QUADRANTS: Array<{ q: Quadrant; urgency: 'high' | 'low'; importance: 'high' | 'low' }> = [
  { q: 'do', urgency: 'high', importance: 'high' },
  { q: 'schedule', urgency: 'low', importance: 'high' },
  { q: 'delegate', urgency: 'high', importance: 'low' },
  { q: 'eliminate', urgency: 'low', importance: 'low' },
]
const ACCENT: Record<string, string> = {
  do: css.quadrantDo,
  schedule: css.quadrantSchedule,
  delegate: css.quadrantDelegate,
  eliminate: css.quadrantEliminate,
}
const LABEL: Record<Quadrant, calendarKey> = {
  do: 'quadrant.do', schedule: 'quadrant.schedule', delegate: 'quadrant.delegate', eliminate: 'quadrant.eliminate',
}

interface MatrixPanelProps {
  controller: calendarClientController
}

const DRAG_KIND = 'application/x-dsh-calendar-task'

export function MatrixPanel({ controller }: MatrixPanelProps) {
  const snap = controller.getSnapshot()
  const collapsed = collapseRepeatSeries(snap.snapshot.tasks, 'oldest')
  const now = Date.now()
  const [over, setOver] = useState<Quadrant | undefined>(undefined)

  const onDrop = (q: Quadrant, urgency: 'high' | 'low', importance: 'high' | 'low') => (e: React.DragEvent): void => {
    e.preventDefault()
    setOver(undefined)
    const id = e.dataTransfer.getData(DRAG_KIND)
    if (id === '') return
    void controller.dispatch({ kind: 'setQuadrant', id, urgency: urgency as Urgency, importance: importance as Importance })
  }

  return (
    <div className={css.matrixPanel} data-dsh-calendar-matrix="">
      {QUADRANTS.map(({ q, urgency, importance }) => {
        const tasks = collapsed.filter(task => !task.archivedAt && task.urgency === urgency && task.importance === importance)
        return (
          <div key={q}
            className={css.matrixQuadrant + ' ' + ACCENT[q] + (over === q ? ' ' + css.matrixOver : '')}
            role="group" aria-label={LABEL[q]}
            onDragOver={e => { e.preventDefault(); if (over !== q) setOver(q) }}
            onDragLeave={() => setOver(undefined)}
            onDrop={onDrop(q, urgency, importance)}>
            <div className={css.matrixQuadrantHeader}>
              <span className={css.matrixQuadrantTitle}>{t(LABEL[q])}</span>
              {tasks.length > 0 && <span className={css.matrixQuadrantCount}>{tasks.length}</span>}
            </div>
            <div className={css.matrixList}>
              {tasks.length === 0 && <p className={css.matrixEmpty}>{t('agenda.empty')}</p>}
              {tasks.map(task => {
                const acc = ACCENT[quadrantOf(task.urgency, task.importance)]
                const overdue = isTaskOverdue(task, now)
                return (
                  <button type="button" key={task.id} draggable className={css.matrixItem + ' ' + acc}
                    data-overdue={overdue || undefined}
                    onDragStart={e => e.dataTransfer.setData(DRAG_KIND, task.id)}
                    onClick={() => controller.selectTask(task.id)}>
                    <span className={css.matrixItemTitle} data-done={task.done || undefined}>{task.title}</span>
                    <span className={css.matrixItemMeta}>
                      <TaskDate task={task} />
                      <TaskTime task={task} />
                      <TaskOverdue task={task} now={now} />
                      <TaskBadges task={task} />
                    </span>
                    <SubtaskTrack task={task} />
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
