import { describe, expect, it, vi } from 'vitest'
import { HttpcalendarHostTransport } from '../src/client/host-api.ts'
import type { calendarSnapshot } from '../src/protocol.ts'

function snap(): calendarSnapshot {
  return { schemaVersion: 1, revision: 3, tasks: [], scheduler: { ledgerId: 'L', timeZone: 'z' } }
}

describe('HttpcalendarHostTransport', () => {
  it('reads state via GET /api/calendar/state', async () => {
    const patch = vi.fn().mockResolvedValue(new Response(JSON.stringify(snap()), { status: 200 }))
    vi.stubGlobal('fetch', patch)
    const t = new HttpcalendarHostTransport('/api/calendar', { getItem: () => null, setItem: () => {} })
    const s = await t.state()
    expect(s.revision).toBe(3)
    expect(patch).toHaveBeenCalledWith('/api/calendar/state', expect.objectContaining({ cache: 'no-store' }))
  })
  it('submits an action envelope to POST /api/calendar/action', async () => {
    const patch = vi.fn().mockResolvedValue(new Response(JSON.stringify(snap()), { status: 200 }))
    vi.stubGlobal('fetch', patch)
    const t = new HttpcalendarHostTransport('/api/calendar', { getItem: () => null, setItem: () => {} }, () => 'rid-1')
    await t.action({ kind: 'create', input: { title: 'x', description: '', prompt: '', startAt: 1, endAt: 2, urgency: 'high', importance: 'high' } })
    const [url, init] = patch.mock.calls[0] as [string, RequestInit & { body: string }]
    expect(url).toBe('/api/calendar/action')
    expect(init.method).toBe('POST')
    const envelope = JSON.parse(init.body)
    expect(envelope.requestId).toBe('rid-1')
    expect(envelope.action.kind).toBe('create')
  })
  it('bootstrap imports legacy tasks once per ledger and marks the marker', async () => {
    const storage = { getItem: vi.fn().mockReturnValue(null), setItem: vi.fn() }
    const patch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...snap(), scheduler: { ledgerId: 'L', timeZone: 'z' } }), { status: 200 })) // state
      .mockResolvedValueOnce(new Response(JSON.stringify({ ...snap(), tasks: [{ id: 'l1' }] }), { status: 200 })) // import action
    vi.stubGlobal('fetch', patch)
    const t = new HttpcalendarHostTransport('/api/calendar', storage as any, () => 'r')
    const legacy = [{ id: 'l1', title: 'legacy', description: '', prompt: '', startAt: 0, endAt: 1, urgency: 'medium', importance: 'medium', done: false, subtasks: [], executions: [], createdAt: 0, updatedAt: 0 }]
    await t.bootstrap(legacy as any)
    expect(storage.setItem).toHaveBeenCalledWith('dsh.calendar.v1.sourceId', 'r')
    expect(storage.setItem).toHaveBeenCalledWith('dsh.calendar.v1.hostImported', 'L')
  })
})
