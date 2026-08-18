/**
 * Calendar grid math and drag-selection helpers. Framework-free and pure so
 * the browser WeekGrid and the tests share one source of truth for how a
 * pixel/time/ms maps onto the 7×24 grid, and how a drag-select interval is
 * normalized.
 */

/** How a week starts: Monday (0) or Sunday (1), matching Date#getDay domain. */
export type WeekStart = 0 | 1

/** One day cell in a week grid: calendar date at 00:00 local (ms epoch). */
export interface DayCell {
  /** Date at 00:00 local time (ms epoch). */
  dateMs: number
  /** JS weekday (0 = Sunday). */
  weekday: number
  /** ISO-ish date label (YYYY-MM-DD). */
  key: string
}

/** The default time-step for snapping, in minutes. */
export const DEFAULT_SNAP_MINUTES = 30
/** Snap interval options offered by settings (minutes). */
export const SNAP_INTERVALS: readonly number[] = [15, 30, 60]

/** Build a YYYY-MM-DD key for a ms timestamp (local time). */
export function dayKey(dateMs: number): string {
  const d = new Date(dateMs)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The first day of a week containing `dateMs`, honoring weekStart. */
export function startOfWeek(dateMs: number, weekStart: WeekStart): number {
  const d = new Date(dateMs)
  const day = d.getDay()
  // WeekStart is a custom flag (0=Monday, 1=Sunday); Date#getDay() has
  // 0=Sunday, 1=Monday, so map the flag to the getDay of the week's start.
  const startGetDay = weekStart === 0 ? 1 : 0
  const diff = (day - startGetDay + 7) % 7
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - diff)
  return d.getTime()
}

/** The seven day cells of the week containing `dateMs`. */
export function weekDays(dateMs: number, weekStart: WeekStart): DayCell[] {
  const start = startOfWeek(dateMs, weekStart)
  const cells: DayCell[] = []
  for (let i = 0; i < 7; i++) {
    const d = new Date(start)
    d.setDate(d.getDate() + i)
    const dateMs_i = d.getTime()
    cells.push({ dateMs: dateMs_i, weekday: d.getDay(), key: dayKey(dateMs_i) })
  }
  return cells
}

/** The first day of the month containing `dateMs`. */
export function startOfMonth(dateMs: number): number {
  const d = new Date(dateMs)
  d.setHours(0, 0, 0, 0)
  d.setDate(1)
  return d.getTime()
}

/** The day cells of the calendar month grid (leading/trailing padding included). */
export function monthDays(dateMs: number, weekStart: WeekStart): DayCell[] {
  const first = startOfMonth(dateMs)
  const gridStart = startOfWeek(first, weekStart)
  const dim = new Date(first)
  const daysInMonth = new Date(dim.getFullYear(), dim.getMonth() + 1, 0).getDate()
  const cells: DayCell[] = []
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart)
    d.setDate(d.getDate() + i)
    const t = d.getTime()
    // Stop after we've shown a full month's worth + its trailing week.
    if (i > 0 && d.getDate() > daysInMonth && d.getDay() === (weekStart === 0 ? 1 : 0)) break
    cells.push({ dateMs: t, weekday: d.getDay(), key: dayKey(t) })
  }
  return cells
}

/** Whether two ms timestamps fall on the same calendar day (local time). */
export function sameDay(a: number, b: number): boolean {
  return dayKey(a) === dayKey(b)
}

/** Round a ms timestamp down to the start of its `snapMinutes` cell (0..59 clamp). */
export function snapFloor(ms: number, snapMinutes: number): number {
  const minutes = effectiveSnap(snapMinutes)
  const d = new Date(ms)
  const m = Math.floor(d.getMinutes() / minutes) * minutes
  d.setMinutes(m, 0, 0)
  return d.getTime()
}

/** Round a ms timestamp up to the end of its `snapMinutes` cell. */
export function snapCeil(ms: number, snapMinutes: number): number {
  const minutes = effectiveSnap(snapMinutes)
  const d = new Date(ms)
  const m = Math.ceil(d.getMinutes() / minutes) * minutes
  d.setMinutes(0, 0, 0)
  d.setMinutes(m)
  return d.getTime()
}

/** Clamp a snap interval into [5, 60], defaulting invalid values to 30. */
function effectiveSnap(snapMinutes: number): number {
  const minutes = Math.floor(snapMinutes)
  if (!Number.isFinite(minutes) || minutes <= 0) return DEFAULT_SNAP_MINUTES
  return Math.min(60, Math.max(5, minutes))
}

/**
 * A drag selection over the week grid: a begin and end ms (real timestamps)
 * plus a day anchor so crossing-day drags stay on one column until a move.
 */
export interface DragSelection {
  /** The anchor instant (the day/column the drag started on). */
  anchor: number
  /** The current begin instant (snapped). */
  start: number
  /** The current end instant (snapped). */
  end: number
}

/** Normalize a drag to a non-empty, start<end snapped selection. */
export function normalizeDrag(anchor: number, from: number, to: number, snapMinutes: number): { start: number; end: number } {
  void anchor
  const minutes = effectiveSnap(snapMinutes)
  const lo = snapFloor(Math.min(from, to), minutes)
  const hi = snapFloor(Math.max(from, to), minutes)
  if (lo === hi) return { start: lo, end: lo + minutes * 60_000 }
  return { start: lo, end: hi }
}

/** Whether a task's block falls on the given day cell. */
export function blockOnDay(taskStart: number, taskEnd: number, dayStart: number, dayEnd: number): boolean {
  return taskEnd > dayStart && taskStart < dayEnd
}

/** Minutes since local midnight for a ms timestamp. */
export function minutesOfDay(ms: number): number {
  const d = new Date(ms)
  return d.getHours() * 60 + d.getMinutes()
}

/** Offset fraction (0..1) of a timestamp within the grid's day (minute of day / 1440). */
export function dayFraction(ms: number): number {
  return minutesOfDay(ms) / 1440
}

/** Render HH:MM for a ms timestamp (local time). */
export function hhmm(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** A positioned task block on one day column. */
export interface DayBlockLayout {
  id: string
  /** 0-based column within the day. */
  column: number
  /** Total number of columns (widths are 100 / columnCount). */
  columnCount: number
}

/**
 * Assign overlapping tasks on one day into non-overlapping side-by-side
 * columns (the classic calendar-event layout): each task occupies the first
 * column whose previous occupant has already ended. Returns positions without
 * mutating input; tasks are treated by their [startAt, endAt) intervals.
 */
export function layoutDayTasks<T extends { id: string; startAt: number; endAt: number }>(tasks: readonly T[]): DayBlockLayout[] {
  const sorted = [...tasks].sort((a, b) => a.startAt - b.startAt || a.endAt - b.endAt)
  const columnEnds: number[] = []
  const map = new Map<string, DayBlockLayout>()
  for (const t of sorted) {
    let column = columnEnds.findIndex(end => end <= t.startAt)
    if (column === -1) {
      column = columnEnds.length
      columnEnds.push(t.endAt)
    } else {
      columnEnds[column] = t.endAt
    }
    map.set(t.id, { id: t.id, column, columnCount: 0 })
  }
  const columnCount = columnEnds.length
  const result: DayBlockLayout[] = []
  for (const t of sorted) {
    const pos = map.get(t.id)!
    result.push({ ...pos, columnCount })
  }
  return result
}
