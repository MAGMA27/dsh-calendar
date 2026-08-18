/**
 * Host-side cron scheduler (M5). On a tick it scans the ledger for enabled
 * schedules whose next-run instant is due, triggers the real-execution runner
 * for each, and — only after the run is accepted — rolls the schedule forward
 * to the next cron match. A rejected run (the task is already running, e.g. a
 * long turn still settling) keeps its due slot and is retried on the next
 * tick, so a recurring task is never skipped. Missed runs (the Host was
 * down, or the tab was closed) are not backfilled: a due task fires on the
 * next tick and otherwise waits for its next cron match.
 *
 * reconcileAll() settles executions left 'running' across a Host restart by
 * inspecting the current session status (delegated to the runner). It runs
 * once on start.
 *
 * Framework-free: ledger + runner faces are structural, and the timer
 * functions are injectable so start/dispose are testable without real
 * intervals.
 */
import type { TaskRecord } from './core/tasks.ts'
import { isValidCron, nextRunAtMs } from './core/schedule.ts'

/** The narrow ledger face the scheduler needs. */
export interface SchedulerLedgerFace {
  tasks(): readonly TaskRecord[]
  advanceSchedule(taskId: string, nextRunAt: number | undefined, lastTriggeredAt: number | undefined): boolean
}

/** The narrow runner face the scheduler calls. */
export interface SchedulerRunnerFace {
  run(taskId: string): Promise<{ accepted: boolean; settleFinished?: Promise<void> }>
  reconcile(taskId: string): Promise<boolean>
}

/** Injectable timer seam (defaults to the real event loop). */
export interface HostSchedulerTimers {
  immediate(fn: () => void): unknown
  interval(fn: () => void, ms: number): unknown
  clear(timer: unknown): void
}

const defaultTimers: HostSchedulerTimers = {
  immediate: fn => setTimeout(fn, 0),
  interval: (fn, ms) => setInterval(fn, ms),
  clear: timer => clearInterval(timer as ReturnType<typeof setInterval>),
}

/** Tuning knobs. */
export interface HostSchedulerOptions {
  now?: () => number
  tickMs?: number
  timers?: HostSchedulerTimers
}

/** Compute the next run instant after the due point; undefined ends a one-shot. */
function nextAfterDue(schedule: NonNullable<TaskRecord['schedule']>, from: number): number | undefined {
  const cron = schedule.cron
  if (cron !== undefined && cron.trim() !== '' && isValidCron(cron)) {
    return nextRunAtMs(cron, from)
  }
  return undefined
}

/**
 * Host schedule heartbeat. tick is public so tests drive it directly; the
 * interval and the one-shot catch-up/reconcile are armed by start.
 */
export class HostScheduleService {
  private readonly now: () => number
  private readonly tickMs: number
  private readonly timers: HostSchedulerTimers
  private immediateTimer: unknown
  private intervalTimer: unknown
  private started = false
  private disposed = false

  constructor(
    private readonly ledger: SchedulerLedgerFace,
    private readonly runner: SchedulerRunnerFace,
    private readonly options: HostSchedulerOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.tickMs = options.tickMs ?? 30_000
    this.timers = options.timers ?? defaultTimers
  }

  /** Arm the one-shot catch-up/reconcile and the recurring tick. Idempotent. */
  start(): void {
    if (this.disposed || this.started) return
    this.started = true
    // Immediate catch-up after a restart: fire anything that became due while
    // the Host was down, and reconcile executions left 'running'.
    this.immediateTimer = this.timers.immediate(() => {
      void this.tick()
      void this.reconcileAll()
    })
    this.intervalTimer = this.timers.interval(() => { void this.tick() }, this.tickMs)
  }

  /** Stop the scheduler and clear its timers (idempotent). */
  stop(): void { this.dispose() }

  /** Stop the scheduler and clear its timers (idempotent). */
  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.started = false
    if (this.immediateTimer !== undefined) { this.timers.clear(this.immediateTimer); this.immediateTimer = undefined }
    if (this.intervalTimer !== undefined) { this.timers.clear(this.intervalTimer); this.intervalTimer = undefined }
  }

  /** Fire every due schedule, rolling each forward only once its run is accepted. */
  async tick(): Promise<void> {
    const now = this.now()
    for (const task of this.ledger.tasks()) {
      const schedule = task.schedule
      if (schedule === undefined || schedule.enabled !== true) continue
      const due = schedule.nextRunAt
      if (due === undefined || due > now) continue
      const next = nextAfterDue(schedule, due)
      const result = await this.runner.run(task.id)
      if (result.accepted) this.ledger.advanceSchedule(task.id, next, now)
    }
  }

  /** Settle executions left 'running' across a Host restart (delegates to the runner). */
  async reconcileAll(): Promise<void> {
    for (const task of this.ledger.tasks()) {
      if (task.executions.some(e => e.endedAt === undefined)) {
        await this.runner.reconcile(task.id)
      }
    }
  }
}
