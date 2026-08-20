/**
 * M7: the calendar exposed as a real, model-callable tool.
 *
 * A single `calendar_task` tool performs the common calendar write/read
 * operations: create / get / list / update / setQuadrant / setDone / add- &
 * toggle- & remove-subtask / setSchedule / delete / archive / restore / run.
 * Every mutation is mapped onto the SAME HostLedger.apply the browser uses
 * (a minted requestId + the existing discriminated union + request-id
 * idempotency), so the tool and the calendar UI share one authoritative
 * ledger with no second source of truth. Reads go through the ledger
 * snapshot. The runner (when supplied) drives the `run` action.
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import { randomId } from './protocol.ts'
import type { calendarAction, calendarActionEnvelope } from './protocol.ts'
import { taskTriggersAgent, type ExecutionRecord, type NewTaskInput, type TaskRecord } from './core/tasks.ts'
import type { HostLedger } from './host-ledger.ts'

const ACTIONS = ['create','get','list','update','setQuadrant','setDone','addSubtask','setSubtaskDone','removeSubtask','setSchedule','delete','archive','restore','run'] as const
const LIST_DATE_FIELDS = ['scheduled', 'completed', 'created', 'updated', 'executed'] as const
const LLM_FILTERS = ['any', 'only', 'none'] as const

type ListDateField = (typeof LIST_DATE_FIELDS)[number]
type LlmFilter = (typeof LLM_FILTERS)[number]

const parameters = {
  action: { type: 'string', enum: [...ACTIONS], required: true, description: 'Which calendar operation to run.' },
  id: { type: 'string', description: 'Task id (mutations/get).' },
  title: { type: 'string', description: 'Task title (create/update/addSubtask).' },
  description: { type: 'string', description: 'Free-form note (create/update).' },
  prompt: { type: 'string', description: 'Instruction sent to the agent when run (create/update).' },
  startAt: { type: 'integer', description: 'Start ms epoch (create/update).' },
  endAt: { type: 'integer', description: 'End ms epoch (create/update).' },
  fromAt: { type: 'integer', description: 'Lower bound ms epoch, inclusive (list query).' },
  toAt: { type: 'integer', description: 'Upper bound ms epoch, exclusive (list query).' },
  dateBy: { type: 'string', enum: [...LIST_DATE_FIELDS], description: 'Which task activity the list time range matches: scheduled block, completedAt, createdAt, updatedAt, or execution interval (list query; default scheduled).' },
  urgency: { type: 'string', enum: ['high','medium','low'], description: 'Eisenhower urgency (create/setQuadrant).' },
  importance: { type: 'string', enum: ['high','medium','low'], description: 'Eisenhower importance (create/setQuadrant).' },
  done: { type: 'boolean', description: 'Done flag (setDone/setSubtaskDone/update) or completion filter (list).' },
  subtaskId: { type: 'string', description: 'Subtask id (add/setDone/removeSubtask).' },
  workspaceId: { type: 'string', description: 'Project/workspace id (list filter or execution target create/update).' },
  sessionId: { type: 'string', description: 'Pinned or actual execution session (list filter or execution target create/update).' },
  provider: { type: 'string', description: 'LLM provider filter/pin (list or create/update).' },
  model: { type: 'string', description: 'LLM model filter/pin (list or create/update).' },
  llm: { type: 'string', enum: [...LLM_FILTERS], description: 'LLM involvement filter (list): any, only tasks with LLM configuration/execution, or none for tasks assigned to yourself.' },
  mode: { type: 'string', description: 'Agent preset pin (create/update).' },
  permission: { type: 'string', enum: ['read-only','workspace-write','danger-full-access'], description: 'Permission preset (create/update).' },
  repeat: { type: 'string', enum: ['daily', 'weekly'], description: 'Constrained repeat rule kind; the Host copies the task onto each matching date (setSchedule).' },
  weekdays: { type: 'array', items: { type: 'integer' }, description: 'Weekly repeat weekdays, JS numbering 0=Sunday..6=Saturday, non-empty (setSchedule).' },
  skipHolidays: { type: 'boolean', description: 'Skip weekends + public holidays for the repeat rule (setSchedule).' },
  triggerAgent: { type: 'boolean', description: 'Auto-run the agent at each repeat occurrence (setSchedule).' },
  triggerAt: { type: 'string', description: 'Trigger time-of-day HH:MM; blank = the task block start (setSchedule).' },
  dueAt: { type: 'integer', description: 'One-off due ms epoch (setSchedule).' },
  enabled: { type: 'boolean', description: 'Whether the schedule is armed (setSchedule).' },
  subtasks: { type: 'array', items: { type: 'string' }, description: 'Optional subtask titles (create).' },
  allDay: { type: 'boolean', description: 'All-day flag (create/update).' },
} as const

interface CalendarToolDeps {
  ledger: HostLedger
  /** Optional runner invoked for the run action (real execution). */
  run?: (taskId: string) => Promise<unknown>
}

type AnyAction = { kind: string; [k: string]: unknown }

function envelope(action: AnyAction): calendarActionEnvelope {
  return { requestId: randomId(), action: action as unknown as calendarAction }
}

function applyOk(ledger: HostLedger, id: string | undefined, action: AnyAction): Record<string, unknown> {
  const r = ledger.apply(envelope(action))
  if (!r.ok) return { ok: false, error: r.error }
  const t = id === undefined ? undefined : r.snapshot.tasks.find(x => x.id === id)
  return t === undefined ? { ok: true } : { ok: true, task: taskSummary(t) }
}

function repeatSummary(repeat: NonNullable<NonNullable<TaskRecord['schedule']>['repeat']>): Record<string, unknown> {
  return {
    kind: repeat.kind,
    ...(repeat.weekdays !== undefined ? { weekdays: [...repeat.weekdays] } : {}),
    ...(repeat.skipHolidays !== undefined ? { skipHolidays: repeat.skipHolidays } : {}),
    ...(repeat.triggerAgent !== undefined ? { triggerAgent: repeat.triggerAgent } : {}),
    ...(repeat.triggerAt !== undefined ? { triggerAt: repeat.triggerAt } : {}),
  }
}

function scheduleSummary(schedule: TaskRecord['schedule']): Record<string, unknown> | null {
  if (schedule === undefined) return null
  return {
    enabled: schedule.enabled,
    ...(schedule.repeat !== undefined ? { repeat: repeatSummary(schedule.repeat) } : {}),
    ...(schedule.dueAt !== undefined ? { dueAt: schedule.dueAt } : {}),
    ...(schedule.nextRunAt !== undefined ? { nextRunAt: schedule.nextRunAt } : {}),
    ...(schedule.lastTriggeredAt !== undefined ? { lastTriggeredAt: schedule.lastTriggeredAt } : {}),
    ...(schedule.materialized !== undefined ? { materialized: [...schedule.materialized] } : {}),
  }
}

function executionSummary(execution: ExecutionRecord): Record<string, unknown> {
  return {
    id: execution.id,
    triggeredBy: execution.triggeredBy ?? null,
    sessionId: execution.sessionId ?? null,
    startedAt: execution.startedAt,
    endedAt: execution.endedAt ?? null,
    result: execution.result ?? null,
    ...(execution.error !== undefined ? { error: execution.error } : {}),
  }
}

/** Whether a task has been configured for, scheduled for, or actually used with an LLM. */
function hasLlmParticipation(task: TaskRecord): boolean {
  return task.prompt.trim() !== ''
    || task.executions.length > 0
    || taskTriggersAgent(task)
    || task.sessionId !== undefined
    || task.provider !== undefined
    || task.model !== undefined
    || task.reasoningEffort !== undefined
    || task.mode !== undefined
    || task.permission !== undefined
}

interface ExecutionRange {
  fromAt?: number
  toAt?: number
}

function taskSummary(task: TaskRecord, executionRange?: ExecutionRange): Record<string, unknown> {
  const executions = executionRange === undefined
    ? task.executions
    : task.executions.filter(execution => intervalOverlaps(execution.startedAt, execution.endedAt, executionRange.fromAt, executionRange.toAt))
  return {
    id: task.id, title: task.title, description: task.description, prompt: task.prompt,
    done: task.done, completedAt: task.completedAt ?? null, startAt: task.startAt, endAt: task.endAt,
    createdAt: task.createdAt, updatedAt: task.updatedAt,
    urgency: task.urgency, importance: task.importance, provider: task.provider ?? null, model: task.model ?? null,
    workspaceId: task.workspaceId ?? null, sessionId: task.sessionId ?? null, schedule: scheduleSummary(task.schedule),
    scheduled: task.schedule?.enabled === true,
    autoRun: taskTriggersAgent(task),
    hasLlm: hasLlmParticipation(task),
    executionCount: executions.length,
    totalExecutionCount: task.executions.length,
    executions: executions.map(executionSummary),
    subtasks: task.subtasks.map(s => ({ id: s.id, title: s.title, done: s.done })),
  }
}

interface ListQuery {
  fromAt?: number
  toAt?: number
  dateBy: ListDateField
  done?: boolean
  sessionId?: string
  workspaceId?: string
  provider?: string
  model?: string
  llm: LlmFilter
}

function integer(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) ? value : undefined
}

function parseListQuery(a: Record<string, unknown>): ListQuery | string {
  const rawFrom = a.fromAt
  const rawTo = a.toAt
  const fromAt = integer(rawFrom)
  const toAt = integer(rawTo)
  if (rawFrom !== undefined && fromAt === undefined) return 'fromAt must be an integer ms epoch'
  if (rawTo !== undefined && toAt === undefined) return 'toAt must be an integer ms epoch'
  if (fromAt !== undefined && toAt !== undefined && fromAt >= toAt) return 'toAt must be greater than fromAt'

  const dateBy = a.dateBy === undefined ? 'scheduled' : a.dateBy
  if (typeof dateBy !== 'string' || !(LIST_DATE_FIELDS as readonly string[]).includes(dateBy)) {
    return `dateBy must be one of: ${LIST_DATE_FIELDS.join(', ')}`
  }
  const llm = a.llm === undefined ? 'any' : a.llm
  if (typeof llm !== 'string' || !(LLM_FILTERS as readonly string[]).includes(llm)) {
    return `llm must be one of: ${LLM_FILTERS.join(', ')}`
  }
  const done = typeof a.done === 'boolean' ? a.done : undefined
  return {
    fromAt,
    toAt,
    dateBy: dateBy as ListDateField,
    done,
    sessionId: typeof a.sessionId === 'string' && a.sessionId.trim() !== '' ? a.sessionId.trim() : undefined,
    workspaceId: typeof a.workspaceId === 'string' && a.workspaceId.trim() !== '' ? a.workspaceId.trim() : undefined,
    provider: typeof a.provider === 'string' && a.provider.trim() !== '' ? a.provider.trim() : undefined,
    model: typeof a.model === 'string' && a.model.trim() !== '' ? a.model.trim() : undefined,
    llm: llm as LlmFilter,
  }
}

function pointInRange(value: number | undefined, fromAt: number | undefined, toAt: number | undefined): boolean {
  if (value === undefined) return false
  return (fromAt === undefined || value >= fromAt) && (toAt === undefined || value < toAt)
}

function intervalOverlaps(startAt: number, endAt: number | undefined, fromAt: number | undefined, toAt: number | undefined): boolean {
  if (toAt !== undefined && startAt >= toAt) return false
  if (fromAt !== undefined && endAt !== undefined && endAt <= fromAt) return false
  return true
}

function matchesDateQuery(task: TaskRecord, query: ListQuery): boolean {
  if (query.fromAt === undefined && query.toAt === undefined) return true
  switch (query.dateBy) {
    case 'scheduled':
      return intervalOverlaps(task.startAt, task.endAt, query.fromAt, query.toAt)
    case 'completed':
      return pointInRange(task.completedAt, query.fromAt, query.toAt)
    case 'created':
      return pointInRange(task.createdAt, query.fromAt, query.toAt)
    case 'updated':
      return pointInRange(task.updatedAt, query.fromAt, query.toAt)
    case 'executed':
      return task.executions.some(execution => intervalOverlaps(execution.startedAt, execution.endedAt, query.fromAt, query.toAt))
  }
}

function matchesListQuery(task: TaskRecord, query: ListQuery): boolean {
  if (!matchesDateQuery(task, query)) return false
  if (query.done !== undefined && task.done !== query.done) return false
  if (query.sessionId !== undefined
    && task.sessionId !== query.sessionId
    && !task.executions.some(execution => execution.sessionId === query.sessionId
      && intervalOverlaps(execution.startedAt, execution.endedAt, query.fromAt, query.toAt))) return false
  if (query.workspaceId !== undefined && task.workspaceId !== query.workspaceId) return false
  if (query.provider !== undefined && task.provider !== query.provider) return false
  if (query.model !== undefined && task.model !== query.model) return false
  if (query.llm === 'only' && !hasLlmParticipation(task)) return false
  if (query.llm === 'none' && hasLlmParticipation(task)) return false
  return true
}

/** Define the model-callable calendar tool. */
export function defineCalendarTool(deps: CalendarToolDeps) {
  return defineTool({
    name: 'calendar_task',
    description: 'Manage calendar todo tasks: create, list, get, update, set Eisenhower urgency/importance, mark done, manage subtasks, set a daily/weekly repeat (the task is copied onto each matching date) or a one-off due schedule, archive/restore/delete, or trigger a real run. A schedule without triggerAgent is a reminder/materialization only; the task summary field autoRun is true only when the Host will actually trigger an Agent. Times are ms epochs. Same authoritative ledger as the calendar view.',
    parameters,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (args) => (await handle(deps, args as unknown as Record<string, unknown>)) as never,
  })
}

async function handle(deps: CalendarToolDeps, a: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ledger = deps.ledger
  const action = typeof a.action === 'string' && (ACTIONS as readonly string[]).includes(a.action) ? a.action : ''
  const str = (v: unknown): string | undefined => typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
  const num = (v: unknown): number | undefined => typeof v === 'number' && Number.isFinite(v) ? v : undefined
  const bool = (v: unknown): boolean | undefined => typeof v === 'boolean' ? v : undefined
  const id = str(a.id)

  switch (action) {
    case 'create': {
      const title = str(a.title)
      if (title === undefined) return { ok: false, error: 'title is required to create a task' }
      const startAt = num(a.startAt) ?? Date.now()
      const endAt = num(a.endAt) ?? startAt + 60 * 60 * 1000
      const input: NewTaskInput = {
        title,
        description: str(a.description) ?? '',
        prompt: str(a.prompt) ?? '',
        startAt, endAt,
        allDay: bool(a.allDay) ?? false,
        urgency: a.urgency === 'high' || a.urgency === 'medium' || a.urgency === 'low' ? a.urgency : 'medium',
        importance: a.importance === 'high' || a.importance === 'medium' || a.importance === 'low' ? a.importance : 'medium',
        workspaceId: str(a.workspaceId),
        sessionId: str(a.sessionId),
        provider: str(a.provider),
        model: str(a.model),
        mode: str(a.mode),
        permission: a.permission === 'read-only' || a.permission === 'workspace-write' || a.permission === 'danger-full-access' ? a.permission : undefined,
        subtasks: Array.isArray(a.subtasks) ? a.subtasks.filter((s): s is string => typeof s === 'string').map(t => ({ id: randomId(), title: t, done: false })) : undefined,
      }
      const r = ledger.apply({ requestId: randomId(), action: { kind: 'create', input, schedule: undefined } as calendarAction })
      if (!r.ok) return { ok: false, error: r.error }
      const created = r.snapshot.tasks[r.snapshot.tasks.length - 1]
      return { ok: true, task: taskSummary(created) }
    }
    case 'get':
      if (id === undefined) return { ok: false, error: 'id is required for get' }
      { const t = ledger.taskById(id); return t === undefined ? { ok: false, error: 'task not found' } : { ok: true, task: taskSummary(t) } }
    case 'list': {
      const parsed = parseListQuery(a)
      if (typeof parsed === 'string') return { ok: false, error: parsed }
      const executionRange = parsed.fromAt === undefined && parsed.toAt === undefined
        ? undefined
        : { fromAt: parsed.fromAt, toAt: parsed.toAt }
      return { ok: true, tasks: ledger.getSnapshot().tasks.filter(task => matchesListQuery(task, parsed)).map(task => taskSummary(task, executionRange)) }
    }
    case 'update':
      if (id === undefined) return { ok: false, error: 'id is required for update' }
      {
        const patch: Record<string, unknown> = {}
        const fields: Array<[string, () => unknown]> = [
          ['title', () => str(a.title)], ['description', () => str(a.description)], ['prompt', () => str(a.prompt)],
          ['urgency', () => a.urgency], ['importance', () => a.importance], ['done', () => bool(a.done)], ['allDay', () => bool(a.allDay)],
          ['startAt', () => num(a.startAt)], ['endAt', () => num(a.endAt)],
          ['workspaceId', () => str(a.workspaceId)], ['sessionId', () => str(a.sessionId)],
          ['provider', () => str(a.provider)], ['model', () => str(a.model)], ['mode', () => str(a.mode)], ['permission', () => a.permission],
        ]
        for (const [k, get] of fields) { const v = get(); if (v !== undefined && v !== null) patch[k] = v }
        return applyOk(ledger, id, { kind: 'update', id, patch })
      }
    case 'setQuadrant':
      if (id === undefined) return { ok: false, error: 'id is required' }
      {
        const urgency = a.urgency as string | undefined
        const importance = a.importance as string | undefined
        const u = urgency === 'high' || urgency === 'medium' || urgency === 'low' ? urgency : 'medium'
        const i = importance === 'high' || importance === 'medium' || importance === 'low' ? importance : 'medium'
        return applyOk(ledger, id, { kind: 'setQuadrant', id, urgency: u, importance: i })
      }
    case 'setDone':
      if (id === undefined) return { ok: false, error: 'id is required' }
      return applyOk(ledger, id, { kind: 'setDone', id, done: bool(a.done) ?? true })
    case 'addSubtask':
      if (id === undefined) return { ok: false, error: 'id is required' }
      { const title = str(a.title); if (title === undefined) return { ok: false, error: 'title is required for addSubtask' }; return applyOk(ledger, id, { kind: 'addSubtask', id, subtaskId: str(a.subtaskId) ?? randomId(), title }) }
    case 'setSubtaskDone':
      if (id === undefined || typeof a.subtaskId !== 'string') return { ok: false, error: 'id and subtaskId are required' }
      return applyOk(ledger, id, { kind: 'setSubtaskDone', id, subtaskId: a.subtaskId, done: bool(a.done) ?? true })
    case 'removeSubtask':
      if (id === undefined || typeof a.subtaskId !== 'string') return { ok: false, error: 'id and subtaskId are required' }
      return applyOk(ledger, id, { kind: 'removeSubtask', id, subtaskId: a.subtaskId })
    case 'setSchedule':
      if (id === undefined) return { ok: false, error: 'id is required' }
      {
        const repeatKind = a.repeat
        const hasRepeat = repeatKind === 'daily' || repeatKind === 'weekly'
        const weekdays = Array.isArray(a.weekdays)
          ? a.weekdays.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6)
          : undefined
        const hasDue = typeof a.dueAt === 'number'
        const repeat = hasRepeat
          ? {
            kind: repeatKind as 'daily' | 'weekly',
            weekdays: repeatKind === 'weekly' ? weekdays : undefined,
            skipHolidays: a.skipHolidays === true,
            triggerAgent: a.triggerAgent === true,
            triggerAt: a.triggerAgent === true && typeof a.triggerAt === 'string' && /^\d{1,2}:\d{2}$/.test(a.triggerAt) ? a.triggerAt : undefined,
          }
          : null
        const enabled = bool(a.enabled) !== false && (hasRepeat || hasDue)
        const patch = { enabled, repeat, dueAt: hasDue ? (a.dueAt as number) : null }
        return applyOk(ledger, id, { kind: 'setSchedule', id, patch })
      }
    case 'delete':
    case 'archive':
    case 'restore':
      if (id === undefined) return { ok: false, error: 'id is required' }
      return applyOk(ledger, id, { kind: action, id })
    case 'run':
      if (id === undefined) return { ok: false, error: 'id is required' }
      { const r = ledger.apply({ requestId: randomId(), action: { kind: 'run', id } as calendarAction }); if (!r.ok) return { ok: false, error: r.error }; if (deps.run) void deps.run(id); return { ok: true } }
    default:
      return { ok: false, error: 'unknown action (expected one of: ' + ACTIONS.join(', ') + ')' }
  }
}
