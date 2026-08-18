/**
 * Client-side view controller: caches the last confirmed Host snapshot, owns
 * transient view state (week/month/matrix/agenda, the selected task, the
 * calendar cursor), and dispatches every mutation through the transport. The
 * browser is a pure view — the Host snapshot is the only confirmed truth.
 */
import type { WeekStart } from '../core/calendar.ts'
import type { TaskRecord } from '../core/tasks.ts'
import type { CalenderAction, CalenderSnapshot } from '../protocol.ts'
import type { CalenderHostTransport } from './host-api.ts'
import type { ExecutionCatalog } from './exec-catalog.ts'

/** The available calendar views. */
export type CalenderView = 'week' | 'month' | 'matrix' | 'agenda'

export interface CalenderClientState {
  snapshot: CalenderSnapshot
  /** The calendar cursor (a ms epoch); week view centers on its week. */
  cursor: number
  view: CalenderView
  weekStart: WeekStart
  selectedTaskId: string | undefined
  /** A pending drag selection (week grid) — surfaced to the create flow. */
  draft: { start: number; end: number } | undefined
  /** Whether the calendar panel is open (center-column takeover active). */
  open: boolean
  /** Read endpoint option lists (workspaces/sessions/providers/models). */
  catalog: ExecutionCatalog
  status: 'loading' | 'ready' | 'error'
  error: string | null
}

/** The reactive controller (framework-free so tests drive it without React). */
export class CalenderClientController {
  private state: CalenderClientState
  private readonly listeners = new Set<() => void>()
  private readonly disposeSub: () => void
  private loaded = false

  constructor(private readonly transport: CalenderHostTransport, initial: CalenderClientState) {
    this.state = initial
    this.disposeSub = transport.subscribe(() => { void this.pull() })
  }

  getSnapshot(): CalenderClientState { return this.state }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private set(patch: Partial<CalenderClientState>): void {
    this.state = { ...this.state, ...patch }
    for (const fn of [...this.listeners]) fn()
  }

  /** Initial load / refresh from the Host. */
  async start(): Promise<void> {
    this.loaded = true
    try {
      const snap = await this.transport.state()
      this.set({ snapshot: snap, status: 'ready', error: null })
    } catch (e) {
      this.set({ status: 'error', error: String(e) })
    }
  }

  /** Re-pull the snapshot (transport change hint). */
  async pull(): Promise<void> {
    if (!this.loaded) return
    try {
      const snap = await this.transport.state()
      this.set({ snapshot: snap, status: 'ready', error: null })
    } catch {
      // Keep the last good snapshot on a failed pull.
    }
  }

  /** Submit an action; on success the returned snapshot becomes the state. */
  async dispatch(action: CalenderAction): Promise<void> {
    try {
      const snap = await this.transport.action(action)
      this.set({ snapshot: snap, status: 'ready', error: null })
    } catch (e) {
      this.set({ status: 'error', error: String(e) })
    }
  }

  // --- open state -----------------------------------------------------------
  openPanel(): void { this.set({ open: true }) }
  closePanel(): void { this.set({ open: false }) }
  toggleOpen(): void { this.set({ open: !this.state.open }) }

  // --- view state -----------------------------------------------------------
  setView(view: CalenderView): void { this.set({ view }) }
  setCursor(ms: number): void { this.set({ cursor: ms }) }
  setWeekStart(weekStart: WeekStart): void { this.set({ weekStart }) }
  selectTask(id: string | undefined): void { this.set({ selectedTaskId: id }) }
  setDraft(draft: { start: number; end: number } | undefined): void { this.set({ draft }) }
  /** Replace the execution-settings option catalog (runtime data). */
  setCatalog(catalog: ExecutionCatalog): void { this.set({ catalog }) }

  selectedTask(): TaskRecord | undefined {
    return this.state.snapshot.tasks.find(t => t.id === this.state.selectedTaskId)
  }

  dispose(): void {
    this.disposeSub()
    this.listeners.clear()
  }
}

/** Fresh initial state at a given cursor. */
export function initialState(cursor: number = Date.now(), weekStart: WeekStart = 0): CalenderClientState {
  return {
    snapshot: { schemaVersion: 1, revision: 0, tasks: [], scheduler: { timeZone: '' } },
    cursor,
    view: 'week',
    weekStart,
    selectedTaskId: undefined,
    draft: undefined,
    open: false,
    catalog: { workspaces: [], sessions: [], providers: [], modelsByProvider: {} },
    status: 'loading',
    error: null,
  }
}
