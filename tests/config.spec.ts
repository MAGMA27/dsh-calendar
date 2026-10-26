import { describe, expect, it } from 'vitest'
import { Config } from '../src/index.ts'

describe('calendar plugin settings', () => {
  it('defaults nested scheduled-Agent creation to disabled', () => {
    expect(Config({})).toMatchObject({ announceToAgent: true, enabled: true })
    expect(Config({}).maxScheduledDepth.get()).toBe(0)
  })

  it('accepts a bounded integer recursion depth', () => {
    expect(Config({ maxScheduledDepth: 2 }).maxScheduledDepth.get()).toBe(2)
    expect(() => Config({ maxScheduledDepth: 4 })).toThrow()
    expect(() => Config({ maxScheduledDepth: 1.5 })).toThrow()
  })
})
