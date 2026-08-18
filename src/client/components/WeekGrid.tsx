/** The 7-column × 24h time grid with drag-to-create. */
import { useRef, useState } from 'react'
import type { CalenderClientController } from '../controller.ts'
import {
  blockOnDay, dayFraction, hhmm, normalizeDrag, weekDays,
  type DayCell,
} from '../../core/calendar.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { TaskBlock } from './TaskBlock.tsx'
import { t } from '../locales.ts'
import css from '../calender.module.css'

const HOURS = Array.from({ length: 24 }, (_, h) => h)

interface WeekGridProps {
  controller: CalenderClientController
  snapMinutes?: number
}

export function WeekGrid({ controller, snapMinutes = 30 }: WeekGridProps) {
  const snap = controller.getSnapshot()
  const days = weekDays(snap.cursor, snap.weekStart)
  const dragOrigin = useRef<{ y: number; dayCell: DayCell } | undefined>(undefined)
  const [drag, setDrag] = useState<{ start: number; end: number } | undefined>(undefined)
  const bodyRef = useRef<HTMLDivElement>(null)

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const now = Date.now()

  const gridHeight = 24 * 48 // 48px per hour

  const yToMs = (dayCell: DayCell, y: number): number => {
    const rect = bodyRef.current?.getBoundingClientRect()
    if (rect === undefined) return dayCell.dateMs
    const frac = Math.min(1, Math.max(0, (y - rect.top) / rect.height))
    const minutes = Math.round(frac * 24 * 60)
    return dayCell.dateMs + minutes * 60_000
  }

  const startDrag = (dayCell: DayCell) => (e: React.PointerEvent<HTMLDivElement>) => {
    dragOrigin.current = { y: e.clientY, dayCell }
    setDrag({ start: yToMs(dayCell, e.clientY), end: yToMs(dayCell, e.clientY) })
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const moveDrag = (dayCell: DayCell) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current === undefined) return
    const anchor = dragOrigin.current.dayCell.dateMs
    setDrag(normalizeDrag(anchor, yToMs(dragOrigin.current.dayCell, dragOrigin.current.y), yToMs(dayCell, e.clientY), snapMinutes))
  }
  const endDrag = () => {
    if (drag === undefined) return
    controller.setDraft({ start: drag.start, end: drag.end })
    setDrag(undefined)
    dragOrigin.current = undefined
  }

  return (
    <div className={css.weekGrid} ref={bodyRef} data-dsh-calender-week="">
      <div className={css.weekGridCells} style={{ height: gridHeight }}>
        {/* time gutter */}
        <div className={css.weekGutter}>
          {HOURS.map(h => (
            <div key={h} className={css.weekGutterLabel} style={{ top: (h / 24) * 100 + '%' }}>
              {h === 0 ? '' : String(h).padStart(2, '0') + ':00'}
            </div>
          ))}
        </div>
        {/* day columns */}
        {days.map(day => {
          const dayEnd = day.dateMs + 24 * 60 * 60_000
          const columnTasks = snap.snapshot.tasks.filter(t => !t.archivedAt && blockOnDay(t.startAt, t.endAt, day.dateMs, dayEnd))
          return (
            <div key={day.key} className={css.weekColumn} data-weekend={(day.weekday === 0 || day.weekday === 6) ? 'true' : undefined}>
              {/* slot overlay for drag */}
              <div
                className={css.slotOverlay}
                onPointerDown={startDrag(day)}
                onPointerMove={moveDrag(day)}
                onPointerUp={endDrag}
                onPointerLeave={() => { if (dragOrigin.current === undefined) setDrag(undefined) }}
              />
              {/* now line on today */}
              {dayKeyEquals(day, todayStart.getTime()) && (
                <div className={css.nowLine} style={{ top: dayFraction(now) * 100 + '%' }} aria-hidden="true" />
              )}
              {/* task blocks */}
              {columnTasks.map(task => {
                const topFrac = dayFraction(task.startAt)
                const durationFrac = (task.endAt - task.startAt) / (24 * 60 * 60_000)
                return (
                  <TaskBlock
                    key={task.id}
                    task={task as TaskRecord}
                    topPct={topFrac * 100}
                    heightPct={Math.max(durationFrac * 100, 1.6)}
                    leftPct={0}
                    widthPct={100}
                    onSelect={id => controller.selectTask(id)}
                  />
                )
              })}
              {/* in-progress drag selection */}
              {drag !== undefined && dragOrigin.current !== undefined && dragOrigin.current.dayCell.key === day.key && (
                <div
                  className={css.selection}
                  style={{ top: dayFraction(drag.start) * 100 + '%', height: Math.max((drag.end - drag.start) / (24 * 60 * 60_000) * 100, 1.6) + '%' }}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function dayKeyEquals(day: DayCell, dateMs: number): boolean {
  const d = new Date(dateMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return day.key === `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
