import { describe, expect, it } from 'vitest'
import {
  REPEAT_HORIZON_DAYS, alignSeries, buildRepeatCopy, isHoliday, isValidRepeat, matchesRepeat,
  nextRepeatDate, parseTriggerTime, pruneOrphanCopies, repeatDatesBetween,
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

  it('arms a one-shot due schedule on trigger-agent copies (block start default / triggerAt override)', () => {
    const template = mkTask({
      id: 'tpl', title: 'Standup', description: '', prompt: '', startAt: at(2025, 1, 6, 9, 0), endAt: at(2025, 1, 6, 10, 0),
      urgency: 'high', importance: 'high', scheduledDepth: 1,
      schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true } },
    })
    const copy = buildRepeatCopy(template, at(2025, 1, 7), 1000, 'c1')
    expect(copy.schedule?.enabled).toBe(true)
    expect(copy.schedule?.dueAt).toBe(at(2025, 1, 7, 9, 0)) // block start
    expect(copy.schedule?.nextRunAt).toBe(at(2025, 1, 7, 9, 0))
    expect(copy.schedule?.repeat).toBeUndefined()
    expect(copy.scheduledDepth).toBe(1)

    const withOverride = mkTask({
      id: 'tpl2', title: 'T', description: '', prompt: '', startAt: at(2025, 1, 6, 9, 0), endAt: at(2025, 1, 6, 10, 0),
      urgency: 'high', importance: 'high', schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true, triggerAt: '07:30' } },
    })
    const c2 = buildRepeatCopy(withOverride, at(2025, 1, 7), 1000, 'c2')
    expect(c2.schedule?.dueAt).toBe(at(2025, 1, 7, 7, 30))

    // A due instant already in the past never fires (no nextRunAt).
    const late = buildRepeatCopy(template, at(2025, 1, 7), at(2025, 1, 7, 12), 'c3')
    expect(late.schedule?.dueAt).toBe(at(2025, 1, 7, 9, 0))
    expect(late.schedule?.nextRunAt).toBeUndefined()
  })
})

describe('parseTriggerTime', () => {
  it('parses HH:MM into minutes-of-day and rejects invalid values', () => {
    expect(parseTriggerTime('09:30')).toBe(570)
    expect(parseTriggerTime('23:59')).toBe(1439)
    expect(parseTriggerTime('7:05')).toBe(425)
    expect(parseTriggerTime(undefined)).toBeUndefined()
    expect(parseTriggerTime('')).toBeUndefined()
    expect(parseTriggerTime('25:00')).toBeUndefined()
    expect(parseTriggerTime('9:60')).toBeUndefined()
    expect(parseTriggerTime('abc')).toBeUndefined()
  })
})

describe('pruneOrphanCopies', () => {
  it('keeps copies of active-repeat templates and drops the rest', () => {
    const tpl = mkTask({ id: 'tpl', schedule: { enabled: true, repeat: { kind: 'daily' } } })
    const paused = mkTask({ id: 'paused', schedule: { enabled: false, repeat: { kind: 'daily' } } })
    const plain = mkTask({ id: 'plain' })
    const c1 = mkTask({ id: 'c1', originTaskId: 'tpl' })
    const c2 = mkTask({ id: 'c2', originTaskId: 'paused' }) // paused still counts as active rule
    const c3 = mkTask({ id: 'c3', originTaskId: 'ghost' }) // template gone
    const c4 = mkTask({ id: 'c4', originTaskId: 'plain' }) // plain task has no rule
    const out = pruneOrphanCopies([tpl, paused, plain, c1, c2, c3, c4])
    expect(out.map(t => t.id)).toEqual(['tpl', 'paused', 'plain', 'c1', 'c2'])
  })
})

describe('alignSeries', () => {
  it('prunes bound copies on dates the narrowed rule no longer matches and drops their materialized keys', () => {
    const tpl = mkTask({
      id: 'tpl',
      startAt: at(2025, 1, 6, 9),
      schedule: {
        enabled: true,
        repeat: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] }, // Mon..Fri (was all days)
        materialized: ['2025-01-07', '2025-01-08', '2025-01-10', '2025-01-11', '2025-01-12'],
      },
    })
    const tue = mkTask({ id: 'c-tue', originTaskId: 'tpl', startAt: at(2025, 1, 7, 9) })
    const wed = mkTask({ id: 'c-wed', originTaskId: 'tpl', startAt: at(2025, 1, 8, 9) })
    const fri = mkTask({ id: 'c-fri', originTaskId: 'tpl', startAt: at(2025, 1, 10, 9) })
    const sat = mkTask({ id: 'c-sat', originTaskId: 'tpl', startAt: at(2025, 1, 11, 9) })
    const sun = mkTask({ id: 'c-sun', originTaskId: 'tpl', startAt: at(2025, 1, 12, 9) })
    const other = mkTask({ id: 'other', originTaskId: 'x' }) // unrelated copy survives
    const { tasks, prunedIds } = alignSeries([tpl, tue, wed, fri, sat, sun, other], 'tpl', at(2025, 1, 20, 8))
    expect(prunedIds.sort()).toEqual(['c-sat', 'c-sun'])
    expect(tasks.map(t => t.id)).toEqual(['tpl', 'c-tue', 'c-wed', 'c-fri', 'other'])
    const aligned = tasks.find(t => t.id === 'tpl')!
    expect(aligned.schedule!.materialized).toEqual(['2025-01-07', '2025-01-08', '2025-01-10']) // Sat/Sun keys dropped
    expect(aligned.updatedAt).toBe(at(2025, 1, 20, 8))
  })

  it('prunes weekend copies when holiday-skip is toggled on', () => {
    const tpl = mkTask({
      id: 'tpl',
      startAt: at(2025, 1, 6, 9),
      schedule: { enabled: true, repeat: { kind: 'daily', skipHolidays: true }, materialized: ['2025-01-07', '2025-01-11'] },
    })
    const tue = mkTask({ id: 'c-tue', originTaskId: 'tpl', startAt: at(2025, 1, 7, 9) })
    const sat = mkTask({ id: 'c-sat', originTaskId: 'tpl', startAt: at(2025, 1, 11, 9) })
    const { tasks, prunedIds } = alignSeries([tpl, tue, sat], 'tpl', at(2025, 1, 20, 8))
    expect(prunedIds).toEqual(['c-sat'])
    expect(tasks.map(t => t.id)).toEqual(['tpl', 'c-tue'])
  })

  it('returns the same array reference when every copy still matches (idempotent)', () => {
    const tpl = mkTask({
      id: 'tpl',
      startAt: at(2025, 1, 6, 9),
      schedule: { enabled: true, repeat: { kind: 'weekly', weekdays: [1] }, materialized: ['2025-01-13'] },
    })
    const copy = mkTask({ id: 'c', originTaskId: 'tpl', startAt: at(2025, 1, 13, 9) })
    const tasks = [tpl, copy]
    const { tasks: out, prunedIds } = alignSeries(tasks, 'tpl', at(2025, 1, 20, 8))
    expect(prunedIds).toEqual([])
    expect(out).toBe(tasks)
  })

  it('prunes archived copies too (a series change owns every occurrence)', () => {
    const tpl = mkTask({
      id: 'tpl',
      startAt: at(2025, 1, 6, 9),
      schedule: { enabled: true, repeat: { kind: 'weekly', weekdays: [1] }, materialized: ['2025-01-11'] },
    })
    const archivedSat = mkTask({ id: 'c-arch', originTaskId: 'tpl', startAt: at(2025, 1, 11, 9), archivedAt: 1 })
    const { tasks, prunedIds } = alignSeries([tpl, archivedSat], 'tpl', at(2025, 1, 20, 8))
    expect(prunedIds).toEqual(['c-arch'])
    expect(tasks.map(t => t.id)).toEqual(['tpl'])
  })

  it('no-ops for a missing template or a template without a repeat rule', () => {
    const tpl = mkTask({ id: 'tpl', startAt: at(2025, 1, 6, 9) }) // plain task, no rule
    const copy = mkTask({ id: 'c', originTaskId: 'tpl', startAt: at(2025, 1, 7, 9) })
    const r1 = alignSeries([tpl, copy], 'tpl', 0)
    expect(r1.prunedIds).toEqual([])
    const r2 = alignSeries([copy], 'ghost', 0)
    expect(r2.prunedIds).toEqual([])
  })
})

describe('REPEAT_HORIZON_DAYS', () => {
  it('is a sane rolling horizon', () => {
    expect(REPEAT_HORIZON_DAYS).toBeGreaterThan(0)
  })
})
