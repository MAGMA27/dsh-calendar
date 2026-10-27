import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src', 'client', 'calendar.module.css'), 'utf8')

describe('center-column takeover CSS', () => {
  it('hides the conversation content while the calendar is active', () => {
    expect(css).toContain('[data-dsh-calendar-view]')
    expect(css).toContain('display: block')
  })
  it('scopes the hide rule to the calendar-active html attribute', () => {
    expect(css).toContain('data-dsh-calendar-active')
  })
  it('includes the sidebar entry classes', () => {
    expect(css).toContain('.entry')
    expect(css).toContain('.entryLabel')
  })
  it('positions the calendar below the host window chrome when present', () => {
    expect(css).toMatch(/\.calendarOverlay\s*\{[^}]*top:\s*var\(--dsh-frame-chrome-top,\s*0px\)/)
  })
})

describe('create task modal layout CSS', () => {
  it('keeps the header and detail sections from shrinking inside the scroll area', () => {
    expect(css).toMatch(/\.createModal\s*>\s*\.detailHeader\s*\{\s*flex-shrink:\s*0;/)
    expect(css).toMatch(/\.createModal\s*>\s*\.detailBody\s*>\s*\*\s*\{\s*flex-shrink:\s*0;/)
  })
})

describe('modal window clearance', () => {
  it('keeps dialogs below the host title bar and limits their height to the remaining viewport', () => {
    expect(css).toMatch(/\.modalOverlay\s*\{[^}]*inset:\s*var\(--dsh-frame-chrome-top,\s*0px\)\s+0\s+0/)
    for (const selector of ['modal', 'createModal']) {
      expect(css).toMatch(new RegExp(`\\.${selector}\\s*\\{[^}]*max-height:[^;]*var\\(--dsh-frame-chrome-top,\\s*0px\\)`))
    }
    expect(css).toMatch(/\.modal\s*\{[^}]*overflow:\s*auto/)
  })
})
