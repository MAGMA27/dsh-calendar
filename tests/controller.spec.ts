import { describe, expect, it } from 'vitest'
import { calendarClientController, initialState } from '../src/client/controller.ts'
import { MemorycalendarHostTransport } from '../src/client/host-api.ts'
import type { calendarAction, calendarSnapshot } from '../src/protocol.ts'

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
})
