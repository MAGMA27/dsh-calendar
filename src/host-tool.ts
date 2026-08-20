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
import type { calendarAction, calendarActionEnvelope, CreateScheduleInput } from './protocol.ts'
import { taskTriggersAgent, type ExecutionRecord, type NewTaskInput, type RepeatRule, type TaskRecord } from './core/tasks.ts'
import type { ExecutionCatalog } from './core/exec-catalog.ts'
import type { HostLedger } from './host-ledger.ts'

const ACTIONS = ['options','create','get','list','update','setQuadrant','setDone','addSubtask','setSubtaskDone','removeSubtask','setSchedule','delete','archive','restore','run'] as const
const LIST_DATE_FIELDS = ['scheduled', 'completed', 'created', 'updated', 'executed'] as const
const LLM_FILTERS = ['any', 'only', 'none'] as const

type ListDateField = (typeof LIST_DATE_FIELDS)[number]
type LlmFilter = (typeof LLM_FILTERS)[number]

const timeParameter = {
  oneOf: [
    { type: 'integer', description: 'Milliseconds since Unix epoch.' },
    { type: 'string', description: 'ISO-8601 datetime, preferably with an explicit timezone offset.' },
  ],
} as const

const parameters = {
  action: { type: 'string', enum: [...ACTIONS], required: true, description: 'Which calendar operation to run. Use options first when resolving provider/model/session labels.' },
  id: { type: 'string', description: 'Task id (mutations/get).' },
  title: { type: 'string', description: 'Task title (create/update/addSubtask).' },
  description: { type: 'string', description: 'Free-form note (create/update).' },
  prompt: { type: 'string', description: 'Instruction sent to the agent when run (create/update).' },
  startAt: { ...timeParameter, description: 'Start time (ms epoch or ISO-8601 datetime; create/update).' },
  endAt: { ...timeParameter, description: 'End time (ms epoch or ISO-8601 datetime; create/update).' },
  fromAt: { ...timeParameter, description: 'Lower bound time, inclusive (ms epoch or ISO-8601 datetime; list query).' },
  toAt: { ...timeParameter, description: 'Upper bound time, exclusive (ms epoch or ISO-8601 datetime; list query).' },
  dateBy: { type: 'string', enum: [...LIST_DATE_FIELDS], description: 'Which task activity the list time range matches: scheduled block, completedAt, createdAt, updatedAt, or execution interval (list query; default scheduled).' },
  urgency: { type: 'string', enum: ['high','medium','low'], description: 'Eisenhower urgency (create/setQuadrant).' },
  importance: { type: 'string', enum: ['high','medium','low'], description: 'Eisenhower importance (create/setQuadrant).' },
  done: { type: 'boolean', description: 'Done flag (setDone/setSubtaskDone/update) or completion filter (list).' },
  subtaskId: { type: 'string', description: 'Subtask id (add/setDone/removeSubtask).' },
  workspaceId: { type: 'string', description: 'Project/workspace id (list filter or execution target create/update).' },
  sessionId: { type: 'string', description: 'Pinned or actual execution session. Use "current" to refer to the calling agent session (list filter or execution target create/update).' },
  provider: { type: 'string', description: 'LLM provider id or catalog label (list or create/update).' },
  model: { type: 'string', description: 'Provider-owned model id or catalog label (list or create/update).' },
  llm: { type: 'string', enum: [...LLM_FILTERS], description: 'LLM involvement filter (list): any, only tasks with LLM configuration/execution, or none for tasks assigned to yourself.' },
  mode: { type: 'string', description: 'Agent preset pin (create/update).' },
  permission: { type: 'string', enum: ['read-only','workspace-write','danger-full-access'], description: 'Permission preset (create/update).' },
  repeat: { type: 'string', enum: ['daily', 'weekly'], description: 'Constrained repeat rule kind; the Host copies the task onto each matching date (create/setSchedule).' },
  weekdays: { type: 'array', items: { type: 'integer' }, description: 'Weekly repeat weekdays, JS numbering 0=Sunday..6=Saturday, non-empty (create/setSchedule).' },
  skipHolidays: { type: 'boolean', description: 'Skip weekends + public holidays for the repeat rule (create/setSchedule).' },
  triggerAgent: { type: 'boolean', description: 'Auto-run the agent at each repeat occurrence. A one-off dueAt always runs the agent (create/setSchedule).' },
  triggerAt: { type: 'string', description: 'Trigger time-of-day HH:MM; blank = the task block start (create/setSchedule).' },
  dueAt: { ...timeParameter, description: 'One-off agent trigger time (ms epoch or ISO-8601 datetime; create/setSchedule). A one-off dueAt automatically runs the agent.' },
  enabled: { type: 'boolean', description: 'Whether the schedule is armed (create/setSchedule).' },
  subtasks: { type: 'array', items: { type: 'string' }, description: 'Optional subtask titles (create).' },
  allDay: { type: 'boolean', description: 'All-day flag (create/update).' },
} as const

interface CalendarToolDeps {
  ledger: HostLedger
  /** Optional runner invoked for the run action (real execution). */
  run?: (taskId: string) => Promise<unknown>
  /** Live Host catalog used both by the options action and to resolve labels. */
  catalog?: () => Promise<ExecutionCatalog>
  /** Clock injection keeps relative-time validation deterministic in tests. */
  now?: () => number
  /** True while the calling Agent is executing a Host-scheduled task. */
  hasActiveScheduledExecution?: (sessionId: string) => boolean
}

interface CalendarToolContext {
  /** The session that owns the calling Agent, if this was a model call. */
  currentSessionId?: string
  /** Host-derived recursion guard; never trusted from tool arguments. */
  activeScheduledExecution?: boolean
}

interface CalendarRunResult {
  accepted: boolean
  outcome?: 'started' | 'failed'
}

function isCalendarRunResult(value: unknown): value is CalendarRunResult {
  if (typeof value !== 'object' || value === null) return false
  const row = value as { accepted?: unknown; outcome?: unknown }
  return typeof row.accepted === 'boolean'
    && (row.outcome === undefined || row.outcome === 'started' || row.outcome === 'failed')
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

function timeMs(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function resolveOption(value: string, options: readonly { id: string; label: string }[]): string | undefined {
  const exact = options.find(option => option.id === value)
  if (exact !== undefined) return exact.id
  const key = normalized(value)
  const matches = options.filter(option => normalized(option.label) === key)
  return matches.length === 1 ? matches[0].id : undefined
}

function sessionIdFor(value: string | undefined, currentSessionId: string | undefined): string | undefined | string {
  if (value === undefined) return undefined
  if (normalized(value) !== 'current') return value
  return currentSessionId === undefined
    ? 'sessionId "current" is only available inside an Agent call'
    : currentSessionId
}

async function resolveExecutionTarget(
  deps: CalendarToolDeps,
  a: Record<string, unknown>,
  context: CalendarToolContext,
): Promise<{ sessionId?: string; provider?: string; model?: string } | string> {
  const rawSessionId = typeof a.sessionId === 'string' && a.sessionId.trim() !== '' ? a.sessionId.trim() : undefined
  const sessionId = sessionIdFor(rawSessionId, context.currentSessionId)
  if (typeof sessionId === 'string' && sessionId.startsWith('sessionId "current"')) return sessionId

  let provider = typeof a.provider === 'string' && a.provider.trim() !== '' ? a.provider.trim() : undefined
  let model = typeof a.model === 'string' && a.model.trim() !== '' ? a.model.trim() : undefined
  if ((provider === undefined) !== (model === undefined)) {
    return 'provider and model must be provided together'
  }

  let catalog: ExecutionCatalog | undefined
  if (deps.catalog !== undefined && (sessionId !== undefined || provider !== undefined || model !== undefined)) {
    try { catalog = await deps.catalog() } catch { /* keep exact ids when the catalog is unavailable */ }
  }

  if (catalog !== undefined) {
    let resolvedSessionId = sessionId as string | undefined
    const sessionIsCurrent = rawSessionId !== undefined && normalized(rawSessionId) === 'current'
    if (!sessionIsCurrent && sessionId !== undefined && catalog.sessions.length > 0) {
      const resolved = resolveOption(sessionId, catalog.sessions)
      if (resolved === undefined) return `session not found in the live catalog: ${sessionId}`
      resolvedSessionId = resolved
    }
    if (provider !== undefined && model !== undefined && catalog.providers.length > 0) {
      const resolvedProvider = resolveOption(provider, catalog.providers)
      if (resolvedProvider === undefined) return `provider not found in the live catalog: ${provider}`
      const models = catalog.modelsByProvider[resolvedProvider] ?? []
      const resolvedModel = models.length === 0 ? model : resolveOption(model, models)
      if (resolvedModel === undefined) return `model not found for provider ${resolvedProvider}: ${model}`
      provider = resolvedProvider
      model = resolvedModel
    }
    return { sessionId: resolvedSessionId, provider, model }
  }

  return { sessionId: sessionId as string | undefined, provider, model }
}

function parseListQuery(a: Record<string, unknown>, context: CalendarToolContext): ListQuery | string {
  const rawFrom = a.fromAt
  const rawTo = a.toAt
  const fromAt = timeMs(rawFrom)
  const toAt = timeMs(rawTo)
  if (rawFrom !== undefined && fromAt === undefined) return 'fromAt must be an integer ms epoch or ISO-8601 datetime'
  if (rawTo !== undefined && toAt === undefined) return 'toAt must be an integer ms epoch or ISO-8601 datetime'
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
  const rawSessionId = typeof a.sessionId === 'string' && a.sessionId.trim() !== '' ? a.sessionId.trim() : undefined
  const sessionId = sessionIdFor(rawSessionId, context.currentSessionId)
  if (typeof sessionId === 'string' && sessionId.startsWith('sessionId "current"')) return sessionId
  return {
    fromAt,
    toAt,
    dateBy: dateBy as ListDateField,
    done,
    sessionId: sessionId as string | undefined,
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

function parseRepeat(a: Record<string, unknown>): { repeat?: RepeatRule; error?: string } {
  const rawKind = a.repeat
  if (rawKind === undefined) return {}
  if (rawKind !== 'daily' && rawKind !== 'weekly') return { error: 'repeat must be daily or weekly' }
  const weekdays = Array.isArray(a.weekdays)
    ? a.weekdays.filter((day): day is number => typeof day === 'number' && Number.isInteger(day) && day >= 0 && day <= 6)
    : undefined
  if (rawKind === 'weekly' && (weekdays === undefined || weekdays.length === 0)) {
    return { error: 'weekly repeat requires at least one weekday (0=Sunday..6=Saturday)' }
  }
  const triggerAgent = a.triggerAgent === true
  const triggerAt = triggerAgent && typeof a.triggerAt === 'string' && /^\d{1,2}:\d{2}$/.test(a.triggerAt)
    ? a.triggerAt
    : undefined
  return {
    repeat: {
      kind: rawKind,
      weekdays: rawKind === 'weekly' ? weekdays : undefined,
      skipHolidays: a.skipHolidays === true,
      triggerAgent,
      triggerAt,
    },
  }
}

function parseCreateSchedule(a: Record<string, unknown>): { schedule?: CreateScheduleInput; error?: string } {
  const repeatResult = parseRepeat(a)
  if (repeatResult.error !== undefined) return repeatResult
  const rawDueAt = a.dueAt
  const dueAt = timeMs(rawDueAt)
  if (rawDueAt !== undefined && dueAt === undefined) return { error: 'dueAt must be an integer ms epoch or ISO-8601 datetime' }
  if (repeatResult.repeat !== undefined && dueAt !== undefined) {
    return { error: 'create a repeat schedule or a one-off dueAt, not both' }
  }
  if (repeatResult.repeat === undefined && dueAt === undefined) return {}
  return {
    schedule: {
      enabled: a.enabled !== false,
      ...(repeatResult.repeat !== undefined ? { repeat: repeatResult.repeat } : {}),
      ...(dueAt !== undefined ? { dueAt } : {}),
    },
  }
}

function parseSetSchedule(a: Record<string, unknown>): { patch?: { enabled: boolean; repeat: RepeatRule | null; dueAt: number | null }; error?: string } {
  const repeatResult = parseRepeat(a)
  if (repeatResult.error !== undefined) return repeatResult
  const rawDueAt = a.dueAt
  const dueAt = timeMs(rawDueAt)
  if (rawDueAt !== undefined && dueAt === undefined) return { error: 'dueAt must be an integer ms epoch or ISO-8601 datetime' }
  if (repeatResult.repeat !== undefined && dueAt !== undefined) {
    return { error: 'set a repeat schedule or a one-off dueAt, not both' }
  }
  return {
    patch: {
      enabled: a.enabled !== false && (repeatResult.repeat !== undefined || dueAt !== undefined),
      repeat: repeatResult.repeat ?? null,
      dueAt: dueAt ?? null,
    },
  }
}

/** Define the model-callable calendar tool. */
export function defineCalendarTool(deps: CalendarToolDeps) {
  return defineTool({
    name: 'calendar_task',
    description: 'Manage calendar todo tasks. Use options to resolve provider/model/session labels, then create a task atomically with its execution pins and schedule. Use sessionId "current" for the calling Agent session. A one-off dueAt automatically triggers the Agent; triggerAgent is only needed for repeat occurrences. If a one-off dueAt has already passed when the Host resumes, it is recorded as failed and not replayed. Repeat rules materialize only current/future occurrences; missed occurrences are not replayed. A Host-scheduled Agent may create ordinary todos but cannot create or arm another auto-run schedule. Times accept ms epochs or ISO-8601 datetimes. Same authoritative ledger as the calendar view.',
    parameters,
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute: async (args, exec) => (await handle(deps, args as unknown as Record<string, unknown>, {
      currentSessionId: exec.agent?.id === undefined ? undefined : String(exec.agent.id),
      activeScheduledExecution: exec.agent?.id !== undefined
        && deps.hasActiveScheduledExecution?.(String(exec.agent.id)) === true,
    })) as never,
  })
}

async function handle(deps: CalendarToolDeps, a: Record<string, unknown>, context: CalendarToolContext = {}): Promise<Record<string, unknown>> {
  const ledger = deps.ledger
  const action = typeof a.action === 'string' && (ACTIONS as readonly string[]).includes(a.action) ? a.action : ''
  const str = (v: unknown): string | undefined => typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined
  const bool = (v: unknown): boolean | undefined => typeof v === 'boolean' ? v : undefined
  const id = str(a.id)

  switch (action) {
    case 'options':
      if (deps.catalog === undefined) return { ok: false, error: 'execution catalog is unavailable' }
      try {
        return { ok: true, catalog: await deps.catalog() }
      } catch (error) {
        return { ok: false, error: `failed to read execution catalog: ${String(error)}` }
      }
    case 'create': {
      const title = str(a.title)
      if (title === undefined) return { ok: false, error: 'title is required to create a task' }
      const now = deps.now?.() ?? Date.now()
      const rawStartAt = a.startAt
      const startAt = rawStartAt === undefined ? now : timeMs(rawStartAt)
      if (startAt === undefined) return { ok: false, error: 'startAt must be an integer ms epoch or ISO-8601 datetime' }
      const rawEndAt = a.endAt
      const endAt = rawEndAt === undefined ? startAt + 60 * 60 * 1000 : timeMs(rawEndAt)
      if (endAt === undefined) return { ok: false, error: 'endAt must be an integer ms epoch or ISO-8601 datetime' }
      const scheduleResult = parseCreateSchedule(a)
      if (scheduleResult.error !== undefined) return { ok: false, error: scheduleResult.error }
      if (context.activeScheduledExecution === true && triggersAgent(scheduleResult.schedule)) {
        return { ok: false, error: 'a scheduled Agent cannot create another auto-run calendar task' }
      }
      const target = await resolveExecutionTarget(deps, a, context)
      if (typeof target === 'string') return { ok: false, error: target }
      const input: NewTaskInput = {
        title,
        description: str(a.description) ?? '',
        prompt: str(a.prompt) ?? '',
        startAt, endAt,
        allDay: bool(a.allDay) ?? false,
        urgency: a.urgency === 'high' || a.urgency === 'medium' || a.urgency === 'low' ? a.urgency : 'medium',
        importance: a.importance === 'high' || a.importance === 'medium' || a.importance === 'low' ? a.importance : 'medium',
        workspaceId: str(a.workspaceId),
        sessionId: target.sessionId,
        provider: target.provider,
        model: target.model,
        mode: str(a.mode),
        permission: a.permission === 'read-only' || a.permission === 'workspace-write' || a.permission === 'danger-full-access' ? a.permission : undefined,
        subtasks: Array.isArray(a.subtasks) ? a.subtasks.filter((s): s is string => typeof s === 'string').map(t => ({ id: randomId(), title: t, done: false })) : undefined,
      }
      const r = ledger.apply({ requestId: randomId(), action: { kind: 'create', input, schedule: scheduleResult.schedule } as calendarAction })
      if (!r.ok) return { ok: false, error: r.error }
      const created = r.snapshot.tasks[r.snapshot.tasks.length - 1]
      return { ok: true, task: taskSummary(created) }
    }
    case 'get':
      if (id === undefined) return { ok: false, error: 'id is required for get' }
      { const t = ledger.taskById(id); return t === undefined ? { ok: false, error: 'task not found' } : { ok: true, task: taskSummary(t) } }
    case 'list': {
      const parsed = parseListQuery(a, context)
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
          ['startAt', () => timeMs(a.startAt)], ['endAt', () => timeMs(a.endAt)],
          ['workspaceId', () => str(a.workspaceId)], ['sessionId', () => sessionIdFor(str(a.sessionId), context.currentSessionId)],
          ['provider', () => str(a.provider)], ['model', () => str(a.model)], ['mode', () => str(a.mode)], ['permission', () => a.permission],
        ]
        for (const [k, get] of fields) {
          const v = get()
          if (typeof v === 'string' && v.startsWith('sessionId "current"')) return { ok: false, error: v }
          if (v !== undefined && v !== null) patch[k] = v
        }
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
        const scheduleResult = parseSetSchedule(a)
        if (scheduleResult.error !== undefined || scheduleResult.patch === undefined) {
          return { ok: false, error: scheduleResult.error ?? 'invalid schedule' }
        }
        if (context.activeScheduledExecution === true && triggersAgentPatch(scheduleResult.patch)) {
          return { ok: false, error: 'a scheduled Agent cannot arm another auto-run calendar task' }
        }
        return applyOk(ledger, id, { kind: 'setSchedule', id, patch: scheduleResult.patch })
      }
    case 'delete':
    case 'archive':
    case 'restore':
      if (id === undefined) return { ok: false, error: 'id is required' }
      return applyOk(ledger, id, { kind: action, id })
    case 'run':
      if (id === undefined) return { ok: false, error: 'id is required' }
      {
        const r = ledger.apply({ requestId: randomId(), action: { kind: 'run', id } as calendarAction })
        if (!r.ok) return { ok: false, error: r.error }
        if (deps.run === undefined) return { ok: true, status: 'accepted' }
        let result: unknown
        try {
          result = await deps.run(id)
        } catch (error) {
          return { ok: false, error: `task run failed: ${String(error)}` }
        }
        if (!isCalendarRunResult(result)) return { ok: true }
        const task = ledger.taskById(id)
        if (!result.accepted) return { ok: false, error: 'task run was not accepted', ...(task === undefined ? {} : { task: taskSummary(task) }) }
        if (result.outcome === 'failed') return { ok: false, error: 'task run failed to start', ...(task === undefined ? {} : { task: taskSummary(task) }) }
        return { ok: true, status: result.outcome ?? 'accepted', ...(task === undefined ? {} : { task: taskSummary(task) }) }
      }
    default:
      return { ok: false, error: 'unknown action (expected one of: ' + ACTIONS.join(', ') + ')' }
  }
}

function triggersAgent(schedule: CreateScheduleInput | undefined): boolean {
  return schedule?.enabled === true
    && (schedule.dueAt !== undefined || schedule.repeat?.triggerAgent === true)
}

function triggersAgentPatch(patch: { enabled: boolean; repeat: RepeatRule | null; dueAt: number | null }): boolean {
  return patch.enabled && (patch.dueAt !== null || patch.repeat?.triggerAgent === true)
}
