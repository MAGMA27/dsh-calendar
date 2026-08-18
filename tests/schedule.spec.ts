import { describe, expect, it } from 'vitest'
import { isValidCron, nextRunAtMs, parseCron } from '../src/core/schedule.ts'

describe('parseCron', () => {
  it('accepts a standard 5-field expression', () => {
    const s = parseCron('0 9 * * *')
    expect(s).not.toBeNull()
    expect(s?.minutes.has(0)).toBe(true)
    expect(s?.hours.has(9)).toBe(true)
  })
  it('supports steps, ranges, and comma lists', () => {
    expect(parseCron('*/10 * * * *')).not.toBeNull()
    expect(parseCron('0 9-17 * * 1-5')).not.toBeNull()
    expect(parseCron('0,15,30,45 * * * *')).not.toBeNull()
  })
  it('normalizes weekday 7 to 0 (Sunday)', () => {
    const s = parseCron('0 9 * * 7')
    expect(s?.weekdays.has(0)).toBe(true)
  })
  it('rejects wrong arity and out-of-range fields', () => {
    expect(parseCron('0 9 * *')).toBeNull()
    expect(parseCron('0 24 * * *')).toBeNull()
    expect(parseCron('61 * * * *')).toBeNull()
    expect(parseCron('not a cron')).toBeNull()
  })
})

describe('isValidCron', () => {
  it('validates', () => {
    expect(isValidCron('0 9 * * 1')).toBe(true)
    expect(isValidCron('bogus')).toBe(false)
  })
})

describe('nextRunAtMs', () => {
  it('computes the next daily 09:00 after a given instant', () => {
    const from = new Date(2024, 0, 15, 9, 0, 0).getTime() // Mon 09:00
    const next = nextRunAtMs('0 9 * * *', from)
    const d = new Date(next as number)
    expect(d.getHours()).toBe(9)
    expect(d.getDate()).toBe(16)
  })
  it('returns undefined when nothing matches within a year (Feb 30)', () => {
    expect(nextRunAtMs('0 0 30 2 *', Date.UTC(2024, 0, 1))).toBeUndefined()
  })
})
