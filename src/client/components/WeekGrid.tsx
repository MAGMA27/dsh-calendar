/** The 7-column × 24h time grid with drag-to-create and drag/resize edit.
 *
 * Interaction model (fixed per acceptance):
 *  - A plain click on a task block opens its detail panel (onClick).
 *  - Dragging the block body moves it across days (x picks the day column,
 *    y picks the time) — the drag only starts after a small movement threshold,
 *    so clicks are never consumed by the move handling.
 *  - Dragging the top/bottom edge resizes the block's start/end within its day.
 */
import { useRef, useState } from 'react'
import type { calendarClientController } from '../controller.ts'
import {
  blockOnDay, dayKey, dayWindowFraction, dayWindowLength, inDayWindow, layoutDayTasks,
  normalizeDrag, weekDays,
  DEFAULT_SNAP_MINUTES,
  type DayCell,
} from '../../core/calendar.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { isTaskOccurrenceVisible } from '../../core/tasks.ts'
import { TaskBlock, type TaskEditKind } from './TaskBlock.tsx'
import { t, type calendarKey } from '../locales.ts'
import css from '../calendar.module.css'

const MIN_BLOCK_MS = 15 * 60_000
const DAY_MS = 24 * 60 * 60_000
const GUTTER_PX = 56
const DRAG_THRESHOLD_PX = 4
/** Vertical pixels allotted to one hour of the visible day window. */
const HOURLY_PX = 48

interface WeekGridProps {
  controller: calendarClientController
  snapMinutes?: number
}

interface EditCandidate {
  taskId: string
  kind: TaskEditKind
  origStart: number
  origEnd: number
  startX: number
  startY: number
  pointerId: number
  /** The block's own day (used to constrain a resize to that day). */
  dayCell: DayCell
  /**
   * Grab offset in minutes between the pointer and the block start, so a move
   * keeps the cursor at the same relative spot inside the block (follows the
   * hand instead of snapping the block top to the cursor).
   */
  moveOffsetMin: number
}

export function WeekGrid({ controller, snapMinutes = DEFAULT_SNAP_MINUTES }: WeekGridProps) {
  const snap = controller.getSnapshot()
  const days = weekDays(snap.cursor, snap.weekStart)
  const dragOrigin = useRef<{ y: number; dayCell: DayCell } | undefined>(undefined)
  const dragLast = useRef<{ y: number; dayCell: DayCell } | undefined>(undefined)
  const [drag, setDrag] = useState<{ start: number; end: number } | undefined>(undefined)
  const editRef = useRef<EditCandidate | undefined>(undefined)
  const armedRef = useRef(false)
  const suppressSelectRef = useRef(false)
  const [preview, setPreview] = useState<{ id: string; start: number; end: number; dayIdx: number } | undefined>(undefined)
  const bodyRef = useRef<HTMLDivElement>(null)
  // The time grid area (excluding the sticky weekday/date header). Pointer→time
  // mapping must use THIS rect: hour lines are positioned inside weekGridCells,
  // so using bodyRef (which includes the header) shifted every click ~30 min
  // later (a visual 9:50 landed at ~10:13 and floored to 10:00).
  const cellsRef = useRef<HTMLDivElement>(null)

  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0)
  const now = Date.now()
  // Visible minutes-of-day window. The grid keeps its full-day height and the
  // window is stretched across it, so hiding sleep/off hours enlarges the rest.
  // start > end is allowed: the window then wraps past midnight (e.g. 11:00 -
  // next-day 02:00).
  const rawWin = snap.dayWindow ?? { start: 0, end: 1440 }
  const winStart = Math.max(0, Math.min(1439, Math.round(rawWin.start)))
  const winEnd = Math.max(1, Math.min(1440, Math.round(rawWin.end)))
  const winLength = dayWindowLength(winStart, winEnd)
  const gridHeight = 24 * HOURLY_PX // constant; the window stretches across it

  // Position (0..1) of a timestamp within the shown window, clamping hidden
  // times onto the nearest edge.
  const winFrac = (ms: number): number => dayWindowFraction(winStart, winEnd, ms)
  const winHas = (ms: number): boolean => inDayWindow(winStart, winEnd, ms)

  const daySegment = (start: number, end: number, dayStart: number): { top: number; bottom: number } | undefined => {
    const dayEnd = dayStart + DAY_MS
    const segmentStart = Math.max(start, dayStart)
    const segmentEnd = Math.min(end, dayEnd)
    if (segmentEnd <= segmentStart) return undefined
    const segmentFraction = (ms: number): number => {
      // In a full-day grid, midnight is both 00:00 and the bottom edge. Keep
      // the clipped end at 100% so a cross-day task continues at next day's top.
      if (winStart === 0 && winEnd === 1440) {
        if (ms <= dayStart) return 0
        if (ms >= dayEnd) return 1
      }
      return winFrac(ms)
    }
    return { top: segmentFraction(segmentStart), bottom: segmentFraction(segmentEnd) }
  }

  // Hour boundaries that fall inside the (possibly wrapped) window.
  const gutterHours: number[] = []
  for (let h = 0; h <= 23; h++) {
    if (winHas(todayStart.getTime() + h * 3_600_000)) gutterHours.push(h)
  }

  const yToDayMinutes = (y: number): number => {
    const rect = cellsRef.current?.getBoundingClientRect()
    if (rect === undefined) return winStart
    const frac = Math.min(1, Math.max(0, (y - rect.top) / rect.height))
    return winStart + Math.round(frac * winLength)
  }

  const yToMs = (dayCell: DayCell, y: number): number => {
    return dayCell.dateMs + yToDayMinutes(y) * 60_000
  }

  const startDrag = (dayCell: DayCell) => (e: React.PointerEvent<HTMLDivElement>) => {
    dragOrigin.current = { y: e.clientY, dayCell }
    dragLast.current = { y: e.clientY, dayCell }
    setDrag({ start: yToMs(dayCell, e.clientY), end: yToMs(dayCell, e.clientY) })
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const moveDrag = (dayCell: DayCell) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current === undefined) return
    dragLast.current = { y: e.clientY, dayCell }
    const d = normalizeDrag(dragOrigin.current.dayCell.dateMs, yToMs(dragOrigin.current.dayCell, dragOrigin.current.y), yToMs(dayCell, e.clientY), snapMinutes)
    setDrag(d)
  }
  const endDrag = () => {
    const origin = dragOrigin.current
    if (origin === undefined) return
    // Recompute the final selection deterministically from the pointer refs and
    // run it through normalizeDrag (floor) — never trust possibly-stale state.
    // A plain click (no move) has last == origin, so it too lands on the grid
    // (e.g. a click at 9:50 floors to 9:30).
    const last = dragLast.current ?? origin
    const d = normalizeDrag(origin.dayCell.dateMs, yToMs(origin.dayCell, origin.y), yToMs(last.dayCell, last.y), snapMinutes)
    controller.setDraft({ start: d.start, end: d.end })
    setDrag(undefined)
    dragOrigin.current = undefined
    dragLast.current = undefined
  }

  // --- task move / resize (threshold-armed, cross-day move) ------------------
  const onEditStart = (task: TaskRecord, blockDay: DayCell) => (e: React.PointerEvent<HTMLElement>, kind: TaskEditKind): void => {
    const dayCell = blockDay
    // Keep the grab offset (pointer position inside the block) so the dragged
    // block follows the cursor instead of jumping its top to the cursor.
    const pointerMin = yToDayMinutes(e.clientY)
    const pointerAt = dayCell.dateMs + pointerMin * 60_000
    const moveOffsetMin = kind === 'move' ? Math.max(0, (pointerAt - task.startAt) / 60_000) : 0
    editRef.current = {
      taskId: task.id, kind, origStart: task.startAt, origEnd: task.endAt,
      startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, dayCell, moveOffsetMin,
    }
    armedRef.current = false
    suppressSelectRef.current = false
    // Do NOT capture here — a plain click must still reach the block's onClick.
  }

  const selectTask = (id: string): void => {
    if (suppressSelectRef.current) { suppressSelectRef.current = false; return }
    controller.selectTask(id)
  }

  const xToDayIndex = (x: number): number => {
    const rect = cellsRef.current?.getBoundingClientRect()
    if (rect === undefined) return 0
    const colWidth = (rect.width - GUTTER_PX) / 7
    const idx = Math.floor((x - rect.left - GUTTER_PX) / colWidth)
    return Math.max(0, Math.min(6, idx))
  }

  /** Compute the edit result from a pointer position (x,y). */
  const computeEdit = (x: number, y: number): { start: number; end: number; dayIdx: number } => {
    const edit = editRef.current!
    const span = edit.origEnd - edit.origStart
    if (edit.kind === 'move') {
      const dayIdx = xToDayIndex(x)
      const day = days[dayIdx]
      const yMin = yToDayMinutes(y)
      const rawStart = yMin - edit.moveOffsetMin
      const snappedMin = snapMinutes * Math.round(rawStart / snapMinutes)
      const start = day.dateMs + snappedMin * 60_000
      return { start, end: start + span, dayIdx }
    }
    // Resize against the absolute end of the visible grid window.
    const dayStart = edit.dayCell.dateMs
    const visibleEnd = dayStart + (winStart + winLength) * 60_000
    const snappedMin = snapMinutes * Math.round(yToDayMinutes(y) / snapMinutes)
    const target = Math.min(visibleEnd, Math.max(dayStart, dayStart + snappedMin * 60_000))
    const dayIdx = Math.max(0, Math.min(6, days.findIndex(d => d.key === edit.dayCell.key) ))
    if (edit.kind === 'resize-start') return { start: Math.min(edit.origEnd - MIN_BLOCK_MS, target), end: edit.origEnd, dayIdx }
    return { start: edit.origStart, end: Math.max(edit.origStart + MIN_BLOCK_MS, target), dayIdx }
  }

  const onEditMove = (e: React.PointerEvent): void => {
    const edit = editRef.current
    if (edit === undefined) return
    if (!armedRef.current) {
      const dx = e.clientX - edit.startX
      const dy = e.clientY - edit.startY
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return
      // Threshold crossed: capture for the rest of the gesture.
      armedRef.current = true
      bodyRef.current?.setPointerCapture?.(edit.pointerId)
    }
    const next = computeEdit(e.clientX, e.clientY)
    setPreview({ id: edit.taskId, start: next.start, end: next.end, dayIdx: next.dayIdx })
  }

  const onEditUp = (): void => {
    const edit = editRef.current
    const armed = armedRef.current
    const p = preview
    editRef.current = undefined
    armedRef.current = false
    suppressSelectRef.current = armed && p !== undefined && (p.start !== edit?.origStart || p.end !== edit?.origEnd)
    setPreview(undefined)
    if (edit === undefined || !armed) return
    if (p !== undefined && (p.start !== edit.origStart || p.end !== edit.origEnd)) {
      const task = controller.getSnapshot().snapshot.tasks.find(t => t.id === edit.taskId)
      if (task !== undefined && (task.originTaskId !== undefined || task.schedule?.repeat !== undefined)) {
        // A time change on a repeat-series task (bound copy or template) must be
        // confirmed: apply to this task only (unbind a copy / keep the template
        // ahead of existing copies) or shift the whole series.
        controller.requestRepeatTimeEdit({
          taskId: edit.taskId,
          originTaskId: task.originTaskId,
          origStart: edit.origStart,
          origEnd: edit.origEnd,
          startAt: p.start,
          endAt: p.end,
        })
      } else {
        void controller.dispatch({ kind: 'reschedule', id: edit.taskId, startAt: p.start, endAt: p.end })
      }
    }
  }

  const todayKey = dayKey(todayStart.getTime())

  return (
    <div className={css.weekGrid} ref={bodyRef} data-dsh-calendar-week=""
      onPointerMove={onEditMove}
      onPointerUp={onEditUp}
      onPointerCancel={onEditUp}>
      {/* sticky weekday/date header */}
      <div className={css.weekHeader} data-dsh-calendar-week-header="">
        <div className={css.weekHeaderCorner} />
        {days.map(day => {
          const isToday = day.key === todayKey
          return (
            <div key={day.key} className={css.weekHeaderCell} data-today={isToday || undefined}>
              <span className={css.weekHeaderDay}>{dayShortLabel(day.weekday)}</span>
              <span className={css.weekHeaderDate}>{day.dateMs === undefined ? '' : new Date(day.dateMs).getDate()}</span>
            </div>
          )
        })}
      </div>
      <div className={css.weekGridCells} ref={cellsRef} style={{ height: gridHeight }}>
        <div className={css.weekGutter}>
          {gutterHours.map(h => {
            // Only suppress the 00:00 label when it sits exactly at the grid's
            // top edge (window starts at midnight); mid-grid 00:00 is shown.
            const atTop = winFrac(todayStart.getTime() + h * 3_600_000) === 0
            return (
              <div key={h} className={css.weekGutterLabel} style={{ top: winFrac(todayStart.getTime() + h * 3_600_000) * 100 + '%' }}>
                {h === 0 && atTop ? '' : String(h).padStart(2, '0') + ':00'}
              </div>
            )
          })}
        </div>
        {days.map(day => {
          const dayEnd = day.dateMs + DAY_MS
          const columnTasks = snap.snapshot.tasks.filter(t => !t.archivedAt && isTaskOccurrenceVisible(t) && blockOnDay(t.startAt, t.endAt, day.dateMs, dayEnd))
          // side-by-side columns so overlapping tasks don't cover each other
          const layout = layoutDayTasks(columnTasks)
          const colByTask = new Map(layout.map(l => [l.id, l]))
          return (
            <div key={day.key} className={css.weekColumn} data-weekend={(day.weekday === 0 || day.weekday === 6) ? 'true' : undefined}>
              {gutterHours.map(h => (
                <div key={h} className={css.hourLine} style={{ top: winFrac(todayStart.getTime() + h * 3_600_000) * 100 + '%' }} aria-hidden="true" />
              ))}
              <div
                className={css.slotOverlay}
                onPointerDown={startDrag(day)}
                onPointerMove={moveDrag(day)}
                onPointerUp={endDrag}
                onPointerLeave={() => { if (dragOrigin.current === undefined) setDrag(undefined) }}
              />
              {dayKeyEquals(day, todayStart.getTime()) && winHas(now) && (
                <div className={css.nowLine} style={{ top: winFrac(now) * 100 + '%' }} aria-hidden="true" />
              )}
              {columnTasks.map(task => {
                const editing = preview !== undefined && preview.id === task.id
                // Only apply a live preview to the block that owns it and only if
                // the preview still lies in this column (cross-day moves detach it).
                const inColumn = preview !== undefined && preview.dayIdx === days.indexOf(day)
                const topMs = editing && inColumn ? preview!.start : task.startAt
                const endMs = editing && inColumn ? preview!.end : task.endAt
                const segment = daySegment(topMs, endMs, day.dateMs)
                if (segment === undefined) return null
                const topFrac = segment.top
                const durationFrac = Math.max(0, segment.bottom - segment.top)
                const pos = colByTask.get(task.id)
                const columns = pos?.columnCount ?? 1
                const column = pos?.column ?? 0
                // Reserve a little horizontal gap only between side-by-side
                // blocks. The first block must stay at 0% so its left edge
                // remains aligned with full-width blocks in other time ranges.
                const gapPct = columns > 1 ? 2 : 0
                const widthPct = (100 - gapPct * (columns - 1)) / columns
                const leftPct = column * (widthPct + gapPct)
                return (
                  <TaskBlock
                    key={task.id}
                    task={task}
                    topPct={topFrac * 100}
                    heightPct={Math.max(durationFrac * 100, 1.6)}
                    leftPct={Math.max(leftPct, 0)}
                    widthPct={Math.max(widthPct, 4)}
                    onSelect={selectTask}
                    onToggleDone={(id, done) => { void controller.dispatch({ kind: 'setDone', id, done }) }}
                    onEditStart={onEditStart(task, day)}
                    editing={editing && inColumn}
                  />
                )
              })}
              {drag !== undefined && dragOrigin.current !== undefined && dragOrigin.current.dayCell.key === day.key && (
                <div
                  className={css.selection}
                  style={{ top: winFrac(drag.start) * 100 + '%', height: Math.max((winFrac(drag.end) - winFrac(drag.start)) * 100, 1.6) + '%' }}
                />
              )}
            </div>
          )
        })}
        {/* cross-day move preview: a floating block positioned by day column + time */}
        {preview !== undefined && days.map((day, dayIdx) => {
          const segment = daySegment(preview.start, preview.end, day.dateMs)
          if (segment === undefined) return null
          return (
            <div
              key={day.key}
              className={css.movePreview}
              style={{
                left: `calc(${GUTTER_PX}px + ${dayIdx} * (100% - ${GUTTER_PX}px) / 7)`,
                width: `calc((100% - ${GUTTER_PX}px) / 7)`,
                top: segment.top * 100 + '%',
                height: Math.max((segment.bottom - segment.top) * 100, 1.6) + '%',
              }}
              data-dsh-calendar-move-preview=""
            />
          )
        })}
      </div>
    </div>
  )
}

/** Short weekday name from the active calendar dictionary (e.g. "Mon"). */
function dayShortLabel(jsWeekday: number): string {
  return t(`weekday.${(jsWeekday + 6) % 7}` as calendarKey)
}

function dayKeyEquals(day: DayCell, dateMs: number): boolean {
  const d = new Date(dateMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return day.key === `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
