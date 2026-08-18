/** Calendar container: header (title / today / view switch / search) + body. */
import { useState } from 'react'
import type { CalenderClientController, CalenderView } from '../controller.ts'
import { WeekGrid } from './WeekGrid.tsx'
import { MonthGrid } from './MonthGrid.tsx'
import { MatrixPanel } from './MatrixPanel.tsx'
import { AgendaPanel } from './AgendaPanel.tsx'
import { CreateTaskModal } from './CreateTaskModal.tsx'
import { t, type CalenderKey } from '../locales.ts'
import css from '../calender.module.css'

const VIEWS: Array<{ view: CalenderView; key: CalenderKey }> = [
  { view: 'week', key: 'view.week' },
  { view: 'month', key: 'view.month' },
  { view: 'matrix', key: 'view.matrix' },
  { view: 'agenda', key: 'view.agenda' },
]

interface CalendarViewProps { controller: CalenderClientController }

export function CalendarView({ controller }: CalendarViewProps) {
  const snap = controller.getSnapshot()
  const [query, setQuery] = useState('')
  const body = ((): React.ReactNode => {
    switch (snap.view) {
      case 'month': return <MonthGrid controller={controller} />
      case 'matrix': return <MatrixPanel controller={controller} />
      case 'agenda': return <AgendaPanel controller={controller} />
      default: return <WeekGrid controller={controller} />
    }
  })()

  return (
    <div className={css.calendarViewInner} data-dsh-calender-view-inner="">
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
        <button type="button" className={css.btnGhost} onClick={() => controller.setCursor(Date.now())}>{t('board.today')}</button>
        <input className={css.search} value={query} placeholder={t('board.search')} onChange={e => setQuery(e.target.value)} />
        <button type="button" className={css.btnPrimary} onClick={() => controller.setDraft({ start: Date.now(), end: Date.now() + 60_000 })}>{t('board.new')}</button>
      </div>
      <div className={css.calendarBody}>
        {snap.status === 'loading' && <div className={css.statusLine}>{t('status.loading')}</div>}
        {snap.status === 'error' && <div className={css.statusLine}>{t('status.error', { error: snap.error ?? 'unknown' })}</div>}
        {snap.status === 'ready' && body}
      </div>
      {snap.draft !== undefined && snap.status === 'ready' && (
        <CreateTaskModal controller={controller} onClose={() => controller.setDraft(undefined)} />
      )}
    </div>
  )
}
