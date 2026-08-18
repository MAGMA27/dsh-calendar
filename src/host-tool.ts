/**
 * M7: the calendar exposed as a real, model-callable tool.
 *
 * A single `calender_task` tool performs the common calendar write/read
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
import type { CalenderAction, CalenderActionEnvelope } from './protocol.ts'
import type { NewTaskInput, TaskRecord } from './core/tasks.ts'
import type { HostLedger } from './host-ledger.ts'

const ACTIONS = ['create','get','list','update','setQuadrant','setDone','addSubtask','setSubtaskDone','removeSubtask','setSchedule','delete','archive','restore','run'] as const

const parameters = {
  action: { type: 'string', enum: [...ACTIONS], required: true, description: 'Which calendar operation to run.' },
  id: { type: 'string', description: 'Task id (mutations/get).' },
  title: { type: 'string', description: 'Task title (create/update/addSubtask).' },
  description: { type: 'string', description: 'Free-form note (create/update).' },
  prompt: { type: 'string', description: 'Instruction sent to the agent when run (create/update).' },
  startAt: { type: 'integer', description: 'Start ms epoch (create/update).' },
  endAt: { type: 'integer', description: 'End ms epoch (create/update).' },
  urgency: { type: 'string', enum: ['high','medium','low'], description: 'Eisenhower urgency (create/setQuadrant).' },
  importance: { type: 'string', enum: ['high','medium','low'], description: 'Eisenhower importance (create/setQuadrant).' },
  done: { type: 'boolean', description: 'Done flag (setDone/setSubtaskDone/update).' },
  subtaskId: { type: 'string', description: 'Subtask id (add/setDone/removeSubtask).' },
  workspaceId: { type: 'string', description: 'Execution target workspace (create/update).' },
  sessionId: { type: 'string', description: 'Execution target session (create/update).' },
  provider: { type: 'string', description: 'LLM provider pin (create/update).' },
  model: { type: 'string', description: 'LLM model pin (create/update).' },
  mode: { type: 'string', description: 'Agent preset pin (create/update).' },
  permission: { type: 'string', enum: ['read-only','workspace-write','danger-full-access'], description: 'Permission preset (create/update).' },
  cron: { type: 'string', description: '5-field cron for a recurring schedule (setSchedule).' },
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

function envelope(action: AnyAction): CalenderActionEnvelope {
  return { requestId: randomId(), action: action as unknown as CalenderAction }
}

function applyOk(ledger: HostLedger, id: string | undefined, action: AnyAction): Record<string, unknown> {
  const r = ledger.apply(envelope(action))
  if (!r.ok) return { ok: false, error: r.error }
  const t = id === undefined ? undefined : r.snapshot.tasks.find(x => x.id === id)
  return t === undefined ? { ok: true } : { ok: true, task: taskSummary(t) }
}

function taskSummary(task: TaskRecord): Record<string, unknown> {
  return {
    id: task.id, title: task.title, done: task.done, startAt: task.startAt, endAt: task.endAt,
    urgency: task.urgency, importance: task.importance, provider: task.provider ?? null, model: task.model ?? null,
    workspaceId: task.workspaceId ?? null, sessionId: task.sessionId ?? null, schedule: task.schedule ?? null,
    subtasks: task.subtasks.map(s => ({ id: s.id, title: s.title, done: s.done })),
  }
}

/** Define the model-callable calendar tool. */
export function defineCalendarTool(deps: CalendarToolDeps) {
  return defineTool({
    name: 'calender_task',
    description: 'Manage calendar todo tasks: create, list, get, update, set Eisenhower urgency/importance, mark done, manage subtasks, set a cron/one-off schedule, archive/restore/delete, or trigger a real run. Times are ms epochs. Same authoritative ledger as the calendar view.',
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
      const r = ledger.apply({ requestId: randomId(), action: { kind: 'create', input, schedule: undefined } as CalenderAction })
      if (!r.ok) return { ok: false, error: r.error }
      const created = r.snapshot.tasks[r.snapshot.tasks.length - 1]
      return { ok: true, task: taskSummary(created) }
    }
    case 'get':
      if (id === undefined) return { ok: false, error: 'id is required for get' }
      { const t = ledger.taskById(id); return t === undefined ? { ok: false, error: 'task not found' } : { ok: true, task: taskSummary(t) } }
    case 'list':
      return { ok: true, tasks: ledger.getSnapshot().tasks.map(taskSummary) }
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
        const hasCron = typeof a.cron === 'string' && a.cron.trim() !== ''
        const hasDue = typeof a.dueAt === 'number'
        const enabled = bool(a.enabled) !== false && (hasCron || hasDue)
        const patch = { enabled, cron: hasCron ? (a.cron as string).trim() : null, dueAt: hasDue ? (a.dueAt as number) : null }
        return applyOk(ledger, id, { kind: 'setSchedule', id, patch })
      }
    case 'delete':
    case 'archive':
    case 'restore':
      if (id === undefined) return { ok: false, error: 'id is required' }
      return applyOk(ledger, id, { kind: action, id })
    case 'run':
      if (id === undefined) return { ok: false, error: 'id is required' }
      { const r = ledger.apply({ requestId: randomId(), action: { kind: 'run', id } as CalenderAction }); if (!r.ok) return { ok: false, error: r.error }; if (deps.run) void deps.run(id); return { ok: true } }
    default:
      return { ok: false, error: 'unknown action (expected one of: ' + ACTIONS.join(', ') + ')' }
  }
}
