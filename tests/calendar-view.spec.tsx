// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { CalenderClientController, initialState } from '../src/client/controller.ts'
import { MemoryCalenderHostTransport } from '../src/client/host-api.ts'
import { CalendarView } from '../src/client/components/CalendarView.tsx'
import type { CalenderAction, CalenderSnapshot } from '../src/protocol.ts'

function makeTransport() {
  let snap: CalenderSnapshot = { schemaVersion: 1, revision: 0, tasks: [], scheduler: { timeZone: 'Asia/Shanghai' } }
  const transport = new MemoryCalenderHostTransport(snap, (a: CalenderAction): CalenderSnapshot => snap)
  return transport
}

describe('CalendarView render', () => {
  it('transitions from loading to ready once the controller loads', async () => {
    const controller = new CalenderClientController(makeTransport(), initialState(0, 0))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<CalendarView controller={controller} />) })

    // Before start(): must show the loading line.
    expect(host.textContent).toContain('加载中')

    // Now start() resolves async and publishes a ready snapshot.
    await act(async () => { await controller.start() })

    // Loading must be gone; the week grid must render.
    expect(host.textContent ?? '').not.toContain('加载中')
    expect(host.querySelector('[data-dsh-calender-week]')).not.toBeNull()

    await act(async () => { root.unmount(); host.remove() })
  })
})
