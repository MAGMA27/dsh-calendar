/**
 * Browser-side transport for the Host-authoritative calendar service. The
 * browser never owns task state: it reads snapshots and submits idempotent
 * actions, and treats the Host snapshot as the only confirmed UI state.
 *
 * Also drives the one-shot v1 localStorage migration into the Host ledger.
 */
import {
  API_PREFIX, randomId,
  type calendarAction, type calendarActionEnvelope, type calendarEventPayload,
  type calendarSnapshot,
} from '../protocol.ts'
import type { TaskRecord } from '../core/tasks.ts'
import type { ExecutionCatalog } from '../core/exec-catalog.ts'

const REQUEST_TIMEOUT_MS = 15_000

/** Legacy storage keys (v1 browser ledger before the Host-authoritative move). */
export const LEGACY_KEY = 'dsh.calendar.v1'
const IMPORT_MARKER = 'dsh.calendar.v1.hostImported'
const SOURCE_KEY = 'dsh.calendar.v1.sourceId'
const IMPORT_REQUEST_KEY = 'dsh.calendar.v1.importRequestId'

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json() as T & { error?: string }
  if (!response.ok) throw new Error(body.error ?? `calendar request failed: ${response.status}`)
  return body
}

/** The default same-origin base path for the calendar API. */
export const HTTP_PREFIX_DEFAULT = API_PREFIX

/** The transport face the controller and tests consume. */
export interface calendarHostTransport {
  state(): Promise<calendarSnapshot>
  action(action: calendarAction): Promise<calendarSnapshot>
  /** Register a change listener; returns an unsubscribe. */
  subscribe(listener: () => void): () => void
  /** One-shot v1 localStorage import into the Host ledger. */
  bootstrap(legacy: readonly TaskRecord[]): Promise<calendarSnapshot>
  /** Read the execution-settings option catalog (workspaces/sessions/providers). */
  options(): Promise<ExecutionCatalog>
}

function safeStorage(): Storage | undefined {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : undefined
  } catch {
    return undefined
  }
}

/** HTTP transport backed by the Host routes, with an SSE change stream. */
export class HttpcalendarHostTransport implements calendarHostTransport {
  private readonly listeners = new Set<() => void>()
  private es: EventSource | undefined
  private pollTimer: ReturnType<typeof setInterval> | undefined

  constructor(
    private readonly base: string = API_PREFIX,
    private readonly storage: Pick<Storage, 'getItem' | 'setItem'> | undefined = safeStorage(),
    private readonly rng: () => string = randomId,
  ) {}

  async state(): Promise<calendarSnapshot> {
    const res = await fetch(`${this.base}/state`, { cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    return await readJson<calendarSnapshot>(res)
  }

  async options(): Promise<ExecutionCatalog> {
    const res = await fetch(`${this.base}/options`, { cache: 'no-store', signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) })
    return await readJson<ExecutionCatalog>(res)
  }

  async action(action: calendarAction): Promise<calendarSnapshot> {
    const envelope: calendarActionEnvelope = { requestId: this.rng(), action }
    const res = await fetch(`${this.base}/action`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
    return await readJson<calendarSnapshot>(res)
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    this.ensureStream()
    return () => { this.listeners.delete(listener) }
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn()
  }

  /**
   * bootstrap runs the one-shot migration: if the browser has a v1 ledger and
   * hasn't imported into the current Host ledger generation, submit an import
   * action and remember the marker.
   */
  async bootstrap(legacy: readonly TaskRecord[]): Promise<calendarSnapshot> {
    const initial = await this.state()
    const ledgerId = initial.scheduler.ledgerId
    if (ledgerId === undefined || legacy.length === 0 || this.storage === undefined) return initial
    if (this.storage.getItem(IMPORT_MARKER) === ledgerId) return initial
    let sourceId = this.storage.getItem(SOURCE_KEY)
    if (sourceId === null || sourceId === '') {
      sourceId = this.rng()
      this.storage.setItem(SOURCE_KEY, sourceId)
    }
    let requestId = this.storage.getItem(IMPORT_REQUEST_KEY)
    if (requestId === null || requestId === '') {
      requestId = this.rng()
      this.storage.setItem(IMPORT_REQUEST_KEY, requestId)
    }
    const snapshot = await this.action({ kind: 'import', sourceId, tasks: [...legacy] })
    this.storage.setItem(IMPORT_MARKER, snapshot.scheduler.ledgerId ?? ledgerId)
    return snapshot
  }

  private ensureStream(): void {
    if (typeof EventSource === 'undefined') {
      this.startPolling()
      return
    }
    if (this.es !== undefined) return
    try {
      this.es = new EventSource(`${this.base}/events`)
    } catch {
      this.startPolling()
      return
    }
    // Push frames only hint a revision change; re-pull the full snapshot.
    const onHint = (event: MessageEvent): void => {
      try {
        const payload = JSON.parse(event.data as string) as calendarEventPayload
        if (typeof payload.revision === 'number') this.notify()
      } catch {
        // ignore malformed frame
      }
    }
    this.es.addEventListener('message', onHint)
    this.es.onopen = () => { this.stopPolling() }
    this.es.onerror = () => {
      // The ephemeral keep-alive stream may drop; fall back to polling.
      this.es?.close()
      this.es = undefined
      this.startPolling()
    }
  }

  private startPolling(): void {
    if (this.pollTimer !== undefined) return
    this.pollTimer = setInterval(() => {
      // Fire-and-forget: the next listener pull re-reads /state.
      this.notify()
    }, 30_000)
  }

  private stopPolling(): void {
    if (this.pollTimer !== undefined) {
      clearInterval(this.pollTimer)
      this.pollTimer = undefined
    }
  }
}

/** In-memory transport for tests (and a no-network fallback). */
export class MemorycalendarHostTransport implements calendarHostTransport {
  constructor(private snap: calendarSnapshot, private readonly applier?: (a: calendarAction) => calendarSnapshot) {
    void this.applier
  }
  async state() { return this.snap }
  async action(action: calendarAction) {
    // Apply simple create/update against the in-memory snapshot if a reducer is absent.
    if (this.applier !== undefined) { this.snap = this.applier(action); return this.snap }
    return this.snap
  }
  subscribe(_listener: () => void): () => void { return () => {} }
  async bootstrap(legacy: readonly TaskRecord[]) { void legacy; return this.snap }
  async options(): Promise<ExecutionCatalog> { return { workspaces: [], sessions: [], projects: [], providers: [], modelsByProvider: {}, modes: [] } }
}
