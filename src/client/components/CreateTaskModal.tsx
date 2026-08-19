/** Full create-task form: title, time range, urgency/importance, description,
 * prompt, quick subtasks, optional schedule (repeat or one-off), and execution
 * settings.
 */
import { useState } from 'react'
import type { calendarClientController } from '../controller.ts'
import { hhmm } from '../../core/calendar.ts'
import { randomId } from '../../protocol.ts'
import type { SubtaskRecord, Urgency, Importance } from '../../core/tasks.ts'
import { ExecutionSettings, type ExecutionSettingsValue } from './ExecutionSettings.tsx'
import { ScheduleSettings, type ScheduleSettingsValue } from './ScheduleSettings.tsx'
import { t, type calendarKey } from '../locales.ts'
import css from '../calendar.module.css'

interface CreateTaskModalProps {
  controller: calendarClientController
  onClose: () => void
}

export function CreateTaskModal({ controller, onClose }: CreateTaskModalProps) {
  const snap = controller.getSnapshot()
  const draft = snap.draft
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [urgency, setUrgency] = useState<Urgency>('medium')
  const [importance, setImportance] = useState<Importance>('medium')
  const [subtaskInput, setSubtaskInput] = useState('')
  const [subtasks, setSubtasks] = useState<SubtaskRecord[]>([])
  const [schedule, setSchedule] = useState<ScheduleSettingsValue>({ mode: 'none', weekdays: [], skipHolidays: false, triggerAgent: false, triggerAt: '', dueAt: '' })
  const [exec, setExec] = useState<ExecutionSettingsValue>({})
  const [error, setError] = useState<string | null>(null)

  const addSubtask = (): void => {
    const title_ = subtaskInput.trim()
    if (title_ === '') return
    setSubtasks([...subtasks, { id: randomId(), title: title_, done: false }])
    setSubtaskInput('')
  }

  const submit = async (): Promise<void> => {
    if (title.trim() === '' || draft === undefined) { setError('title required'); return }
    if (schedule.mode === 'weekly' && schedule.weekdays.length === 0) { setError(t('schedule.weeklyRequired')); return }
    const dueMs = schedule.dueAt.trim() === '' ? undefined : new Date(schedule.dueAt).getTime()
    const triggerAt = schedule.triggerAt.trim()
    const repeat = schedule.mode === 'none'
      ? undefined
      : {
        kind: schedule.mode,
        weekdays: schedule.mode === 'weekly' ? schedule.weekdays : undefined,
        skipHolidays: schedule.skipHolidays,
        triggerAgent: schedule.triggerAgent,
        triggerAt: schedule.triggerAgent && triggerAt !== '' ? triggerAt : undefined,
      }
    await controller.dispatch({
      kind: 'create',
      input: {
        title, description, prompt, startAt: draft.start, endAt: draft.end,
        urgency, importance, subtasks, ...exec,
      },
      schedule: (repeat !== undefined || dueMs !== undefined)
        ? { enabled: true, repeat, dueAt: dueMs }
        : undefined,
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
          <label className={css.formLabel}>{t('new.description')}</label>
          <input className={css.input} value={description} placeholder={t('detail.descriptionPlaceholder')}
            onChange={e => setDescription(e.target.value)} />
        </div>
        <div className={css.formRow}>
          <label className={css.formLabel}>{t('new.prompt')}</label>
          <input className={css.input} value={prompt} placeholder={t('detail.promptPlaceholder')}
            onChange={e => setPrompt(e.target.value)} />
        </div>
        <div className={css.formRow}>
          <label className={css.formLabel}>{t('quadrant.placeholder')}</label>
          <select className={css.select} value={urgency} onChange={e => setUrgency(e.target.value as Urgency)}>
            {(['high', 'medium', 'low'] as const).map(u => <option key={u} value={u}>{t(`urgency.${u}` as calendarKey)}</option>)}
          </select>
          <select className={css.select} value={importance} onChange={e => setImportance(e.target.value as Importance)}>
            {(['high', 'medium', 'low'] as const).map(i => <option key={i} value={i}>{t(`importance.${i}` as calendarKey)}</option>)}
          </select>
        </div>
        <div className={css.formRow}>
          <label className={css.formLabel}>{t('new.subtasks')}</label>
          <input className={css.input} value={subtaskInput} placeholder={t('new.subtaskInput')}
            onChange={e => setSubtaskInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask() } }} />
          <button type="button" className={css.btnGhost} onClick={addSubtask}>{t('detail.addSubtask')}</button>
        </div>
        {subtasks.length > 0 && (
          <ul className={css.subtaskList}>
            {subtasks.map(s => <li key={s.id} className={css.subtaskRow}>{s.title}</li>)}
          </ul>
        )}
        <div className={css.formRow}>
          <label className={css.formLabel}>{t('new.schedule')}</label>
        </div>
        <ScheduleSettings value={schedule} onChange={setSchedule} />
        <ExecutionSettings value={exec} catalog={controller.getSnapshot().catalog} onChange={setExec} />
        {error !== null && <div className={css.modalError}>{error}</div>}
        <div className={css.modalActions}>
          <button type="button" className={css.btnGhost} onClick={() => { controller.setDraft(undefined); onClose() }}>{t('new.cancel')}</button>
          <button type="button" className={css.btnPrimary} onClick={() => void submit()}>{t('new.submit')}</button>
        </div>
      </div>
    </div>
  )
}
