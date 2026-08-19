/**
 * dsh-calendar domain model: the task record shape, the Eisenhower
 * urgency/importance model, subtasks, scheduled-run rules, execution records,
 * and the pure transition functions the Host ledger, the HTTP protocol and the
 * browser view share.
 *
 * Framework-free (no cordis, no runtime imports) so the state machine is
 * unit-testable in isolation and safely shared between the Host half and the
 * browser half (the client bundle inlines these files).
 */

/** Urgency knob (Eisenhower): how time-critical the task is. */
export type Urgency = 'high' | 'medium' | 'low'
/** Importance knob (Eisenhower): how impactful the task is. */
export type Importance = 'high' | 'medium' | 'low'

/**
 * The derived Eisenhower quadrant. The four-terminal mapping keeps the color
 * language and any surface filtering one place.
 *   high×high   → 'do'          (do it now)
 *   low×high    → 'schedule'    (plan a time)
 *   high×low    → 'delegate'    (hand off)
 *   low×low     → 'eliminate'   (drop / low priority)
 */
export type Quadrant = 'do' | 'schedule' | 'delegate' | 'eliminate'

/** The three urgency values (closed union guard). */
export const URGENCIES: readonly Urgency[] = ['high', 'medium', 'low']
/** The three importance values (closed union guard). */
export const IMPORTANCES: readonly Importance[] = ['high', 'medium', 'low']
/** All four quadrants. */
export const QUADRANTS: readonly Quadrant[] = ['do', 'schedule', 'delegate', 'eliminate']

/** Permission preset pinned on the execution session (the /permission ids). */
export const TASK_PERMISSIONS = ['read-only', 'workspace-write', 'danger-full-access'] as const
export type TaskPermission = (typeof TASK_PERMISSIONS)[number]

/**
 * Constrained repeat kinds (replaces free-form cron). `daily` repeats on every
 * day; `weekly` repeats on the chosen weekdays only.
 */
export type RepeatKind = 'daily' | 'weekly'

/** A constrained repeat rule; the Host materializes a copy on each matching date. */
export interface RepeatRule {
  kind: RepeatKind
  /** Weekly only: JS weekdays 0=Sun..6=Sat; must be non-empty when kind is weekly. */
  weekdays?: number[]
  /** Skip weekends + curated public holidays when materializing. */
  skipHolidays?: boolean
  /** When true, materialized copies carry a one-shot due schedule that auto-runs
   * the agent at `triggerAt` (HH:MM) or, when absent, at the block start. */
  triggerAgent?: boolean
  /** Trigger time-of-day override (HH:MM); ignored unless triggerAgent. */
  triggerAt?: string
}

/** Whether a value is structurally a repeat rule. */
export function isRepeatRule(value: unknown): value is RepeatRule {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  if (r.kind !== 'daily' && r.kind !== 'weekly') return false
  if (r.weekdays !== undefined && (!Array.isArray(r.weekdays) || r.weekdays.some(d => typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6))) return false
  if (r.triggerAt !== undefined && (typeof r.triggerAt !== 'string' || !/^\d{1,2}:\d{2}$/.test(r.triggerAt))) return false
  return true
}

/** One checklist subtask under a parent task. */
export interface SubtaskRecord {
  id: string
  title: string
  done: boolean
}

/** One real execution attempt against a dsh session. */
export interface ExecutionRecord {
  /** Execution attempt id. */
  id: string
  /** The dsh session that ran this attempt; filled once known. */
  sessionId?: string
  startedAt: number
  /** Absent while still running. */
  endedAt?: number
  result?: 'succeeded' | 'failed' | 'cancelled'
  error?: string
}

/**
 * A scheduled-run rule. Two mutually exclusive shapes:
 *  - a repeat rule (`repeat`): the Host materializes one plain copy of the
 *    task on each matching date (no auto-run on the template itself);
 *  - a one-shot absolute instant (`dueAt`): the Host scheduler fires a real
 *    execution at that instant and then clears the schedule.
 * `nextRunAt`/`lastTriggeredAt` are the one-shot scheduler mirror;
 * `materialized` is Host-owned bookkeeping of already-copied dates.
 */
export interface ScheduleRule {
  /** Whether the schedule is armed. */
  enabled: boolean
  /** Constrained repeat rule; absent for a one-shot dueAt. */
  repeat?: RepeatRule
  /** One-shot absolute instant (ms epoch, typically seeded from the drag slot). */
  dueAt?: number
  /** Next due instant (ms epoch); maintained by the scheduler (one-shots only). */
  nextRunAt?: number
  /** Instant of the most recent scheduled trigger. */
  lastTriggeredAt?: number
  /** Host-owned: YYYY-MM-DD keys already copied as repeat occurrences. */
  materialized?: string[]
}

/** One calendar todo task. */
export interface TaskRecord {
  id: string
  title: string
  description: string
  /** The prompt sent to dsh when the task is executed (empty → title). */
  prompt: string
  /** Block start (ms epoch); the calendar placement. */
  startAt: number
  /** Block end (ms epoch); must be > startAt for a timed block. */
  endAt: number
  allDay?: boolean
  /** Eisenhower knobs. */
  urgency: Urgency
  importance: Importance
  done: boolean
  subtasks: SubtaskRecord[]
  executions: ExecutionRecord[]
  schedule?: ScheduleRule
  /** Execution target: workspace the run lands in; absent → recent workspace. */
  workspaceId?: string
  /** Execution target: a pinned existing session to reuse; absent → create. */
  sessionId?: string
  /** Execution target: LLM provider route (paired with model). */
  provider?: string
  /** Execution target: provider-owned model id. */
  model?: string
  /** Execution target: adapter-owned reasoning effort. */
  reasoningEffort?: string
  /** Execution target: agent preset; absent → deployment default. */
  mode?: string
  /** Execution target: /permission preset; absent → session default. */
  permission?: TaskPermission
  /** For repeat copies: the template task id that spawned this copy. */
  originTaskId?: string
  archivedAt?: number
  createdAt: number
  updatedAt: number
}

/** Input for creating a task. */
export interface NewTaskInput {
  title: string
  description: string
  prompt: string
  startAt: number
  endAt: number
  allDay?: boolean
  urgency: Urgency
  importance: Importance
  subtasks?: SubtaskRecord[]
  workspaceId?: string
  sessionId?: string
  provider?: string
  model?: string
  reasoningEffort?: string
  mode?: string
  permission?: TaskPermission
  /** Requested schedule at creation (armed only when valid). */
  schedule?: { enabled: boolean; repeat?: RepeatRule; dueAt?: number }
}

/** An update patch (partial; only present keys change). */
export interface TaskUpdatePatch {
  title?: string
  description?: string
  prompt?: string
  startAt?: number
  endAt?: number
  allDay?: boolean
  urgency?: Urgency
  importance?: Importance
  done?: boolean
  workspaceId?: string | null
  sessionId?: string | null
  provider?: string | null
  model?: string | null
  reasoningEffort?: string | null
  mode?: string | null
  permission?: TaskPermission | null
  /** `null` unbinds a repeat copy from its template. */
  originTaskId?: string | null
}

/** Whether a value is one of the closed urgency values. */
export function isUrgency(value: unknown): value is Urgency {
  return typeof value === 'string' && (URGENCIES as readonly string[]).includes(value)
}
/** Whether a value is one of the closed importance values. */
export function isImportance(value: unknown): value is Importance {
  return typeof value === 'string' && (IMPORTANCES as readonly string[]).includes(value)
}
/** Whether a value is a known permission preset id. */
export function isTaskPermission(value: unknown): value is TaskPermission {
  return typeof value === 'string' && (TASK_PERMISSIONS as readonly string[]).includes(value)
}

/** Derive the Eisenhower quadrant from the two knobs. */
export function quadrantOf(urgency: Urgency, importance: Importance): Quadrant {
  if (importance === 'high') return urgency === 'high' ? 'do' : 'schedule'
  return urgency === 'high' ? 'delegate' : 'eliminate'
}

/**
 * Whether a task will actually run an agent at a due instant. This drives the
 * 🕐 badge (and only that): the clock means "this task auto-triggers an agent".
 * It is true for a one-shot dueAt schedule, or a repeat rule with
 * `triggerAgent` enabled. It is false for a plain task, a repeat template (or
 * copy) whose rule does NOT trigger an agent, and a plain materialized copy —
 * materializing copies onto dates is not an agent trigger.
 */
export function taskTriggersAgent(task: Pick<TaskRecord, 'schedule'>): boolean {
  const s = task.schedule
  if (s === undefined || s.enabled !== true) return false
  if (s.dueAt !== undefined) return true
  return s.repeat?.triggerAgent === true
}

/**
 * Collapse a repeat series into a single representative row for list views
 * (matrix / agenda). A series is a template (schedule.repeat, no originTaskId)
 * plus every materialized copy (originTaskId === template id). The week grid
 * keeps the real timeline, but list views would otherwise show one near-identical
 * row per materialized date. Each series contributes at most one entry: the
 * newest unfinished occurrence (max startAt among not-done members — including
 * the template itself); if every member is done, the newest member is kept so
 * the task is not lost entirely. Standalone tasks pass through unchanged.
 */
export function collapseRepeatSeries(tasks: readonly TaskRecord[]): TaskRecord[] {
  const copies = new Map<string, TaskRecord[]>()
  const templates = new Map<string, TaskRecord>()
  const standalone: TaskRecord[] = []
  for (const t of tasks) {
    if (t.originTaskId !== undefined) {
      const arr = copies.get(t.originTaskId) ?? []
      arr.push(t)
      copies.set(t.originTaskId, arr)
    } else if (t.schedule?.repeat !== undefined) {
      templates.set(t.id, t)
    } else {
      standalone.push(t)
    }
  }
  const out: TaskRecord[] = [...standalone]
  const seriesIds = new Set([...copies.keys(), ...templates.keys()])
  for (const sId of seriesIds) {
    const members: TaskRecord[] = [...(copies.get(sId) ?? [])]
    const tpl = templates.get(sId)
    if (tpl !== undefined) members.push(tpl)
    if (members.length === 0) continue
    const incomplete = members.filter(m => !m.done)
    const pool = incomplete.length > 0 ? incomplete : members
    pool.sort((a, b) => a.startAt - b.startAt)
    out.push(pool[pool.length - 1])
  }
  return out
}

/** Normalize an optional execution-target string: trim; blank collapses to undefined. */
function normalizeTargetId(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === '' ? undefined : trimmed
}

/**
 * Create a task from input. A blank title is rejected (returns undefined),
 * the block interval is clamped to a minimum of one minute, and execution
 * targets are normalized (blank → undefined). A requested schedule is armed
 * only when enabled and (globally) valid at schedule-application time.
 */
export function createTask(input: NewTaskInput, now: number, id: string): TaskRecord | undefined {
  const title = input.title.trim()
  if (title === '') return undefined
  const startAt = input.startAt
  const endAt = input.endAt > startAt ? input.endAt : startAt + 60_000
  const schedule: ScheduleRule | undefined = input.schedule?.enabled === true
    ? { enabled: true, repeat: isRepeatRule(input.schedule.repeat) ? input.schedule.repeat : undefined, dueAt: input.schedule.dueAt }
    : undefined
  return {
    id,
    title,
    description: input.description.trim(),
    prompt: input.prompt.trim(),
    startAt,
    endAt,
    allDay: input.allDay ?? false,
    urgency: isUrgency(input.urgency) ? input.urgency : 'medium',
    importance: isImportance(input.importance) ? input.importance : 'medium',
    done: false,
    subtasks: input.subtasks ?? [],
    executions: [],
    schedule,
    workspaceId: normalizeTargetId(input.workspaceId),
    sessionId: normalizeTargetId(input.sessionId),
    provider: normalizeTargetId(input.provider),
    model: normalizeTargetId(input.model),
    reasoningEffort: normalizeTargetId(input.reasoningEffort),
    mode: normalizeTargetId(input.mode),
    permission: isTaskPermission(input.permission) ? input.permission : undefined,
    createdAt: now,
    updatedAt: now,
  }
}

/** Apply an update patch to one task (unknown ids map to the same array). */
export function updateTask(tasks: readonly TaskRecord[], id: string, patch: TaskUpdatePatch, now: number): TaskRecord[] {
  return tasks.map(task => {
    if (task.id !== id) return task
    const next: TaskRecord = { ...task, updatedAt: now }
    if (patch.title !== undefined) next.title = patch.title.trim()
    if (patch.description !== undefined) next.description = patch.description.trim()
    if (patch.prompt !== undefined) next.prompt = patch.prompt.trim()
    if (patch.startAt !== undefined) next.startAt = patch.startAt
    if (patch.endAt !== undefined) next.endAt = patch.endAt
    if (patch.allDay !== undefined) next.allDay = patch.allDay
    if (patch.urgency !== undefined && isUrgency(patch.urgency)) next.urgency = patch.urgency
    if (patch.importance !== undefined && isImportance(patch.importance)) next.importance = patch.importance
    if (patch.done !== undefined) next.done = patch.done
    if (patch.workspaceId !== undefined) next.workspaceId = normalizeTargetId(patch.workspaceId ?? undefined)
    if (patch.sessionId !== undefined) next.sessionId = normalizeTargetId(patch.sessionId ?? undefined)
    if (patch.provider !== undefined) next.provider = normalizeTargetId(patch.provider ?? undefined)
    if (patch.model !== undefined) next.model = normalizeTargetId(patch.model ?? undefined)
    if (patch.reasoningEffort !== undefined) next.reasoningEffort = normalizeTargetId(patch.reasoningEffort ?? undefined)
    if (patch.mode !== undefined) next.mode = normalizeTargetId(patch.mode ?? undefined)
    if (patch.permission !== undefined) next.permission = isTaskPermission(patch.permission) ? patch.permission : undefined
    if (patch.originTaskId !== undefined) next.originTaskId = normalizeTargetId(patch.originTaskId ?? undefined)
    return next
  })
}

/** Set the task's quadrant by writing both knobs. */
export function setQuadrant(tasks: readonly TaskRecord[], id: string, urgency: Urgency, importance: Importance, now: number): TaskRecord[] {
  if (!isUrgency(urgency) || !isImportance(importance)) return [...tasks]
  return tasks.map(task => task.id === id ? { ...task, urgency, importance, updatedAt: now } : task)
}

/** Toggle the task's done flag. */
export function setTaskDone(tasks: readonly TaskRecord[], id: string, done: boolean, now: number): TaskRecord[] {
  return tasks.map(task => task.id === id ? { ...task, done, updatedAt: now } : task)
}

/** Add an unduplicated subtask (blank titles dropped). */
export function addSubtask(tasks: readonly TaskRecord[], id: string, subtask: { id: string; title: string }, now: number): TaskRecord[] {
  const title = subtask.title.trim()
  if (title === '') return [...tasks]
  return tasks.map(task => task.id === id && !task.subtasks.some(s => s.id === subtask.id)
    ? { ...task, subtasks: [...task.subtasks, { id: subtask.id, title, done: false }], updatedAt: now }
    : task)
}

/** Set one subtask's done flag. */
export function setSubtaskDone(tasks: readonly TaskRecord[], taskId: string, subtaskId: string, done: boolean, now: number): TaskRecord[] {
  return tasks.map(task => task.id !== taskId ? task : {
    ...task,
    updatedAt: now,
    subtasks: task.subtasks.map(s => s.id === subtaskId ? { ...s, done } : s),
  })
}

/** Remove a subtask. */
export function removeSubtask(tasks: readonly TaskRecord[], taskId: string, subtaskId: string, now: number): TaskRecord[] {
  return tasks.map(task => task.id !== taskId ? task : {
    ...task,
    updatedAt: now,
    subtasks: task.subtasks.filter(s => s.id !== subtaskId),
  })
}

/** Count of completed subtasks. */
export function completedSubtaskCount(task: TaskRecord): number {
  return task.subtasks.reduce((n, s) => n + (s.done ? 1 : 0), 0)
}

/** Fraction of subtasks completed in [0, 1]; 0 when there are none. */
export function subtaskProgress(task: TaskRecord): number {
  return task.subtasks.length === 0 ? 0 : completedSubtaskCount(task) / task.subtasks.length
}

/** Delete a task (returns new array and whether the selection should clear). */
export function deleteTask(tasks: readonly TaskRecord[], selectedId: string | undefined, id: string): { tasks: TaskRecord[]; selectionCleared: boolean } {
  const next = tasks.filter(task => task.id !== id)
  return { tasks: next, selectionCleared: selectedId === id }
}

/** Archive a task (already-archived tasks are no-ops). */
export function archiveTask(tasks: readonly TaskRecord[], id: string, now: number): { tasks: TaskRecord[]; archived: boolean } {
  let archived = false
  const next = tasks.map(task => {
    if (task.id !== id || task.archivedAt !== undefined) return task
    archived = true
    return { ...task, archivedAt: now, updatedAt: now }
  })
  return { tasks: next, archived }
}

/** Restore an archived task back onto the calendar. */
export function restoreTask(tasks: readonly TaskRecord[], id: string, now: number): { tasks: TaskRecord[]; restored: boolean } {
  let restored = false
  const next = tasks.map(task => {
    if (task.id !== id || task.archivedAt === undefined) return task
    restored = true
    const { archivedAt: _gone, ...rest } = task
    return { ...rest, updatedAt: now }
  })
  return { tasks: next, restored }
}

/** Schedule patch: `undefined` leaves a field untouched; `null` clears it. */
export interface SchedulePatch {
  enabled?: boolean
  repeat?: RepeatRule | null
  dueAt?: number | null
}

/** Set (merge) a task's schedule rule and persist it. `null` clears a field. */
export function setSchedule(tasks: readonly TaskRecord[], id: string, patch: SchedulePatch, now: number): TaskRecord[] {
  return tasks.map(task => {
    if (task.id !== id) return task
    const current = task.schedule ?? { enabled: false }
    const schedule: ScheduleRule = {
      enabled: patch.enabled ?? current.enabled,
      repeat: patch.repeat === null
        ? undefined
        : patch.repeat !== undefined && isRepeatRule(patch.repeat) ? patch.repeat : current.repeat,
      dueAt: patch.dueAt === null ? undefined : (patch.dueAt !== undefined ? patch.dueAt : current.dueAt),
      nextRunAt: current.nextRunAt,
      lastTriggeredAt: current.lastTriggeredAt,
    }
    // Repeating templates keep their materialization bookkeeping; a one-shot
    // roll-forward leaves it untouched.
    if (schedule.repeat !== undefined && current.materialized !== undefined) schedule.materialized = current.materialized
    return { ...task, schedule, updatedAt: now }
  })
}

/** Bolt the next-run roll-forward onto a task's schedule (scheduler callback). */
export function setNextRun(
  tasks: readonly TaskRecord[], id: string,
  nextRunAt: number | undefined, lastTriggeredAt: number | undefined, now: number,
): TaskRecord[] {
  return tasks.map(task => {
    if (task.id !== id || task.schedule === undefined) return task
    return {
      ...task,
      updatedAt: now,
      schedule: { ...task.schedule, nextRunAt, lastTriggeredAt },
    }
  })
}

/** Open a fresh execution: mark running and append an execution record. */
export function startExecution(
  task: TaskRecord, now: number, executionId: string,
): { task: TaskRecord; execution: ExecutionRecord } {
  const execution: ExecutionRecord = { id: executionId, startedAt: now }
  return {
    task: { ...task, executions: [...task.executions, execution], updatedAt: now },
    execution,
  }
}

/** Record which session ran an execution (once the runner reports it). */
export function attachExecutionSession(task: TaskRecord, executionId: string, sessionId: string, now: number): TaskRecord {
  return {
    ...task,
    updatedAt: now,
    executions: task.executions.map(e => e.id === executionId ? { ...e, sessionId } : e),
  }
}

/** Settle a running execution: record the outcome (no-op if already settled). */
export function settleExecution(
  task: TaskRecord, executionId: string,
  outcome: 'succeeded' | 'failed' | 'cancelled', now: number, error: string | undefined,
): TaskRecord {
  if (task.executions.some(e => e.id === executionId && e.endedAt !== undefined)) return task
  return {
    ...task,
    updatedAt: now,
    executions: task.executions.map(e => e.id === executionId
      ? { ...e, endedAt: now, result: outcome, error }
      : e),
  }
}