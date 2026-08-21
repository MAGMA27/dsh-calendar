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
  hasIncompleteModelPin,
  removeSubtask, restoreTask, setNextRun, setQuadrant, setSchedule, setSubtaskDone,
  setTaskDone, settleExecution, startExecution, updateTask, scheduleRetryExhausted, type ExecutionTrigger, type TaskRecord, type TaskUpdatePatch,
} from './core/tasks.ts'
import { REPEAT_HORIZON_DAYS, alignSeries, buildRepeatCopy, isRepeatMember, isRepeatTemplate, isValidRepeat, matchesRepeat, parseTriggerTime, pruneOrphanCopies, repeatDatesBetween, startOfDayMs } from './core/repeat.ts'
import { addDays, dayKey, minutesOfDay } from './core/calendar.ts'
import { parseTasks } from './core/store.ts'
import { calendarDir, ledgerPath } from './dsh-home.ts'

export const MAX_REQUEST_CACHE = 256
const MISSED_SCHEDULE_ERROR = 'scheduled dueAt was missed; the Agent was not started'
const INCOMPLETE_MODEL_PIN_ERROR = 'provider and model must be set together'

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

/** A currently running scheduled execution, used by Host-side tool policy. */
export interface ActiveScheduledExecution {
  taskId: string
  executionId: string
  sessionId: string
  /** Host-owned lineage depth: 0 is a user-created scheduled root. */
  scheduledDepth: number
}

/** Host-only metadata for mutations initiated by an already scheduled Agent. */
export interface HostMutationOptions {
  scheduledDepth?: number
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
  private readonly repeatHorizonDays: number

  constructor(
    private readonly persist: HostLedgerPersist,
    private readonly now: () => number = Date.now,
    private readonly uuid: () => string = randomId,
    private readonly timeZone: () => string = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'local',
    options: { repeatHorizonDays?: number } = {},
  ) {
    this.repeatHorizonDays = options.repeatHorizonDays ?? REPEAT_HORIZON_DAYS
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
    // Startup normalization drops orphaned copies, arms a future first repeat
    // occurrence, and records stale first occurrences as failed without replay.
    // Persist immediately so the reconciliation survives the next restart.
    const pruned = pruneOrphanCopies(this.state.tasks)
    const prunedAny = pruned.length !== this.state.tasks.length
    if (prunedAny) this.state.tasks = pruned
    const missedAny = this.normalizeMissedSchedules(this.now())
    if (prunedAny || missedAny) {
      this.commit()
    }
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

  /** Reconcile stale schedules and the first occurrence of repeat templates. */
  private normalizeMissedSchedules(now: number): boolean {
    let changed = false
    this.state.tasks = this.state.tasks.map(task => {
      const schedule = task.schedule
      if (schedule?.enabled === true && scheduleRetryExhausted(schedule)) {
        changed = true
        delete this.state.scheduler.nextRuns[task.id]
        if (schedule.repeat === undefined) return { ...task, schedule: undefined, updatedAt: now }
        if (schedule.nextRunAt === undefined) return { ...task, schedule: { ...schedule, retryCount: undefined }, updatedAt: now }
        return { ...task, schedule: { ...schedule, nextRunAt: undefined, retryCount: undefined }, updatedAt: now }
      }
      if (isMissedOneShot(task, now)) {
        changed = true
        delete this.state.scheduler.nextRuns[task.id]
        return failMissedScheduleTask(task, now, this.uuid())
      }
      const repeatDueAt = repeatTriggerDueAt(task)
      if (repeatDueAt === undefined || hasScheduledOccurrence(task, repeatDueAt)) {
        if (task.schedule?.repeat !== undefined && task.schedule.nextRunAt !== undefined && task.schedule.nextRunAt <= now) {
          changed = true
          delete this.state.scheduler.nextRuns[task.id]
          return { ...task, schedule: { ...task.schedule, nextRunAt: undefined }, updatedAt: now }
        }
        return task
      }
      if (repeatDueAt < now) {
        changed = true
        delete this.state.scheduler.nextRuns[task.id]
        return failMissedRepeatTask(task, repeatDueAt, now, this.uuid())
      }
      if (task.schedule?.nextRunAt !== repeatDueAt) {
        changed = true
        const schedule = { ...task.schedule!, nextRunAt: repeatDueAt }
        this.state.scheduler.nextRuns[task.id] = mirrorOf(schedule)
        return { ...task, schedule, updatedAt: now }
      }
      return task
    })
    return changed
  }

  /**
   * Apply a browser action. Idempotent per requestId: a fingerprint already
   * recorded short-circuits to the current snapshot without re-applying.
   */
  apply(envelope: calendarActionEnvelope, options: HostMutationOptions = {}): calendarActionResult {
    const { requestId, action } = envelope
    const fingerprint = fingerprintOf(envelope)
    const dup = this.state.recentRequests.find(r => r.requestId === requestId)
    if (dup !== undefined && dup.fingerprint === fingerprint) {
      return { ok: true, snapshot: this.snapshot() }
    }
    const validationError = this.validationError(action)
    if (validationError !== undefined) return { ok: false, error: validationError }
    const ok = this.dispatch(action, options)
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

  /** Read-only task view consumed directly by HostScheduleService. */
  tasks(): readonly TaskRecord[] {
    return this.state.tasks
  }

  /** Reject invalid execution pins before any action can mutate the ledger. */
  private validationError(action: calendarAction): string | undefined {
    if (action.kind === 'create' && hasIncompleteModelPin(action.input.provider, action.input.model)) {
      return INCOMPLETE_MODEL_PIN_ERROR
    }
    if (action.kind !== 'update') return undefined
    const task = this.taskById(action.id)
    if (task === undefined) return undefined
    const provider = action.patch.provider !== undefined ? action.patch.provider : task.provider
    const model = action.patch.model !== undefined ? action.patch.model : task.model
    return hasIncompleteModelPin(provider, model) ? INCOMPLETE_MODEL_PIN_ERROR : undefined
  }

  /**
   * Open a fresh execution record on a task (Host-runner entry). Guards:
   * the task must exist and must not already have an in-flight (unsettled)
   * execution. Appends the running record, bumps the revision, persists, and
   * notifies the browser so the view shows the run as started.
   */
  openExecution(taskId: string, executionId: string, now: number, triggeredBy: ExecutionTrigger = 'manual'): boolean {
    const task = this.taskById(taskId)
    if (task === undefined) return false
    if (task.executions.some(e => e.endedAt === undefined)) return false
    this.state.tasks = this.state.tasks.map(t => {
      if (t.id !== taskId) return t
      return startExecution(t, now, executionId, triggeredBy).task
    })
    this.commit()
    return true
  }

  /** Attach the execution session as soon as the runner connects to it. */
  attachExecutionSession(taskId: string, executionId: string, sessionId: string, now: number): boolean {
    const task = this.taskById(taskId)
    if (task === undefined || sessionId === '') return false
    const execution = task.executions.find(e => e.id === executionId)
    if (execution === undefined || execution.endedAt !== undefined || execution.sessionId !== undefined) return false
    this.state.tasks = this.state.tasks.map(t => t.id === taskId
      ? attachExecutionSession(t, executionId, sessionId, now)
      : t)
    this.commit()
    return true
  }

  /** Find the scheduled execution currently driving a Host Agent session. */
  activeScheduledExecution(sessionId: string): ActiveScheduledExecution | undefined {
    if (sessionId === '') return undefined
    for (const task of this.state.tasks) {
      const execution = task.executions.find(e => e.sessionId === sessionId && e.endedAt === undefined && e.triggeredBy === 'schedule')
      if (execution !== undefined) return { taskId: task.id, executionId: execution.id, sessionId, scheduledDepth: task.scheduledDepth ?? 0 }
    }
    return undefined
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
   * affordance). A repeat template's first occurrence is kept as a repeat rule
   * while its consumed nextRunAt is cleared; later dates are materialized as
   * copies. No-op when the task or its schedule is missing. Always persists +
   * notifies. */
  advanceSchedule(taskId: string, nextRunAt: number | undefined, lastTriggeredAt: number | undefined, retryCount?: number): boolean {
    const task = this.taskById(taskId)
    if (task === undefined || task.schedule === undefined) return false
    const hasRepeat = task.schedule.repeat !== undefined
    if (nextRunAt === undefined && !hasRepeat) {
      // One-shot completed: drop the schedule rule and its mirror.
      this.state.tasks = this.state.tasks.map(t => (t.id === taskId ? { ...t, schedule: undefined, updatedAt: this.now() } : t))
      delete this.state.scheduler.nextRuns[taskId]
    } else {
      this.state.tasks = setNextRun(this.state.tasks, taskId, nextRunAt, lastTriggeredAt, this.now(), retryCount)
      this.state.scheduler.nextRuns[taskId] = { nextRunAt, lastTriggeredAt }
    }
    this.commit()
    return true
  }

  /**
   * Materialize repeat copies (scheduler heartbeat): for every enabled,
   * non-archived repeat template, first align the series with its current rule
   * (prune bound copies on dates the rule no longer matches — e.g. narrowed
   * weekdays or holiday-skip toggled on — and drop those dates from the
   * template's `materialized` bookkeeping), then ensure one plain copy exists
   * on each matching date in the rolling horizon (from the day after the
   * template's own date / today, whichever is later, up to today + horizonDays).
   * Already-copied dates (tracked in schedule.materialized) are never
   * re-created, so deleting one occurrence permanently removes it from future
   * sweeps. Returns whether anything changed (only then does it persist +
   * notify).
   */
  materializeRepeats(now: number, horizonDays?: number): boolean {
    const changed = this.sweepRepeats(now, horizonDays ?? this.repeatHorizonDays)
    if (changed) this.commit()
    return changed
  }

  /**
   * Pure materialization sweep: mutates this.state.tasks (prunes stale bound
   * copies, adds missing ones) and returns whether anything changed, WITHOUT
   * persisting. Browser actions that arm or edit a repeat (create / setSchedule)
   * run it inline so the returned snapshot already reflects the copies — no
   * waiting for the 30s tick.
   */
  private sweepRepeats(now: number, horizonDays: number): boolean {
    const today = startOfDayMs(now)
    const horizonEnd = addDays(today, horizonDays)
    let next: TaskRecord[] = this.state.tasks
    let changed = false
    // Iterate the template snapshot present when the sweep started; `next` grows
    // as copies are appended, and those copies never qualify as templates.
    const seeds = this.state.tasks
    for (const seed of seeds) {
      const template = next.find(t => t.id === seed.id)
      if (template === undefined) continue
      const s = template.schedule
      if (s === undefined || s.enabled !== true || s.repeat === undefined) continue
      if (template.archivedAt !== undefined) continue
      if (!isValidRepeat(s.repeat)) continue
      // A rule change (fewer weekdays, holiday-skip on) can leave bound copies
      // on dates the current rule no longer matches: align first — prune them
      // and drop their materialized keys so a later re-inclusion re-copies.
      const { tasks: aligned, prunedIds } = alignSeries(next, template.id, now)
      if (prunedIds.length > 0) {
        next = aligned
        changed = true
        for (const prunedId of prunedIds) delete this.state.scheduler.nextRuns[prunedId]
      }
      const tpl = next.find(t => t.id === template.id)
      if (tpl === undefined || tpl.schedule?.repeat === undefined) continue
      const materialized = new Set(tpl.schedule.materialized ?? [])
      // The template occupies its own date; copies start the day after, never
      // backfilling into the past.
      const cursor = addDays(Math.max(today, startOfDayMs(tpl.startAt)), 1)
      const added: string[] = []
      for (const dateMs of repeatDatesBetween(tpl.schedule.repeat, cursor, horizonEnd)) {
        const key = dayKey(dateMs)
        if (materialized.has(key)) continue
        const copy = buildRepeatCopy(tpl, dateMs, now, this.uuid())
        next = [...next, copy]
        if (copy.schedule !== undefined) this.state.scheduler.nextRuns[copy.id] = mirrorOf(copy.schedule)
        materialized.add(key)
        added.push(key)
      }
      if (added.length > 0) {
        next = next.map(t => t.id === tpl.id
          ? { ...t, updatedAt: this.now(), schedule: { ...t.schedule!, materialized: [...materialized] } }
          : t)
        changed = true
      }
    }
    if (changed) this.state.tasks = next
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
  private dispatch(action: calendarAction, options: HostMutationOptions = {}): boolean {
    const now = this.now()
    switch (action.kind) {
      case 'create': {
        let task = createTask({ ...action.input, schedule: action.schedule }, now, this.uuid(), options.scheduledDepth)
        if (task === undefined) return false
        if (task.schedule !== undefined) {
          const armed = armSchedule(task, now)
          if (armed === undefined) return false
          // Keep the computed nextRunAt on the task itself. The scheduler scans
          // task records, while scheduler.nextRuns is only its persisted mirror.
          task = { ...task, schedule: armed }
        }
        if (isMissedOneShot(task, now)) task = failMissedScheduleTask(task, now, this.uuid())
        this.state.tasks = [...this.state.tasks, task]
        if (task.schedule !== undefined) {
          this.state.scheduler.nextRuns[task.id] = mirrorOf(task.schedule)
        }
        // Materialize immediately so the returned snapshot already shows the
        // repeat copies (no waiting for the 30s scheduler tick).
        if (task.schedule?.repeat !== undefined) this.sweepRepeats(now, this.repeatHorizonDays)
        this.normalizeMissedSchedules(now)
        return true
      }
      case 'update': {
        const before = this.state.tasks.find(t => t.id === action.id)
        if (before === undefined) return false
        let tasks = updateTask(this.state.tasks, action.id, action.patch, now)
        // Live sync (repeat template → bound copies): content + execution pins
        // propagate; per-instance state (done, executions, block times, unbind)
        // never does. Archived copies are left alone.
        if (isRepeatTemplate(before)) {
          const sync = templateSyncPatch(action.patch)
          if (Object.keys(sync).length > 0) {
            tasks = tasks.map(t => t.originTaskId === action.id && t.archivedAt === undefined
              ? updateTask([t], t.id, sync, now)[0]
              : t)
          }
        }
        this.state.tasks = tasks
        return true
      }
      case 'reschedule': {
        if (!Number.isFinite(action.startAt) || !Number.isFinite(action.endAt) || action.endAt <= action.startAt) return false
        const before = this.state.tasks.find(t => t.id === action.id)
        if (before === undefined) return false
        const template = before.originTaskId === undefined
          ? undefined
          : this.state.tasks.find(t => t.id === before.originTaskId)
        const shouldUnbind = action.unbind === true && before.originTaskId !== undefined
        const patch: TaskUpdatePatch = {
          startAt: action.startAt,
          endAt: action.endAt,
          ...(shouldUnbind ? { originTaskId: null } : {}),
        }
        let tasks = updateTask(this.state.tasks, action.id, patch, now)
        const moved = tasks.find(t => t.id === action.id)
        if (moved === undefined) return false
        const schedule = scheduleAfterReschedule(moved, template, now)
        tasks = tasks.map(t => t.id === action.id ? { ...t, schedule, updatedAt: now } : t)
        this.state.tasks = tasks
        if (schedule === undefined) delete this.state.scheduler.nextRuns[action.id]
        else this.state.scheduler.nextRuns[action.id] = mirrorOf(schedule)
        return true
      }
      case 'setQuadrant': {
        const before = this.state.tasks.find(t => t.id === action.id)
        let tasks = setQuadrant(this.state.tasks, action.id, action.urgency, action.importance, now)
        if (isRepeatTemplate(before)) {
          tasks = tasks.map(t => t.originTaskId === action.id && t.archivedAt === undefined
            ? setQuadrant([t], t.id, action.urgency, action.importance, now)[0]
            : t)
        }
        this.state.tasks = tasks
        return this.state.tasks.some(t => t.id === action.id)
      }
      case 'setDone':
        // Per-instance: never propagates.
        this.state.tasks = setTaskDone(this.state.tasks, action.id, action.done, now)
        return this.state.tasks.some(t => t.id === action.id)
      case 'addSubtask': {
        const before = this.state.tasks.find(t => t.id === action.id)
        let tasks = addSubtask(this.state.tasks, action.id, { id: action.subtaskId, title: action.title }, now)
        // Subtask structure syncs from the template to bound copies; done-state
        // stays per-instance (setSubtaskDone never propagates).
        if (isRepeatTemplate(before)) {
          tasks = tasks.map(t => t.originTaskId === action.id && t.archivedAt === undefined
            ? addSubtask([t], t.id, { id: action.subtaskId, title: action.title }, now)[0]
            : t)
        }
        this.state.tasks = tasks
        return true
      }
      case 'setSubtaskDone':
        this.state.tasks = setSubtaskDone(this.state.tasks, action.id, action.subtaskId, action.done, now)
        return true
      case 'removeSubtask': {
        const before = this.state.tasks.find(t => t.id === action.id)
        let tasks = removeSubtask(this.state.tasks, action.id, action.subtaskId, now)
        if (isRepeatTemplate(before)) {
          tasks = tasks.map(t => t.originTaskId === action.id && t.archivedAt === undefined
            ? removeSubtask([t], t.id, action.subtaskId, now)[0]
            : t)
        }
        this.state.tasks = tasks
        return true
      }
      case 'delete': {
        // Deleting a repeat template cascades to its bound copies (a rule
        // without its template is meaningless); deleting one copy removes only
        // that copy, and its date stays marked materialized so the sweep never
        // re-creates it. Unbound copies survive a template delete.
        const removed = removeTaskRecords(this.state.tasks, action.id, true)
        if (removed.removedIds.length === 0) return false
        this.state.tasks = removed.tasks
        deleteSchedulerMirrors(this.state.scheduler.nextRuns, removed.removedIds)
        return true
      }
      case 'deleteInstance': {
        // A repeat template owns the series, so deleting only its first
        // occurrence is represented as a Host-owned date tombstone. Copies
        // remain real tasks and future dates keep materializing normally.
        const target = this.state.tasks.find(t => t.id === action.id)
        if (target === undefined || !isRepeatMember(target)) return false
        if (isRepeatTemplate(target)) {
          this.state.tasks = this.state.tasks.map(t => t.id === action.id
            ? markRepeatTemplateOccurrence(t, 'deletedDates', now)
            : t)
          delete this.state.scheduler.nextRuns[action.id]
          return true
        }
        const removed = removeTaskRecords(this.state.tasks, action.id, false)
        if (removed.removedIds.length === 0) return false
        this.state.tasks = removed.tasks
        deleteSchedulerMirrors(this.state.scheduler.nextRuns, removed.removedIds)
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
        const target = this.state.tasks.find(t => t.id === action.id)
        if (target === undefined) return false
        // A copy's schedule IS the series' schedule: route to the template so
        // editing/cancelling the repeat from any member behaves identically
        // (unbound copies schedule themselves).
        const scheduleId = target.originTaskId ?? action.id
        const before = this.state.tasks.find(t => t.id === scheduleId)
        let tasks = setSchedule(this.state.tasks, scheduleId, action.patch, now, options.scheduledDepth)
        const task = tasks.find(t => t.id === scheduleId)
        if (task === undefined) return false
        // Clearing the repeat rule ends the series: its bound copies go away.
        if (before !== undefined && before.schedule?.repeat !== undefined && action.patch.repeat === null) {
          const removedIds = tasks.filter(t => t.originTaskId === scheduleId).map(t => t.id)
          tasks = tasks.filter(t => t.originTaskId !== scheduleId)
          deleteSchedulerMirrors(this.state.scheduler.nextRuns, removedIds)
        }
        if (task.schedule !== undefined) {
          const active = task.schedule.enabled || task.schedule.repeat !== undefined || task.schedule.dueAt !== undefined
          const nextRunAt = active ? computeNextRun(task, now) : undefined
          tasks = setNextRun(tasks, scheduleId, nextRunAt, task.schedule.lastTriggeredAt, now)
        }
        // re-read after possible setNextRun
        let updated = tasks.find(t => t.id === scheduleId)
        if (updated?.schedule !== undefined && isMissedOneShot(updated, now)) {
          tasks = tasks.map(t => t.id === scheduleId ? failMissedScheduleTask(t, now, this.uuid()) : t)
          updated = tasks.find(t => t.id === scheduleId)
        }
        if (updated?.schedule !== undefined) this.state.scheduler.nextRuns[scheduleId] = mirrorOf(updated.schedule)
        else delete this.state.scheduler.nextRuns[scheduleId]
        // When the (still active) repeat rule changes, re-derive the trigger
        // one-shots of already-materialized bound copies so the series stays
        // coherent: future occurrences gain/keep their dueAt, occurrences whose
        // trigger was turned off (or that are already past) become plain tasks.
        if (updated?.schedule?.repeat !== undefined) {
          const rule = updated.schedule.repeat
          const triggerAgent = rule.triggerAgent === true && updated.schedule.enabled === true
          const triggerMinutes = triggerAgent ? (parseTriggerTime(rule.triggerAt) ?? minutesOfDay(updated.startAt)) : 0
          tasks = tasks.map(t => {
            if (t.originTaskId !== scheduleId || t.archivedAt !== undefined) return t
            if (triggerAgent) {
              const dueAt = startOfDayMs(t.startAt) + triggerMinutes * 60_000
              const lineage = updated.scheduledDepth !== undefined ? { scheduledDepth: updated.scheduledDepth } : {}
              if (dueAt >= now) return { ...t, ...lineage, schedule: { enabled: true, dueAt, nextRunAt: dueAt }, updatedAt: now }
              return { ...t, ...lineage, schedule: { enabled: true, dueAt, nextRunAt: undefined }, updatedAt: now }
            }
            return t.schedule === undefined ? t : { ...t, schedule: undefined, updatedAt: now }
          })
        }
        this.state.tasks = tasks
        // Materialize immediately (idempotent) so the returned snapshot already
        // shows any newly-armed repeat's copies — no waiting for the 30s tick.
        if (updated?.schedule?.repeat !== undefined) this.sweepRepeats(now, this.repeatHorizonDays)
        this.normalizeMissedSchedules(now)
        return true
      }
      case 'clearInstanceSchedule': {
        // "Cancel this day only": do not route through the template. A repeat
        // copy loses its own trigger one-shot; the template keeps the repeat
        // rule but records its own date as skipped so normalization cannot
        // re-arm the first occurrence on the next Host tick.
        const target = this.state.tasks.find(t => t.id === action.id)
        if (target === undefined || target.schedule === undefined) return false
        if (isRepeatTemplate(target)) {
          this.state.tasks = this.state.tasks.map(t => t.id === action.id
            ? markRepeatTemplateOccurrence(t, 'skippedDates', now)
            : t)
          delete this.state.scheduler.nextRuns[action.id]
          return true
        }
        this.state.tasks = this.state.tasks.map(t => t.id === action.id ? { ...t, schedule: undefined, updatedAt: now } : t)
        delete this.state.scheduler.nextRuns[action.id]
        return true
      }
      case 'shiftRepeatTimes': {
        // "Change all copies": shift the template and only future bound copies
        // by the same start/end deltas. Past occurrences are historical records;
        // they must not be rewritten or accidentally re-armed.
        const target = this.state.tasks.find(t => t.id === action.id)
        if (target === undefined) return false
        const root = target.originTaskId ?? (target.schedule?.repeat !== undefined ? target.id : undefined)
        if (root === undefined) return false
        const template = this.state.tasks.find(t => t.id === root)
        const repeat = template?.schedule?.repeat
        if (template === undefined || repeat === undefined) return false
        let hit = false
        this.state.tasks = this.state.tasks.map(t => {
          if (t.id === root) {
            hit = true
            const startAt = t.startAt + action.startDelta
            const endAt = t.endAt + action.endDelta
            const schedule = repeatTemplateSchedule(t.schedule!, repeat, startAt, now)
            this.state.scheduler.nextRuns[t.id] = mirrorOf(schedule)
            return { ...t, startAt, endAt, schedule, updatedAt: now }
          }
          if (t.originTaskId !== root || currentRepeatOccurrenceAt(t, repeat) <= now) return t
          hit = true
          const startAt = t.startAt + action.startDelta
          const endAt = t.endAt + action.endDelta
          const schedule = repeatCopySchedule(repeat, startAt, now, template.schedule?.enabled === true)
          if (schedule === undefined) delete this.state.scheduler.nextRuns[t.id]
          else this.state.scheduler.nextRuns[t.id] = mirrorOf(schedule)
          return { ...t, startAt, endAt, schedule, updatedAt: now }
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

function deleteSchedulerMirrors(
  nextRuns: PersistedScheduler['nextRuns'],
  ids: readonly string[],
): void {
  for (const id of ids) delete nextRuns[id]
}

type RepeatOccurrenceMarker = 'skippedDates' | 'deletedDates'

/** Mark one template occurrence without changing the future repeat series. */
function markRepeatTemplateOccurrence(
  task: TaskRecord,
  marker: RepeatOccurrenceMarker,
  now: number,
): TaskRecord {
  const schedule = task.schedule
  if (schedule?.repeat === undefined) return task
  const dateKey = dayKey(task.startAt)
  const dates = [...new Set([...(schedule[marker] ?? []), dateKey])]
  const nextSchedule = { ...schedule, nextRunAt: undefined, retryCount: undefined }
  if (marker === 'skippedDates') nextSchedule.skippedDates = dates
  else nextSchedule.deletedDates = dates
  return { ...task, schedule: nextSchedule, updatedAt: now }
}

/** Arm a fresh schedule: one-shots and a repeat template's first occurrence
 * get a next-run instant; later repeat dates are materialized as copies. */
function armSchedule(task: TaskRecord, now: number): TaskRecord['schedule'] | undefined {
  const s = task.schedule
  if (s === undefined) return undefined
  if (!s.enabled && s.repeat === undefined && s.dueAt === undefined) return undefined
  const next = computeNextRun(task, now)
  return { ...s, nextRunAt: next ?? undefined }
}

/** Compute the next run for a one-shot or a repeat template's first occurrence. */
function computeNextRun(task: TaskRecord, now: number): number | undefined {
  const s = task.schedule
  if (s === undefined) return undefined
  const repeatDueAt = repeatTriggerDueAt(task)
  if (repeatDueAt !== undefined && !hasScheduledOccurrence(task, repeatDueAt) && repeatDueAt >= now) return repeatDueAt
  // A due time already in the past is handled as a failed, non-replayed run.
  if (s.dueAt !== undefined && s.dueAt >= now) return s.dueAt
  return undefined
}

/** The first repeat occurrence uses the template's own calendar date. */
function repeatTriggerDueAt(task: TaskRecord | undefined): number | undefined {
  const schedule = task?.schedule
  const repeat = schedule?.repeat
  if (task === undefined || schedule?.enabled !== true || repeat?.triggerAgent !== true) return undefined
  const dateKey = dayKey(task.startAt)
  if (schedule.skippedDates?.includes(dateKey) || schedule.deletedDates?.includes(dateKey)) return undefined
  return repeatDueAtForStart(repeat, task.startAt)
}

/** Derive a repeat trigger from a block start without consulting old executions. */
function repeatDueAtForStart(repeat: NonNullable<TaskRecord['schedule']>['repeat'], startAt: number): number | undefined {
  if (repeat === undefined || repeat.triggerAgent !== true) return undefined
  const dateMs = startOfDayMs(startAt)
  if (!matchesRepeat(repeat, dateMs)) return undefined
  const triggerMinutes = parseTriggerTime(repeat.triggerAt) ?? minutesOfDay(startAt)
  return dateMs + triggerMinutes * 60_000
}

type Schedule = NonNullable<TaskRecord['schedule']>

/** A fresh one-shot for a materialized or unbound repeat occurrence. */
function oneShotSchedule(dueAt: number): Schedule {
  return { enabled: true, dueAt, nextRunAt: dueAt }
}

/** Recompute a repeat template's first occurrence and reset retry state. */
function repeatTemplateSchedule(current: Schedule, repeat: NonNullable<Schedule['repeat']>, startAt: number, now: number): Schedule {
  const dueAt = current.enabled === true ? repeatDueAtForStart(repeat, startAt) : undefined
  const dateKey = dayKey(startAt)
  const skippedDates = current.skippedDates?.filter(key => key !== dateKey)
  const deletedDates = current.deletedDates?.filter(key => key !== dateKey)
  return {
    ...current,
    nextRunAt: dueAt !== undefined && dueAt > now ? dueAt : undefined,
    lastTriggeredAt: undefined,
    retryCount: undefined,
    skippedDates: skippedDates !== undefined && skippedDates.length > 0 ? skippedDates : undefined,
    deletedDates: deletedDates !== undefined && deletedDates.length > 0 ? deletedDates : undefined,
  }
}

/** Recompute a materialized copy's one-shot without recording a missed run. */
function repeatCopySchedule(repeat: NonNullable<Schedule['repeat']>, startAt: number, now: number, enabled = true): Schedule | undefined {
  if (!enabled) return undefined
  const dueAt = repeatDueAtForStart(repeat, startAt)
  return dueAt !== undefined && dueAt > now ? oneShotSchedule(dueAt) : undefined
}

/** The current trigger instant used to decide whether a bound copy is future. */
function currentRepeatOccurrenceAt(task: TaskRecord, repeat: NonNullable<Schedule['repeat']>): number {
  return task.schedule?.dueAt ?? repeatDueAtForStart(repeat, task.startAt) ?? task.startAt
}

/**
 * Decide the schedule after a user explicitly moves one occurrence.
 *
 * Repeat templates keep their repeat rule and use the rule's fixed trigger
 * time-of-day. Bound copies inherit that rule for the "this copy" operation,
 * then become independent one-shots. Standalone one-shots keep their existing
 * absolute dueAt while they are still armed; moving a settled one-shot never
 * creates a new trigger. A move into the past only changes the calendar block
 * and never synthesizes a missed execution.
 */
function scheduleAfterReschedule(
  moved: TaskRecord,
  template: TaskRecord | undefined,
  now: number,
): TaskRecord['schedule'] {
  const directRepeat = moved.schedule?.repeat
  if (directRepeat !== undefined) {
    return repeatTemplateSchedule(moved.schedule!, directRepeat, moved.startAt, now)
  }

  const inheritedRepeat = template?.schedule?.repeat
  if (template?.schedule?.enabled === true && inheritedRepeat?.triggerAgent === true) {
    return repeatCopySchedule(inheritedRepeat, moved.startAt, now)
  }

  return moved.schedule
}

function hasScheduledOccurrence(task: TaskRecord, dueAt: number): boolean {
  const occurrenceKey = dayKey(dueAt)
  return task.executions.some(execution => execution.triggeredBy === 'schedule' && dayKey(execution.startedAt) === occurrenceKey)
}

function isMissedOneShot(task: TaskRecord | undefined, now: number): boolean {
  if (task === undefined) return false
  const schedule = task.schedule
  return schedule?.enabled === true
    && schedule.repeat === undefined
    && schedule.dueAt !== undefined
    && schedule.dueAt < now
}

/** Record a missed scheduled attempt and remove its one-shot trigger. */
function failMissedScheduleTask(task: TaskRecord, now: number, executionId: string): TaskRecord {
  const dueAt = task.schedule?.dueAt
  if (dueAt === undefined) return task
  const started = startExecution(task, dueAt, executionId, 'schedule').task
  const failed = settleExecution(started, executionId, 'failed', now, MISSED_SCHEDULE_ERROR)
  return { ...failed, schedule: undefined }
}

/** Record a missed first repeat occurrence but keep the repeating template. */
function failMissedRepeatTask(task: TaskRecord, dueAt: number, now: number, executionId: string): TaskRecord {
  const started = startExecution(task, dueAt, executionId, 'schedule').task
  const failed = settleExecution(started, executionId, 'failed', now, MISSED_SCHEDULE_ERROR)
  return { ...failed, schedule: { ...failed.schedule!, nextRunAt: undefined } }
}

/** Human copy for an action that was rejected. */
export function actionError(action: calendarAction): string {
  return `unknown or rejected calendar action of kind "${action.kind}"`
}

/**
 * The fields of an update patch that sync from a repeat template to its bound
 * copies: content + execution pins. Block times, done and the unbind flag stay
 * per-instance and are excluded.
 */
function templateSyncPatch(patch: TaskUpdatePatch): TaskUpdatePatch {
  const out: TaskUpdatePatch = {}
  const syncable = ['title', 'description', 'prompt', 'allDay', 'urgency', 'importance',
    'workspaceId', 'sessionId', 'provider', 'model', 'reasoningEffort', 'mode', 'permission'] as const
  for (const key of syncable) {
    const value = patch[key]
    if (value !== undefined) (out as Record<string, unknown>)[key] = value
  }
  return out
}

/** Remove one task, or a repeat root plus its bound copies, and report ids. */
function removeTaskRecords(
  tasks: readonly TaskRecord[],
  id: string,
  cascadeSeries: boolean,
): { tasks: TaskRecord[]; removedIds: string[] } {
  const target = tasks.find(task => task.id === id)
  if (target === undefined) return { tasks: [...tasks], removedIds: [] }
  const cascade = cascadeSeries && target.originTaskId === undefined
  const removedIds = tasks
    .filter(task => task.id === id || (cascade && task.originTaskId === id))
    .map(task => task.id)
  return {
    tasks: tasks.filter(task => !removedIds.includes(task.id)),
    removedIds,
  }
}
