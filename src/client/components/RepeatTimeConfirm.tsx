/**
 * Confirmation for a time change made to a repeat-series task (week-grid drag):
 * the user must choose whether to apply the change to this task only or to the
 * whole series. On a bound copy, "this" unbinds it from the template and the
 * other copies; on the template, "this" moves only the template (future copies
 * follow, existing copies keep their times). "All" shifts the template + every
 * bound copy by the same deltas. Rendered by CalendarView while the controller
 * holds a pendingRepeatTimeEdit.
 */
import type { calendarClientController } from '../controller.ts'
import { isRepeatTemplate } from '../../core/repeat.ts'
import { t } from '../locales.ts'
import { RepeatScopeConfirm } from './RepeatScopeConfirm.tsx'

export function RepeatTimeConfirm({ controller }: { controller: calendarClientController }) {
  const snap = controller.getSnapshot()
  const edit = snap.pendingRepeatTimeEdit
  if (edit === undefined) return null
  const task = snap.snapshot.tasks.find(x => x.id === edit.taskId)
  const isTemplate = isRepeatTemplate(task)

  return <RepeatScopeConfirm
    title={t('repeatConfirm.title')}
    body={isTemplate ? t('repeatConfirm.bodyTemplate') : t('repeatConfirm.body')}
    task={task}
    instanceLabel={isTemplate ? t('repeatConfirm.thisTemplate') : t('repeatConfirm.this')}
    seriesLabel={isTemplate ? t('repeatConfirm.allTemplate') : t('repeatConfirm.all')}
    primaryScope={isTemplate ? 'series' : 'instance'}
    onInstance={() => { void controller.resolveRepeatTimeEdit('this') }}
    onSeries={() => { void controller.resolveRepeatTimeEdit('all') }}
    onCancel={() => controller.cancelRepeatTimeEdit()}
  />
}
