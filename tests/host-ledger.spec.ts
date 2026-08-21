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
  it('rejects an incomplete provider/model pin before create or update', () => {
    const { ledger } = makeLedger()
    const baseCreate = createEnvelope('ignored').action
    if (baseCreate.kind !== 'create') throw new Error('expected create action')
    const invalidCreate = ledger.apply({
      requestId: 'incomplete-create',
      action: { ...baseCreate, input: { ...baseCreate.input, provider: 'ark' } },
    })
    expect(invalidCreate.ok).toBe(false)
    if (!invalidCreate.ok) expect(invalidCreate.error).toContain('provider and model must be set together')
    expect(ledger.getSnapshot().tasks).toHaveLength(0)

    const validCreate = ledger.apply({
      requestId: 'complete-create',
      action: { ...baseCreate, input: { ...baseCreate.input, provider: 'ark', model: 'deepseek-v4-flash' } },
    })
    if (!validCreate.ok) throw new Error('valid create failed')
    const id = validCreate.snapshot.tasks[0].id
    const invalidUpdate = ledger.apply({ requestId: 'incomplete-update', action: { kind: 'update', id, patch: { model: null } } })
    expect(invalidUpdate.ok).toBe(false)
    expect(ledger.taskById(id)?.provider).toBe('ark')
    expect(ledger.taskById(id)?.model).toBe('deepseek-v4-flash')
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
  it('persists Host-only scheduled lineage across a reload', () => {
    const persist = new MemoryPersist()
    const ledger = new HostLedger(persist, () => 0, () => 'task-1')
    const created = ledger.apply(createEnvelope('lineage'), { scheduledDepth: 2 })
    if (!created.ok) throw new Error('create failed')
    const reloaded = new HostLedger(persist, () => 0, () => 'task-1')
    expect(reloaded.taskById('task-1')?.scheduledDepth).toBe(2)
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

  it('exposes an active scheduled execution after the runner attaches its session', () => {
    const { ledger } = makeLedger()
    const c = ledger.apply(createEnvelope('r1'))
    if (!c.ok) throw new Error('create failed')
    const id = c.snapshot.tasks[0].id
    expect(ledger.openExecution(id, 'ex-schedule', 1000, 'schedule')).toBe(true)
    expect(ledger.attachExecutionSession(id, 'ex-schedule', 'session-scheduled', 1100)).toBe(true)
    expect(ledger.activeScheduledExecution('session-scheduled')).toEqual({
      taskId: id, executionId: 'ex-schedule', sessionId: 'session-scheduled', scheduledDepth: 0,
    })
    expect(ledger.activeScheduledExecution('other-session')).toBeUndefined()
    expect(ledger.settleExecution(id, 'ex-schedule', 'succeeded', 1200, undefined, 'session-scheduled')).toBe(true)
    expect(ledger.activeScheduledExecution('session-scheduled')).toBeUndefined()
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

  it('persists the retry count for the current occurrence and resets it on advance', () => {
    const persist = new MemoryPersist()
    const ledger = new HostLedger(persist, () => 0, () => 'task-1')
    const c = ledger.apply({ requestId: 'retry-task', action: {
      kind: 'create', input: { title: 'Retry', description: '', prompt: '', startAt: 0, endAt: 1000, urgency: 'high', importance: 'high' },
      schedule: { enabled: true, dueAt: 5000 },
    } })
    if (!c.ok) throw new Error('create failed')
    const id = c.snapshot.tasks[0].id

    expect(ledger.advanceSchedule(id, 35_000, undefined, 2)).toBe(true)
    expect(ledger.taskById(id)!.schedule?.retryCount).toBe(2)
    const reloaded = new HostLedger(persist, () => 0, () => 'task-1')
    expect(reloaded.taskById(id)!.schedule?.retryCount).toBe(2)

    expect(reloaded.advanceSchedule(id, 65_000, undefined)).toBe(true)
    expect(reloaded.taskById(id)!.schedule?.retryCount).toBeUndefined()
  })

  it('is a no-op for an unknown or scheduling-less task', () => {
    const { ledger } = makeLedger()
    const r0 = ledger.apply(createEnvelope('r0'))
    if (!r0.ok) throw new Error('create failed')
    expect(ledger.advanceSchedule('nope', 1, 1)).toBe(false)
    expect(ledger.advanceSchedule(r0.snapshot.tasks[0].id, 1, 1)).toBe(false) // no schedule set
  })

  it('marks a past one-shot dueAt failed instead of replaying it', () => {
    const { ledger, setNow } = makeLedger()
    setNow(1000)
    const c = ledger.apply({ requestId: 'c1', action: {
      kind: 'create',
      input: { title: 'late', description: '', prompt: '', startAt: 1000, endAt: 2000, urgency: 'high', importance: 'high' },
      schedule: { enabled: true, dueAt: 500 },
    } })
    if (!c.ok) throw new Error('create failed')
    const task = c.snapshot.tasks[0]
    expect(task.schedule).toBeUndefined()
    expect(task.executions).toHaveLength(1)
    expect(task.executions[0]).toMatchObject({
      triggeredBy: 'schedule', startedAt: 500, endedAt: 1000, result: 'failed',
    })
    expect(task.executions[0].error).toContain('dueAt was missed')
  })

  it('marks a stale persisted one-shot failed during Host reload', () => {
    const persist = new MemoryPersist()
    const stale = new HostLedger(persist, () => 0, () => 'task-1')
    const created = stale.apply({ requestId: 'c1', action: {
      kind: 'create',
      input: { title: 'late', description: '', prompt: '', startAt: 1000, endAt: 2000, urgency: 'high', importance: 'high' },
      schedule: { enabled: true, dueAt: 5000 },
    } })
    if (!created.ok) throw new Error('create failed')
    persist.doc!.tasks = persist.doc!.tasks.map(task => task.id === created.snapshot.tasks[0].id
      ? { ...task, schedule: { ...task.schedule!, dueAt: 500, nextRunAt: 500 } }
      : task)

    const reloaded = new HostLedger(persist, () => 1000, () => 'missed-execution')
    const task = reloaded.taskById(created.snapshot.tasks[0].id)!
    expect(task.schedule).toBeUndefined()
    expect(task.executions.at(-1)).toMatchObject({ result: 'failed', startedAt: 500, endedAt: 1000 })
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

  it('keeps a non-triggering repeat rule when a schedule is rolled forward', () => {
    const { ledger } = makeLedger()
    const c = ledger.apply({ requestId: 'c2', action: {
      kind: 'setSchedule',
      id: (() => { const r = ledger.apply(createEnvelope('r0')); return r.ok ? r.snapshot.tasks[0].id : '' })(),
      patch: { enabled: true, repeat: { kind: 'daily' } },
    } })
    if (!c.ok) throw new Error('setSchedule failed')
    const id = c.snapshot.tasks[0].id
    expect(ledger.taskById(id)!.schedule?.nextRunAt).toBeUndefined() // no triggerAgent means no run instant
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
    // Small horizon so create/setSchedule materialize deterministically in tests.
    const ledger = new HostLedger(persist, () => at(2025, 1, 6, 8), () => `copy-${++n}`, undefined, { repeatHorizonDays: 3 })
    return { ledger, persist }
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
    // The template is the newest task without an originTaskId (copies follow it
    // in the snapshot after the immediate materialization sweep).
    const tpl = [...r.snapshot.tasks].reverse().find(t => t.originTaskId === undefined)!
    return tpl.id
  }

  it('materializes daily copies from the day after the template through the horizon', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily' })
    // Creating with a repeat materializes immediately (no scheduler tick).
    const copies = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(copies).toHaveLength(3) // 01-07, 01-08, 01-09
    expect(copies[0].startAt).toBe(at(2025, 1, 7, 9))
    expect(copies[0].endAt).toBe(at(2025, 1, 7, 10))
    expect(ledger.taskById(id)!.schedule?.materialized).toEqual(['2025-01-07', '2025-01-08', '2025-01-09'])
    // Idempotent: a second sweep changes nothing.
    expect(ledger.materializeRepeats(at(2025, 1, 6, 8), 3)).toBe(false)
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)).toHaveLength(3)
  })

  it('does not materialize repeat dates that were missed before the sweep', () => {
    const persist = new MemoryPersist()
    let now = at(2025, 1, 1, 8)
    let n = 0
    const ledger = new HostLedger(persist, () => now, () => `repeat-${++n}`, undefined, { repeatHorizonDays: 0 })
    const created = ledger.apply({ requestId: 'repeat-late', action: {
      kind: 'create',
      input: {
        title: 'Daily', description: '', prompt: '', startAt: at(2025, 1, 1, 9), endAt: at(2025, 1, 1, 10),
        urgency: 'high', importance: 'high',
      },
      schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true } },
    } })
    if (!created.ok) throw new Error('create failed')
    const id = created.snapshot.tasks[0].id
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)).toHaveLength(0)

    now = at(2025, 1, 5, 12)
    expect(ledger.materializeRepeats(now, 3)).toBe(true)
    const copies = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(copies.every(copy => copy.startAt >= at(2025, 1, 6))).toBe(true)
    expect(copies.some(copy => copy.startAt < at(2025, 1, 5))).toBe(false)
  })

  it('arming a repeat via setSchedule materializes immediately', () => {
    const { ledger } = makeMaterializingLedger()
    const c = ledger.apply(createEnvelope('r0'))
    if (!c.ok) throw new Error('create failed')
    const id = c.snapshot.tasks[0].id
    expect(ledger.apply({ requestId: 'sched', action: { kind: 'setSchedule', id, patch: { enabled: true, repeat: { kind: 'daily' } } } }).ok).toBe(true)
    const copies = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(copies).toHaveLength(3) // 01-07..01-09
    expect(copies[0].startAt).toBeGreaterThan(0)
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

  it('deleteInstance removes one bound copy without touching the series', () => {
    const { ledger, persist } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily', triggerAgent: true })
    const copy = ledger.getSnapshot().tasks.find(t => t.originTaskId === id)!
    expect(ledger.apply({ requestId: 'delete-instance-copy', action: { kind: 'deleteInstance', id: copy.id } }).ok).toBe(true)
    expect(ledger.taskById(copy.id)).toBeUndefined()
    expect(persist.doc?.scheduler.nextRuns[copy.id]).toBeUndefined()
    expect(ledger.taskById(id)!.schedule?.repeat?.kind).toBe('daily')
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)).toHaveLength(2)
    expect(ledger.materializeRepeats(at(2025, 1, 6, 8), 3)).toBe(false)
  })

  it('deleteInstance removes the template occurrence but keeps the future series and copy schedules', () => {
    const { ledger, persist } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily', triggerAgent: true })
    const beforeCopies = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(beforeCopies).toHaveLength(3)

    expect(ledger.apply({ requestId: 'delete-instance-template', action: { kind: 'deleteInstance', id } }).ok).toBe(true)
    const template = ledger.taskById(id)!
    expect(template.schedule?.repeat?.triggerAgent).toBe(true)
    expect(template.schedule?.deletedDates).toEqual(['2025-01-06'])
    expect(template.schedule?.nextRunAt).toBeUndefined()
    expect(persist.doc?.scheduler.nextRuns[id]).toBeUndefined()
    const afterCopies = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(afterCopies).toHaveLength(3)
    expect(afterCopies.every(t => t.schedule?.enabled === true && t.schedule?.nextRunAt === t.schedule?.dueAt)).toBe(true)
    expect(ledger.materializeRepeats(at(2025, 1, 6, 8), 3)).toBe(false)

    const reloaded = new HostLedger(persist, () => at(2025, 1, 6, 8), () => 'reloaded')
    expect(reloaded.taskById(id)?.schedule?.deletedDates).toEqual(['2025-01-06'])
    expect(reloaded.getSnapshot().tasks.filter(t => t.originTaskId === id)).toHaveLength(3)
  })

  it('deleting a repeat template cascades to its bound copies (unbound survive)', () => {
    const { ledger, persist } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily', triggerAgent: true })
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
    for (const removed of tasksBefore.filter(t => t.id === id || t.originTaskId === id)) {
      if (removed.id === copy.id) continue
      expect(persist.doc?.scheduler.nextRuns[removed.id]).toBeUndefined()
    }
    expect(persist.doc?.scheduler.nextRuns[copy.id]).toBeDefined()
  })

  it('rejects deleteInstance for a standalone task', () => {
    const { ledger } = makeMaterializingLedger()
    const created = ledger.apply(createEnvelope('standalone-delete-instance'))
    if (!created.ok) throw new Error('create failed')
    const id = created.snapshot.tasks[0].id
    expect(ledger.apply({ requestId: 'invalid-delete-instance', action: { kind: 'deleteInstance', id } }).ok).toBe(false)
    expect(ledger.taskById(id)).toBeDefined()
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

  it('reschedule does not re-arm a settled one-shot or backfill a past move', () => {
    const persist = new MemoryPersist()
    let now = at(2025, 1, 6, 8)
    let n = 0
    const ledger = new HostLedger(persist, () => now, () => `reschedule-${++n}`)
    const created = ledger.apply({ requestId: 'one-shot', action: {
      kind: 'create',
      input: { title: 'One shot', description: '', prompt: '', startAt: at(2025, 1, 6, 9), endAt: at(2025, 1, 6, 10), urgency: 'high', importance: 'high' },
      schedule: { enabled: true, dueAt: at(2025, 1, 6, 9) },
    } })
    if (!created.ok) throw new Error('create failed')
    const id = created.snapshot.tasks[0].id

    now = at(2025, 1, 6, 9)
    expect(ledger.openExecution(id, 'failed-once', now, 'schedule')).toBe(true)
    now = at(2025, 1, 6, 9, 1)
    expect(ledger.settleExecution(id, 'failed-once', 'failed', now, 'setup failed')).toBe(true)
    expect(ledger.advanceSchedule(id, undefined, at(2025, 1, 6, 9))).toBe(true)
    expect(ledger.taskById(id)!.schedule).toBeUndefined()

    // Moving to a new future slot only moves the calendar block. The failed
    // one-shot remains settled and does not create an implicit new occurrence.
    now = at(2025, 1, 6, 10)
    const moved = ledger.apply({ requestId: 'move-future', action: {
      kind: 'reschedule', id, startAt: at(2025, 1, 6, 12), endAt: at(2025, 1, 6, 13),
    } })
    expect(moved.ok).toBe(true)
    expect(ledger.taskById(id)!.schedule).toBeUndefined()
    expect(ledger.taskById(id)!.executions).toHaveLength(1)

    // Moving the settled task into the past still does not synthesize another
    // failed execution.
    now = at(2025, 1, 6, 14)
    const past = ledger.apply({ requestId: 'move-past', action: {
      kind: 'reschedule', id, startAt: at(2025, 1, 6, 13), endAt: at(2025, 1, 6, 13, 30),
    } })
    expect(past.ok).toBe(true)
    expect(ledger.taskById(id)!.schedule).toBeUndefined()
    expect(ledger.taskById(id)!.executions).toHaveLength(1)
  })

  it('reschedule does not re-arm a one-shot after a scheduled run succeeds', () => {
    const persist = new MemoryPersist()
    let now = at(2025, 1, 6, 8)
    const ledger = new HostLedger(persist, () => now, () => 'reschedule-success')
    const created = ledger.apply({ requestId: 'one-shot-success', action: {
      kind: 'create',
      input: { title: 'One shot', description: '', prompt: '', startAt: at(2025, 1, 6, 9), endAt: at(2025, 1, 6, 10), urgency: 'high', importance: 'high' },
      schedule: { enabled: true, dueAt: at(2025, 1, 6, 9) },
    } })
    if (!created.ok) throw new Error('create failed')
    const id = created.snapshot.tasks[0].id

    now = at(2025, 1, 6, 9)
    expect(ledger.openExecution(id, 'success-once', now, 'schedule')).toBe(true)
    now = at(2025, 1, 6, 9, 1)
    expect(ledger.settleExecution(id, 'success-once', 'succeeded', now, undefined)).toBe(true)
    expect(ledger.advanceSchedule(id, undefined, at(2025, 1, 6, 9))).toBe(true)
    expect(ledger.taskById(id)!.schedule).toBeUndefined()

    now = at(2025, 1, 6, 10)
    const moved = ledger.apply({ requestId: 'move-after-success', action: {
      kind: 'reschedule', id, startAt: at(2025, 1, 6, 12), endAt: at(2025, 1, 6, 13),
    } })
    expect(moved.ok).toBe(true)
    expect(ledger.taskById(id)!.schedule).toBeUndefined()
    expect(ledger.taskById(id)!.executions).toHaveLength(1)
  })

  it('keeps an armed one-shot dueAt absolute when its block is moved', () => {
    const persist = new MemoryPersist()
    let now = at(2025, 1, 6, 8)
    const ledger = new HostLedger(persist, () => now, () => 'reschedule-pending')
    const created = ledger.apply({ requestId: 'one-shot-pending', action: {
      kind: 'create',
      input: { title: 'One shot', description: '', prompt: '', startAt: at(2025, 1, 6, 9), endAt: at(2025, 1, 6, 10), urgency: 'high', importance: 'high' },
      schedule: { enabled: true, dueAt: at(2025, 1, 6, 9) },
    } })
    if (!created.ok) throw new Error('create failed')
    const id = created.snapshot.tasks[0].id

    now = at(2025, 1, 6, 8, 30)
    const moved = ledger.apply({ requestId: 'move-pending', action: {
      kind: 'reschedule', id, startAt: at(2025, 1, 6, 12), endAt: at(2025, 1, 6, 13),
    } })
    expect(moved.ok).toBe(true)
    expect(ledger.taskById(id)!.schedule).toMatchObject({
      enabled: true, dueAt: at(2025, 1, 6, 9), nextRunAt: at(2025, 1, 6, 9),
    })
    expect(persist.doc?.scheduler.nextRuns[id]).toMatchObject({ nextRunAt: at(2025, 1, 6, 9) })
  })

  it('keeps a repeat triggerAt independent from the moved block time', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily', triggerAgent: true, triggerAt: '18:00' })
    const moved = ledger.apply({ requestId: 'fixed-trigger', action: {
      kind: 'reschedule', id, startAt: at(2025, 1, 6, 10), endAt: at(2025, 1, 6, 11),
    } })
    expect(moved.ok).toBe(true)
    expect(ledger.taskById(id)!.schedule?.nextRunAt).toBe(at(2025, 1, 6, 18))
  })

  it('reschedules one repeat copy only and keeps the fixed trigger time-of-day', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily', triggerAgent: true, triggerAt: '18:00' })
    const copy = ledger.getSnapshot().tasks.find(t => t.originTaskId === id)!
    const moved = ledger.apply({ requestId: 'copy-only', action: {
      kind: 'reschedule', id: copy.id, startAt: at(2025, 1, 7, 12), endAt: at(2025, 1, 7, 13), unbind: true,
    } })
    expect(moved.ok).toBe(true)
    expect(ledger.taskById(copy.id)!.originTaskId).toBeUndefined()
    expect(ledger.taskById(copy.id)!.schedule).toMatchObject({
      dueAt: at(2025, 1, 7, 18), nextRunAt: at(2025, 1, 7, 18),
    })
    expect(ledger.taskById(id)!.startAt).toBe(at(2025, 1, 6, 9))
  })

  it('shifts only future repeat copies and does not create a missed record', () => {
    const persist = new MemoryPersist()
    let now = at(2025, 1, 6, 8)
    let n = 0
    const ledger = new HostLedger(persist, () => now, () => `future-only-${++n}`, undefined, { repeatHorizonDays: 3 })
    const created = ledger.apply({ requestId: 'future-series', action: {
      kind: 'create',
      input: { title: 'Series', description: '', prompt: '', startAt: at(2025, 1, 6, 9), endAt: at(2025, 1, 6, 10), urgency: 'high', importance: 'high' },
      schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true } },
    } })
    if (!created.ok) throw new Error('create failed')
    const id = created.snapshot.tasks[0].id
    const original = new Map(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id).map(t => [t.id, t]))

    now = at(2025, 1, 8, 10)
    const shifted = ledger.apply({ requestId: 'future-shift', action: {
      kind: 'shiftRepeatTimes', id, startDelta: 60 * 60_000, endDelta: 60 * 60_000,
    } })
    expect(shifted.ok).toBe(true)
    const tasks = ledger.getSnapshot().tasks
    const pastCopies = tasks.filter(t => t.originTaskId === id && (original.get(t.id)?.startAt ?? 0) <= at(2025, 1, 8, 9))
    expect(pastCopies).toHaveLength(2)
    for (const copy of pastCopies) {
      expect(copy.startAt).toBe(original.get(copy.id)!.startAt)
    }
    const futureCopy = tasks.find(t => t.originTaskId === id && original.get(t.id)?.startAt === at(2025, 1, 9, 9))!
    expect(futureCopy.startAt).toBe(at(2025, 1, 9, 10))
    expect(futureCopy.schedule?.nextRunAt).toBe(at(2025, 1, 9, 10))
    expect(ledger.taskById(id)!.executions).toHaveLength(0)
  })

  it('rejects shiftRepeatTimes for a non-copy task', () => {
    const { ledger } = makeMaterializingLedger()
    const r = ledger.apply(createEnvelope('r0'))
    if (!r.ok) throw new Error('create failed')
    const id = r.snapshot.tasks[0].id
    const s = ledger.apply({ requestId: 's', action: { kind: 'shiftRepeatTimes', id, startDelta: 1, endDelta: 1 } })
    expect(s.ok).toBe(false)
  })

  it('clearing the repeat rule (setSchedule repeat:null) deletes the bound copies', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily' })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 3)
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)).toHaveLength(3)
    const r = ledger.apply({ requestId: 'clear', action: { kind: 'setSchedule', id, patch: { enabled: false, repeat: null, dueAt: null } } })
    expect(r.ok).toBe(true)
    expect(ledger.taskById(id)!.schedule?.repeat).toBeUndefined()
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)).toHaveLength(0) // copies gone
    expect(ledger.taskById(id)).toBeDefined() // the original task itself stays
  })

  it('reducing repeat weekdays prunes bound copies on the removed days (and re-copies when re-added)', () => {
    const { ledger } = makeMaterializingLedger()
    // Weekly every day with a 7-day horizon → copies on 01-07..01-13 (all 7 weekdays).
    const id = createWithRepeat(ledger, { kind: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 7)
    const daysOf = (ts: number[]): number[] => ts.map(t => new Date(t).getDay()).sort((a, b) => a - b)
    expect(daysOf(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id).map(c => c.startAt))).toEqual([0, 1, 2, 3, 4, 5, 6])

    // Narrow to Mon-Fri: the Sat 01-11 / Sun 01-12 copies must disappear.
    const r = ledger.apply({ requestId: 'narrow', action: { kind: 'setSchedule', id, patch: { enabled: true, repeat: { kind: 'weekly', weekdays: [1, 2, 3, 4, 5] } } } })
    expect(r.ok).toBe(true)
    const narrowed = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(daysOf(narrowed.map(c => c.startAt))).toEqual([1, 2, 3, 4, 5])
    expect(narrowed).toHaveLength(5)
    expect(ledger.taskById(id)!.schedule?.materialized).not.toContain('2025-01-11')
    expect(ledger.taskById(id)!.schedule?.materialized).not.toContain('2025-01-12')

    // Re-add Sat/Sun: their keys were dropped, so the next full-horizon sweep
    // re-materializes them (in production the inline setSchedule sweep already
    // covers the 60-day horizon; the test ledger's 3-day horizon needs an
    // explicit wide sweep).
    const r2 = ledger.apply({ requestId: 'widen', action: { kind: 'setSchedule', id, patch: { enabled: true, repeat: { kind: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] } } } })
    expect(r2.ok).toBe(true)
    expect(ledger.materializeRepeats(at(2025, 1, 6, 8), 7)).toBe(true)
    expect(daysOf(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id).map(c => c.startAt))).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('toggling holiday-skip prunes weekend copies of a daily series', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily' })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 7) // copies on 01-07..01-13 incl. Sat 11 / Sun 12
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)).toHaveLength(7)
    const r = ledger.apply({ requestId: 'holiday-skip', action: { kind: 'setSchedule', id, patch: { enabled: true, repeat: { kind: 'daily', skipHolidays: true } } } })
    expect(r.ok).toBe(true)
    const kept = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(kept).toHaveLength(5) // Sat 11 / Sun 12 pruned
    expect(kept.every(c => !(new Date(c.startAt).getDay() === 0 || new Date(c.startAt).getDay() === 6))).toBe(true)
  })

  it('prunes orphaned copies at load when the template no longer has a repeat rule', () => {
    const persist = new MemoryPersist()
    let n = 0
    const a = new HostLedger(persist, () => at(2025, 1, 6, 8), () => `t-${++n}`)
    const id = createWithRepeat(a, { kind: 'daily' })
    a.materializeRepeats(at(2025, 1, 6, 8), 3)
    // Clear the rule while "the Host is down" by editing the persisted doc.
    persist.doc!.tasks = persist.doc!.tasks.map(t => t.id === id ? { ...t, schedule: { enabled: false } } : t)
    const b = new HostLedger(persist, () => at(2025, 1, 6, 8), () => `t-${++n}`)
    expect(b.getSnapshot().tasks.filter(t => t.originTaskId === id)).toHaveLength(0)
    expect(b.taskById(id)).toBeDefined()
    expect(persist.doc!.tasks.length).toBe(1) // pruned state persisted
  })

  it('syncs template content + pins to bound copies; times/done stay per-instance', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily' })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 3)
    const copy = ledger.getSnapshot().tasks.find(t => t.originTaskId === id)!
    const r = ledger.apply({ requestId: 'u', action: { kind: 'update', id, patch: { title: 'New title', provider: 'p2', model: 'm2', startAt: 12345, endAt: 23456 } } })
    expect(r.ok).toBe(true)
    const snap = ledger.getSnapshot().tasks
    expect(ledger.taskById(id)!.title).toBe('New title')
    expect(ledger.taskById(id)!.provider).toBe('p2')
    expect(ledger.taskById(id)!.model).toBe('m2')
    for (const c of snap.filter(t => t.originTaskId === id)) {
      expect(c.title).toBe('New title') // content synced
      expect(c.model).toBe('m2') // pins synced
      expect(c.startAt).not.toBe(12345) // times NOT synced
    }
    // Editing a copy stays local.
    const u2 = ledger.apply({ requestId: 'u2', action: { kind: 'update', id: copy.id, patch: { title: 'Copy only' } } })
    expect(u2.ok).toBe(true)
    expect(ledger.taskById(copy.id)!.title).toBe('Copy only')
    expect(ledger.taskById(id)!.title).toBe('New title')
    // Marking the template done does not propagate.
    const d = ledger.apply({ requestId: 'd', action: { kind: 'setDone', id, done: true } })
    expect(d.ok).toBe(true)
    expect(ledger.taskById(id)!.done).toBe(true)
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id).every(c => c.done === false)).toBe(true)
  })

  it('propagates quadrant and subtask structure from the template, not done-state', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily' })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 3)
    expect(ledger.apply({ requestId: 'q', action: { kind: 'setQuadrant', id, urgency: 'low', importance: 'high' } }).ok).toBe(true)
    expect(ledger.apply({ requestId: 'a', action: { kind: 'addSubtask', id, subtaskId: 's1', title: 'step' } }).ok).toBe(true)
    const snap = ledger.getSnapshot().tasks
    for (const c of snap.filter(t => t.originTaskId === id)) {
      expect(c.urgency).toBe('low')
      expect(c.importance).toBe('high')
      expect(c.subtasks.some(s => s.id === 's1' && s.title === 'step')).toBe(true)
      expect(c.subtasks.some(s => s.id === 's1' && s.done)).toBe(false)
    }
    // Checking the subtask off on the template stays local.
    expect(ledger.apply({ requestId: 'sd', action: { kind: 'setSubtaskDone', id, subtaskId: 's1', done: true } }).ok).toBe(true)
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id).every(c => !c.subtasks[0].done)).toBe(true)
    expect(ledger.taskById(id)!.subtasks[0].done).toBe(true)
    // Removing the subtask removes it everywhere.
    expect(ledger.apply({ requestId: 'r', action: { kind: 'removeSubtask', id, subtaskId: 's1' } }).ok).toBe(true)
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id).every(c => c.subtasks.length === 0)).toBe(true)
  })

  it('shiftRepeatTimes also works when initiated from the template', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily' })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 3)
    const r = ledger.apply({ requestId: 'shift', action: { kind: 'shiftRepeatTimes', id, startDelta: 30 * 60_000, endDelta: 30 * 60_000 } })
    expect(r.ok).toBe(true)
    expect(ledger.taskById(id)!.startAt).toBe(at(2025, 1, 6, 9, 30))
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id).every(c => new Date(c.startAt).getMinutes() === 30)).toBe(true)
  })

  it('materializes trigger-agent copies with a one-shot due at the trigger instant', () => {
    const { ledger } = makeMaterializingLedger()
    // daily + triggerAgent, no triggerAt → block start (09:00); horizon 3 → copies 01-07..09 with dueAt 09:00.
    const id = createWithRepeat(ledger, { kind: 'daily', triggerAgent: true })
    expect(ledger.taskById(id)!.schedule?.nextRunAt).toBe(at(2025, 1, 6, 9)) // template is today's first occurrence
    ledger.materializeRepeats(at(2025, 1, 6, 8), 3)
    const copies = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(copies).toHaveLength(3)
    for (const c of copies) {
      expect(c.schedule?.enabled).toBe(true)
      expect(c.schedule?.dueAt).toBe(at(new Date(c.startAt).getFullYear(), new Date(c.startAt).getMonth() + 1, new Date(c.startAt).getDate(), 9))
      expect(c.schedule?.nextRunAt).toBe(c.schedule?.dueAt) // in the future
      expect(c.schedule?.repeat).toBeUndefined()
    }
    // With an explicit triggerAt override the due shifts to that time-of-day.
    const id2 = createWithRepeat(ledger, { kind: 'daily', triggerAgent: true, triggerAt: '07:30' })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 3)
    const copies2 = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id2)
    expect(copies2.length).toBeGreaterThan(0)
    for (const c of copies2) {
      expect(c.schedule?.dueAt).toBe(at(new Date(c.startAt).getFullYear(), new Date(c.startAt).getMonth() + 1, new Date(c.startAt).getDate(), 7, 30))
    }
  })

  it('arms or fails the first repeat occurrence when the Host reloads', () => {
    const persist = new MemoryPersist()
    const start = at(2025, 1, 6, 9)
    const created = new HostLedger(persist, () => at(2025, 1, 6, 8), () => 'template')
    const result = created.apply({ requestId: 'repeat-first', action: {
      kind: 'create',
      input: { title: 'Daily', description: '', prompt: '', startAt: start, endAt: at(2025, 1, 6, 10), urgency: 'high', importance: 'high' },
      schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true } },
    } })
    if (!result.ok) throw new Error('create failed')
    const id = result.snapshot.tasks[0].id

    // Simulate a ledger written by the previous behavior: the template had no
    // first-occurrence nextRunAt, even though its trigger is still enabled.
    persist.doc!.tasks = persist.doc!.tasks.map(task => task.id === id
      ? { ...task, schedule: { ...task.schedule!, nextRunAt: undefined } }
      : task)
    const future = new HostLedger(persist, () => at(2025, 1, 6, 8, 30), () => 'future')
    expect(future.taskById(id)!.schedule?.nextRunAt).toBe(start)

    // Once that first occurrence is past, reload records the miss and never
    // leaves a due slot that the scheduler could replay.
    persist.doc!.tasks = persist.doc!.tasks.map(task => task.id === id
      ? { ...task, schedule: { ...task.schedule!, nextRunAt: start } }
      : task)
    const late = new HostLedger(persist, () => at(2025, 1, 6, 10), () => 'missed-repeat')
    const task = late.taskById(id)!
    expect(task.schedule?.repeat?.triggerAgent).toBe(true)
    expect(task.schedule?.nextRunAt).toBeUndefined()
    expect(task.executions.at(-1)).toMatchObject({
      triggeredBy: 'schedule', startedAt: start, result: 'failed', endedAt: at(2025, 1, 6, 10),
    })
  })

  it('routes a copy schedule edit to the series: clearing the repeat on a copy cancels all future copies', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily' })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 3)
    const copy = ledger.getSnapshot().tasks.find(t => t.originTaskId === id)!
    // The copy's schedule section shows the series rule; clearing it on the copy
    // must cancel the whole series (template rule gone + bound copies removed).
    const r = ledger.apply({ requestId: 'clear-copy', action: { kind: 'setSchedule', id: copy.id, patch: { enabled: false, repeat: null, dueAt: null } } })
    expect(r.ok).toBe(true)
    expect(ledger.taskById(id)!.schedule?.repeat).toBeUndefined()
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)).toHaveLength(0)
    expect(ledger.taskById(copy.id)).toBeUndefined()
  })

  it('routes a copy schedule edit to the series: trigger toggles re-derive the bound copies', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily', triggerAgent: true })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 3)
    const copy = ledger.getSnapshot().tasks.find(t => t.originTaskId === id)!
    expect(copy.schedule).toBeDefined()

    // Turn trigger off via the copy: future bound copies lose their one-shots.
    const off = ledger.apply({ requestId: 'off', action: { kind: 'setSchedule', id: copy.id, patch: { enabled: true, repeat: { kind: 'daily', triggerAgent: false } } } })
    expect(off.ok).toBe(true)
    expect(ledger.getSnapshot().tasks.filter(t => t.originTaskId === id).every(c => c.schedule === undefined)).toBe(true)
    expect(ledger.taskById(id)!.schedule?.repeat?.triggerAgent).toBe(false)

    // Turn trigger back on with an override via the copy: copies get the new due.
    const on = ledger.apply({ requestId: 'on', action: { kind: 'setSchedule', id: copy.id, patch: { enabled: true, repeat: { kind: 'daily', triggerAgent: true, triggerAt: '08:15' } } } })
    expect(on.ok).toBe(true)
    for (const c of ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)) {
      expect(c.schedule?.dueAt).toBe(at(new Date(c.startAt).getFullYear(), new Date(c.startAt).getMonth() + 1, new Date(c.startAt).getDate(), 8, 15))
    }
  })

  it('does not route a schedule edit on an unbound copy', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily' })
    ledger.materializeRepeats(at(2025, 1, 6, 8), 3)
    const copy = ledger.getSnapshot().tasks.find(t => t.originTaskId === id)!
    // Unbind the copy first.
    expect(ledger.apply({ requestId: 'unbind', action: { kind: 'update', id: copy.id, patch: { originTaskId: null } } }).ok).toBe(true)
    const futureDueAt = at(2025, 1, 10, 9)
    const r = ledger.apply({ requestId: 'self', action: { kind: 'setSchedule', id: copy.id, patch: { enabled: true, dueAt: futureDueAt } } })
    expect(r.ok).toBe(true)
    expect(ledger.taskById(copy.id)!.schedule?.dueAt).toBe(futureDueAt)
    expect(ledger.taskById(id)!.schedule?.repeat?.kind).toBe('daily') // template untouched
  })

  it('clearInstanceSchedule drops one copy trigger without touching the series', () => {
    const { ledger } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily', triggerAgent: true })
    const copies = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(copies).toHaveLength(3)
    const copy = copies[0]
    expect(copy.schedule?.enabled).toBe(true)

    const r = ledger.apply({ requestId: 'day', action: { kind: 'clearInstanceSchedule', id: copy.id } })
    expect(r.ok).toBe(true)
    const after = ledger.getSnapshot().tasks
    expect(after.find(t => t.id === copy.id)!.schedule).toBeUndefined() // own one-shot gone
    expect(after.find(t => t.id === copy.id)!.originTaskId).toBe(id) // still bound
    expect(ledger.taskById(id)!.schedule?.repeat?.triggerAgent).toBe(true) // series intact
    expect(after.filter(t => t.originTaskId === id)).toHaveLength(3) // copy kept on the calendar
  })

  it('clearInstanceSchedule skips the template date without stopping the series', () => {
    const { ledger, persist } = makeMaterializingLedger()
    const id = createWithRepeat(ledger, { kind: 'daily', triggerAgent: true })
    const template = ledger.taskById(id)!
    expect(template.schedule?.nextRunAt).toBe(at(2025, 1, 6, 9))

    const r = ledger.apply({ requestId: 'template-day', action: { kind: 'clearInstanceSchedule', id } })
    expect(r.ok).toBe(true)
    const after = ledger.taskById(id)!
    expect(after.schedule?.repeat?.triggerAgent).toBe(true)
    expect(after.schedule?.skippedDates).toEqual(['2025-01-06'])
    expect(after.schedule?.nextRunAt).toBeUndefined()
    const copies = ledger.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(copies).toHaveLength(3)
    for (const copy of copies) {
      expect(copy.schedule?.enabled).toBe(true)
      expect(copy.schedule?.dueAt).toBeDefined()
      expect(copy.schedule?.nextRunAt).toBe(copy.schedule?.dueAt)
    }

    // The persisted state must keep both the copies and their trigger
    // one-shots; a Host restart must not turn the UI and scheduler out of sync.
    const reloaded = new HostLedger(persist, () => at(2025, 1, 6, 8), () => 'reloaded')
    const reloadedCopies = reloaded.getSnapshot().tasks.filter(t => t.originTaskId === id)
    expect(reloadedCopies).toHaveLength(3)
    expect(reloadedCopies.every(copy => copy.schedule?.enabled === true && copy.schedule?.nextRunAt === copy.schedule?.dueAt)).toBe(true)

    // A later materialization/normalization pass must not re-arm the skipped
    // template occurrence or create a duplicate same-day record.
    expect(ledger.materializeRepeats(at(2025, 1, 6, 8), 3)).toBe(false)
    expect(ledger.taskById(id)!.schedule?.nextRunAt).toBeUndefined()
  })
})
