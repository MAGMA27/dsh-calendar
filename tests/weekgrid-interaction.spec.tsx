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
const G = globalThis as unknown as { PointerEvent?: typeof Event }
if (typeof G.PointerEvent === 'undefined') {
  class MiniPointerEvent extends MouseEvent {
    declare readonly pointerId: number
    constructor(type: string, init: MouseEventInit & { pointerId?: number }) {
      super(type, init)
      this.pointerId = init.pointerId ?? 1
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

    const PE = G.PointerEvent as unknown as typeof MouseEvent
    const down = new PE('pointerdown', { bubbles: true, clientY: 10, clientX: 10, pointerId: 1 } as MouseEventInit)
    const up = new PE('pointerup', { bubbles: true, clientY: 10, clientX: 10, pointerId: 1 } as MouseEventInit)
    await act(async () => { block.dispatchEvent(down) })
    await act(async () => { block.dispatchEvent(up) })
    await act(async () => {
      block.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })

    expect(controller.getSnapshot().selectedTaskId).toBe('t1')
    expect(dispatched.some(a => a.kind === 'update')).toBe(false)

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('WeekGrid day window', () => {
  it('maps positions within the visible window and hides off-window hours', async () => {
    const now = new Date(2026, 0, 12, 10, 0, 0) // a Monday 10:00
    const task: TaskRecord = {
      id: 't1', title: 'Standup', description: '', prompt: '',
      startAt: now.getTime(), endAt: now.getTime() + 30 * 60_000,
      urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [],
      createdAt: 0, updatedAt: 0,
    }
    const transport = new MemoryCalenderHostTransport(snapWith(task), undefined)
    const controller = new CalenderClientController(transport, initialState(now.getTime(), 0))
    // Show only 08:00-12:00; 10:00 sits exactly in the middle.
    controller.setDayWindow({ start: 480, end: 720 })
    await controller.start()

    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })

    const block = host.querySelector('[data-dsh-calender-block]') as HTMLElement
    expect(block).toBeTruthy()
    // 10:00 maps to (600-480)/(720-480) = 0.5, so the block sits at 50%.
    expect(block.style.top).toBe('50%')

    // Only hours 8-11 are labelled; 00:00..07:00 and 12:00..23:00 are hidden.
    const labels = [...host.querySelectorAll('[class*=weekGutterLabel]')].map(el => el.textContent)
    expect(labels).toEqual(['08:00', '09:00', '10:00', '11:00'])

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('WeekGrid header', () => {
  it('renders a weekday/date header row and assigns overlap columns', async () => {
    const now = new Date(2026, 0, 12, 10, 0, 0) // a Monday
    const a: TaskRecord = { id: 'a', title: 'A', description: '', prompt: '', startAt: now.getTime(), endAt: now.getTime() + 60 * 60_000, urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [], createdAt: 0, updatedAt: 0 }
    const b: TaskRecord = { id: 'b', title: 'B', description: '', prompt: '', startAt: now.getTime() + 10 * 60_000, endAt: now.getTime() + 50 * 60_000, urgency: 'low', importance: 'high', done: false, subtasks: [], executions: [], createdAt: 0, updatedAt: 0 }
    const snap2: CalenderSnapshot = { schemaVersion: 1, revision: 2, tasks: [a, b], scheduler: { timeZone: 'Asia/Shanghai' } }
    const c2 = new CalenderClientController(new MemoryCalenderHostTransport(snap2, undefined), initialState(now.getTime(), 0))
    await c2.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={c2} />) })

    const header = host.querySelector('[data-dsh-calender-week-header]')
    expect(header).toBeTruthy()
    expect(header!.querySelectorAll('[class*=weekHeaderCell]').length).toBe(7)

    const blocks = [...host.querySelectorAll('[data-dsh-calender-block]')] as HTMLElement[]
    expect(blocks.length).toBe(2)
    const lefts = blocks.map(b => b.style.left)
    expect(lefts[0]).not.toBe(lefts[1])

    await act(async () => { root.unmount(); host.remove() })
  })
})
