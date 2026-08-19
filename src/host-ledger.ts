/**
 * Host-authoritative task ledger: the single owner of task state on the Host
 * (not the browser). Holds the in-memory ledger, persists it atomically
 * (temp file + fsync + rename) to `$DSH_HOME/calendar/ledger-v1.json`, and
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
import { randomId, SCHEMA_VERSION, type calendarAction, type calendarActionResult, type calendarActionEnvelope, type calendarSnapshot } from './protocol.ts'
import {
  addSubtask, archiveTask, attachExecutionSession, createTask,
  removeSubtask, restoreTask, setNextRun, setQuadrant, setSchedule, setSubtaskDone,
  setTaskDone, settleExecution, startExecution, updateTask, type TaskRecord,
} from './core/tasks.ts'
import { REPEAT_HORIZON_DAYS, buildRepeatCopy, isValidRepeat, repeatDatesBetween, startOfDayMs } from './core/repeat.ts'
import { addDays, dayKey } from './core/calendar.ts'
import { parseTasks } from './core/store.ts'
import { calendarDir, ledgerPath } from './dsh-home.ts'

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
  const dir = calendarDir(home)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const lockPath = join(dir, 'ledger-v1.lock')
  let fd: number | undefined
  try {
    fd = openSync(lockPath, 'wx')
    writeFileSync(fd, String(process.pid))
  } catch {
    // Another process holds the lock; fail closed (second Host refuses to run).
    throw new Error('calendar ledger is locked by another dsh process')
  }
  return () => {
    try { if (fd !== undefined) closeSync(fd) } catch { /* ignore */ }
    try { unlinkSync(lockPath) } catch { /* ignore */ }
  }
}

function fingerprintOf(envelope: calendarActionEnvelope): string {
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

  getSnapshot(): calendarSnapshot {
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
  apply(envelope: calendarActionEnvelope): calendarActionResult {
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

  /** Roll a task's schedule forward (scheduler callback after an accepted
   * one-shot run): set the next-run instant and the last-triggered instant. A
   * one-shot dueAt schedule whose run was accepted has no next run — the
   * schedule has served its purpose and is REMOVED entirely, so the task stops
   * reading as scheduled (no 🕐 badge, no stale due time, no "clear schedule"
   * affordance). Repeat templates are never advanced here (they materialize
   * copies instead of running); if one is, its rule is simply kept. No-op when
   * the task or its schedule is missing. Always persists + notifies. */
  advanceSchedule(taskId: string, nextRunAt: number | undefined, lastTriggeredAt: number | undefined): boolean {
    const task = this.taskById(taskId)
    if (task === undefined || task.schedule === undefined) return false
    const hasRepeat = task.schedule.repeat !== undefined
    if (nextRunAt === undefined && !hasRepeat) {
      // One-shot completed: drop the schedule rule and its mirror.
      this.state.tasks = this.state.tasks.map(t => (t.id === taskId ? { ...t, schedule: undefined, updatedAt: this.now() } : t))
      delete this.state.scheduler.nextRuns[taskId]
    } else {
      this.state.tasks = setNextRun(this.state.tasks, taskId, nextRunAt, lastTriggeredAt, this.now())
      this.state.scheduler.nextRuns[taskId] = { nextRunAt, lastTriggeredAt }
    }
    this.commit()
    return true
  }

  /**
   * Materialize repeat copies (scheduler heartbeat): for every enabled,
   * non-archived repeat template, ensure one plain copy exists on each matching
   * date in the rolling horizon (from the day after the template's own date /
   * today, whichever is later, up to today + horizonDays). Already-copied
   * dates (tracked in schedule.materialized) are never re-created, so deleting
   * one occurrence permanently removes it from future sweeps. Returns whether
   * anything changed (only then does it persist + notify).
   */
  materializeRepeats(now: number, horizonDays: number = REPEAT_HORIZON_DAYS): boolean {
    const tasks = this.state.tasks
    const today = startOfDayMs(now)
    const horizonEnd = addDays(today, horizonDays)
    let changed = false
    let next: TaskRecord[] = tasks
    for (const template of tasks) {
      const s = template.schedule
      if (s === undefined || s.enabled !== true || s.repeat === undefined) continue
      if (template.archivedAt !== undefined) continue
      if (!isValidRepeat(s.repeat)) continue
      const materialized = new Set(s.materialized ?? [])
      // The template occupies its own date; copies start the day after, never
      // backfilling into the past.
      const cursor = addDays(Math.max(today, startOfDayMs(template.startAt)), 1)
      const added: string[] = []
      for (const dateMs of repeatDatesBetween(s.repeat, cursor, horizonEnd)) {
        const key = dayKey(dateMs)
        if (materialized.has(key)) continue
        next = [...next, buildRepeatCopy(template, dateMs, now, this.uuid())]
        materialized.add(key)
        added.push(key)
      }
      if (added.length > 0) {
        next = next.map(t => t.id === template.id
          ? { ...t, updatedAt: this.now(), schedule: { ...t.schedule!, materialized: [...materialized] } }
          : t)
        changed = true
      }
    }
    if (changed) {
      this.state.tasks = next
      this.commit()
    }
    return changed
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

  private snapshot(): calendarSnapshot {
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
  private dispatch(action: calendarAction): boolean {
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
        // Deleting a repeat template cascades to its bound copies (a rule
        // without its template is meaningless); deleting one copy removes only
        // that copy, and its date stays marked materialized so the sweep never
        // re-creates it. Unbound copies survive a template delete.
        const target = this.state.tasks.find(t => t.id === action.id)
        const tasks = target?.originTaskId === undefined
          ? this.state.tasks.filter(t => t.id !== action.id && t.originTaskId !== action.id)
          : this.state.tasks.filter(t => t.id !== action.id)
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
        if (action.patch.repeat !== undefined && action.patch.repeat !== null && !isValidRepeat(action.patch.repeat)) return false
        let tasks = setSchedule(this.state.tasks, action.id, action.patch, now)
        const task = tasks.find(t => t.id === action.id)
        if (task === undefined) return false
        if (task.schedule !== undefined && (task.schedule.enabled || task.schedule.repeat !== undefined || task.schedule.dueAt !== undefined)) {
          const nextRunAt = computeNextRun(task.schedule, now)
          tasks = setNextRun(tasks, action.id, nextRunAt, task.schedule.lastTriggeredAt, now)
        }
        // re-read after possible setNextRun
        const updated = tasks.find(t => t.id === action.id)
        if (updated?.schedule !== undefined) this.state.scheduler.nextRuns[action.id] = mirrorOf(updated.schedule)
        this.state.tasks = tasks
        return true
      }
      case 'shiftRepeatTimes': {
        // "Change all copies": shift the template + every bound copy by the
        // same start/end deltas. The edited task must be a bound copy.
        const copy = this.state.tasks.find(t => t.id === action.id)
        if (copy === undefined || copy.originTaskId === undefined) return false
        const origin = copy.originTaskId
        let hit = false
        this.state.tasks = this.state.tasks.map(t => {
          if (t.id !== origin && t.originTaskId !== origin) return t
          hit = true
          return { ...t, startAt: t.startAt + action.startDelta, endAt: t.endAt + action.endDelta, updatedAt: now }
        })
        return hit
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

/** Arm a fresh schedule: compute the one-shot next run instant (repeat rules
 * have none — they materialize copies instead of running). */
function armSchedule(task: TaskRecord, now: number): TaskRecord['schedule'] | undefined {
  const s = task.schedule
  if (s === undefined) return undefined
  if (!s.enabled && s.repeat === undefined && s.dueAt === undefined) return undefined
  const next = computeNextRun(s, now)
  return { ...s, nextRunAt: next ?? undefined }
}

/** Compute the one-shot next run instant for a schedule (repeat rules → none). */
function computeNextRun(s: NonNullable<TaskRecord['schedule']>, now: number): number | undefined {
  if (s.dueAt !== undefined && s.dueAt > now) return s.dueAt
  return undefined
}

/** Human copy for an action that was rejected. */
export function actionError(action: calendarAction): string {
  return `unknown or rejected calendar action of kind "${action.kind}"`
}