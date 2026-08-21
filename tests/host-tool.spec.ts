import { describe, expect, it } from 'vitest'
import { validateJsonSchemaValue, valueSchemaSpecToJsonSchema } from '@deepseek-ai/dsh-tools'
import { defineCalendarTool } from '../src/host-tool.ts'
import { HostLedger, NoopLedgerPersist } from '../src/host-ledger.ts'
import type { ExecutionCatalog } from '../src/core/exec-catalog.ts'

type AnyExec = (args: unknown, exec: unknown) => Promise<Record<string, unknown>>

function mk(options: {
  catalog?: ExecutionCatalog
  now?: number
  activeScheduledSessions?: readonly string[]
  activeScheduledDepth?: number
  maxScheduledDepth?: number
  runResult?: unknown
} = {}) {
  let taskSeq = 0
  const ledger = new HostLedger(new NoopLedgerPersist(), () => options.now ?? 1000, () => `t${++taskSeq}`)
  const runs: string[] = []
  const tool = defineCalendarTool({
    ledger,
    run: async id => { runs.push(id); return options.runResult },
    catalog: options.catalog === undefined ? undefined : async () => options.catalog!,
    now: options.now === undefined ? undefined : () => options.now!,
    getActiveScheduledExecution: sessionId => options.activeScheduledSessions?.includes(sessionId) === true
      ? { taskId: 'scheduled-parent', executionId: 'scheduled-execution', sessionId, scheduledDepth: options.activeScheduledDepth ?? 0 }
      : undefined,
    maxScheduledDepth: () => options.maxScheduledDepth ?? 0,
    hasActiveScheduledExecution: sessionId => options.activeScheduledSessions?.includes(sessionId) === true,
  }) as unknown as { execute: AnyExec }
  return { ledger, tool, runs }
}

async function exec(tool: { execute: AnyExec }, args: Record<string, unknown>, context: unknown = {}): Promise<Record<string, unknown>> {
  return tool.execute(args, context)
}

describe('calendar_task tool', () => {
  it('creates a task and returns its summary', async () => {
    const { tool, ledger } = mk()
    const r = await exec(tool, { action: 'create', title: 'Plan the launch', urgency: 'high', importance: 'high' })
    expect(r.ok).toBe(true)
    const t = r.task as Record<string, unknown>
    expect(t.title).toBe('Plan the launch')
    expect(t.urgency).toBe('high')
    expect(ledger.taskById(t.id as string)).toBeDefined()
  })

  it('requires a title to create', async () => {
    const { tool } = mk()
    const r = await exec(tool, { action: 'create' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('title')
  })

  it('rejects an incomplete provider/model pin before creating a task', async () => {
    const { tool, ledger } = mk()
    const r = await exec(tool, { action: 'create', title: 'invalid pin', provider: 'ark' })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('provider and model')
    expect(ledger.getSnapshot().tasks).toHaveLength(0)
  })

  it('creates a one-off agent task atomically and resolves current session plus catalog labels', async () => {
    const catalog = {
      workspaces: [],
      sessions: [{ id: 'session-current', label: 'Current' }],
      projects: [],
      providers: [{ id: 'volcengine', label: '火山方舟' }],
      modelsByProvider: { volcengine: [{ id: 'deepseek-v4-flash', label: 'deepseek v4 Flash' }] },
      modes: [],
    }
    const { tool, ledger } = mk({ catalog })
    const r = await exec(tool, {
      action: 'create',
      title: 'test3',
      startAt: '2026-08-20T18:00:00+08:00',
      endAt: '2026-08-20T18:30:00+08:00',
      dueAt: '2026-08-20T18:00:00+08:00',
      prompt: '回复ok即可',
      sessionId: 'current',
      provider: '火山方舟',
      model: 'deepseek v4 Flash',
    }, { agent: { id: 'session-current' } })
    expect(r.ok).toBe(true)
    const task = r.task as Record<string, unknown>
    expect(task.title).toBe('test3')
    expect(task.startAt).toBe(new Date('2026-08-20T18:00:00+08:00').getTime())
    expect(task.endAt).toBe(new Date('2026-08-20T18:30:00+08:00').getTime())
    expect(task.sessionId).toBe('session-current')
    expect(task.provider).toBe('volcengine')
    expect(task.model).toBe('deepseek-v4-flash')
    expect(task.autoRun).toBe(true)
    expect((task.schedule as Record<string, unknown>).dueAt).toBe(task.startAt)
    expect((await exec(tool, { action: 'options' })).catalog).toEqual(catalog)
    expect(ledger.taskById(task.id as string)?.schedule?.nextRunAt).toBe(task.startAt)
  })

  it('rejects ambiguous repeat plus one-off schedule input without creating a task', async () => {
    const { tool, ledger } = mk()
    const r = await exec(tool, {
      action: 'create', title: 'ambiguous', repeat: 'daily', dueAt: 2000,
    })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('not both')
    expect(ledger.getSnapshot().tasks).toHaveLength(0)
  })

  it('blocks a scheduled Agent from creating an auto-run child task', async () => {
    const { tool, ledger } = mk({ now: 1000, activeScheduledSessions: ['session-current'] })
    const r = await exec(tool, {
      action: 'create', title: 'recursive', startAt: 2000, endAt: 3000, dueAt: 4000, sessionId: 'current',
    }, { agent: { id: 'session-current' } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('cannot create another auto-run')
    expect(ledger.getSnapshot().tasks).toHaveLength(0)
  })

  it('blocks a scheduled Agent from arming an auto-run schedule after plain creation', async () => {
    const { tool, ledger } = mk({ activeScheduledSessions: ['session-current'] })
    const created = await exec(tool, { action: 'create', title: 'plain child' })
    const id = (created.task as Record<string, unknown>).id as string
    const r = await exec(tool, {
      action: 'setSchedule', id, repeat: 'daily', triggerAgent: true,
    }, { agent: { id: 'session-current' } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('cannot arm another auto-run')
    expect(ledger.taskById(id)?.schedule).toBeUndefined()
  })

  it('allows a scheduled Agent to create a child up to the configured depth and persists its lineage', async () => {
    const { tool, ledger } = mk({ activeScheduledSessions: ['session-current'], maxScheduledDepth: 1 })
    const r = await exec(tool, {
      action: 'create', title: 'nested child', startAt: 2000, endAt: 3000, dueAt: 4000, sessionId: 'current',
    }, { agent: { id: 'session-current' } })
    expect(r.ok).toBe(true)
    const id = (r.task as Record<string, unknown>).id as string
    expect(ledger.taskById(id)?.scheduledDepth).toBe(1)
  })

  it('rejects a grandchild once the configured recursion depth is reached', async () => {
    const { tool, ledger } = mk({ activeScheduledSessions: ['session-current'], activeScheduledDepth: 1, maxScheduledDepth: 1 })
    const r = await exec(tool, {
      action: 'create', title: 'grandchild', startAt: 2000, endAt: 3000, dueAt: 4000, sessionId: 'current',
    }, { agent: { id: 'session-current' } })
    expect(r.ok).toBe(false)
    expect(r.error).toContain('recursion depth 2 exceeds configured maximum 1')
    expect(ledger.getSnapshot().tasks).toHaveLength(0)
  })

  it('stamps an auto-run schedule armed on an existing task with the child depth', async () => {
    const { tool, ledger } = mk({ activeScheduledSessions: ['session-current'], maxScheduledDepth: 1 })
    const created = await exec(tool, { action: 'create', title: 'plain child' })
    const id = (created.task as Record<string, unknown>).id as string
    const r = await exec(tool, {
      action: 'setSchedule', id, repeat: 'daily', triggerAgent: true,
    }, { agent: { id: 'session-current' } })
    expect(r.ok).toBe(true)
    expect(ledger.taskById(id)?.scheduledDepth).toBe(1)
  })

  it('marks a past one-off dueAt failed instead of catching it up', async () => {
    const { tool, ledger } = mk({ now: 1000 })
    const r = await exec(tool, { action: 'create', title: 'late', dueAt: 500 })
    expect(r.ok).toBe(true)
    const id = (r.task as Record<string, unknown>).id as string
    const task = ledger.taskById(id)!
    expect(task.schedule).toBeUndefined()
    expect(task.executions.at(-1)).toMatchObject({ result: 'failed', startedAt: 500, endedAt: 1000 })
  })

  it('marks a past dueAt failed when arming an existing task', async () => {
    const { tool, ledger } = mk({ now: 1000 })
    const created = await exec(tool, { action: 'create', title: 'late arm' })
    const id = (created.task as Record<string, unknown>).id as string
    const r = await exec(tool, { action: 'setSchedule', id, dueAt: 500 })
    expect(r.ok).toBe(true)
    const task = ledger.taskById(id)!
    expect(task.schedule).toBeUndefined()
    expect(task.executions.at(-1)).toMatchObject({ result: 'failed', triggeredBy: 'schedule' })
  })

  it('lists and gets tasks', async () => {
    const { tool } = mk()
    await exec(tool, { action: 'create', title: 'A' })
    const second = await exec(tool, { action: 'create', title: 'B' })
    await exec(tool, { action: 'setSchedule', id: (second.task as Record<string, unknown>).id, repeat: 'daily' })
    const list = await exec(tool, { action: 'list' })
    expect((list.tasks as unknown[]).length).toBe(2)
    const jsonSchema = valueSchemaSpecToJsonSchema({ type: 'json' })
    expect(validateJsonSchemaValue(jsonSchema, list)).toEqual([])
    const first = (list.tasks as Array<Record<string, unknown>>)[0]
    expect(first.scheduled).toBe(false)
    expect(first.autoRun).toBe(false)
    const got = await exec(tool, { action: 'get', id: first.id })
    expect((got.task as Record<string, unknown>).title).toBe('A')
  })

  it('filters list by time range, completion, project, model, session and LLM involvement', async () => {
    const { tool } = mk()
    const self = await exec(tool, {
      action: 'create', title: 'Self task', startAt: 100, endAt: 200, workspaceId: 'project-a',
    })
    await exec(tool, {
      action: 'create', title: 'Agent task', startAt: 150, endAt: 250, workspaceId: 'project-a',
      sessionId: 'session-a', provider: 'provider-a', model: 'model-a', prompt: 'Do the work',
    })
    await exec(tool, {
      action: 'create', title: 'Other project', startAt: 150, endAt: 250, workspaceId: 'project-b',
      provider: 'provider-a', model: 'model-a', prompt: 'Do other work',
    })

    const selfTasks = await exec(tool, { action: 'list', fromAt: 0, toAt: 300, llm: 'none', done: false })
    expect((selfTasks.tasks as Array<Record<string, unknown>>).map(task => task.title)).toEqual(['Self task'])
    expect((selfTasks.tasks as Array<Record<string, unknown>>)[0].hasLlm).toBe(false)

    const projectModel = await exec(tool, {
      action: 'list', fromAt: 100, toAt: 300, workspaceId: 'project-a', model: 'model-a',
      sessionId: 'session-a', llm: 'only',
    })
    expect((projectModel.tasks as Array<Record<string, unknown>>).map(task => task.title)).toEqual(['Agent task'])
  })

  it('queries completion time and exposes execution history', async () => {
    const { tool, ledger } = mk()
    const created = await exec(tool, { action: 'create', title: 'Finished', startAt: 10, endAt: 20 })
    const id = (created.task as Record<string, unknown>).id as string
    await exec(tool, { action: 'setDone', id, done: true })

    const completed = await exec(tool, { action: 'list', dateBy: 'completed', fromAt: 1000, toAt: 2000, done: true })
    const completedTask = (completed.tasks as Array<Record<string, unknown>>)[0]
    expect(completedTask.title).toBe('Finished')
    expect(completedTask.completedAt).toBe(1000)

    const executed = await exec(tool, { action: 'create', title: 'Ran', startAt: 10, endAt: 20 })
    const executedId = (executed.task as Record<string, unknown>).id as string
    expect(executedId).not.toBe(id)
    expect(ledger.openExecution(executedId, 'execution-1', 900)).toBe(true)
    expect(ledger.settleExecution(executedId, 'execution-1', 'succeeded', 1100, undefined, 'session-run')).toBe(true)
    expect(ledger.taskById(id)?.executions).toEqual([])
    const executionQuery = await exec(tool, {
      action: 'list', dateBy: 'executed', fromAt: 800, toAt: 1200, sessionId: 'session-run',
    })
    const executionTasks = executionQuery.tasks as Array<Record<string, unknown>>
    expect(executionTasks.map(task => task.title)).toEqual(['Ran'])
    const executedTask = executionTasks[0]
    expect(executedTask.title).toBe('Ran')
    expect(executedTask.scheduled).toBe(false)
    expect(executedTask.autoRun).toBe(false)
    expect(executedTask.hasLlm).toBe(true)
    expect(executedTask.executionCount).toBe(1)
    expect(executedTask.totalExecutionCount).toBe(1)
    expect(executedTask.executions).toEqual([{
      id: 'execution-1', triggeredBy: 'manual', sessionId: 'session-run', startedAt: 900, endedAt: 1100, result: 'succeeded',
    }])

    // The task matches this query by its scheduled block, but its historical
    // execution is outside the requested window and must not be reported as
    // today's execution.
    const scheduledWindow = await exec(tool, { action: 'list', fromAt: 0, toAt: 100, dateBy: 'scheduled' })
    const rangedTask = (scheduledWindow.tasks as Array<Record<string, unknown>>).find(task => task.title === 'Ran')
    expect(rangedTask).toBeDefined()
    expect(rangedTask?.executions).toEqual([])
    expect(rangedTask?.executionCount).toBe(0)
    expect(rangedTask?.totalExecutionCount).toBe(1)

    const sessionWindow = await exec(tool, {
      action: 'list', fromAt: 0, toAt: 100, dateBy: 'scheduled', sessionId: 'session-run',
    })
    expect((sessionWindow.tasks as Array<Record<string, unknown>>).some(task => task.title === 'Ran')).toBe(false)
  })

  it('updates a task and sets quadrant/done', async () => {
    const { tool } = mk()
    const created = await exec(tool, { action: 'create', title: 'x' })
    const id = (created.task as Record<string, unknown>).id as string
    const up = await exec(tool, { action: 'update', id, title: 'y' })
    expect((up.task as Record<string, unknown>).title).toBe('y')
    const q = await exec(tool, { action: 'setQuadrant', id, urgency: 'low', importance: 'low' })
    expect((q.task as Record<string, unknown>).urgency).toBe('low')
    const d = await exec(tool, { action: 'setDone', id, done: true })
    expect((d.task as Record<string, unknown>).done).toBe(true)
  })

  it('manages subtasks', async () => {
    const { tool } = mk()
    const created = await exec(tool, { action: 'create', title: 's', subtasks: ['a', 'b'] })
    const id = (created.task as Record<string, unknown>).id as string
    const subs = (created.task as Record<string, unknown>).subtasks as Array<Record<string, unknown>>
    expect(subs.length).toBe(2)
    const sid = subs[0].id as string
    await exec(tool, { action: 'setSubtaskDone', id, subtaskId: sid, done: true })
    const got = await exec(tool, { action: 'get', id })
    const after = (got.task as Record<string, unknown>).subtasks as Array<Record<string, unknown>>
    expect(after[0].done).toBe(true)
    await exec(tool, { action: 'addSubtask', id, title: 'c' })
    const got2 = await exec(tool, { action: 'get', id })
    expect(((got2.task as Record<string, unknown>).subtasks as unknown[]).length).toBe(3)
    await exec(tool, { action: 'removeSubtask', id, subtaskId: sid })
    const got3 = await exec(tool, { action: 'get', id })
    expect(((got3.task as Record<string, unknown>).subtasks as unknown[]).length).toBe(2)
  })

  it('sets a repeat schedule and archives/restores/deletes', async () => {
    const { tool, ledger } = mk()
    const created = await exec(tool, { action: 'create', title: 'z' })
    const id = (created.task as Record<string, unknown>).id as string
    const sched = await exec(tool, { action: 'setSchedule', id, repeat: 'weekly', weekdays: [1, 3], skipHolidays: true })
    const s = (sched.task as Record<string, unknown>).schedule as Record<string, unknown>
    expect(s).not.toBeNull()
    expect((s.repeat as Record<string, unknown>).kind).toBe('weekly')
    expect((s.repeat as Record<string, unknown>).weekdays).toEqual([1, 3])
    await exec(tool, { action: 'archive', id })
    expect(ledger.taskById(id)!.archivedAt).toBeDefined()
    await exec(tool, { action: 'restore', id })
    expect(ledger.taskById(id)!.archivedAt).toBeUndefined()
    await exec(tool, { action: 'delete', id })
    expect(ledger.taskById(id)).toBeUndefined()
  })

  it('runs a task through the runner', async () => {
    const { tool, runs } = mk()
    const created = await exec(tool, { action: 'create', title: 'r' })
    const id = (created.task as Record<string, unknown>).id as string
    const r = await exec(tool, { action: 'run', id })
    expect(r.ok).toBe(true)
    expect(runs).toEqual([id])
  })

  it('returns the runner outcome when the Host runner supplies one', async () => {
    const { tool } = mk({ runResult: { accepted: true, outcome: 'started' } })
    const created = await exec(tool, { action: 'create', title: 'r' })
    const id = (created.task as Record<string, unknown>).id as string
    const r = await exec(tool, { action: 'run', id })
    expect(r.ok).toBe(true)
    expect(r.status).toBe('started')
  })

  it('rejects unknown actions via schema validation and missing ids in execute', async () => {
    const { tool } = mk()
    // an enum-violating action is rejected by defineTool arg validation before execute
    await expect(exec(tool, { action: 'bogus' })).rejects.toThrow()
    const noid = await exec(tool, { action: 'get' })
    expect(noid.ok).toBe(false)
    expect(noid.error).toContain('id')
  })
})
