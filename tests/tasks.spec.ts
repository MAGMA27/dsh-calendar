import { describe, expect, it } from 'vitest'
import {
  addSubtask, archiveTask, attachExecutionSession, completedSubtaskCount, createTask,
  deleteTask, quadrantOf, removeSubtask, restoreTask, setQuadrant, setSchedule,
  setSubtaskDone, setTaskDone, settleExecution, startExecution, subtaskProgress,
  updateTask, type NewTaskInput,
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
    const t = one({ provider: '  ', model: 'm', workspaceId: '  w  ' })
    expect(t.provider).toBeUndefined()
    expect(t.model).toBe('m')
    expect(t.workspaceId).toBe('w')
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
    expect(execution.endedAt).toBeUndefined()
    const withSession = attachExecutionSession(task, 'e1', 'sess-1', 11)
    expect(withSession.executions[0].sessionId).toBe('sess-1')
    const settled = settleExecution(withSession, 'e1', 'succeeded', 12, undefined)
    expect(settled.executions[0].result).toBe('succeeded')
    expect(settled.executions[0].endedAt).toBe(12)
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
