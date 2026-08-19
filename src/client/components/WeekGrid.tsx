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
  minutesOfDay, normalizeDrag, weekDays,
  type DayCell,
} from '../../core/calendar.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { TaskBlock, type TaskEditKind } from './TaskBlock.tsx'
import { t } from '../locales.ts'
import css from '../calendar.module.css'

const MIN_BLOCK_MS = 15 * 60_000
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

export function WeekGrid({ controller, snapMinutes = 30 }: WeekGridProps) {
  const snap = controller.getSnapshot()
  const days = weekDays(snap.cursor, snap.weekStart)
  const dragOrigin = useRef<{ y: number; dayCell: DayCell } | undefined>(undefined)
  const [drag, setDrag] = useState<{ start: number; end: number } | undefined>(undefined)
  const editRef = useRef<EditCandidate | undefined>(undefined)
  const armedRef = useRef(false)
  const suppressSelectRef = useRef(false)
  const [preview, setPreview] = useState<{ id: string; start: number; end: number; dayIdx: number } | undefined>(undefined)
  const bodyRef = useRef<HTMLDivElement>(null)

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

  // Hour boundaries that fall inside the (possibly wrapped) window.
  const gutterHours: number[] = []
  for (let h = 0; h <= 23; h++) {
    if (winHas(todayStart.getTime() + h * 3_600_000)) gutterHours.push(h)
  }

  const yToMs = (dayCell: DayCell, y: number): number => {
    const rect = bodyRef.current?.getBoundingClientRect()
    if (rect === undefined) return dayCell.dateMs + winStart * 60_000
    const frac = Math.min(1, Math.max(0, (y - rect.top) / rect.height))
    const mins = (winStart + Math.round(frac * winLength)) % 1440
    return dayCell.dateMs + mins * 60_000
  }

  const startDrag = (dayCell: DayCell) => (e: React.PointerEvent<HTMLDivElement>) => {
    dragOrigin.current = { y: e.clientY, dayCell }
    setDrag({ start: yToMs(dayCell, e.clientY), end: yToMs(dayCell, e.clientY) })
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const moveDrag = (dayCell: DayCell) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current === undefined) return
    const d = normalizeDrag(dragOrigin.current.dayCell.dateMs, yToMs(dragOrigin.current.dayCell, dragOrigin.current.y), yToMs(dayCell, e.clientY), snapMinutes)
    setDrag(d)
  }
  const endDrag = () => {
    if (drag === undefined) return
    controller.setDraft({ start: drag.start, end: drag.end })
    setDrag(undefined)
    dragOrigin.current = undefined
  }

  // --- task move / resize (threshold-armed, cross-day move) ------------------
  const onEditStart = (task: TaskRecord) => (e: React.PointerEvent<HTMLElement>, kind: TaskEditKind): void => {
    const dayCell = days.find(d => dayKeyEquals(d, task.startAt)) ?? days[0]
    // Keep the grab offset (pointer position inside the block) so the dragged
    // block follows the cursor instead of jumping its top to the cursor.
    const pointerMin = yToMinutes(e.clientY)
    const taskStartMin = minutesOfDay(task.startAt)
    const moveOffsetMin = kind === 'move' ? Math.max(0, pointerMin - taskStartMin) : 0
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
    const rect = bodyRef.current?.getBoundingClientRect()
    if (rect === undefined) return 0
    const colWidth = (rect.width - GUTTER_PX) / 7
    const idx = Math.floor((x - rect.left - GUTTER_PX) / colWidth)
    return Math.max(0, Math.min(6, idx))
  }

  const yToMinutes = (y: number): number => {
    const rect = bodyRef.current?.getBoundingClientRect()
    if (rect === undefined) return winStart
    const frac = Math.min(1, Math.max(0, (y - rect.top) / rect.height))
    return (winStart + Math.round(frac * winLength)) % 1440
  }

  /** Compute the edit result from a pointer position (x,y). */
  const computeEdit = (x: number, y: number): { start: number; end: number; dayIdx: number } => {
    const edit = editRef.current!
    const span = edit.origEnd - edit.origStart
    if (edit.kind === 'move') {
      const dayIdx = xToDayIndex(x)
      const day = days[dayIdx]
      const yMin = yToMinutes(y)
      const rawStart = yMin - edit.moveOffsetMin
      const snappedMin = snapMinutes * Math.round(rawStart / snapMinutes)
      const start = day.dateMs + snappedMin * 60_000
      return { start, end: start + span, dayIdx }
    }
    // resize: stay within the block's own day
    const dayStart = edit.dayCell.dateMs
    const dayEnd = dayStart + 24 * 60 * 60_000
    const snappedMin = snapMinutes * Math.round(yToMinutes(y) / snapMinutes)
    const target = Math.min(dayEnd, Math.max(dayStart, dayStart + snappedMin * 60_000))
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
        void controller.dispatch({ kind: 'update', id: edit.taskId, patch: { startAt: p.start, endAt: p.end } })
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
      <div className={css.weekGridCells} style={{ height: gridHeight }}>
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
          const dayEnd = day.dateMs + 24 * 60 * 60_000
          const columnTasks = snap.snapshot.tasks.filter(t => !t.archivedAt && blockOnDay(t.startAt, t.endAt, day.dateMs, dayEnd))
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
                const topFrac = winFrac(topMs)
                const durationFrac = Math.max(0, winFrac(endMs) - winFrac(topMs))
                const pos = colByTask.get(task.id)
                const columns = pos?.columnCount ?? 1
                const column = pos?.column ?? 0
                // Reserve a little horizontal gap between side-by-side blocks.
                const widthPct = 100 / columns
                const gapPct = columns > 1 ? 2 : 0
                return (
                  <TaskBlock
                    key={task.id}
                    task={task}
                    topPct={topFrac * 100}
                    heightPct={Math.max(durationFrac * 100, 1.6)}
                    leftPct={Math.max(column * (widthPct) + (gapPct / 2), 0)}
                    widthPct={Math.max(widthPct - gapPct, 4)}
                    onSelect={selectTask}
                    onEditStart={onEditStart(task)}
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
        {preview !== undefined && (
          <div
            className={css.movePreview}
            style={{
              left: `calc(${GUTTER_PX}px + ${preview.dayIdx} * (100% - ${GUTTER_PX}px) / 7)`,
              top: winFrac(preview.start) * 100 + '%',
              height: Math.max((winFrac(preview.end) - winFrac(preview.start)) * 100, 1.6) + '%',
            }}
            data-dsh-calendar-move-preview=""
          />
        )}
      </div>
    </div>
  )
}

/** Short local weekday name (e.g. "Mon"); swaps the CSS order to match. */
function dayShortLabel(jsWeekday: number): string {
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: 'short' })
  const d = new Date(2026, 0, 4 + jsWeekday) // 2026-01-04 is Sunday
  return fmt.format(d)
}

function dayKeyEquals(day: DayCell, dateMs: number): boolean {
  const d = new Date(dateMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return day.key === `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
