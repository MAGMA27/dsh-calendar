/** Right-side task detail panel: edit the selected task's title, quadrant,
 * description/prompt, subtask checklist, schedule, execution settings, and
 * view its execution records; run / delete / archive from here.
 */
import { useState } from 'react'
import type { CalenderClientController } from '../controller.ts'
import { hhmm } from '../../core/calendar.ts'
import { randomId } from '../../protocol.ts'
import type { TaskRecord, Urgency, Importance } from '../../core/tasks.ts'
import { ExecutionSettings, type ExecutionSettingsValue } from './ExecutionSettings.tsx'
import { t, type CalenderKey } from '../locales.ts'
import css from '../calender.module.css'

interface TaskDetailPanelProps {
  controller: CalenderClientController
  task: TaskRecord
  onClose: () => void
}

function quadKnobs(task: TaskRecord): Partial<ExecutionSettingsValue> {
  return {
    workspaceId: task.workspaceId, sessionId: task.sessionId, provider: task.provider,
    model: task.model, reasoningEffort: task.reasoningEffort, mode: task.mode, permission: task.permission,
  }
}

export function TaskDetailPanel({ controller, task, onClose }: TaskDetailPanelProps) {
  const [title, setTitle] = useState(task.title)
  const [description, setDescription] = useState(task.description)
  const [prompt, setPrompt] = useState(task.prompt)
  const [subtaskInput, setSubtaskInput] = useState('')
  const [cron, setCron] = useState(task.schedule?.cron ?? '')
  const [dueAt, setDueAt] = useState(task.schedule && task.schedule.dueAt !== undefined ? new Date(task.schedule.dueAt).toISOString().slice(0, 16) : '')
  const [exec, setExec] = useState<ExecutionSettingsValue>(quadKnobs(task))
  const [dirty, setDirty] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const markDirty = (): void => setDirty(true)

  const save = async (): Promise<void> => {
    if (title.trim() === '') { setError('title required'); return }
    await controller.dispatch({
      kind: 'update',
      id: task.id,
      patch: {
        title, description, prompt,
        workspaceId: exec.workspaceId ?? null, sessionId: exec.sessionId ?? null,
        provider: exec.provider ?? null, model: exec.model ?? null,
        mode: exec.mode ?? null, permission: exec.permission ?? null,
      },
    })
    const dueMs = dueAt.trim() === '' ? undefined : new Date(dueAt).getTime()
    const hasCron = cron.trim() !== ''
    // A schedule exists only when a cron or a one-off due time is actually set;
    // clearing both must switch the schedule off (and drop the week badge).
    const enabled = hasCron || dueMs !== undefined
    await controller.dispatch({
      kind: 'setSchedule',
      id: task.id,
      patch: { enabled, cron: hasCron ? cron.trim() : null, dueAt: dueMs ?? null },
    })
    setDirty(false)
    setMessage(t('detail.saved'))
    setError(null)
  }

  const clearSchedule = (): void => {
    setCron('')
    setDueAt('')
    setDirty(true)
    void controller.dispatch({ kind: 'setSchedule', id: task.id, patch: { enabled: false, cron: null, dueAt: null } })
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
    <aside className={css.detailPanel} data-dsh-calender-detail="" role="complementary" aria-label={t('detail.title')}>
      <div className={css.detailHeader}>
        <h3 className={css.detailTitle}>{t('detail.title')}</h3>
        <button type="button" className={css.btnGhost} onClick={onClose}>{t('detail.close')}</button>
      </div>

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
          {(['high', 'medium', 'low'] as const).map(u => <option key={u} value={u}>{t(`urgency.${u}` as CalenderKey)}</option>)}
        </select>
        <label className={css.formLabel}>{t('detail.importance')}</label>
        <select className={css.select} value={task.importance} onChange={e => void controller.dispatch({ kind: 'setQuadrant', id: task.id, urgency: task.urgency, importance: e.target.value as Importance })}>
          {(['high', 'medium', 'low'] as const).map(i => <option key={i} value={i}>{t(`importance.${i}` as CalenderKey)}</option>)}
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
        <div className={css.formRow}>
          <label className={css.formLabel}>{t('detail.cron')}</label>
          <input className={css.input} value={cron} placeholder={t('detail.cronPlaceholder')} onChange={e => { setCron(e.target.value); markDirty() }} />
        </div>
        <div className={css.formRow}>
          <label className={css.formLabel}>{t('detail.dueAt')}</label>
          <input className={css.input} type="datetime-local" value={dueAt} onChange={e => { setDueAt(e.target.value); markDirty() }} />
        </div>
        {(task.schedule?.enabled === true) && (
          <button type="button" className={css.btnGhost} onClick={clearSchedule}>{t('detail.clearSchedule')}</button>
        )}
        {task.schedule?.nextRunAt !== undefined && (
          <div className={css.scheduleNext}>{new Date(task.schedule.nextRunAt).toLocaleString()}</div>
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
