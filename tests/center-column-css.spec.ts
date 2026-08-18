import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src', 'client', 'calender.module.css'), 'utf8')

describe('center-column takeover CSS', () => {
  it('hides the conversation content while the calendar is active', () => {
    expect(css).toContain('[data-dsh-calender-view]')
    expect(css).toContain('display: block')
  })
  it('scopes the hide rule to the calender-active html attribute', () => {
    expect(css).toContain('data-dsh-calender-active')
  })
  it('includes the sidebar entry classes', () => {
    expect(css).toContain('.entry')
    expect(css).toContain('.entryLabel')
  })
})
