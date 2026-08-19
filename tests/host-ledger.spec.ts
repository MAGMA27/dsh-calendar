import { describe, expect, it } from 'vitest'
import { HostLedger, NoopLedgerPersist, type HostLedgerPersist } from '../src/host-ledger.ts'
import type { calendarActionEnvelope, calendarSnapshot } from '../src/protocol.ts'

class MemoryPersist implements HostLedgerPersist {
  doc: Parameters<HostLedgerPersist['save']>[0] | undefined
  load() { return this.doc }
  save(doc: Parameters<HostLedgerPersist['save']>[0]) { this.doc = doc }
}

function makeLedger() {
  const persist = new MemoryPersist()
  let now = 0
  const ledger = new HostLedger(persist, () => now, () => 'task-1')
  return { ledger, setNow: (n: number) => { now = n } }
}

function createEnvelope(req: string): calendarActionEnvelope {
  return {
    requestId: req,
    action: {
      kind: 'create',
      input: { title: 'Task', description: '', prompt: '', startAt: 1000, endAt: 2000, urgency: 'high', importance: 'high' },
    },
  }
}

describe('HostLedger', () => {
  it('starts empty and bumps revision on a create', () => {
    const { ledger } = makeLedger()
    expect(ledger.getSnapshot().tasks.length).toBe(0)
    const r = ledger.apply(createEnvelope('r1'))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.snapshot.revision).toBe(1)
    expect(r.snapshot.tasks.length).toBe(1)
  })
  it('is idempotent per requestId', () => {
    const { ledger } = makeLedger()
    ledger.apply(createEnvelope('r1'))
    const second = ledger.apply(createEnvelope('r1'))
    if (!second.ok) throw new Error('expected ok')
    expect(second.snapshot.tasks.length).toBe(1)
    expect(second.snapshot.revision).toBe(1)
  })
  it('rejects an update to an unknown task', () => {
    const { ledger } = makeLedger()
    const r = ledger.apply({ requestId: 'r1', action: { kind: 'update', id: 'nope', patch: { title: 'x' } } })
    expect(r.ok).toBe(false)
  })
  it('applies subspace and quadrant mutations', () => {
    const { ledger } = makeLedger()
    const c = ledger.apply(createEnvelope('r1'))
    if (!c.ok) return
    const id = c.snapshot.tasks[0].id
    const q = ledger.apply({ requestId: 'r2', action: { kind: 'setQuadrant', id, urgency: 'low', importance: 'low' } })
    if (!q.ok) return
    expect(q.snapshot.tasks[0].urgency).toBe('low')
    const d = ledger.apply({ requestId: 'r3', action: { kind: 'setDone', id, done: true } })
    if (!d.ok) return
    expect(d.snapshot.tasks[0].done).toBe(true)
  })
  it('persists on every change and reloads', () => {
    const persist = new MemoryPersist()
    const ledger = new HostLedger(persist, () => 0, () => 'task-1')
    ledger.apply(createEnvelope('r1'))
    const reloaded = new HostLedger(persist, () => 0, () => 'task-1')
    expect(reloaded.getSnapshot().tasks.length).toBe(1)
  })
  it('exposes a typed snapshot', () => {
    const { ledger } = makeLedger()
    ledger.apply(createEnvelope('r1'))
    const snap: calendarSnapshot = ledger.getSnapshot()
    expect(snap.schemaVersion).toBe(1)
    expect(typeof snap.scheduler.timeZone).toBe('string')
  })
})


describe('HostLedger execution records', () => {
  it('opens an execution and settles it with a session, bumping revision', () => {
    const { ledger } = makeLedger()
    const c = ledger.apply(createEnvelope('r1'))
    if (!c.ok) throw new Error('create failed')
    const id = c.snapshot.tasks[0].id
    const revBefore = c.snapshot.revision
    expect(ledger.openExecution(id, 'ex-1', 1000)).toBe(true)
    let t = ledger.taskById(id)!
    expect(t.executions.length).toBe(1)
    expect(t.executions[0].id).toBe('ex-1')
    expect(t.executions[0].endedAt).toBeUndefined()
    expect(t.executions[0].sessionId).toBeUndefined()
    expect(ledger.getSnapshot().revision).toBe(revBefore + 1)
    // settle succeeds and attaches the session
    expect(ledger.settleExecution(id, 'ex-1', 'succeeded', 2000, undefined, 'session-9')).toBe(true)
    t = ledger.taskById(id)!
    expect(t.executions[0].sessionId).toBe('session-9')
    expect(t.executions[0].result).toBe('succeeded')
    expect(t.executions[0].endedAt).toBe(2000)
    // double settle is a no-op
    expect(ledger.settleExecution(id, 'ex-1', 'failed', 3000, 'x', 'session-9')).toBe(false)
  })

  it('refuses to open a second execution while one is in flight', () => {
    const { ledger } = makeLedger()
    const c = ledger.apply(createEnvelope('r1'))
    if (!c.ok) throw new Error('create failed')
    const id = c.snapshot.tasks[0].id
    expect(ledger.openExecution(id, 'ex-1', 1000)).toBe(true)
    expect(ledger.openExecution(id, 'ex-2', 1000)).toBe(false)
    expect(ledger.taskById(id)!.executions.length).toBe(1)
  })

  it('refuses to open or settle for an unknown task', () => {
    const { ledger } = makeLedger()
    expect(ledger.openExecution('nope', 'ex-1', 1000)).toBe(false)
    expect(ledger.settleExecution('nope', 'ex-1', 'succeeded', 1000, undefined)).toBe(false)
  })

  it('overwrites an unknown idempotent execution on a persisted reload', () => {
    // a run that is in-flight survives a reload as 'running'
    const persist = new MemoryPersist()
    const a = new HostLedger(persist, () => 0, () => 'task-1')
    const c = a.apply(createEnvelope('r1'))
    if (!c.ok) throw new Error('create failed')
    a.openExecution(c.snapshot.tasks[0].id, 'ex-1', 0)
    const b = new HostLedger(persist, () => 0, () => 'task-1')
    const t = b.taskById(c.snapshot.tasks[0].id)!
    expect(t.executions[0].result).toBeUndefined()
    expect(t.executions[0].endedAt).toBeUndefined()
  })
})

describe('NoopLedgerPersist', () => {
  it('is safe', () => {
    const ledger = new HostLedger(new NoopLedgerPersist(), () => 0, () => 'id')
    expect(ledger.getSnapshot().tasks).toEqual([])
  })
})

describe('HostLedger advanceSchedule', () => {
  it('rolls a task schedule forward and bumps revision', () => {
    const { ledger } = makeLedger()
    const c = ledger.apply({ requestId: 'c1', action: {
      kind: 'setSchedule', id: (() => { const r = ledger.apply(createEnvelope('r0')); return r.ok ? r.snapshot.tasks[0].id : '' })(),
      patch: { enabled: true, dueAt: 5000 },
    } })
    if (!c.ok) throw new Error('setSchedule failed')
    const id = c.snapshot.tasks[0].id
    const revBefore = c.snapshot.revision
    expect(ledger.advanceSchedule(id, 9999, 1234)).toBe(true)
    const t = ledger.taskById(id)!
    expect(t.schedule!.nextRunAt).toBe(9999)
    expect(t.schedule!.lastTriggeredAt).toBe(1234)
    expect(ledger.getSnapshot().revision).toBe(revBefore + 1)
  })

  it('is a no-op for an unknown or scheduling-less task', () => {
    const { ledger } = makeLedger()
    const r0 = ledger.apply(createEnvelope('r0'))
    if (!r0.ok) throw new Error('create failed')
    expect(ledger.advanceSchedule('nope', 1, 1)).toBe(false)
    expect(ledger.advanceSchedule(r0.snapshot.tasks[0].id, 1, 1)).toBe(false) // no schedule set
  })

  it('removes a completed one-shot dueAt schedule entirely', () => {
    const { ledger, setNow } = makeLedger()
    setNow(500)
    const c = ledger.apply({ requestId: 'c1', action: {
      kind: 'setSchedule',
      id: (() => { const r = ledger.apply(createEnvelope('r0')); return r.ok ? r.snapshot.tasks[0].id : '' })(),
      patch: { enabled: true, dueAt: 1000 },
    } })
    if (!c.ok) throw new Error('setSchedule failed')
    const id = c.snapshot.tasks[0].id
    expect(ledger.taskById(id)!.schedule?.nextRunAt).toBe(1000)

    // The accepted one-shot run has nothing to roll forward to: the schedule
    // must be cleared, not left enabled with a stale due time.
    expect(ledger.advanceSchedule(id, undefined, 1000)).toBe(true)
    expect(ledger.taskById(id)!.schedule).toBeUndefined()
  })

  it('keeps a repeat rule when a schedule is rolled forward (repeat templates materialize, never run)', () => {
    const { ledger } = makeLedger()
    const c = ledger.apply({ requestId: 'c2', action: {
      kind: 'setSchedule',
      id: (() => { const r = ledger.apply(createEnvelope('r0')); return r.ok ? r.snapshot.tasks[0].id : '' })(),
      patch: { enabled: true, repeat: { kind: 'daily' } },
    } })
    if (!c.ok) throw new Error('setSchedule failed')
    const id = c.snapshot.tasks[0].id
    expect(ledger.taskById(id)!.schedule?.nextRunAt).toBeUndefined() // repeats have no run instant
    expect(ledger.advanceSchedule(id, undefined, 1000)).toBe(true)
    const t = ledger.taskById(id)!
    expect(t.schedule?.repeat?.kind).toBe('daily')
  })
})

describe('HostLedger repeat materialization', () => {
  function at(y: number, m: number, d: number, h = 0, min = 0): number {
    return new Date(y, m - 1, d, h, min).getTime()
  }

  function makeMaterializingLedger() {
    const persist = new MemoryPersist()
    let n = 0
    const ledger = new HostLedger(persist, () => at(2025, 1, 6, 8), () => `copy-${++n}`)
    return { ledger }
  }

  function createWithRepeat(ledger: HostLedger, repeat: unknown): string {
    const r = ledger.apply({ requestId: 'r-' + Math.random(), action: {
      kind: 'create',
      input: {
        title: 'Daily', description: '', prompt: '', startAt: at(2025, 1, 6, 9), endAt: at(2025, 1, 6, 10),
        urgency: 'high', importance: 'high',
      },
      schedule: { enabled: true, repeat: repeat as never },
    } })
    if (!r.ok) throw new Error('create failed')
    return r.snapshot.tasks[0].id
  }

  it('materializes daily copies from the day after the template through the horizon', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily' })
    expect(ledger.materializeRepeats(at(2025, 1, 6, 8), 3)).toBe(true)
    const copies = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(copies).toHaveLength(3) // 01-07, 01-08, 01-09
    expect(copies[0].startAt).toBe(at(2025, 1, 7, 9))
    expect(copies[0].endAt).toBe(at(2025, 1, 7, 10))
    expect(ledger.taskById(id)!.schedule?.materialized).toEqual(['2025-01-07', '2025-01-08', '2025-01-09'])
    // Idempotent: a second sweep changes nothing.
    expect(ledger.materializeRepeats(at(2025, 1, 6, 8), 3)).toBe(false)
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)).toHaveLength(3)
  })

  it('honors weekly weekdays and the holiday skip', () => {
    const { ledger } = makeMaterializingLedger()
    // 2025-01-06 is Monday; weekly Mon with skipHolidays → 01-13 (beyond a 3-day horizon → none).
    const id = createWithRepeat(ledger, { kind: 'weekly', weekdays: [1], skipHolidays: true })
    expect(ledger.materializeRepeats(at(2025, 1, 6, 8), 7)).toBe(true)
    const copies = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(copies).toHaveLength(1) // next Monday 01-13 only
    expect(copies[0].startAt).toBe(at(2025, 1, 13, 9))
  })

  it('does not re-create a deleted copy for an already-materialized date', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily' })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 3)
    const copy = ledger.getSnapshot().tasks.find(t => t.originTaskId === id)!
    expect(ledger.apply({ requestId: 'del', action: { kind: 'delete', id: copy.id } }).ok).toBe(true)
    expect(ledger.materializeRepeats(at(2025, 1, 6, 8), 3)).toBe(false)
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)).toHaveLength(2)
  })

  it('deleting a repeat template cascades to its bound copies (unbound survive)', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily' })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 3)
    const copy = ledger.getSnapshot().tasks.find(t => t.originTaskId === id)!
    // Unbind one copy (as if the user picked "this copy only").
    expect(ledger.apply({ requestId: 'unbind', action: { kind: 'update', id: copy.id, patch: { originTaskId: null } } }).ok).toBe(true)
    const tasksBefore = ledger.getSnapshot().tasks
    expect(ledger.apply({ requestId: 'del-tpl', action: { kind: 'delete', id } }).ok).toBe(true)
    const remaining = ledger.getSnapshot().tasks
    expect(remaining.some(t => t.id === id)).toBe(false)
    expect(remaining.filter(t => t.originTaskId === id)).toHaveLength(0) // bound copies gone
    expect(remaining.some(t => t.id === copy.id)).toBe(true) // unbound copy kept
    expect(tasksBefore.length - remaining.length).toBe(3) // template + 2 bound copies removed
  })

  it('shifts the template + all bound copies by the same deltas', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily' })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 3)
    const copy = ledger.getSnapshot().tasks.find(t => t.originTaskId === id)!
    const r = ledger.apply({ requestId: 'shift', action: { kind: 'shiftRepeatTimes', id: copy.id, startDelta: 60 * 60 * 1000, endDelta: 60 * 60 * 1000 } })
    expect(r.ok).toBe(true)
    const snap = ledger.getSnapshot().tasks
    expect(snap.find(t => t.id === id)!.startAt).toBe(at(2025, 1, 6, 10))
    for (const c of snap.filter(t => t.originTaskId === id)) {
      expect(c.startAt).toBe(at(new Date(c.startAt).getFullYear(), new Date(c.startAt).getMonth() + 1, new Date(c.startAt).getDate(), 10))
    }
  })

  it('rejects shiftRepeatTimes for a non-copy task', () => {
    const { ledger } = makeMaterializingLedger()
    const r = ledger.apply(createEnvelope('r0'))
    if (!r.ok) throw new Error('create failed')
    const id = r.snapshot.tasks[0].id
    const s = ledger.apply({ requestId: 's', action: { kind: 'shiftRepeatTimes', id, startDelta: 1, endDelta: 1 } })
    expect(s.ok).toBe(false)
  })
})
