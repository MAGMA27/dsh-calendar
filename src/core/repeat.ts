/**
 * Constrained repeat rules (replaces free-form cron): daily on every day or
 * weekly on chosen weekdays, optionally skipping weekends + public holidays.
 * The Host materializes one plain copy of the template task on each matching
 * date (see buildRepeatCopy); the rule itself never auto-runs.
 *
 * Framework-free and pure so the Host ledger (materialization) and the browser
 * view (next-occurrence display) share one source of truth.
 */
import { addDays, dayKey } from './calendar.ts'
import type { RepeatRule, TaskRecord } from './tasks.ts'

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

/**
 * Build one materialized copy of a repeat template on `dateMs` (a date-start):
 * same time-of-day + duration as the template, same content + execution pins,
 * a fresh id, no schedule (copies are plain tasks), and `originTaskId` linking
 * back to the template.
 */
export function buildRepeatCopy(template: TaskRecord, dateMs: number, now: number, id: string): TaskRecord {
  const templateDay = startOfDayMs(template.startAt)
  const startAt = dateMs + (template.startAt - templateDay)
  const duration = template.endAt - template.startAt
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
    schedule: undefined,
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
