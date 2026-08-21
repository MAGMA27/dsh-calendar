// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { calendarClientController, initialState } from '../src/client/controller.ts'
import { MemorycalendarHostTransport } from '../src/client/host-api.ts'
import { WeekGrid } from '../src/client/components/WeekGrid.tsx'
import type { calendarAction, calendarSnapshot } from '../src/protocol.ts'
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

const HEADER = 40
const CELL_H = 24 * 48
const yAt = (h: number, m: number) => HEADER + ((h * 60 + m) / 1440) * CELL_H

function snapWith(task: TaskRecord): calendarSnapshot {
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
    const dispatched: calendarAction[] = []
    const transport = new MemorycalendarHostTransport(snapWith(task), (a) => { dispatched.push(a); return snapWith(task) })
    const controller = new calendarClientController(transport, initialState(now.getTime(), 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })

    const block = host.querySelector('[data-dsh-calendar-block]') as HTMLElement
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

  it('moves a task past midnight when dragged to the bottom edge', async () => {
    const start = new Date(2026, 0, 12, 22, 30).getTime()
    const task: TaskRecord = {
      id: 't1', title: 'Late task', description: '', prompt: '',
      startAt: start, endAt: start + 60 * 60_000,
      urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [],
      createdAt: 0, updatedAt: 0,
    }
    const dispatched: calendarAction[] = []
    const transport = new MemorycalendarHostTransport(snapWith(task), (a) => { dispatched.push(a); return snapWith(task) })
    const controller = new calendarClientController(transport, initialState(start, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })

    const cells = host.querySelector('[class*=weekGridCells]') as HTMLElement
    cells.getBoundingClientRect = () => ({ top: HEADER, height: CELL_H, bottom: HEADER + CELL_H, left: 0, right: 100, width: 100, x: 0, y: HEADER, toJSON: () => ({}) } as DOMRect)
    const block = host.querySelector('[data-dsh-calendar-block]') as HTMLElement
    const grid = host.querySelector('[data-dsh-calendar-week]') as HTMLElement
    const PE = G.PointerEvent as unknown as typeof MouseEvent
    await act(async () => { block.dispatchEvent(new PE('pointerdown', { bubbles: true, clientY: yAt(23, 0), clientX: 60, pointerId: 3 } as MouseEventInit)) })
    await act(async () => { grid.dispatchEvent(new PE('pointermove', { bubbles: true, clientY: yAt(24, 0), clientX: 60, pointerId: 3 } as MouseEventInit)) })
    await act(async () => { grid.dispatchEvent(new PE('pointerup', { bubbles: true, clientY: yAt(24, 0), clientX: 60, pointerId: 3 } as MouseEventInit)) })

    const reschedule = dispatched.find(a => a.kind === 'reschedule')
    expect(reschedule?.kind).toBe('reschedule')
    if (reschedule?.kind === 'reschedule') {
      expect(reschedule.startAt).toBe(new Date(2026, 0, 12, 23, 30).getTime())
      expect(reschedule.endAt).toBe(new Date(2026, 0, 13, 0, 30).getTime())
    }

    await act(async () => { root.unmount(); host.remove() })
  })

  it('renders the remaining cross-day segment at the top of the next day', async () => {
    const start = new Date(2026, 0, 12, 23, 30).getTime()
    const task: TaskRecord = {
      id: 't1', title: 'Night task', description: '', prompt: '',
      startAt: start, endAt: new Date(2026, 0, 13, 0, 30).getTime(),
      urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [],
      createdAt: 0, updatedAt: 0,
    }
    const controller = new calendarClientController(new MemorycalendarHostTransport(snapWith(task), undefined), initialState(start, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })

    const blocks = [...host.querySelectorAll('[data-dsh-calendar-block]')] as HTMLElement[]
    expect(blocks).toHaveLength(2)
    const tops = blocks.map(block => Number.parseFloat(block.style.top))
    expect(tops.some(top => top === 0)).toBe(true)
    expect(tops.some(top => top > 90)).toBe(true)

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('WeekGrid create-drag snapping', () => {
  function gridRect(top: number, height: number): DOMRect {
    return { top, height, bottom: top + height, left: 0, right: 100, width: 100, x: 0, y: top, toJSON: () => ({}) } as DOMRect
  }
  // Simulate the real layout: a sticky weekday/date header (40px) above the time
  // grid cells. Pointer→time mapping must use the CELLS rect, not the whole
  // weekGrid — using the latter used to shift every click ~30 min later.
  function stubGridRect(host: HTMLElement): HTMLElement {
    const cells = host.querySelector('[class*=weekGridCells]') as HTMLElement
    expect(cells).toBeTruthy()
    cells.getBoundingClientRect = () => gridRect(HEADER, CELL_H)
    return cells
  }

  it('floors the start, ceils the end at 15-minute granularity: click at 9:50, drag to 10:20 -> draft 9:45-10:30', async () => {
    const now = new Date(2026, 0, 12, 8, 0, 0) // a Monday
    const transport = new MemorycalendarHostTransport({ schemaVersion: 1, revision: 1, tasks: [], scheduler: { timeZone: 'Asia/Shanghai' } }, undefined)
    const controller = new calendarClientController(transport, initialState(now.getTime(), 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })

    stubGridRect(host)
    const overlay = host.querySelector('[class*=slotOverlay]') as HTMLElement
    expect(overlay).toBeTruthy()

    const PE = G.PointerEvent as unknown as typeof MouseEvent
    const down = new PE('pointerdown', { bubbles: true, clientY: yAt(9, 50), clientX: 30, pointerId: 1 } as MouseEventInit)
    const move = new PE('pointermove', { bubbles: true, clientY: yAt(10, 20), clientX: 30, pointerId: 1 } as MouseEventInit)
    const up = new PE('pointerup', { bubbles: true, clientY: yAt(10, 20), clientX: 30, pointerId: 1 } as MouseEventInit)
    await act(async () => { overlay.dispatchEvent(down) })
    await act(async () => { overlay.dispatchEvent(move) })
    await act(async () => { overlay.dispatchEvent(up) })

    const draft = controller.getSnapshot().draft
    expect(draft).toBeDefined()
    expect(new Date(draft!.start).getMinutes()).toBe(45)   // floor(9:50) -> 9:45
    expect(new Date(draft!.start).getHours()).toBe(9)
    expect(new Date(draft!.end).getMinutes()).toBe(30)     // ceil(10:20) -> 10:30
    expect(new Date(draft!.end).getHours()).toBe(10)

    await act(async () => { root.unmount(); host.remove() })
  })

  it('a plain click at 9:50 still floors to 9:45 (header offset excluded)', async () => {
    const now = new Date(2026, 0, 12, 8, 0, 0)
    const transport = new MemorycalendarHostTransport({ schemaVersion: 1, revision: 1, tasks: [], scheduler: { timeZone: 'Asia/Shanghai' } }, undefined)
    const controller = new calendarClientController(transport, initialState(now.getTime(), 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })

    stubGridRect(host)
    const overlay = host.querySelector('[class*=slotOverlay]') as HTMLElement
    const PE = G.PointerEvent as unknown as typeof MouseEvent
    await act(async () => { overlay.dispatchEvent(new PE('pointerdown', { bubbles: true, clientY: yAt(9, 50), clientX: 30, pointerId: 2 } as MouseEventInit)) })
    await act(async () => { overlay.dispatchEvent(new PE('pointerup', { bubbles: true, clientY: yAt(9, 50), clientX: 30, pointerId: 2 } as MouseEventInit)) })

    const draft = controller.getSnapshot().draft
    expect(draft).toBeDefined()
    expect(new Date(draft!.start).getHours()).toBe(9)
    expect(new Date(draft!.start).getMinutes()).toBe(45)

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
    const transport = new MemorycalendarHostTransport(snapWith(task), undefined)
    const controller = new calendarClientController(transport, initialState(now.getTime(), 0))
    // Show only 08:00-12:00; 10:00 sits exactly in the middle.
    controller.setDayWindow({ start: 480, end: 720 })
    await controller.start()

    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })

    const block = host.querySelector('[data-dsh-calendar-block]') as HTMLElement
    expect(block).toBeTruthy()
    // 10:00 maps to (600-480)/(720-480) = 0.5, so the block sits at 50%.
    expect(block.style.top).toBe('50%')

    // Only hours 8-11 are labelled; 00:00..07:00 and 12:00..23:00 are hidden.
    const labels = [...host.querySelectorAll('[class*=weekGutterLabel]')].map(el => el.textContent)
    expect(labels).toEqual(['08:00', '09:00', '10:00', '11:00'])

    await act(async () => { root.unmount(); host.remove() })
  })

  it('wraps a cross-midnight window (23:00 to next-day 02:00)', async () => {
    const now = new Date(2026, 0, 12, 23, 30, 0) // Monday 23:30
    const task: TaskRecord = {
      id: 't1', title: 'Night shift', description: '', prompt: '',
      startAt: now.getTime(), endAt: now.getTime() + 30 * 60_000,
      urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [],
      createdAt: 0, updatedAt: 0,
    }
    const transport = new MemorycalendarHostTransport(snapWith(task), undefined)
    const controller = new calendarClientController(transport, initialState(now.getTime(), 0))
    // start > end: the window wraps past midnight, length = 3h.
    controller.setDayWindow({ start: 23 * 60, end: 2 * 60 })
    await controller.start()

    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })

    const block = host.querySelector('[data-dsh-calendar-block]') as HTMLElement
    expect(block).toBeTruthy()
    // 23:30 is at (23.5-23)/3 = 1/6 of the wrapped window.
    expect(Number.parseFloat(block.style.top)).toBeCloseTo(1 / 6 * 100, 1)

    // Hours 23, 0 and 1 intersect the wrapped window (DOM order = ascending hour).
    const labels = [...host.querySelectorAll('[class*=weekGutterLabel]')].map(el => el.textContent)
    expect(labels).toEqual(['00:00', '01:00', '23:00'])

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('WeekGrid header', () => {
  it('renders a weekday/date header row and assigns overlap columns', async () => {
    const now = new Date(2026, 0, 12, 10, 0, 0) // a Monday
    const a: TaskRecord = { id: 'a', title: 'A', description: '', prompt: '', startAt: now.getTime(), endAt: now.getTime() + 60 * 60_000, urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [], createdAt: 0, updatedAt: 0 }
    const b: TaskRecord = { id: 'b', title: 'B', description: '', prompt: '', startAt: now.getTime() + 10 * 60_000, endAt: now.getTime() + 50 * 60_000, urgency: 'low', importance: 'high', done: false, subtasks: [], executions: [], createdAt: 0, updatedAt: 0 }
    const snap2: calendarSnapshot = { schemaVersion: 1, revision: 2, tasks: [a, b], scheduler: { timeZone: 'Asia/Shanghai' } }
    const c2 = new calendarClientController(new MemorycalendarHostTransport(snap2, undefined), initialState(now.getTime(), 0))
    await c2.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={c2} />) })

    const header = host.querySelector('[data-dsh-calendar-week-header]')
    expect(header).toBeTruthy()
    expect(header!.querySelectorAll('[class*=weekHeaderCell]').length).toBe(7)
    expect(header!.querySelector('[class*=weekHeaderCell][data-weekend]')).toBeTruthy()

    const blocks = [...host.querySelectorAll('[data-dsh-calendar-block]')] as HTMLElement[]
    expect(blocks.length).toBe(2)
    const lefts = blocks.map(b => b.style.left)
    expect(lefts[0]).toBe('0%')
    expect(lefts[0]).not.toBe(lefts[1])

    await act(async () => { root.unmount(); host.remove() })
  })

  it('uses the active English dictionary for weekday labels', async () => {
    const previousLanguage = document.documentElement.lang
    document.documentElement.lang = 'en'
    const now = new Date(2026, 0, 12, 10, 0, 0)
    const snap2: calendarSnapshot = { schemaVersion: 1, revision: 2, tasks: [], scheduler: { timeZone: 'Asia/Shanghai' } }
    const c2 = new calendarClientController(new MemorycalendarHostTransport(snap2, undefined), initialState(now.getTime(), 0))
    await c2.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => { root.render(<WeekGrid controller={c2} />) })
      const labels = [...host.querySelectorAll('[class*=weekHeaderDay]')].map(label => label.textContent)
      expect(labels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])
    } finally {
      await act(async () => { root.unmount(); host.remove() })
      document.documentElement.lang = previousLanguage
    }
  })
})
