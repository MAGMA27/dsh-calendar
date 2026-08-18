import { describe, expect, it } from 'vitest'
import { HostScheduleService, type HostSchedulerTimers, type SchedulerLedgerFace, type SchedulerRunnerFace } from '../src/host-scheduler.ts'
import type { TaskRecord } from '../src/core/tasks.ts'

function mkTask(p: Partial<TaskRecord> & { id: string }): TaskRecord {
  return { title: 'T', description: '', prompt: '', startAt: 0, endAt: 1000, urgency: 'high', importance: 'high', done: false, subtasks: [], executions: [], createdAt: 0, updatedAt: 0, ...p } as TaskRecord
}
function fakeLedger(tasks: TaskRecord[]) {
  const state = { tasks: [...tasks] }
  const advanced: Array<{ id: string; next: number | undefined; last: number | undefined }> = []
  const face: SchedulerLedgerFace = {
    tasks: () => state.tasks,
    advanceSchedule: (id: string, next: number | undefined, last: number | undefined) => {
      advanced.push({ id, next, last })
      state.tasks = state.tasks.map(t => t.id === id && t.schedule !== undefined ? { ...t, schedule: { ...t.schedule, nextRunAt: next, lastTriggeredAt: last } } : t)
      return true
    },
  }
  return { face, advanced }
}
function fakeRunner(accept: boolean) {
  const runs: string[] = []
  const reconciles: string[] = []
  const face: SchedulerRunnerFace = {
    run: async (id: string) => { runs.push(id); return { accepted: accept } },
    reconcile: async (id: string) => { reconciles.push(id); return true },
  }
  return { face, runs, reconciles }
}

describe('HostScheduleService', () => {
  it('fires a due cron task and rolls it forward after acceptance', async () => {
    const t = mkTask({ id: 'a', schedule: { enabled: true, cron: '0 9 * * *', nextRunAt: 1000 } })
    const { face, advanced } = fakeLedger([t])
    const { face: runner, runs } = fakeRunner(true)
    const s = new HostScheduleService(face, runner, { now: () => 2000 })
    await s.tick()
    expect(runs).toEqual(['a'])
    expect(advanced).toHaveLength(1)
    expect(advanced[0].id).toBe('a')
    expect(advanced[0].last).toBe(2000)
    expect(typeof advanced[0].next).toBe('number')
    expect(advanced[0].next! >= 1000).toBe(true)
  })

  it('does not roll forward when the run is rejected (already running)', async () => {
    const t = mkTask({ id: 'a', schedule: { enabled: true, cron: '0 9 * * *', nextRunAt: 1000 } })
    const { face, advanced } = fakeLedger([t])
    const { face: runner, runs } = fakeRunner(false)
    const s = new HostScheduleService(face, runner, { now: () => 2000 })
    await s.tick()
    expect(runs).toEqual(['a'])
    expect(advanced).toHaveLength(0)
  })

  it('skips disabled and not-yet-due schedules', async () => {
    const off = mkTask({ id: 'off', schedule: { enabled: false, cron: '0 9 * * *', nextRunAt: 1000 } })
    const fut = mkTask({ id: 'fut', schedule: { enabled: true, cron: '0 9 * * *', nextRunAt: 5000 } })
    const { face } = fakeLedger([off, fut])
    const { face: runner, runs } = fakeRunner(true)
    const s = new HostScheduleService(face, runner, { now: () => 2000 })
    await s.tick()
    expect(runs).toEqual([])
  })

  it('ends a one-shot dueAt schedule (next becomes undefined)', async () => {
    const t = mkTask({ id: 'one', schedule: { enabled: true, dueAt: 900, nextRunAt: 900 } })
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

  it('start arms the catch-up and interval; dispose clears both', () => {
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
