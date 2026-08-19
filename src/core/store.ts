/**
 * Persisted ledger parsing/normalization: structural validation of task rows
 * with repair-style normalization (unknown enum values fall back to a sane
 * default instead of dropping the row; a malformed schedule is repaired or
 * dropped field-by-field). Framework-free and shared by the Host ledger and
 * the browser's legacy localStorage migration.
 */
import {
  isImportance, isTaskPermission, isUrgency,
  type ExecutionRecord, type RepeatRule, type ScheduleRule, type TaskRecord,
} from './tasks.ts'

/** Structural row check. The task's schedule is repaired separately. */
function isTaskRecordShape(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const r = value as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id === '') return false
  if (typeof r.title !== 'string') return false
  if (typeof r.description !== 'string') return false
  if (typeof r.prompt !== 'string') return false
  if (typeof r.startAt !== 'number') return false
  if (typeof r.endAt !== 'number') return false
  if (typeof r.createdAt !== 'number') return false
  if (typeof r.updatedAt !== 'number') return false
  if (r.urgency !== undefined && typeof r.urgency !== 'string') return false
  if (r.importance !== undefined && typeof r.importance !== 'string') return false
  if (r.subtasks !== undefined && !Array.isArray(r.subtasks)) return false
  // Executions/subtasks are repaired per-row by normalizeExecution /
  // normalizeSubtask; a single malformed entry drops that entry, not the task.
  if (r.executions !== undefined && !Array.isArray(r.executions)) return false
  return true
}

/** Normalize an unknown status-like string to a closed union, else undefined. */
function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : undefined
}

/** Repair a persisted repeat rule; drops it when unusable. */
function normalizeRepeat(value: unknown): RepeatRule | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const r = value as Record<string, unknown>
  if (r.kind !== 'daily' && r.kind !== 'weekly') return undefined
  const rule: RepeatRule = { kind: r.kind, skipHolidays: r.skipHolidays === true }
  if (rule.kind === 'weekly') {
    const weekdays = Array.isArray(r.weekdays)
      ? r.weekdays.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
      : []
    if (weekdays.length === 0) return undefined
    rule.weekdays = [...new Set(weekdays)]
  }
  if (r.triggerAgent === true) {
    rule.triggerAgent = true
    if (typeof r.triggerAt === 'string' && /^\d{1,2}:\d{2}$/.test(r.triggerAt)) rule.triggerAt = r.triggerAt
  }
  return rule
}

/** Repair a persisted schedule rule; drops it when unusable. */
function normalizeSchedule(value: unknown): ScheduleRule | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const r = value as Record<string, unknown>
  const repeat = normalizeRepeat(r.repeat)
  const dueAt = typeof r.dueAt === 'number' ? r.dueAt : undefined
  if (repeat === undefined && dueAt === undefined) return undefined
  const materialized = Array.isArray(r.materialized)
    ? r.materialized.filter((k): k is string => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k))
    : undefined
  return {
    enabled: r.enabled === true,
    repeat,
    dueAt,
    nextRunAt: typeof r.nextRunAt === 'number' ? r.nextRunAt : undefined,
    lastTriggeredAt: typeof r.lastTriggeredAt === 'number' ? r.lastTriggeredAt : undefined,
    materialized: materialized !== undefined && materialized.length > 0 ? materialized : undefined,
  }
}

/** Normalize one subtask row. */
function normalizeSubtask(value: unknown): { id: string; title: string; done: boolean } | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const r = value as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id === '' || typeof r.title !== 'string') return undefined
  return { id: r.id, title: r.title, done: r.done === true }
}

/** Normalize one execution row. */
function normalizeExecution(value: unknown): ExecutionRecord | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const r = value as Record<string, unknown>
  if (typeof r.id !== 'string' || r.id === '' || typeof r.startedAt !== 'number') return undefined
  const result = normalizeEnum(r.result, ['succeeded', 'failed', 'cancelled'])
  return {
    id: r.id,
    sessionId: typeof r.sessionId === 'string' ? r.sessionId : undefined,
    startedAt: r.startedAt,
    endedAt: typeof r.endedAt === 'number' ? r.endedAt : undefined,
    result,
    error: typeof r.error === 'string' ? r.error : undefined,
  }
}

/** Collapse a blank persisted target string to undefined. */
function normalizeTargetId(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

/**
 * Parse + validate a persisted task array; invalid rows are dropped, and
 * enum/schedule fields are repaired row-by-row instead of dropping the row.
 */
export function parseTasks(raw: string | null): TaskRecord[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []
  const tasks: TaskRecord[] = []
  for (const row of parsed) {
    if (!isTaskRecordShape(row)) continue
    const subtasks = (Array.isArray(row.subtasks) ? row.subtasks : [])
      .map(normalizeSubtask)
      .filter((s): s is NonNullable<typeof s> => s !== undefined)
    const executions = (Array.isArray(row.executions) ? row.executions : [])
      .map(normalizeExecution)
      .filter((e): e is NonNullable<typeof e> => e !== undefined)
    const schedule = normalizeSchedule(row.schedule)
    tasks.push({
      id: row.id as string,
      title: row.title as string,
      description: row.description as string,
      prompt: row.prompt as string,
      startAt: row.startAt as number,
      endAt: row.endAt as number,
      allDay: row.allDay === true,
      urgency: normalizeEnum(row.urgency, ['high', 'medium', 'low']) ?? 'medium',
      importance: normalizeEnum(row.importance, ['high', 'medium', 'low']) ?? 'medium',
      done: row.done === true,
      subtasks,
      executions,
      schedule,
      workspaceId: normalizeTargetId(row.workspaceId),
      sessionId: normalizeTargetId(row.sessionId),
      provider: normalizeTargetId(row.provider),
      model: normalizeTargetId(row.model),
      reasoningEffort: normalizeTargetId(row.reasoningEffort),
      mode: normalizeTargetId(row.mode),
      permission: isTaskPermission(row.permission) ? row.permission : undefined,
      originTaskId: normalizeTargetId(row.originTaskId),
      archivedAt: typeof row.archivedAt === 'number' ? row.archivedAt : undefined,
      createdAt: row.createdAt as number,
      updatedAt: row.updatedAt as number,
    })
  }
  return tasks
}

/** Convenience: parse a serialized ledger document. */
export function parseLegacyLedger(raw: string | null): TaskRecord[] {
  return parseTasks(raw)
}

/** guards re-exported for tests. */
export { isUrgency, isImportance }
