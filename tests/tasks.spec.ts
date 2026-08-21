import { describe, expect, it } from 'vitest'
import {
  addSubtask, archiveTask, attachExecutionSession, collapseRepeatSeries,
  completedSubtaskCount, createTask,
  decideScheduledAttempt, deleteTask, quadrantOf, removeSubtask, restoreTask, scheduleRetryExhausted, setQuadrant, setSchedule,
  setSubtaskDone, setTaskDone, settleExecution, startExecution, subtaskProgress,
  isTaskOccurrenceVisible, isTaskOverdue, isTaskVisibleInOverview, taskOccurrenceTriggersAgent, taskTriggersAgent, updateTask, SCHEDULE_MAX_ATTEMPTS, type NewTaskInput, type TaskRecord,
} from '../src/core/tasks.ts'

function baseInput(over: Partial<NewTaskInput> = {}): NewTaskInput {
  return {
    title: 'Task', description: '', prompt: '', startAt: 1000, endAt: 2000,
    urgency: 'medium', importance: 'medium', ...over,
  }
}

function one(over: Partial<NewTaskInput> = {}): NonNullable<ReturnType<typeof createTask>> {
  const t = createTask(baseInput(over), 0, 't1')
  if (t === undefined) throw new Error('expected task')
  return t
}

describe('Eisenhower quadrant', () => {
  it('maps the four terminals', () => {
    expect(quadrantOf('high', 'high')).toBe('do')
    expect(quadrantOf('low', 'high')).toBe('schedule')
    expect(quadrantOf('high', 'low')).toBe('delegate')
    expect(quadrantOf('low', 'low')).toBe('eliminate')
  })
})

describe('createTask', () => {
  it('rejects a blank title', () => {
    expect(createTask(baseInput({ title: '  ' }), 0, 'x')).toBeUndefined()
  })
  it('clamps a degenerate interval to one minute', () => {
    const t = one({ startAt: 5000, endAt: 5000 })
    expect(t.endAt).toBe(t.startAt + 60_000)
  })
  it('normalizes execution targets and defaults knobs', () => {
    const t = one({ provider: '  p  ', model: 'm', workspaceId: '  w  ' })
    expect(t.provider).toBe('p')
    expect(t.model).toBe('m')
    expect(t.workspaceId).toBe('w')
  })
  it('rejects an incomplete provider/model pin', () => {
    expect(createTask(baseInput({ provider: 'ark' }), 0, 'x')).toBeUndefined()
    expect(createTask(baseInput({ model: 'deepseek-v4-flash' }), 0, 'y')).toBeUndefined()
  })
})

describe('update / subtasks', () => {
  it('updates editable fields and bumps updatedAt', () => {
    const t = one()
    const [u] = updateTask([t], 't1', { title: 'Renamed', importance: 'high' }, 100)
    expect(u.title).toBe('Renamed')
    expect(u.importance).toBe('high')
    expect(u.updatedAt).toBe(100)
    expect(t.title).toBe('Task')
  })
  it('adds and toggles subtasks, tracking progress', () => {
    let [t] = addSubtask([one()], 't1', { id: 's1', title: 'first' }, 1)
    ;[t] = addSubtask([t], 't1', { id: 's2', title: 'second' }, 2)
    expect(t.subtasks.length).toBe(2)
    expect(subtaskProgress(t)).toBe(0)
    ;[t] = setSubtaskDone([t], 't1', 's1', true, 3)
    expect(completedSubtaskCount(t)).toBe(1)
    expect(subtaskProgress(t)).toBe(0.5)
    ;[t] = removeSubtask([t], 't1', 's2', 4)
    expect(t.subtasks.length).toBe(1)
  })
  it('setQuadrant writes both knobs', () => {
    const [u] = setQuadrant([one()], 't1', 'high', 'high', 5)
    expect(u.urgency).toBe('high')
    expect(u.importance).toBe('high')
  })
  it('setDone toggles the flag', () => {
    const [u] = setTaskDone([one()], 't1', true, 6)
    expect(u.done).toBe(true)
    expect(u.completedAt).toBe(6)
    const [reopened] = setTaskDone([u], 't1', false, 7)
    expect(reopened.done).toBe(false)
    expect(reopened.completedAt).toBeUndefined()
  })
  it('preserves the original completion time when setting an already done task', () => {
    const [done] = setTaskDone([one()], 't1', true, 6)
    const [again] = setTaskDone([done], 't1', true, 7)
    expect(again.completedAt).toBe(6)
  })
  it('tracks completion time through update patches', () => {
    const [done] = updateTask([one()], 't1', { done: true }, 8)
    expect(done.completedAt).toBe(8)
    const [reopened] = updateTask([done], 't1', { done: false }, 9)
    expect(reopened.completedAt).toBeUndefined()
  })
})

describe('delete / archive / restore', () => {
  it('delete removes the task and reports selection clear', () => {
    const done = one()
    done.done = true
    const { tasks, selectionCleared } = deleteTask([done], 't1', 't1')
    expect(tasks.length).toBe(0)
    expect(selectionCleared).toBe(true)
  })
  it('archives any task (even incomplete); restore brings it back; re-archive is a no-op', () => {
    const t = one()
    const r = archiveTask([t], 't1', 2)
    expect(r.archived).toBe(true)
    expect(r.tasks[0].archivedAt).toBe(2)
    // already archived → no-op
    const again = archiveTask(r.tasks, 't1', 3)
    expect(again.archived).toBe(false)
    const rr = restoreTask(r.tasks, 't1', 4)
    expect(rr.restored).toBe(true)
    expect(rr.tasks[0].archivedAt).toBeUndefined()
  })
})

describe('execution lifecycle', () => {
  it('opens, attaches a session, and settles', () => {
    const t = one()
    const { task, execution } = startExecution(t, 10, 'e1')
    expect(task.executions.length).toBe(1)
    expect(execution.triggeredBy).toBe('manual')
    expect(execution.endedAt).toBeUndefined()
    const withSession = attachExecutionSession(task, 'e1', 'sess-1', 11)
    expect(withSession.executions[0].sessionId).toBe('sess-1')
    const settled = settleExecution(withSession, 'e1', 'succeeded', 12, undefined)
    expect(settled.executions[0].result).toBe('succeeded')
    expect(settled.executions[0].endedAt).toBe(12)
  })

  it('preserves the scheduler source when an execution is opened by Host scheduling', () => {
    const { execution } = startExecution(one(), 10, 'e1', 'schedule')
    expect(execution.triggeredBy).toBe('schedule')
  })
})

describe('setSchedule / setNextRun', () => {
  it('merges schedule fields (repeat rule)', () => {
    const [s] = setSchedule([one()], 't1', { enabled: true, repeat: { kind: 'daily', skipHolidays: true } }, 1)
    expect(s.schedule?.enabled).toBe(true)
    expect(s.schedule?.repeat?.kind).toBe('daily')
    expect(s.schedule?.repeat?.skipHolidays).toBe(true)
    const [next] = setSchedule([s], 't1', { repeat: null }, 2)
    expect(next.schedule?.repeat).toBeUndefined()
  })

  it('keeps materialization bookkeeping when only enabled flips', () => {
    const [armed] = setSchedule([one()], 't1', { enabled: true, repeat: { kind: 'weekly', weekdays: [1, 3] } }, 1)
    const withHistory = { ...armed, schedule: { ...armed.schedule!, materialized: ['2025-01-06'] } }
    const [next] = setSchedule([withHistory], 't1', { enabled: false }, 2)
    expect(next.schedule?.materialized).toEqual(['2025-01-06'])
  })

  it('clears the schedule (enabled false, no repeat/dueAt) so the week badge drops', () => {
    const [armed] = setSchedule([one()], 't1', { enabled: true, repeat: { kind: 'daily' } }, 1)
    expect(armed.schedule?.enabled).toBe(true)
    const [cleared] = setSchedule([armed], 't1', { enabled: false, repeat: null, dueAt: null }, 2)
    expect(cleared.schedule?.enabled).toBe(false)
    expect(cleared.schedule?.repeat).toBeUndefined()
    expect(cleared.schedule?.dueAt).toBeUndefined()
  })
})

describe('scheduled attempt policy', () => {
  it('holds a rejected start without consuming an attempt', () => {
    expect(decideScheduledAttempt({ retryCount: 2 }, 'rejected', 1000, 30_000)).toEqual({ kind: 'hold' })
  })

  it('retries setup failure and consumes the occurrence at the cap', () => {
    expect(decideScheduledAttempt({ retryCount: 1, lastTriggeredAt: 900 }, 'failed', 1000, 30_000)).toEqual({
      kind: 'retry', nextRunAt: 31_000, lastTriggeredAt: 900, retryCount: 2,
    })
    expect(decideScheduledAttempt({ retryCount: SCHEDULE_MAX_ATTEMPTS - 1, lastTriggeredAt: 900 }, 'failed', 1000, 30_000)).toEqual({
      kind: 'consume', lastTriggeredAt: 900,
    })
    expect(scheduleRetryExhausted({ retryCount: SCHEDULE_MAX_ATTEMPTS })).toBe(true)
  })

  it('consumes a prompt-accepted run instead of retrying Agent side effects', () => {
    expect(decideScheduledAttempt({ retryCount: 2 }, 'started', 1000, 30_000)).toEqual({
      kind: 'consume', lastTriggeredAt: 1000,
    })
  })
})

describe('taskTriggersAgent (the clock badge)', () => {
  it('is false for a plain task and for a repeat template with no agent trigger', () => {
    expect(taskTriggersAgent(one())).toBe(false)
    const plain = one({ schedule: { enabled: true, repeat: { kind: 'daily' } } })
    expect(taskTriggersAgent(plain)).toBe(false)
    const tpl = one({ schedule: { enabled: true, repeat: { kind: 'weekly', weekdays: [1] } } })
    expect(taskTriggersAgent(tpl)).toBe(false)
  })
  it('is true for a one-shot dueAt', () => {
    expect(taskTriggersAgent(one({ schedule: { enabled: true, dueAt: 5000 } }))).toBe(true)
  })
  it('is true for a repeat rule with triggerAgent', () => {
    expect(taskTriggersAgent(one({ schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true } } }))).toBe(true)
    expect(taskTriggersAgent(one({ schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true, triggerAt: '07:30' } } }))).toBe(true)
  })
  it('is false when the schedule is disabled even if triggerAgent is set', () => {
    expect(taskTriggersAgent(one({ schedule: { enabled: false, repeat: { kind: 'daily', triggerAgent: true } } }))).toBe(false)
  })
  it('hides only a skipped template occurrence while keeping future copies scheduled', () => {
    const start = new Date(2025, 0, 6, 9).getTime()
    const template = one({
      startAt: start,
      endAt: start + 60 * 60_000,
      schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true, triggerAt: '09:00' } },
    })
    expect(taskOccurrenceTriggersAgent(template)).toBe(true)
    const skippedTemplate = {
      ...template,
      schedule: { ...template.schedule!, skippedDates: ['2025-01-06'] },
    }
    expect(taskTriggersAgent(skippedTemplate)).toBe(true) // the series remains active
    expect(taskOccurrenceTriggersAgent(skippedTemplate)).toBe(false) // this date was cancelled
    const copy = {
      ...template,
      id: 'copy',
      originTaskId: template.id,
      startAt: start + 24 * 60 * 60_000,
      endAt: start + 25 * 60 * 60_000,
      schedule: { enabled: true, dueAt: start + 24 * 60 * 60_000 + 9 * 60 * 60_000 },
    }
    expect(taskOccurrenceTriggersAgent(copy)).toBe(true)
  })
  it('hides a deleted template occurrence without hiding future copies', () => {
    const start = new Date(2025, 0, 6, 9).getTime()
    const template = one({
      startAt: start,
      schedule: { enabled: true, repeat: { kind: 'daily', triggerAgent: true } },
    })
    const deletedTemplate = { ...template, schedule: { ...template.schedule!, deletedDates: ['2025-01-06'] } }
    expect(isTaskOccurrenceVisible(deletedTemplate)).toBe(false)
    const copy = { ...template, id: 'copy', originTaskId: template.id, startAt: start + 24 * 60 * 60_000 }
    expect(isTaskOccurrenceVisible(copy)).toBe(true)
  })
})

describe('isTaskOverdue', () => {
  it('marks only unfinished tasks before the current local day as overdue', () => {
    const now = new Date(2026, 7, 20, 12, 0).getTime()
    const yesterday = new Date(2026, 7, 19, 9, 0).getTime()
    const today = new Date(2026, 7, 20, 9, 0).getTime()
    expect(isTaskOverdue({ startAt: yesterday, done: false }, now)).toBe(true)
    expect(isTaskOverdue({ startAt: yesterday, done: true }, now)).toBe(false)
    expect(isTaskOverdue({ startAt: today, done: false }, now)).toBe(false)
  })
})

describe('isTaskVisibleInOverview', () => {
  it('keeps unfinished tasks but only keeps completed tasks scheduled today', () => {
    const now = new Date(2026, 7, 20, 12, 0).getTime()
    const today = new Date(2026, 7, 20, 9, 0).getTime()
    const yesterday = new Date(2026, 7, 19, 9, 0).getTime()
    const tomorrow = new Date(2026, 7, 21, 9, 0).getTime()
    expect(isTaskVisibleInOverview({ startAt: yesterday, done: false }, now)).toBe(true)
    expect(isTaskVisibleInOverview({ startAt: tomorrow, done: false }, now)).toBe(true)
    expect(isTaskVisibleInOverview({ startAt: today, done: true }, now)).toBe(true)
    expect(isTaskVisibleInOverview({ startAt: yesterday, done: true }, now)).toBe(false)
    expect(isTaskVisibleInOverview({ startAt: tomorrow, done: true }, now)).toBe(false)
  })
})

function mkCopy(id: string, origin: string, start: number, done = false, over: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id, title: 'T', description: '', prompt: '', startAt: start, endAt: start + 3_600_000,
    urgency: 'medium', importance: 'medium', done, subtasks: [], executions: [],
    originTaskId: origin, schedule: { enabled: true, repeat: { kind: 'daily' } },
    createdAt: 0, updatedAt: 0, ...over,
  }
}

describe('collapseRepeatSeries (list views)', () => {
  it('keeps standalone tasks and drops all but the newest unfinished copy of a series', () => {
    const plain = { ...mkCopy('s', 'tpl', 10_000), originTaskId: undefined } as TaskRecord
    const c1 = mkCopy('c1', 'tpl', 1_000, true) // old done copy
    const c2 = mkCopy('c2', 'tpl', 2_000, false) // newer unfinished
    const c3 = mkCopy('c3', 'tpl', 3_000, false) // newest unfinished
    const tpl: TaskRecord = { ...mkCopy('tpl', '', 0), originTaskId: undefined, schedule: { enabled: true, repeat: { kind: 'daily' } } }
    const out = collapseRepeatSeries([plain, c1, c2, c3, tpl])
    expect(out.map(x => x.id).sort()).toEqual(['c3', 's']) // template + old/done copies removed
    expect(out.find(x => x.id === 'c3')).toBeDefined()
  })
  it('keeps the newest member when every series member is done', () => {
    const text = { ...mkCopy('text', 'uni', 0), originTaskId: undefined } as TaskRecord
    const c1 = mkCopy('a', 'uni', 1_000, true)
    const c2 = mkCopy('b', 'uni', 2_000, true)
    const out = collapseRepeatSeries([text, c1, c2])
      .map(x => x.id).sort()
    expect(out).toEqual(['b', 'text'])
  })
  it('falls back to the template when it is the newest unfinished', () => {
    const tpl: TaskRecord = { ...mkCopy('uni', '', 9_000), originTaskId: undefined, schedule: { enabled: true, repeat: { kind: 'weekly', weekdays: [1] } } }
    const c1 = mkCopy('a', 'uni', 1_000, false)
    const out = collapseRepeatSeries([tpl, c1])
    expect(out.map(x => x.id)).toEqual(['uni'])
  })
  it('can pick the oldest unfinished member', () => {
    const tpl: TaskRecord = { ...mkCopy('tpl', '', 1_000, true), originTaskId: undefined, schedule: { enabled: true, repeat: { kind: 'daily' } } }
    const older = mkCopy('older', 'tpl', 2_000, false)
    const newer = mkCopy('newer', 'tpl', 3_000, false)
    const out = collapseRepeatSeries([tpl, older, newer], 'oldest')
    expect(out.map(x => x.id)).toEqual(['older'])
  })

  it('prefers today’s completed occurrence over a future unfinished copy', () => {
    const now = new Date(2026, 7, 20, 12, 0).getTime()
    const today = new Date(2026, 7, 20, 9, 0).getTime()
    const tomorrow = new Date(2026, 7, 21, 9, 0).getTime()
    const tpl: TaskRecord = {
      ...mkCopy('tpl', '', today, true),
      originTaskId: undefined,
      schedule: { enabled: true, repeat: { kind: 'daily' } },
    }
    const future = mkCopy('future', 'tpl', tomorrow, false)
    const out = collapseRepeatSeries([tpl, future], 'oldest', now)
    expect(out.map(x => x.id)).toEqual(['tpl'])
  })
})
