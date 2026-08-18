/** Eisenhower 2x2 view grouping tasks by quadrant, with drag-to-quadrant to
 * change urgency/importance.
 */
import { useState } from 'react'
import type { CalenderClientController } from '../controller.ts'
import { type Quadrant, type Urgency, type Importance } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../calender.module.css'

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
const LABEL: Record<Quadrant, string> = {
  do: 'quadrant.do', schedule: 'quadrant.schedule', delegate: 'quadrant.delegate', eliminate: 'quadrant.eliminate',
}

interface MatrixPanelProps { controller: CalenderClientController }

const DRAG_KIND = 'application/x-dsh-calender-task'

export function MatrixPanel({ controller }: MatrixPanelProps) {
  const snap = controller.getSnapshot()
  const [over, setOver] = useState<Quadrant | undefined>(undefined)

  const onDrop = (q: Quadrant, urgency: 'high' | 'low', importance: 'high' | 'low') => (e: React.DragEvent): void => {
    e.preventDefault()
    setOver(undefined)
    const id = e.dataTransfer.getData(DRAG_KIND)
    if (id === '') return
    void controller.dispatch({ kind: 'setQuadrant', id, urgency: urgency as Urgency, importance: importance as Importance })
  }

  return (
    <div className={css.matrixPanel} data-dsh-calender-matrix="">
      {QUADRANTS.map(({ q, urgency, importance }) => {
        const tasks = snap.snapshot.tasks.filter(task => !task.archivedAt && task.urgency === urgency && task.importance === importance)
        return (
          <div key={q}
            className={`${css.matrixQuadrant} ${ACCENT[q]} ${over === q ? css.matrixOver : ''}`}
            role="group" aria-label={LABEL[q]}
            onDragOver={e => { e.preventDefault(); if (over !== q) setOver(q) }}
            onDragLeave={() => setOver(undefined)}
            onDrop={onDrop(q, urgency, importance)}>
            <div className={css.matrixQuadrantTitle}>{t(LABEL[q] as any)}</div>
            <div className={css.matrixList}>
              {tasks.map(task => (
                <button type="button" key={task.id} draggable className={css.matrixItem}
                  onDragStart={e => e.dataTransfer.setData(DRAG_KIND, task.id)}
                  onClick={() => controller.selectTask(task.id)}>
                  {task.title}
                </button>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
