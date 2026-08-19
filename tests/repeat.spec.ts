import { describe, expect, it } from 'vitest'
import {
  REPEAT_HORIZON_DAYS, buildRepeatCopy, isHoliday, isValidRepeat, matchesRepeat,
  nextRepeatDate, repeatDatesBetween,
} from '../src/core/repeat.ts'
import type { RepeatRule, TaskRecord } from '../src/core/tasks.ts'

/** Local date-start ms for y/m/d (hour/min optional). */
function at(y: number, m: number, d: number, h = 0, min = 0): number {
  return new Date(y, m - 1, d, h, min).getTime()
}

function mkTask(p: Partial<TaskRecord> & { id: string }): TaskRecord {
  return { title: 'T', description: '', prompt: '', startAt: 0, endAt: 1000, urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [], createdAt: 0, updatedAt: 0, ...p } as TaskRecord
}

describe('repeat rule validation', () => {
  it('accepts daily and weekly-with-weekdays, rejects weekly without weekdays', () => {
    expect(isValidRepeat({ kind: 'daily' })).toBe(true)
    expect(isValidRepeat({ kind: 'weekly', weekdays: [1, 3] })).toBe(true)
    expect(isValidRepeat({ kind: 'weekly' })).toBe(false)
    expect(isValidRepeat({ kind: 'weekly', weekdays: [] })).toBe(false)
  })
})

describe('holiday calendar', () => {
  it('treats weekends and curated public holidays as holidays', () => {
    expect(isHoliday(at(2025, 1, 11))).toBe(true) // Saturday
    expect(isHoliday(at(2025, 1, 12))).toBe(true) // Sunday
    expect(isHoliday(at(2025, 10, 1))).toBe(true) // 国庆 (Wednesday)
    expect(isHoliday(at(2025, 1, 6))).toBe(false) // Monday, not a holiday
  })
})

describe('matchesRepeat', () => {
  it('daily matches every day; skipHolidays skips weekends + holidays', () => {
    const daily: RepeatRule = { kind: 'daily' }
    expect(matchesRepeat(daily, at(2025, 1, 6))).toBe(true)
    expect(matchesRepeat(daily, at(2025, 1, 11))).toBe(true) // Sat still matches without skip
    const workdays: RepeatRule = { kind: 'daily', skipHolidays: true }
    expect(matchesRepeat(workdays, at(2025, 1, 11))).toBe(false) // Sat skipped
    expect(matchesRepeat(workdays, at(2025, 10, 1))).toBe(false) // 国庆 skipped
    expect(matchesRepeat(workdays, at(2025, 1, 6))).toBe(true) // Mon kept
  })

  it('weekly matches chosen JS weekdays only', () => {
    const mwf: RepeatRule = { kind: 'weekly', weekdays: [1, 3, 5] } // Mon Wed Fri
    expect(matchesRepeat(mwf, at(2025, 1, 6))).toBe(true) // Monday
    expect(matchesRepeat(mwf, at(2025, 1, 8))).toBe(true) // Wednesday
    expect(matchesRepeat(mwf, at(2025, 1, 7))).toBe(false) // Tuesday
    expect(matchesRepeat(mwf, at(2025, 1, 11))).toBe(false) // Saturday
  })

  it('weekly + skipHolidays skips a holiday landing on a chosen weekday', () => {
    const wed: RepeatRule = { kind: 'weekly', weekdays: [3], skipHolidays: true } // Wed
    expect(matchesRepeat(wed, at(2025, 1, 8))).toBe(true) // normal Wed
    expect(matchesRepeat(wed, at(2025, 10, 1))).toBe(false) // Wed but 国庆
  })
})

describe('repeatDatesBetween / nextRepeatDate', () => {
  it('enumerates daily dates inclusive on both ends', () => {
    const dates = repeatDatesBetween({ kind: 'daily' }, at(2025, 1, 6), at(2025, 1, 12))
    expect(dates).toHaveLength(7)
    expect(dates[0]).toBe(at(2025, 1, 6))
    expect(dates[6]).toBe(at(2025, 1, 12))
  })

  it('enumerates weekly dates and skips weekends when asked', () => {
    const mondays = repeatDatesBetween({ kind: 'weekly', weekdays: [1] }, at(2025, 1, 6), at(2025, 1, 19))
    expect(mondays).toEqual([at(2025, 1, 6), at(2025, 1, 13)])
    const workdays = repeatDatesBetween({ kind: 'daily', skipHolidays: true }, at(2025, 1, 10), at(2025, 1, 14))
    // Fri(10) Mon(13) Tue(14); Sat 11 / Sun 12 skipped
    expect(workdays).toEqual([at(2025, 1, 10), at(2025, 1, 13), at(2025, 1, 14)])
  })

  it('computes the next matching date strictly after fromMs', () => {
    expect(nextRepeatDate({ kind: 'weekly', weekdays: [1] }, at(2025, 1, 6, 9))).toBe(at(2025, 1, 13))
    expect(nextRepeatDate({ kind: 'daily' }, at(2025, 1, 6, 23))).toBe(at(2025, 1, 7))
  })
})

describe('buildRepeatCopy', () => {
  it('keeps time-of-day + duration, clears schedule, links the origin', () => {
    const template = mkTask({
      id: 'tpl',
      title: 'Standup',
      description: 'd',
      prompt: 'p',
      startAt: at(2025, 1, 6, 9, 0),
      endAt: at(2025, 1, 6, 10, 30),
      allDay: false,
      urgency: 'high',
      importance: 'medium',
      subtasks: [{ id: 's1', title: 'sub', done: false }],
      workspaceId: 'w1',
      provider: 'p1',
      model: 'm1',
      mode: 'standard',
      permission: 'read-only',
    })
    const copy = buildRepeatCopy(template, at(2025, 1, 7), 1000, 'copy-1')
    expect(copy.id).toBe('copy-1')
    expect(copy.title).toBe('Standup')
    expect(copy.startAt).toBe(at(2025, 1, 7, 9, 0))
    expect(copy.endAt).toBe(at(2025, 1, 7, 10, 30))
    expect(copy.originTaskId).toBe('tpl')
    expect(copy.schedule).toBeUndefined()
    expect(copy.done).toBe(false)
    expect(copy.executions).toEqual([])
    expect(copy.workspaceId).toBe('w1')
    expect(copy.provider).toBe('p1')
    expect(copy.mode).toBe('standard')
    expect(copy.permission).toBe('read-only')
  })
})

describe('REPEAT_HORIZON_DAYS', () => {
  it('is a sane rolling horizon', () => {
    expect(REPEAT_HORIZON_DAYS).toBeGreaterThan(0)
  })
})
