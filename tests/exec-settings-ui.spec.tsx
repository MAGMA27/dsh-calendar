// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { ExecutionSettings, type ExecutionSettingsValue } from '../src/client/components/ExecutionSettings.tsx'
import type { ExecutionCatalog } from '../src/core/exec-catalog.ts'

describe('ExecutionSettings grouped session select', () => {
  it('renders project groups as optgroups and an option per non-archived session', async () => {
    const catalog: ExecutionCatalog = {
      workspaces: [{ id: 'w1', label: 'Proj A' }],
      sessions: [{ id: 's1', label: 'a' }],
      projects: [
        { id: 'w1', label: 'Proj A', sessions: [{ id: 's1', label: 'a' }, { id: 's2', label: 'b' }] },
      ],
      providers: [],
      modelsByProvider: {},
    }
    const emitted: Partial<ExecutionSettingsValue>[] = []
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ExecutionSettings value={{}} catalog={catalog} onChange={(p) => emitted.push(p)} />) })

    // Session select should contain an optgroup labelled 'Proj A' with s1/s2.
    const groups = host.querySelectorAll('optgroup')
    expect(groups.length).toBe(1)
    expect((groups[0] as HTMLOptGroupElement).label).toBe('Proj A')
    const options = groups[0].querySelectorAll('option')
    expect(options.length).toBe(2)
    expect((options[0] as HTMLOptionElement).textContent).toBe('a')

    // Selecting a session emits sessionId.
    const sel = host.querySelectorAll('select')[1] as HTMLSelectElement // 0=workspace,1=session,2=permission
    await act(async () => {
      sel.value = 's2'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(emitted.some(p => p.sessionId === 's2')).toBe(true)

    await act(async () => { root.unmount(); host.remove() })
  })
})
