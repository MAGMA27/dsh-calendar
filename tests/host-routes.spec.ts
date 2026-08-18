import { describe, expect, it } from 'vitest'
import { HostLedger, NoopLedgerPersist } from '../src/host-ledger.ts'
import { mountCalenderRoutes } from '../src/host-routes.ts'

/** A minimal fake webServer + fake req/res to exercise the route handlers. */
interface FakeRes {
  status: number
  headers: Record<string, string>
  body: string
  finished: boolean
}

function makeFakeServer() {
  const registered: Array<{ kind: string; path: string; handler: (req: any, res: any) => void | Promise<void> }> = []
  const server = {
    register(route: { kind: string; path: string; handler: any }) {
      registered.push(route)
      return () => {
        const i = registered.indexOf(route)
        if (i >= 0) registered.splice(i, 1)
      }
    },
  }
  return { server, registered }
}

function fakeRes(): FakeRes & { writeHead: any; end: any; write: any } {
  const out: FakeRes & { writeHead: any; end: any; write: any } = {
    status: 0, headers: {}, body: '', finished: false,
    writeHead(status: number, headers: Record<string, string>) {
      out.status = status
      out.headers = headers
      return out
    },
    end(body?: string) {
      if (body !== undefined) out.body += body
      out.finished = true
      return out
    },
    write(chunk: string) { out.body += chunk; return true },
  }
  return out
}

/** A fake incoming request wrapping a method + optional body payload. */
function fakeReq(method: string, body?: unknown): any {
  const req: any = { method, destroyed: false }
  req.on = (ev: string, cb: (c?: Buffer) => void) => {
    if (ev === 'data') {
      if (body !== undefined) cb(Buffer.from(JSON.stringify(body)))
    } else if (ev === 'end') {
      cb()
    } else if (ev === 'close') {
      // ignore
    }
  }
  return req
}

describe('calender routes', () => {
  it('registers state/action/events and serves GET state', async () => {
    const ledger = new HostLedger(new NoopLedgerPersist(), () => 0, () => 't1')
    const { server, registered } = makeFakeServer()
    const disposers = mountCalenderRoutes(server as never, ledger, {})
    expect(registered.map(r => r.path).sort()).toEqual(['/api/calender/action', '/api/calender/events', '/api/calender/options', '/api/calender/state'])

    const stateRoute = registered.find(r => r.path === '/api/calender/state')!
    const res = fakeRes()
    await stateRoute.handler(fakeReq('GET'), res)
    expect(res.status).toBe(200)
    expect(res.headers['Cache-Control']).toBe('no-store')
    const snap = JSON.parse(res.body)
    expect(snap.tasks).toEqual([])
    expect(snap.revision).toBe(0)

    for (const d of disposers) d()
  })

  it('POSTs an action and returns the fresh snapshot', async () => {
    const ledger = new HostLedger(new NoopLedgerPersist(), () => 0, () => 't1')
    const { server, registered } = makeFakeServer()
    const disposers = mountCalenderRoutes(server as never, ledger, {})
    const actionRoute = registered.find(r => r.path === '/api/calender/action')!
    const res = fakeRes()
    await actionRoute.handler(fakeReq('POST', {
      requestId: 'r1',
      action: { kind: 'create', input: { title: 'Plan', description: '', prompt: '', startAt: 1, endAt: 2, urgency: 'high', importance: 'high' } },
    }), res)
    expect(res.status).toBe(200)
    const snap = JSON.parse(res.body)
    expect(snap.tasks.length).toBe(1)
    expect(snap.tasks[0].title).toBe('Plan')
    expect(snap.revision).toBe(1)
    for (const d of disposers) d()
  })


  it('hands a run action to the Host runner', async () => {
    const ledger = new HostLedger(new NoopLedgerPersist(), () => 0, () => 't1')
    const { server, registered } = makeFakeServer()
    let ran: string[] = []
    const fakeRunner = { run: async (id: string) => { ran.push(id); return true } }
    const disposers = mountCalenderRoutes(server as never, ledger, {}, fakeRunner as never)
    const actionRoute = registered.find(r => r.path === '/api/calender/action')!
    // create a task first so the run action is valid
    const createRes = fakeRes()
    await actionRoute.handler(fakeReq('POST', { requestId: 'c1', action: { kind: 'create', input: { title: 'T', description: '', prompt: '', startAt: 1, endAt: 2, urgency: 'high', importance: 'high' } } }), createRes)
    const id = JSON.parse(createRes.body).tasks[0].id
    const res = fakeRes()
    await actionRoute.handler(fakeReq('POST', { requestId: 'r1', action: { kind: 'run', id } }), res)
    expect(res.status).toBe(200)
    expect(ran).toEqual([id])
    for (const d of disposers) d()
  })

  it('rejects a run for an unknown task before invoking the runner', async () => {
    const ledger = new HostLedger(new NoopLedgerPersist(), () => 0, () => 't1')
    const { server, registered } = makeFakeServer()
    let ran = 0
    const fakeRunner = { run: async (_id: string) => { ran++; return true } }
    const disposers = mountCalenderRoutes(server as never, ledger, {}, fakeRunner as never)
    const actionRoute = registered.find(r => r.path === '/api/calender/action')!
    const res = fakeRes()
    await actionRoute.handler(fakeReq('POST', { requestId: 'r1', action: { kind: 'run', id: 'nope' } }), res)
    expect(res.status).toBe(422)
    expect(ran).toBe(0)
    for (const d of disposers) d()
  })

  it('rejects a malformed action with 400', async () => {
    const ledger = new HostLedger(new NoopLedgerPersist(), () => 0, () => 't1')
    const { server, registered } = makeFakeServer()
    const disposers = mountCalenderRoutes(server as never, ledger, {})
    const actionRoute = registered.find(r => r.path === '/api/calender/action')!
    const res = fakeRes()
    await actionRoute.handler(fakeReq('POST', { requestId: '', action: {} }), res)
    expect(res.status).toBe(400)
    for (const d of disposers) d()
  })
})
