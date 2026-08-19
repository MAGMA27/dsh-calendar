/**
 * Confirmation for a time change made to a repeat copy (week-grid drag): the
 * user must choose whether to apply the change to this copy only (unbinding it
 * from the template and the other copies) or to shift the whole repeat
 * (template + every bound copy). Rendered by CalendarView while the
 * controller holds a pendingRepeatTimeEdit.
 */
import type { calendarClientController } from '../controller.ts'
import { t } from '../locales.ts'
import css from '../calendar.module.css'

export function RepeatTimeConfirm({ controller }: { controller: calendarClientController }) {
  const snap = controller.getSnapshot()
  const edit = snap.pendingRepeatTimeEdit
  if (edit === undefined) return null
  const task = snap.snapshot.tasks.find(x => x.id === edit.taskId)

  return (
    <div className={css.modalOverlay} role="dialog" aria-modal="true" aria-label={t('repeatConfirm.title')}>
      <div className={css.modal}>
        <h3 className={css.detailTitle}>{t('repeatConfirm.title')}</h3>
        <p className={css.repeatConfirmText}>{t('repeatConfirm.body')}</p>
        {task !== undefined && <p className={css.repeatConfirmTask}>{task.title}</p>}
        <div className={css.modalActions}>
          <button type="button" className={css.btnPrimary} onClick={() => void controller.resolveRepeatTimeEdit('this')}>
            {t('repeatConfirm.this')}
          </button>
          <button type="button" className={css.btnGhost} onClick={() => void controller.resolveRepeatTimeEdit('all')}>
            {t('repeatConfirm.all')}
          </button>
          <button type="button" className={css.btnGhost} onClick={() => controller.cancelRepeatTimeEdit()}>
            {t('new.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
