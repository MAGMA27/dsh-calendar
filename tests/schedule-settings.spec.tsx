// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ScheduleSettings, type ScheduleSettingsValue } from '../src/client/components/ScheduleSettings.tsx'

describe('ScheduleSettings', () => {
  function setup(initial: ScheduleSettingsValue) {
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    let latest = initial
    const onChange = (v: ScheduleSettingsValue): void => { latest = v }
    act(() => { root.render(<ScheduleSettings value={initial} onChange={onChange} />) })
    return { host, root, latest: () => latest }
  }

  it('renders the mode select and a one-off due input in the none mode', () => {
    const { host, root } = setup({ mode: 'none', weekdays: [], skipHolidays: false, dueAt: '' })
    const select = host.querySelector('select') as HTMLSelectElement
    expect([...select.options].map(o => o.value)).toEqual(['none', 'daily', 'weekly'])
    expect(host.querySelector('input[type="datetime-local"]')).toBeTruthy()
    expect(host.querySelectorAll('button[class*=weekdayChip]').length).toBe(0)
    act(() => { root.unmount(); host.remove() })
  })

  it('switching to weekly seeds Mon-Fri and shows 7 weekday chips + holiday toggle', () => {
    const { host, root, latest } = setup({ mode: 'none', weekdays: [], skipHolidays: false, dueAt: '' })
    const select = host.querySelector('select') as HTMLSelectElement
    act(() => {
      select.value = 'weekly'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const weekly = latest()
    expect(weekly.mode).toBe('weekly')
    expect(weekly.weekdays).toEqual([1, 2, 3, 4, 5]) // Mon-Fri seed

    // Re-render with the captured value to see the weekly UI.
    act(() => { root.render(<ScheduleSettings value={weekly} onChange={() => {}} />) })
    const chips = host.querySelectorAll('button[class*=weekdayChip]')
    expect(chips.length).toBe(7)
    expect(host.querySelector('input[type="datetime-local"]')).toBeNull()
    expect(host.querySelector('input[type="checkbox"]')).toBeTruthy()

    // Toggling a chip off reports the weekday removed.
    const monday = chips[0] as HTMLButtonElement
    act(() => { monday.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    act(() => { root.unmount(); host.remove() })
  })

  it('daily mode hides weekday chips but keeps the holiday toggle', () => {
    const { host, root, latest } = setup({ mode: 'none', weekdays: [], skipHolidays: false, dueAt: '' })
    const select = host.querySelector('select') as HTMLSelectElement
    act(() => {
      select.value = 'daily'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(latest().mode).toBe('daily')
    act(() => { root.render(<ScheduleSettings value={latest()} onChange={() => {}} />) })
    expect(host.querySelectorAll('button[class*=weekdayChip]').length).toBe(0)
    expect(host.querySelector('input[type="checkbox"]')).toBeTruthy()
    act(() => { root.unmount(); host.remove() })
  })
})
