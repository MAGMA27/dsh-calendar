import { describe, expect, it } from 'vitest'
import { claimApply, releaseApply } from '../src/client/apply-guard.ts'

describe('apply-guard', () => {
  it('first claim wins; later claims are no-ops until released', () => {
    expect(claimApply()).toBe(true)
    expect(claimApply()).toBe(false)
    releaseApply()
    expect(claimApply()).toBe(true)
    releaseApply()
  })
})
