import { describe, expect, it } from 'vitest'
import { defineCalendarTool } from '../src/host-tool.ts'
import { HostLedger, NoopLedgerPersist } from '../src/host-ledger.ts'

type AnyExec = (args: unknown, exec: unknown) => Promise<Record<string, unknown>>

function mk() {
  const ledger = new HostLedger(new NoopLedgerPersist(), () => 1000, () => 't1')
  const runs: string[] = []
  const tool = defineCalendarTool({ ledger, run: async id => { runs.push(id) } }) as unknown as { execute: AnyExec }
  return { ledger, tool, runs }
}

async function exec(tool: { execute: AnyExec }, args: Record<string, unknown>): Promise<Record<string, unknown>> {
  return tool.execute(args, {})
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

  it('lists and gets tasks', async () => {
    const { tool } = mk()
    await exec(tool, { action: 'create', title: 'A' })
    await exec(tool, { action: 'create', title: 'B' })
    const list = await exec(tool, { action: 'list' })
    expect((list.tasks as unknown[]).length).toBe(2)
    const first = (list.tasks as Array<Record<string, unknown>>)[0]
    const got = await exec(tool, { action: 'get', id: first.id })
    expect((got.task as Record<string, unknown>).title).toBe('A')
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

  it('rejects unknown actions via schema validation and missing ids in execute', async () => {
    const { tool } = mk()
    // an enum-violating action is rejected by defineTool arg validation before execute
    await expect(exec(tool, { action: 'bogus' })).rejects.toThrow()
    const noid = await exec(tool, { action: 'get' })
    expect(noid.ok).toBe(false)
    expect(noid.error).toContain('id')
  })
})
