/**
 * Shared schedule editor (create modal + detail panel): a constrained repeat
 * mode (none / daily / weekly), weekday chips for weekly, a skip-weekends-and-
 * holidays toggle, an optional agent-trigger (with a trigger-time override),
 * and a one-off due time for the none mode. There is no free-form cron input:
 * repeats are materialized by the Host onto their dates, so the user only picks
 * the granularity that is safe to run.
 */
import type { RepeatKind } from '../../core/tasks.ts'
import { t, type calendarKey } from '../locales.ts'
import css from '../calendar.module.css'

/** The edited schedule value; `mode` 'none' with a dueAt is a one-shot. */
export interface ScheduleSettingsValue {
  mode: 'none' | RepeatKind
  /** Weekly only: JS weekdays 0=Sun..6=Sat, non-empty when mode is weekly. */
  weekdays: number[]
  skipHolidays: boolean
  /** Repeat + agent trigger: each materialized copy auto-runs at the trigger
   * time (empty triggerAt → the task's block start). */
  triggerAgent: boolean
  /** Trigger time-of-day override (HH:MM, '' = block start). */
  triggerAt: string
  /** datetime-local string ('' = unset), used only in the none mode. */
  dueAt: string
}

/** Weekday order for the chips, Monday first (JS numbering). */
const WEEKDAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0]
/** Sensible default when switching to weekly: Mon-Fri. */
const DEFAULT_WEEKDAYS: readonly number[] = [1, 2, 3, 4, 5]

export function ScheduleSettings({ value, onChange }: {
  value: ScheduleSettingsValue
  onChange: (v: ScheduleSettingsValue) => void
}) {
  const setMode = (mode: ScheduleSettingsValue['mode']): void => {
    onChange(mode === 'weekly' && value.weekdays.length === 0
      ? { ...value, mode, weekdays: [...DEFAULT_WEEKDAYS] }
      : { ...value, mode })
  }
  const toggleWeekday = (js: number): void => {
    const on = value.weekdays.includes(js)
    onChange({ ...value, weekdays: on ? value.weekdays.filter(w => w !== js) : [...value.weekdays, js] })
  }

  return (
    <div className={css.execSettings}>
      <div className={css.formRow}>
        <label className={css.formLabel}>{t('detail.repeat')}</label>
        <select className={css.select} value={value.mode} onChange={e => setMode(e.target.value as ScheduleSettingsValue['mode'])}>
          <option value="none">{t('schedule.none')}</option>
          <option value="daily">{t('schedule.daily')}</option>
          <option value="weekly">{t('schedule.weekly')}</option>
        </select>
      </div>
      {value.mode === 'weekly' && (
        <div className={css.formRow}>
          <label className={css.formLabel}>{t('schedule.weekdays')}</label>
          <div className={css.weekdayChips} role="group" aria-label={t('schedule.weekdays')}>
            {WEEKDAY_ORDER.map(js => {
              const on = value.weekdays.includes(js)
              return (
                <button
                  key={js}
                  type="button"
                  className={css.weekdayChip}
                  data-active={on || undefined}
                  aria-pressed={on}
                  onClick={() => toggleWeekday(js)}
                >{t(`weekday.${(js + 6) % 7}` as calendarKey)}</button>
              )
            })}
          </div>
        </div>
      )}
      {value.mode !== 'none' && (
        <label className={css.checkRow}>
          <input
            type="checkbox"
            checked={value.skipHolidays}
            onChange={e => onChange({ ...value, skipHolidays: e.target.checked })}
          />
          <span>{t('schedule.skipHolidays')}</span>
        </label>
      )}
      {value.mode !== 'none' && (
        <>
          <label className={css.checkRow}>
            <input
              type="checkbox"
              checked={value.triggerAgent}
              onChange={e => onChange({ ...value, triggerAgent: e.target.checked })}
            />
            <span>{t('schedule.triggerAgent')}</span>
          </label>
          {value.triggerAgent && (
            <div className={css.formRow}>
              <label className={css.formLabel}>{t('schedule.triggerAt')}</label>
              <input className={css.input} type="time" value={value.triggerAt}
                title={t('schedule.triggerAtHint')}
                onChange={e => onChange({ ...value, triggerAt: e.target.value })} />
              <span className={css.formValue}>{t('schedule.triggerAtHint')}</span>
            </div>
          )}
        </>
      )}
      {value.mode === 'none' && (
        <div className={css.formRow}>
          <label className={css.formLabel}>{t('detail.dueAt')}</label>
          <input className={css.input} type="datetime-local" value={value.dueAt}
            onChange={e => onChange({ ...value, dueAt: e.target.value })} />
        </div>
      )}
    </div>
  )
}
