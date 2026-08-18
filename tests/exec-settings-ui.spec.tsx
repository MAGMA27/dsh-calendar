// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ExecutionSettings, type ExecutionSettingsValue } from '../src/client/components/ExecutionSettings.tsx'
import type { ExecutionCatalog } from '../src/core/exec-catalog.ts'

const catalog: ExecutionCatalog = {
  workspaces: [{ id: 'w1', label: 'Proj A' }, { id: 'w2', label: 'Proj B' }],
  sessions: [{ id: 's1', label: 'a' }, { id: 's2', label: 'b' }, { id: 's3', label: 'c' }],
  projects: [
    { id: 'w1', label: 'Proj A', sessions: [{ id: 's1', label: 'a' }, { id: 's2', label: 'b' }] },
    { id: 'w2', label: 'Proj B', sessions: [{ id: 's3', label: 'c' }] },
  ],
  providers: [],
  modelsByProvider: {},
}

describe('ExecutionSettings grouped session select', () => {
  it('renders project groups as optgroups and an option per non-archived session', async () => {
    const emitted: Partial<ExecutionSettingsValue>[] = []
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ExecutionSettings value={{}} catalog={catalog} onChange={(p) => emitted.push(p)} />) })

    const groups = host.querySelectorAll('optgroup')
    expect(groups.length).toBe(2)
    expect((groups[0] as HTMLOptGroupElement).label).toBe('Proj A')
    const options = groups[0].querySelectorAll('option')
    expect(options.length).toBe(2)
    expect((options[0] as HTMLOptionElement).textContent).toBe('a')

    await act(async () => { root.unmount(); host.remove() })
  })

  it('filters sessions to the chosen workspace (cascade)', async () => {
    const emitted: Partial<ExecutionSettingsValue>[] = []
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ExecutionSettings value={{ workspaceId: 'w1' }} catalog={catalog} onChange={(p) => emitted.push(p)} />) })

    // Session select should now show only Proj A's optgroup.
    const groups = host.querySelectorAll('optgroup')
    expect(groups.length).toBe(1)
    expect((groups[0] as HTMLOptGroupElement).label).toBe('Proj A')
    const options = groups[0].querySelectorAll('option').length
    expect(options).toBe(2)

    // Picking a different workspace clears the previously selected session.
    const wsSel = host.querySelectorAll('select')[0] as HTMLSelectElement
    await act(async () => {
      wsSel.value = 'w2'
      wsSel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(emitted.some(p => p.workspaceId === 'w2')).toBe(true)
    expect(emitted.some(p => p.sessionId === undefined && p.workspaceId === 'w2')).toBe(true)

    await act(async () => { root.unmount(); host.remove() })
  })
})
