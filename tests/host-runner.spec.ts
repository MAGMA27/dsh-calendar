import { describe, expect, it } from 'vitest'
import { HostLedger, NoopLedgerPersist } from '../src/host-ledger.ts'
import { HostExecutionRunner, type HostExecutionEnv, type RunnerSessionRow } from '../src/host-runner.ts'
import type { calendarActionEnvelope } from '../src/protocol.ts'

type SleepGate = () => void

function mkLedger(overrides: Record<string, unknown> = {}) {
  const ledger = new HostLedger(new NoopLedgerPersist(), () => 1000, () => 'task-1')
  const create: calendarActionEnvelope = {
    requestId: 'c1',
    action: {
      kind: 'create',
      input: {
        title: 'T', description: '', prompt: 'Do the thing', startAt: 0, endAt: 1000,
        urgency: 'high', importance: 'high', workspaceId: 'w1', provider: 'dp', model: 'chat',
        ...overrides,
      },
    },
  }
  const r = ledger.apply(create)
  if (!r.ok) throw new Error('create failed')
  return { ledger, id: r.snapshot.tasks[0].id }
}

/** Build a fake runtime + a controllable sleep: each sleep parks on a gate. */
function makeHarness(opts: {
  rows?: RunnerSessionRow[]
  listEmpty?: boolean
  createOk?: boolean
  promptOk?: boolean
  modelOk?: boolean
  presetOk?: boolean
  commandOk?: boolean
  commandFound?: boolean
  hasAgent?: boolean
} = {}) {
  const calls = { create: 0, selectModel: 0, prompt: 0, rename: 0, presetsSelect: 0, list: 0, commands: 0 }
  const rows: RunnerSessionRow[] = opts.rows ?? []
  const gates: SleepGate[] = []
  const env: HostExecutionEnv = {
    workspace: { list: async () => ({ result: { ok: true, value: { items: [{ workspaceId: 'w1' }] } } }) },
    sessions: {
      list: async () => {
        calls.list++
        if (opts.listEmpty) return { result: { ok: true, value: { items: [] } } }
        return { result: { ok: true, value: { items: [...rows] } } }
      },
      create: async () => {
        calls.create++
        const sid = 'new-session'
        rows.length = 0
        rows.push({ sessionId: sid, running: true, updatedAt: 2000 })
        return { result: { ok: opts.createOk ?? true, value: { sessionId: sid } } }
      },
      selectModel: async () => { calls.selectModel++; return { result: { ok: opts.modelOk ?? true } } },
      rename: async () => { calls.rename++; return { result: { ok: true } } },
      prompt: async (request: { payload: { sessionId: unknown; content?: { type: string; text: string }[] } }) => {
        calls.prompt++
        const text = request.payload.content?.[0]?.text ?? ''
        const sid = String(request.payload.sessionId)
        const row = rows.find(r => String(r.sessionId) === sid)
        if (text.startsWith('/permission')) return { result: { ok: opts.promptOk ?? true } }
        if (row !== undefined) { row.running = true; row.updatedAt = 2500 }
        return { result: { ok: opts.promptOk ?? true } }
      },
    },
    agentPresets: { select: async () => { calls.presetsSelect++; return { result: { ok: opts.presetOk ?? true } } } },
    commands: {
      execute: async () => {
        calls.commands++
        if ((opts.commandFound ?? true) === false) return undefined
        return { result: (opts.commandOk ?? true)
          ? { kind: 'success' as const, text: 'preset workspace-write' }
          : { kind: 'error' as const, text: 'unknown preset "yolo"' } }
      },
    },
    agents: { get: () => ((opts.hasAgent ?? true) ? {} : undefined) },
  }
  return { env, calls, rows, gates }
}

function mkRunner(ledger: HostLedger, env: HostExecutionEnv, gates: SleepGate[], nowRef: { value: number } = { value: 1000 }) {
  return new HostExecutionRunner(ledger, env, {
    now: () => nowRef.value,
    uuid: () => 'exec-1',
    sleep: (_ms: number) => new Promise<void>(r => gates.push(r)),
    settleTimeoutMs: 10_000,
  })
}

/** Let an already-started async run reach its settle loop's first sleep.
 * Every stage awaits only already-resolved promises, so draining the
 * microtask queue (via one macrotask turn) reaches the park point. */
async function toSettleLoop(): Promise<void> {
  await new Promise<void>(r => setImmediate(r))
  await new Promise<void>(r => setImmediate(r))
}

describe('HostExecutionRunner', () => {
  it('creates a session, applies model + rename, sends prompt, settles succeeded', async () => {
    const { ledger, id } = mkLedger()
    const { env, calls, rows, gates } = makeHarness()
    const p = mkRunner(ledger, env, gates).run(id)
    await toSettleLoop()
    expect(calls.create).toBe(1)
    expect(calls.selectModel).toBe(1)
    expect(calls.rename).toBe(1)
    expect(calls.prompt).toBe(1)
    expect(ledger.taskById(id)!.executions[0].endedAt).toBeUndefined()
    expect(ledger.taskById(id)!.executions[0].sessionId).toBe('new-session')
    rows[0].running = false
    rows[0].updatedAt = 3000
    gates.shift()?.()
    const res = await p
    expect(res.outcome).toBe('started')
    await res.settleFinished
    const ex = ledger.taskById(id)!.executions[0]
    expect(ex.result).toBe('succeeded')
    expect(ex.sessionId).toBe('new-session')
  })

  it('reuses a pinned session, does not create one, and settles succeeded', async () => {
    const { ledger, id } = mkLedger({ sessionId: 's-pinned' })
    const { env, calls, rows, gates } = makeHarness()
    rows.push({ sessionId: 's-pinned', running: false, updatedAt: 500 })
    const p = mkRunner(ledger, env, gates).run(id)
    await toSettleLoop()
    expect(calls.create).toBe(0)
    expect(calls.prompt).toBe(1)
    rows[0].running = false
    rows[0].updatedAt = 3000
    gates.shift()?.()
    const res = await p
    await res.settleFinished
    const ex = ledger.taskById(id)!.executions[0]
    expect(ex.sessionId).toBe('s-pinned')
    expect(ex.result).toBe('succeeded')
  })

  it('marks a scheduled execution with its session before the prompt turn can call tools', async () => {
    const { ledger, id } = mkLedger()
    const { env, rows, gates } = makeHarness()
    const p = mkRunner(ledger, env, gates).run(id, 'schedule')
    await toSettleLoop()
    expect(ledger.activeScheduledExecution('new-session')).toMatchObject({ taskId: id, executionId: 'exec-1', sessionId: 'new-session' })
    rows[0].running = false
    rows[0].updatedAt = 3000
    gates.shift()?.()
    const res = await p
    await res.settleFinished
    expect(ledger.activeScheduledExecution('new-session')).toBeUndefined()
  })

  it('recomposes a blank reused session when the task pins an agent preset', async () => {
    const { ledger, id } = mkLedger({ sessionId: 's-pinned', mode: 'custom' })
    const { env, calls, rows, gates } = makeHarness()
    rows.push({ sessionId: 's-pinned', running: false, blank: true, agentPreset: 'standard', updatedAt: 500 })
    const p = mkRunner(ledger, env, gates).run(id)
    await toSettleLoop()
    expect(calls.presetsSelect).toBe(1)
    rows[0].running = false; rows[0].updatedAt = 3000
    gates.shift()?.()
    const res = await p
    await res.settleFinished
  })

  it('skips preset selection when a reused started session already has the requested preset', async () => {
    const { ledger, id } = mkLedger({ sessionId: 's-pinned', mode: 'custom' })
    const { env, calls, rows, gates } = makeHarness()
    rows.push({ sessionId: 's-pinned', running: false, blank: false, agentPreset: 'custom', updatedAt: 500 })
    const p = mkRunner(ledger, env, gates).run(id)
    await toSettleLoop()
    expect(calls.presetsSelect).toBe(0)
    expect(calls.prompt).toBe(1)
    rows[0].running = false; rows[0].updatedAt = 3000
    gates.shift()?.()
    const res = await p
    await res.settleFinished
    expect(ledger.taskById(id)!.executions[0].result).toBe('succeeded')
  })

  it('rejects a different preset on a reused started session without selecting or prompting', async () => {
    const { ledger, id } = mkLedger({ sessionId: 's-pinned', mode: 'custom' })
    const { env, calls, rows } = makeHarness()
    rows.push({ sessionId: 's-pinned', running: false, blank: false, agentPreset: 'standard', updatedAt: 500 })
    const result = await mkRunner(ledger, env, []).run(id)
    expect(result.outcome).toBe('failed')
    expect(calls.presetsSelect).toBe(0)
    expect(calls.prompt).toBe(0)
    expect(ledger.taskById(id)!.executions[0].error).toContain('cannot switch to custom')
  })

  it('fails the run when the pinned session is busy', async () => {
    const { ledger, id } = mkLedger({ sessionId: 's-busy' })
    const { env, gates } = makeHarness({ rows: [{ sessionId: 's-busy', running: true, updatedAt: 1000 }] })
    const result = await mkRunner(ledger, env, gates).run(id)
    expect(result.outcome).toBe('failed')
    const ex = ledger.taskById(id)!.executions[0]
    expect(ex.result).toBe('failed')
    expect(ex.error).toContain('busy')
  })

  it('rejects an incomplete model pin before the runner can start', () => {
    const ledger = new HostLedger(new NoopLedgerPersist(), () => 1000, () => 'task-1')
    const result = ledger.apply({
      requestId: 'incomplete-pin',
      action: {
        kind: 'create',
        input: {
          title: 'T', description: '', prompt: 'Do the thing', startAt: 0, endAt: 1000,
          urgency: 'high', importance: 'high', workspaceId: 'w1', provider: 'dp',
        },
      },
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('provider and model must be set together')
    expect(ledger.getSnapshot().tasks).toHaveLength(0)
  })

  it('applies the permission preset via the /permission command, never as a queued prompt', async () => {
    const { ledger, id } = mkLedger({ permission: 'workspace-write' })
    const { env, calls, gates, rows } = makeHarness()
    const p = mkRunner(ledger, env, gates).run(id)
    await toSettleLoop()
    expect(calls.commands).toBe(1)
    expect(calls.prompt).toBe(1) // only the real task prompt; the command line never reached the model
    rows[0].running = false
    rows[0].updatedAt = 3000
    gates.shift()?.()
    const res = await p
    await res.settleFinished
    expect(ledger.taskById(id)!.executions[0].result).toBe('succeeded')
  })

  it('fails the run when the permission command is rejected', async () => {
    const { ledger, id } = mkLedger({ permission: 'danger-full-access' })
    const { env, calls, gates } = makeHarness({ commandOk: false })
    await mkRunner(ledger, env, gates).run(id)
    const ex = ledger.taskById(id)!.executions[0]
    expect(ex.result).toBe('failed')
    expect(ex.error).toContain('permission command rejected')
    expect(ex.error).toContain('unknown preset')
    expect(calls.commands).toBe(1)
    expect(calls.prompt).toBe(0) // the command line must NOT be queued as a prompt
  })

  it('fails when the permission command is not registered', async () => {
    const { ledger, id } = mkLedger({ permission: 'read-only' })
    const { env, gates } = makeHarness({ commandFound: false })
    await mkRunner(ledger, env, gates).run(id)
    const ex = ledger.taskById(id)!.executions[0]
    expect(ex.result).toBe('failed')
    expect(ex.error).toContain('permission command not found')
  })

  it('fails when the deployment supports no slash commands', async () => {
    const { ledger, id } = mkLedger({ permission: 'read-only' })
    const { env, gates } = makeHarness()
    delete env.commands
    await mkRunner(ledger, env, gates).run(id)
    const ex = ledger.taskById(id)!.executions[0]
    expect(ex.result).toBe('failed')
    expect(ex.error).toContain('does not support slash commands')
  })

  it('fails when the session has no live agent to run the command on', async () => {
    const { ledger, id } = mkLedger({ permission: 'read-only' })
    const { env, gates } = makeHarness({ hasAgent: false })
    await mkRunner(ledger, env, gates).run(id)
    const ex = ledger.taskById(id)!.executions[0]
    expect(ex.result).toBe('failed')
    expect(ex.error).toContain('no live agent')
  })

  it('records a scheduler-triggered execution separately from a manual run', async () => {
    const { ledger, id } = mkLedger()
    const { env, gates } = makeHarness()
    const result = await mkRunner(ledger, env, gates).run(id, 'schedule')
    expect(result.accepted).toBe(true)
    expect(ledger.taskById(id)!.executions[0].triggeredBy).toBe('schedule')
  })

  it('settles failed when the task prompt is rejected', async () => {
    const { ledger, id } = mkLedger()
    // make the *second* prompt (the real one) fail: first is not a permission cmd
    const { env, gates } = makeHarness()
    const env2: HostExecutionEnv = {
      ...env,
      sessions: {
        ...env.sessions,
        prompt: async (request: { payload: { sessionId: unknown; content?: { type: string; text: string }[] } }) => {
          const text = request.payload.content?.[0]?.text ?? ''
          if (text.startsWith('/permission')) return { result: { ok: true } }
          return { result: { ok: false } }
        },
      },
    }
    await mkRunner(ledger, env2, gates).run(id)
    expect(ledger.taskById(id)!.executions[0].result).toBe('failed')
  })

  it('settles cancelled when the session disappears', async () => {
    const { ledger, id } = mkLedger()
    const { env, gates } = makeHarness({ listEmpty: true })
    const p = mkRunner(ledger, env, gates).run(id)
    await toSettleLoop()
    // settle's first read sees the session gone and returns without a sleep
    const res = await p
    await res.settleFinished
    const ex = ledger.taskById(id)!.executions[0]
    expect(ex.result).toBe('cancelled')
    expect(ex.error).toContain('no longer exists')
  })

  it('settles cancelled on settlement timeout', async () => {
    const { ledger, id } = mkLedger()
    const { env, rows, gates } = makeHarness()
    const nowRef = { value: 1000 }
    const r = new HostExecutionRunner(ledger, env, {
      now: () => nowRef.value,
      uuid: () => 'exec-1',
      sleep: (_ms: number) => new Promise<void>(res => gates.push(res)),
      settleTimeoutMs: 10_000,
    })
    const p = r.run(id)
    await toSettleLoop()
    // session stays running; advance clock past the deadline, then release
    nowRef.value = 1000 + 10_000 + 1
    gates.shift()?.()
    const res = await p
    await res.settleFinished
    const ex = ledger.taskById(id)!.executions[0]
    expect(ex.result).toBe('cancelled')
    expect(ex.error).toContain('timed out')
  })

  it('reopens an execution only once (already-running run is a no-op)', async () => {
    const { ledger, id } = mkLedger()
    // manually open an execution to simulate an in-flight run
    expect(ledger.openExecution(id, 'already', 1000)).toBe(true)
    const { env, gates } = makeHarness()
    const ok = await mkRunner(ledger, env, gates).run(id)
    expect(ok.accepted).toBe(false)
    expect(ledger.taskById(id)!.executions.length).toBe(1)
  })
})
