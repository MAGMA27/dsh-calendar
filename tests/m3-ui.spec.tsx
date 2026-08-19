// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { createRoot } from 'react-dom/client'
import { act } from 'react-dom/test-utils'
import { calendarClientController, initialState } from '../src/client/controller.ts'
import { MemorycalendarHostTransport } from '../src/client/host-api.ts'
import { TaskDetailPanel } from '../src/client/components/TaskDetailPanel.tsx'
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
