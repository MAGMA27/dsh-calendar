/**
 * Confirmation when clearing the schedule of a repeat-series task (template or
 * bound copy): canceling must not silently nuke the whole series — the user may
 * only want to cancel ONE day's scheduled run. On a copy that still carries its
 * own trigger one-shot, "this day" clears just that copy's schedule (it stays
 * on the calendar as a plain task); "all" cancels the whole series. On the
 * template (or a copy with no own schedule) only "all" applies. Rendered by
 * CalendarView while the controller holds a pendingScheduleClear.
 */
import type { calendarClientController } from '../controller.ts'
import { t } from '../locales.ts'
import css from '../calendar.module.css'

export function ScheduleClearConfirm({ controller }: { controller: calendarClientController }) {
  const snap = controller.getSnapshot()
  const pending = snap.pendingScheduleClear
  if (pending === undefined) return null
  const task = snap.snapshot.tasks.find(x => x.id === pending.taskId)
  // "This day" applies to any bound copy of the series: a copy that still has
  // its own (trigger) schedule loses that schedule and stays as a plain task;
  // a plain copy is removed (that day's occurrence is cancelled).
  const canClearDay = task !== undefined && task.originTaskId !== undefined

  return (
    <div className={css.modalOverlay} role="dialog" aria-modal="true" aria-label={t('scheduleClear.title')}>
      <div className={css.modal}>
        <h3 className={css.detailTitle}>{t('scheduleClear.title')}</h3>
        <p className={css.repeatConfirmText}>{t('scheduleClear.body')}</p>
        {task !== undefined && <p className={css.repeatConfirmTask}>{task.title}</p>}
        <div className={css.modalActions}>
          {canClearDay && (
            <button type="button" className={css.btnPrimary} onClick={() => controller.confirmScheduleClearDay()}>
              {t('scheduleClear.day')}
            </button>
          )}
          <button type="button" className={css.btnGhost} onClick={() => controller.confirmScheduleClearAll()}>
            {t('scheduleClear.all')}
          </button>
          <button type="button" className={css.btnGhost} onClick={() => controller.cancelScheduleClear()}>
            {t('new.cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
