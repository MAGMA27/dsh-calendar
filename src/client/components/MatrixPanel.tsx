/** Eisenhower 2x2 view grouping tasks by quadrant. */
import type { CalenderClientController } from '../controller.ts'
import { quadrantOf, type Quadrant } from '../../core/tasks.ts'
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

export function MatrixPanel({ controller }: MatrixPanelProps) {
  const snap = controller.getSnapshot()
  return (
    <div className={css.matrixPanel} data-dsh-calender-matrix="">
      {QUADRANTS.map(({ q, urgency, importance }) => {
        const tasks = snap.snapshot.tasks.filter(task => !task.archivedAt && task.urgency === urgency && task.importance === importance)
        return (
          <div key={q} className={`${css.matrixQuadrant} ${ACCENT[q]}`} role="group" aria-label={LABEL[q]}>
            <div className={css.matrixQuadrantTitle}>{t(LABEL[q] as any)}</div>
            <div className={css.matrixList}>
              {tasks.map(task => (
                <button type="button" key={task.id} className={css.matrixItem} onClick={() => controller.selectTask(task.id)}>
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
