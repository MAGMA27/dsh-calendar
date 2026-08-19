/**
 * The calendar entry button, rendered into the `sidebar.footer.action` slot.
 *
 * Root-scoped (reachable without opening a session), rendered beside Settings
 * at the sidebar foot. Clicking it toggles the `shell.overlay` calendar panel.
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { isCalendarOpen, subscribeCalendarOpen, toggleCalendarOpen } from './root-open.ts'
import { t } from './locales.ts'
import css from './calendar.module.css'

/** Inline icon (matches the shell's 16px nav-icon look). */
const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="1.5" y="3" width="13" height="10.5" rx="1.5"/><path d="M1.5 6h13M5 1.5v3M11 1.5v3"/></svg>'

/** The sidebar-footer entry occupant (a single button). */
export function CalendarEntry(props: { wide?: boolean }): ReactNode {
  const { wide } = props
  const open = useSyncExternalStore(subscribeCalendarOpen, isCalendarOpen)
  return (
    <button
      type="button"
      className={css.entry}
      title={t('entry.label')}
      aria-label={t('entry.label')}
      data-active={open || undefined}
      data-wide={wide || undefined}
      onClick={toggleCalendarOpen}
    >
      <span className={css.entryIcon} dangerouslySetInnerHTML={{ __html: ICON }} />
      {wide && <span className={css.entryLabel}>{t('entry.label')}</span>}
    </button>
  )
}
