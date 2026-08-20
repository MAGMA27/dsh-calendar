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

/** Add `n` whole days to a ms timestamp (calendar-day arithmetic via Date). */
export function addDays(dateMs: number, n: number): number {
  const d = new Date(dateMs)
  d.setDate(d.getDate() + n)
  return d.getTime()
}

/**
 * Add `n` months to a ms timestamp, clamping the day to the target month's
 * length so e.g. Jan 31 + 1 month is Feb 28/29 (never Mar 3).
 */
export function addMonths(dateMs: number, n: number): number {
  const d = new Date(dateMs)
  const day = d.getDate()
  d.setDate(1)
  d.setMonth(d.getMonth() + n)
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
  d.setDate(Math.min(day, last))
  return d.getTime()
}

/** Whether two ms timestamps fall in the same calendar month (local time). */
export function sameMonth(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth()
}

/** Human-readable month label, e.g. "2024年1月" / "January 2024". */
export function monthLabel(dateMs: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long' }).format(new Date(dateMs))
}

/**
 * Human-readable week range label, e.g. "2024年1月15日 – 1月21日" (the year
 * rides the first day so the visible period is always self-identifying). Uses
 * the day cells so the week starts at `weekStart`.
 */
export function weekRangeLabel(dateMs: number, weekStart: WeekStart, locale: string): string {
  const days = weekDays(dateMs, weekStart)
  const first = new Date(days[0].dateMs)
  const last = new Date(days[6].dateMs)
  const firstLabel = new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'long', day: 'numeric' }).format(first)
  const lastLabel = new Intl.DateTimeFormat(locale, { month: 'long', day: 'numeric' }).format(last)
  return `${firstLabel} – ${lastLabel}`
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

/**
 * Round a ms timestamp to the NEAREST `snapMinutes` boundary (0..59 clamp, same
 * day). Task move/resize already snap to nearest; making the create gesture do
 * the same means a half-hour boundary is reachable from ~15 min on either side
 * ("a broader pointer"), so a new task can start exactly at an existing task's
 * edge instead of being pulled back into the previous cell by floor-snapping.
 */
export function snapNearest(ms: number, snapMinutes: number): number {
  const minutes = effectiveSnap(snapMinutes)
  const d = new Date(ms)
  const dayTotal = minutesOfDay(ms)
  const snapped = Math.min(1439, Math.max(0, Math.round(dayTotal / minutes) * minutes))
  d.setHours(Math.floor(snapped / 60), snapped % 60, 0, 0)
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

/**
 * Normalize a drag to a non-empty, start<end snapped selection. The START
 * rounds DOWN (snapFloor: 9:50 -> 9:30) and the END rounds UP (snapCeil:
 * 11:10 -> 11:30), so the selection covers every cell it touches. A degenerate
 * snapped range becomes one cell from the start.
 */
export function normalizeDrag(anchor: number, from: number, to: number, snapMinutes: number): { start: number; end: number } {
  void anchor
  const minutes = effectiveSnap(snapMinutes)
  const lo = snapFloor(Math.min(from, to), minutes)
  const hi = snapCeil(Math.max(from, to), minutes)
  if (hi <= lo) return { start: lo, end: lo + minutes * 60_000 }
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

/**
 * Length in minutes of a visible day window, honoring cross-midnight ranges.
 * start/end are minutes of day. If start < end it is a same-day span; if
 * start > end it wraps past midnight (e.g. 11:00 -> 02:00 is 15 hours). Equal
 * or degenerate values fall back to the full 24h so nothing is ever 0-length.
 */
export function dayWindowLength(start: number, end: number): number {
  const len = (((end - start) % 1440) + 1440) % 1440
  return len === 0 ? 1440 : len
}

/**
 * Position (0..1) of a ms timestamp within a day window, clamping times that
 * fall in the hidden gap back onto the nearest edge. start may wrap past
 * midnight (start > end is allowed, see {@link dayWindowLength}).
 */
export function dayWindowFraction(start: number, end: number, ms: number): number {
  const length = dayWindowLength(start, end)
  const raw = (((minutesOfDay(ms) - start) % 1440) + 1440) % 1440
  if (raw >= length) {
    // raw sits in the hidden gap right after the window tail. Clamp to the
    // nearer edge: fraction 1 (window end) or fraction 0 (next window start).
    const dEnd = raw - length
    const dStart = 1440 - raw
    return dEnd <= dStart ? 1 : 0
  }
  return raw / length
}

/** Whether a ms timestamp lies inside the day window (see dayWindowLength). */
export function inDayWindow(start: number, end: number, ms: number): boolean {
  const length = dayWindowLength(start, end)
  const raw = (((minutesOfDay(ms) - start) % 1440) + 1440) % 1440
  return raw < length
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
