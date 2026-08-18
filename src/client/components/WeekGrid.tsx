/** The 7-column × 24h time grid with drag-to-create and drag/resize edit. */
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

interface WeekGridProps {
  controller: CalenderClientController
  snapMinutes?: number
}

interface EditState {
  taskId: string
  kind: TaskEditKind
  origStart: number
  origEnd: number
  originY: number
  dayCell: DayCell
}

export function WeekGrid({ controller, snapMinutes = 30 }: WeekGridProps) {
  const snap = controller.getSnapshot()
  const days = weekDays(snap.cursor, snap.weekStart)
  const dragOrigin = useRef<{ y: number; dayCell: DayCell } | undefined>(undefined)
  const [drag, setDrag] = useState<{ start: number; end: number } | undefined>(undefined)
  const editRef = useRef<EditState | undefined>(undefined)
  const [preview, setPreview] = useState<{ id: string; start: number; end: number } | undefined>(undefined)
  const suppressSelectRef = useRef(false)
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

  // --- task move / resize ----------------------------------------------------
  const onEditStart = (task: TaskRecord) => (e: React.PointerEvent<HTMLElement>, kind: TaskEditKind): void => {
    const dayCell = days.find(d => dayKeyEquals(d, task.startAt)) ?? days[0]
    editRef.current = { taskId: task.id, kind, origStart: task.startAt, origEnd: task.endAt, originY: e.clientY, dayCell }
    setPreview({ id: task.id, start: task.startAt, end: task.endAt })
    // Capture on the grid root so moves outside the block still track.
    bodyRef.current?.setPointerCapture?.(e.pointerId)
    e.preventDefault()
  }

  const selectTask = (id: string): void => {
    // A drag/release edit already dispatched update; the trailing click on the
    // block would also open the detail panel — suppress it.
    if (suppressSelectRef.current) { suppressSelectRef.current = false; return }
    controller.selectTask(id)
  }

  const computeEdit = (y: number): { start: number; end: number } => {
    const edit = editRef.current!
    const dayStart = edit.dayCell.dateMs
    const dayEnd = dayStart + 24 * 60 * 60_000
    const target = Math.min(dayEnd, Math.max(dayStart, snapFloor(yToMs(edit.dayCell, y), snapMinutes)))
    if (edit.kind === 'move') {
      const delta = target - snapFloor(yToMs(edit.dayCell, edit.originY), snapMinutes)
      let start = edit.origStart + delta
      let end = edit.origEnd + delta
      const span = end - start
      start = Math.min(dayEnd - span, Math.max(dayStart, start))
      end = start + span
      return { start, end }
    }
    if (edit.kind === 'resize-start') return { start: Math.min(edit.origEnd - MIN_BLOCK_MS, target), end: edit.origEnd }
    return { start: edit.origStart, end: Math.max(edit.origStart + MIN_BLOCK_MS, target) }
  }

  const onEditMove = (e: React.PointerEvent): void => {
    if (editRef.current === undefined) return
    const next = computeEdit(e.clientY)
    setPreview({ id: editRef.current.taskId, start: next.start, end: next.end })
  }
  const onEditUp = (): void => {
    const edit = editRef.current
    const p = preview
    editRef.current = undefined
    setPreview(undefined)
    if (edit === undefined) return
    if (p !== undefined && (p.start !== edit.origStart || p.end !== edit.origEnd)) {
      suppressSelectRef.current = true
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
                const topMs = editing ? preview.start : task.startAt
                const endMs = editing ? preview.end : task.endAt
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
                    editing={editing}
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
      </div>
    </div>
  )
}

function dayKeyEquals(day: DayCell, dateMs: number): boolean {
  const d = new Date(dateMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return day.key === `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
