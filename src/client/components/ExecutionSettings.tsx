/** Reusable ExecutionSettings form: the target pins (workspace / session /
 * provider+model / preset / permission) applied to a task before a real dsh
 * run. Used by both the create modal and the task detail panel. When the live
 * catalog is available it renders <select> dropdowns (provider chains to its
 * models); otherwise it falls back to free-text inputs. Controlled by the
 * parent; emits a TaskUpdatePatch-style partial.
 */
import { TASK_PERMISSIONS, type TaskPermission } from '../../core/tasks.ts'
import type { ExecutionCatalog } from '../../core/exec-catalog.ts'
import { t } from '../locales.ts'
import css from '../calendar.module.css'

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
  catalog?: ExecutionCatalog
  onChange: (patch: Partial<ExecutionSettingsValue>) => void
}

function blankToUndefined(s: string): string | undefined {
  const v = s.trim()
  return v === '' ? undefined : v
}

function OptionSelect(props: {
  label: string
  value: string | undefined
  options: Array<{ id: string; label: string }>
  placeholder: string
  allowBlank?: boolean
  onPick: (id: string | undefined) => void
}): JSX.Element {
  const { label, value, options, placeholder, allowBlank, onPick } = props
  return (
    <div className={css.formRow}>
      <label className={css.formLabel}>{label}</label>
      <select className={css.select} value={value ?? ''} onChange={e => onPick(e.target.value === '' ? undefined : e.target.value)}>
        <option value="">{allowBlank ? placeholder : t('exec.leaveBlank')}</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </div>
  )
}

function TextField(props: {
  label: string
  value: string | undefined
  placeholder: string
  onPick: (v: string | undefined) => void
}): JSX.Element {
  return (
    <div className={css.formRow}>
      <label className={css.formLabel}>{props.label}</label>
      <input className={css.input} value={props.value ?? ''} placeholder={props.placeholder}
        onChange={e => props.onPick(blankToUndefined(e.target.value))} />
    </div>
  )
}

/** Session <select> grouped by project. When a workspace is chosen, only that
 * project's sessions appear (cascade); otherwise every project is shown as an
 * optgroup. */
function GroupedSessionSelect(props: {
  label: string
  value: string | undefined
  workspaceId: string | undefined
  projects: Array<{ id: string; label: string; sessions: Array<{ id: string; label: string }> }>
  placeholder: string
  onPick: (id: string | undefined) => void
}): JSX.Element {
  const { label, value, workspaceId, projects, placeholder, onPick } = props
  const scoped = workspaceId !== undefined
    ? projects.filter(p => p.id === workspaceId)
    : projects
  return (
    <div className={css.formRow}>
      <label className={css.formLabel}>{label}</label>
      <select className={css.select} value={value ?? ''} onChange={e => onPick(e.target.value === '' ? undefined : e.target.value)}>
        <option value="">{placeholder}</option>
        {scoped.map(project => (
          <optgroup key={project.id} label={project.label}>
            {project.sessions.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
          </optgroup>
        ))}
      </select>
    </div>
  )
}

export function ExecutionSettings({ value, catalog, onChange }: ExecutionSettingsProps) {
  const hasWorkspaces = catalog !== undefined && catalog.workspaces.length > 0
  const hasSessions = catalog !== undefined && catalog.sessions.length > 0
  const hasGroupedSessions = catalog !== undefined && catalog.projects.length > 0
  const hasProviders = catalog !== undefined && catalog.providers.length > 0

  // If a pinned provider is no longer selected, default the model dropdown to it.
  const provider = value.provider
  const models = provider !== undefined && catalog !== undefined
    ? catalog.modelsByProvider[provider] ?? []
    : []

  const pickProvider = (id: string | undefined): void => {
    // Changing provider clears an incompatible model.
    onChange({ provider: id, model: undefined })
  }

  return (
    <div className={css.execSettings} data-dsh-calendar-exec="">
      <h4 className={css.execTitle}>{t('exec.title')}</h4>

      {hasWorkspaces
        ? <OptionSelect label={t('exec.workspace')} value={value.workspaceId} options={catalog!.workspaces}
            placeholder={t('exec.workspacePlaceholder')} allowBlank onPick={v => { onChange({ workspaceId: v, sessionId: undefined }) }} />
        : <TextField label={t('exec.workspace')} value={value.workspaceId} placeholder={t('exec.workspacePlaceholder')}
            onPick={v => { onChange({ workspaceId: v, sessionId: undefined }) }} />}

      {(hasSessions || hasGroupedSessions)
        ? hasGroupedSessions
          ? <GroupedSessionSelect label={t('exec.session')} value={value.sessionId} workspaceId={value.workspaceId} projects={catalog!.projects}
              placeholder={t('exec.sessionPlaceholder')} onPick={v => onChange({ sessionId: v })} />
          : <OptionSelect label={t('exec.session')} value={value.sessionId} options={catalog!.sessions}
              placeholder={t('exec.sessionPlaceholder')} allowBlank onPick={v => onChange({ sessionId: v })} />
        : <TextField label={t('exec.session')} value={value.sessionId} placeholder={t('exec.sessionPlaceholder')}
            onPick={v => onChange({ sessionId: v })} />}

      {hasProviders
        ? <>
            <OptionSelect label={t('exec.provider')} value={provider} options={catalog!.providers} placeholder={t('exec.leaveBlank')} onPick={pickProvider} />
            {provider !== undefined && (
              <OptionSelect label={t('exec.model')} value={value.model} options={models} placeholder={t('exec.leaveBlank')} onPick={v => onChange({ model: v })} />
            )}
          </>
        : <>
            <TextField label={t('exec.provider')} value={provider} placeholder={t('exec.leaveBlank')} onPick={v => onChange({ provider: v })} />
            <TextField label={t('exec.model')} value={value.model} placeholder={t('exec.leaveBlank')} onPick={v => onChange({ model: v })} />
          </>}

      <TextField label={t('exec.mode')} value={value.mode} placeholder={t('exec.leaveBlank')} onPick={v => onChange({ mode: v })} />

      <div className={css.formRow}>
        <label className={css.formLabel}>{t('exec.permission')}</label>
        <select className={css.select} value={value.permission ?? ''}
          onChange={e => onChange({ permission: e.target.value === '' ? undefined : e.target.value as TaskPermission })}>
          <option value="">{t('exec.leaveBlank')}</option>
          {TASK_PERMISSIONS.map(p => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
    </div>
  )
}
