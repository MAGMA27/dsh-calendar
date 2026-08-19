import { describe, expect, it } from 'vitest'
import { HostLedger, NoopLedgerPersist } from '../src/host-ledger.ts'
import { HostExecutionRunner, type HostExecutionEnv } from '../src/host-runner.ts'
import type { RunnerSessionRow } from '../src/host-runner.ts'

function ledgerWithRunning(tid: string, sid: string, startedAt: number) {
  const ledger = new HostLedger(new NoopLedgerPersist(), () => 1000, () => 'x')
  ledger.apply({ requestId: 'i1', action: { kind: 'import', sourceId: 'test', tasks: [{
    id: tid, title: 'T', description: '', prompt: '', startAt: 0, endAt: 1000,
    urgency: 'high', importance: 'high', done: false, subtasks: [], createdAt: 0, updatedAt: 0,
    executions: [{ id: 'e1', startedAt, sessionId: sid }],
  } as never] } })
  return ledger
}

function makeEnv(rows?: RunnerSessionRow[], listEmpty = false): HostExecutionEnv {
  return {
    workspace: { list: async () => ({ result: { ok: true, value: { items: [{ workspaceId: 'w1' }] } } }) },
    sessions: {
      list: async () => listEmpty ? { result: { ok: true, value: { items: [] } } } : { result: { ok: true, value: { items: rows ?? [] } } },
      create: async () => ({ result: { ok: true, value: { sessionId: 's' } } }),
      selectModel: async () => ({ result: { ok: true } }),
      rename: async () => ({ result: { ok: true } }),
      prompt: async () => ({ result: { ok: true } }),
    },
    agentPresets: { select: async () => ({ result: { ok: true } }) },
  }
}

describe('HostExecutionRunner.reconcile', () => {
  it('cancels an execution whose session is gone', async () => {
    const ledger = ledgerWithRunning('t', 's-gone', 500)
    const runner = new HostExecutionRunner(ledger, makeEnv(undefined, true), { now: () => 1000, sleep: async () => {} })
    expect(await runner.reconcile('t')).toBe(true)
    const ex = ledger.taskById('t')!.executions[0]
    expect(ex.result).toBe('cancelled')
    expect(ex.error).toContain('no longer exists')
  })

  it('succeeds an execution whose session stopped with evidence', async () => {
    const ledger = ledgerWithRunning('t', 's-done', 500)
    const runner = new HostExecutionRunner(ledger, makeEnv([{ sessionId: 's-done', running: false, updatedAt: 2000 }]), { now: () => 1000, sleep: async () => {} })
    expect(await runner.reconcile('t')).toBe(true)
    expect(ledger.taskById('t')!.executions[0].result).toBe('succeeded')
  })

  it('leaves an execution whose session is still running', async () => {
    const ledger = ledgerWithRunning('t', 's-run', 500)
    const runner = new HostExecutionRunner(ledger, makeEnv([{ sessionId: 's-run', running: true, updatedAt: 2000 }]), { now: () => 1000, sleep: async () => {} })
    expect(await runner.reconcile('t')).toBe(false)
    expect(ledger.taskById('t')!.executions[0].endedAt).toBeUndefined()
  })

  it('leaves an execution with no session id untouched', async () => {
    const ledger = new HostLedger(new NoopLedgerPersist(), () => 1000, () => 'x')
    ledger.apply({ requestId: 'i1', action: { kind: 'import', sourceId: 't', tasks: [{
      id: 't', title: 'T', description: '', prompt: '', startAt: 0, endAt: 1000,
      urgency: 'high', importance: 'high', done: false, subtasks: [], createdAt: 0, updatedAt: 0,
      executions: [{ id: 'e1', startedAt: 500 }],
    } as never] } })
    const runner = new HostExecutionRunner(ledger, makeEnv([]), { now: () => 1000, sleep: async () => {} })
    expect(await runner.reconcile('t')).toBe(false)
  })
})
