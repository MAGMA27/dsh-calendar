// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { calendarClientController, initialState } from '../src/client/controller.ts'
import { MemorycalendarHostTransport } from '../src/client/host-api.ts'
import { TaskDetailPanel } from '../src/client/components/TaskDetailPanel.tsx'
import { MatrixPanel } from '../src/client/components/MatrixPanel.tsx'
import { AgendaPanel } from '../src/client/components/AgendaPanel.tsx'
import { MonthGrid } from '../src/client/components/MonthGrid.tsx'
import { TaskBlock } from '../src/client/components/TaskBlock.tsx'
import { ExecutionSettings, type ExecutionSettingsValue } from '../src/client/components/ExecutionSettings.tsx'
import type { calendarAction, calendarSnapshot } from '../src/protocol.ts'
import type { TaskRecord } from '../src/core/tasks.ts'

function snapshotWith(task: TaskRecord): calendarSnapshot {
  return { schemaVersion: 1, revision: 1, tasks: [task], scheduler: { timeZone: 'Asia/Shanghai' } }
}

function makeTask(over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: 't1', title: 'Plan', description: '', prompt: '', startAt: 1000, endAt: 2000,
    urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [],
    createdAt: 0, updatedAt: 0, ...over,
  }
}

/** Transport records dispatched actions and returns a stable snapshot. */
function recordTransport(initial: calendarSnapshot) {
  let snap = initial
  const dispatched: calendarAction[] = []
  const applier = (a: calendarAction): calendarSnapshot => { dispatched.push(a); return snap }
  return { transport: new MemorycalendarHostTransport(snap, applier), dispatched }
}

describe('TaskDetailPanel', () => {
  it('toggles a subtask; archival and delete dispatch', async () => {
    const task = makeTask({ subtasks: [{ id: 's1', title: 'Step one', done: false }] })
    const { transport, dispatched } = recordTransport(snapshotWith(task))
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={task} onClose={() => {}} />) })

    const checks = host.querySelectorAll('input[type=checkbox]')
    expect(checks.length).toBe(1)
    // Simulate a user click by dispatching a native click (React listens on click for checkboxes).
    await act(async () => { (checks[0] as HTMLInputElement).click() })
    expect(dispatched.some(a => a.kind === 'setSubtaskDone')).toBe(true)

    // Archive button is present (task not archived).
    const archiveBtn = [...host.querySelectorAll('button')].find(b => b.textContent === '归档' || b.textContent === 'Archive')
    expect(archiveBtn).toBeTruthy()

    await act(async () => { root.unmount(); host.remove() })
  })

  it('renders execution-target knobs when set (provider/model badges via exec settings)', async () => {
    const task = makeTask({ provider: 'deepseek', model: 'chat', workspaceId: 'w1', permission: 'workspace-write' })
    const { transport } = recordTransport(snapshotWith(task))
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={task} onClose={() => {}} />) })
    // Execution settings selects should expose the pinned permission.
    const permSelect = [...host.querySelectorAll('select')].find(s => (s as HTMLSelectElement).value === 'workspace-write') as HTMLSelectElement | undefined
    expect(permSelect).toBeTruthy()
    await act(async () => { root.unmount(); host.remove() })
  })

  it('a repeat copy shows the series rule in its schedule section (consistent with the template)', async () => {
    const tpl = makeTask({ id: 'tpl', schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true } } })
    const copy = makeTask({ id: 'c1', originTaskId: 'tpl' })
    const snap: calendarSnapshot = { schemaVersion: 1, revision: 1, tasks: [tpl, copy], scheduler: { timeZone: 'Asia/Shanghai' } }
    const { transport } = recordTransport(snap)
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={copy} onClose={() => {}} />) })

    // The schedule mode select is seeded from the series rule, not the copy's own (absent) schedule.
    const modeSelect = [...host.querySelectorAll('select')].find(s => (s as HTMLSelectElement).value === 'daily') as HTMLSelectElement | undefined
    expect(modeSelect).toBeTruthy()
    // The series summary + the series-scope hint are rendered.
    expect(host.textContent).toContain('触发（按时间段）')
    expect(host.textContent).toContain('整个重复系列')

    await act(async () => { root.unmount(); host.remove() })
  })

  it('clearing the schedule on a repeat copy stages a this-day-vs-all confirm (no direct dispatch)', async () => {
    const tpl = makeTask({ id: 'tpl', schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true } } })
    const copy = makeTask({ id: 'c1', originTaskId: 'tpl', schedule: { enabled: true, dueAt: 5000 } })
    const snap: calendarSnapshot = { schemaVersion: 1, revision: 1, tasks: [tpl, copy], scheduler: { timeZone: 'Asia/Shanghai' } }
    const { transport, dispatched } = recordTransport(snap)
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={copy} onClose={() => {}} />) })

    const clearBtn = [...host.querySelectorAll('button')].find(b => b.textContent === '清除定时' || b.textContent === 'Clear schedule') as HTMLButtonElement | undefined
    expect(clearBtn).toBeTruthy()
    await act(async () => { clearBtn!.click() })

    // The clear is staged, not dispatched: the user must pick day vs all.
    expect(controller.getSnapshot().pendingScheduleClear).toEqual({ taskId: 'c1' })
    expect(dispatched.some(a => a.kind === 'setSchedule' || a.kind === 'clearInstanceSchedule')).toBe(false)

    // Picking "this day" dispatches clearInstanceSchedule on the copy.
    await act(async () => { controller.confirmScheduleClearDay() })
    expect(dispatched.some(a => a.kind === 'clearInstanceSchedule' && a.id === 'c1')).toBe(true)

    await act(async () => { root.unmount(); host.remove() })
  })

  it('"this day" is offered on a plain copy too and removes that day\'s copy', async () => {
    const tpl = makeTask({ id: 'tpl', schedule: { enabled: true, repeat: { kind: 'daily' } } })
    const copy = makeTask({ id: 'c1', originTaskId: 'tpl' }) // plain copy, no own schedule
    const snap: calendarSnapshot = { schemaVersion: 1, revision: 1, tasks: [tpl, copy], scheduler: { timeZone: 'Asia/Shanghai' } }
    const { transport, dispatched } = recordTransport(snap)
    const controller = new calendarClientController(transport, initialState(0, 0))
    await controller.start()
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<TaskDetailPanel controller={controller} task={copy} onClose={() => {}} />) })

    const clearBtn = [...host.querySelectorAll('button')].find(b => b.textContent === '清除定时' || b.textContent === 'Clear schedule') as HTMLButtonElement | undefined
    expect(clearBtn).toBeTruthy()
    await act(async () => { clearBtn!.click() })

    expect(controller.getSnapshot().pendingScheduleClear).toEqual({ taskId: 'c1' })
    await act(async () => { controller.confirmScheduleClearDay() })
    // No own schedule → the day's occurrence is removed.
    expect(dispatched.some(a => a.kind === 'delete' && a.id === 'c1')).toBe(true)

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('Calendar completion styling', () => {
  it('marks a completed week task block at the card level', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        <TaskBlock
          task={makeTask({ done: true })}
          topPct={10}
          heightPct={10}
          leftPct={10}
          widthPct={80}
          onSelect={() => {}}
        />,
      )
    })

    expect(host.querySelector('[data-dsh-calendar-block][data-done]')).toBeTruthy()

    await act(async () => { root.unmount(); host.remove() })
  })

  it('marks a completed month task chip', async () => {
    const done = makeTask({
      id: 'done-month-task',
      title: 'Completed month task',
      startAt: new Date().setHours(9, 0, 0, 0),
      endAt: new Date().setHours(10, 0, 0, 0),
      done: true,
    })
    const pending = makeTask({
      id: 'pending-month-task',
      title: 'Pending month task',
      startAt: done.startAt,
      endAt: done.endAt,
    })
    const snap: calendarSnapshot = {
      schemaVersion: 1,
      revision: 1,
      tasks: [done, pending],
      scheduler: { timeZone: 'Asia/Shanghai' },
    }
    const controller = new calendarClientController(new MemorycalendarHostTransport(snap), initialState(done.startAt, 0))
    await controller.start()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<MonthGrid controller={controller} />) })

    const doneChip = [...host.querySelectorAll('[data-dsh-calendar-month] [data-done]')]
      .find(node => node.textContent === done.title)
    expect(doneChip).toBeTruthy()
    expect(host.querySelector('[data-dsh-calendar-month] [data-done]')?.textContent).toBe(done.title)

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('MatrixPanel', () => {
  it('shows the date of the oldest unfinished repeat occurrence', async () => {
    const day = (offset: number): number => {
      const d = new Date()
      d.setHours(9, 0, 0, 0)
      d.setDate(d.getDate() + offset)
      return d.getTime()
    }
    const template = makeTask({
      id: 'repeat-template',
      title: 'Daily review',
      startAt: day(0),
      endAt: day(0) + 60 * 60_000,
      done: true,
      schedule: { enabled: true, repeat: { kind: 'daily' } },
    })
    const doneCopy = makeTask({
      id: 'done-copy',
      title: 'Daily review',
      originTaskId: template.id,
      startAt: day(1),
      endAt: day(1) + 60 * 60_000,
      done: true,
    })
    const oldestUnfinished = makeTask({
      id: 'oldest-copy',
      title: 'Daily review',
      originTaskId: template.id,
      startAt: day(2),
      endAt: day(2) + 60 * 60_000,
    })
    const latestUnfinished = makeTask({
      id: 'latest-copy',
      title: 'Daily review',
      originTaskId: template.id,
      startAt: day(3),
      endAt: day(3) + 60 * 60_000,
    })
    const snap: calendarSnapshot = {
      schemaVersion: 1,
      revision: 1,
      tasks: [template, doneCopy, oldestUnfinished, latestUnfinished],
      scheduler: { timeZone: 'Asia/Shanghai' },
    }
    const controller = new calendarClientController(new MemorycalendarHostTransport(snap), initialState(0, 0))
    await controller.start()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<MatrixPanel controller={controller} />) })

    expect(host.textContent).toContain(new Date(oldestUnfinished.startAt).toLocaleDateString())
    expect(host.textContent).not.toContain(new Date(latestUnfinished.startAt).toLocaleDateString())
    expect(host.textContent).not.toContain(new Date(doneCopy.startAt).toLocaleDateString())

    await act(async () => { root.unmount(); host.remove() })
  })

  it('marks an unfinished task from a previous date as overdue', async () => {
    const d = new Date()
    d.setHours(9, 0, 0, 0)
    d.setDate(d.getDate() - 1)
    const task = makeTask({ startAt: d.getTime(), endAt: d.getTime() + 60 * 60_000 })
    const controller = new calendarClientController(
      new MemorycalendarHostTransport(snapshotWith(task)),
      initialState(0, 0),
    )
    await controller.start()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<MatrixPanel controller={controller} />) })

    const item = host.querySelector('[data-dsh-calendar-matrix] button[data-overdue]')
    expect(item).toBeTruthy()
    expect(item?.textContent).toContain('已过期')

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('AgendaPanel', () => {
  it('places the oldest unfinished repeat occurrence in today when it is today', async () => {
    const day = (offset: number): number => {
      const d = new Date()
      d.setHours(9, 0, 0, 0)
      d.setDate(d.getDate() + offset)
      return d.getTime()
    }
    const template = makeTask({
      id: 'agenda-template',
      title: 'Daily review',
      startAt: day(0),
      endAt: day(0) + 60 * 60_000,
      schedule: { enabled: true, repeat: { kind: 'daily' } },
    })
    const tomorrow = makeTask({
      id: 'agenda-tomorrow',
      title: 'Daily review',
      originTaskId: template.id,
      startAt: day(1),
      endAt: day(1) + 60 * 60_000,
    })
    const snap: calendarSnapshot = {
      schemaVersion: 1,
      revision: 1,
      tasks: [template, tomorrow],
      scheduler: { timeZone: 'Asia/Shanghai' },
    }
    const controller = new calendarClientController(new MemorycalendarHostTransport(snap), initialState(0, 0))
    await controller.start()
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<AgendaPanel controller={controller} />) })

    expect(host.querySelector('[data-group="today"]')?.textContent).toContain('Daily review')
    expect(host.querySelector('[data-group="upcoming"]')?.textContent).not.toContain('Daily review')

    await act(async () => { root.unmount(); host.remove() })
  })
})

describe('ExecutionSettings', () => {
  it('emits permission change through onChange', async () => {
    const emitted: Partial<ExecutionSettingsValue>[] = []
    const host = document.createElement('div'); document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => { root.render(<ExecutionSettings value={{}} onChange={(p) => emitted.push(p)} />) })
    const sel = host.querySelector('select') as HTMLSelectElement
    await act(async () => {
      sel.value = 'workspace-write'
      sel.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(emitted.some(p => p.permission === 'workspace-write')).toBe(true)
    await act(async () => { root.unmount(); host.remove() })
  })
})
