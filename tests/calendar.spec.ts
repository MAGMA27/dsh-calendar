import { describe, expect, it } from 'vitest'
import {
  addDays, addMonths, alignCreateStart, dayFraction, dayKey, dayWindowFraction, dayWindowLength, hhmm, inDayWindow,
  layoutDayTasks, minutesOfDay, monthLabel, normalizeDrag, sameDay, sameMonth,
  snapCeil, snapFloor, snapNearest, startOfMonth, startOfWeek, weekDays, weekRangeLabel,
} from '../src/core/calendar.ts'

// 2024-01-15 is a Monday in local time.
const MON_1200 = new Date(2024, 0, 15, 12, 0, 0, 0).getTime()

describe('week grid', () => {
  it('weekDays(startMonday) returns 7 cells starting Monday', () => {
    const days = weekDays(MON_1200, 0)
    expect(days.length).toBe(7)
    expect(new Date(days[0].dateMs).getDay()).toBe(1) // Monday
    expect(days[0].weekday).toBe(1)
    expect(days[6].weekday).toBe(0) // Sunday
  })
  it('startOfWeek honors weekStart 0 (Mon) vs 1 (Sun)', () => {
    const monMidnight = new Date(2024, 0, 15, 0, 0, 0, 0).getTime()
    expect(startOfWeek(MON_1200, 0)).toBe(monMidnight) // Monday 00:00
    const sunday = startOfWeek(MON_1200, 1)
    expect(new Date(sunday).getDay()).toBe(0)
  })
  it('dayKey is YYYY-MM-DD', () => {
    expect(dayKey(MON_1200)).toBe('2024-01-15')
  })
  it('sameDay compares calendar day', () => {
    expect(sameDay(new Date(2024, 0, 15, 1, 0).getTime(), new Date(2024, 0, 15, 23, 0).getTime())).toBe(true)
    expect(sameDay(MON_1200, new Date(2024, 0, 16, 12, 0).getTime())).toBe(false)
  })
  it('startOfMonth returns the 1st at 00:00', () => {
    expect(dayKey(startOfMonth(MON_1200))).toBe('2024-01-01')
  })
})

describe('snap', () => {
  it('snapFloor/ceil to 30-minute cells', () => {
    const t = new Date(2024, 0, 15, 10, 42).getTime()
    expect(minutesOfDay(snapFloor(t, 30))).toBe(10 * 60 + 30)
    expect(minutesOfDay(snapCeil(t, 30))).toBe(11 * 60)
  })
  it('snapNearest rounds to the nearest boundary', () => {
    expect(minutesOfDay(snapNearest(new Date(2024, 0, 15, 9, 50).getTime(), 30))).toBe(10 * 60)
    expect(minutesOfDay(snapNearest(new Date(2024, 0, 15, 9, 10).getTime(), 30))).toBe(9 * 60)
    expect(minutesOfDay(snapNearest(new Date(2024, 0, 15, 10, 29).getTime(), 30))).toBe(10 * 60 + 30)
  })
  it('clamps snap interval to [1,60]', () => {
    const t = new Date(2024, 0, 15, 10, 5).getTime()
    expect(minutesOfDay(snapFloor(t, 0))).toBe(10 * 60)
  })
})

describe('drag selection', () => {
  it('normalizes a reversed drag to start<end on the snap grid (floor)', () => {
    const anchor = MON_1200
    const from = new Date(2024, 0, 15, 11, 10).getTime()
    const to = new Date(2024, 0, 15, 9, 50).getTime()
    const { start, end } = normalizeDrag(anchor, from, to, 30)
    expect(start).toBeLessThan(end)
    expect(minutesOfDay(start)).toBe(9 * 60 + 30)
    expect(minutesOfDay(end)).toBe(11 * 60)
  })
  it('a zero-length selection gets one snap cell', () => {
    const t = new Date(2024, 0, 15, 9, 20).getTime()
    const { start, end } = normalizeDrag(t, t, t, 30)
    expect(end - start).toBe(30 * 60_000)
  })
  it('rounds the START DOWN (floor): 9:50 -> 9:30, 10:20 -> 10:00', () => {
    const a = normalizeDrag(0, new Date(2024, 0, 15, 9, 50).getTime(), new Date(2024, 0, 15, 11, 0).getTime(), 30)
    expect(minutesOfDay(a.start)).toBe(9 * 60 + 30)
    const b = normalizeDrag(0, new Date(2024, 0, 15, 10, 20).getTime(), new Date(2024, 0, 15, 12, 0).getTime(), 30)
    expect(minutesOfDay(b.start)).toBe(10 * 60)
  })
  it('a sub-cell drag still yields a valid one-cell span', () => {
    const from = new Date(2024, 0, 15, 9, 50).getTime()
    const to = new Date(2024, 0, 15, 10, 5).getTime()
    const { start, end } = normalizeDrag(0, from, to, 30)
    expect(end - start).toBe(30 * 60_000)
    expect(minutesOfDay(start)).toBe(9 * 60 + 30)
  })
})

describe('alignCreateStart', () => {
  const d = (h: number, m = 0) => new Date(2024, 0, 15, h, m).getTime()
  it('leaves a start that does not fall inside a block unchanged', () => {
    const blocked = [{ start: d(9, 0), end: d(9, 50) }] // ends off-grid
    const r = alignCreateStart(d(10, 0), d(11, 0), blocked)
    expect(r.start).toBe(d(10, 0))
  })
  it('pushes a start that snapping pulled back inside a block to its end', () => {
    const blocked = [{ start: d(9, 0), end: d(9, 50) }]
    const r = alignCreateStart(d(9, 30), d(10, 30), blocked) // snapped inside 9:00–9:50
    expect(r.start).toBe(d(9, 50)) // sits exactly at the previous task's edge
    expect(r.end).toBe(d(10, 30))
  })
  it('walks past consecutive blocks', () => {
    const blocked = [{ start: d(9, 0), end: d(9, 40) }, { start: d(9, 40), end: d(10, 20) }]
    const r = alignCreateStart(d(9, 30), d(11, 0), blocked)
    expect(r.start).toBe(d(10, 20))
  })
  it('does not move the end (free-form overlap through the tail is allowed)', () => {
    const blocked = [{ start: d(9, 0), end: d(10, 0) }]
    const r = alignCreateStart(d(10, 0), d(10, 30), blocked)
    expect(r.start).toBe(d(10, 0))
    expect(r.end).toBe(d(10, 30))
  })
})

describe('time rendering', () => {
  it('hhmm renders HH:MM', () => {
    expect(hhmm(new Date(2024, 0, 15, 9, 5).getTime())).toBe('09:05')
  })
  it('dayFraction maps minute-of-day to [0,1]', () => {
    expect(dayFraction(new Date(2024, 0, 15, 12, 0).getTime())).toBeCloseTo(0.5)
  })
})


describe('day window', () => {
  const ms = (h: number, m = 0) => new Date(2024, 0, 15, h, m, 0, 0).getTime()

  it('length: a same-day span is end - start', () => {
    expect(dayWindowLength(8 * 60, 12 * 60)).toBe(4 * 60)
  })
  it('length: a cross-midnight span wraps (11:00 -> 02:00 is 15h)', () => {
    expect(dayWindowLength(11 * 60, 2 * 60)).toBe(15 * 60)
  })
  it('length: full day and degenerate ranges fall back to 1440', () => {
    expect(dayWindowLength(0, 1440)).toBe(1440)
    expect(dayWindowLength(600, 600)).toBe(1440)
  })
  it('fraction: same-day 10:00 is the middle of 08:00-12:00', () => {
    expect(dayWindowFraction(8 * 60, 12 * 60, ms(10))).toBeCloseTo(0.5)
  })
  it('fraction: cross-midnight 00:30 is the middle of 23:00-02:00', () => {
    expect(dayWindowFraction(23 * 60, 2 * 60, ms(0, 30))).toBeCloseTo(0.5)
  })
  it('fraction: hidden times clamp onto the nearest window edge', () => {
    // 13:00 sits just after 08:00-12:00 -> clamps to the bottom (1).
    expect(dayWindowFraction(8 * 60, 12 * 60, ms(13))).toBe(1)
    // 06:00 sits just before it -> clamps to the top (0).
    expect(dayWindowFraction(8 * 60, 12 * 60, ms(6))).toBe(0)
  })
  it('inDayWindow honors membership, wrapping past midnight', () => {
    expect(inDayWindow(8 * 60, 12 * 60, ms(10))).toBe(true)
    expect(inDayWindow(8 * 60, 12 * 60, ms(13))).toBe(false)
    expect(inDayWindow(23 * 60, 2 * 60, ms(1))).toBe(true)
    expect(inDayWindow(23 * 60, 2 * 60, ms(5))).toBe(false)
  })
})


describe('layoutDayTasks', () => {
  it('gives non-overlapping tasks the same single column', () => {
    const layout = layoutDayTasks([
      { id: 'a', startAt: 1000, endAt: 2000 },
      { id: 'b', startAt: 3000, endAt: 4000 },
    ])
    expect(layout.map(l => l.columnCount)).toEqual([1, 1])
    expect(layout.map(l => l.column)).toEqual([0, 0])
  })

  it('splits overlapping tasks into side-by-side columns', () => {
    const layout = layoutDayTasks([
      { id: 'a', startAt: 1000, endAt: 4000 },
      { id: 'b', startAt: 1500, endAt: 3000 },
      { id: 'c', startAt: 2000, endAt: 5000 },
    ])
    // All three mutually overlap, so they fan into 3 columns.
    expect(layout.length).toBe(3)
    expect(layout.find(l => l.id === 'a')!.columnCount).toBe(3)
    // a and c overlap b, so they never share b's column.
    expect(layout.find(l => l.id === 'b')!.column).not.toBe(layout.find(l => l.id === 'a')!.column)
  })

  it('reuses a column once its earlier occupant has ended', () => {
    const layout = layoutDayTasks([
      { id: 'a', startAt: 1000, endAt: 2000 },
      { id: 'b', startAt: 1000, endAt: 3000 },
      { id: 'c', startAt: 2100, endAt: 2600 },
    ])
    // a and c can share a column (a ended before c starts).
    expect(layout.find(l => l.id === 'a')!.column).toBe(layout.find(l => l.id === 'c')!.column)
    expect(layout.find(l => l.id === 'b')!.column).not.toBe(layout.find(l => l.id === 'a')!.column)
  })

  it('preserves columnCount consistent for all blocks', () => {
    const tasks = [
      { id: 'a', startAt: 1000, endAt: 6000 },
      { id: 'b', startAt: 1500, endAt: 2000 },
      { id: 'c', startAt: 2500, endAt: 3000 },
      { id: 'd', startAt: 3500, endAt: 4000 },
    ]
    const layout = layoutDayTasks(tasks)
    const counts = new Set(layout.map(l => l.columnCount))
    expect(counts.size).toBe(1)
  })
})

describe('date navigation', () => {
  it('addDays moves across day boundaries including month/year edges', () => {
    const jan30 = new Date(2024, 0, 30, 12).getTime()
    expect(dayKey(addDays(jan30, 1))).toBe('2024-01-31')
    expect(dayKey(addDays(jan30, 2))).toBe('2024-02-01')
    // 2024 is a leap year (366 days), so +365 lands on Jan 29 of 2025.
    expect(dayKey(addDays(jan30, 365))).toBe('2025-01-29')
    expect(dayKey(addDays(jan30, 366))).toBe('2025-01-30')
    expect(dayKey(addDays(jan30, -1))).toBe('2024-01-29')
  })

  it('addMonths clamps the day to the target month length', () => {
    const jan31 = new Date(2024, 0, 31, 12).getTime()
    // Feb 2024 has 29 days → clamps to the 29th.
    expect(dayKey(addMonths(jan31, 1))).toBe('2024-02-29')
    // Jan 31 + 12 months → next Jan 31.
    expect(dayKey(addMonths(jan31, 12))).toBe('2025-01-31')
  })

  it('addMonths crosses the year boundary', () => {
    const dec15 = new Date(2024, 11, 15, 12).getTime()
    expect(dayKey(addMonths(dec15, 1))).toBe('2025-01-15')
    expect(dayKey(addMonths(dec15, -1))).toBe('2024-11-15')
  })

  it('sameMonth distinguishes calendar months', () => {
    const a = new Date(2024, 0, 31, 23).getTime()
    expect(sameMonth(a, new Date(2024, 0, 1).getTime())).toBe(true)
    expect(sameMonth(a, new Date(2024, 1, 1).getTime())).toBe(false)
    expect(sameMonth(a, new Date(2023, 0, 31).getTime())).toBe(false)
  })

  it('monthLabel formats the month', () => {
    const d = new Date(2024, 0, 15).getTime()
    expect(monthLabel(d, 'zh-CN')).toBe('2024年1月')
    expect(monthLabel(d, 'en-US')).toBe('January 2024')
  })

  it('weekRangeLabel shows the week range', () => {
    // 2024-01-15 is a Monday; weekStart 0 → 1月15日 – 1月21日.
    expect(weekRangeLabel(MON_1200, 0, 'zh-CN')).toBe('2024年1月15日 – 1月21日')
  })
})
