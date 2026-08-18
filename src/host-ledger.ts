/**
 * Host-authoritative task ledger: the single owner of task state on the Host
 * (not the browser). Holds the in-memory ledger, persists it atomically
 * (temp file + fsync + rename) to `$DSH_HOME/calender/ledger-v1.json`, and
 * applies every browser mutation (a strict discriminated union) dispatch to
 * the pure `core/tasks.ts` transitions with request-id idempotency so a Host
 * restart can never re-apply a retried action.
 *
 * The fs face is injected so tests run against an in-memory backend.
 */
import { createHash } from 'node:crypto'
import {
  chmodSync, closeSync, existsSync, fsyncSync, mkdirSync,
  openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { randomId, SCHEMA_VERSION, type CalenderAction, type CalenderActionResult, type CalenderActionEnvelope, type CalenderSnapshot } from './protocol.ts'
import {
  addSubtask, archiveTask, attachExecutionSession, createTask, deleteTask,
  removeSubtask, restoreTask, setNextRun, setQuadrant, setSchedule, setSubtaskDone,
  setTaskDone, settleExecution, startExecution, updateTask, type TaskRecord,
} from './core/tasks.ts'
import { isValidCron, nextRunAtMs } from './core/schedule.ts'
import { parseTasks } from './core/store.ts'
import { calenderDir, ledgerPath } from './dsh-home.ts'

export const MAX_REQUEST_CACHE = 256

/** The persisted schedule mirror (browser M5 consumes it; Host owns it). */
export interface PersistedScheduler {
  ledgerId?: string
  timeZone: string
  /** per-task next-run mirrors. */
  nextRuns: Record<string, { nextRunAt?: number; lastTriggeredAt?: number }>
}

interface PersistedRequest {
  requestId: string
  fingerprint: string
}

/** The on-disk ledger document. */
export interface LedgerDocument {
  schemaVersion: number
  revision: number
  tasks: TaskRecord[]
  scheduler: PersistedScheduler
  recentRequests: PersistedRequest[]
}

/** The (private) mutable ledger state. */
interface LedgerState {
  schemaVersion: number
  revision: number
  tasks: TaskRecord[]
  scheduler: PersistedScheduler
  recentRequests: PersistedRequest[]
}

/** The narrow node:fs face the ledger needs (injected for tests). */
export interface FsFace {
  readFile(path: string): string | undefined
  writeAtomic(path: string, content: string): void
  exists(path: string): boolean
  mkdir(dir: string): void
}

/** Optional persistent store seam; absent → the ledger is ephemeral (tests). */
export interface HostLedgerPersist {
  load(): LedgerDocument | undefined
  save(doc: LedgerDocument): void
}

/** node:fs-backed persistence (atomic temp+rename). */
export class AtomicFileLedgerPersist implements HostLedgerPersist {
  constructor(private readonly home: string = process.env.DSH_HOME ?? '') {}

  private basePath(): string {
    return ledgerPath(this.home || undefined)
  }

  load(): LedgerDocument | undefined {
    const p = this.basePath()
    if (!existsSync(p)) return undefined
    const raw = readFileSync(p, 'utf8')
    if (raw.trim() === '') return undefined
    const parsed = JSON.parse(raw) as LedgerDocument
    return {
      ...parsed,
      tasks: parseTasks(JSON.stringify(parsed.tasks)),
    }
  }

  save(doc: LedgerDocument): void {
    const p = this.basePath()
    const dir = dirname(p)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const tmp = `${p}.tmp-${process.pid}`
    const fd = openSync(tmp, 'w', 0o600)
    try {
      writeFileSync(fd, JSON.stringify(doc, null, 2))
      fsyncSync(fd)
    } finally {
      closeSync(fd)
    }
    try {
      chmodSync(tmp, 0o600)
    } catch {
      // chmod is best-effort (Windows ignores mode)
    }
    renameSync(tmp, p)
  }
}

/** A no-op persist (in-memory test use). */
export class NoopLedgerPersist implements HostLedgerPersist {
  load(): undefined { return undefined }
  save(): void {}
}

/** The ledger lock: an exclusive file so two Host processes never write together. */
export function acquireLedgerLock(home: string): () => void {
  const dir = calenderDir(home)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const lockPath = join(dir, 'ledger-v1.lock')
  let fd: number | undefined
  try {
    fd = openSync(lockPath, 'wx')
    writeFileSync(fd, String(process.pid))
  } catch {
    // Another process holds the lock; fail closed (second Host refuses to run).
    throw new Error('calender ledger is locked by another dsh process')
  }
  return () => {
    try { if (fd !== undefined) closeSync(fd) } catch { /* ignore */ }
    try { unlinkSync(lockPath) } catch { /* ignore */ }
  }
}

function fingerprintOf(envelope: CalenderActionEnvelope): string {
  return createHash('sha256').update(JSON.stringify(envelope)).digest('hex')
}

/**
 * The Host ledger. Every mutation goes through `apply`, which serializes the
 * read-modify-write (single threaded here), records the request for idempotency,
 * bumps the revision, and persists.
 */
export class HostLedger {
  private state: LedgerState
  private readonly listeners = new Set<() => void>()

  constructor(
    private readonly persist: HostLedgerPersist,
    private readonly now: () => number = Date.now,
    private readonly uuid: () => string = randomId,
    private readonly timeZone: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
  ) {
    const loaded = persist.load()
    this.state = loaded
      ? {
        schemaVersion: loaded.schemaVersion,
        revision: loaded.revision,
        tasks: loaded.tasks,
        scheduler: loaded.scheduler,
        recentRequests: (loaded.recentRequests ?? []).slice(-MAX_REQUEST_CACHE),
      }
      : emptyState(timeZone())
  }

  getSnapshot(): CalenderSnapshot {
    return this.snapshot()
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
  }

  /**
   * Apply a browser action. Idempotent per requestId: a fingerprint already
   * recorded short-circuits to the current snapshot without re-applying.
   */
  apply(envelope: CalenderActionEnvelope): CalenderActionResult {
    const { requestId, action } = envelope
    const fingerprint = fingerprintOf(envelope)
    const dup = this.state.recentRequests.find(r => r.requestId === requestId)
    if (dup !== undefined && dup.fingerprint === fingerprint) {
      return { ok: true, snapshot: this.snapshot() }
    }
    const ok = this.dispatch(action)
    if (!ok) return { ok: false, error: actionError(action) }
    this.state.revision += 1
    this.state.recentRequests.push({ requestId, fingerprint })
    if (this.state.recentRequests.length > MAX_REQUEST_CACHE) {
      this.state.recentRequests.splice(0, this.state.recentRequests.length - MAX_REQUEST_CACHE)
    }
    const snapshot = this.snapshot()
    this.persist.save({
      schemaVersion: this.state.schemaVersion,
      revision: this.state.revision,
      tasks: this.state.tasks,
      scheduler: this.state.scheduler,
      recentRequests: this.state.recentRequests,
    })
    this.notify()
    return { ok: true, snapshot }
  }

  /** Return one task by id (undefined when missing). */
  taskById(id: string): TaskRecord | undefined {
    return this.state.tasks.find(t => t.id === id)
  }

  /**
   * Open a fresh execution record on a task (Host-runner entry). Guards:
   * the task must exist and must not already have an in-flight (unsettled)
   * execution. Appends the running record, bumps the revision, persists, and
   * notifies the browser so the view shows the run as started.
   */
  openExecution(taskId: string, executionId: string, now: number): boolean {
    const task = this.taskById(taskId)
    if (task === undefined) return false
    if (task.executions.some(e => e.endedAt === undefined)) return false
    this.state.tasks = this.state.tasks.map(t => {
      if (t.id !== taskId) return t
      return startExecution(t, now, executionId).task
    })
    this.commit()
    return true
  }

  /**
   * Settle a running execution (Host-runner exit): attach the session that
   * ran it (once known) and record the outcome. No-op when the execution or
   * task is missing or already settled. Always bumps revision + persists +
   * notifies when something changed.
   */
  settleExecution(taskId: string, executionId: string, outcome: 'succeeded' | 'failed' | 'cancelled', now: number, error: string | undefined, sessionId?: string): boolean {
    const task = this.taskById(taskId)
    if (task === undefined) return false
    if (!task.executions.some(e => e.id === executionId)) return false
    let changed = false
    this.state.tasks = this.state.tasks.map(t => {
      if (t.id !== taskId) return t
      const withSession = sessionId !== undefined && sessionId !== '' && !t.executions.some(e => e.id === executionId && e.sessionId !== undefined)
        ? attachExecutionSession(t, executionId, sessionId, now)
        : t
      const next = settleExecution(withSession, executionId, outcome, now, error)
      if (next !== withSession) changed = true
      return next
    })
    if (!changed) return false
    this.commit()
    return true
  }

  /** Persist + bump revision + notify after a Host-side ledger mutation. */
  private commit(): void {
    this.state.revision += 1
    this.persist.save({
      schemaVersion: this.state.schemaVersion,
      revision: this.state.revision,
      tasks: this.state.tasks,
      scheduler: this.state.scheduler,
      recentRequests: this.state.recentRequests,
    })
    this.notify()
  }

  private snapshot(): CalenderSnapshot {
    return {
      schemaVersion: this.state.schemaVersion,
      revision: this.state.revision,
      tasks: this.state.tasks,
      scheduler: {
        ledgerId: this.state.scheduler.ledgerId,
        timeZone: this.state.scheduler.timeZone,
      },
    }
  }

  /** Dispatch one action; returns false when rejected (state untouched on false). */
  private dispatch(action: CalenderAction): boolean {
    const now = this.now()
    switch (action.kind) {
      case 'create': {
        const task = createTask({ ...action.input, schedule: action.schedule }, now, this.uuid())
        if (task === undefined) return false
        if (task.schedule !== undefined) {
          const armed = armSchedule(task, now)
          if (armed === undefined) return false
        }
        this.state.tasks = [...this.state.tasks, task]
        if (task.schedule !== undefined) {
          this.state.scheduler.nextRuns[task.id] = mirrorOf(task.schedule)
        }
        return true
      }
      case 'update': {
        const before = this.state.tasks.find(t => t.id === action.id)
        if (before === undefined) return false
        this.state.tasks = updateTask(this.state.tasks, action.id, action.patch, now)
        return true
      }
      case 'setQuadrant':
        this.state.tasks = setQuadrant(this.state.tasks, action.id, action.urgency, action.importance, now)
        return this.state.tasks.some(t => t.id === action.id)
      case 'setDone':
        this.state.tasks = setTaskDone(this.state.tasks, action.id, action.done, now)
        return this.state.tasks.some(t => t.id === action.id)
      case 'addSubtask':
        this.state.tasks = addSubtask(this.state.tasks, action.id, { id: action.subtaskId, title: action.title }, now)
        return true
      case 'setSubtaskDone':
        this.state.tasks = setSubtaskDone(this.state.tasks, action.id, action.subtaskId, action.done, now)
        return true
      case 'removeSubtask':
        this.state.tasks = removeSubtask(this.state.tasks, action.id, action.subtaskId, now)
        return true
      case 'delete': {
        const { tasks } = deleteTask(this.state.tasks, undefined, action.id)
        if (tasks.length === this.state.tasks.length) return false
        this.state.tasks = tasks
        delete this.state.scheduler.nextRuns[action.id]
        return true
      }
      case 'archive': {
        const { tasks, archived } = archiveTask(this.state.tasks, action.id, now)
        if (!archived) return false
        this.state.tasks = tasks
        return true
      }
      case 'restore': {
        const { tasks, restored } = restoreTask(this.state.tasks, action.id, now)
        if (!restored) return false
        this.state.tasks = tasks
        return true
      }
      case 'setSchedule': {
        if (typeof action.patch.cron === 'string' && action.patch.cron.trim() !== '' && !isValidCron(action.patch.cron)) return false
        let tasks = setSchedule(this.state.tasks, action.id, action.patch, now)
        const task = tasks.find(t => t.id === action.id)
        if (task === undefined) return false
        if (task.schedule !== undefined && (task.schedule.enabled || task.schedule.cron !== undefined || task.schedule.dueAt !== undefined)) {
          const nextRunAt = computeNextRun(task.schedule, now)
          tasks = setNextRun(tasks, action.id, nextRunAt, task.schedule.lastTriggeredAt, now)
        }
        // re-read after possible setNextRun
        const updated = tasks.find(t => t.id === action.id)
        if (updated?.schedule !== undefined) this.state.scheduler.nextRuns[action.id] = mirrorOf(updated.schedule)
        this.state.tasks = tasks
        return true
      }
      case 'run':
        // The Host runner is invoked after apply from the route handler (it
        // opens + settles execution records itself). The ledger only marks the
        // request valid and requires the task to exist.
        return this.state.tasks.some(t => t.id === action.id)
      case 'import': {
        // Merge imported tasks (by id, browser-newer wins ties go to Host).
        for (const t of action.tasks) {
          const existing = this.state.tasks.find(x => x.id === t.id)
          if (existing === undefined) this.state.tasks.push(t)
          else if (t.updatedAt > existing.updatedAt) this.state.tasks = this.state.tasks.map(x => x.id === t.id ? t : x)
        }
        return true
      }
      default:
        return false
    }
  }
}

function emptyState(timeZone: string): LedgerState {
  return {
    schemaVersion: SCHEMA_VERSION,
    revision: 0,
    tasks: [],
    scheduler: { ledgerId: randomId(), timeZone, nextRuns: {} },
    recentRequests: [],
  }
}

function mirrorOf(schedule: NonNullable<TaskRecord['schedule']>): { nextRunAt?: number; lastTriggeredAt?: number } {
  return { nextRunAt: schedule.nextRunAt, lastTriggeredAt: schedule.lastTriggeredAt }
}

/** Arm a fresh schedule: compute the next run instant (cron or one-shot dueAt). */
function armSchedule(task: TaskRecord, now: number): TaskRecord['schedule'] | undefined {
  const s = task.schedule
  if (s === undefined) return undefined
  if (!s.enabled && (s.cron === undefined || s.cron === '') && s.dueAt === undefined) return undefined
  const next = computeNextRun(s, now)
  return { ...s, nextRunAt: next ?? undefined }
}

/** Compute the next run instant for a schedule (cron repeated or one-shot dueAt). */
function computeNextRun(s: NonNullable<TaskRecord['schedule']>, now: number): number | undefined {
  if (s.cron !== undefined && s.cron.trim() !== '' && isValidCron(s.cron)) {
    return nextRunAtMs(s.cron, now)
  }
  if (s.dueAt !== undefined && s.dueAt > now) return s.dueAt
  return undefined
}

/** Human copy for an action that was rejected. */
export function actionError(action: CalenderAction): string {
  return `unknown or rejected calender action of kind "${action.kind}"`
}