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
import type { CalenderClientController } from '../controller.ts'
import {
  blockOnDay, dayFraction, normalizeDrag, snapFloor, weekDays,
  type DayCell,
} from '../../core/calendar.ts'
import type { TaskRecord } from '../../core/tasks.ts'
import { TaskBlock, type TaskEditKind } from './TaskBlock.tsx'
import { t } from '../locales.ts'
import css from '../calender.module.css'

const HOURS = Array.from({ length: 24 }, (_, h) => h)
const MIN_BLOCK_MS = 15 * 60_000
const GUTTER_PX = 56
const DRAG_THRESHOLD_PX = 4

interface WeekGridProps {
  controller: CalenderClientController
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
  const gridHeight = 24 * 48

  const yToMs = (dayCell: DayCell, y: number): number => {
    const rect = bodyRef.current?.getBoundingClientRect()
    if (rect === undefined) return dayCell.dateMs
    const frac = Math.min(1, Math.max(0, (y - rect.top) / rect.height))
    return dayCell.dateMs + Math.round(frac * 24 * 60) * 60_000
  }

  const startDrag = (dayCell: DayCell) => (e: React.PointerEvent<HTMLDivElement>) => {
    dragOrigin.current = { y: e.clientY, dayCell }
    setDrag({ start: yToMs(dayCell, e.clientY), end: yToMs(dayCell, e.clientY) })
    ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  }
  const moveDrag = (dayCell: DayCell) => (e: React.PointerEvent<HTMLDivElement>) => {
    if (dragOrigin.current === undefined) return
    setDrag(normalizeDrag(dragOrigin.current.dayCell.dateMs, yToMs(dragOrigin.current.dayCell, dragOrigin.current.y), yToMs(dayCell, e.clientY), snapMinutes))
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
    editRef.current = {
      taskId: task.id, kind, origStart: task.startAt, origEnd: task.endAt,
      startX: e.clientX, startY: e.clientY, pointerId: e.pointerId, dayCell,
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
    if (rect === undefined) return 0
    const frac = Math.min(1, Math.max(0, (y - rect.top) / rect.height))
    return Math.round(frac * 24 * 60)
  }

  /** Compute the edit result from a pointer position (x,y). */
  const computeEdit = (x: number, y: number): { start: number; end: number; dayIdx: number } => {
    const edit = editRef.current!
    const span = edit.origEnd - edit.origStart
    if (edit.kind === 'move') {
      const dayIdx = xToDayIndex(x)
      const day = days[dayIdx]
      const snappedMin = snapMinutes * Math.round(yToMinutes(y) / snapMinutes)
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
      void controller.dispatch({ kind: 'update', id: edit.taskId, patch: { startAt: p.start, endAt: p.end } })
    }
  }

  return (
    <div className={css.weekGrid} ref={bodyRef} data-dsh-calender-week=""
      onPointerMove={onEditMove}
      onPointerUp={onEditUp}
      onPointerCancel={onEditUp}>
      <div className={css.weekGridCells} style={{ height: gridHeight }}>
        <div className={css.weekGutter}>
          {HOURS.map(h => (
            <div key={h} className={css.weekGutterLabel} style={{ top: (h / 24) * 100 + '%' }}>
              {h === 0 ? '' : String(h).padStart(2, '0') + ':00'}
            </div>
          ))}
        </div>
        {days.map(day => {
          const dayEnd = day.dateMs + 24 * 60 * 60_000
          const columnTasks = snap.snapshot.tasks.filter(t => !t.archivedAt && blockOnDay(t.startAt, t.endAt, day.dateMs, dayEnd))
          return (
            <div key={day.key} className={css.weekColumn} data-weekend={(day.weekday === 0 || day.weekday === 6) ? 'true' : undefined}>
              <div
                className={css.slotOverlay}
                onPointerDown={startDrag(day)}
                onPointerMove={moveDrag(day)}
                onPointerUp={endDrag}
                onPointerLeave={() => { if (dragOrigin.current === undefined) setDrag(undefined) }}
              />
              {dayKeyEquals(day, todayStart.getTime()) && (
                <div className={css.nowLine} style={{ top: dayFraction(now) * 100 + '%' }} aria-hidden="true" />
              )}
              {columnTasks.map(task => {
                const editing = preview !== undefined && preview.id === task.id
                // Only apply a live preview to the block that owns it and only if
                // the preview still lies in this column (cross-day moves detach it).
                const inColumn = preview !== undefined && preview.dayIdx === days.indexOf(day)
                const topMs = editing && inColumn ? preview!.start : task.startAt
                const endMs = editing && inColumn ? preview!.end : task.endAt
                const topFrac = dayFraction(topMs)
                const durationFrac = (endMs - topMs) / (24 * 60 * 60_000)
                return (
                  <TaskBlock
                    key={task.id}
                    task={task}
                    topPct={topFrac * 100}
                    heightPct={Math.max(durationFrac * 100, 1.6)}
                    leftPct={0}
                    widthPct={100}
                    onSelect={selectTask}
                    onEditStart={onEditStart(task)}
                    editing={editing && inColumn}
                  />
                )
              })}
              {drag !== undefined && dragOrigin.current !== undefined && dragOrigin.current.dayCell.key === day.key && (
                <div
                  className={css.selection}
                  style={{ top: dayFraction(drag.start) * 100 + '%', height: Math.max((drag.end - drag.start) / (24 * 60 * 60_000) * 100, 1.6) + '%' }}
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
              top: dayFraction(preview.start) * 100 + '%',
              height: Math.max((preview.end - preview.start) / (24 * 60 * 60_000) * 100, 1.6) + '%',
            }}
            data-dsh-calender-move-preview=""
          />
        )}
      </div>
    </div>
  )
}

function dayKeyEquals(day: DayCell, dateMs: number): boolean {
  const d = new Date(dateMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return day.key === `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
