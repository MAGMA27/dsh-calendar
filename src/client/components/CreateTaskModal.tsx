/** Centered modal for creating a task from a draft time range. */
import { useState } from 'react'
import type { CalenderClientController } from '../controller.ts'
import { hhmm } from '../../core/calendar.ts'
import { t, type CalenderKey } from '../locales.ts'
import css from '../calender.module.css'

interface CreateTaskModalProps {
  controller: CalenderClientController
  onClose: () => void
}

export function CreateTaskModal({ controller, onClose }: CreateTaskModalProps) {
  const snap = controller.getSnapshot()
  const draft = snap.draft
  const [title, setTitle] = useState('')
  const [urgency, setUrgency] = useState<'high' | 'medium' | 'low'>('medium')
  const [importance, setImportance] = useState<'high' | 'medium' | 'low'>('medium')
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    if (title.trim() === '' || draft === undefined) {
      setError('title required')
      return
    }
    await controller.dispatch({
      kind: 'create',
      input: {
        title, description: '', prompt: '', startAt: draft.start, endAt: draft.end,
        urgency, importance,
      },
    })
    controller.setDraft(undefined)
    onClose()
  }

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { controller.setDraft(undefined); onClose() }
  }

  return (
    <div className={css.modalOverlay} onKeyDown={onKey} role="dialog" aria-modal="true" aria-label={t('board.new')}>
      <div className={css.modal}>
        <div className={css.formRow}>
          <label className={css.formLabel}>{t('new.title')}</label>
          <input className={css.input} value={title} placeholder={t('new.titlePlaceholder')}
            onChange={e => { setTitle(e.target.value); setError(null) }} autoFocus />
        </div>
        <div className={css.formRow}>
          <label className={css.formLabel}>{t('new.start')}</label>
          <span className={css.formValue}>{draft !== undefined ? hhmm(draft.start) : '–'}</span>
          <label className={css.formLabel}>{t('new.end')}</label>
          <span className={css.formValue}>{draft !== undefined ? hhmm(draft.end) : '–'}</span>
        </div>
        <div className={css.formRow}>
          <label className={css.formLabel}>{t('quadrant.placeholder')}</label>
          <select className={css.select} value={urgency} onChange={e => setUrgency(e.target.value as 'high' | 'medium' | 'low')}>
            {(['high', 'medium', 'low'] as const).map(u => (
              <option key={u} value={u}>{t(`urgency.${u}` as CalenderKey)}</option>
            ))}
          </select>
          <select className={css.select} value={importance} onChange={e => setImportance(e.target.value as 'high' | 'medium' | 'low')}>
            {(['high', 'medium', 'low'] as const).map(i => (
              <option key={i} value={i}>{t(`importance.${i}` as CalenderKey)}</option>
            ))}
          </select>
        </div>
        {error !== null && <div className={css.modalError}>{error}</div>}
        <div className={css.modalActions}>
          <button type="button" className={css.btnGhost} onClick={() => { controller.setDraft(undefined); onClose() }}>{t('new.cancel')}</button>
          <button type="button" className={css.btnPrimary} onClick={() => void submit()}>{t('new.submit')}</button>
        </div>
      </div>
    </div>
  )
}
