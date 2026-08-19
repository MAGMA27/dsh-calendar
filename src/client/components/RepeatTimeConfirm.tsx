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
import { t } from '../locales.ts'
import css from '../calendar.module.css'

export function RepeatTimeConfirm({ controller }: { controller: calendarClientController }) {
  const snap = controller.getSnapshot()
  const edit = snap.pendingRepeatTimeEdit
  if (edit === undefined) return null
  const task = snap.snapshot.tasks.find(x => x.id === edit.taskId)
  const isTemplate = task !== undefined && task.originTaskId === undefined && task.schedule?.repeat !== undefined

  return (
    <div className={css.modalOverlay} role="dialog" aria-modal="true" aria-label={t('repeatConfirm.title')}>
      <div className={css.modal}>
        <h3 className={css.detailTitle}>{t('repeatConfirm.title')}</h3>
        <p className={css.repeatConfirmText}>{isTemplate ? t('repeatConfirm.bodyTemplate') : t('repeatConfirm.body')}</p>
        {task !== undefined && <p className={css.repeatConfirmTask}>{task.title}</p>}
        <div className={css.modalActions}>
          {isTemplate ? (
            <button type="button" className={css.btnPrimary} onClick={() => void controller.resolveRepeatTimeEdit('all')}>
              {t('repeatConfirm.allTemplate')}
            </button>
          ) : (
            <button type="button" className={css.btnPrimary} onClick={() => void controller.resolveRepeatTimeEdit('this')}>
              {t('repeatConfirm.this')}
            </button>
          )}
          <button type="button" className={css.btnGhost} onClick={() => void controller.resolveRepeatTimeEdit(isTemplate ? 'this' : 'all')}>
            {isTemplate ? t('repeatConfirm.thisTemplate') : t('repeatConfirm.all')}
          </button>
          <button type="button" className={css.btnGhost} onClick={() => controller.cancelRepeatTimeEdit()}>
            {t('new.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
