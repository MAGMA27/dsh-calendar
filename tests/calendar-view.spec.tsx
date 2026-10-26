// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { calendarClientController, initialState } from '../src/client/controller.ts'
import { MemorycalendarHostTransport } from '../src/client/host-api.ts'
import { CalendarView } from '../src/client/components/CalendarView.tsx'
import { MonthGrid } from '../src/client/components/MonthGrid.tsx'
import type { calendarAction, calendarSnapshot } from '../src/protocol.ts'
import type { TaskRecord } from '../src/core/tasks.ts'

function makeTransport() {
  let snap: calendarSnapshot = { schemaVersion: 1, revision: 0, tasks: [], scheduler: { timeZone: 'Asia/Shanghai' } }
  const transport = new MemorycalendarHostTransport(snap, (a: calendarAction): calendarSnapshot => snap)
  return transport
}

describe('CalendarView render', () => {
  it('transitions from loading to ready once the controller loads', async () => {
    const controller = new calendarClientController(makeTransport(), initialState(0, 0))
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
    expect(host.querySelector('[data-dsh-calendar-week]')).not.toBeNull()

    await act(async () => { root.unmount(); host.remove() })
  })

  it('keeps ready tasks visible and shows an action error when transport rejects', async () => {
    const startAt = Date.now() + 24 * 60 * 60_000
    const task: TaskRecord = {
      id: 'visible-task', title: 'Keep this task visible', description: '', prompt: '',
      startAt, endAt: startAt + 60 * 60_000, urgency: 'high', importance: 'high',
      done: false, subtasks: [], executions: [], createdAt: 0, updatedAt: 0,
    }
    const snapshot: calendarSnapshot = {
      schemaVersion: 1, revision: 1, tasks: [task], scheduler: { timeZone: 'Asia/Shanghai' },
    }
    const transport = new MemorycalendarHostTransport(snapshot)
    vi.spyOn(transport, 'action').mockRejectedValue(new Error('HTTP 422: action rejected'))
    const initial = initialState(startAt, 0)
    initial.view = 'agenda'
    const controller = new calendarClientController(transport, initial)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    try {
      await act(async () => { root.render(<CalendarView controller={controller} />); await controller.start() })
      expect(host.textContent).toContain(task.title)

      await act(async () => { await controller.dispatch({ kind: 'setDone', id: task.id, done: true }) })

      expect(controller.getSnapshot().status).toBe('ready')
      expect(controller.getSnapshot().snapshot).toEqual(snapshot)
      expect.soft(host.textContent).toContain('操作失败：Error: HTTP 422: action rejected')
      expect.soft(host.textContent).toContain(task.title)
    } finally {
      await act(async () => { root.unmount(); host.remove() })
      controller.dispose()
    }
  })

  it('formats month weekdays and month chips with the document language', () => {
    const previousLang = document.documentElement.lang
    document.documentElement.lang = 'en-US'
    const OriginalDateTimeFormat = Intl.DateTimeFormat
    const requestedLocales: Array<Intl.LocalesArgument | undefined> = []
    const formatSpy = vi.spyOn(Intl, 'DateTimeFormat').mockImplementation((locales, options) => {
      requestedLocales.push(locales)
      return new OriginalDateTimeFormat(locales, options)
    })
    const controller = new calendarClientController(makeTransport(), initialState(0, 0))
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)

    try {
      act(() => { root.render(<MonthGrid controller={controller} />) })
      expect(requestedLocales.length).toBeGreaterThan(0)
      expect(requestedLocales.every(value => value === 'en-US')).toBe(true)
    } finally {
      formatSpy.mockRestore()
      document.documentElement.lang = previousLang
      act(() => { root.unmount() })
      host.remove()
    }
  })
})
