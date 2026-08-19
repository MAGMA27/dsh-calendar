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

/** A scheduled-run rule. The Host scheduler drives it on a heartbeat. */
export interface ScheduleRule {
  /** Whether the schedule is armed. */
  enabled: boolean
  /** Optional 5-field cron for repetition; absent for a one-shot dueAt. */
  cron?: string
  /** One-shot absolute instant (ms epoch, typically seeded from the drag slot). */
  dueAt?: number
  /** Next due instant (ms epoch); maintained by the scheduler. */
  nextRunAt?: number
  /** Instant of the most recent scheduled trigger. */
  lastTriggeredAt?: number
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
  schedule?: { enabled: boolean; cron?: string; dueAt?: number }
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
 * Whether a task matches a free-text query. Case-insensitive substring match
 * over the title, description and prompt. A blank/whitespace query matches
 * everything.
 */
export function taskMatchesQuery(task: TaskRecord, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (q === '') return true
  return task.title.toLowerCase().includes(q)
    || task.description.toLowerCase().includes(q)
    || task.prompt.toLowerCase().includes(q)
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
    ? { enabled: true, cron: input.schedule.cron, dueAt: input.schedule.dueAt }
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
  cron?: string | null
  dueAt?: number | null
}

/** Set (merge) a task's schedule rule and persist it. `null` clears a field. */
export function setSchedule(tasks: readonly TaskRecord[], id: string, patch: SchedulePatch, now: number): TaskRecord[] {
  return tasks.map(task => {
    if (task.id !== id) return task
    const current = task.schedule ?? { enabled: false }
    const schedule: ScheduleRule = {
      enabled: patch.enabled ?? current.enabled,
      cron: patch.cron === null
        ? undefined
        : patch.cron !== undefined ? (patch.cron.trim() === '' ? undefined : patch.cron.trim()) : current.cron,
      dueAt: patch.dueAt === null ? undefined : (patch.dueAt !== undefined ? patch.dueAt : current.dueAt),
      nextRunAt: current.nextRunAt,
      lastTriggeredAt: current.lastTriggeredAt,
    }
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