/**
 * The calendar entry button, rendered into the `sidebar.footer.action` slot.
 *
 * Root-scoped (reachable without opening a session), rendered beside Settings
 * at the sidebar foot. Clicking it toggles the `shell.overlay` calendar panel.
 *
 * The geometry, ink and hover chrome replicate the Settings trigger
 * (`ui-settings-general` SettingsRoot.module.css `.trigger`) exactly, so the
 * two footer rows look identical: a full-width 42px row with a 16px icon +
 * label when the sidebar is wide, collapsing to the rail's 36px circle with an
 * 18px icon and no label when collapsed. The `wide` seat is handed down by the
 * `sidebar.footer.action` slot owner (SidebarRoot renders it `{ wide }`).
 */
import { useSyncExternalStore, type ReactNode } from 'react'
import { isCalendarOpen, subscribeCalendarOpen, toggleCalendarOpen } from './root-open.ts'
import { t } from './locales.ts'
import css from './calendar.module.css'

/**
 * Render the calendar glyph. Shares the Settings trigger's stroke idiom
 * (currentColor, feather-style 1.3 weight) so the entry matches its neighbour;
 * wide uses 16px, the rail uses 18px (same sizing story as Settings).
 */
function CalendarGlyph({ size }: { size: number }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="1.5" y="3" width="13" height="10.5" rx="1.5" />
      <path d="M1.5 6h13M5 1.5v3M11 1.5v3" />
    </svg>
  )
}

/** The sidebar-footer entry occupant (a single button). */
export function CalendarEntry(props: { wide?: boolean }): ReactNode {
  const open = useSyncExternalStore(subscribeCalendarOpen, isCalendarOpen)
  // Default to the wide row when the seat is absent; the rail is the explicit
  // `wide === false` branch, exactly as the Settings trigger treats it.
  const wide = props.wide !== false
  return (
    <button
      type="button"
      className={wide ? css.entry : [css.entry, css.rail].join(' ')}
      title={t('entry.label')}
      aria-label={t('entry.label')}
      aria-pressed={open}
      onClick={toggleCalendarOpen}
    >
      <CalendarGlyph size={wide ? 16 : 18} />
      {wide && <span className={css.entryLabel}>{t('entry.label')}</span>}
    </button>
  )
}
