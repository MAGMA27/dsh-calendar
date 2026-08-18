import { describe, expect, it } from 'vitest'
import {
  dayFraction, dayKey, hhmm, minutesOfDay, normalizeDrag, sameDay, snapCeil,
  snapFloor, startOfMonth, startOfWeek, weekDays,
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
  it('clamps snap interval to [1,60]', () => {
    const t = new Date(2024, 0, 15, 10, 5).getTime()
    expect(minutesOfDay(snapFloor(t, 0))).toBe(10 * 60)
  })
})

describe('drag selection', () => {
  it('normalizes a reversed drag to start<end on the snap grid', () => {
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
})

describe('time rendering', () => {
  it('hhmm renders HH:MM', () => {
    expect(hhmm(new Date(2024, 0, 15, 9, 5).getTime())).toBe('09:05')
  })
  it('dayFraction maps minute-of-day to [0,1]', () => {
    expect(dayFraction(new Date(2024, 0, 15, 12, 0).getTime())).toBeCloseTo(0.5)
  })
})
