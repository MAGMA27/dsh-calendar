/** Shared confirmation shell for actions that can target one repeat
 * occurrence or the entire series. Operation-specific components only provide
 * the copy and dispatch callbacks; the modal layout stays in one place.
 */
import type { TaskRecord } from '../../core/tasks.ts'
import type { RepeatScope } from '../../core/repeat.ts'
import { t } from '../locales.ts'
import css from '../calendar.module.css'

export interface RepeatScopeConfirmProps {
  title: string
  body: string
  task: TaskRecord | undefined
  instanceLabel: string
  seriesLabel: string
  instanceEnabled?: boolean
  primaryScope?: RepeatScope
  onInstance: () => void
  onSeries: () => void
  onCancel: () => void
}

export function RepeatScopeConfirm({
  title, body, task, instanceLabel, seriesLabel, instanceEnabled = true,
  primaryScope = 'instance',
  onInstance, onSeries, onCancel,
}: RepeatScopeConfirmProps): JSX.Element {
  const instanceButton = instanceEnabled ? (
    <button type="button" className={primaryScope === 'instance' ? css.btnPrimary : css.btnGhost} onClick={onInstance}>
      {instanceLabel}
    </button>
  ) : null
  const seriesButton = (
    <button type="button" className={primaryScope === 'series' ? css.btnPrimary : css.btnGhost} onClick={onSeries}>
      {seriesLabel}
    </button>
  )

  return (
    <div className={css.modalOverlay} role="dialog" aria-modal="true" aria-label={title}>
      <div className={css.modal}>
        <h3 className={css.detailTitle}>{title}</h3>
        <p className={css.repeatConfirmText}>{body}</p>
        {task !== undefined && <p className={css.repeatConfirmTask}>{task.title}</p>}
        <div className={css.modalActions}>
          {primaryScope === 'instance' ? instanceButton : seriesButton}
          {primaryScope === 'instance' ? seriesButton : instanceButton}
          <button type="button" className={css.btnGhost} onClick={onCancel}>{t('new.cancel')}</button>
        </div>
      </div>
    </div>
  )
}
