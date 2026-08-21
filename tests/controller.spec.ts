import { describe, expect, it } from 'vitest'
import { calendarClientController, initialState } from '../src/client/controller.ts'
import { MemorycalendarHostTransport, type calendarHostTransport } from '../src/client/host-api.ts'
import type { calendarAction, calendarSnapshot } from '../src/protocol.ts'
import type { TaskRecord } from '../src/core/tasks.ts'

function emptySnap(): calendarSnapshot {
  return { schemaVersion: 1, revision: 0, tasks: [], scheduler: { timeZone: 'Asia/Shanghai' } }
}

/** A transport that applies create to the snapshot and returns the new one. */
function makeSnapTransport() {
  let snap = emptySnap()
  const applier = (a: calendarAction): calendarSnapshot => {
    if (a.kind === 'create') {
      snap = { ...snap, revision: snap.revision + 1, tasks: [...snap.tasks, { id: 't-new', title: a.input.title, description: '', prompt: '', startAt: a.input.startAt, endAt: a.input.endAt, urgency: a.input.urgency, importance: a.input.importance, done: false, subtasks: [], executions: [], createdAt: 0, updatedAt: 0 }] }
    }
    return snap
  }
  const transport = new MemorycalendarHostTransport(snap, applier)
  return { transport, getSnap: () => snap }
}

describe('calendarClientController', () => {
  it('starts and transitions to ready', async () => {
    const { transport } = makeSnapTransport()
    const c = new calendarClientController(transport, initialState(0, 0))
    await c.start()
    expect(c.getSnapshot().status).toBe('ready')
    expect(c.getSnapshot().open).toBe(false)
    c.openPanel()
    expect(c.getSnapshot().open).toBe(true)
    c.toggleOpen()
    expect(c.getSnapshot().open).toBe(false)
  })
  it('dispatches a create and reflects the returned snapshot', async () => {
    const { transport } = makeSnapTransport()
    const c = new calendarClientController(transport, initialState(0, 0))
    await c.start()
    await c.dispatch({ kind: 'create', input: { title: 'Plan', description: '', prompt: '', startAt: 1000, endAt: 2000, urgency: 'high', importance: 'high' } })
    expect(c.getSnapshot().snapshot.tasks.length).toBe(1)
    expect(c.getSnapshot().snapshot.tasks[0].title).toBe('Plan')
  })
  it('does not let an older in-flight pull overwrite a newer Host revision', async () => {
    const older = { ...emptySnap(), revision: 1 }
    const newer = { ...emptySnap(), revision: 2, tasks: [{ id: 'new', title: 'new', description: '', prompt: '', startAt: 1, endAt: 2, urgency: 'high' as const, importance: 'high' as const, done: false, subtasks: [], executions: [], createdAt: 0, updatedAt: 0 }] }
    let notify = (): void => {}
    let stateCalls = 0
    const pending: Array<(snapshot: calendarSnapshot) => void> = []
    const transport: calendarHostTransport = {
      state: () => {
        stateCalls += 1
        if (stateCalls === 1) return Promise.resolve(emptySnap())
        return new Promise(resolve => pending.push(resolve))
      },
      action: async () => emptySnap(),
      subscribe: listener => { notify = listener; return () => {} },
      bootstrap: async () => emptySnap(),
      options: async () => ({ workspaces: [], sessions: [], projects: [], providers: [], modelsByProvider: {}, modes: [] }),
    }
    const c = new calendarClientController(transport, initialState(0, 0))
    await c.start()
    notify()
    notify()
    pending[1](newer)
    await Promise.resolve()
    pending[0](older)
    await Promise.resolve()
    expect(c.getSnapshot().snapshot.revision).toBe(2)
    expect(c.getSnapshot().snapshot.tasks[0].id).toBe('new')
  })
  it('manages view state and selection', () => {
    const { transport } = makeSnapTransport()
    const c = new calendarClientController(transport, initialState(0, 0))
    c.setView('month')
    expect(c.getSnapshot().view).toBe('month')
    c.setDraft({ start: 1, end: 2 })
    expect(c.getSnapshot().draft).toEqual({ start: 1, end: 2 })
  })
  it('notifies subscribers on change', async () => {
    const { transport } = makeSnapTransport()
    const c = new calendarClientController(transport, initialState(0, 0))
    let n = 0
    c.subscribe(() => { n += 1 })
    c.setView('matrix')
    expect(n).toBe(1)
  })
  it('schedule-clear confirm stages a pending choice and resolves day/all/cancel', async () => {
    const tpl: TaskRecord = { id: 'tpl', title: 'T', description: '', prompt: '', startAt: 0, endAt: 1000, urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [], schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true } }, createdAt: 0, updatedAt: 0 }
    const copy: TaskRecord = { id: 'c1', title: 'T', description: '', prompt: '', startAt: 0, endAt: 1000, urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [], originTaskId: 'tpl', schedule: { enabled: true, dueAt: 5000 }, createdAt: 0, updatedAt: 0 }
    const snap: calendarSnapshot = { schemaVersion: 1, revision: 1, tasks: [tpl, copy], scheduler: { timeZone: 'Asia/Shanghai' } }
    const transport = new MemorycalendarHostTransport(snap, (a) => { void a; return snap })
    const c = new calendarClientController(transport, initialState(0, 0))
    await c.start()

    const p1 = c.requestScheduleClear('c1')
    expect(c.getSnapshot().pendingScheduleClear).toEqual({ taskId: 'c1' })
    c.confirmScheduleClearDay()
    expect(await p1).toBe('day')

    const p2 = c.requestScheduleClear('c1')
    c.confirmScheduleClearAll()
    expect(await p2).toBe('all')

    const p3 = c.requestScheduleClear('c1')
    c.cancelScheduleClear()
    expect(await p3).toBe('cancel')
    expect(c.getSnapshot().pendingScheduleClear).toBeUndefined()
  })

  it('repeat-delete confirm stages a pending choice and resolves this/all/cancel', async () => {
    const tpl: TaskRecord = { id: 'tpl', title: 'T', description: '', prompt: '', startAt: 0, endAt: 1000, urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [], schedule: { enabled: true, repeat: { kind: 'daily' } }, createdAt: 0, updatedAt: 0 }
    const snap: calendarSnapshot = { schemaVersion: 1, revision: 1, tasks: [tpl], scheduler: { timeZone: 'Asia/Shanghai' } }
    const transport = new MemorycalendarHostTransport(snap, (a) => { void a; return snap })
    const c = new calendarClientController(transport, initialState(0, 0))
    await c.start()

    const p1 = c.requestRepeatDelete('tpl')
    expect(c.getSnapshot().pendingRepeatDelete).toEqual({ taskId: 'tpl' })
    c.confirmRepeatDeleteThis()
    expect(await p1).toBe('this')

    const p2 = c.requestRepeatDelete('tpl')
    c.confirmRepeatDeleteAll()
    expect(await p2).toBe('all')

    const p3 = c.requestRepeatDelete('tpl')
    c.cancelRepeatDelete()
    expect(await p3).toBe('cancel')
    expect(c.getSnapshot().pendingRepeatDelete).toBeUndefined()
  })
})
