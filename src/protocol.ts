/**
 * Host↔browser transport protocol for dsh-calender: the snapshot shape the
 * browser renders, the strict discriminated-union of mutations the browser is
 * allowed to submit, and the HTTP/SSE envelope. Type-only and runtime-free so
 * both the Host half and the browser half share it (the client bundle inlines
 * the types; the schemas live in the Host half).
 */
import type {
  NewTaskInput, TaskUpdatePatch, TaskPermission, Urgency, Importance,
} from './core/tasks.ts'

/** Ledger schema version this build reads/writes. */
export const SCHEMA_VERSION = 1

/** Base path of the calender API surface (same-origin, under the web server). */
export const API_PREFIX = '/api/calender'

/** A task in the snapshot (stripped to what the view needs is unnecessary; keep the full record). */
export type { TaskRecord } from './core/tasks.ts'
export type { ExecutionRecord, ScheduleRule, SubtaskRecord } from './core/tasks.ts'

/** Scheduler mirror in the snapshot. */
export interface CalenderSchedulerSnapshot {
  /** Host-local ledger generation; changes force a browser v1 re-import. */
  ledgerId?: string
  /** Local IANA zone the Host schedules in. */
  timeZone: string
}

/** The full ledger snapshot the browser receives. */
export interface CalenderSnapshot {
  schemaVersion: number
  /** Monotonic ledger revision; increments on every write. */
  revision: number
  tasks: import('./core/tasks.ts').TaskRecord[]
  scheduler: CalenderSchedulerSnapshot
}

/** A change hint pushed over SSE (the browser reloads /state on it). */
export interface CalenderEventPayload {
  revision: number
  ledgerId?: string
}

/** Requested schedule expressed in a create action. */
export interface CreateScheduleInput {
  enabled: boolean
  cron?: string
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

/** Set a task's scheduled-run rule. */
export interface SetScheduleAction {
  kind: 'setSchedule'
  id: string
  patch: { enabled?: boolean; cron?: string; dueAt?: number }
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
export type CalenderAction =
  | CreateTaskAction
  | UpdateTaskAction
  | SetQuadrantAction
  | SetDoneAction
  | AddSubtaskAction
  | SetSubtaskDoneAction
  | RemoveSubtaskAction
  | DeleteTaskAction
  | ArchiveTaskAction
  | RestoreTaskAction
  | SetScheduleAction
  | RunTaskAction
  | ImportAction

/** The envelope for a POST /action: a client request id + one action. */
export interface CalenderActionEnvelope {
  requestId: string
  action: CalenderAction
}

/** A rejected action (protocol/validation failure), not an HTTP-level error. */
export interface CalenderErrorResult {
  ok: false
  error: string
  // The action never applied, so no snapshot follows.
}

/** The response to a successful action: the fresh full snapshot. */
export type CalenderActionResult = { ok: true; snapshot: CalenderSnapshot } | CalenderErrorResult

/** Guard: is an unknown value structurally a CalenderAction? (Host validates deeper with schemas.) */
export function isCalenderAction(value: unknown): value is CalenderAction {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as { kind?: unknown }).kind === 'string'
}

/** Simple UUID mint (crypto available in browser; node >=16 fallback). */
export function randomId(): string {
  const c = globalThis as { crypto?: { randomUUID?: () => string } }
  if (c.crypto?.randomUUID !== undefined) return c.crypto.randomUUID()
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
