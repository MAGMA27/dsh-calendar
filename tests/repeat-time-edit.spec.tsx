// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
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

function snapWith(task: TaskRecord): calendarSnapshot {
  return { schemaVersion: 1, revision: 1, tasks: [task], scheduler: { timeZone: 'Asia/Shanghai' } }
}

describe('WeekGrid repeat-copy time edit', () => {
  it('stages a pending repeat-time edit instead of committing, then resolves this/all', async () => {
    const now = new Date(2026, 0, 12, 10, 0, 0) // a Monday 10:00
    const copy: TaskRecord = {
      id: 'c1', title: 'Standup', description: '', prompt: '',
      startAt: now.getTime(), endAt: now.getTime() + 30 * 60_000,
      urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [],
      originTaskId: 'tpl', createdAt: 0, updatedAt: 0,
    }
    const dispatched: calendarAction[] = []
    const transport = new MemorycalendarHostTransport(snapWith(copy), (a) => { dispatched.push(a); return snapWith(copy) })
    const controller = new calendarClientController(transport, initialState(now.getTime(), 0))
    await controller.start()

    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })

    // A fixed 700x480 time-cell rect so the drag math is deterministic.
    const grid = host.querySelector('[data-dsh-calendar-week]') as HTMLElement
    const cells = host.querySelector('[class*=weekGridCells]') as HTMLElement
    vi.spyOn(cells, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 700, bottom: 480, width: 700, height: 480, x: 0, y: 0,
      toJSON: () => ({}),
    })

    const block = host.querySelector('[data-dsh-calendar-block]') as HTMLElement
    const PE = G.PointerEvent as unknown as typeof MouseEvent

    // Drag the block body far away: pointerdown → move (past threshold) → up.
    await act(async () => {
      block.dispatchEvent(new PE('pointerdown', { bubbles: true, clientX: 10, clientY: 10, pointerId: 1 } as MouseEventInit))
    })
    await act(async () => {
      grid.dispatchEvent(new PE('pointermove', { bubbles: true, clientX: 200, clientY: 100, pointerId: 1 } as MouseEventInit))
    })
    await act(async () => {
      grid.dispatchEvent(new PE('pointerup', { bubbles: true, clientX: 200, clientY: 100, pointerId: 1 } as MouseEventInit))
    })

    // The change must NOT be committed directly; it is staged for confirmation.
    expect(dispatched.filter(a => a.kind === 'reschedule' || a.kind === 'shiftRepeatTimes')).toHaveLength(0)
    const pending = controller.getSnapshot().pendingRepeatTimeEdit
    expect(pending).toBeDefined()
    expect(pending!.taskId).toBe('c1')
    expect(pending!.originTaskId).toBe('tpl')

    // "This copy only": Host reschedules and unbinds the copy atomically.
    await act(async () => { await controller.resolveRepeatTimeEdit('this') })
    expect(controller.getSnapshot().pendingRepeatTimeEdit).toBeUndefined()
    const unbind = dispatched[dispatched.length - 1]
    expect(unbind.kind).toBe('reschedule')
    if (unbind.kind === 'reschedule') {
      expect(unbind.id).toBe('c1')
      expect(unbind.unbind).toBe(true)
      expect(typeof unbind.startAt).toBe('number')
      expect(typeof unbind.endAt).toBe('number')
    }

    await act(async () => { root.unmount(); host.remove() })
  })

  it('"all copies" resolves to a shiftRepeatTimes action with the drag deltas', async () => {
    const now = new Date(2026, 0, 12, 10, 0, 0)
    const copy: TaskRecord = {
      id: 'c1', title: 'Standup', description: '', prompt: '',
      startAt: now.getTime(), endAt: now.getTime() + 30 * 60_000,
      urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [],
      originTaskId: 'tpl', createdAt: 0, updatedAt: 0,
    }
    const dispatched: calendarAction[] = []
    const transport = new MemorycalendarHostTransport(snapWith(copy), (a) => { dispatched.push(a); return snapWith(copy) })
    const controller = new calendarClientController(transport, initialState(now.getTime(), 0))
    await controller.start()

    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })
    const grid = host.querySelector('[data-dsh-calendar-week]') as HTMLElement
    const cells = host.querySelector('[class*=weekGridCells]') as HTMLElement
    vi.spyOn(cells, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 700, bottom: 480, width: 700, height: 480, x: 0, y: 0,
      toJSON: () => ({}),
    })
    const block = host.querySelector('[data-dsh-calendar-block]') as HTMLElement
    const PE = G.PointerEvent as unknown as typeof MouseEvent
    await act(async () => {
      block.dispatchEvent(new PE('pointerdown', { bubbles: true, clientX: 10, clientY: 10, pointerId: 1 } as MouseEventInit))
    })
    await act(async () => {
      grid.dispatchEvent(new PE('pointermove', { bubbles: true, clientX: 200, clientY: 100, pointerId: 1 } as MouseEventInit))
    })
    await act(async () => {
      grid.dispatchEvent(new PE('pointerup', { bubbles: true, clientX: 200, clientY: 100, pointerId: 1 } as MouseEventInit))
    })
    const pending = controller.getSnapshot().pendingRepeatTimeEdit!

    await act(async () => { await controller.resolveRepeatTimeEdit('all') })
    const shift = dispatched[dispatched.length - 1]
    expect(shift.kind).toBe('shiftRepeatTimes')
    if (shift.kind === 'shiftRepeatTimes') {
      expect(shift.id).toBe('c1')
      expect(shift.startDelta).toBe(pending.startAt - pending.origStart)
      expect(shift.endDelta).toBe(pending.endAt - pending.origEnd)
    }

    await act(async () => { root.unmount(); host.remove() })
  })

  it('a plain drag on a normal task (no origin) submits an explicit reschedule', async () => {
    const now = new Date(2026, 0, 12, 10, 0, 0)
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
    const grid = host.querySelector('[data-dsh-calendar-week]') as HTMLElement
    const cells = host.querySelector('[class*=weekGridCells]') as HTMLElement
    vi.spyOn(cells, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 700, bottom: 480, width: 700, height: 480, x: 0, y: 0,
      toJSON: () => ({}),
    })
    const block = host.querySelector('[data-dsh-calendar-block]') as HTMLElement
    const PE = G.PointerEvent as unknown as typeof MouseEvent
    await act(async () => {
      block.dispatchEvent(new PE('pointerdown', { bubbles: true, clientX: 10, clientY: 10, pointerId: 1 } as MouseEventInit))
    })
    await act(async () => {
      grid.dispatchEvent(new PE('pointermove', { bubbles: true, clientX: 200, clientY: 100, pointerId: 1 } as MouseEventInit))
    })
    await act(async () => {
      grid.dispatchEvent(new PE('pointerup', { bubbles: true, clientX: 200, clientY: 100, pointerId: 1 } as MouseEventInit))
    })

    expect(controller.getSnapshot().pendingRepeatTimeEdit).toBeUndefined()
    const last = dispatched[dispatched.length - 1]
    expect(last.kind).toBe('reschedule')
    if (last.kind === 'reschedule') {
      expect(last.unbind).toBeUndefined()
      expect(typeof last.startAt).toBe('number')
      expect(typeof last.endAt).toBe('number')
    }

    await act(async () => { root.unmount(); host.remove() })
  })

  it('dragging the template itself stages a confirm; "this" edits only the template (no unbind)', async () => {
    const now = new Date(2026, 0, 12, 10, 0, 0)
    const tpl: TaskRecord = {
      id: 'tpl', title: 'Standup', description: '', prompt: '',
      startAt: now.getTime(), endAt: now.getTime() + 30 * 60_000,
      urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [],
      schedule: { enabled: true, repeat: { kind: 'daily' } },
      createdAt: 0, updatedAt: 0,
    }
    const dispatched: calendarAction[] = []
    const transport = new MemorycalendarHostTransport(snapWith(tpl), (a) => { dispatched.push(a); return snapWith(tpl) })
    const controller = new calendarClientController(transport, initialState(now.getTime(), 0))
    await controller.start()

    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<WeekGrid controller={controller} />) })
    const grid = host.querySelector('[data-dsh-calendar-week]') as HTMLElement
    const cells = host.querySelector('[class*=weekGridCells]') as HTMLElement
    vi.spyOn(cells, 'getBoundingClientRect').mockReturnValue({
      top: 0, left: 0, right: 700, bottom: 480, width: 700, height: 480, x: 0, y: 0,
      toJSON: () => ({}),
    })
    const block = host.querySelector('[data-dsh-calendar-block]') as HTMLElement
    const PE = G.PointerEvent as unknown as typeof MouseEvent
    await act(async () => {
      block.dispatchEvent(new PE('pointerdown', { bubbles: true, clientX: 10, clientY: 10, pointerId: 1 } as MouseEventInit))
    })
    await act(async () => {
      grid.dispatchEvent(new PE('pointermove', { bubbles: true, clientX: 200, clientY: 100, pointerId: 1 } as MouseEventInit))
    })
    await act(async () => {
      grid.dispatchEvent(new PE('pointerup', { bubbles: true, clientX: 200, clientY: 100, pointerId: 1 } as MouseEventInit))
    })

    // A repeat-series drag is staged regardless of copy/template.
    const pending = controller.getSnapshot().pendingRepeatTimeEdit
    expect(pending).toBeDefined()
    expect(pending!.taskId).toBe('tpl')

    // "this" on a template = a Host reschedule, without unbinding.
    await act(async () => { await controller.resolveRepeatTimeEdit('this') })
    const last = dispatched[dispatched.length - 1]
    expect(last.kind).toBe('reschedule')
    if (last.kind === 'reschedule') {
      expect(last.id).toBe('tpl')
      expect(last.unbind).toBe(false)
      expect(typeof last.startAt).toBe('number')
    }

    await act(async () => { root.unmount(); host.remove() })
  })
})
