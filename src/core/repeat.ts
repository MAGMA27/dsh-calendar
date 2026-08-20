/**
 * Constrained repeat rules (replaces free-form cron): daily on every day or
 * weekly on chosen weekdays, optionally skipping weekends + public holidays.
 * The template's own date is the first occurrence when it matches the rule;
 * the Host materializes plain copies only on later matching dates (see
 * buildRepeatCopy). With `triggerAgent`, the matching template date and each
 * materialized copy auto-run at their due instant (default: the template's
 * block start, overridable per-rule with `triggerAt` HH:MM).
 *
 * Framework-free and pure so the Host ledger (materialization) and the browser
 * view (next-occurrence display) share one source of truth.
 */
import { addDays, dayKey, minutesOfDay } from './calendar.ts'
import type { RepeatRule, ScheduleRule, TaskRecord } from './tasks.ts'

/** Rolling materialization horizon (days ahead from today). */
export const REPEAT_HORIZON_DAYS = 60

/** One day in ms (date math uses addDays to stay DST-safe). */
const DAY_MS = 24 * 60 * 60 * 1000

/** Local midnight (00:00:00.000) for a ms timestamp. */
export function startOfDayMs(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Whether a weekly rule has at least one weekday selected. */
export function isValidRepeat(rule: RepeatRule): boolean {
  if (rule.kind === 'weekly') {
    const weekdays = rule.weekdays ?? []
    if (weekdays.length === 0) return false
  }
  return true
}

/**
 * Curated Chinese public-holiday dates (YYYY-MM-DD, local). 2025 rows are the
 * official State Council calendar; 2026 rows are provisional standard
 * expectations until the official announcement. Weekends are always treated as
 * holidays by isHoliday regardless of this list. Extend the set freely.
 */
export const PUBLIC_HOLIDAYS: ReadonlySet<string> = new Set([
  // --- 2025 (official) ---
  '2025-01-01', // 元旦
  '2025-01-28', '2025-01-29', '2025-01-30', '2025-01-31', // 春节
  '2025-02-01', '2025-02-02', '2025-02-03', '2025-02-04',
  '2025-04-04', '2025-04-05', '2025-04-06', // 清明
  '2025-05-01', '2025-05-02', '2025-05-03', '2025-05-04', '2025-05-05', // 劳动节
  '2025-05-31', '2025-06-01', '2025-06-02', // 端午
  '2025-10-01', '2025-10-02', '2025-10-03', '2025-10-04', '2025-10-05',
  '2025-10-06', '2025-10-07', '2025-10-08', // 中秋 + 国庆
  // --- 2026 (provisional until official) ---
  '2026-01-01', '2026-01-02', '2026-01-03', // 元旦
  '2026-02-16', '2026-02-17', '2026-02-18', '2026-02-19', // 春节（除夕 2/16 起）
  '2026-02-20', '2026-02-21', '2026-02-22',
  '2026-04-04', '2026-04-05', '2026-04-06', // 清明
  '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04', '2026-05-05', // 劳动节
  '2026-06-19', '2026-06-20', '2026-06-21', // 端午
  '2026-09-25', // 中秋
  '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05',
  '2026-10-06', '2026-10-07', // 国庆
])

/** JS weekday 0=Sun / 6=Sat. */
export function isWeekend(dateMs: number): boolean {
  const day = new Date(dateMs).getDay()
  return day === 0 || day === 6
}

/** A date counts as a holiday when it is a weekend or a curated public holiday. */
export function isHoliday(dateMs: number): boolean {
  return isWeekend(dateMs) || PUBLIC_HOLIDAYS.has(dayKey(dateMs))
}

/** Day-level match: weekday filter (weekly) + optional holiday skip. */
export function matchesRepeat(rule: RepeatRule, dateMs: number): boolean {
  if (rule.kind === 'weekly') {
    const weekdays = rule.weekdays ?? []
    if (weekdays.length === 0) return false
    if (!weekdays.includes(new Date(dateMs).getDay())) return false
  }
  if (rule.skipHolidays === true && isHoliday(dateMs)) return false
  return true
}

/**
 * All date-start (00:00 local) instants in [fromDayMs, toDayMs] matching the
 * rule, inclusive on both ends. Inputs are treated as calendar days.
 */
export function repeatDatesBetween(rule: RepeatRule, fromDayMs: number, toDayMs: number): number[] {
  const out: number[] = []
  let cursor = startOfDayMs(fromDayMs)
  const end = startOfDayMs(toDayMs)
  while (cursor <= end) {
    if (matchesRepeat(rule, cursor)) out.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return out
}

/** The next date-start strictly after `fromMs` matching the rule (undefined within 2 years). */
export function nextRepeatDate(rule: RepeatRule, fromMs: number): number | undefined {
  const limit = fromMs + 2 * 366 * DAY_MS
  let cursor = addDays(startOfDayMs(fromMs), 1)
  while (cursor <= limit) {
    if (matchesRepeat(rule, cursor)) return cursor
    cursor = addDays(cursor, 1)
  }
  return undefined
}

/** Parse an HH:MM trigger time into minutes-of-day (0..1439); invalid → undefined. */
export function parseTriggerTime(triggerAt: string | undefined): number | undefined {
  if (triggerAt === undefined) return undefined
  const m = /^(\d{1,2}):(\d{2})$/.exec(triggerAt.trim())
  if (m === null) return undefined
  const hours = Number(m[1])
  const minutes = Number(m[2])
  if (hours > 23 || minutes > 59) return undefined
  return hours * 60 + minutes
}

/**
 * Build one materialized copy of a repeat template on `dateMs` (a date-start):
 * same time-of-day + duration as the template, same content + execution pins,
 * a fresh id, no schedule (copies are plain tasks), and `originTaskId` linking
 * back to the template. When the rule has `triggerAgent` the copy instead
 * carries a one-shot due schedule at the trigger instant (rule `triggerAt`
 * HH:MM, defaulting to the template's block start) so the scheduler auto-runs
 * it; a due instant already in the past never fires.
 */
export function buildRepeatCopy(template: TaskRecord, dateMs: number, now: number, id: string): TaskRecord {
  const templateDay = startOfDayMs(template.startAt)
  const startAt = dateMs + (template.startAt - templateDay)
  const duration = template.endAt - template.startAt
  const rule = template.schedule?.repeat
  const triggerAgent = rule?.triggerAgent === true
  let schedule: ScheduleRule | undefined
  if (triggerAgent) {
    const triggerMinutes = parseTriggerTime(rule?.triggerAt) ?? minutesOfDay(template.startAt)
    const dueAt = dateMs + triggerMinutes * 60_000
    schedule = { enabled: true, dueAt, nextRunAt: dueAt >= now ? dueAt : undefined }
  }
  return {
    id,
    title: template.title,
    description: template.description,
    prompt: template.prompt,
    startAt,
    endAt: startAt + duration,
    allDay: template.allDay,
    urgency: template.urgency,
    importance: template.importance,
    done: false,
    subtasks: template.subtasks,
    executions: [],
    schedule,
    workspaceId: template.workspaceId,
    sessionId: template.sessionId,
    provider: template.provider,
    model: template.model,
    reasoningEffort: template.reasoningEffort,
    mode: template.mode,
    permission: template.permission,
    originTaskId: template.id,
    createdAt: now,
    updatedAt: now,
  }
}

/**
 * Align a repeat series with its template's current rule: drop every bound copy
 * whose occurrence date no longer matches the rule (the rule was narrowed to
 * fewer weekdays, or holiday-skip was toggled on) and remove those dates from
 * the template's `materialized` bookkeeping so a later rule that re-includes
 * them materializes fresh copies. Bound copies are ephemeral occurrences owned
 * by the rule — like the delete cascade, they never survive a series change
 * (archived copies included). Returns the same array reference when nothing
 * changed, plus the ids of the pruned copies so callers can clean any
 * scheduler mirrors.
 */
export function alignSeries(
  tasks: readonly TaskRecord[],
  templateId: string,
  now: number,
): { tasks: TaskRecord[]; prunedIds: string[] } {
  const template = tasks.find(t => t.id === templateId)
  if (template === undefined || template.schedule?.repeat === undefined) {
    return { tasks: tasks as TaskRecord[], prunedIds: [] }
  }
  const rule = template.schedule.repeat
  const prunedIds: string[] = []
  const removedKeys = new Set<string>()
  const kept: TaskRecord[] = []
  for (const t of tasks) {
    if (t.originTaskId === templateId && !matchesRepeat(rule, t.startAt)) {
      prunedIds.push(t.id)
      removedKeys.add(dayKey(t.startAt))
      continue
    }
    kept.push(t)
  }
  if (prunedIds.length === 0) return { tasks: tasks as TaskRecord[], prunedIds }
  const materialized = (template.schedule.materialized ?? []).filter(k => !removedKeys.has(k))
  const aligned = kept.map(t => t.id === templateId
    ? { ...t, updatedAt: now, schedule: { ...template.schedule!, materialized } }
    : t)
  return { tasks: aligned, prunedIds }
}

/**
 * Drop copies whose template no longer has an active repeat rule (template
 * missing, or its `schedule.repeat` removed). Runs once at ledger load so a
 * series whose rule was cleared or deleted leaves no orphaned copies behind.
 * Archived templates still count as active (archive is reversible and does not
 * cascade).
 */
export function pruneOrphanCopies(tasks: readonly TaskRecord[]): TaskRecord[] {
  const templateIds = new Set<string>()
  for (const t of tasks) {
    if (t.originTaskId === undefined && t.schedule?.repeat !== undefined) templateIds.add(t.id)
  }
  return tasks.filter(t => t.originTaskId === undefined || templateIds.has(t.originTaskId))
}
