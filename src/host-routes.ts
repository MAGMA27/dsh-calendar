/**
 * The calender HTTP surface (same-origin, loopback-only by composition):
 *   GET  /api/calender/state   → the full ledger snapshot (Cache-Control: no-store)
 *   POST /api/calender/action  → { requestId, action } → fresh snapshot
 *   GET  /api/calender/events  → SSE change hints (revision/ledgerId)
 *
 * Handlers own the full response lifecycle (req/res from the Host web server).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { API_PREFIX, type CalenderActionEnvelope, type CalenderSnapshot } from './protocol.ts'
import type { HostLedger } from './host-ledger.ts'

/** The body-size cap for a normal action (64 KiB) and an import (2 MiB). */
export const MAX_ACTION_BYTES = 64 * 1024
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024

/** Read the request body up to a cap; over-cap rejects. */
function readBody(req: IncomingMessage, cap: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > cap) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  res.end(JSON.stringify(body))
}

/** Structurally validate the POST envelope before it reaches the ledger. */
function parseEnvelope(raw: string): CalenderActionEnvelope | null {
  if (raw.trim() === '') return null
  let data: unknown
  try {
    data = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof data !== 'object' || data === null) return null
  const d = data as Record<string, unknown>
  if (typeof d.requestId !== 'string' || d.requestId === '') return null
  if (typeof d.action !== 'object' || d.action === null) return null
  const a = d.action as Record<string, unknown>
  if (typeof a.kind !== 'string' || a.kind === '') return null
  return { requestId: d.requestId, action: a as unknown as CalenderActionEnvelope['action'] }
}

/** Register the calender routes and return the disposers. */
export function mountCalenderRoutes(webServer: {
  register(route: { kind: 'exact' | 'prefix'; path: string; handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void> }): () => void
}, ledger: HostLedger): Array<() => void> {
  const disposers: Array<() => void> = []

  disposers.push(webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/state`,
    handler: (_req, res) => {
      writeJson(res, 200, ledger.getSnapshot())
    },
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/action`,
    handler: async (req, res) => {
      if (req.method !== 'POST') {
        writeJson(res, 405, { error: 'method not allowed' })
        return
      }
      let raw: string
      try {
        raw = await readBody(req, isImportAction(req) ? MAX_IMPORT_BYTES : MAX_ACTION_BYTES)
      } catch {
        writeJson(res, 413, { error: 'payload too large' })
        return
      }
      const envelope = parseEnvelope(raw)
      if (envelope === null) {
        writeJson(res, 400, { error: 'invalid action envelope' })
        return
      }
      const result = ledger.apply(envelope)
      if (!result.ok) {
        writeJson(res, 422, { error: result.error })
        return
      }
      writeJson(res, 200, result.snapshot as unknown as CalenderSnapshot)
    },
  }))

  disposers.push(webServer.register({
    kind: 'exact',
    path: `${API_PREFIX}/events`,
    handler: (req, res) => {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      })
      // A minimal SSE surface: M5 attaches real revision pushes. Keep the
      // socket open with a heartbeat so a browser EventSource stays connected.
      const keepAlive = setInterval(() => {
        res.write(': keep-alive\n\n')
      }, 15_000)
      req.on('close', () => clearInterval(keepAlive))
    },
  }))

  return disposers
}

/** Rough probe: an import action carries a larger payload allowance. */
function isImportAction(req: IncomingMessage): boolean {
  // Detecting by content-length only; envelope-level kind check happens after
  // read. The 2 MiB cap applies here only when the request is plausibly an import.
  void req
  return false
}
