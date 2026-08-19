import { describe, expect, it } from 'vitest'
import { parseTasks } from '../src/core/store.ts'

describe('parseTasks', () => {
  it('returns [] for null / bad JSON / non-array', () => {
    expect(parseTasks(null)).toEqual([])
    expect(parseTasks('{not json')).toEqual([])
    expect(parseTasks('{"a":1}')).toEqual([])
  })
  it('parses a valid row and repairs defaults', () => {
    const tasks = parseTasks(JSON.stringify([{
      id: 't1', title: 'Hi', description: '', prompt: '', startAt: 1, endAt: 2,
      createdAt: 1, updatedAt: 1, urgency: 'nonsense', importance: 'low',
      subtasks: [{ id: 's1', title: 'sub', done: true }, { id: 'bad' }],
      executions: [{ id: 'e1', startedAt: 5, result: 'succeeded' }, { id: 'e2', startedAt: 6, result: 'failed' }],
      workspaceId: '  w  ',
    }]))
    expect(tasks.length).toBe(1)
    const t = tasks[0]
    expect(t.urgency).toBe('medium') // unknown repaired
    expect(t.importance).toBe('low')
    expect(t.subtasks.length).toBe(1) // bad subtask dropped
    expect(t.executions.length).toBe(2)
    expect(t.workspaceId).toBe('w')
    expect(t.archivedAt).toBeUndefined()
  })
  it('drops structurally invalid rows', () => {
    const tasks = parseTasks(JSON.stringify([
      { id: 'ok', title: 'A', description: '', prompt: '', startAt: 1, endAt: 2, createdAt: 1, updatedAt: 1 },
      { id: 'missing-title', description: '', prompt: '', startAt: 1, endAt: 2, createdAt: 1, updatedAt: 1 },
      'garbage',
    ]))
    expect(tasks.length).toBe(1)
    expect(tasks[0].id).toBe('ok')
  })
  it('repairs a malformed schedule to undefined', () => {
    const [t] = parseTasks(JSON.stringify([{
      id: 't1', title: 'A', description: '', prompt: '', startAt: 1, endAt: 2, createdAt: 1, updatedAt: 1,
      schedule: { enabled: true, repeat: { kind: 'weekly' } }, // weekly without weekdays
    }]))
    expect(t.schedule).toBeUndefined()
  })
  it('drops a legacy cron schedule (free-form cron is gone)', () => {
    const [t] = parseTasks(JSON.stringify([{
      id: 't1', title: 'A', description: '', prompt: '', startAt: 1, endAt: 2, createdAt: 1, updatedAt: 1,
      schedule: { enabled: true, cron: '0 9 * * *' },
    }]))
    expect(t.schedule).toBeUndefined()
  })
  it('keeps a valid repeat schedule with normalized weekdays + materialized', () => {
    const [t] = parseTasks(JSON.stringify([{
      id: 't1', title: 'A', description: '', prompt: '', startAt: 1, endAt: 2, createdAt: 1, updatedAt: 1,
      schedule: {
        enabled: true, repeat: { kind: 'weekly', weekdays: [1, 3, 1, 9, 'x'], skipHolidays: true },
        materialized: ['2025-01-06', 'bad'],
      },
    }]))
    expect(t.schedule?.repeat?.kind).toBe('weekly')
    expect(t.schedule?.repeat?.weekdays).toEqual([1, 3]) // dedup + invalid dropped
    expect(t.schedule?.repeat?.skipHolidays).toBe(true)
    expect(t.schedule?.materialized).toEqual(['2025-01-06'])
  })
  it('carries originTaskId for repeat copies', () => {
    const [t] = parseTasks(JSON.stringify([{
      id: 't1', title: 'A', description: '', prompt: '', startAt: 1, endAt: 2, createdAt: 1, updatedAt: 1,
      originTaskId: 'tpl',
    }]))
    expect(t.originTaskId).toBe('tpl')
  })
})
