/**
 * Client-side view controller: caches the last confirmed Host snapshot, owns
 * transient view state (week/month/matrix/agenda, the selected task, the
 * calendar cursor), and dispatches every mutation through the transport. The
 * browser is a pure view — the Host snapshot is the only confirmed truth.
 */
import type { WeekStart } from '../core/calendar.ts'
import type { TaskRecord } from '../core/tasks.ts'
import type { calendarAction, calendarSnapshot } from '../protocol.ts'
import type { calendarHostTransport } from './host-api.ts'
import type { ExecutionCatalog } from '../core/exec-catalog.ts'

/** The available calendar views. */
export type calendarView = 'week' | 'month' | 'matrix' | 'agenda'

/**
 * The visible time window of the week grid, in minutes since local midnight.
 * Only [start, end) is shown; the hidden top/bottom edges (e.g. sleep time)
 * are collapsed so the day's real span gets more vertical room.
 */
export interface DayWindow {
  /** Minutes since midnight for the first shown minute (0..1439). */
  start: number
  /** Minutes since midnight for the first hidden minute (1..1440). */
  end: number
}

const DAY_WINDOW_KEY = 'dsh.calendar.dayWindow'

function defaultDayWindow(): DayWindow {
  return { start: 0, end: 1440 }
}

function loadDayWindow(): DayWindow {
  if (typeof localStorage === 'undefined') return defaultDayWindow()
  try {
    const raw = localStorage.getItem(DAY_WINDOW_KEY)
    if (!raw) return defaultDayWindow()
    const v: unknown = JSON.parse(raw)
    const obj = (typeof v === 'object' && v !== null ? v : {}) as { start?: unknown; end?: unknown }
    const start = Math.max(0, Math.min(1439, Math.round(Number(obj.start) || 0)))
    const end = Math.max(1, Math.min(1440, Math.round(Number(obj.end) || 1440)))
    // Either order is valid: start < end is a same-day span, start > end wraps
    // past midnight (e.g. 11:00 -> 02:00). Equal degenerate values reset.
    return start === end ? defaultDayWindow() : { start, end }
  } catch {
    return defaultDayWindow()
  }
}

/** Persist the day window to localStorage (best-effort, view-only pref). */
function saveDayWindow(win: DayWindow): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(DAY_WINDOW_KEY, JSON.stringify(win))
  } catch {
    /* storage full/blocked — ignore, the window just won't persist */
  }
}

/** A pending time change on a repeat-series task (a bound copy or the template
 * itself) awaiting the user's confirmation: apply to this task only (unbinding
 * a copy, or leaving the template's future copies to follow) or shift the whole
 * series (template + all bound copies). Populated by the week-grid drag end;
 * resolved by the confirm dialog. */
export interface PendingRepeatTimeEdit {
  taskId: string
  /** The series root; undefined when the edited task IS the template. */
  originTaskId: string | undefined
  /** The task's times before the drag. */
  origStart: number
  origEnd: number
  /** The dragged new times. */
  startAt: number
  endAt: number
}

export interface calendarClientState {
  snapshot: calendarSnapshot
  /** The calendar cursor (a ms epoch); week view centers on its week. */
  cursor: number
  view: calendarView
  weekStart: WeekStart
  selectedTaskId: string | undefined
  /** A pending drag selection (week grid) — surfaced to the create flow. */
  draft: { start: number; end: number } | undefined
  /** Visible minutes-of-day window of the week grid (hides sleep/off hours). */
  dayWindow: DayWindow
  /** Whether the calendar panel is open (center-column takeover active). */
  open: boolean
  /** Read endpoint option lists (workspaces/sessions/providers/models). */
  catalog: ExecutionCatalog
  /** A repeat-copy time change awaiting "this copy" vs "all copies". */
  pendingRepeatTimeEdit: PendingRepeatTimeEdit | undefined
  status: 'loading' | 'ready' | 'error'
  error: string | null
}

/** The reactive controller (framework-free so tests drive it without React). */
export class calendarClientController {
  private state: calendarClientState
  private readonly listeners = new Set<() => void>()
  private readonly disposeSub: () => void
  private loaded = false

  constructor(private readonly transport: calendarHostTransport, initial: calendarClientState) {
    this.state = initial
    this.disposeSub = transport.subscribe(() => { void this.pull() })
  }

  getSnapshot(): calendarClientState { return this.state }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn)
    return () => { this.listeners.delete(fn) }
  }

  private set(patch: Partial<calendarClientState>): void {
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
  async dispatch(action: calendarAction): Promise<void> {
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
  setView(view: calendarView): void { this.set({ view }) }
  setCursor(ms: number): void { this.set({ cursor: ms }) }
  setWeekStart(weekStart: WeekStart): void { this.set({ weekStart }) }
  selectTask(id: string | undefined): void { this.set({ selectedTaskId: id }) }
  setDraft(draft: { start: number; end: number } | undefined): void { this.set({ draft }) }
  /** Set and persist the visible week-grid time window (start > end wraps past midnight). */
  setDayWindow(win: DayWindow): void {
    const start = Math.max(0, Math.min(1439, Math.round(win.start)))
    const end = Math.max(1, Math.min(1440, Math.round(win.end)))
    const next = start === end ? { start: 0, end: 1440 } : { start, end }
    this.set({ dayWindow: next })
    saveDayWindow(next)
  }
  /** Replace the execution-settings option catalog (runtime data). */
  setCatalog(catalog: ExecutionCatalog): void { this.set({ catalog }) }

  // --- repeat-series time change confirmation --------------------------------
  /** Stage a repeat-series time change (copy or template drag); the confirm dialog resolves it. */
  requestRepeatTimeEdit(edit: PendingRepeatTimeEdit): void { this.set({ pendingRepeatTimeEdit: edit }) }
  cancelRepeatTimeEdit(): void { this.set({ pendingRepeatTimeEdit: undefined }) }
  /**
   * Resolve the staged repeat time change:
   *  - 'this' on a bound copy: update only that copy and unbind it (originTaskId
   *    cleared); 'this' on the template: update only the template's block
   *    (future copies follow the new time, existing copies keep theirs);
   *  - 'all': shift the template + every bound copy by the same deltas.
   */
  async resolveRepeatTimeEdit(choice: 'this' | 'all'): Promise<void> {
    const edit = this.state.pendingRepeatTimeEdit
    if (edit === undefined) return
    this.set({ pendingRepeatTimeEdit: undefined })
    const task = this.state.snapshot.tasks.find(t => t.id === edit.taskId)
    const isTemplate = task !== undefined && task.originTaskId === undefined && task.schedule?.repeat !== undefined
    if (choice === 'this') {
      const patch: { startAt: number; endAt: number; originTaskId?: string | null } = { startAt: edit.startAt, endAt: edit.endAt }
      if (!isTemplate) patch.originTaskId = null
      await this.dispatch({ kind: 'update', id: edit.taskId, patch })
    } else {
      await this.dispatch({
        kind: 'shiftRepeatTimes',
        id: edit.taskId,
        startDelta: edit.startAt - edit.origStart,
        endDelta: edit.endAt - edit.origEnd,
      })
    }
  }

  /** Read the catalog from the transport. */
  transportOptions(): Promise<ExecutionCatalog> { return this.transport.options() }

  selectedTask(): TaskRecord | undefined {
    return this.state.snapshot.tasks.find(t => t.id === this.state.selectedTaskId)
  }

  dispose(): void {
    this.disposeSub()
    this.listeners.clear()
  }
}

/** Fresh initial state at a given cursor. */
export function initialState(cursor: number = Date.now(), weekStart: WeekStart = 0): calendarClientState {
  return {
    snapshot: { schemaVersion: 1, revision: 0, tasks: [], scheduler: { timeZone: '' } },
    cursor,
    view: 'week',
    weekStart,
    selectedTaskId: undefined,
    draft: undefined,
    dayWindow: loadDayWindow(),
    open: false,
    catalog: { workspaces: [], sessions: [], projects: [], providers: [], modelsByProvider: {}, modes: [] },
    pendingRepeatTimeEdit: undefined,
    status: 'loading',
    error: null,
  }
}
