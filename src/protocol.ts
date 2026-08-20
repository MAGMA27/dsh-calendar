/**
 * Host↔browser transport protocol for dsh-calendar: the snapshot shape the
 * browser renders, the strict discriminated-union of mutations the browser is
 * allowed to submit, and the HTTP/SSE envelope. Type-only and runtime-free so
 * both the Host half and the browser half share it (the client bundle inlines
 * the types; the schemas live in the Host half).
 */
import type {
  NewTaskInput, TaskUpdatePatch, TaskPermission, Urgency, Importance, RepeatRule,
} from './core/tasks.ts'

/** Ledger schema version this build reads/writes. */
export const SCHEMA_VERSION = 1

/** Base path of the calendar API surface (same-origin, under the web server). */
export const API_PREFIX = '/api/calendar'

/** A task in the snapshot (stripped to what the view needs is unnecessary; keep the full record). */
export type { TaskRecord } from './core/tasks.ts'
export type { ExecutionRecord, ScheduleRule, SubtaskRecord } from './core/tasks.ts'

/** Scheduler mirror in the snapshot. */
export interface calendarSchedulerSnapshot {
  /** Host-local ledger generation; changes force a browser v1 re-import. */
  ledgerId?: string
  /** Local IANA zone the Host schedules in. */
  timeZone: string
}

/** The full ledger snapshot the browser receives. */
export interface calendarSnapshot {
  schemaVersion: number
  /** Monotonic ledger revision; increments on every write. */
  revision: number
  tasks: import('./core/tasks.ts').TaskRecord[]
  scheduler: calendarSchedulerSnapshot
}

/** A change hint pushed over SSE (the browser reloads /state on it). */
export interface calendarEventPayload {
  revision: number
  ledgerId?: string
}

/** Requested schedule expressed in a create action. */
export interface CreateScheduleInput {
  enabled: boolean
  /** Constrained repeat rule (daily/weekly); absent for a one-shot dueAt. */
  repeat?: RepeatRule
  dueAt?: number
}

/** Create task action (browser input → Host.createTask). */
export interface CreateTaskAction {
  kind: 'create'
  input: NewTaskInput
  /** Schedule requested at creation (Host validates/arms). */
  schedule?: CreateScheduleInput
}

/** Update an existing task's editable fields. */
export interface UpdateTaskAction {
  kind: 'update'
  id: string
  patch: TaskUpdatePatch
}

/**
 * Move one calendar occurrence and explicitly re-arm its next scheduled run.
 * This is separate from a generic field update so a stale failed execution
 * cannot accidentally become a new trigger just because another editor wrote
 * the task's block time. `unbind` is used for the "this copy only" choice.
 */
export interface RescheduleTaskAction {
  kind: 'reschedule'
  id: string
  startAt: number
  endAt: number
  /** Clear originTaskId when moving only a repeat copy. */
  unbind?: boolean
}

/** Set the Eisenhower quadrant by writing both knobs. */
export interface SetQuadrantAction {
  kind: 'setQuadrant'
  id: string
  urgency: Urgency
  importance: Importance
}

/** Toggle the task's done flag. */
export interface SetDoneAction {
  kind: 'setDone'
  id: string
  done: boolean
}

/** Add / toggle / remove a subtask. */
export interface AddSubtaskAction { kind: 'addSubtask'; id: string; subtaskId: string; title: string }
export interface SetSubtaskDoneAction { kind: 'setSubtaskDone'; id: string; subtaskId: string; done: boolean }
export interface RemoveSubtaskAction { kind: 'removeSubtask'; id: string; subtaskId: string }

/** Delete a task (keeps executions/history out of the view). */
export interface DeleteTaskAction { kind: 'delete'; id: string }
/** Archive/restore a settled task. */
export interface ArchiveTaskAction { kind: 'archive'; id: string }
export interface RestoreTaskAction { kind: 'restore'; id: string }

/** Set a task's scheduled-run rule (`null` clears repeat/dueAt). */
export interface SetScheduleAction {
  kind: 'setSchedule'
  id: string
  patch: { enabled?: boolean; repeat?: RepeatRule | null; dueAt?: number | null }
}

/**
 * Apply the same time change to every bound copy of a repeat template (and the
 * template itself): shift each task's startAt/endAt by the deltas. The browser
 * sends this only after the user picks "change all" in the repeat-time
 * confirmation; `id` is the copy that was edited (its originTaskId resolves
 * the template + sibling copies).
 */
export interface ShiftRepeatTimesAction {
  kind: 'shiftRepeatTimes'
  id: string
  startDelta: number
  endDelta: number
}

/**
 * Clear ONLY the target task's own schedule (no series routing): used for the
 * "cancel this day only" choice on a repeat copy — the copy's trigger one-shot
 * is removed, it stays on the calendar as a plain task, and the repeat rule
 * (template + sibling copies) is untouched.
 */
export interface ClearInstanceScheduleAction {
  kind: 'clearInstanceSchedule'
  id: string
}

/** Request a real dsh execution of a task (manual run). */
export interface RunTaskAction { kind: 'run'; id: string }

/** Import legacy localStorage (v1) tasks into the Host ledger (one-shot per source). */
export interface ImportAction {
  kind: 'import'
  sourceId: string
  tasks: import('./core/tasks.ts').TaskRecord[]
}

/** The discriminated union of every mutation the browser may submit. */
export type calendarAction =
  | CreateTaskAction
  | UpdateTaskAction
  | RescheduleTaskAction
  | SetQuadrantAction
  | SetDoneAction
  | AddSubtaskAction
  | SetSubtaskDoneAction
  | RemoveSubtaskAction
  | DeleteTaskAction
  | ArchiveTaskAction
  | RestoreTaskAction
  | SetScheduleAction
  | ShiftRepeatTimesAction
  | ClearInstanceScheduleAction
  | RunTaskAction
  | ImportAction

/** The envelope for a POST /action: a client request id + one action. */
export interface calendarActionEnvelope {
  requestId: string
  action: calendarAction
}

/** A rejected action (protocol/validation failure), not an HTTP-level error. */
export interface calendarErrorResult {
  ok: false
  error: string
  // The action never applied, so no snapshot follows.
}

/** The response to a successful action: the fresh full snapshot. */
export type calendarActionResult = { ok: true; snapshot: calendarSnapshot } | calendarErrorResult

/** Guard: is an unknown value structurally a calendarAction? (Host validates deeper with schemas.) */
export function iscalendarAction(value: unknown): value is calendarAction {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { kind?: unknown }).kind === 'string'
}

/** Simple UUID mint (crypto available in browser; node >=16 fallback). */
export function randomId(): string {
  const c = globalThis as { crypto?: { randomUUID?: () => string } }
  if (c.crypto?.randomUUID !== undefined) return c.crypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
