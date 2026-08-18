import { describe, expect, it } from 'vitest'
import { HostLedger, NoopLedgerPersist, type HostLedgerPersist } from '../src/host-ledger.ts'
import type { CalenderActionEnvelope, CalenderSnapshot } from '../src/protocol.ts'

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

function createEnvelope(req: string): CalenderActionEnvelope {
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
    const snap: CalenderSnapshot = ledger.getSnapshot()
    expect(snap.schemaVersion).toBe(1)
    expect(typeof snap.scheduler.timeZone).toBe('string')
  })
})

describe('NoopLedgerPersist', () => {
  it('is safe', () => {
    const ledger = new HostLedger(new NoopLedgerPersist(), () => 0, () => 'id')
    expect(ledger.getSnapshot().tasks).toEqual([])
  })
})
