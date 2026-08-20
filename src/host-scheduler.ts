/**
 * Host-side scheduler. On a tick it does two jobs:
 *  1. Fire due one-shot schedules: scans the ledger for enabled schedules whose
 *     next-run instant is due, triggers the real-execution runner for each, and
 *     — only after the prompt is accepted — clears the schedule (advanceSchedule
 *     removes a completed one-shot entirely). A rejected or failed setup keeps
 *     its due slot and is retried after one heartbeat, so a scheduled task is
 *     never silently lost because a pinned session was busy or a Host RPC
 *     failed.
 *     Missed one-shot dueAt records are normalized as failed by the ledger on
 *     Host startup; repeat schedules are materialized by date rather than
 *     replayed as a backlog.
 *  2. Materialize repeat copies: repeat templates never run themselves; the
 *     ledger's materializeRepeats() sweep ensures one plain copy exists on each
 *     matching date (idempotent, tracked per date).
 *
 * reconcileAll() settles executions left 'running' across a Host restart by
 * inspecting the current session status (delegated to the runner). It runs
 * once on start.
 *
 * Framework-free: ledger + runner faces are structural, and the timer
 * functions are injectable so start/dispose are testable without real
 * intervals.
 */
import type { ExecutionTrigger, TaskRecord } from './core/tasks.ts'
import { REPEAT_HORIZON_DAYS } from './core/repeat.ts'

/** The narrow ledger face the scheduler needs. */
export interface SchedulerLedgerFace {
  tasks(): readonly TaskRecord[]
  advanceSchedule(taskId: string, nextRunAt: number | undefined, lastTriggeredAt: number | undefined): boolean
  /** Materialize repeat copies for the rolling horizon; true when anything changed. */
  materializeRepeats(now: number, horizonDays?: number): boolean
}

/** The narrow runner face the scheduler calls. */
export interface SchedulerRunnerFace {
  run(taskId: string, triggeredBy?: ExecutionTrigger): Promise<{ accepted: boolean; outcome?: 'started' | 'failed'; settleFinished?: Promise<void> }>
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

/**
 * Host schedule heartbeat. tick is public so tests drive it directly; the
 * interval and the startup sweep/reconcile are armed by start.
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

  /** Arm the startup sweep/reconcile and the recurring tick. Idempotent. */
  start(): void {
    if (this.disposed || this.started) return
    this.started = true
    // Immediate startup sweep: stale one-shots were failed by HostLedger's
    // load normalization; materialize only current/future repeat copies and
    // reconcile executions left 'running'.
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

  /** Fire due one-shots (advancing only after prompt acceptance), then
   * materialize repeat copies. */
  async tick(): Promise<void> {
    const now = this.now()
    for (const task of this.ledger.tasks()) {
      const schedule = task.schedule
      if (schedule === undefined || schedule.enabled !== true) continue
      // Repeat templates never run here (no nextRunAt); the sweep below copies
      // them onto their dates. One-shots fire at their due instant.
      const due = schedule.nextRunAt
      if (due === undefined || due > now) continue
      const result = await this.runner.run(task.id, 'schedule')
      if (result.accepted && result.outcome !== 'failed') {
        this.ledger.advanceSchedule(task.id, undefined, now)
      } else if (result.outcome === 'failed') {
        // Keep the one-shot armed, but move its retry slot forward so a bad
        // pin or a transient Host/session failure cannot create a tight loop.
        this.ledger.advanceSchedule(task.id, now + Math.max(1, this.tickMs), schedule.lastTriggeredAt)
      }
    }
    this.ledger.materializeRepeats(now, REPEAT_HORIZON_DAYS)
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
