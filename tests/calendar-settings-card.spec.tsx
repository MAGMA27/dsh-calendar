// @vitest-environment jsdom
import { act } from 'react-dom/test-utils'
import { createRoot } from 'react-dom/client'
import { describe, expect, it } from 'vitest'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-runtime/client'
import { CalendarSettingsCard, type CalendarSettingsValue } from '../src/client/components/CalendarSettingsCard.tsx'

interface Write {
  field: string
  value: unknown
}

function makeScope(initialDepth = 0): { scope: SettingsScope<CalendarSettingsValue>; writes: Write[] } {
  let current: SettingsScopeSnapshot<CalendarSettingsValue> = {
    status: 'ready',
    value: { maxScheduledDepth: initialDepth },
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
  }
  const listeners = new Set<() => void>()
  const writes: Write[] = []
  const scope: SettingsScope<CalendarSettingsValue> = {
    getSnapshot: () => current,
    subscribe: listener => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    set: async (field, value) => {
      writes.push({ field, value })
      if (field !== 'maxScheduledDepth' || typeof value !== 'number') throw new Error('unexpected write')
      current = { ...current, value: { maxScheduledDepth: value }, revision: (current.revision ?? 0) + 1 }
      for (const listener of listeners) listener()
    },
    unset: async field => {
      throw new Error(`unexpected clear: ${field}`)
    },
  }
  return { scope, writes }
}

describe('CalendarSettingsCard', () => {
  it('renders in the plugin settings slot and persists the recursion depth', async () => {
    const { scope, writes } = makeScope()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    await act(async () => { root.render(<CalendarSettingsCard settingsScope={scope} />) })
    expect(host.textContent).toContain('日历')
    expect(host.textContent).not.toContain('最大递归深度')
    const header = host.querySelector('button[aria-expanded="false"]') as HTMLButtonElement
    expect(header).toBeTruthy()
    expect(host.querySelector('svg[width="14"][height="14"]')).toBeTruthy()

    await act(async () => { header.click() })
    expect(host.textContent).toContain('最大递归深度')

    const input = host.querySelector('input[type="number"]') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
    if (setter === undefined) throw new Error('input value setter unavailable')
    await act(async () => {
      setter.call(input, '2')
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })

    const save = [...host.querySelectorAll('button')].find(button => button.textContent === '保存')
    expect(save).toBeTruthy()
    await act(async () => { save?.click() })

    expect(writes).toEqual([{ field: 'maxScheduledDepth', value: 2 }])
    expect(host.textContent).toContain('已保存')

    await act(async () => { root.unmount(); host.remove() })
  })
})
