/** Calendar container: header + body; a task detail panel opens on the right
 * when a task is selected.
 */
import { useSyncExternalStore } from 'react'
import type { calendarClientController, calendarView } from '../controller.ts'
import { addDays, addMonths, monthLabel, weekDays, weekRangeLabel } from '../../core/calendar.ts'
import { WeekGrid } from './WeekGrid.tsx'
import { MonthGrid } from './MonthGrid.tsx'
import { MatrixPanel } from './MatrixPanel.tsx'
import { AgendaPanel } from './AgendaPanel.tsx'
import { CreateTaskModal } from './CreateTaskModal.tsx'
import { TaskDetailPanel } from './TaskDetailPanel.tsx'
import { RepeatTimeConfirm } from './RepeatTimeConfirm.tsx'
import { t, type calendarKey } from '../locales.ts'
import css from '../calendar.module.css'

const VIEWS: Array<{ view: calendarView; key: calendarKey }> = [
  { view: 'week', key: 'view.week' },
  { view: 'month', key: 'view.month' },
  { view: 'matrix', key: 'view.matrix' },
  { view: 'agenda', key: 'view.agenda' },
]

/** Whole-hour minutes-of-day options for the visible-day-window pickers. */
const HOUR_OPTIONS = Array.from({ length: 25 }, (_, h) => h * 60)

/** The document language (drives date labels); falls back to zh. */
function locale(): string {
  return typeof document !== 'undefined' && document.documentElement.lang
    ? document.documentElement.lang
    : 'zh'
}

interface CalendarViewProps {
  controller: calendarClientController
  /** Open the GUI's session view (session jump from an execution record). */
  onOpenSession?: (sessionId: string) => void
}

export function CalendarView({ controller, onOpenSession }: CalendarViewProps) {
  const snap = useSyncExternalStore(
    fn => controller.subscribe(fn),
    () => controller.getSnapshot(),
  )
  const body = ((): React.ReactNode => {
    switch (snap.view) {
      case 'month': return <MonthGrid controller={controller} />
      case 'matrix': return <MatrixPanel controller={controller} />
      case 'agenda': return <AgendaPanel controller={controller} />
      default: return <WeekGrid controller={controller} />
    }
  })()
  const selected = snap.selectedTaskId !== undefined ? snap.snapshot.tasks.find(t => t.id === snap.selectedTaskId) : undefined

  return (
    <div className={css.calendarViewInner} data-dsh-calendar-view-inner="">
      <div className={css.calendarHeader}>
        <h2 className={css.calendarTitle}>{t('board.title')}</h2>
        <div className={css.viewSwitcher} role="tablist" aria-label={t('board.title')}>
          {VIEWS.map(v => (
            <button
              type="button"
              key={v.view}
              className={css.viewSwitchButton}
              role="tab"
              aria-selected={snap.view === v.view}
              data-active={snap.view === v.view || undefined}
              onClick={() => controller.setView(v.view)}
            >{t(v.key)}</button>
          ))}
        </div>
        {(snap.view === 'week' || snap.view === 'month') && (
          <DateNav controller={controller} view={snap.view} />
        )}
        {snap.view === 'week' && snap.dayWindow !== undefined && <DayWindowControl controller={controller} start={snap.dayWindow.start} end={snap.dayWindow.end} />}
        <button type="button" className={css.btnPrimary} onClick={() => controller.setDraft({ start: Date.now(), end: Date.now() + 60_000 })}>{t('board.new')}</button>
      </div>
      <div className={css.calendarBodyWithPanel}>
        <div className={css.calendarBody}>
          {snap.status === 'loading' && <div className={css.statusLine}>{t('status.loading')}</div>}
          {snap.status === 'error' && <div className={css.statusLine}>{t('status.error', { error: snap.error ?? 'unknown' })}</div>}
          {snap.status === 'ready' && body}
        </div>
        {snap.status === 'ready' && selected !== undefined && (
          <TaskDetailPanel key={selected.id} controller={controller} task={selected} onClose={() => controller.selectTask(undefined)} onOpenSession={onOpenSession} />
        )}
      </div>
      {snap.draft !== undefined && snap.status === 'ready' && (
        <CreateTaskModal controller={controller} onClose={() => controller.setDraft(undefined)} />
      )}
      {snap.pendingRepeatTimeEdit !== undefined && <RepeatTimeConfirm controller={controller} />}
    </div>
  )
}

/**
 * Week/month date navigation: previous / today / next around the calendar
 * cursor, with a label of the currently shown period.
 */
function DateNav({ controller, view }: { controller: calendarClientController; view: 'week' | 'month' }) {
  const snap = controller.getSnapshot()
  const cursor = snap.cursor
  const label = view === 'month'
    ? monthLabel(cursor, locale())
    : weekRangeLabel(cursor, snap.weekStart, locale())
  const back = (): void => {
    controller.setCursor(view === 'month' ? addMonths(cursor, -1) : addDays(cursor, -7))
  }
  const forward = (): void => {
    controller.setCursor(view === 'month' ? addMonths(cursor, 1) : addDays(cursor, 7))
  }
  return (
    <span className={css.dateNav} role="group" aria-label={t('board.title')}>
      <button type="button" className={css.dateNavButton} aria-label="上一期" onClick={back}>‹</button>
      <span className={css.dateNavLabel} aria-live="polite">{label}</span>
      <button type="button" className={css.dateNavButton} aria-label="下一期" onClick={forward}>›</button>
      <button type="button" className={css.btnGhost} onClick={() => controller.setCursor(Date.now())}>{t('board.today')}</button>
    </span>
  )
}

/** Compact control to pick the visible minutes-of-day window of the week grid. */
function DayWindowControl(props: { controller: calendarClientController; start: number; end: number }) {
  const { controller, start, end } = props
  const onStart = (raw: string): void => controller.setDayWindow({ start: Number(raw), end })
  const onEnd = (raw: string): void => controller.setDayWindow({ start, end: Number(raw) })
  return (
    <span className={css.windowControl} role="group" aria-label={t('view.window')} title={t('view.windowHint')}>
      <span className={css.windowLabel}>{t('view.window')}</span>
      <select className={css.windowSelect} value={start} aria-label={t('new.start')} onChange={e => onStart(e.target.value)}>
        {HOUR_OPTIONS.map(h => (
          <option key={'s' + h} value={h}>{String(h / 60).padStart(2, '0') + ':00'}</option>
        ))}
      </select>
      <span className={css.windowDash}>–</span>
      <select className={css.windowSelect} value={end} aria-label={t('new.end')} onChange={e => onEnd(e.target.value)}>
        {HOUR_OPTIONS.map(h => (
          <option key={'e' + h} value={h}>{String(h / 60).padStart(2, '0') + ':00'}</option>
        ))}
      </select>
      <button type="button" className={css.windowReset} title={t('view.windowReset')} onClick={() => controller.setDayWindow({ start: 0, end: 1440 })}>×</button>
    </span>
  )
}
