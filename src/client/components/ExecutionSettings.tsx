/** Reusable ExecutionSettings form: the target pins (workspace / session /
 * provider+model / preset / permission) applied to a task before a real dsh
 * run. Used by both the create modal and the task detail panel. Controlled by
 * the parent; emits a TaskUpdatePatch-style partial.
 */
import { TASK_PERMISSIONS, type TaskPermission } from '../../core/tasks.ts'
import { t } from '../locales.ts'
import css from '../calender.module.css'

/** The editable execution-target values (a subset of TaskRecord / patch). */
export interface ExecutionSettingsValue {
  workspaceId?: string
  sessionId?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  mode?: string
  permission?: TaskPermission
}

interface ExecutionSettingsProps {
  value: ExecutionSettingsValue
  onChange: (patch: Partial<ExecutionSettingsValue>) => void
}

function blankToUndefined(s: string): string | undefined {
  const v = s.trim()
  return v === '' ? undefined : v
}

export function ExecutionSettings({ value, onChange }: ExecutionSettingsProps) {
  const set = (patch: Partial<ExecutionSettingsValue>): void => onChange(patch)
  return (
    <div className={css.execSettings} data-dsh-calender-exec="">
      <h4 className={css.execTitle}>{t('exec.title')}</h4>
      <div className={css.formRow}>
        <label className={css.formLabel}>{t('exec.workspace')}</label>
        <input className={css.input} value={value.workspaceId ?? ''} placeholder={t('exec.workspacePlaceholder')}
          onChange={e => set({ workspaceId: blankToUndefined(e.target.value) })} />
      </div>
      <div className={css.formRow}>
        <label className={css.formLabel}>{t('exec.session')}</label>
        <input className={css.input} value={value.sessionId ?? ''} placeholder={t('exec.sessionPlaceholder')}
          onChange={e => set({ sessionId: blankToUndefined(e.target.value) })} />
      </div>
      <div className={css.formRow}>
        <label className={css.formLabel}>{t('exec.provider')}</label>
        <input className={css.input} value={value.provider ?? ''} onChange={e => set({ provider: blankToUndefined(e.target.value) })} />
      </div>
      <div className={css.formRow}>
        <label className={css.formLabel}>{t('exec.model')}</label>
        <input className={css.input} value={value.model ?? ''} onChange={e => set({ model: blankToUndefined(e.target.value) })} />
      </div>
      <div className={css.formRow}>
        <label className={css.formLabel}>{t('exec.mode')}</label>
        <input className={css.input} value={value.mode ?? ''} onChange={e => set({ mode: blankToUndefined(e.target.value) })} />
      </div>
      <div className={css.formRow}>
        <label className={css.formLabel}>{t('exec.permission')}</label>
        <select className={css.select} value={value.permission ?? ''}
          onChange={e => set({ permission: e.target.value === '' ? undefined : e.target.value as TaskPermission })}>
          <option value="">{t('exec.leaveBlank')}</option>
          {TASK_PERMISSIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
    </div>
  )
}
