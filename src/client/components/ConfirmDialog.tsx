/** Shared single-confirmation modal for destructive or otherwise explicit actions. */
import { t } from '../locales.ts'
import css from '../calendar.module.css'

interface ConfirmDialogProps {
  title: string
  body: string
  confirmLabel: string
  taskLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmDialog({
  title, body, confirmLabel, taskLabel, danger = false, onConfirm, onCancel,
}: ConfirmDialogProps): JSX.Element {
  return (
    <div className={css.modalOverlay} data-dsh-calendar-confirm-dialog="" role="dialog" aria-modal="true" aria-label={title}>
      <div className={css.modal}>
        <h3 className={css.detailTitle}>{title}</h3>
        <p className={css.repeatConfirmText}>{body}</p>
        {taskLabel !== undefined && <p className={css.repeatConfirmTask}>{taskLabel}</p>}
        <div className={css.modalActions}>
          <button type="button" className={danger ? css.btnDanger : css.btnPrimary} data-dsh-calendar-confirm-action="" onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className={css.btnGhost} onClick={onCancel}>{t('new.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
