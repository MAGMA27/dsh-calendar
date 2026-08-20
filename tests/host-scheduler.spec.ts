import { describe, expect, it } from 'vitest'
import { HostScheduleService, type HostSchedulerTimers, type SchedulerLedgerFace, type SchedulerRunnerFace } from '../src/host-scheduler.ts'
import type { ExecutionTrigger, TaskRecord } from '../src/core/tasks.ts'

function mkTask(p: Partial<TaskRecord> & { id: string }): TaskRecord {
  return { title: 'T', description: '', prompt: '', startAt: 0, endAt: 1000, urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [], createdAt: 0, updatedAt: 0, ...p } as TaskRecord
}
function fakeLedger(tasks: TaskRecord[]) {
  const state = { tasks: [...tasks] }
  const advanced: Array<{ id: string; next: number | undefined; last: number | undefined }> = []
  const sweeps: number[] = []
  const face: SchedulerLedgerFace = {
    tasks: () => state.tasks,
    advanceSchedule: (id: string, next: number | undefined, last: number | undefined) => {
      advanced.push({ id, next, last })
      state.tasks = state.tasks.map(t => t.id === id && t.schedule !== undefined ? { ...t, schedule: { ...t.schedule, nextRunAt: next, lastTriggeredAt: last } } : t)
      return true
    },
    materializeRepeats: (now: number) => { sweeps.push(now); return false },
  }
  return { face, advanced, sweeps }
}
function fakeRunner(accept: boolean, outcome?: 'started' | 'failed') {
  const runs: string[] = []
  const triggers: Array<ExecutionTrigger | undefined> = []
  const reconciles: string[] = []
  const face: SchedulerRunnerFace = {
    run: async (id: string, triggeredBy?: ExecutionTrigger) => { runs.push(id); triggers.push(triggeredBy); return { accepted: accept, outcome } },
    reconcile: async (id: string) => { reconciles.push(id); return true },
  }
  return { face, runs, triggers, reconciles }
}

describe('HostScheduleService', () => {
  it('fires a due one-shot and advances it to undefined (schedule cleared after acceptance)', async () => {
    const t = mkTask({ id: 'a', schedule: { enabled: true, dueAt: 1000, nextRunAt: 1000 } })
    const { face, advanced } = fakeLedger([t])
    const { face: runner, runs, triggers } = fakeRunner(true)
    const s = new HostScheduleService(face, runner, { now: () => 1000 })
    await s.tick()
    expect(runs).toEqual(['a'])
    expect(triggers).toEqual(['schedule'])
    expect(advanced).toHaveLength(1)
    expect(advanced[0].id).toBe('a')
    expect(advanced[0].next).toBeUndefined()
    expect(advanced[0].last).toBe(1000)
  })

  it('does not roll forward when the run is rejected (already running)', async () => {
    const t = mkTask({ id: 'a', schedule: { enabled: true, dueAt: 1000, nextRunAt: 1000 } })
    const { face, advanced } = fakeLedger([t])
    const { face: runner, runs } = fakeRunner(false)
    const s = new HostScheduleService(face, runner, { now: () => 1000 })
    await s.tick()
    expect(runs).toEqual(['a'])
    expect(advanced).toHaveLength(0)
  })

  it('keeps a failed setup armed and moves its retry slot forward', async () => {
    const t = mkTask({ id: 'a', schedule: { enabled: true, dueAt: 1000, nextRunAt: 1000 } })
    const { face, advanced } = fakeLedger([t])
    const { face: runner, runs } = fakeRunner(true, 'failed')
    const s = new HostScheduleService(face, runner, { now: () => 1000, tickMs: 30_000 })
    await s.tick()
    expect(runs).toEqual(['a'])
    expect(advanced).toHaveLength(1)
    expect(advanced[0]).toEqual({ id: 'a', next: 31_000, last: undefined })
  })

  it('does not run a repeat template before its first occurrence is armed', async () => {
    const t = mkTask({ id: 'tpl', schedule: { enabled: true, repeat: { kind: 'daily' } } })
    const { face, advanced, sweeps } = fakeLedger([t])
    const { face: runner, runs } = fakeRunner(true)
    const s = new HostScheduleService(face, runner, { now: () => 2000 })
    await s.tick()
    expect(runs).toEqual([]) // no execution for the template
    expect(advanced).toHaveLength(0)
    expect(sweeps).toEqual([2000]) // the materialization sweep ran
  })

  it('fires an armed repeat template first occurrence', async () => {
    const t = mkTask({ id: 'tpl', schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true }, nextRunAt: 2000 } })
    const { face, advanced } = fakeLedger([t])
    const { face: runner, runs, triggers } = fakeRunner(true)
    const s = new HostScheduleService(face, runner, { now: () => 2000 })
    await s.tick()
    expect(runs).toEqual(['tpl'])
    expect(triggers).toEqual(['schedule'])
    expect(advanced).toEqual([{ id: 'tpl', next: undefined, last: 2000 }])
  })

  it('skips disabled and not-yet-due schedules, and still sweeps', async () => {
    const off = mkTask({ id: 'off', schedule: { enabled: false, dueAt: 1000, nextRunAt: 1000 } })
    const fut = mkTask({ id: 'fut', schedule: { enabled: true, dueAt: 5000, nextRunAt: 5000 } })
    const { face, sweeps } = fakeLedger([off, fut])
    const { face: runner, runs } = fakeRunner(true)
    const s = new HostScheduleService(face, runner, { now: () => 2000 })
    await s.tick()
    expect(runs).toEqual([])
    expect(sweeps).toEqual([2000])
  })

  it('ends a one-shot dueAt schedule (next becomes undefined)', async () => {
    const t = mkTask({ id: 'one', schedule: { enabled: true, dueAt: 2000, nextRunAt: 2000 } })
    const { face, advanced } = fakeLedger([t])
    const { face: runner } = fakeRunner(true)
    const s = new HostScheduleService(face, runner, { now: () => 2000 })
    await s.tick()
    expect(advanced).toHaveLength(1)
    expect(advanced[0].next).toBeUndefined()
    expect(advanced[0].last).toBe(2000)
  })

  it('reconcileAll reconciles tasks with an in-flight execution only', async () => {
    const r = mkTask({ id: 'r', executions: [{ id: 'e1', startedAt: 0, sessionId: 's1' }] })
    const d = mkTask({ id: 'd', executions: [{ id: 'e2', startedAt: 0, endedAt: 5, result: 'succeeded' }] })
    const { face } = fakeLedger([r, d])
    const { face: runner, reconciles } = fakeRunner(true)
    const s = new HostScheduleService(face, runner)
    await s.reconcileAll()
    expect(reconciles).toEqual(['r'])
  })

  it('start arms the startup sweep and interval; dispose clears both', () => {
    const { face } = fakeLedger([])
    const { face: runner } = fakeRunner(true)
    let cleared = 0
    const timers: HostSchedulerTimers = { immediate: fn => { fn(); return 1 }, interval: () => 2, clear: () => { cleared++ } }
    const s = new HostScheduleService(face, runner, { timers })
    s.start()
    expect(cleared).toBe(0)
    s.dispose()
    expect(cleared).toBe(2)
  })
})
