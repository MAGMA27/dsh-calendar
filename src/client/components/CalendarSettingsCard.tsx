import { useEffect, useState, useSyncExternalStore } from 'react'
import type { SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { t } from '../locales.ts'
import css from '../calendar.module.css'

const MAX_DEPTH = 3

export interface CalendarSettingsValue {
  maxScheduledDepth?: number
}

export interface CalendarSettingsCardProps {
  settingsScope: SettingsScope<CalendarSettingsValue>
}

interface Draft {
  maxScheduledDepth: string
}

function draftOf(value: CalendarSettingsValue | undefined): Draft {
  return { maxScheduledDepth: String(value?.maxScheduledDepth ?? 0) }
}

function parseDepth(value: string): number | undefined {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return undefined
  const parsed = Number(trimmed)
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_DEPTH ? parsed : undefined
}

/** The calendar-owned card rendered by Settings → Plugins. */
export function CalendarSettingsCard({ settingsScope }: CalendarSettingsCardProps): JSX.Element | null {
  const snapshot = useSyncExternalStore(
    listener => settingsScope.subscribe(listener),
    () => settingsScope.getSnapshot(),
    () => settingsScope.getSnapshot(),
  )
  const [draft, setDraft] = useState<Draft | undefined>(undefined)
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | undefined>(undefined)
  const [open, setOpen] = useState(false)

  const liveDraft = draftOf(snapshot.value)
  useEffect(() => {
    if (!dirty) setDraft(liveDraft)
  }, [dirty, liveDraft.maxScheduledDepth])

  if (snapshot.status === 'unavailable') return null
  const current = draft ?? liveDraft
  const depth = parseDepth(current.maxScheduledDepth)
  const disabled = snapshot.status !== 'ready' || !snapshot.writable || saving

  const edit = (next: Partial<Draft>): void => {
    setDraft({ ...current, ...next })
    setDirty(true)
    setSaved(false)
    setError(undefined)
  }

  const save = async (): Promise<void> => {
    if (depth === undefined) {
      setError(t('settings.invalidDepth'))
      return
    }
    setSaving(true)
    setSaved(false)
    setError(undefined)
    try {
      const liveDepth = snapshot.value?.maxScheduledDepth ?? 0
      if (depth !== liveDepth) await settingsScope.set('maxScheduledDepth', depth)
      setDirty(false)
      setSaved(true)
    } catch {
      setError(t('settings.saveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const bodyId = 'dsh-calendar-settings-body'
  const title = t('settings.title')

  return (
    <section
      className={open ? `${css.settingsCard} ${css.settingsCardOpen}` : css.settingsCard}
      aria-label={title}
    >
      <button
        type="button"
        className={css.settingsCardHeader}
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-controls={bodyId}
        aria-label={`${t(open ? 'settings.collapse' : 'settings.expand')}: ${title}`}
      >
        <span className={css.settingsCardHeadText}>
          <span className={css.settingsCardTitle}>{title}</span>
          <span className={css.settingsCardDescription}>{t('settings.description')}</span>
        </span>
        {dirty && <span className={css.settingsCardPending}>{t('settings.unsaved')}</span>}
        <svg
          className={open
            ? `${css.settingsCardChevron} ${css.settingsCardChevronOpen}`
            : css.settingsCardChevron}
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          <path
            d="M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.46904 7.25977 8.3623C7.40124 8.24849 7.57405 8.07732 7.84863 7.80273L10.5762 5.07617L11 4.65137L11.8486 5.5Z"
            fill="currentColor"
          />
        </svg>
      </button>
      {open && <div id={bodyId} className={css.settingsCardBody}>
        <label className={css.settingsField}>
          <span className={css.settingsFieldLabel}>{t('settings.maxDepth')}</span>
          <input
            className={css.settingsNumber}
            type="number"
            min={0}
            max={MAX_DEPTH}
            step={1}
            value={current.maxScheduledDepth}
            disabled={disabled}
            onChange={event => edit({ maxScheduledDepth: event.currentTarget.value })}
            aria-invalid={depth === undefined}
          />
          <span className={css.settingsFieldHint}>{t('settings.maxDepthHint')}</span>
        </label>
        {error !== undefined && <p className={css.settingsError}>{error}</p>}
        {saved && error === undefined && <p className={css.settingsSaved}>{t('settings.saved')}</p>}
        <div className={css.settingsCardActions}>
          <button
            type="button"
            className={css.settingsSave}
            disabled={disabled || !dirty || depth === undefined}
            onClick={() => { void save() }}
          >
            {saving ? t('settings.saving') : t('settings.save')}
          </button>
        </div>
      </div>}
    </section>
  )
}
