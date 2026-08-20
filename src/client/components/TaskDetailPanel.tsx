/** Right-side task detail panel: edit the selected task's title, quadrant,
 * description/prompt, subtask checklist, schedule (repeat or one-off),
 * execution settings, and view its execution records; run / delete / archive
 * from here.
 */
import { useState } from 'react'
import type { calendarClientController } from '../controller.ts'
import { hhmm } from '../../core/calendar.ts'
import { randomId } from '../../protocol.ts'
import { nextRepeatDate } from '../../core/repeat.ts'
import { hasIncompleteModelPin, type TaskRecord, type TaskUpdatePatch, type Urgency, type Importance, type RepeatRule } from '../../core/tasks.ts'
import { ExecutionSettings, type ExecutionSettingsValue } from './ExecutionSettings.tsx'
import { ScheduleSettings, type ScheduleSettingsValue } from './ScheduleSettings.tsx'
import { t, type calendarKey } from '../locales.ts'
import css from '../calendar.module.css'

interface TaskDetailPanelProps {
  controller: calendarClientController
  task: TaskRecord
  onClose: () => void
  /** Open the GUI's session view for an execution's session id (session jump). */
  onOpenSession?: (sessionId: string) => void
}

function quadKnobs(task: TaskRecord): Partial<ExecutionSettingsValue> {
  return {
    workspaceId: task.workspaceId, sessionId: task.sessionId, provider: task.provider,
    model: task.model, reasoningEffort: task.reasoningEffort, mode: task.mode, permission: task.permission,
  }
}

/** Human repeat-rule summary, e.g. "每周 周一、周三 · 跳过节假日 · 触发 09:30". */
function repeatSummary(rule: RepeatRule): string {
  const head = rule.kind === 'daily' ? t('schedule.daily') : t('schedule.weekly')
  const days = rule.kind === 'weekly' && rule.weekdays !== undefined && rule.weekdays.length > 0
    ? ` ${(rule.weekdays as number[]).slice().sort((a, b) => a - b).map(d => t(`weekday.${(d + 6) % 7}` as calendarKey)).join('、')}`
    : ''
  const holidays = rule.skipHolidays === true ? ` · ${t('schedule.skipHolidays')}` : ''
  const trigger = rule.triggerAgent === true
    ? (rule.triggerAt !== undefined && rule.triggerAt !== ''
      ? ` · ${t('schedule.triggerSummary', { time: rule.triggerAt })}`
      : ` · ${t('schedule.triggerBlock')}`)
    : ''
  return head + days + holidays + trigger
}

function initialSchedule(task: TaskRecord): ScheduleSettingsValue {
  const s = task.schedule
  const repeat = s?.repeat
  return {
    mode: repeat?.kind ?? 'none',
    weekdays: repeat?.weekdays ?? [],
    skipHolidays: repeat?.skipHolidays === true,
    triggerAgent: repeat?.triggerAgent === true,
    triggerAt: repeat?.triggerAt ?? '',
    dueAt: s !== undefined && s.dueAt !== undefined ? new Date(s.dueAt).toISOString().slice(0, 16) : '',
  }
}

const QUARTER_HOUR_OPTIONS = Array.from({ length: 96 }, (_, i) => {
  const minutes = i * 15
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
})
const MIN_DURATION_MINUTES = 15
const MAX_DURATION_MINUTES = 24 * 60

interface StartTimeParts {
  date: string
  time: string
}

/** Format an epoch as a local date plus a fixed 15-minute time slot. */
function toStartTimeParts(ms: number): StartTimeParts {
  const d = new Date(ms)
  const pad = (n: number): string => String(n).padStart(2, '0')
  d.setMinutes(Math.floor(d.getMinutes() / 15) * 15, 0, 0)
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/** Parse a local date and one of the fixed quarter-hour slots. */
function fromStartTimeParts(date: string, time: string): number | undefined {
  if (date === '' || !QUARTER_HOUR_OPTIONS.includes(time)) return undefined
  const ms = new Date(`${date}T${time}`).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

/** Snap free-form duration input to the nearest valid quarter-hour range. */
function snapDurationMinutes(value: string): string {
  if (value.trim() === '') return ''
  const minutes = Number(value)
  if (!Number.isFinite(minutes)) return ''
  const snapped = Math.round(minutes / MIN_DURATION_MINUTES) * MIN_DURATION_MINUTES
  return String(Math.min(MAX_DURATION_MINUTES, Math.max(MIN_DURATION_MINUTES, snapped)))
}

function durationMinutes(task: TaskRecord): number {
  return Number(snapDurationMinutes(String(Math.round((task.endAt - task.startAt) / 900_000) * MIN_DURATION_MINUTES)))
}

export function TaskDetailPanel({ controller, task, onClose, onOpenSession }: TaskDetailPanelProps) {
  // A copy's schedule IS the series' schedule: initialize and display from the
  // template so copies read consistently with the original. Ledger routes
  // setSchedule on a copy to the template anyway.
  const seriesTask = task.originTaskId !== undefined
    ? controller.getSnapshot().snapshot.tasks.find(t => t.id === task.originTaskId) ?? task
    : task
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [prompt, setPrompt] = useState(task.prompt)
  const initialStart = toStartTimeParts(task.startAt)
  const [startDate, setStartDate] = useState(initialStart.date)
  const [startTime, setStartTime] = useState(initialStart.time)
  const [duration, setDuration] = useState(() => String(durationMinutes(task)))
  const [subtaskInput, setSubtaskInput] = useState('')
  const [schedule, setSchedule] = useState<ScheduleSettingsValue>(initialSchedule(seriesTask))
  const [exec, setExec] = useState<ExecutionSettingsValue>(quadKnobs(task))
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const markDirty = (): void => setDirty(true)

  /** Dispatch the schedule part of a save; repeat-series clears go through the
   * "this day vs all" confirmation (a copy may only want to stop one day's
   * auto-run). Returns the user's choice when a confirm was shown. */
  const applySchedulePatch = async (patch: Parameters<calendarClientController['dispatch']>[0]): Promise<'day' | 'all' | 'cancel' | undefined> => {
    const seriesActive = seriesTask.schedule?.repeat !== undefined
    if (!seriesActive || patch.kind !== 'setSchedule' || patch.patch.repeat !== null) {
      await controller.dispatch(patch)
      return undefined
    }
    // Clearing a repeat series must ask: one day only, or the whole series?
    const choice = await controller.requestScheduleClear(task.id)
    if (choice === 'day' && task.originTaskId !== undefined) {
      // "This day": a copy that still has its own (trigger) schedule loses it
      // and stays as a plain task; a plain copy is removed (that day's
      // occurrence is cancelled and never re-materialized).
      if (task.schedule?.enabled === true) {
        await controller.dispatch({ kind: 'clearInstanceSchedule', id: task.id })
      } else {
        await controller.dispatch({ kind: 'delete', id: task.id })
      }
    } else if (choice === 'all') {
      await controller.dispatch({ kind: 'setSchedule', id: task.id, patch: { enabled: false, repeat: null, dueAt: null } })
    }
    return choice
  }

  const save = async (): Promise<void> => {
    if (title.trim() === '') { setError('title required'); return }
    if (schedule.mode === 'weekly' && schedule.weekdays.length === 0) { setError(t('schedule.weeklyRequired')); return }
    if (hasIncompleteModelPin(exec.provider, exec.model)) { setError(t('exec.modelPairRequired')); return }
    const startMs = fromStartTimeParts(startDate, startTime)
    const snappedDuration = snapDurationMinutes(duration)
    if (startMs === undefined) {
      setError(t('detail.timeInvalid'))
      return
    }
    if (snappedDuration === '') {
      setError(t('detail.durationInvalid'))
      return
    }
    const durationMinutesValue = Number(snappedDuration)
    if (duration !== snappedDuration) setDuration(snappedDuration)
    const endMs = startMs + durationMinutesValue * 60_000
    if (endMs <= startMs) {
      setError(t('detail.timeInvalid'))
      return
    }
    const timeChanged = startMs !== task.startAt || endMs !== task.endAt
    const repeatTimeChanged = timeChanged && seriesTask.schedule?.repeat !== undefined
    const updatePatch: TaskUpdatePatch = {
      title, description, prompt,
      workspaceId: exec.workspaceId ?? null, sessionId: exec.sessionId ?? null,
      provider: exec.provider ?? null, model: exec.model ?? null,
      mode: exec.mode ?? null, permission: exec.permission ?? null,
    }
    // Repeat-series time changes use the same confirmation as week-grid edits;
    // a normal task can move directly to another date/week.
    if (!repeatTimeChanged) {
      updatePatch.startAt = startMs
      updatePatch.endAt = endMs
    }
    await controller.dispatch({
      kind: 'update',
      id: task.id,
      patch: updatePatch,
    })
    const dueMs = schedule.dueAt.trim() === '' ? undefined : new Date(schedule.dueAt).getTime()
    // A schedule exists only when a repeat rule or a one-off due time is set;
    // clearing both must switch the schedule off (and drop the 🕐 badge). Sent
    // to the open task; the ledger routes a copy's schedule to its template.
    const triggerAt = schedule.triggerAt.trim()
    const repeat = schedule.mode === 'none'
      ? null
      : {
        kind: schedule.mode,
        weekdays: schedule.mode === 'weekly' ? schedule.weekdays : undefined,
        skipHolidays: schedule.skipHolidays,
        triggerAgent: schedule.triggerAgent,
        triggerAt: schedule.triggerAgent && triggerAt !== '' ? triggerAt : undefined,
      }
    const enabled = repeat !== null || dueMs !== undefined
    await applySchedulePatch({ kind: 'setSchedule', id: task.id, patch: { enabled, repeat, dueAt: dueMs ?? null } })
    if (repeatTimeChanged) {
      controller.requestRepeatTimeEdit({
        taskId: task.id,
        originTaskId: task.originTaskId,
        origStart: task.startAt,
        origEnd: task.endAt,
        startAt: startMs,
        endAt: endMs,
      })
    }
    setDirty(false)
    setMessage(t('detail.saved'))
    setError(null)
  }

  const clearSchedule = async (): Promise<void> => {
    setSchedule({ mode: 'none', weekdays: [], skipHolidays: false, triggerAgent: false, triggerAt: '', dueAt: '' })
    setDirty(true)
    const choice = await applySchedulePatch({ kind: 'setSchedule', id: task.id, patch: { enabled: false, repeat: null, dueAt: null } })
    // Reflect the truth after a series-clear confirm: 'day' keeps the series
    // rule (re-seed the form), 'all' leaves it cleared, 'cancel' restores it.
    if (choice === 'day' || choice === 'cancel') {
      setSchedule(initialSchedule(seriesTask))
      setDirty(false)
    }
  }

  const runNow = async (): Promise<void> => {
    // M4 wires real execution; today the ledger accepts the action. Surface a
    // neutral notice so a manual run never looks silently dropped in M3.
    await controller.dispatch({ kind: 'run', id: task.id })
    setError(null)
    setMessage(t('detail.runPending'))
  }

  const addSubtask = async (): Promise<void> => {
    const title_ = subtaskInput.trim()
    if (title_ === '') return
    await controller.dispatch({ kind: 'addSubtask', id: task.id, subtaskId: randomId(), title: title_ })
    setSubtaskInput('')
  }

  const doneSubtasks = task.subtasks.filter(s => s.done).length

  return (
    <aside className={css.detailPanel} data-dsh-calendar-detail="" role="complementary" aria-label={t('detail.title')}>
      <div className={css.detailHeader}>
        <h3 className={css.detailTitle}>{t('detail.title')}</h3>
        <button type="button" className={css.btnGhost} onClick={onClose}>{t('detail.close')}</button>
      </div>

      {task.originTaskId !== undefined && (
        <div className={css.copyNote}>
          <span>↻ {t('detail.repeatCopy')}</span>
          <button type="button" className={css.execSession} onClick={() => controller.selectTask(task.originTaskId)}>
            {t('detail.openTemplate')}
          </button>
        </div>
      )}

      <div className={css.formRow}>
        <input className={css.input} value={title} placeholder={t('new.titlePlaceholder')}
          onChange={e => { setTitle(e.target.value); markDirty() }} />
        <button type="button" className={css.btnGhost} onClick={() => void controller.dispatch({ kind: 'setDone', id: task.id, done: !task.done })}>
          {task.done ? t('detail.notDone') : t('detail.doneToggle')}
        </button>
      </div>

      <div className={css.formRow}>
        <label className={css.formLabel}>{t('detail.urgency')}</label>
        <select className={css.select} value={task.urgency} onChange={e => void controller.dispatch({ kind: 'setQuadrant', id: task.id, urgency: e.target.value as Urgency, importance: task.importance })}>
          {(['high', 'medium', 'low'] as const).map(u => <option key={u} value={u}>{t(`urgency.${u}` as calendarKey)}</option>)}
        </select>
        <label className={css.formLabel}>{t('detail.importance')}</label>
        <select className={css.select} value={task.importance} onChange={e => void controller.dispatch({ kind: 'setQuadrant', id: task.id, urgency: task.urgency, importance: e.target.value as Importance })}>
          {(['high', 'medium', 'low'] as const).map(i => <option key={i} value={i}>{t(`importance.${i}` as calendarKey)}</option>)}
        </select>
      </div>

      <div className={css.formRow}>
        <label className={css.formLabel}>{t('detail.description')}</label>
        <input className={css.input} value={description} placeholder={t('detail.descriptionPlaceholder')}
          onChange={e => { setDescription(e.target.value); markDirty() }} />
      </div>
      <div className={css.formRow}>
        <label className={css.formLabel}>{t('detail.prompt')}</label>
        <textarea className={css.textarea} value={prompt} placeholder={t('detail.promptPlaceholder')}
          onChange={e => { setPrompt(e.target.value); markDirty() }} />
      </div>

      <div className={css.detailSection}>
        <h4 className={css.execTitle}>{t('detail.timeRange')}</h4>
        <div className={css.formRow}>
          <label className={css.formLabel} htmlFor="dsh-calendar-task-start-date">{t('detail.startAt')}</label>
          <input id="dsh-calendar-task-start-date" className={css.input} type="date" value={startDate}
            onChange={e => { setStartDate(e.target.value); markDirty() }} />
          <select id="dsh-calendar-task-start-time" className={css.select} value={startTime}
            onChange={e => { setStartTime(e.target.value); markDirty() }}>
            {QUARTER_HOUR_OPTIONS.map(time => <option key={time} value={time}>{time}</option>)}
          </select>
        </div>
        <div className={css.formRow}>
          <label className={css.formLabel} htmlFor="dsh-calendar-task-duration">{t('detail.duration')}</label>
          <input id="dsh-calendar-task-duration" className={css.input} type="number" min={MIN_DURATION_MINUTES} max={MAX_DURATION_MINUTES} step={MIN_DURATION_MINUTES} value={duration}
            onChange={e => { setDuration(e.target.value); markDirty() }}
            onBlur={() => {
              const snapped = snapDurationMinutes(duration)
              if (snapped !== duration) { setDuration(snapped); markDirty() }
            }} />
        </div>
      </div>

      <div className={css.detailSection}>
        <h4 className={css.execTitle}>{t('detail.subtasks')} <span className={css.subtaskCount}>{doneSubtasks}/{task.subtasks.length}</span></h4>
        <div className={css.subtaskList}>
          {task.subtasks.map(s => (
            <div key={s.id} className={css.subtaskRow}>
              <input type="checkbox" checked={s.done}
                onChange={e => void controller.dispatch({ kind: 'setSubtaskDone', id: task.id, subtaskId: s.id, done: e.target.checked })} />
              <span className={s.done ? css.subtaskDone : css.subtaskText}>{s.title}</span>
              <button type="button" className={css.subtaskRemove} onClick={() => void controller.dispatch({ kind: 'removeSubtask', id: task.id, subtaskId: s.id })} aria-label="remove">×</button>
            </div>
          ))}
          <div className={css.formRow}>
            <input className={css.input} value={subtaskInput} placeholder={t('detail.subtasksPlaceholder')}
              onChange={e => setSubtaskInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void addSubtask() } }} />
            <button type="button" className={css.btnGhost} onClick={() => void addSubtask()}>{t('detail.addSubtask')}</button>
          </div>
        </div>
      </div>

      <div className={css.detailSection}>
        <h4 className={css.execTitle}>{t('detail.schedule')}</h4>
        {task.originTaskId !== undefined && (
          <div className={css.scheduleSummary}>{t('detail.scheduleSeriesHint')}</div>
        )}
        <ScheduleSettings value={schedule} onChange={(v) => { setSchedule(v); markDirty() }} />
        {seriesTask.schedule?.repeat !== undefined && (
          <div className={css.scheduleSummary}>
            {repeatSummary(seriesTask.schedule.repeat)}
            {(() => {
              const next = nextRepeatDate(seriesTask.schedule!.repeat!, Date.now())
              return next !== undefined
                ? <div className={css.scheduleNext}>{t('schedule.next', { date: new Date(next).toLocaleDateString() })}</div>
                : null
            })()}
          </div>
        )}
        {seriesTask.schedule?.nextRunAt !== undefined && (
          <div className={css.scheduleNext}>{new Date(seriesTask.schedule.nextRunAt).toLocaleString()}</div>
        )}
        {(seriesTask.schedule?.enabled === true) && (
          <button type="button" className={css.btnGhost} onClick={clearSchedule}>{t('detail.clearSchedule')}</button>
        )}
      </div>

      <div className={css.detailSection}>
        <ExecutionSettings value={exec} catalog={controller.getSnapshot().catalog} onChange={(p) => { setExec({ ...exec, ...p }); markDirty() }} />
      </div>

      <div className={css.detailSection}>
        <h4 className={css.execTitle}>{t('detail.executions')}</h4>
        {task.executions.length === 0
          ? <p className={css.agendaEmpty}>{t('detail.executionsEmpty')}</p>
          : <ul className={css.execList}>{task.executions.slice().reverse().map(e => (
            <li key={e.id} className={css.execRow}>
              <span className={css.execTime}>{new Date(e.startedAt).toLocaleString()}</span>
              <span className={css.execResult} data-result={e.result ?? 'running'}>{e.result ?? 'running'}</span>
              {e.sessionId !== undefined && e.sessionId !== '' && (
                <button type="button" className={css.execSession} data-dsh-calendar-exec-session=""
                  onClick={() => onOpenSession?.(e.sessionId!)}>
                  {t('detail.openSession')}
                </button>
              )}
            </li>
          ))}</ul>}
      </div>

      {error !== null && <div className={css.modalError}>{error}</div>}
      {message !== null && <div className={css.savedNote}>{message}</div>}

      <div className={css.detailActions}>
        <button type="button" className={css.btnGhost} onClick={() => void runNow()}>{t('detail.runNow')}</button>
        <button type="button" className={css.btnPrimary} onClick={() => { void save(); dismissMsg(setMessage) }}>
          {t('detail.save')}
        </button>
        {task.archivedAt === undefined
          ? <button type="button" className={css.btnGhost} onClick={() => { void controller.dispatch({ kind: 'archive', id: task.id }); onClose() }}>{t('detail.archive')}</button>
          : <button type="button" className={css.btnGhost} onClick={() => void controller.dispatch({ kind: 'restore', id: task.id })}>{t('detail.restore')}</button>}
        <button type="button" className={css.btnDanger} onClick={() => { void controller.dispatch({ kind: 'delete', id: task.id }); onClose() }}>{t('detail.delete')}</button>
      </div>
    </aside>
  )
}

function dismissMsg(set: (m: string | null) => void): void {
  setTimeout(() => set(null), 1500)
}
