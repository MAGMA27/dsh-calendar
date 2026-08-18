// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { CalenderClientController, initialState } from '../src/client/controller.ts'
import { MemoryCalenderHostTransport } from '../src/client/host-api.ts'
import { WeekGrid } from '../src/client/components/WeekGrid.tsx'
import type { CalenderAction, CalenderSnapshot } from '../src/protocol.ts'
import type { TaskRecord } from '../src/core/tasks.ts'

// jsdom has no PointerEvent; a minimal polyfill backed by MouseEvent.
const G = globalThis as { PointerEvent?: typeof Event }
if (typeof G.PointerEvent === 'undefined') {
  class MiniPointerEvent extends MouseEvent {
    declare readonly pointerId: number
    constructor(type: string, init: MouseEventInit & { pointerId?: number }, pointerId = 1) {
      super(type, init)
      this.pointerId = init.pointerId ?? pointerId
    }
  }
  G.PointerEvent = MiniPointerEvent as unknown as typeof Event
}

function snapWith(task: TaskRecord): CalenderSnapshot {
  return { schemaVersion: 1, revision: 1, tasks: [task], scheduler: { timeZone: 'Asia/Shanghai' } }
}

describe('WeekGrid interaction', () => {
  it('a plain click on a block selects it without dispatching an update', async () => {
    const now = new Date(2026, 0, 12, 10, 0, 0) // a Monday
    const task: TaskRecord = {
      id: 't1', title: 'Standup', description: '', prompt: '',
      startAt: now.getTime(), endAt: now.getTime() + 30 * 60_000,
      urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [],
      createdAt: 0, updatedAt: 0,
    }
    const dispatched: CalenderAction[] = []
    const transport = new MemoryCalenderHostTransport(snapWith(task), (a) => { dispatched.push(a); return snapWith(task) })
    const controller = new CalenderClientController(transport, initialState(now.getTime(), 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })

    const block = host.querySelector('[data-dsh-calender-block]') as HTMLElement
    expect(block).toBeTruthy()

    await act(async () => {
      block.dispatchEvent(new G.PointerEvent!('pointerdown', { bubbles: true, clientY: 10, clientX: 10, pointerId: 1 }))
    })
    await act(async () => {
      block.dispatchEvent(new G.PointerEvent!('pointerup', { bubbles: true, clientY: 10, clientX: 10, pointerId: 1 }))
    })
    await act(async () => {
      block.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(controller.getSnapshot().selectedTaskId).toBe('t1')
    expect(dispatched.some(a => a.kind === 'update')).toBe(false)

    await act(async () => { root.unmount(); host.remove() })
  })
})
