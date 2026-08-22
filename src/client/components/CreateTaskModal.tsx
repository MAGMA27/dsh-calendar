/** Full create-task form: title, time range, urgency/importance, description,
 * prompt, quick subtasks, optional schedule (repeat or one-off), and execution
 * settings.
 */
import { useState } from 'react'
import type { calendarClientController } from '../controller.ts'
import { hhmm } from '../../core/calendar.ts'
import { randomId } from '../../protocol.ts'
import { hasIncompleteModelPin, type SubtaskRecord, type Urgency, type Importance } from '../../core/tasks.ts'
import { ExecutionSettings, type ExecutionSettingsValue } from './ExecutionSettings.tsx'
import { ScheduleSettings, type ScheduleSettingsValue } from './ScheduleSettings.tsx'
import { DetailDisclosure } from './DetailDisclosure.tsx'
import {
  durationMinutes,
  fromStartTimeParts,
  MAX_DURATION_MINUTES,
  MIN_DURATION_MINUTES,
  QUARTER_HOUR_OPTIONS,
  snapDurationMinutes,
  toStartTimeParts,
} from '../task-time.ts'
import { t, type calendarKey } from '../locales.ts'
import css from '../calendar.module.css'

interface CreateTaskModalProps {
  controller: calendarClientController
  onClose: () => void
}

export function CreateTaskModal({ controller, onClose }: CreateTaskModalProps) {
  const snap = controller.getSnapshot()
  const draft = snap.draft
  const initialStart = draft !== undefined ? toStartTimeParts(draft.start) : { date: '', time: '' }
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [prompt, setPrompt] = useState('')
  const [startDate, setStartDate] = useState(initialStart.date)
  const [startTime, setStartTime] = useState(initialStart.time)
  const [duration, setDuration] = useState(() => draft !== undefined ? String(durationMinutes(draft.start, draft.end)) : '')
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
    setSubtasks(previous => [...previous, { id: randomId(), title: title_, done: false }])
    setSubtaskInput('')
  }

  const toggleSubtask = (id: string, done: boolean): void => {
    setSubtasks(previous => previous.map(subtask => subtask.id === id ? { ...subtask, done } : subtask))
  }

  const removeSubtask = (id: string): void => {
    setSubtasks(previous => previous.filter(subtask => subtask.id !== id))
  }

  const close = (): void => {
    controller.setDraft(undefined)
    onClose()
  }

  const submit = async (): Promise<void> => {
    if (title.trim() === '' || draft === undefined) { setError('title required'); return }
    if (schedule.mode === 'weekly' && schedule.weekdays.length === 0) { setError(t('schedule.weeklyRequired')); return }
    if (hasIncompleteModelPin(exec.provider, exec.model)) { setError(t('exec.modelPairRequired')); return }
    const startMs = fromStartTimeParts(startDate, startTime)
    const snappedDuration = snapDurationMinutes(duration)
    if (startMs === undefined) { setError(t('detail.timeInvalid')); return }
    if (snappedDuration === '') { setError(t('detail.durationInvalid')); return }
    const durationMinutesValue = Number(snappedDuration)
    if (duration !== snappedDuration) setDuration(snappedDuration)
    const endMs = startMs + durationMinutesValue * 60_000
    if (endMs <= startMs) { setError(t('detail.timeInvalid')); return }
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
        title, description, prompt, startAt: startMs, endAt: endMs,
        urgency, importance, subtasks, ...exec,
      },
      schedule: (repeat !== undefined || dueMs !== undefined)
        ? { enabled: true, repeat, dueAt: dueMs }
        : undefined,
    })
    controller.setDraft(undefined)
    onClose()
  }

  const previewStart = fromStartTimeParts(startDate, startTime)
  const previewDuration = snapDurationMinutes(duration)
  const previewEnd = previewStart !== undefined && previewDuration !== ''
    ? previewStart + Number(previewDuration) * 60_000
    : undefined
  const timeMeta = previewStart !== undefined
    ? `${startDate} · ${startTime}–${previewEnd !== undefined ? hhmm(previewEnd) : '–'}`
    : '–'

  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') close()
  }

  return (
    <div className={css.modalOverlay} onKeyDown={onKey} role="dialog" aria-modal="true" aria-label={t('board.new')}>
      <div className={css.createModal} data-dsh-calendar-create="">
        <div className={css.detailHeader}>
          <h3 className={css.detailTitle}>{t('board.new')}</h3>
        </div>

        <div className={css.detailBody} data-dsh-calendar-create-body="">
          <div className={css.detailIdentity}>
            <div className={css.detailTitleRow}>
              <input aria-label={t('new.title')} className={`${css.input} ${css.detailTitleInput}`} value={title} placeholder={t('new.titlePlaceholder')}
                onChange={e => { setTitle(e.target.value); setError(null) }} autoFocus />
            </div>
            <div className={css.detailMetaGrid}>
              <label className={css.detailMetaField}>
                <span className={css.detailFieldLabel}>{t('detail.urgency')}</span>
                <select className={css.select} value={urgency} onChange={e => setUrgency(e.target.value as Urgency)}>
                  {(['high', 'medium', 'low'] as const).map(u => <option key={u} value={u}>{t(`urgency.${u}` as calendarKey)}</option>)}
                </select>
              </label>
              <label className={css.detailMetaField}>
                <span className={css.detailFieldLabel}>{t('detail.importance')}</span>
                <select className={css.select} value={importance} onChange={e => setImportance(e.target.value as Importance)}>
                  {(['high', 'medium', 'low'] as const).map(i => <option key={i} value={i}>{t(`importance.${i}` as calendarKey)}</option>)}
                </select>
              </label>
            </div>
          </div>

          <DetailDisclosure section="content" title={t('detail.content')} defaultOpen>
            <div className={css.detailSection}>
              <label className={css.detailField}>
                <span className={css.detailFieldLabel}>{t('new.description')}</span>
                <input className={css.input} value={description} placeholder={t('detail.descriptionPlaceholder')}
                  onChange={e => setDescription(e.target.value)} />
              </label>
              <label className={css.detailField}>
                <span className={css.detailFieldLabel}>{t('new.prompt')}</span>
                <textarea className={css.textarea} value={prompt} placeholder={t('detail.promptPlaceholder')}
                  onChange={e => setPrompt(e.target.value)} />
              </label>
            </div>
          </DetailDisclosure>

          <DetailDisclosure section="time" title={t('detail.timeRange')}
            meta={timeMeta} defaultOpen>
            <div className={css.detailSection}>
              <div className={css.detailFieldGrid}>
                <label className={css.detailField} htmlFor="dsh-calendar-new-task-start-date">
                  <span className={css.detailFieldLabel}>{t('detail.startAt')}</span>
                  <input id="dsh-calendar-new-task-start-date" className={css.input} type="date" value={startDate}
                    onChange={e => { setStartDate(e.target.value); setError(null) }} />
                </label>
                <label className={`${css.detailField} ${css.detailFieldNoLabel}`} htmlFor="dsh-calendar-new-task-start-time">
                  <select id="dsh-calendar-new-task-start-time" className={css.select} aria-label={t('detail.startAt')} value={startTime}
                    onChange={e => { setStartTime(e.target.value); setError(null) }}>
                    {QUARTER_HOUR_OPTIONS.map(time => <option key={time} value={time}>{time}</option>)}
                  </select>
                </label>
              </div>
              <label className={css.detailField} htmlFor="dsh-calendar-new-task-duration">
                <span className={css.detailFieldLabel}>{t('detail.duration')}</span>
                <input id="dsh-calendar-new-task-duration" className={css.input} type="number" min={MIN_DURATION_MINUTES} max={MAX_DURATION_MINUTES} step={MIN_DURATION_MINUTES} value={duration}
                  onChange={e => { setDuration(e.target.value); setError(null) }}
                  onBlur={() => {
                    const snapped = snapDurationMinutes(duration)
                    if (snapped !== duration) setDuration(snapped)
                  }} />
              </label>
            </div>
          </DetailDisclosure>

          <DetailDisclosure section="subtasks" title={t('detail.subtasks')} meta={String(subtasks.length)} defaultOpen>
            <div className={css.detailSection}>
              <div className={css.detailInlineRow}>
                <input className={css.input} value={subtaskInput} placeholder={t('new.subtaskInput')} data-dsh-calendar-create-subtask-input=""
                  onChange={e => setSubtaskInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addSubtask() } }} />
                <button type="button" className={css.btnGhost} onClick={addSubtask} data-dsh-calendar-create-subtask-add="">{t('detail.addSubtask')}</button>
              </div>
              {subtasks.length > 0 && (
                <ul className={css.createSubtaskList} data-dsh-calendar-create-subtasks="">
                  {subtasks.map(s => (
                    <li key={s.id} className={css.createSubtaskRow} data-dsh-calendar-create-subtask="">
                      <label className={`${css.doneCheckbox} ${css.subtaskCheckbox}`} data-checked={s.done || undefined} aria-label={s.title}>
                        <input type="checkbox" checked={s.done} onChange={e => toggleSubtask(s.id, e.target.checked)} />
                      </label>
                      <span className={s.done ? css.subtaskDone : css.subtaskText}>{s.title}</span>
                      <button type="button" className={css.subtaskRemove} onClick={() => removeSubtask(s.id)} aria-label={t('detail.removeSubtask')}>×</button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </DetailDisclosure>

          <DetailDisclosure section="schedule" title={t('detail.schedule')}>
            <ScheduleSettings value={schedule} onChange={setSchedule} />
          </DetailDisclosure>

          <DetailDisclosure section="execution" title={t('exec.title')}>
            <ExecutionSettings value={exec} catalog={controller.getSnapshot().catalog} onChange={patch => setExec(previous => ({ ...previous, ...patch }))} showTitle={false} />
          </DetailDisclosure>
        </div>

        <div className={css.detailFooter}>
          {error !== null && <div className={css.modalError}>{error}</div>}
          <div className={css.detailActions}>
            <button type="button" className={css.btnGhost} onClick={close}>{t('new.cancel')}</button>
            <button type="button" className={`${css.btnPrimary} ${css.detailSaveButton}`} onClick={() => void submit()}>{t('new.submit')}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
